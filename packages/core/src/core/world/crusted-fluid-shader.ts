import {
  Color,
  type ColorRepresentation,
  Uniform,
  Vector2,
  Vector4,
} from "three";

import { SHADER_CLOCK_WRAP_SECONDS } from "./shader-clock";
import { SHADER_LIGHTING_SEE_THROUGH_CHUNK_SHADERS } from "./shaders";
import { VOXEL_NATIVE_GLSL } from "./voxel-native-shading";

/**
 * A surface for a hot, viscous fluid: a dark cooled crust broken into plates
 * over glowing seams, drifting along the fluid's own flow, built on the chunk
 * lighting shader so it sits in the same world as every other block face.
 *
 * - Flow. A top face drifts along the mesher's per-corner surface flow (the
 *   same field that bends the water's crests), a wall slides straight down,
 *   so a fall runs faster than the sheet feeding it, and an underside stays.
 *   Offsets restart every cycle behind a two-generation cross-over, the usual
 *   flow-map trick, so a varying flow field never shears the pattern for
 *   longer than one cycle. A still pool drifts a little on a heading drawn
 *   per generation.
 * - Crust. Each generation is a cellular field of plates. A plate forms hot
 *   when its generation rises, darkens as it cools, and heats up again and
 *   breaks as its generation fades, so the crust reforms continuously
 *   instead of cross-fading. A slow heat field makes some patches run
 *   hotter than others, so the cycle never pulses over a whole lake at once.
 * - Voxel grain. Everything is evaluated per texel on the block-aligned grid
 *   (`texelsPerBlock`, 16 by default), offsets advance in whole texels, and
 *   heat maps onto a six-entry palette in flat bands: pixel art, not a
 *   smooth noise render. A texel smaller than a screen pixel would alias
 *   into sparkle (there is no mip chain for a procedural pattern), so the
 *   pattern settles to its mean colour past a screen-footprint threshold.
 * - Light. Crust (palette 0 and 1) is lit by the sun and sky like a solid
 *   face, over a small self-light so it stays readable in the dark; seams
 *   (palette 2 to 5) glow at their own colour. Block light is left out on
 *   purpose: the fluid's own emitted light would flood its crust to full
 *   brightness and flatten it. A per-direction face shade darkens walls and
 *   undersides so a fall reads as a solid column, and crust plates pick up a
 *   faint dome relief from the sun's heading.
 *
 * Every value is a uniform, so a game can tune the look live on the returned
 * uniforms without a recompile. The result plugs into
 * `World.customizeMaterialShaders` for the fluid block.
 */
export type CrustedFluidShaderOptions = {
  /**
   * Six colours from coldest to hottest: dark crust, lit crust, ember,
   * seam, hot seam, seam core. The first two are lit; the rest glow.
   */
  palette?: ColorRepresentation[];
  /** Texels per block of the grid the pattern snaps to. */
  texelsPerBlock?: number;
  /** Mean plate size, in texels. */
  plateTexels?: number;
  /** Seam half-width in plate units (distance to the plate border). */
  seamWidth?: number;
  /** Drift of a running top face, in blocks per second. */
  surfaceFlowSpeed?: number;
  /** Slide of a wall (a fall), in blocks per second. */
  fallFlowSpeed?: number;
  /**
   * Seconds per crust generation. Must divide the shader clock's wrap
   * period so the wrap lands on a generation boundary.
   */
  cycleSeconds?: number;
  /** Plate elongation down a wall (1 keeps them round). */
  fallStretch?: number;
  /** Heat thresholds for the ember, seam, hot seam and core bands. */
  bands?: [number, number, number, number];
  /** Fraction of a generation a new plate takes to cool into crust. */
  formTime?: number;
  /** Per-texel heat jitter, which dithers the band edges. */
  grain?: number;
  /**
   * Plate dome relief on crust, 0 to 1: how far the plate's shaded half
   * falls from the lit crust colour toward the dark one.
   */
  relief?: number;
  /** Crust hold on a wall: below 1 a fall runs hotter than a pool. */
  fallCrust?: number;
  /** Heat-field scale (per block), base, amplitude and speed (per second). */
  zone?: { scale: number; base: number; amplitude: number; speed: number };
  /** Crust brightness without any light. */
  crustSelfLight?: number;
  /** Crust response to the sun and sky light reaching the face. */
  crustSceneLight?: number;
  /** Multiplier on the glowing bands. */
  glowStrength?: number;
  /** Share of seam colour in the far mean colour. */
  meanGlow?: number;
  /**
   * Texels per screen pixel (along the more compressed axis, so a grazing
   * view settles too) past which detail starts settling to the mean colour;
   * at 2.5x this it is settled.
   */
  farFadeTexelFootprint?: number;
  /** Face shade for the +-X walls, +-Z walls, underside and top. */
  faceShades?: { sideX: number; sideZ: number; bottom: number; top: number };
  /** Scale on the shared surface wave height and speed. */
  wave?: { amplitude: number; speed: number };
};

