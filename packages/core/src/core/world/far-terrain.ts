import { MessageProtocol } from "@voxelize/protocol";
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  RedFormat,
  ShaderMaterial,
  Sphere,
  Texture,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
} from "three";

import {
  FAR_SEAM_FUNCTIONS,
  FAR_SEAM_UNIFORM_DECLARATIONS,
  farSeamScale,
} from "./far-terrain-seam";
import {
  buildCoverageMask,
  buildFarLandArrays,
  buildFarSkyArrays,
  decodeFarTerrainReply,
  FarRing,
  farTerrainRings,
  FarTerrainDescriptor,
  farTileBounds,
  FarTileBounds,
  FarTileData,
  farTileId,
  FarTileKey,
  farTileSpan,
  farTilesToEvict,
  pendingChunksWithin,
  selectFarTiles,
} from "./far-terrain-tiles";
import { createSkyFogFragment, SKY_FOG_UNIFORM_DECLARATIONS } from "./sky-fog";

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
   * The chunk shader's side of the seam, written here: the coverage mask,
   * its placement `(originCx, originCz, chunkSize, texels)` and the seam
   * band's ramp scale (0 while the layer is off).
   */
  farCoverMask: ShaderUniform<Texture | null>;
  farCover: ShaderUniform<Vector4>;
  farSeam: ShaderUniform<number>;
};

export type FarTerrainOptions = {
  /**
   * How far past the viewer the layer reaches, in blocks; 0 turns it off.
   */
  distance: number;
  /**
   * RGB in 0..1 per colour class the server's sampler emits, flattened. A
   * class past the end takes the last entry; an empty palette draws grey.
   */
  palette: ArrayLike<number>;
  /** The far water plane's colour. */
  waterColor: Color | string | number;
  /** Colour of floating land's top and of its underside and walls. */
  skyTopColor: Color | string | number;
  skySideColor: Color | string | number;
  /** Tiles one request may name; the server caps it too. */
  maxTilesPerRequest: number;
  /** Least time between two requests. */
  requestIntervalMs: number;
  /** A requested tile that has not arrived in this long is asked again. */
  retryAfterMs: number;
  /** Main-thread time one update may spend building tile meshes. */
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
  waterColor: "#2d6a9a",
  skyTopColor: "#6f9d4e",
  skySideColor: "#6e665c",
  maxTilesPerRequest: 16,
  requestIntervalMs: 120,
  retryAfterMs: 6000,
  buildBudgetMs: 0.6,
  seamBand: 8,
};

/** Counters a harness can read to prove the budget. */
export type FarTerrainStats = {
  isActive: boolean;
  distance: number;
  rings: number;
  tilesRequested: number;
  tilesReceived: number;
  tilesRejected: number;
  bytesReceived: number;
  tilesBuilt: number;
  tilesResident: number;
  /** Tile meshes (land + sky) in the scene; each is one draw call when in view. */
  meshes: number;
  /** Main-thread ms the last update spent (requests, mask, builds). */
  lastUpdateMs: number;
  /** Highest `lastUpdateMs` since the counters were last read. */
  peakUpdateMs: number;
  /** Main-thread ms spent across every update, and how many there were. */
  totalUpdateMs: number;
  updates: number;
  /** Mask rebuilds. */
  maskRebuilds: number;
  /** Chunk columns inside the render radius the last mask covered because
   * they were still on their way (not loaded yet): many right after
   * arriving somewhere, 0 once everything inside has landed. */
  pendingCovered: number;
  /** Triangles across every built tile mesh in the scene. */
  triangles: number;
  /** Main-thread ms the last tile mesh took to build, and the highest since the peaks were reset. */
  lastBuildMs: number;
  peakBuildMs: number;
};

const VERTEX_SHADER = `
attribute vec3 aFarColor;
varying vec3 vWorldPosition;
varying vec3 vFarColor;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vFarColor = aFarColor;
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
 * The shared fragment body: hide under meshed chunks and outside the ring,
 * light a flat face the way the chunk shader lights an unshadowed, fully
 * sunlit face (wrapped N.L, hemisphere ambient, per-axis face shade, the
 * same tone map), then the same sky fog the chunks wear.
 */
const fragmentShader = (colorExpression: string, isWater: boolean) => `
${SKY_FOG_UNIFORM_DECLARATIONS}
uniform vec3 uAmbientColor;
uniform float uMinLightLevel;
uniform float uBaseAmbient;
uniform vec4 uFaceShades;
uniform float uRingInner;
uniform float uRingOuter;
uniform vec2 uRingCenter;
${FAR_SEAM_UNIFORM_DECLARATIONS}
${isWater ? "uniform vec3 uWaterColor;" : "varying vec3 vFarColor;"}
varying vec3 vWorldPosition;
${FAR_SEAM_FUNCTIONS}

