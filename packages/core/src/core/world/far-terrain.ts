import { MessageProtocol } from "@voxelize/protocol";
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataArrayTexture,
  DataTexture,
  DoubleSide,
  FloatType,
  Group,
  Int16BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NearestFilter,
  PlaneGeometry,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  Sphere,
  SRGBColorSpace,
  Texture,
  Uint8BufferAttribute,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
} from "three";

import { WorkerPool } from "../../libs/worker-pool";

import { DEFAULT_FAR_LOD, FarLodOptions, planFarLod } from "./far-terrain-lod";
import {
  buildFarMaterialTable,
  FAR_LAYER_SIZE,
  FAR_MATERIAL_TEXELS,
  FAR_TINTED_LAYER,
  farMaterialFaces,
  FarMaterialTable,
  farPaletteTable,
} from "./far-terrain-materials";
import {
  FAR_FACE_KIND,
  FarMeshCounts,
  FarMeshData,
  FarMeshInput,
} from "./far-terrain-mesh";
import {
  FAR_SEAM_FUNCTIONS,
  FAR_SEAM_UNIFORM_DECLARATIONS,
  farSeamScale,
} from "./far-terrain-seam";
import {
  buildCoverageMask,
  decodeFarTerrainReply,
  FarFaceLook,
  FarFaceSide,
  FarTerrainDescriptor,
  FarTileData,
  farTileId,
  FarTileKey,
  farTileSpan,
  pendingChunksWithin,
} from "./far-terrain-tiles";
import {
  createSkyAtmosphereFragment,
  SKY_FOG_UNIFORM_DECLARATIONS,
} from "./sky-fog";
import {
  createUnderwaterFogFragment,
  WATER_DOWNWELLING_EXTINCTION_GLSL,
  WATER_OPTICS,
} from "./water-optics";
import FarTerrainWorker from "./workers/far-terrain-worker.ts?worker&inline";

/** The method a client calls for far-terrain tiles, and its reply's name. */
export const FAR_TERRAIN_METHOD = "vox-builtin:far-terrain";

/** Texels per side of the chunk-coverage mask (chunk columns). */
const COVERAGE_SIZE = 128;

/**
 * While columns are still on their way the mask is rebuilt on this cadence
 * as well as on every change, so a column that outlives its grace
 * (`CHUNK_PENDING_GRACE_MS`) uncovers without waiting for another chunk to
 * load.
 */
const PENDING_RECHECK_MS = 500;

/**
 * The sea-depth map the far water reads: texels per side, blocks per texel
 * (2048 blocks across, past any reach), the depth one byte spans, and how
 * far the viewer may drift from its centre before it is laid out again.
 */
const DEPTH_TEXELS = 256;
const DEPTH_BLOCKS_PER_TEXEL = 8;
const DEPTH_RANGE = 32;
const DEPTH_RECENTER = 256;

type ShaderUniform<T> = { value: T };

/** Uniforms the far layer shares with the chunk shader, by reference. */
export type FarTerrainSharedUniforms = {
  fogColor: ShaderUniform<Color>;
  fogNear: ShaderUniform<number>;
  fogFar: ShaderUniform<number>;
  fogHeightOrigin: ShaderUniform<number>;
  fogHeightDensity: ShaderUniform<number>;
  fogVerticalBlend: ShaderUniform<number>;
  skyFogTopColor: ShaderUniform<Color>;
  skyFogMiddleColor: ShaderUniform<Color>;
  skyFogBottomColor: ShaderUniform<Color>;
  skyFogOffset: ShaderUniform<number>;
  skyFogVoidOffset: ShaderUniform<number>;
  skyFogExponent: ShaderUniform<number>;
  skyFogExponent2: ShaderUniform<number>;
  skyFogDimension: ShaderUniform<number>;
  skyFogStrength: ShaderUniform<number>;
  sunlightIntensity: ShaderUniform<number>;
  /** The share of the sun reaching the world as a beam (the weather's). */
  directSunlight?: ShaderUniform<number>;
  minLightLevel: ShaderUniform<number>;
  baseAmbient: ShaderUniform<number>;
  faceShades: ShaderUniform<{ x: number; y: number; z: number; w: number }>;
  cameraSubmersion: ShaderUniform<number>;
  cameraWaterPlaneY: ShaderUniform<number>;
  underwaterAmbient: ShaderUniform<Color>;
  underwaterViewScale: ShaderUniform<number>;
  sunDirection: ShaderUniform<Vector3>;
  sunColor: ShaderUniform<Color>;
  ambientColor: ShaderUniform<Color>;
  /**
   * The sky the chunk water mirrors and how strongly it does, so the far
   * sea mirrors the same sky; without them it mirrors none.
   */
  skyTopColor?: ShaderUniform<Color>;
  skyMiddleColor?: ShaderUniform<Color>;
  waterFresnelStrength?: ShaderUniform<number>;
  /**
   * The chunk shader's side of the seam, written here: the coverage mask,
   * its placement `(originCx, originCz, chunkSize, texels)` and the seam
   * band's ramp scale (0 while the layer is off).
   */
  farCoverMask: ShaderUniform<Texture | null>;
  farCover: ShaderUniform<Vector4>;
  farSeam: ShaderUniform<number>;
};

/** A tile's meshes, built off the main thread. */
export type FarBuiltTile = {
  land: FarMeshData | null;
  sky: FarMeshData | null;
  buildMs: number;
};

export type FarTerrainOptions = {
  /**
   * How far past the viewer the layer reaches, in blocks; 0 turns it off.
   */
  distance: number;
  /**
   * Linear RGB per class, flattened, for a server whose descriptor names no
   * `materials`. A class past the end takes the last entry; an empty
   * palette draws grey.
   */
  palette: ArrayLike<number>;
  /**
   * What a block face looks like from afar, texels included (the world
   * reads them off the atlas), or null while its texture is not painted
   * yet. Used to paint the descriptor's `materials`.
   */
  faceLook: ((block: number, side: FarFaceSide) => FarFaceLook | null) | null;
  /**
   * How long a face may stay unreadable before the layer paints it grey and
   * says so, rather than never drawing.
   */
  faceLookTimeoutMs: number;
  /** The far water plane's colour. */
  waterColor: Color | string | number;
  /**
   * Colour of floating land's top and of its underside and walls, when the
   * descriptor names no `skyMaterial`.
   */
  skyTopColor: Color | string | number;
  skySideColor: Color | string | number;
  /**
   * The outer share of the reach across which the layer thins into the
   * haze, reaching it at the reach, so its edge never cuts against the sky.
   */
  edgeBand: number;
  /** How the layer chooses each tile's level of detail. */
  lod: FarLodOptions;
  /** How long a tile takes to dissolve in or out when the detail changes. */
  fadeMs: number;
  /** Tiles kept resident at most; the least recently drawn leave first. */
  maxResidentTiles: number;
  /**
   * A tile no plan has drawn for this long leaves even under the cap: long
   * enough that a trip away and back (a teleport home) finds the tiles it
   * left still resident.
   */
  evictAfterMs: number;
  /**
   * Chunk columns nearer the viewer's than this, in chunks, show sky and
   * fog while still on their way, whatever tile could stand in: right by
   * the viewer, a coarse tile shows through the walls of a canyon. Further
   * out any drawn tile stands in. 0 lets one stand in everywhere.
   */
  pendingGuardRadius: number;
  /** Tile builds in flight at once. */
  maxBuildsInFlight: number;
  /**
   * Builds a tile's meshes; the default hands it to a worker. A test, or a
   * host without workers, passes its own.
   */
  buildMesh: ((input: FarMeshInput) => Promise<FarBuiltTile | null>) | null;
  /** Tiles one request may name; the server caps it too. */
  maxTilesPerRequest: number;
  /** Least time between two requests. */
  requestIntervalMs: number;
  /** A requested tile that has not arrived in this long is asked again. */
  retryAfterMs: number;
  /**
   * Tiles of the server's budget (`descriptor.budget`) never spent, so a
   * request that arrives sooner after the last than it was sent is not
   * refused for the difference.
   */
  budgetHeadroom: number;
  /** Main-thread time one update may spend reading faces. */
  buildBudgetMs: number;
  /**
   * Blocks of the loaded area's outer edge that hand over to the far layer
   * across a dithered band, up to half a chunk; 0 keeps the edge hard.
   */
  seamBand: number;
};

const DEFAULT_OPTIONS: FarTerrainOptions = {
  distance: 0,
  palette: [],
  faceLook: null,
  faceLookTimeoutMs: 10000,
  waterColor: "#2d6a9a",
  skyTopColor: "#6f9d4e",
  skySideColor: "#6e665c",
  edgeBand: 0.1,
  lod: DEFAULT_FAR_LOD,
  fadeMs: 450,
  maxResidentTiles: 640,
  evictAfterMs: 60_000,
  pendingGuardRadius: 3,
  maxBuildsInFlight: 4,
  buildMesh: null,
  maxTilesPerRequest: 16,
  requestIntervalMs: 120,
  retryAfterMs: 6000,
  budgetHeadroom: 1,
  buildBudgetMs: 0.6,
  seamBand: 8,
};