export type CrustedFluidShader = {
  vertexShader: string;
  fragmentShader: string;
  uniforms: {
    uCrustPalette: Uniform<Color[]>;
    uCrustFlow: Uniform<Vector4>;
    uCrustShape: Uniform<Vector4>;
    uCrustBands: Uniform<Vector4>;
    uCrustLife: Uniform<Vector4>;
    uCrustZone: Uniform<Vector4>;
    uCrustLight: Uniform<Vector4>;
    uCrustFaceShades: Uniform<Vector4>;
    uCrustWave: Uniform<Vector2>;
  };
};

export const CRUSTED_FLUID_DEFAULTS: Required<CrustedFluidShaderOptions> = {
  palette: ["#1a0e0c", "#3a1c14", "#8a1e08", "#e0520c", "#ff8a1e", "#ffc24a"],
  texelsPerBlock: 16,
  plateTexels: 10,
  seamWidth: 0.1,
  surfaceFlowSpeed: 0.06,
  fallFlowSpeed: 0.9,
  cycleSeconds: 8,
  fallStretch: 1.8,
  bands: [0.38, 0.6, 0.8, 0.94],
  formTime: 0.3,
  grain: 0.06,
  relief: 1,
  fallCrust: 0.85,
  zone: { scale: 0.21, base: 1.5, amplitude: 0.7, speed: 0.04 },
  crustSelfLight: 0.55,
  crustSceneLight: 0.6,
  glowStrength: 1,
  meanGlow: 0.3,
  farFadeTexelFootprint: 1.2,
  faceShades: { sideX: 0.8, sideZ: 0.72, bottom: 0.55, top: 1 },
  wave: { amplitude: 0.35, speed: 0.4 },
};

const VERTEX_UNIFORM_ANCHOR = "uniform float uTime;";
const VERTEX_WAVE_TIME_ANCHOR = "float waveTime = uTime * 0.0006;";
const VERTEX_WAVE_HEIGHT_ANCHOR =
  "transformed.y += (wave1 + wave2 + wave3) * POSITION_UNITS_PER_BLOCK;";
const FRAGMENT_MAIN_ANCHOR = "void main() {";
const FRAGMENT_LIGHT_ANCHOR = "outgoingLight.rgb *= totalLight;";

