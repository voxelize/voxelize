import {
  Color,
  DoubleSide,
  NodeMaterial,
  type Texture,
  Vector2,
  Vector4,
} from "three/webgpu";
import {
  abs,
  attribute,
  batchColor,
  cameraPosition,
  ceil,
  clamp,
  cross,
  dFdx,
  dFdy,
  Discard,
  dot,
  exp,
  float,
  floor,
  Fn,
  frontFacing,
  If,
  int,
  ivec2,
  length,
  max,
  min,
  mix,
  normalize,
  positionWorld,
  pow,
  reflect,
  select,
  smoothstep,
  step,
  texture,
  uint,
  uvec2,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

import { FAR_LAYER_SIZE, FAR_TINTED_LAYER } from "../far-terrain-materials";
import { FAR_FACE_KIND } from "../far-terrain-mesh";
import { WATER_OPTICS } from "../water-optics";

import type { ChunkUniforms, ShaderLightingUniforms } from "./chunk-uniforms";
import { farSeam } from "./far-seam";
import { skyFog, skyGlow, type SkyFogInputs } from "./sky-fog";
import type { SurfaceWeatherUniforms } from "../surface-weather";

import { surfaceWeather } from "./surface-weather";
import type {
  FloatNode,
  UVec2Node,
  Vec2Node,
  Vec3Node,
  Vec4Node,
} from "./types";
import { ownUniform, textureSlot } from "./uniforms";

/**
 * Everything the far layer reads from the world: the chunks' sky fog and
 * daylight, their seam (written by the far layer), their weather, and the
 * chunk water's sky and tint.
 */
export type FarTerrainSharedUniforms = SkyFogInputs &
  SurfaceWeatherUniforms &
  Pick<
    ChunkUniforms,
    | "sunlightIntensity"
    | "minLightLevel"
    | "baseAmbient"
    | "faceShades"
    | "farCoverMask"
    | "farCover"
    | "farSeam"
  > &
  Pick<
    ShaderLightingUniforms,
    | "sunDirection"
    | "sunColor"
    | "ambientColor"
    | "skyTopColor"
    | "skyMiddleColor"
    | "waterFresnelStrength"
    | "waterTint"
  >;

/**
 * The chunk fragment's daylight terms for an open face in full sun (no
 * shadow, no occlusion, no block light), as the numbers both shaders use.
 * The chunk material (chunk-material.ts) is the source of truth;
 * far-terrain.test.ts reads both and fails when either side changes alone.
 */
export const CHUNK_DAYLIGHT = {
  /** `max(rawNdotL * 0.85 + 0.15, 0)`: the wrapped sun. */
  sunWrap: { scale: 0.85, bias: 0.15 },
  /** `smoothstep(0.75, 0.95, texLuma)`: how bright a texture counts as. */
  brightTexture: { from: 0.75, to: 0.95 },
  /** `mix(1, 0.7, isBrightTex)`: the sun a bright texture keeps. */
  brightTextureSun: 0.7,
  /** `ambientColor * 0.4`: the sky ambient a face looking down gets. */
  groundAmbient: 0.4,
  /** `mix(0.72, 1, shadow)`: the sky ambient a shaded face keeps. */
  shadedAmbient: 0.72,
  /** `ambientColor * 0.04 * (1 - shadow)`: light bounced into shade. */
  bounce: 0.04,
  /** `vec3(0.025, 0.03, 0.04) * sunVisibility`: starlight under open sky. */
  starlight: [0.025, 0.03, 0.04],
  /** Daylight white balance. */
  daylightBalance: [1, 1, 1],
  /** The ACES fit `(x (2.51 x + 0.03)) / (x (2.43 x + 0.59) + 0.14)`. */
  toneMap: { a: 2.51, b: 0.03, c: 2.43, d: 0.59, e: 0.14 },
} as const;

/**
 * The chunk water's Fresnel on a top face, as the numbers both shaders use;
 * far-terrain.test.ts fails when either side changes alone.
 */
export const CHUNK_WATER_FRESNEL = { base: 0.04, max: 0.56 };

/**
 * How much of its tint the chunk water's colour takes with distance, on a
 * top face where the vertical term is 0: `near` up close, toward `far` as
 * `1 - exp(-distance * perBlock)` grows, scaled by `reach`.
 */
export const CHUNK_WATER_TINT = {
  near: 0.1,
  far: 0.28,
  perBlock: 0.008,
  reach: 0.72,
} as const;

/** What a crown's inside keeps of the light on its leaves. */
const FAR_CROWN_INSIDE = 0.75;

/**
 * How a crown's leaves lose the sun with depth below its top: the share lit
 * falls off over `depth` blocks toward `floor`, measured against generated
 * trees in loaded chunks at the same pose.
 */
const FAR_CROWN_SUN = { depth: 8, floor: 0.35 } as const;

/**
 * What a sea floor's own cover (seagrass, kelp, the gravel and clay patches,
 * the shade between them) leaves of its bare top's colour: over a polar
 * bay and a sea lagoon the loaded floor, drawn without its water, averaged
 * 0.68 of the sand top the far layer paints it with, lit alike.
 */
const FAR_SEABED_COVER = 0.68;

const FAR_SHADOW_SOFT = 1.5;
const FAR_SHADOW_BIAS = 1;
const FAR_SEA_MIN_DEPTH = 0.25;

const DOWNWELLING = vec3(
  WATER_OPTICS.downwellingExtinction.red,
  WATER_OPTICS.downwellingExtinction.green,
  WATER_OPTICS.downwellingExtinction.blue,
);

/** The far layer's own uniforms, written by `FarTerrain`. */
export function createFarTerrainUniforms(textures: {
  layers: Texture;
  materials: Texture;
  shadow: Texture;
  depth: Texture;
}) {
  const layers = texture(textures.layers);
  layers.mergeable = false;
  layers.updateMatrix = false;
  return {
    /** The block faces' 16x16 texels, one layer each. */
    layers,
    /** Per class: three texels of layer codes and cover shares. */
    materials: textureSlot("float", textures.materials),
    /** Per texel, the height the sun's line through the far land stands at. */
    shadowMap: textureSlot("float", textures.shadow),
    /** (origin x, origin z, blocks per texel, texels); texels 0 for none. */
    shadowWindow: ownUniform(new Vector4(0, 0, 1, 0)),
    /** Per texel, the sea's depth under the far water plane (/ DEPTH_RANGE). */
    depthMap: textureSlot("float", textures.depth),
    depthWindow: ownUniform(new Vector4(0, 0, 1, 1)),
    /** Past this far from `ringCenter` the layer draws nothing. */
    ringOuter: ownUniform(0),
    ringCenter: ownUniform(new Vector2()),
    /** The outer band (start, end) across which the layer thins into the fog. */
    farEdge: ownUniform(new Vector2(Infinity, Infinity)),
    seabedColor: ownUniform(new Color()),
    waterColor: ownUniform(new Color()),
  };
}

export type FarTerrainUniforms = ReturnType<typeof createFarTerrainUniforms>;

/** Shading every far-layer surface shares. */
function farCommon(shared: FarTerrainSharedUniforms, u: FarTerrainUniforms) {
  const seam = farSeam(shared);
  const fog = skyFog(shared);
  const D = CHUNK_DAYLIGHT;

  /**
   * Hide under every chunk that draws real terrain, except the pixels the
   * chunk's outer half yields across the seam band (far-seam.ts), and past
   * the reach, measured from the viewer the tiles were picked around.
   * Returns the horizontal distance from the ring's centre.
   */
  const coverDiscard = (p: Vec3Node): FloatNode => {
    const texel = seam.texelAt(p.xz).toVar("farTexel");
    If(seam.isInside(texel).and(seam.hard(texel).greaterThan(0.5)), () => {
      Discard(
        shared.farSeam
          .lessThanEqual(0)
          .or(seam.weight(texel).greaterThan(seam.dither())),
      );
    });
    const horizontal = length(p.xz.sub(u.ringCenter)).toVar("farHorizontal");
    Discard(horizontal.greaterThanEqual(u.ringOuter));
    return horizontal;
  };

  /**
   * The sun on a point as the far land and canopy toward the sun let it
   * through (far-terrain-shadow): 1 above the shadow line over its texel,
   * 0 below it, softened across a couple of blocks since a texel is eight.
   */
  const terrainSun = (p: Vec3Node): FloatNode => {
    const w = u.shadowWindow;
    const uv = p.xz.sub(w.xy).div(w.z.mul(w.w));
    const isInside = uv.x
      .greaterThanEqual(0)
      .and(uv.y.greaterThanEqual(0))
      .and(uv.x.lessThanEqual(1))
      .and(uv.y.lessThanEqual(1));
    const line = u.shadowMap.sample(uv).level(float(0)).r;
    const lit = smoothstep(
      line.sub(FAR_SHADOW_SOFT),
      line.add(FAR_SHADOW_SOFT),
      p.y.add(FAR_SHADOW_BIAS),
    );
    return select(w.w.greaterThan(0).and(isInside), lit, float(1));
  };

  /**
   * Light an albedo as the chunk material lights an open face in sun
   * ({@link CHUNK_DAYLIGHT}), with `occlusion` where the chunks have their
   * vertex occlusion and `shadow` (1 lit, 0 shaded) where they have their
   * cascades: a shaded face loses the sun and keeps `shadedAmbient` of the
   * sky, plus the bounce. Returns the light.
   */
  const daylight = (
    albedo: Vec3Node,
    normal: Vec3Node,
    occlusion: FloatNode,
    shadow: FloatNode,
  ): Vec3Node => {
    const ndotl = max(
      dot(normal, shared.sunDirection).mul(D.sunWrap.scale).add(D.sunWrap.bias),
      0,
    );
    const brightTexture = smoothstep(
      D.brightTexture.from,
      D.brightTexture.to,
      dot(albedo, vec3(0.2126, 0.7152, 0.0722)),
    );
    const sun = shared.sunColor
      .mul(ndotl)
      .mul(shadow)
      .mul(shared.sunlightIntensity)
      .mul(mix(1, D.brightTextureSun, brightTexture));
    const hemisphere = normal.y.mul(0.5).add(0.5);
    const skyAmbient = mix(
      shared.ambientColor.mul(D.groundAmbient),
      shared.ambientColor,
      hemisphere,
    ).mul(mix(D.shadedAmbient, 1, shadow));
    const bounce = shared.ambientColor
      .mul(D.bounce)
      .mul(shadow.oneMinus())
      .mul(shared.sunlightIntensity);
    const ambientFloor = max(shared.minLightLevel.add(shared.baseAmbient), 0);
    const globalAmbient = vec3(...D.starlight).add(
      shared.ambientColor.mul(ambientFloor),
    );
    const a = abs(normal);
    const weights = a.div(max(a.x.add(a.y).add(a.z), 0.0001));
    const verticalShade = select(
      normal.y.greaterThan(0),
      shared.faceShades.w,
      shared.faceShades.z,
    );
    const faceShade = weights.x
      .mul(shared.faceShades.x)
      .add(weights.z.mul(shared.faceShades.y))
      .add(weights.y.mul(verticalShade));
    const light = skyAmbient
      .add(sun)
      .add(bounce)
      .add(globalAmbient)
      .mul(vec3(...D.daylightBalance))
      .mul(occlusion)
      .mul(faceShade)
      .toVar("farLight");
    const { a: ta, b: tb, c: tc, d: td, e: te } = D.toneMap;
    const mapped = light
      .mul(light.mul(ta).add(tb))
      .div(light.mul(light.mul(tc).add(td)).add(te));
    return max(mapped, vec3(ambientFloor).mul(faceShade));
  };

  /**
   * The chunks' sky fog on a lit colour, then the layer thinning into it
   * across the outer `farEdge` band, then the camera's water.
   */
  const fogged = (color: Vec3Node, p: Vec3Node, horizontal: FloatNode): Vec3Node => {
    const ray = normalize(p.sub(cameraPosition));
    const sky = fog.haze(
      color,
      ray,
      fog.fogFactor(p).mul(shared.cameraSubmersion.oneMinus()),
    );
    const edged = fog.haze(
      sky,
      ray,
      smoothstep(u.farEdge.x, u.farEdge.y, horizontal).mul(
        shared.cameraSubmersion.oneMinus(),
      ),
    );
    return fog.underwater(edged, p);
  };

  return { seam, coverDiscard, terrainSun, daylight, fogged };
}

/** Integer hash of a cell, 0..1, exact at any coordinate. */
const coverHash = (cell: Vec2Node): FloatNode => {
  const q = uvec2(ivec2(floor(cell)) as never) as unknown as UVec2Node;
  const h0 = q.x.mul(uint(0x8da6b343)).bitXor(q.y.mul(uint(0xd8163841)));
  const h1 = h0.bitXor(h0.shiftRight(uint(13))).mul(uint(0x5bd1e995));
  const h2 = h1.bitXor(h1.shiftRight(uint(15)));
  return float(h2.bitAnd(uint(0xffffff))).div(16777216);
};

/**
 * The land: each face's block picked from the class table by what the
 * face is (a top picks one of its flat covers per cell, a wall shows the
 * strata down from its column's ground, a crown its leaves), with the
 * climate tint on the faces that take it. A cell of `step` blocks wears
 * its block's 16 texels across the whole cell, as one big block: a cell
 * subtends about the same angle at every level (far-terrain-lod), so the
 * texels stay a pixel or two wide out to the reach instead of filtering
 * down to the face's mean, and the distant land keeps its pixel grain.
 */
export function createFarLandMaterial(
  shared: FarTerrainSharedUniforms,
  u: FarTerrainUniforms,
): NodeMaterial {
  const common = farCommon(shared, u);
  const weather = surfaceWeather(shared);

  const material = new NodeMaterial();
  material.name = "far-terrain-land";
  material.side = DoubleSide;
  material.fog = false;
  material.lights = false;

  // The integer attributes arrive as integers; the shading wants floats.
  const farMaterial = varying(attribute("aFarMaterial", "vec4"), "vFarMaterial");
  farMaterial.setInterpolation("flat");
  const farColumn = varying(attribute("aFarColumn", "vec2"), "vFarColumn");
  farColumn.setInterpolation("flat");
  const farTint = varying(attribute("aFarTint", "vec4"), "vFarTint");
  farTint.setInterpolation("flat");

  material.fragmentNode = Fn((builder) => {
    // The tile's fade, from its instance colour (far-terrain-batch): its
    // opacity, and whether it is the one dissolving in.
    const object = builder.object as { _colorsTexture?: unknown };
    const fade = object._colorsTexture
      ? (batchColor as unknown as Vec4Node)
      : vec4(1, 1, 1, 1);
    const fadeOpacity = fade.r;
    const isFadingIn = fade.g.greaterThan(0.5);
    // A tile dissolving in draws the pixels under its opacity; one
    // dissolving out the rest, so a swap never shows both or neither.
    const fadeDither = common.seam.dither();
    Discard(
      select(
        isFadingIn,
        fadeDither.greaterThanEqual(fadeOpacity),
        fadeDither.lessThan(fadeOpacity.oneMinus()),
      ),
    );
    const p = positionWorld.toVar("farP");
    const horizontal = common.coverDiscard(p);

    const faceNormal = normalize(cross(dFdx(p), dFdy(p))).toVar("farNormal");
    If(dot(faceNormal, cameraPosition.sub(p)).lessThan(0), () => {
      faceNormal.assign(faceNormal.negate());
    });
    const normal = faceNormal;

    const cls = int(farMaterial.x.add(0.5));
    const kind = int(farMaterial.y.add(0.5)).toVar("farKind");
    const row = (column: number) =>
      u.materials.load(ivec2(column, cls)) as unknown as Vec4Node;
    const m0 = row(0).toVar("farM0");
    const m1 = row(1).toVar("farM1");
    const m2 = row(2).toVar("farM2");
    const tint = farTint.rgb.mul(1 / 128);

    // In cells, a wall's rows counted down from its column's ground so the
    // top cell's side starts at the ground, as a block's does.
    const cellStep = max(farTint.a, 1).toVar("farStep");
    const c = vec3(p.x, p.y.sub(farColumn.x), p.z).div(cellStep).toVar("farCell");
    const isFlat = abs(normal.y).greaterThan(0.5);
    // The chunk mesher's face orientation (greedyFaceUv), unwrapped.
    const uv = select(
      isFlat,
      select(normal.y.greaterThan(0), vec2(c.x.negate(), c.z), vec2(c.x, c.z.negate())),
      select(
        abs(normal.x).greaterThan(0.5),
        vec2(select(normal.x.greaterThan(0), c.z.negate(), c.z), c.y),
        vec2(select(normal.z.greaterThan(0), c.x, c.x.negate()), c.y),
      ),
    ).toVar("farUv");
    // Derivatives up front, in uniform control flow: every branch below
    // samples with them.
    const dx = dFdx(uv).toVar("farDx");
    const dy = dFdy(uv).toVar("farDy");
    const blockFootprint = max(length(dFdx(p)), length(dFdy(p))).toVar(
      "farBlockFootprint",
    );
    const uvFootprint = max(length(dx), length(dy)).toVar("farUvFootprint");

    const layerTexel = (code: FloatNode): Vec4Node => {
      const isTinted = code.greaterThanEqual(FAR_TINTED_LAYER);
      const layer = select(isTinted, code.sub(FAR_TINTED_LAYER), code);
      const texel = u.layers
        .sample(uv)
        .depth(int(max(layer, 0)))
        .grad(dx, dy) as unknown as Vec4Node;
      return vec4(select(isTinted, texel.rgb.mul(tint), texel.rgb), texel.a);
    };
    const layerColor = (code: FloatNode): Vec3Node => layerTexel(code).rgb;

    const albedo = vec3(0).toVar("farAlbedo");
    const shadow = float(1).toVar("farShadow");
    If(kind.equal(FAR_FACE_KIND.top), () => {
      // Flat covers are whole cells of their own, chosen per cell. Once a
      // cell shrinks under a couple of pixels the choice would sparkle, so
      // the covers blend in by share instead.
      const choice = coverHash(c.xz);
      const code = select(
        choice.lessThan(m1.x),
        m0.y,
        select(choice.lessThan(m1.y), m0.z, select(choice.lessThan(m1.z), m0.w, m0.x)),
      );
      albedo.assign(layerColor(code));
      const blend = smoothstep(0.35, 0.8, uvFootprint);
      If(blend.greaterThan(0), () => {
        const mixed = layerColor(m0.x).mul(m1.z.oneMinus()).toVar("farMixed");
        If(m1.x.greaterThan(0), () => {
          mixed.addAssign(layerColor(m0.y).mul(m1.x));
        });
        If(m1.y.greaterThan(m1.x), () => {
          mixed.addAssign(layerColor(m0.z).mul(m1.y.sub(m1.x)));
        });
        If(m1.z.greaterThan(m1.y), () => {
          mixed.addAssign(layerColor(m0.w).mul(m1.z.sub(m1.y)));
        });
        albedo.assign(mix(albedo, mixed, blend));
      });
    })
      .ElseIf(kind.equal(FAR_FACE_KIND.crown), () => {
        // A crown's class is its species': leaves on every face, see-through
        // where the leaves are. Through a gap shows the crown's far side
        // from within, in the canopy's own shade, and through a gap there
        // whatever stands behind the tree, as through a leaf block's gaps.
        const leaves = layerTexel(m0.x).toVar("farLeaves");
        // A gap under a few pixels wide winks in and out as the view
        // moves, so the cut eases off as the texels shrink and the gap
        // shows its shade.
        const texelFootprint = uvFootprint.mul(FAR_LAYER_SIZE);
        Discard(
          leaves.a.lessThan(smoothstep(0.3, 0.6, texelFootprint).oneMinus().mul(0.5)),
        );
        If(frontFacing, () => {
          albedo.assign(leaves.rgb);
          // The sun on a crown's outer leaves, as the leaves above let it
          // through: the chunks' cascades shade a canopy's lower leaves and
          // its underside wholly. Each block is lit or shaded on its own,
          // dappled, until blocks shrink under a few pixels and take the
          // share lit instead.
          const depth = max(farColumn.y.sub(p.y), 0);
          const lit = mix(FAR_CROWN_SUN.floor, 1, exp(depth.negate().div(FAR_CROWN_SUN.depth)));
          const block = floor(p.sub(normal.mul(0.5)));
          const dapple = step(
            coverHash(
              vec2(block.x.add(block.y.mul(31)), block.z.sub(block.y.mul(17))),
            ),
            lit,
          );
          shadow.assign(
            select(
              normal.y.lessThan(-0.5),
              float(0),
              mix(dapple, lit, smoothstep(0.25, 0.5, blockFootprint)),
            ),
          );
        }).Else(() => {
          albedo.assign(leaves.rgb.mul(FAR_CROWN_INSIDE));
          shadow.assign(0);
        });
      })
      .ElseIf(kind.equal(FAR_FACE_KIND.trunk), () => {
        albedo.assign(layerColor(m2.y));
      })
      .ElseIf(kind.equal(FAR_FACE_KIND.bottom), () => {
        albedo.assign(layerColor(m2.z));
      })
      .Else(() => {
        // A wall: the ground block's side for its top cell, the side block
        // for the cells sideDepth blocks reach into, and the deep block
        // below.
        const depth = c.y.negate();
        const code = select(
          depth.lessThan(1),
          m2.x,
          select(depth.lessThan(ceil(m1.w.div(cellStep)).add(1)), m2.y, m2.z),
        );
        albedo.assign(layerColor(code));
      });

    If(weather.isActive, () => {
      albedo.assign(weather.farAlbedo(albedo, p, normal, blockFootprint));
    });
    const occlusion = farMaterial.z.div(255);
    shadow.assign(min(shadow, common.terrainSun(p)));
    const light = common.daylight(albedo, normal, occlusion, shadow);
    return vec4(common.fogged(albedo.mul(light), p, horizontal), 1);
  })();
  return material;
}

/**
 * The far water, seen from above by the chunk water's own optics (the
 * refraction branch of its top face), so the two agree where the loaded
 * chunks end: the sea floor dimmed over the path down and back, the water's
 * colour growing with thickness and toward grazing angles, past a few
 * blocks the deep in-scatter of the diver's fog colour, the sky mirrored by
 * the same Fresnel, and the floor showing through what the surface leaves
 * to the blend. The depth comes from the far tiles' own floor heights;
 * `waterColor` is the colour the chunk water lays over a floor (its lit
 * texture, toward its tint).
 */
export function createFarWaterMaterial(
  shared: FarTerrainSharedUniforms,
  u: FarTerrainUniforms,
  depthRange: number,
): NodeMaterial {
  const common = farCommon(shared, u);
  const glow = skyGlow(shared);
  const W = WATER_OPTICS;

  const fresnelOf = (cosView: FloatNode): FloatNode =>
    clamp(
      pow(clamp(cosView, 0, 1).oneMinus(), 5)
        .mul(shared.waterFresnelStrength)
        .add(CHUNK_WATER_FRESNEL.base),
      0.01,
      CHUNK_WATER_FRESNEL.max,
    ).mul(W.distantFresnelFactor);

  const skyMirror = (toCamera: Vec3Node): Vec3Node => {
    const reflectDir = reflect(toCamera.negate(), vec3(0, 1, 0));
    const skyH = normalize(
      reflectDir.mul(shared.skyFogDimension).add(shared.skyFogOffset),
    ).y;
    return mix(
      shared.skyMiddleColor,
      shared.skyTopColor,
      pow(max(skyH, 0), shared.skyFogExponent),
    ).add(glow.glow(reflectDir));
  };

  const seabed = u.seabedColor.mul(FAR_SEABED_COVER);

  /**
   * The lit surface as the chunk water draws it: the lit floor seen through
   * the column (dimmed over the path down and back, under the water's
   * colour as it thickens and toward grazing views), the water's colour
   * taking more of its tint with distance, the deep body's in-scatter
   * (daylight let down through the surface, not lit again), the sky mirror,
   * and all of it over the lit floor by the surface's opacity, which the
   * deep body and grazing views close.
   */
  const surface = (
    light: Vec3Node,
    seaDepth: FloatNode,
    fresnel: FloatNode,
    toCamera: Vec3Node,
    viewDistance: FloatNode,
  ): Vec3Node => {
    const floorDepth = min(seaDepth, W.floorAbsorptionMaxDepth);
    const floorShade = exp(
      DOWNWELLING.negate().mul(floorDepth).mul(W.floorAbsorptionPathScale),
    ).mul(W.wetFloorDarken);
    const thicknessScatter = exp(floorDepth.mul(-W.shallowScatterDensity))
      .oneMinus()
      .mul(W.shallowScatterMaxMix);
    const floorLit = seabed.mul(light).toVar("farFloorLit");
    const tintShare = exp(viewDistance.mul(-CHUNK_WATER_TINT.perBlock))
      .oneMinus()
      .mul((CHUNK_WATER_TINT.far - CHUNK_WATER_TINT.near) * CHUNK_WATER_TINT.reach)
      .add(CHUNK_WATER_TINT.near);
    const water = mix(u.waterColor.mul(light), shared.waterTint, tintShare);
    const color = mix(
      floorLit.mul(floorShade),
      water,
      clamp(fresnel.mul(0.28).add(thicknessScatter).add(0.12), 0, 1),
    );
    const deepTransmit = exp(
      max(seaDepth.sub(W.deepSurfaceClearDepth), 0).mul(-W.deepSurfaceExtinction),
    ).toVar("farDeepTransmit");
    const deepScatter = shared.underwaterAmbient
      .mul(
        vec3(
          W.deepSurfaceScatterScale.red,
          W.deepSurfaceScatterScale.green,
          W.deepSurfaceScatterScale.blue,
        ),
      )
      .mul(
        exp(
          DOWNWELLING.negate()
            .mul(min(seaDepth, 16))
            .mul(W.aboveSurfaceScatterDepthScale),
        ),
      );
    const mirrored = mix(
      mix(deepScatter, color, deepTransmit),
      skyMirror(toCamera),
      fresnel,
    );
    const alpha = mix(
      W.refractedSurfaceAlphaFloor,
      1,
      fresnel.mul(fresnel).mul(W.fresnelAlphaStrength),
    )
      .oneMinus()
      .mul(deepTransmit)
      .oneMinus();
    return mix(floorLit, mirrored, alpha);
  };

  const material = new NodeMaterial();
  material.name = "far-terrain-water";
  material.side = DoubleSide;
  material.fog = false;
  material.lights = false;
  material.fragmentNode = Fn(() => {
    const p = positionWorld.toVar("farP");
    const horizontal = common.coverDiscard(p);
    const normal = vec3(0, 1, 0);
    const w = u.depthWindow;
    const depthUv = p.xz.sub(w.xy).div(w.z.mul(w.w)).toVar("farDepthUv");
    const seaDepth = u.depthMap
      .sample(depthUv)
      .level(float(0))
      .r.mul(depthRange)
      .toVar("farSeaDepth");
    // No sea where the tiles stand at or above it. A lake or shore level
    // with the sea has its own top an eighth of a block over this plane,
    // and a few hundred blocks out the depth buffer cannot part them: the
    // two fought in bands, the sea's side painted as the sand of a zero
    // depth.
    const inMap = depthUv.x
      .greaterThanEqual(0)
      .and(depthUv.y.greaterThanEqual(0))
      .and(depthUv.x.lessThanEqual(1))
      .and(depthUv.y.lessThanEqual(1));
    Discard(inMap.and(seaDepth.lessThan(FAR_SEA_MIN_DEPTH)));
    const toCamera = normalize(cameraPosition.sub(p)).toVar("farToCamera");
    const fresnel = fresnelOf(toCamera.y).toVar("farFresnel");
    const light = common
      .daylight(seabed, normal, float(1), common.terrainSun(p))
      .toVar("farWaterLight");
    const color = surface(
      light,
      seaDepth,
      fresnel,
      toCamera,
      length(cameraPosition.sub(p)),
    );
    return vec4(common.fogged(color, p, horizontal), 1);
  })();
  return material;
}

/**
 * The floor under the far water, for the chunk water to see through. Where
 * the loaded chunks end over open water, a view into their water runs out
 * of their floor before it reaches the bottom: the chunk water composites
 * what is behind it (its refraction capture), and there the far layer had
 * nothing, so a band of sky tinted blue ran along the loaded edge, as wide
 * as the water is deep and the view is low. This plane, past the loaded
 * chunks and deep enough for any sea the depth map holds, is that floor:
 * the seabed's colour, lit as the chunks light an open floor in sun. From
 * above it stays under the far water and the far land, and from under the
 * water (where the far layer is fog anyway) it draws nothing.
 */
export function createFarSeabedMaterial(
  shared: FarTerrainSharedUniforms,
  u: FarTerrainUniforms,
): NodeMaterial {
  const common = farCommon(shared, u);
  const material = new NodeMaterial();
  material.name = "far-terrain-seabed";
  material.side = DoubleSide;
  material.fog = false;
  material.lights = false;
  material.fragmentNode = Fn(() => {
    const p = positionWorld.toVar("farP");
    const horizontal = common.coverDiscard(p);
    Discard(shared.cameraSubmersion.greaterThan(0.5));
    const albedo = u.seabedColor.mul(FAR_SEABED_COVER);
    const light = common.daylight(albedo, vec3(0, 1, 0), float(1), float(1));
    return vec4(common.fogged(albedo.mul(light), p, horizontal), 1);
  })();
  return material;
}