/** Counters a harness can read to prove the budget. */
export type FarTerrainStats = {
  isActive: boolean;
  distance: number;
  /** Detail levels drawn this frame. */
  rings: number;
  tilesRequested: number;
  tilesReceived: number;
  tilesRejected: number;
  bytesReceived: number;
  tilesBuilt: number;
  tilesResident: number;
  /** Tiles drawn this frame, and those the detail rules want. */
  tilesDrawn: number;
  tilesWanted: number;
  /** Tiles drawn this frame at each level, finest first. */
  levelCounts: number[];
  /** Tile meshes (land + sky) in the scene; each is one draw call when in view. */
  meshes: number;
  /** Main-thread ms the last update spent (planning, requests, mask). */
  lastUpdateMs: number;
  /** Highest `lastUpdateMs` since the counters were last read. */
  peakUpdateMs: number;
  /** Main-thread ms spent across every update, and how many there were. */
  totalUpdateMs: number;
  updates: number;
  /** Mask rebuilds. */
  maskRebuilds: number;
  /** Chunk columns inside the render radius the last mask covered because
   * they were still on their way (not loaded yet), inside the guard radius
   * or under no drawn tile: 0 once everything inside has landed. */
  pendingCovered: number;
  /**
   * Chunk columns still on their way the last mask left to the far layer,
   * under drawn tiles: the strip a flight brings inside the render radius,
   * or the ground around a teleport's end, keeps the terrain it showed.
   */
  pendingStoodIn: number;
  /** Triangles across every built tile mesh in the scene. */
  triangles: number;
  /** Worker ms the last tile build took, and the highest since the peaks were reset. */
  lastBuildMs: number;
  peakBuildMs: number;
  /** Builds handed to the worker and not back yet. */
  buildsInFlight: number;
  /** Main-thread ms the last built tile took to become a mesh, and the highest. */
  lastUploadMs: number;
  peakUploadMs: number;
  /** Bytes of vertex and index data across resident meshes. */
  meshBytes: number;
  /** Quads of the drawn land by what they are. */
  quads: FarMeshCounts;
  /**
   * Block faces read for the descriptor's materials, those still waiting
   * for their texture, those painted grey because they never became
   * readable, and the main-thread ms the reads took.
   */
  facesResolved: number;
  facesPending: number;
  facesMissing: number;
  faceLookMs: number;
};

const VERTEX_SHADER = `
attribute vec2 aFarColumn;
attribute vec4 aFarMaterial;
attribute vec4 aFarTint;
varying vec3 vWorldPosition;
varying float vFarOcclusion;
flat varying vec4 vFarMaterial;
flat varying vec2 vFarColumn;
flat varying vec3 vFarTint;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vFarMaterial = aFarMaterial;
  vFarOcclusion = aFarMaterial.z / 255.0;
  vFarColumn = aFarColumn;
  vFarTint = aFarTint.rgb * (1.0 / 128.0);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const WATER_VERTEX_SHADER = `
varying vec3 vWorldPosition;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

/**
 * The chunk fragment's daylight terms for an open face in full sun (the
 * block after `#include <envmap_fragment>` in shaders.ts: no shadow, no
 * occlusion, no block light), as the literals both shaders carry. The chunk
 * shader is the source of truth; far-terrain.test.ts reads it and fails when
 * either side changes alone.
 */
export const CHUNK_DAYLIGHT = {
  /** `max(rawNdotL * 0.85 + 0.15, 0.0)`: the wrapped sun. */
  sunWrap: { scale: "0.85", bias: "0.15" },
  /** `smoothstep(0.75, 0.95, texLuma)`: how bright a texture counts as. */
  brightTexture: { from: "0.75", to: "0.95" },
  /** `mix(1.0, 0.7, isBrightTex)`: the sun a bright texture keeps. */
  brightTextureSun: "0.7",
  /** `uAmbientColor * 0.4`: the sky ambient a face looking down gets. */
  groundAmbient: "0.4",
  /** `vec3(0.025, 0.03, 0.04) * sunVisibility`: starlight under open sky. */
  starlight: "0.025, 0.03, 0.04",
  /** `vec3 coolTint = vec3(0.92, 0.95, 1.05)`: daylight white balance. */
  daylightBalance: "0.92, 0.95, 1.05",
  /** The ACES fit `(x (2.51 x + 0.03)) / (x (2.43 x + 0.59) + 0.14)`. */
  toneMap: { a: "2.51", b: "0.03", c: "2.43", d: "0.59", e: "0.14" },
} as const;

const D = CHUNK_DAYLIGHT;

/** The face kinds as GLSL integer constants. */
const KIND_GLSL = Object.entries(FAR_FACE_KIND)
  .map(
    ([name, value]) => `const int FAR_KIND_${name.toUpperCase()} = ${value};`,
  )
  .join("\n");

/**
 * Light an albedo as the chunk shader lights an open face in full sun
 * ({@link CHUNK_DAYLIGHT}), with `occlusion` where the chunks have their
 * vertex occlusion, then wear the chunks' sky fog and thin into it across
 * the outer `uFarEdge` band.
 */
const lightAndFog = (afterLight = "") => `
  float NdotL = max(dot(normal, uSunDirection) * ${D.sunWrap.scale} + ${D.sunWrap.bias}, 0.0);
  float brightTexture = smoothstep(${D.brightTexture.from}, ${D.brightTexture.to}, dot(albedo, vec3(0.2126, 0.7152, 0.0722)));
  vec3 sun = uSunColor * NdotL * uSunlightIntensity * mix(1.0, ${D.brightTextureSun}, brightTexture);
  float hemisphere = normal.y * 0.5 + 0.5;
  vec3 skyAmbient = mix(uAmbientColor * ${D.groundAmbient}, uAmbientColor, hemisphere);
  float ambientFloor = max(uMinLightLevel + uBaseAmbient, 0.0);
  vec3 globalAmbient = vec3(${D.starlight}) + uAmbientColor * ambientFloor;
  vec3 weights = abs(normal);
  weights /= max(weights.x + weights.y + weights.z, 0.0001);
  float verticalShade = normal.y > 0.0 ? uFaceShades.w : uFaceShades.z;
  float faceShade = weights.x * uFaceShades.x + weights.z * uFaceShades.y + weights.y * verticalShade;
  vec3 light = (skyAmbient + sun + globalAmbient) * vec3(${D.daylightBalance}) * occlusion * faceShade;
  light = (light * (${D.toneMap.a} * light + ${D.toneMap.b})) / (light * (${D.toneMap.c} * light + ${D.toneMap.d}) + ${D.toneMap.e});
  light = max(light, vec3(ambientFloor) * faceShade);

  gl_FragColor = vec4(albedo * light, 1.0);
  ${afterLight}
  ${createSkyAtmosphereFragment()}
  gl_FragColor.rgb = mix(
    gl_FragColor.rgb,
    fogTint,
    smoothstep(uFarEdge.x, uFarEdge.y, horizontal) * (1.0 - uCameraSubmersion)
  );
  ${createUnderwaterFogFragment(false)}
`;

const COMMON_DECLARATIONS = `
${SKY_FOG_UNIFORM_DECLARATIONS}
uniform vec3 uAmbientColor;
uniform float uMinLightLevel;
uniform float uBaseAmbient;
uniform vec4 uFaceShades;
uniform float uRingOuter;
uniform vec2 uRingCenter;
uniform vec2 uFarEdge;
${FAR_SEAM_UNIFORM_DECLARATIONS}
varying vec3 vWorldPosition;
${FAR_SEAM_FUNCTIONS}
`;

/**
 * Hide under every chunk that draws real terrain, except the pixels the
 * chunk's outer half yields across the seam band (far-terrain-seam), and
 * past the reach, measured from the viewer the tiles were picked around.
 */
const COVER_DISCARD = `
  vec2 farTexel = farCoverTexel(vWorldPosition.xz);
  if (farCoverInside(farTexel) && farCoverHard(farTexel) > 0.5) {
    if (uFarSeam <= 0.0 || farSeamWeight(farTexel) > farSeamDither(gl_FragCoord.xy)) discard;
  }
  float horizontal = length(vWorldPosition.xz - uRingCenter);
  if (horizontal >= uRingOuter) discard;
`;

/**
 * The land: each face's block picked from the class table by what the
 * face is (a top dithers its flat covers in per block, a wall shows the
 * strata down from its column's ground, a crown its leaves), sampled at
 * the block's own 16 texels a block in world space, so mips track the
 * footprint and the smallest is the face's mean; the climate tint on the
 * faces that take it.
 */