const CRUSTED_FLUID_FUNCTIONS = /* glsl */ `
uniform vec3 uCrustPalette[6];
uniform vec4 uCrustFlow;
uniform vec4 uCrustShape;
uniform vec4 uCrustBands;
uniform vec4 uCrustLife;
uniform vec4 uCrustZone;
uniform vec4 uCrustLight;
uniform vec4 uCrustFaceShades;

${VOXEL_NATIVE_GLSL}

// Integer hash (pcg3d): exact at any coordinate, unlike a sin() hash. The
// bias keeps world coordinates positive before the unsigned cast.
uvec3 crustHash3(ivec3 p) {
  uvec3 v = uvec3(p + ivec3(16777216));
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

vec3 crustUnit3(ivec3 p) {
  return vec3(crustHash3(p) >> 8u) * (1.0 / 16777216.0);
}

// Plates of one generation around q (plate units): x = distance to the
// plate border (F2 - F1), y = the plate's own draw, zw = the offset from
// the plate's point to q.
vec4 crustPlates(vec2 q, int seed) {
  ivec2 base = ivec2(floor(q));
  vec2 f = q - vec2(base);
  float d1 = 8.0;
  float d2 = 8.0;
  vec3 nearest = vec3(0.0);
  vec2 nearestOffset = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec3 r = crustUnit3(ivec3(base + ivec2(i, j), seed));
      vec2 toPoint = vec2(float(i), float(j)) + r.xy - f;
      float d = dot(toPoint, toPoint);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        nearest = r;
        nearestOffset = toPoint;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return vec4(sqrt(d2) - sqrt(d1), nearest.z, -nearestOffset);
}
`;