void main() {
  // Hidden under every chunk that draws real terrain, except the pixels the
  // chunk's outer half yields across the seam band (far-terrain-seam).
  vec2 farTexel = farCoverTexel(vWorldPosition.xz);
  if (farCoverInside(farTexel) && farCoverHard(farTexel) > 0.5) {
    if (uFarSeam <= 0.0 || farSeamWeight(farTexel) > farSeamDither(gl_FragCoord.xy)) discard;
  }
  // Rings are measured from where the tiles were picked around (the
  // viewer's position), not from the camera, which a third-person or an
  // orthographic view puts far from it.
  float horizontal = length(vWorldPosition.xz - uRingCenter);
  if (horizontal < uRingInner || horizontal >= uRingOuter) discard;

  ${
    isWater
      ? "vec3 normal = vec3(0.0, 1.0, 0.0);"
      : `vec3 normal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
  if (dot(normal, cameraPosition - vWorldPosition) < 0.0) normal = -normal;`
  }

  float NdotL = max(dot(normal, uSunDirection) * 0.85 + 0.15, 0.0);
  vec3 sun = uSunColor * NdotL * uSunlightIntensity;
  float hemisphere = normal.y * 0.5 + 0.5;
  vec3 skyAmbient = mix(uAmbientColor * 0.4, uAmbientColor, hemisphere);
  float ambientFloor = max(uMinLightLevel + uBaseAmbient, 0.0);
  vec3 globalAmbient = vec3(0.025, 0.03, 0.04) + uAmbientColor * ambientFloor;
  vec3 weights = abs(normal);
  weights /= max(weights.x + weights.y + weights.z, 0.0001);
  float verticalShade = normal.y > 0.0 ? uFaceShades.w : uFaceShades.z;
  float faceShade = weights.x * uFaceShades.x + weights.z * uFaceShades.y + weights.y * verticalShade;
  vec3 light = (skyAmbient + sun + globalAmbient) * faceShade;
  light = (light * (2.51 * light + 0.03)) / (light * (2.43 * light + 0.59) + 0.14);
  light = max(light, vec3(ambientFloor) * faceShade);

  gl_FragColor = vec4(${colorExpression} * light, 1.0);
  ${createSkyFogFragment()}
}
`;

type ResidentTile = {
  data: FarTileData;
  land: Mesh | null;
  sky: Mesh | null;
  isBuilt: boolean;
};

/**
 * Coarse terrain past the loaded chunks: a few detail rings of vertex
 * coloured heightfield tiles the server samples from its generator, lit by
 * the sun and fogged with the chunk shader's atmosphere, hidden wherever a
 * chunk draws real terrain, with a flat water plane at sea level. The
 * `World` owns one, feeds it the server's descriptor from the INIT options,
 * drives `update` once a frame, hands it method replies and sends the
 * requests it queues.
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
    meshes: 0,
    lastUpdateMs: 0,
    peakUpdateMs: 0,
    totalUpdateMs: 0,
    updates: 0,
    maskRebuilds: 0,
    pendingCovered: 0,
    triangles: 0,
    lastBuildMs: 0,
    peakBuildMs: 0,
  };

  private resident = new Map<string, ResidentTile>();

  private pending = new Map<string, number>();

  private queuedRequests: MessageProtocol[] = [];

  private lastRequestAt = -Infinity;

  private palette: Float32Array;

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

  private rings: FarRing[] = [];

  private ringUniforms: {
    inner: ShaderUniform<number>;
    outer: ShaderUniform<number>;
  }[] = [];

  private ringMaterials: ShaderMaterial[] = [];

  private skyTop: [number, number, number];

  private skySide: [number, number, number];

  private chunkSize = 16;

  /** Horizontal centre the rings are cut around, shared by every material. */
  private ringCenter: ShaderUniform<Vector2> = { value: new Vector2() };

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
      uAmbientColor: shared.ambientColor,
      uMinLightLevel: shared.minLightLevel,
      uBaseAmbient: shared.baseAmbient,
      uFaceShades: shared.faceShades,
      uFarCoverMask: shared.farCoverMask,
      uFarCover: shared.farCover,
      uFarSeam: shared.farSeam,
      uRingInner: { value: 0 },
      uRingOuter: { value: 0 },
      uRingCenter: this.ringCenter,
    });

    this.landMaterial = new ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: fragmentShader("vFarColor", false),
      uniforms: common(),
      side: DoubleSide,
    });
    this.waterMaterial = new ShaderMaterial({
      vertexShader: WATER_VERTEX_SHADER,
      fragmentShader: fragmentShader("uWaterColor", true),
      uniforms: {
        ...common(),
        uWaterColor: { value: new Color(this.options.waterColor) },
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
    this.clearTiles();
  }

  /**
   * Replaces the colour of every class (linear RGB, flattened); tiles built
   * from here on use it. A source whose classes are discovered as tiles
   * arrive (block ids, say) grows its palette before handing each tile in.
   */
  setPalette(palette: ArrayLike<number>) {
    this.palette = Float32Array.from(palette);
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
   * One frame: pick the rings for the viewer, ask for missing tiles, drop
   * tiles out of reach, refresh the chunk-coverage mask when chunks changed,
   * and build a tile mesh or two within the budget.
   *
   * `isChunkPending` says whether a chunk column inside the render radius
   * still owes its terrain (not loaded, or loaded with its mesh still being
   * built; a loaded, meshed chunk with nothing to draw is not pending): the
   * mask covers those too, so the far layer never shows through a hole that
   * real terrain is about to fill.
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

    const renderDistance = world.renderRadius * world.chunkSize;
    this.rings = farTerrainRings(
      descriptor,
      renderDistance,
      this.options.distance,
    );
    this.stats.rings = this.rings.length;
    this.syncRingMaterials();

    const needed = new Set<string>();
    const wanted: FarTileKey[] = [];
    for (const ring of this.rings) {
      const span = farTileSpan(descriptor, ring.level);
      for (const key of selectFarTiles(
        position.x,
        position.z,
        ring,
        span,
        span / 4,
      )) {
        const id = farTileId(key);
        needed.add(id);
        if (!this.resident.has(id)) wanted.push(key);
      }
    }

    this.requestTiles(wanted, started);
    this.evictTiles(needed, position);
    this.updateCoverage(position, world);
    this.updateWater(position, descriptor);
    this.buildTiles(started);

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
    this.resident.set(id, {
      data: tile,
      land: null,
      sky: null,
      isBuilt: false,
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
  }

  /** Drop every tile and forget what was asked for. */
  clearTiles() {
    for (const tile of this.resident.values()) this.disposeTile(tile);
    this.resident.clear();
    this.pending.clear();
    this.queuedRequests = [];
    this.stats.tilesResident = 0;
    this.stats.meshes = 0;
    this.stats.triangles = 0;
    this.water.visible = false;
  }

  dispose() {
    this.clearTiles();
    this.landMaterial.dispose();
    this.waterMaterial.dispose();
    for (const material of this.ringMaterials) material.dispose();
    this.water.geometry.dispose();
    this.coverageTexture.dispose();
  }

  private requestTiles(wanted: FarTileKey[], now: number) {
    if (wanted.length === 0) return;
    if (now - this.lastRequestAt < this.options.requestIntervalMs) return;
    const tiles: [number, number, number][] = [];
    for (const key of wanted) {
      const id = farTileId(key);
      const askedAt = this.pending.get(id);
      if (askedAt !== undefined && now - askedAt < this.options.retryAfterMs)
        continue;
      tiles.push([key.level, key.tx, key.tz]);
      this.pending.set(id, now);
      if (tiles.length >= this.options.maxTilesPerRequest) break;
    }
    if (tiles.length === 0) return;
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

  private evictTiles(needed: ReadonlySet<string>, position: Vector3) {
    const descriptor = this.descriptor;
    if (!descriptor) return;
    const keys = Array.from(this.resident.values(), (tile) => tile.data.key);
    const gone = farTilesToEvict(
      keys,
      needed,
      position.x,
      position.z,
      this.rings,
      (level) => farTileSpan(descriptor, level),
    );
    for (const key of gone) {
      const id = farTileId(key);
      const tile = this.resident.get(id);
      if (tile) this.disposeTile(tile);
      this.resident.delete(id);
      this.pending.delete(id);
    }
    // Pending asks for tiles no ring wants any more are forgotten too, so a
    // late reply does not pin them.
    for (const id of Array.from(this.pending.keys())) {
      if (!needed.has(id)) this.pending.delete(id);
    }
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
    // counted, as their grace runs out.
    const now = performance.now();
    const isRecheckDue =
      this.stats.pendingCovered > 0 &&
      now - this.coverageBuiltAt >= PENDING_RECHECK_MS;
    if (
      !centerMoved &&
      this.coverageGeneration === world.loadedGeneration &&
      this.coverageRadius === world.renderRadius &&
      !isRecheckDue
    )
      return;
    this.coverageBuiltAt = now;
    this.coverageCenter = [cx, cz];
    this.coverageGeneration = world.loadedGeneration;
    this.coverageRadius = world.renderRadius;
    const covered: [number, number][] = pendingChunksWithin(
      cx,
      cz,
      world.renderRadius,
      world.isChunkPending,
    );
    this.stats.pendingCovered = covered.length;
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

  private updateWater(position: Vector3, descriptor: FarTerrainDescriptor) {
    const span = (this.options.distance + farTileSpan(descriptor, 0)) * 2;
    if (span !== this.waterSpan) {
      this.water.geometry.dispose();
      this.water.geometry = new PlaneGeometry(span, span);
      this.waterSpan = span;
    }
    this.water.position.set(position.x, descriptor.waterSurface, position.z);
    this.water.visible = true;
    const outer = this.rings.length
      ? this.rings[this.rings.length - 1].outer
      : 0;
    this.waterMaterial.uniforms.uRingInner.value = 0;
    this.waterMaterial.uniforms.uRingOuter.value = outer;
  }

  /** One material per ring so each cuts at its own radii. */
  private syncRingMaterials() {
    while (this.ringMaterials.length < this.rings.length) {
      const material = this.landMaterial.clone();
      material.uniforms = { ...this.landMaterial.uniforms };
      material.uniforms.uRingInner = { value: 0 };
      material.uniforms.uRingOuter = { value: 0 };
      this.ringMaterials.push(material);
      this.ringUniforms.push({
        inner: material.uniforms.uRingInner,
        outer: material.uniforms.uRingOuter,
      });
    }
    this.rings.forEach((ring, index) => {
      this.ringUniforms[index].inner.value = ring.inner;
      this.ringUniforms[index].outer.value = ring.outer;
    });
  }

  private buildTiles(started: number) {
    let built = 0;
    for (const tile of this.resident.values()) {
      if (tile.isBuilt) continue;
      // At least one tile a frame, then as many as the budget allows.
      if (built > 0 && performance.now() - started > this.options.buildBudgetMs)
        break;
      this.buildTile(tile);
      built += 1;
    }
  }

  private buildTile(tile: ResidentTile) {
    const started = performance.now();
    const ringIndex = this.rings.findIndex(
      (ring) => ring.level === tile.data.key.level,
    );
    const material =
      this.ringMaterials[ringIndex >= 0 ? ringIndex : 0] ?? this.landMaterial;
    const bounds = farTileBounds(tile.data);
    const land = buildFarLandArrays(tile.data, this.palette);
    tile.land = this.meshFrom(
      land.positions,
      land.colors,
      land.indices,
      material,
      bounds,
    );
    tile.land.name = `far-terrain-${farTileId(tile.data.key)}`;
    this.add(tile.land);
    this.stats.triangles += land.indices.length / 3;
    const sky = buildFarSkyArrays(tile.data, this.skyTop, this.skySide);
    if (sky) {
      tile.sky = this.meshFrom(
        sky.positions,
        sky.colors,
        sky.indices,
        material,
        bounds,
      );
      tile.sky.name = `far-terrain-sky-${farTileId(tile.data.key)}`;
      this.add(tile.sky);
      this.stats.triangles += sky.indices.length / 3;
    }
    tile.isBuilt = true;
    this.stats.tilesBuilt += 1;
    this.stats.meshes += sky ? 2 : 1;
    this.stats.lastBuildMs = performance.now() - started;
    this.stats.peakBuildMs = Math.max(
      this.stats.peakBuildMs,
      this.stats.lastBuildMs,
    );
  }

  private meshFrom(
    positions: Float32Array,
    colors: Float32Array,
    indices: Uint32Array,
    material: ShaderMaterial,
    bounds: FarTileBounds,
  ) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("aFarColor", new BufferAttribute(colors, 3));
    geometry.setIndex(new BufferAttribute(indices, 1));
    // The bounds from the tile's own extent: cheaper than a pass over the
    // vertices, and the frustum test only needs them conservative.
    geometry.boundingBox = new Box3(
      new Vector3(bounds.x0, bounds.y0, bounds.z0),
      new Vector3(bounds.x1, bounds.y1, bounds.z1),
    );
    geometry.boundingSphere = new Sphere();
    geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);
    const mesh = new Mesh(geometry, material);
    // Far tiles stay out of the shadow cascades: they lie past the cascades'
    // reach, and each would otherwise cost a draw per cascade.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }

  private disposeTile(tile: ResidentTile) {
    for (const mesh of [tile.land, tile.sky]) {
      if (!mesh) continue;
      this.remove(mesh);
      const index = mesh.geometry.getIndex();
      if (index) {
        this.stats.triangles = Math.max(
          0,
          this.stats.triangles - index.count / 3,
        );
      }
      mesh.geometry.dispose();
      this.stats.meshes = Math.max(0, this.stats.meshes - 1);
    }
    tile.land = null;
    tile.sky = null;
    tile.isBuilt = false;
  }
}

function colorTriple(color: Color | string | number): [number, number, number] {
  const c = new Color(color);
  return [c.r, c.g, c.b];
}