const LAND_FRAGMENT_SHADER = `
precision highp sampler2DArray;
${COMMON_DECLARATIONS}
uniform highp sampler2DArray uFarLayers;
uniform highp sampler2D uFarMaterials;
uniform vec2 uFarFade;
varying float vFarOcclusion;
flat varying vec4 vFarMaterial;
flat varying vec2 vFarColumn;
flat varying vec3 vFarTint;
${KIND_GLSL}

float farCoverHash(vec2 cell) {
  uvec2 q = uvec2(ivec2(floor(cell)));
  uint h = (q.x * 0x8da6b343u) ^ (q.y * 0xd8163841u);
  h = (h ^ (h >> 13u)) * 0x5bd1e995u;
  h ^= h >> 15u;
  return float(h & 0xffffffu) / 16777216.0;
}

vec3 farLayerColor(float code, vec2 uv, vec2 dx, vec2 dy) {
  bool tinted = code >= ${FAR_TINTED_LAYER}.0;
  float layer = tinted ? code - ${FAR_TINTED_LAYER}.0 : code;
  vec3 color = textureGrad(uFarLayers, vec3(uv, max(layer, 0.0)), dx, dy).rgb;
  return tinted ? color * vFarTint : color;
}

void main() {
  // A tile dissolving in draws the pixels under its opacity; one
  // dissolving out the rest, so a swap never shows both or neither.
  float fadeDither = farSeamDither(gl_FragCoord.xy);
  if (uFarFade.y > 0.0 ? fadeDither >= uFarFade.x : fadeDither < 1.0 - uFarFade.x) discard;
  ${COVER_DISCARD}

  vec3 normal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
  if (dot(normal, cameraPosition - vWorldPosition) < 0.0) normal = -normal;

  int cls = int(vFarMaterial.x + 0.5);
  int kind = int(vFarMaterial.y + 0.5);
  vec4 m0 = texelFetch(uFarMaterials, ivec2(0, cls), 0);
  vec4 m1 = texelFetch(uFarMaterials, ivec2(1, cls), 0);
  vec4 m2 = texelFetch(uFarMaterials, ivec2(2, cls), 0);

  vec3 p = vWorldPosition;
  bool isFlat = abs(normal.y) > 0.5;
  // The chunk mesher's face orientation (greedyFaceUv), unwrapped.
  vec2 uv = isFlat
    ? (normal.y > 0.0 ? vec2(-p.x, p.z) : vec2(p.x, -p.z))
    : (abs(normal.x) > 0.5
        ? vec2(normal.x > 0.0 ? -p.z : p.z, p.y)
        : vec2(normal.z > 0.0 ? p.x : -p.x, p.y));
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);

  vec3 albedo;
  if (kind == FAR_KIND_TOP) {
    // Flat covers are whole blocks of their own, chosen per block. Once a
    // block shrinks under a couple of pixels the choice would sparkle, so
    // the covers blend in by share instead.
    float choice = farCoverHash(p.xz);
    float code = choice < m1.x ? m0.y : choice < m1.y ? m0.z : choice < m1.z ? m0.w : m0.x;
    vec3 chosen = farLayerColor(code, uv, dx, dy);
    float footprint = max(length(dx), length(dy));
    float blend = smoothstep(0.35, 0.8, footprint);
    if (blend > 0.0) {
      vec3 mixed = farLayerColor(m0.x, uv, dx, dy) * (1.0 - m1.z);
      if (m1.x > 0.0) mixed += farLayerColor(m0.y, uv, dx, dy) * m1.x;
      if (m1.y > m1.x) mixed += farLayerColor(m0.z, uv, dx, dy) * (m1.y - m1.x);
      if (m1.z > m1.y) mixed += farLayerColor(m0.w, uv, dx, dy) * (m1.z - m1.y);
      chosen = mix(chosen, mixed, blend);
    }
    albedo = chosen;
  } else if (kind == FAR_KIND_CROWN) {
    // A crown's class is its species': leaves on every face.
    albedo = farLayerColor(m0.x, uv, dx, dy);
  } else if (kind == FAR_KIND_TRUNK) {
    albedo = farLayerColor(m2.y, uv, dx, dy);
  } else if (kind == FAR_KIND_BOTTOM) {
    albedo = farLayerColor(m2.z, uv, dx, dy);
  } else {
    // A wall: the ground block's side for its top block, the side block for
    // sideDepth more, and the deep block below.
    float depth = vFarColumn.x - p.y;
    float code = depth < 1.0 ? m2.x : depth < 1.0 + m1.w ? m2.y : m2.z;
    albedo = farLayerColor(code, uv, dx, dy);
  }
  float occlusion = vFarOcclusion;
  ${lightAndFog()}
}
`;

/**
 * The chunk water's Fresnel on a top face (`fresnelBase` and `fresnelMax`
 * in shaders.ts, at `topWaterFace` 1), as the literals both shaders carry;
 * far-terrain.test.ts fails when either side changes alone.
 */
export const CHUNK_WATER_FRESNEL = { base: "0.04", max: "0.56" };

/**
 * The far water, seen from above by the chunk water's own optics (the
 * refraction branch of its top face in shaders.ts): the sea floor dimmed
 * over the path down and back, the water's in-scatter growing with
 * thickness and toward grazing angles, past a few blocks the deep haze, and
 * the sky mirrored by the same Fresnel. The depth comes from the far tiles'
 * own floor heights.
 */
const FAR_WATER_FN = `
float farWaterFresnel(float cosView) {
  float fresnel = ${CHUNK_WATER_FRESNEL.base}
    + uWaterFresnelStrength * pow(1.0 - clamp(cosView, 0.0, 1.0), 5.0);
  return clamp(fresnel, 0.01, ${CHUNK_WATER_FRESNEL.max})
    * ${WATER_OPTICS.distantFresnelFactor.toFixed(4)};
}
vec3 farWaterAlbedo(float seaDepth, float fresnel) {
  float floorDepth = min(seaDepth, ${WATER_OPTICS.floorAbsorptionMaxDepth.toFixed(4)});
  vec3 floorShade = exp(
    -${WATER_DOWNWELLING_EXTINCTION_GLSL}
    * floorDepth
    * ${WATER_OPTICS.floorAbsorptionPathScale.toFixed(4)}
  ) * ${WATER_OPTICS.wetFloorDarken.toFixed(4)};
  float thicknessScatter = (1.0 - exp(
    -floorDepth * ${WATER_OPTICS.shallowScatterDensity.toFixed(4)}
  )) * ${WATER_OPTICS.shallowScatterMaxMix.toFixed(4)};
  vec3 shallow = mix(
    uSeabedColor * floorShade,
    uWaterColor,
    clamp(0.12 + fresnel * 0.28 + thicknessScatter, 0.0, 1.0)
  );
  float deepTransmit = exp(
    -max(seaDepth - ${WATER_OPTICS.deepSurfaceClearDepth.toFixed(4)}, 0.0)
    * ${WATER_OPTICS.deepSurfaceExtinction.toFixed(4)}
  );
  return mix(uWaterColor, shallow, deepTransmit);
}
vec3 farSkyMirror(vec3 toCamera) {
  vec3 reflectDir = reflect(-toCamera, vec3(0.0, 1.0, 0.0));
  float skyH = normalize(reflectDir * uSkyFogDimension + uSkyFogOffset).y;
  return mix(uSkyMiddleColor, uSkyTopColor, pow(max(skyH, 0.0), uSkyFogExponent));
}
`;

const WATER_FRAGMENT_SHADER = `
${COMMON_DECLARATIONS}
uniform vec3 uWaterColor;
uniform vec3 uSeabedColor;
uniform sampler2D uFarDepthMap;
uniform vec4 uFarDepth;
uniform vec3 uSkyTopColor;
uniform vec3 uSkyMiddleColor;
uniform float uWaterFresnelStrength;
${FAR_WATER_FN}
void main() {
  ${COVER_DISCARD}
  vec3 normal = vec3(0.0, 1.0, 0.0);
  vec2 depthUv = (vWorldPosition.xz - uFarDepth.xy) / (uFarDepth.z * uFarDepth.w);
  float seaDepth = texture2D(uFarDepthMap, depthUv).r * ${DEPTH_RANGE}.0;
  vec3 toCamera = normalize(cameraPosition - vWorldPosition);
  float fresnel = farWaterFresnel(toCamera.y);
  vec3 albedo = farWaterAlbedo(seaDepth, fresnel);
  float occlusion = 1.0;
  ${lightAndFog(
    "gl_FragColor.rgb = mix(gl_FragColor.rgb, farSkyMirror(toCamera), fresnel);",
  )}
}
`;

type ResidentTile = {
  data: FarTileData;
  land: Mesh | null;
  sky: Mesh | null;
  isBuilt: boolean;
  isBuilding: boolean;
  /** 0 hidden, 1 fully drawn; eases toward 1 while drawn, 0 when not. */
  opacity: number;
  isDrawn: boolean;
  lastDrawnAt: number;
  bytes: number;
  /** Builds that failed; past MAX_BUILD_ATTEMPTS the tile is not tried again. */
  failedBuilds: number;
  counts: FarMeshCounts | null;
};

let sharedPool: WorkerPool | null = null;