const CRUSTED_FLUID_SURFACE = /* glsl */ `
{
  vec3 crustAbsNormal = abs(vWorldNormal);
  bool crustIsWall = crustAbsNormal.y < 0.5;
  bool crustIsTop = vWorldNormal.y >= 0.5;
  float crustTexels = uCrustShape.x;
  // Face-plane coordinates in blocks; on a wall, y runs up it.
  vec2 crustUv = crustIsWall
    ? vec2(crustAbsNormal.x > crustAbsNormal.z ? vWorldPosition.z : vWorldPosition.x, vWorldPosition.y)
    : vWorldPosition.xz;
  vec2 crustTexel = floor(crustUv * crustTexels);
  vec2 crustFootprint = fwidth(crustUv * crustTexels);
  float crustFar = smoothstep(
    uCrustShape.w,
    uCrustShape.w * 2.5,
    max(crustFootprint.x, crustFootprint.y)
  );

  float crustSeconds = uTime * 0.001;
  float crustCycle = crustSeconds / uCrustFlow.z;
  float crustPhaseA = fract(crustCycle);
  float crustPhaseB = fract(crustCycle + 0.5);
  int crustSeedA = int(floor(crustCycle)) * 2;
  int crustSeedB = int(floor(crustCycle + 0.5)) * 2 + 1;
  float crustWeightA = 1.0 - abs(2.0 * crustPhaseA - 1.0);
  float crustWeightB = 1.0 - crustWeightA;

  // Blocks per second across the face: the surface flow on a top, straight
  // down a wall, nothing underneath. A still pool drifts on a heading drawn
  // per generation, fading out where the sheet runs.
  float crustRun = min(length(vFluidFlow), 1.0);
  vec2 crustFlow = crustIsWall
    ? vec2(0.0, -uCrustFlow.y)
    : (crustIsTop ? vFluidFlow * uCrustFlow.x : vec2(0.0));
  float crustPoolDrift = crustIsTop ? (1.0 - crustRun) * uCrustFlow.x : 0.0;
  float crustHeadingA = crustUnit3(ivec3(0, 0, crustSeedA)).x * 6.28318530718;
  float crustHeadingB = crustUnit3(ivec3(0, 0, crustSeedB)).x * 6.28318530718;
  vec2 crustDriftA = crustFlow + crustPoolDrift * vec2(cos(crustHeadingA), sin(crustHeadingA));
  vec2 crustDriftB = crustFlow + crustPoolDrift * vec2(cos(crustHeadingB), sin(crustHeadingB));
  // Whole texels, so the pattern steps on the block's own grid.
  vec2 crustTexelA = crustTexel - floor(crustDriftA * crustPhaseA * uCrustFlow.z * crustTexels);
  vec2 crustTexelB = crustTexel - floor(crustDriftB * crustPhaseB * uCrustFlow.z * crustTexels);
  vec2 crustPlateScale = vec2(1.0, crustIsWall ? 1.0 / uCrustFlow.w : 1.0) / uCrustShape.y;
  // Per-texel draws riding with each generation: xy nudge the texel before
  // the plate lookup, so plate borders come out ragged by a texel instead of
  // as smooth polygons; z is grain.
  vec3 crustNoiseA = crustUnit3(ivec3(ivec2(crustTexelA), crustSeedA + 7919));
  vec3 crustNoiseB = crustUnit3(ivec3(ivec2(crustTexelB), crustSeedB + 7919));
  vec4 crustA = crustPlates((crustTexelA + 0.5 + (crustNoiseA.xy - 0.5) * 0.8) * crustPlateScale, crustSeedA);
  vec4 crustB = crustPlates((crustTexelB + 0.5 + (crustNoiseB.xy - 0.5) * 0.8) * crustPlateScale, crustSeedB);

  // Slow heat field: where it is high, generations hold their crust longer.
  vec2 crustZonePos = snapToTexel(crustUv, crustTexels) * uCrustZone.x;
  float crustZoneTime = crustSeconds * uCrustZone.w;
  float crustZone = sin(crustZonePos.x + crustZonePos.y * 0.7 + crustZoneTime)
    * sin(crustZonePos.y * 1.3 - crustZonePos.x * 0.4 - crustZoneTime * 0.8);
  float crustHold = (uCrustZone.y + uCrustZone.z * crustZone) * (crustIsWall ? uCrustLife.w : 1.0);
  // The generation whose plate is further into its life shows.
  float crustLifeA = min(crustWeightA * crustHold, 1.0) - crustA.y;
  float crustLifeB = min(crustWeightB * crustHold, 1.0) - crustB.y;
  bool crustShowA = crustLifeA >= crustLifeB;
  vec4 crustPlate = crustShowA ? crustA : crustB;
  float crustAge = clamp(max(crustLifeA, crustLifeB) / uCrustLife.x, 0.0, 1.0);

  float crustGrain = (crustShowA ? crustNoiseA.z : crustNoiseB.z) - 0.5;
  // Each plate draws its own border width, so cracks vary along their run.
  float crustSeamWidth = uCrustShape.z * (0.6 + 0.8 * fract(crustPlate.y * 13.7))
    * (1.0 + 2.5 * (1.0 - crustAge));
  float crustSeam = 1.0 - clamp(crustPlate.x / crustSeamWidth, 0.0, 1.0);
  float crustEdge = 1.0 - clamp(crustPlate.x / 0.5, 0.0, 1.0);
  float crustBody = (1.0 - crustAge) * (0.45 + 0.55 * crustEdge);
  float crustHeat = max(crustSeam, crustBody) + crustGrain * uCrustLife.y;

  // Dome relief: the half of a plate facing the sun (straight up on a wall)
  // takes the lit crust colour.
  vec2 crustLightDir = crustIsWall ? vec2(0.0, 1.0) : normalize(uSunDirection.xz + vec2(1e-4));
  float crustLitSide = step(0.0, dot(crustPlate.zw, crustLightDir) + crustGrain * 0.3);
  vec3 crustScene = uCrustLight.x + uCrustLight.y * sunTotal;
  vec3 crustTone = mix(
    mix(uCrustPalette[1], uCrustPalette[0], uCrustLife.z),
    uCrustPalette[1],
    crustLitSide
  );
  vec3 crustColor = crustTone * crustScene;
  if (crustHeat >= uCrustBands.x) {
    int crustBand = crustHeat >= uCrustBands.w ? 5
      : crustHeat >= uCrustBands.z ? 4
      : crustHeat >= uCrustBands.y ? 3 : 2;
    crustColor = uCrustPalette[crustBand] * uCrustLight.z;
  }
  vec3 crustMean = mix(
    uCrustPalette[1] * crustScene,
    uCrustPalette[3] * uCrustLight.z,
    uCrustLight.w
  );
  crustColor = mix(crustColor, crustMean, crustFar);

  vec3 crustFaceWeights = crustAbsNormal / max(crustAbsNormal.x + crustAbsNormal.y + crustAbsNormal.z, 1e-4);
  float crustFaceShade = crustFaceWeights.x * uCrustFaceShades.x
    + crustFaceWeights.z * uCrustFaceShades.y
    + crustFaceWeights.y * (vWorldNormal.y > 0.0 ? uCrustFaceShades.w : uCrustFaceShades.z);
  outgoingLight.rgb = crustColor * crustFaceShade;
}
`;