const workerBuild = (input: FarMeshInput): Promise<FarBuiltTile | null> => {
  if (!sharedPool) {
    sharedPool = new WorkerPool(FarTerrainWorker, {
      maxWorker: 2,
      name: "far-terrain-worker",
    });
  }
  const pool = sharedPool;
  return new Promise((resolve) => {
    pool.addJob({
      message: { input },
      resolve: (data: FarBuiltTile | null) => resolve(data),
      timeoutMs: 20000,
    });
  });
};

const reliefOf = (tile: FarTileData) => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let at = 0; at < tile.heights.length; at++) {
    const h = tile.heights[at];
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  return Number.isFinite(lo) ? hi - lo : 0;
};

/**
 * Coarse terrain past the loaded chunks: a quadtree of stepped-column tiles
 * the server samples from its generator, finer near the viewer and on tall
 * relief, painted from the textures of the blocks each surface is made of
 * and lit and fogged as the chunks are, hidden wherever a chunk draws real
 * terrain, with a flat water plane at sea level. Tiles are meshed off the
 * main thread and dissolve in and out as the detail changes. The `World`
 * owns one, feeds it the server's descriptor from the INIT options, drives
 * `update` once a frame, hands it method replies and sends the requests it
 * queues.
 */
export class FarTerrain extends Group {
  public options: FarTerrainOptions;

  public descriptor: FarTerrainDescriptor | null = null;

  public stats: FarTerrainStats = {
    isActive: false,
    distance: 0,
    rings: 0,
    tilesRequested: 0,
    tilesReceived: 0,
    tilesRejected: 0,
    bytesReceived: 0,
    tilesBuilt: 0,
    tilesResident: 0,
    tilesDrawn: 0,
    tilesWanted: 0,
    levelCounts: [],
    meshes: 0,
    lastUpdateMs: 0,
    peakUpdateMs: 0,
    totalUpdateMs: 0,
    updates: 0,
    maskRebuilds: 0,
    pendingCovered: 0,
    pendingStoodIn: 0,
    triangles: 0,
    lastBuildMs: 0,
    peakBuildMs: 0,
    buildsInFlight: 0,
    lastUploadMs: 0,
    peakUploadMs: 0,
    meshBytes: 0,
    quads: { tops: 0, risers: 0, skirts: 0, crowns: 0 },
    facesResolved: 0,
    facesPending: 0,
    facesMissing: 0,
    faceLookMs: 0,
  };

  private resident = new Map<string, ResidentTile>();

  /**
   * Every tile's relief once seen, kept past its mesh: a tile split for its
   * relief is never drawn, so it leaves, and without its relief the plan
   * would stop splitting and fetch it again.
   */
  private reliefs = new Map<string, number>();

  private pending = new Map<string, number>();

  private queuedRequests: MessageProtocol[] = [];

  private lastRequestAt = -Infinity;

  /**
   * The server's budget for this client mirrored as its token bucket: the
   * tiles still to ask for, and when it last refilled. Null until the first
   * request under a descriptor that names a budget.
   */
  private budgetTokens: number | null = null;

  private budgetRefilledAt = 0;

  private lastUpdateAt = -Infinity;

  private palette: Float32Array;

  /** The materials as GPU data, once every face they need has been read. */
  private materialTable: FarMaterialTable | null = null;

  /** Faces read so far, by `block:side`. */
  private faceLooks = new Map<string, FarFaceLook>();

  /** When each still unreadable face was first asked for. */
  private faceWaitingSince = new Map<string, number>();

  private layersTexture: DataArrayTexture;

  private materialsTexture: DataTexture;

  private landMaterial: ShaderMaterial;

  private waterMaterial: ShaderMaterial;

  private water: Mesh;

  private waterSpan = 0;

  private coverage: Uint8Array;

  private coverageTexture: DataTexture;

  private coverageGeneration = -1;

  private coverageCenter: [number, number] | null = null;

  private coverageRadius = -1;

  private coverageBuiltAt = 0;

  /**
   * Tiles drawn and fully dissolved in, at whatever detail, and those still
   * dissolving out under their replacement: the ones that stand in for a
   * chunk column still on its way outside the guard radius
   * (`pendingGuardRadius`).
   */
  private standIns = new Set<string>();

  /** Bumped whenever `standIns` changes, so the mask follows it. */
  private standInGeneration = 0;

  private coverageStandIns = -1;

  /** Sea depth per texel (0 dry, 255 at DEPTH_RANGE or deeper), around the viewer. */
  private depth = new Uint8Array(DEPTH_TEXELS * DEPTH_TEXELS).fill(255);

  /** The level of the tile each depth texel came from (255 none), so a coarser one never overwrites a finer. */
  private depthLevel = new Uint8Array(DEPTH_TEXELS * DEPTH_TEXELS).fill(255);

  private depthTexture: DataTexture;

  /** `(originX, originZ, blocks per texel, texels)` of the depth map. */
  private depthWindow: ShaderUniform<Vector4> = {
    value: new Vector4(0, 0, DEPTH_BLOCKS_PER_TEXEL, DEPTH_TEXELS),
  };

  private depthCenter: [number, number] | null = null;

  private seabedColor: ShaderUniform<Color> = { value: new Color() };

  private skyTop: [number, number, number];

  private skySide: [number, number, number];

  private chunkSize = 16;

  /** Horizontal centre the reach is measured from, shared by every material. */
  private ringCenter: ShaderUniform<Vector2> = { value: new Vector2() };

  /** `(start, end)` of the band across which the layer thins into haze. */
  private farEdge: ShaderUniform<Vector2> = {
    value: new Vector2(Infinity, Infinity),
  };

  /** The fade of the mesh about to draw, written per draw. */
  private farFade: ShaderUniform<Vector2> = { value: new Vector2(1, 1) };

  /** Bumped by configure and clearTiles, so a build in flight that was asked for an older layer is dropped. */
  private epoch = 0;

  private shared: FarTerrainSharedUniforms;

  constructor(
    shared: FarTerrainSharedUniforms,
    options: Partial<FarTerrainOptions> = {},
  ) {
    super();
    this.name = "far-terrain";
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.shared = shared;
    this.palette = Float32Array.from(this.options.palette);
    this.skyTop = colorTriple(this.options.skyTopColor);
    this.skySide = colorTriple(this.options.skySideColor);

    this.coverage = new Uint8Array(COVERAGE_SIZE * COVERAGE_SIZE);
    this.coverageTexture = new DataTexture(
      this.coverage,
      COVERAGE_SIZE,
      COVERAGE_SIZE,
      RedFormat,
      UnsignedByteType,
    );
    // Linear so the mask reads as a ramp across the loaded edge for the
    // seam band; the per-chunk answer samples texel centres.
    this.coverageTexture.magFilter = LinearFilter;
    this.coverageTexture.minFilter = LinearFilter;
    this.coverageTexture.needsUpdate = true;
    shared.farCoverMask.value = this.coverageTexture;
    shared.farCover.value.set(0, 0, this.chunkSize, COVERAGE_SIZE);
    shared.farSeam.value = 0;

    this.depthTexture = new DataTexture(
      this.depth,
      DEPTH_TEXELS,
      DEPTH_TEXELS,
      RedFormat,
      UnsignedByteType,
    );
    this.depthTexture.magFilter = LinearFilter;
    this.depthTexture.minFilter = LinearFilter;
    this.depthTexture.needsUpdate = true;
    this.seabedColor.value.set(this.options.waterColor);

    this.layersTexture = new DataArrayTexture(
      new Uint8Array(FAR_LAYER_SIZE * FAR_LAYER_SIZE * 4).fill(128),
      FAR_LAYER_SIZE,
      FAR_LAYER_SIZE,
      1,
    );
    this.materialsTexture = new DataTexture(
      new Float32Array(FAR_MATERIAL_TEXELS * 4),
      FAR_MATERIAL_TEXELS,
      1,
      RGBAFormat,
      FloatType,
    );

    const common = () => ({
      uFogColor: shared.fogColor,
      uFogNear: shared.fogNear,
      uFogFar: shared.fogFar,
      uFogHeightOrigin: shared.fogHeightOrigin,
      uFogHeightDensity: shared.fogHeightDensity,
      uFogVerticalBlend: shared.fogVerticalBlend,
      uSkyFogTopColor: shared.skyFogTopColor,
      uSkyFogMiddleColor: shared.skyFogMiddleColor,
      uSkyFogBottomColor: shared.skyFogBottomColor,
      uSkyFogOffset: shared.skyFogOffset,
      uSkyFogVoidOffset: shared.skyFogVoidOffset,
      uSkyFogExponent: shared.skyFogExponent,
      uSkyFogExponent2: shared.skyFogExponent2,
      uSkyFogDimension: shared.skyFogDimension,
      uSkyFogStrength: shared.skyFogStrength,
      uChunkReveal: { value: 1 },
      uCameraSubmersion: shared.cameraSubmersion,
      uCameraWaterPlaneY: shared.cameraWaterPlaneY,
      uUnderwaterAmbient: shared.underwaterAmbient,
      uUnderwaterViewScale: shared.underwaterViewScale,
      uSunDirection: shared.sunDirection,
      uSunColor: shared.sunColor,
      uSunlightIntensity: shared.sunlightIntensity,
      uDirectSunlight: shared.directSunlight ?? { value: 1 },
      uAmbientColor: shared.ambientColor,
      uMinLightLevel: shared.minLightLevel,
      uBaseAmbient: shared.baseAmbient,
      uFaceShades: shared.faceShades,
      uFarCoverMask: shared.farCoverMask,
      uFarCover: shared.farCover,
      uFarSeam: shared.farSeam,
      uRingOuter: { value: 0 },
      uRingCenter: this.ringCenter,
      uFarEdge: this.farEdge,
    });

    this.landMaterial = new ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: LAND_FRAGMENT_SHADER,
      uniforms: {
        ...common(),
        uFarLayers: { value: this.layersTexture },
        uFarMaterials: { value: this.materialsTexture },
        uFarFade: this.farFade,
      },
      side: DoubleSide,
    });
    this.waterMaterial = new ShaderMaterial({
      vertexShader: WATER_VERTEX_SHADER,
      fragmentShader: WATER_FRAGMENT_SHADER,
      uniforms: {
        ...common(),
        uWaterColor: { value: new Color(this.options.waterColor) },
        uSeabedColor: this.seabedColor,
        uFarDepthMap: { value: this.depthTexture },
        uFarDepth: this.depthWindow,
        uSkyTopColor: shared.skyTopColor ?? shared.skyFogTopColor,
        uSkyMiddleColor: shared.skyMiddleColor ?? shared.skyFogMiddleColor,
        uWaterFresnelStrength: shared.waterFresnelStrength ?? { value: 0 },
      },
      side: DoubleSide,
    });
    this.water = new Mesh(new PlaneGeometry(1, 1), this.waterMaterial);
    this.water.name = "far-terrain-water";
    this.water.rotation.x = -Math.PI / 2;
    this.water.castShadow = false;
    this.water.receiveShadow = false;
    this.water.frustumCulled = false;
    this.water.visible = false;
    this.add(this.water);
  }

  /** The server's description of its far terrain, or null for none. */
  configure(descriptor: FarTerrainDescriptor | null) {
    const valid =
      descriptor &&
      Number.isFinite(descriptor.baseStep) &&
      descriptor.baseStep >= 1 &&
      Number.isFinite(descriptor.tileSamples) &&
      descriptor.tileSamples >= 2 &&
      Number.isFinite(descriptor.levels) &&
      descriptor.levels >= 1
        ? descriptor
        : null;
    if (JSON.stringify(valid) === JSON.stringify(this.descriptor)) return;
    this.descriptor = valid;
    this.budgetTokens = null;
    this.clearTiles();
    this.materialTable = null;
  }

  /**
   * Replaces the colour of every class (linear RGB, flattened) for a server
   * whose descriptor names no materials; tiles built from here on use it. A
   * source whose classes are discovered as tiles arrive (block ids, say)
   * grows its palette before handing each tile in.
   */
  setPalette(palette: ArrayLike<number>) {
    this.palette = Float32Array.from(palette);
    if (!this.descriptor?.materials?.length) this.materialTable = null;
  }

  /**
   * Read every face the descriptor's materials name now, a slice at a time,
   * for a load phase to await once the block textures are painted: each
   * atlas read waits on the GPU, a stall that belongs behind a loading
   * screen, not in the frame a player switches the layer on. Settles once
   * the materials are ready (a face that never becomes readable is greyed
   * after `faceLookTimeoutMs`), at once for a world without materials.
   */
  async warmLooks() {
    while (!this.resolveMaterials(performance.now())) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  /** The reach in blocks; 0 switches the layer off and frees its tiles. */
  get distance() {
    return this.options.distance;
  }

  set distance(distance: number) {
    const next = Math.max(0, Math.floor(distance));
    if (next === this.options.distance) return;
    this.options.distance = next;
    if (next === 0) this.clearTiles();
  }

  /** The far reach when the layer is drawing, else 0 (for the fog range). */
  get reach() {
    return this.descriptor && this.options.distance > 0
      ? this.options.distance
      : 0;
  }

  get isActive() {
    return this.reach > 0;
  }

  /**
   * One frame: plan which tiles to draw, ask for the missing ones, ease the
   * detail changes, drop what is no longer wanted, refresh the chunk-coverage
   * mask when chunks changed, and hand new tiles to the mesher.
   *
   * `isChunkPending` says whether a chunk column inside the render radius
   * still owes its terrain (not loaded, or loaded with its mesh still being
   * built at some level; a loaded, meshed chunk with nothing to draw is not
   * pending): the mask covers those within `pendingGuardRadius` of the
   * viewer, so a coarse tile never shows through the walls around it.
   * Further out, a drawn tile over such a column keeps drawing until the
   * chunk lands instead of opening a hole of sky.
   */
  update(
    position: Vector3,
    world: {
      renderRadius: number;
      chunkSize: number;
      loadedGeneration: number;
      forEachMeshedChunk: (callback: (cx: number, cz: number) => void) => void;
      isChunkPending: (cx: number, cz: number) => boolean;
    },
  ) {
    const started = performance.now();
    const elapsed = Number.isFinite(this.lastUpdateAt)
      ? Math.min(250, started - this.lastUpdateAt)
      : 0;
    this.lastUpdateAt = started;
    const descriptor = this.descriptor;
    this.chunkSize = world.chunkSize;
    if (!descriptor || this.options.distance <= 0) {
      this.visible = false;
      this.stats.isActive = false;
      this.stats.rings = 0;
      this.stats.distance = 0;
      this.shared.farSeam.value = 0;
      return;
    }
    this.visible = true;
    this.stats.isActive = true;
    this.stats.distance = this.options.distance;
    this.ringCenter.value.set(position.x, position.z);
    this.shared.farSeam.value = farSeamScale(
      world.chunkSize,
      this.options.seamBand,
    );
    this.landMaterial.uniforms.uRingOuter.value = this.options.distance;
    this.waterMaterial.uniforms.uRingOuter.value = this.options.distance;

    const plan = planFarLod(
      descriptor,
      position.x,
      position.z,
      this.options.distance,
      this.options.lod,
      (key) => this.resident.get(farTileId(key))?.isBuilt === true,
      (key) => this.reliefs.get(farTileId(key)) ?? null,
    );
    this.stats.tilesWanted = plan.wanted.length;
    this.requestTiles([...plan.fallback, ...plan.wanted], started);
    this.applyDrawn(plan.drawn, plan.wanted, plan.fallback, started, elapsed);
    this.updateCoverage(position, world);
    this.updateDepth(position);
    this.updateWater(position, descriptor);
    this.farEdge.value.set(
      this.options.distance * (1 - this.options.edgeBand),
      this.options.distance,
    );
    if (this.resolveMaterials(started)) this.dispatchBuilds();

    this.stats.tilesResident = this.resident.size;
    this.stats.lastUpdateMs = performance.now() - started;
    this.stats.totalUpdateMs += this.stats.lastUpdateMs;
    this.stats.updates += 1;
    this.stats.peakUpdateMs = Math.max(
      this.stats.peakUpdateMs,
      this.stats.lastUpdateMs,
    );
  }

  /** A method reply to hand over; ignored unless it is a far-terrain tile. */
  onMethodReply(name: string, payload: unknown) {
    if (name !== FAR_TERRAIN_METHOD) return;
    const tile = decodeFarTerrainReply(payload);
    if (!tile) {
      this.stats.tilesRejected += 1;
      return;
    }
    const id = farTileId(tile.key);
    this.pending.delete(id);
    this.stats.tilesReceived += 1;
    this.stats.bytesReceived += tile.bytes;
    if (!this.descriptor) return;
    const existing = this.resident.get(id);
    if (existing) this.disposeTile(existing);
    if (this.depthCenter) this.writeDepth(tile);
    this.reliefs.set(id, reliefOf(tile));
    this.resident.set(id, {
      data: tile,
      land: null,
      sky: null,
      isBuilt: false,
      isBuilding: false,
      opacity: 0,
      isDrawn: false,
      lastDrawnAt: performance.now(),
      bytes: 0,
      failedBuilds: 0,
      counts: null,
    });
  }

  /** Requests queued since the last call, for the world to send. */
  takePackets(): MessageProtocol[] {
    if (this.queuedRequests.length === 0) return [];
    const packets = this.queuedRequests;
    this.queuedRequests = [];
    return packets;
  }

  /** Reset the peak and the running mean so a measurement window starts clean. */
  resetPeaks() {
    this.stats.peakUpdateMs = 0;
    this.stats.totalUpdateMs = 0;
    this.stats.updates = 0;
    this.stats.peakBuildMs = 0;
    this.stats.peakUploadMs = 0;
  }

  /** Drop every tile and forget what was asked for. */
  clearTiles() {
    for (const tile of this.resident.values()) this.disposeTile(tile);
    this.resident.clear();
    this.reliefs.clear();
    this.pending.clear();
    this.queuedRequests = [];
    this.epoch += 1;
    this.stats.tilesResident = 0;
    this.stats.tilesDrawn = 0;
    this.stats.meshes = 0;
    this.stats.triangles = 0;
    this.stats.meshBytes = 0;
    this.stats.buildsInFlight = 0;
    this.water.visible = false;
  }

  dispose() {
    this.clearTiles();
    this.landMaterial.dispose();
    this.waterMaterial.dispose();
    this.water.geometry.dispose();
    this.coverageTexture.dispose();
    this.layersTexture.dispose();
    this.materialsTexture.dispose();
    this.depthTexture.dispose();
  }

  private requestTiles(wanted: FarTileKey[], now: number) {
    if (wanted.length === 0) return;
    if (now - this.lastRequestAt < this.options.requestIntervalMs) return;
    const cap = Math.min(
      this.options.maxTilesPerRequest,
      this.budgetAllowance(now),
    );
    if (cap < 1) return;
    const tiles: [number, number, number][] = [];
    for (const key of wanted) {
      const id = farTileId(key);
      if (this.resident.has(id)) continue;
      const askedAt = this.pending.get(id);
      if (askedAt !== undefined && now - askedAt < this.options.retryAfterMs)
        continue;
      tiles.push([key.level, key.tx, key.tz]);
      this.pending.set(id, now);
      if (tiles.length >= cap) break;
    }
    if (tiles.length === 0) return;
    if (this.budgetTokens !== null) this.budgetTokens -= tiles.length;
    this.lastRequestAt = now;
    this.stats.tilesRequested += tiles.length;
    this.queuedRequests.push({
      type: "METHOD",
      method: {
        name: FAR_TERRAIN_METHOD,
        payload: JSON.stringify({ tiles }),
      },
    } as MessageProtocol);
  }

  /**
   * How many tiles a request may name now under the server's budget,
   * refilled by wall time as the server refills its own and kept
   * `budgetHeadroom` short of it; unlimited when the descriptor names none.
   */
  private budgetAllowance(now: number) {
    const budget = this.descriptor?.budget;
    if (!budget || !(budget.tilesPerSecond > 0) || !(budget.burst > 0))
      return Infinity;
    const capacity = Math.max(1, budget.burst - this.options.budgetHeadroom);
    const tokens =
      this.budgetTokens === null
        ? capacity
        : this.budgetTokens +
          ((now - this.budgetRefilledAt) / 1000) * budget.tilesPerSecond;
    this.budgetTokens = Math.min(capacity, tokens);
    this.budgetRefilledAt = now;
    return Math.min(budget.maxTilesPerRequest, Math.floor(this.budgetTokens));
  }

  /**
   * Ease every resident tile toward drawn or hidden, and drop the ones no
   * plan wants that have faded out: least recently drawn first once there
   * are more than `maxResidentTiles`, and any no plan has wanted for a few
   * seconds. Pending asks no plan wants any more are forgotten too.
   */
  private applyDrawn(
    drawn: FarTileKey[],
    wanted: FarTileKey[],
    fallback: FarTileKey[],
    now: number,
    elapsed: number,
  ) {
    const drawnIds = new Set(drawn.map(farTileId));
    const wantedIds = new Set(wanted.map(farTileId));
    const keepIds = new Set([...wantedIds, ...fallback.map(farTileId)]);
    // Every coarser tile over what is drawn or wanted stays: it is the
    // stand-in the plan falls back to when the viewer outruns the finer
    // tiles, and without it the layer opens a hole until a refetch lands.
    const top = (this.descriptor?.levels ?? 1) - 1;
    const ancestors = new Set<string>();
    for (const key of [...drawn, ...wanted]) {
      let { level, tx, tz } = key;
      while (level < top) {
        level += 1;
        tx = Math.floor(tx / 2);
        tz = Math.floor(tz / 2);
        const id = farTileId({ level, tx, tz });
        if (ancestors.has(id)) break;
        ancestors.add(id);
        keepIds.add(id);
      }
    }
    const step = this.options.fadeMs > 0 ? elapsed / this.options.fadeMs : 1;
    const levels = new Map<number, number>();
    let meshes = 0;
    let triangles = 0;
    let bytes = 0;
    const quads: FarMeshCounts = { tops: 0, risers: 0, skirts: 0, crowns: 0 };
    const idle: [string, ResidentTile][] = [];
    const standIns = new Set<string>();
    for (const [id, tile] of this.resident) {
      const isDrawn = drawnIds.has(id);
      if (isDrawn) {
        tile.lastDrawnAt = now;
        levels.set(
          tile.data.key.level,
          (levels.get(tile.data.key.level) ?? 0) + 1,
        );
        if (tile.counts) {
          quads.tops += tile.counts.tops;
          quads.risers += tile.counts.risers;
          quads.skirts += tile.counts.skirts;
          quads.crowns += tile.counts.crowns;
        }
      }
      tile.isDrawn = isDrawn;
      // With nothing of its ground on screen there is nothing to dissolve
      // over (a teleport's end, a tile kept from an earlier visit): it shows
      // whole at once instead of rising out of the sky.
      if (isDrawn && tile.opacity === 0 && !this.isGroundShown(tile.data.key)) {
        tile.opacity = 1;
      }
      tile.opacity = Math.min(
        1,
        Math.max(0, tile.opacity + (isDrawn ? step : -step)),
      );
      // A stand-in keeps standing in while it dissolves out under what
      // replaces it: together the two draw every pixel of their ground.
      if (
        isDrawn ? tile.opacity >= 1 : tile.opacity > 0 && this.standIns.has(id)
      ) {
        standIns.add(id);
      }
      for (const mesh of [tile.land, tile.sky]) {
        if (!mesh) continue;
        mesh.visible = tile.opacity > 0;
        if (mesh.visible) {
          meshes += 1;
          triangles += (mesh.geometry.getIndex()?.count ?? 0) / 3;
        }
      }
      bytes += tile.bytes;
      if (!isDrawn && tile.opacity === 0 && !keepIds.has(id)) {
        idle.push([id, tile]);
      }
    }
    // Idle tiles leave after a short stay, so turning back is free; the
    // oldest leave at once past the cap.
    idle.sort((a, b) => a[1].lastDrawnAt - b[1].lastDrawnAt);
    let excess = this.resident.size - this.options.maxResidentTiles;
    for (const [id, tile] of idle) {
      if (excess <= 0 && now - tile.lastDrawnAt < this.options.evictAfterMs)
        continue;
      this.disposeTile(tile);
      this.resident.delete(id);
      excess -= 1;
    }
    for (const id of Array.from(this.pending.keys())) {
      if (!keepIds.has(id)) this.pending.delete(id);
    }
    if (
      standIns.size !== this.standIns.size ||
      [...standIns].some((id) => !this.standIns.has(id))
    ) {
      this.standIns = standIns;
      this.standInGeneration += 1;
    }
    this.stats.tilesDrawn = drawnIds.size;
    this.stats.meshes = meshes;
    this.stats.triangles = triangles;
    this.stats.meshBytes = bytes;
    this.stats.quads = quads;
    this.stats.rings = levels.size;
    const counts: number[] = [];
    for (let level = 0; level < (this.descriptor?.levels ?? 0); level++) {
      counts.push(levels.get(level) ?? 0);
    }
    this.stats.levelCounts = counts;
  }

  /**
   * Whether the materials are on the GPU, reading the faces the
   * descriptor's materials name off the atlas, as many a frame as the build
   * budget allows (at least one). Tiles wait for it: a tile built before
   * would wear placeholder colours. A face still unreadable after
   * `faceLookTimeoutMs` is painted grey, and the layer says which.
   */
  private resolveMaterials(started: number): boolean {
    if (this.materialTable) return true;
    const materials = this.descriptor?.materials;
    const faceLook = this.options.faceLook;
    if (!materials?.length || !faceLook) {
      const table = farPaletteTable(this.palette, this.skyTop, this.skySide);
      this.installMaterials(table, table.classes - 1);
      return true;
    }
    let pending = 0;
    let read = 0;
    const trees = this.descriptor?.trees ?? [];
    for (const [block, side] of farMaterialFaces(materials, trees)) {
      const key = `${block}:${side}`;
      if (this.faceLooks.has(key)) continue;
      if (
        read > 0 &&
        performance.now() - started > this.options.buildBudgetMs
      ) {
        pending += 1;
        continue;
      }
      const readAt = performance.now();
      const look = faceLook(block, side);
      read += 1;
      this.stats.faceLookMs += performance.now() - readAt;
      if (look) {
        this.faceLooks.set(key, look);
        this.faceWaitingSince.delete(key);
        continue;
      }
      const since = this.faceWaitingSince.get(key) ?? started;
      this.faceWaitingSince.set(key, since);
      if (started - since < this.options.faceLookTimeoutMs) {
        pending += 1;
        continue;
      }
      console.warn(
        `[far-terrain] block ${block}'s ${side} face never became readable in ${this.options.faceLookTimeoutMs} ms; the far layer paints it grey`,
      );
      this.faceLooks.set(key, GREY_LOOK);
      this.stats.facesMissing += 1;
    }
    this.stats.facesResolved = this.faceLooks.size;
    this.stats.facesPending = pending;
    if (pending > 0) return false;
    const table = buildFarMaterialTable(
      materials,
      (block, side) => this.faceLooks.get(`${block}:${side}`) ?? GREY_LOOK,
      trees,
    );
    const seabed = this.descriptor?.seabedMaterial;
    if (seabed !== undefined && materials[seabed]) {
      const look = this.faceLooks.get(`${materials[seabed].top}:top`);
      if (look) this.seabedColor.value.setRGB(...look.color);
    }
    const sky = this.descriptor?.skyMaterial;
    this.installMaterials(
      table,
      sky !== undefined && sky >= 0 && sky < table.classes ? sky : null,
    );
    return true;
  }

  private skyClass = 0;

  private installMaterials(table: FarMaterialTable, skyClass: number | null) {
    const previous = this.materialTable;
    const sameClasses =
      previous !== null &&
      previous.treeClass === table.treeClass &&
      this.skyClass === (skyClass ?? 0);
    this.materialTable = table;
    this.layersTexture.dispose();
    const layers = new DataArrayTexture(
      table.layers,
      FAR_LAYER_SIZE,
      FAR_LAYER_SIZE,
      table.layerCount,
    );
    layers.format = RGBAFormat;
    layers.type = UnsignedByteType;
    layers.colorSpace = SRGBColorSpace;
    layers.wrapS = RepeatWrapping;
    layers.wrapT = RepeatWrapping;
    layers.magFilter = NearestFilter;
    layers.minFilter = LinearMipmapLinearFilter;
    layers.generateMipmaps = true;
    layers.anisotropy = 8;
    layers.needsUpdate = true;
    this.layersTexture = layers;
    this.landMaterial.uniforms.uFarLayers.value = layers;

    this.materialsTexture.dispose();
    const rows = new DataTexture(
      table.table,
      FAR_MATERIAL_TEXELS,
      table.classes,
      RGBAFormat,
      FloatType,
    );
    rows.magFilter = NearestFilter;
    rows.minFilter = NearestFilter;
    rows.needsUpdate = true;
    this.materialsTexture = rows;
    this.landMaterial.uniforms.uFarMaterials.value = rows;

    this.skyClass = skyClass ?? 0;
    // Faces paint from the table at draw time; tiles bake only class
    // indices, so they rebuild only when those move.
    if (sameClasses) return;
    for (const tile of this.resident.values()) {
      tile.isBuilt = false;
      tile.isBuilding = false;
    }
  }

  /** Hand unbuilt tiles to the mesher, nearest drawn-or-wanted first. */
  private dispatchBuilds() {
    const table = this.materialTable;
    if (!table) return;
    const build = this.options.buildMesh ?? workerBuild;
    const center = this.ringCenter.value;
    const queue = Array.from(this.resident.values())
      .filter(
        (tile) =>
          !tile.isBuilt &&
          !tile.isBuilding &&
          tile.failedBuilds < MAX_BUILD_ATTEMPTS,
      )
      .sort(
        (a, b) => this.tileDistance(a, center) - this.tileDistance(b, center),
      );
    for (const tile of queue) {
      if (this.stats.buildsInFlight >= this.options.maxBuildsInFlight) break;
      const { data } = tile;
      const span = (data.size - 1) * data.step;
      const input: FarMeshInput = {
        originX: data.key.tx * span,
        originZ: data.key.tz * span,
        step: data.step,
        size: data.size,
        heights: data.heights,
        classes: data.colors,
        tints: data.tints,
        sky: data.sky,
        canopy: data.canopy,
        classCount: table.treeClass,
        treeClass: table.treeClass,
        skyClass: this.skyClass,
        waterSurface: this.descriptor?.waterSurface ?? null,
      };
      tile.isBuilding = true;
      this.stats.buildsInFlight += 1;
      const epoch = this.epoch;
      build(input).then((built) => {
        if (epoch !== this.epoch) return;
        this.stats.buildsInFlight = Math.max(0, this.stats.buildsInFlight - 1);
        const id = farTileId(data.key);
        if (this.resident.get(id) !== tile) return;
        tile.isBuilding = false;
        if (!built) {
          tile.failedBuilds += 1;
          if (tile.failedBuilds >= MAX_BUILD_ATTEMPTS) {
            console.error(
              `[far-terrain] tile ${id} failed to build ${tile.failedBuilds} times; its coarser tile stands in for it`,
            );
          } else {
            console.warn(
              `[far-terrain] tile ${id} failed to build; trying again`,
            );
          }
          return;
        }
        this.installTile(tile, built, input.originX, input.originZ, span);
      });
    }
  }

  private tileDistance(tile: ResidentTile, center: Vector2) {
    const { key, size, step } = tile.data;
    const span = (size - 1) * step;
    const cx = key.tx * span + span / 2;
    const cz = key.tz * span + span / 2;
    return Math.hypot(cx - center.x, cz - center.y);
  }

  private installTile(
    tile: ResidentTile,
    built: FarBuiltTile,
    originX: number,
    originZ: number,
    span: number,
  ) {
    const started = performance.now();
    for (const mesh of [tile.land, tile.sky]) {
      if (!mesh) continue;
      this.remove(mesh);
      mesh.geometry.dispose();
    }
    tile.bytes = 0;
    const name = farTileId(tile.data.key);
    tile.land = built.land
      ? this.meshFrom(built.land, originX, originZ, span, tile)
      : null;
    tile.sky = built.sky
      ? this.meshFrom(built.sky, originX, originZ, span, tile)
      : null;
    if (tile.land) {
      tile.land.name = `far-terrain-${name}`;
      this.add(tile.land);
    }
    if (tile.sky) {
      tile.sky.name = `far-terrain-sky-${name}`;
      this.add(tile.sky);
    }
    tile.counts = built.land?.counts ?? null;
    tile.isBuilt = true;
    this.stats.tilesBuilt += 1;
    this.stats.lastBuildMs = built.buildMs;
    this.stats.peakBuildMs = Math.max(this.stats.peakBuildMs, built.buildMs);
    this.stats.lastUploadMs = performance.now() - started;
    this.stats.peakUploadMs = Math.max(
      this.stats.peakUploadMs,
      this.stats.lastUploadMs,
    );
  }

  private meshFrom(
    data: FarMeshData,
    originX: number,
    originZ: number,
    span: number,
    tile: ResidentTile,
  ) {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Int16BufferAttribute(data.position, 3),
    );
    geometry.setAttribute(
      "aFarColumn",
      new Int16BufferAttribute(data.column, 2),
    );
    geometry.setAttribute(
      "aFarMaterial",
      new Uint8BufferAttribute(data.material, 4),
    );
    geometry.setAttribute("aFarTint", new Uint8BufferAttribute(data.tint, 4));
    geometry.setIndex(new BufferAttribute(data.index, 1));
    // Local bounds from the tile's own extent: cheaper than a pass over the
    // vertices, and the frustum test only needs them conservative.
    geometry.boundingBox = new Box3(
      new Vector3(0, data.minY, 0),
      new Vector3(span, data.maxY, span),
    );
    geometry.boundingSphere = new Sphere();
    geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);
    const mesh = new Mesh(geometry, this.landMaterial);
    // Far tiles stay out of the shadow cascades: they lie past the cascades'
    // reach, and each would otherwise cost a draw per cascade.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.position.set(originX, 0, originZ);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.visible = false;
    const fade = this.farFade;
    const material = this.landMaterial;
    mesh.onBeforeRender = () => {
      fade.value.set(tile.opacity, tile.isDrawn ? 1 : -1);
      material.uniformsNeedUpdate = true;
    };
    tile.bytes +=
      data.position.byteLength +
      data.column.byteLength +
      data.material.byteLength +
      data.tint.byteLength +
      data.index.byteLength;
    return mesh;
  }

  private updateCoverage(
    position: Vector3,
    world: {
      renderRadius: number;
      chunkSize: number;
      loadedGeneration: number;
      forEachMeshedChunk: (callback: (cx: number, cz: number) => void) => void;
      isChunkPending: (cx: number, cz: number) => boolean;
    },
  ) {
    const cx = Math.floor(position.x / world.chunkSize);
    const cz = Math.floor(position.z / world.chunkSize);
    const originCx = cx - COVERAGE_SIZE / 2;
    const originCz = cz - COVERAGE_SIZE / 2;
    const centerMoved =
      !this.coverageCenter ||
      this.coverageCenter[0] !== cx ||
      this.coverageCenter[1] !== cz;
    // Pending columns change when a chunk loads (the generation), when
    // the radius they are counted within does, and, while any are still
    // counted, as their grace runs out or the tiles fit to stand in for
    // them change.
    const now = performance.now();
    const isRecheckDue =
      this.stats.pendingCovered > 0 &&
      now - this.coverageBuiltAt >= PENDING_RECHECK_MS;
    const isStandInStale =
      this.coverageStandIns !== this.standInGeneration &&
      this.stats.pendingCovered + this.stats.pendingStoodIn > 0;
    if (
      !centerMoved &&
      this.coverageGeneration === world.loadedGeneration &&
      this.coverageRadius === world.renderRadius &&
      !isRecheckDue &&
      !isStandInStale
    )
      return;
    this.coverageBuiltAt = now;
    this.coverageCenter = [cx, cz];
    this.coverageGeneration = world.loadedGeneration;
    this.coverageRadius = world.renderRadius;
    this.coverageStandIns = this.standInGeneration;
    const covered: [number, number][] = [];
    let stoodIn = 0;
    for (const column of pendingChunksWithin(
      cx,
      cz,
      world.renderRadius,
      world.isChunkPending,
    )) {
      if (
        !this.isGuarded(column[0], column[1]) &&
        this.isStoodIn(column[0], column[1], world.chunkSize)
      )
        stoodIn += 1;
      else covered.push(column);
    }
    this.stats.pendingCovered = covered.length;
    this.stats.pendingStoodIn = stoodIn;
    world.forEachMeshedChunk((x, z) => covered.push([x, z]));
    buildCoverageMask(
      covered,
      originCx,
      originCz,
      COVERAGE_SIZE,
      this.coverage,
    );
    this.shared.farCover.value.set(
      originCx,
      originCz,
      world.chunkSize,
      COVERAGE_SIZE,
    );
    this.coverageTexture.needsUpdate = true;
    this.stats.maskRebuilds += 1;
  }

  /**
   * Whether the layer draws the whole of a chunk column, as it does over a
   * column still on its way outside the guard radius. A chunk landing
   * there replaces terrain already on screen, so a host can land it as
   * itself rather than reveal it out of the fog, which would flash over
   * that terrain.
   */
  drawsColumn(cx: number, cz: number) {
    return (
      this.visible &&
      !this.isGuarded(cx, cz) &&
      this.isStoodIn(cx, cz, this.chunkSize)
    );
  }

  /** Whether a coarser or finer tile over the same ground is on screen. */
  private isGroundShown(key: FarTileKey) {
    const isShown = (level: number, tx: number, tz: number) =>
      (this.resident.get(farTileId({ level, tx, tz }))?.opacity ?? 0) > 0;
    const top = (this.descriptor?.levels ?? 1) - 1;
    let { tx, tz } = key;
    for (let level = key.level + 1; level <= top; level++) {
      tx = Math.floor(tx / 2);
      tz = Math.floor(tz / 2);
      if (isShown(level, tx, tz)) return true;
    }
    let span = 1;
    for (let level = key.level - 1; level >= 0; level--) {
      span *= 2;
      for (let i = 0; i < span; i++) {
        for (let j = 0; j < span; j++) {
          if (isShown(level, key.tx * span + i, key.tz * span + j)) return true;
        }
      }
    }
    return false;
  }

  /** Whether a column lies within `pendingGuardRadius` of the viewer's. */
  private isGuarded(cx: number, cz: number) {
    const center = this.coverageCenter;
    if (!center) return true;
    const dx = cx - center[0];
    const dz = cz - center[1];
    const radius = this.options.pendingGuardRadius;
    return dx * dx + dz * dz < radius * radius;
  }

  /**
   * Whether tiles in `standIns` draw the whole of a chunk column: asked at
   * both edges of the column and at every finest tile between, since the
   * drawn tiles cover each square once but need not line up with chunks.
   */
  private isStoodIn(cx: number, cz: number, chunkSize: number) {
    const descriptor = this.descriptor;
    if (!descriptor || this.standIns.size === 0) return false;
    const step = Math.min(chunkSize, farTileSpan(descriptor, 0));
    const offsets: number[] = [];
    for (let offset = 0.5; offset < chunkSize - 0.5; offset += step) {
      offsets.push(offset);
    }
    offsets.push(chunkSize - 0.5);
    for (const ox of offsets) {
      for (const oz of offsets) {
        const x = cx * chunkSize + ox;
        const z = cz * chunkSize + oz;
        let isDrawn = false;
        for (let level = 0; level < descriptor.levels && !isDrawn; level++) {
          const span = farTileSpan(descriptor, level);
          isDrawn = this.standIns.has(
            farTileId({
              level,
              tx: Math.floor(x / span),
              tz: Math.floor(z / span),
            }),
          );
        }
        if (!isDrawn) return false;
      }
    }
    return true;
  }

  /**
   * Lay the sea-depth map out around the viewer again once it has drifted
   * far enough from its centre, from every resident tile, coarse first so
   * the finer ones land on top.
   */
  private updateDepth(position: Vector3) {
    const center = this.depthCenter;
    if (
      center &&
      Math.abs(position.x - center[0]) < DEPTH_RECENTER &&
      Math.abs(position.z - center[1]) < DEPTH_RECENTER
    )
      return;
    const half = (DEPTH_TEXELS * DEPTH_BLOCKS_PER_TEXEL) / 2;
    const originX =
      Math.floor((position.x - half) / DEPTH_BLOCKS_PER_TEXEL) *
      DEPTH_BLOCKS_PER_TEXEL;
    const originZ =
      Math.floor((position.z - half) / DEPTH_BLOCKS_PER_TEXEL) *
      DEPTH_BLOCKS_PER_TEXEL;
    this.depthCenter = [position.x, position.z];
    this.depthWindow.value.set(
      originX,
      originZ,
      DEPTH_BLOCKS_PER_TEXEL,
      DEPTH_TEXELS,
    );
    this.depth.fill(255);
    this.depthLevel.fill(255);
    for (const tile of this.resident.values()) this.writeDepth(tile.data);
  }

  /** A tile's sea depths into the map, over each sample's own cell. */
  private writeDepth(tile: FarTileData) {
    const surface = this.descriptor?.waterSurface;
    if (surface === undefined) return;
    const { x: originX, y: originZ } = this.depthWindow.value;
    const span = (tile.size - 1) * tile.step;
    const tileX = tile.key.tx * span;
    const tileZ = tile.key.tz * span;
    const per = DEPTH_BLOCKS_PER_TEXEL;
    let touched = false;
    for (let j = 0; j < tile.size - 1; j++) {
      const z = tileZ + j * tile.step;
      const tz0 = Math.max(0, Math.floor((z - originZ) / per));
      const tz1 = Math.min(
        DEPTH_TEXELS,
        Math.ceil((z + tile.step - originZ) / per),
      );
      if (tz0 >= tz1) continue;
      for (let i = 0; i < tile.size - 1; i++) {
        const x = tileX + i * tile.step;
        const tx0 = Math.max(0, Math.floor((x - originX) / per));
        const tx1 = Math.min(
          DEPTH_TEXELS,
          Math.ceil((x + tile.step - originX) / per),
        );
        if (tx0 >= tx1) continue;
        const height = tile.heights[j * tile.size + i];
        const value = Math.round(
          Math.min(1, Math.max(0, (surface - height) / DEPTH_RANGE)) * 255,
        );
        for (let tz = tz0; tz < tz1; tz++) {
          for (let tx = tx0; tx < tx1; tx++) {
            const at = tz * DEPTH_TEXELS + tx;
            if (this.depthLevel[at] < tile.key.level) continue;
            this.depth[at] = value;
            this.depthLevel[at] = tile.key.level;
            touched = true;
          }
        }
      }
    }
    if (touched) this.depthTexture.needsUpdate = true;
  }

  private updateWater(position: Vector3, descriptor: FarTerrainDescriptor) {
    const span =
      (this.options.distance + farTileSpan(descriptor, descriptor.levels - 1)) *
      2;
    if (span !== this.waterSpan) {
      this.water.geometry.dispose();
      this.water.geometry = new PlaneGeometry(span, span);
      this.waterSpan = span;
    }
    this.water.position.set(position.x, descriptor.waterSurface, position.z);
    this.water.visible = true;
  }

  private disposeTile(tile: ResidentTile) {
    for (const mesh of [tile.land, tile.sky]) {
      if (!mesh) continue;
      this.remove(mesh);
      mesh.geometry.dispose();
    }
    tile.land = null;
    tile.sky = null;
    tile.isBuilt = false;
    tile.isBuilding = false;
    tile.bytes = 0;
  }
}

const GREY_LOOK: FarFaceLook = { color: [0.5, 0.5, 0.5], isTinted: false };

/** How often one tile's build may fail before it is given up on. */
const MAX_BUILD_ATTEMPTS = 3;

function colorTriple(color: Color | string | number): [number, number, number] {
  const c = new Color(color);
  return [c.r, c.g, c.b];
}