function replaceOnce(source: string, anchor: string, replacement: string) {
  const at = source.indexOf(anchor);
  if (at < 0 || source.indexOf(anchor, at + anchor.length) >= 0) {
    throw new Error(
      `Crusted fluid shader needs exactly one "${anchor}" in its base shader`,
    );
  }
  return source.slice(0, at) + replacement + source.slice(at + anchor.length);
}

export function createCrustedFluidShader(
  options: CrustedFluidShaderOptions = {},
  base: {
    vertex: string;
    fragment: string;
  } = SHADER_LIGHTING_SEE_THROUGH_CHUNK_SHADERS,
): CrustedFluidShader {
  const o = { ...CRUSTED_FLUID_DEFAULTS, ...options };
  if (o.palette.length !== 6) {
    throw new Error("Crusted fluid palette needs exactly six colours");
  }
  if (
    !(o.cycleSeconds > 0) ||
    SHADER_CLOCK_WRAP_SECONDS % o.cycleSeconds !== 0
  ) {
    throw new Error(
      `Crusted fluid cycleSeconds must divide the shader clock wrap (${SHADER_CLOCK_WRAP_SECONDS}s)`,
    );
  }

  let vertexShader = replaceOnce(
    base.vertex,
    VERTEX_UNIFORM_ANCHOR,
    `${VERTEX_UNIFORM_ANCHOR}\nuniform vec2 uCrustWave;`,
  );
  vertexShader = replaceOnce(
    vertexShader,
    VERTEX_WAVE_TIME_ANCHOR,
    "float waveTime = uTime * 0.0006 * uCrustWave.y;",
  );
  vertexShader = replaceOnce(
    vertexShader,
    VERTEX_WAVE_HEIGHT_ANCHOR,
    "transformed.y += (wave1 + wave2 + wave3) * POSITION_UNITS_PER_BLOCK * uCrustWave.x;",
  );

  let fragmentShader = replaceOnce(
    base.fragment,
    FRAGMENT_MAIN_ANCHOR,
    `${CRUSTED_FLUID_FUNCTIONS}\n${FRAGMENT_MAIN_ANCHOR}`,
  );
  fragmentShader = replaceOnce(
    fragmentShader,
    FRAGMENT_LIGHT_ANCHOR,
    CRUSTED_FLUID_SURFACE,
  );

  return {
    vertexShader,
    fragmentShader,
    uniforms: {
      uCrustPalette: new Uniform(o.palette.map((c) => new Color(c))),
      uCrustFlow: new Uniform(
        new Vector4(
          o.surfaceFlowSpeed,
          o.fallFlowSpeed,
          o.cycleSeconds,
          o.fallStretch,
        ),
      ),
      uCrustShape: new Uniform(
        new Vector4(
          o.texelsPerBlock,
          o.plateTexels,
          o.seamWidth,
          o.farFadeTexelFootprint,
        ),
      ),
      uCrustBands: new Uniform(new Vector4(...o.bands)),
      uCrustLife: new Uniform(
        new Vector4(o.formTime, o.grain, o.relief, o.fallCrust),
      ),
      uCrustZone: new Uniform(
        new Vector4(o.zone.scale, o.zone.base, o.zone.amplitude, o.zone.speed),
      ),
      uCrustLight: new Uniform(
        new Vector4(
          o.crustSelfLight,
          o.crustSceneLight,
          o.glowStrength,
          o.meanGlow,
        ),
      ),
      uCrustFaceShades: new Uniform(
        new Vector4(
          o.faceShades.sideX,
          o.faceShades.sideZ,
          o.faceShades.bottom,
          o.faceShades.top,
        ),
      ),
      uCrustWave: new Uniform(new Vector2(o.wave.amplitude, o.wave.speed)),
    },
  };
}
