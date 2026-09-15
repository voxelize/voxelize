import { ShaderLib } from "three";

import {
  LIGHT_CONES_FUNCTIONS,
  LIGHT_CONES_SCATTER_FRAGMENT,
  LIGHT_CONES_UNIFORM_DECLARATIONS,
} from "./light-cones";
import { MAX_LIGHTS_PER_CELL } from "./local-lights/clustering";
import {
  LOCAL_LIGHTS_DEBUG_FUNCTIONS,
  LOCAL_LIGHTS_FUNCTIONS,
  LOCAL_LIGHTS_UNIFORM_DECLARATIONS,
} from "./local-lights/shader";
import { createSkyFogFragment, SKY_FOG_UNIFORM_DECLARATIONS } from "./sky-fog";
import {
  ABOVE_SURFACE_WATER_FOG_FRAGMENT,
  FLOW_CREST_PHASE_PER_HEIGHT,
  FLUID_SPILL_CORNER_MIN_HEIGHT,
  WATER_DOWNWELLING_EXTINCTION_GLSL,
  WATER_OPTICS,
  WATER_SURFACE_NORMAL_LAYERS_GLSL,
  WATER_SURFACE_SCATTER_GLSL,
  WATER_VIEW_EXTINCTION_GLSL,
} from "./water-optics";

export const CHUNK_RENDER_QUALITY = {
  highResolutionPixelThreshold: 2_100_000,
  highResolutionLocalLightsPerCell: 2,
} as const;

// Chunk fog reveals through both channels at once: the material uniform (a
// plain mesh's per-draw value) and the per-section varying (an arena slot's
// batching color). Each is 1 where the other is in use.
const CHUNK_SKY_FOG_FRAGMENT = createSkyFogFragment(
  undefined,
  "uChunkReveal * vChunkReveal",
);

// ── local-lights fragment insertions ─────────────────────────────────────
// Each block below is interpolated into the composed fragment exactly once
// and removed (or swapped for its legacy counterpart) by
// stripLocalLightsFromFragment, so the render-diff harness can compile a
// true "local lights never existed" program from the same pipeline. Keeping
// insertion and removal on one constant makes drift impossible: change the
// block and both sides change together.

const LOCAL_LIGHTS_OWNERSHIP_FRAGMENT = `
// Analytic ownership of block-source lighting: where selected clustered
// lights claim this fragment, the baked flood term yields in proportion
// (llFloodRemainder → 0) and the per-pixel model — falloff, N·L, masks,
// shadows — is the sole visible block light, so nothing double-lights.
// Where no selected light reaches (beyond falloff, past the selection cap,
// outside the grid window, or with local lights off) the remainder returns
// to 1 and this is byte-for-byte the legacy flood term: every operation
// below is an IEEE identity at remainder 1 and clusterLight 0. Sunlight is
// composed separately and never touched by either model.
float llFloodRemainder = 1.0;
bool llHighResolution =
  uSceneTextureSize.x * uSceneTextureSize.y >= ${CHUNK_RENDER_QUALITY.highResolutionPixelThreshold}.0;
vec3 clusterLight = localLightSurface(
  vWorldPosition.xyz,
  vWorldNormal,
  vLight.rgb,
  vIsFluid > 0.5
    ? 0
    : (llHighResolution
      ? ${CHUNK_RENDER_QUALITY.highResolutionLocalLightsPerCell}
      : ${MAX_LIGHTS_PER_CELL}),
  1,
  llFloodRemainder
);

// Daylight washes analytic block light. The legacy flood term is screened
// against the sun and vanishes into a fully sunlit fragment; the cluster
// blend is screened against totalLight *after* tinting, so without this
// wash every lamp, portal and gem painted its falloff rings onto open
// ground at noon — overlapping warm and cool emitters read as tie-dye
// stains on daylit builds. A fragment keeps its analytic light in
// proportion to the sun it lacks (sky exposure × time-of-day intensity):
// interiors keep their lamps at noon, everything keeps them at night. The
// flood remainder returns to 1 in the same proportion, handing the washed
// fragment back to the legacy model instead of leaving it doubly dimmed
// at dusk. At night (intensity → 0) the wash is an identity.
float llSunWash = 1.0 - clamp(sunExposure * uSunlightIntensity, 0.0, 1.0);
clusterLight *= llSunWash;
llFloodRemainder = mix(1.0, llFloodRemainder, llSunWash);

float torchBrightness = max(
  max(max(smoothTorch.r, smoothTorch.g), smoothTorch.b) * llFloodRemainder,
  min(max(max(clusterLight.r, clusterLight.g), clusterLight.b), 1.0)
);
vec3 torchLight = smoothTorch * (1.2 * llFloodRemainder);
`;

const LEGACY_BLOCK_LIGHT_FRAGMENT = `
float torchBrightness = max(max(smoothTorch.r, smoothTorch.g), smoothTorch.b);
vec3 torchLight = smoothTorch * 1.2;
`;

const LOCAL_LIGHTS_BLEND_FRAGMENT = `
// Clustered local lights (torches, lanterns, held lights) carry the
// per-pixel falloff and normal response the baked flood cannot; the flood
// term above already yielded them this fragment via llFloodRemainder.
// Static sources are leak-masked by the flood field inside
// localLightSurface. The zero-light guard is exactness, not speed:
// 1.0 - (1.0 - t) is not an IEEE identity, so blending a zero cluster
// would still perturb totalLight by an ulp — enough to flip an 8-bit
// pixel at a rounding boundary and break byte-parity with the legacy
// program.
if (uClusteredLightCount != 0) {
  totalLight = 1.0 - (1.0 - totalLight) * (1.0 - clusterLight);
}
`;

const LOCAL_LIGHTS_SPECULAR_FRAGMENT = `
  // Torch sparkle on water: the clustered lights are the only local sources
  // with a position to reflect, so fluids are where local specular lives.
  // The flood field rides along for the same leak masking the diffuse path
  // applies — an occluded lamp must not glint through its wall.
  specularColor += localLightSpecular(wPos, waterNormal, viewDir, vLight.rgb);
`;

const LOCAL_LIGHTS_DEBUG_TAIL_FRAGMENT = `
if (uLocalLightDebugMode > 0.5) {
  gl_FragColor.rgb = localLightDebugColor(
    vWorldPosition.xyz,
    gl_FragColor.rgb,
    vWorldNormal,
    vLight.rgb,
    clusterLight,
    llFloodRemainder
  );
}
`;

/**
 * Compile the local-lights layer entirely out of a composed chunk fragment:
 * the uniform/function/debug sources vanish, the ownership block becomes
 * the legacy flood expressions, and the guarded cluster blend, fluid
 * specular add, and debug tail disappear. The result is the
 * "local lights never existed" program the render-diff harness compares
 * against the shipped program at the off tier — byte-identical output is
 * the contract (see scripts/render-off-parity.mjs).
 */
export function stripLocalLightsFromFragment(fragment: string): string {
  return fragment
    .replace(LOCAL_LIGHTS_UNIFORM_DECLARATIONS, "")
    .replace(LOCAL_LIGHTS_FUNCTIONS, "")
    .replace(LOCAL_LIGHTS_DEBUG_FUNCTIONS, "")
    .replace(LOCAL_LIGHTS_OWNERSHIP_FRAGMENT, LEGACY_BLOCK_LIGHT_FRAGMENT)
    .replace(LOCAL_LIGHTS_BLEND_FRAGMENT, "\n")
    .replace(LOCAL_LIGHTS_SPECULAR_FRAGMENT, "\n")
    .replace(LOCAL_LIGHTS_DEBUG_TAIL_FRAGMENT, "\n");
}

const SIMPLEX_NOISE_GLSL = `
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}

float snoise(vec3 v){ 
  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy) );
  vec3 x0 =   v - i + dot(i, C.xxx) ;

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min( g.xyz, l.zxy );
  vec3 i2 = max( g.xyz, l.zxy );

  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1. + 3.0 * C.xxx;

  i = mod(i, 289.0 ); 
  vec4 p = permute( permute( permute( 
             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

  float n_ = 1.0/7.0;
  vec3  ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z *ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_ );

  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );

  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                dot(p2,x2), dot(p3,x3) ) );
}
`;

export const customShaders = {
  sway(
    options: Partial<{
      speed: number;
      amplitude: number;
      scale: number;
      rooted: boolean;
      yScale: number;
    }> = {},
  ) {
    return createSwayShader(SHADER_LIGHTING_CHUNK_SHADERS, options);
  },

  swayCross(
    options: Partial<{
      speed: number;
      amplitude: number;
      scale: number;
      rooted: boolean;
      yScale: number;
    }> = {},
  ) {
    return createSwayShader(SHADER_LIGHTING_CROSS_CHUNK_SHADERS, options);
  },
};

const FULL_CHUNK_SHADERS = {
  vertex: ShaderLib.basic.vertexShader
    .replace(
      "#include <common>",
      `
attribute int light;

// Quantized-position materials define this to the fixed-point scale
// (counts per block); the mesh matrix owns dequantization, so the shader
// only needs it where displacement math touches the raw position
// attribute. Float-position materials fall back to 1.0.
#ifndef POSITION_UNITS_PER_BLOCK
#define POSITION_UNITS_PER_BLOCK 1.0
#endif

// Bit map of the packed light attribute, mirroring
// crates/mesher/src/mesher/vertex_light.rs. Change neither side alone.
#define LIGHT_MASK 0xFFFF
#define AO_SHIFT 16
#define AO_BITS 0x3
#define FLUID_SHIFT 18
// Bit 19 is the greedy flag on a solid face and the pane flag on a fluid
// face (water pressed against a see-through tank wall rather than air).
#define GREEDY_SHIFT 19
#define FLUID_PANE_SHIFT 19
#define WAVE_SHIFT 20
#define WATER_EXPOSED_SHIFT 21
#define STACK_INDEX_SHIFT 22
#define STACK_COUNT_SHIFT 26
#define STACK_FIELD_BITS 0xF
#define EMISSIVE_SHIFT 30
// On a waving fluid vertex the count field is the surface flow: 0 still,
// else one of FLOW_DIRECTIONS directions in equal steps from +x toward +z.
#define FLOW_DIRECTIONS 15.0
#define FLOW_STEP_RADIANS (6.28318530718 / FLOW_DIRECTIONS)
// ...and its index field is the fluid standing below its corner — the mean
// over the columns sharing the corner — in these units per block, so the
// depth interpolates smoothly across a face instead of stepping per voxel.
// Mirrors SURFACE_DEPTH_UNITS_PER_BLOCK in vertex_light.rs.
#define SURFACE_DEPTH_UNITS_PER_BLOCK 4.0

uniform vec4 uEmissiveLevels;
varying float vEmissive;
varying float vAO;
varying float vIsFluid;
varying float vIsGreedy;
varying float vIsFluidPane;
varying float vFluidDepthBelow;
varying float vFluidRestY;
varying vec2 vFluidFlow;
varying vec4 vLight;
varying vec4 vWorldPosition;
varying vec3 vWorldNormal;
varying float vViewDepth;
varying float vWaterExposed;
varying float vWaterSurfaceY;
varying vec3 vAboveSurfaceWaterTransmit;
uniform vec4 uAOTable;
uniform float uWaterLevel;
uniform float uCameraSubmersion;
uniform float uTime;
uniform vec2 uWindDirection;
uniform vec2 uWindOffset;
uniform float uWindSpeed;
uniform mat4 uShadowMatrix0;
uniform mat4 uShadowMatrix1;
uniform mat4 uShadowMatrix2;
uniform float uShadowNormalBias;
varying vec4 vShadowCoord0;
varying vec4 vShadowCoord1;
varying vec4 vShadowCoord2;
// Per-section terrain reveal, 0 (pure fog tint) to 1 (drawn as itself). An
// arena section reads it from its batching color; a plain mesh has none and
// relies on the material's uChunkReveal uniform instead.
varying float vChunkReveal;

vec4 unpackLight(int l) {
  vec4 lightValues = vec4(
    (l >> 8) & 0xF,
    (l >> 4) & 0xF,
    l & 0xF,
    (l >> 12) & 0xF
  );
  return lightValues / 15.0;
}

${SIMPLEX_NOISE_GLSL}

#include <common>
`,
    )
    .replace(
      "#include <color_vertex>",
      `
// Stands in for <color_vertex>. Chunk geometry carries no color attribute
// (the material's default fills white), and the region arenas' per-instance
// batching color is a data channel, not a tint: three's chunk would multiply
// it into vColor and darken the section. Read the reveal factor out of it
// here and keep vColor white. Leans on three's batching helpers
// (getBatchingColor, getIndirectIndex) the same way the displacement code
// below leans on its batchingMatrix.
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
  vColor = vec4( 1.0 );
#endif
#ifdef USE_BATCHING_COLOR
  vChunkReveal = getBatchingColor( getIndirectIndex( gl_DrawID ) ).r;
#else
  vChunkReveal = 1.0;
#endif

// Mirrors the bit map in crates/mesher/src/mesher/vertex_light.rs. The two
// must agree; that file is the reference for which field owns which bit.
int ao = (light >> AO_SHIFT) & AO_BITS;
int isFluid = (light >> FLUID_SHIFT) & 0x1;
// A fluid never comes off the greedy path, so on a fluid vertex bit 19 is
// the pane flag instead: this vertical face presses against a see-through
// solid (a tank window), not open air.
int bit19 = (light >> GREEDY_SHIFT) & 0x1;
int isGreedy = bit19 & (1 - isFluid);
int isFluidPane = bit19 & isFluid;
int isWaterExposed = (light >> WATER_EXPOSED_SHIFT) & 0x1;

int stackIndex = (light >> STACK_INDEX_SHIFT) & STACK_FIELD_BITS;
int stackCount = ((light >> STACK_COUNT_SHIFT) & STACK_FIELD_BITS) + 1;

// A fluid vertex that waves sits on its column's surface, so its count is
// its index plus one and the count field carries the surface flow at this
// corner instead: 0 for still water, else a direction in equal steps from
// +x toward +z. Decoded here and interpolated, so the fragment stage sees
// one continuous field across the sheet rather than a slope per face.
int isSurfaceVertex = isFluid & ((light >> WAVE_SHIFT) & 0x1);
vFluidFlow = vec2(0.0);
if (isSurfaceVertex == 1) {
  int flowCode = (light >> STACK_COUNT_SHIFT) & STACK_FIELD_BITS;
  stackCount = stackIndex + 1;
  if (flowCode > 0) {
    float flowAngle = float(flowCode - 1) * FLOW_STEP_RADIANS;
    vFluidFlow = vec2(cos(flowAngle), sin(flowAngle));
  }
}

vAO = uAOTable[ao] / 255.0;
vIsFluid = float(isFluid);
vIsGreedy = float(isGreedy);
vIsFluidPane = float(isFluidPane);
vWaterExposed = float(isWaterExposed);
vLight = unpackLight(light & LIGHT_MASK);

// Under the emissive bit the AO bits are a strength index, not occlusion —
// the face bypasses the lighting model, so its vAO is never read.
vEmissive = float((light >> EMISSIVE_SHIFT) & 0x1) * uEmissiveLevels[ao];

// Where this vertex sits in its vertical run, for displacement later in this
// shader. A block that does not stack reports a single-block run, which
// makes every effect keyed on these degrade to acting on the block alone.
// Locals rather than varyings: nothing downstream of the vertex stage reads
// them, and an interpolator is not free.
float stackIndexF = float(stackIndex);
float stackHeight = float(stackCount);

// Blocks of fluid standing above this one, from the run the mesher measured
// down from this column's own surface. Saturates at the field width, by
// which depth the water is black anyway.
float fluidAbove = stackHeight - 1.0 - stackIndexF;
`,
    )
    .replace(
      "#include <begin_vertex>",
      `
vec3 transformed = vec3(position);

int shouldWave = (light >> WAVE_SHIFT) & 0x1;
if (shouldWave == 1) {
  vec4 wavePosition = vec4(position, 1.0);
#ifdef USE_BATCHING
  wavePosition = batchingMatrix * wavePosition;
#endif
  vec3 worldPosForWave = (modelMatrix * wavePosition).xyz;

  // A surface vertex at the top of its voxel is a spill corner: the mesher
  // raises a corner to the full block wherever fluid stands on a voxel
  // sharing it, so a lower sheet meets the wall of the block pouring onto
  // it. That wall's bottom edge sits on its voxel floor and never waves,
  // so the corner welded to it must not either — bobbing it opened a slit
  // between the two that showed the riser behind, at every step of a
  // cascade. Height alone names the corner: a resting surface sits at
  // fluidSurfaceHeight and every stage only lowers it, so nothing else
  // reaches this high (calculate_fluid_corner_height in the mesher). A
  // surface vertex sits at vy + h with h in (0, 1], so ceil(y) - 1 is its
  // voxel, the same read the depth varying makes below.
  float waveVoxelY = ceil(worldPosForWave.y - 1e-3) - 1.0;
  float waveRestHeight = worldPosForWave.y - waveVoxelY;
  if (waveRestHeight < ${FLUID_SPILL_CORNER_MIN_HEIGHT.toFixed(4)}) {
    float waveTime = uTime * 0.0006;

    float wave1 = snoise(vec3(worldPosForWave.x * 0.15 + waveTime * 0.3, worldPosForWave.z * 0.15 - waveTime * 0.2, 0.0)) * 0.08;
    float wave2 = snoise(vec3(worldPosForWave.x * 0.4 - waveTime * 0.5, worldPosForWave.z * 0.4 + waveTime * 0.4, 10.0)) * 0.04;
    float wave3 = snoise(vec3(worldPosForWave.x * 0.8 + waveTime * 0.7, worldPosForWave.z * 0.8 - waveTime * 0.5, 20.0)) * 0.02;

    transformed.y += (wave1 + wave2 + wave3) * POSITION_UNITS_PER_BLOCK;
  }
}
`,
    )
    .replace(
      "#include <worldpos_vertex>",
      `
vec4 worldPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  worldPosition = batchingMatrix * worldPosition;
#endif
#ifdef USE_INSTANCING
  worldPosition = instanceMatrix * worldPosition;
#endif
worldPosition = modelMatrix * worldPosition;
vWorldPosition = worldPosition;

vec3 objectNormal = normal;
#ifdef USE_BATCHING
  objectNormal = mat3(batchingMatrix) * objectNormal;
#endif
vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);

// The surface that governs this fragment's water shading. A fluid reads its
// own column, so a pond on a hilltop and a pond in a cellar both look like
// water; everything else keeps the world's nominal waterline, which is still
// the right answer for terrain sitting under a sea. Accurate to within a
// block, which is far finer than an exponential falloff can show.
vWaterSurfaceY = isFluid == 1 ? worldPosition.y + fluidAbove : uWaterLevel;

// Water standing under a surface vertex, down to the column's floor: the
// surface height inside its own voxel plus the blocks the mesher counted
// below the vertex's corner — the mean over the columns sharing it, in
// SURFACE_DEPTH_UNITS_PER_BLOCK units, so a step in the bed ramps across
// the faces on either side instead of jumping at the voxel border. A fluid
// vertex under the surface keeps its own column's whole-block count.
// Measured from the rest position — the wave offset above could carry a
// vertex near the top of its voxel into the next one and jump the depth by
// a block. A surface vertex sits at vy + h with h in (0, 1], so ceil(y) - 1
// is its voxel. Meaningful on top faces only; a side face's bottom row
// lands one voxel low, and the fragment stage never reads it there.
vec4 restWorldPosition = vec4(position, 1.0);
#ifdef USE_BATCHING
  restWorldPosition = batchingMatrix * restWorldPosition;
#endif
#ifdef USE_INSTANCING
  restWorldPosition = instanceMatrix * restWorldPosition;
#endif
restWorldPosition = modelMatrix * restWorldPosition;
float fluidVoxelY = ceil(restWorldPosition.y - 1e-3) - 1.0;
float fluidBelowBlocks = isSurfaceVertex == 1
  ? stackIndexF / SURFACE_DEPTH_UNITS_PER_BLOCK
  : stackIndexF;
vFluidDepthBelow = float(isFluid) * (restWorldPosition.y - fluidVoxelY + fluidBelowBlocks);
vFluidRestY = restWorldPosition.y;
vAboveSurfaceWaterTransmit = vec3(1.0);
if (
  isWaterExposed == 1
  && uCameraSubmersion < 1.0
  && cameraPosition.y > uWaterLevel
) {
  vec3 aswRay = worldPosition.xyz - cameraPosition;
  float aswDist = max(length(aswRay), 1e-4);
  float aswSubmergedFraction = clamp(
    (uWaterLevel - worldPosition.y)
      / max(cameraPosition.y - worldPosition.y, 1e-4),
    0.0,
    1.0
  );
  float aswPath = aswDist * aswSubmergedFraction;
  vAboveSurfaceWaterTransmit = exp(
    -${WATER_VIEW_EXTINCTION_GLSL} * aswPath
  );
}

vec4 viewPos = viewMatrix * worldPosition;
vViewDepth = -viewPos.z;

float normalOffsetScale = uShadowNormalBias;
vec3 normalOffset = vWorldNormal * normalOffsetScale;
vec4 offsetPosition = worldPosition + vec4(normalOffset, 0.0);

vShadowCoord0 = uShadowMatrix0 * offsetPosition;
vShadowCoord1 = uShadowMatrix1 * offsetPosition;
vShadowCoord2 = uShadowMatrix2 * offsetPosition;
`,
    ),
  fragment: ShaderLib.basic.fragmentShader
    .replace(
      "#include <common>",
      `
${SKY_FOG_UNIFORM_DECLARATIONS}
${LIGHT_CONES_UNIFORM_DECLARATIONS}
${LOCAL_LIGHTS_UNIFORM_DECLARATIONS}
varying float vChunkReveal;
uniform float uTime;
uniform float uAtlasSize;
uniform float uShowGreedyDebug;

uniform vec3 uAmbientColor;
uniform float uMinLightLevel;
uniform float uBaseAmbient;
uniform vec4 uFaceShades;

uniform sampler2D uShadowMap0;
uniform sampler2D uShadowMap1;
uniform sampler2D uShadowMap2;
uniform float uCascadeSplit0;
uniform float uCascadeSplit1;
uniform float uCascadeSplit2;
uniform float uShadowBias;
uniform float uShadowSlopeBiasScale;
uniform float uShadowSlopeBiasMin;
uniform float uShadowTopFaceBiasScale;
uniform float uShadowSideFaceBiasScale;
uniform float uShadowStrength;

uniform vec3 uWaterTint;
uniform float uWaterAbsorption;
uniform float uWaterLevel;
uniform float uWaterStreakStrength;
uniform float uWaterFresnelStrength;
// The celestial disc as the sky box draws it (sun by day, moon by night),
// never clamped or tilted the way the shading light uSunDirection is. The
// water's specular mirrors this so the sun on the water sits under the sun
// in the sky; diffuse shading and shadows keep the shading light.
uniform vec3 uCelestialDirection;
// The tileable ripple slope map (water-normal-texture.ts). Declared for every
// chunk variant because the fluid branch below must parse even where it is
// compiled out; inactive there, so it binds no unit on terrain materials.
uniform sampler2D uWaterNormalMap;
uniform sampler2D uSceneColor;
uniform vec2 uSceneTextureSize;
uniform float uWaterRefractionReady;
uniform float uWaterRefractionStrength;

uniform vec3 uSkyTopColor;
uniform vec3 uSkyMiddleColor;
uniform float uShadowDebugMode;

varying float vAO;
varying float vIsFluid;
varying float vIsGreedy;
varying float vIsFluidPane;
varying float vFluidDepthBelow;
varying float vFluidRestY;
varying vec2 vFluidFlow;
varying vec4 vLight;
varying vec4 vWorldPosition;
varying vec3 vWorldNormal;
varying float vViewDepth;
varying float vWaterExposed;
varying float vWaterSurfaceY;
varying vec3 vAboveSurfaceWaterTransmit;
varying float vEmissive;
varying vec4 vShadowCoord0;
varying vec4 vShadowCoord1;
varying vec4 vShadowCoord2;

${SIMPLEX_NOISE_GLSL}

${LIGHT_CONES_FUNCTIONS}

${LOCAL_LIGHTS_FUNCTIONS}

${LOCAL_LIGHTS_DEBUG_FUNCTIONS}

float shadowMapEdgeFade(vec3 coord) {
  float fadeWidth = 0.08;
  float fx = smoothstep(0.0, fadeWidth, coord.x) * smoothstep(0.0, fadeWidth, 1.0 - coord.x);
  float fy = smoothstep(0.0, fadeWidth, coord.y) * smoothstep(0.0, fadeWidth, 1.0 - coord.y);
  return fx * fy;
}

const float SHADOW_RECEIVER_PLANE_EPSILON = 0.000001;

vec2 shadowReceiverPlaneDepthBias(vec3 coord) {
  vec3 dx = dFdx(coord);
  vec3 dy = dFdy(coord);
  float determinant = dx.x * dy.y - dx.y * dy.x;
  if (abs(determinant) < SHADOW_RECEIVER_PLANE_EPSILON) {
    return vec2(0.0);
  }

  return vec2(
    (dy.y * dx.z - dx.y * dy.z) / determinant,
    (dx.x * dy.z - dy.x * dx.z) / determinant
  );
}

float sampleShadowMapFast(sampler2D shadowMap, vec4 shadowCoord, float slopeBias, float receiverBiasScale) {
  vec3 coord = shadowCoord.xyz / shadowCoord.w;
  coord = coord * 0.5 + 0.5;
  vec2 receiverPlaneBias = shadowReceiverPlaneDepthBias(coord);

  if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z < 0.0 || coord.z > 1.0) {
    return 1.0;
  }

  float bias = (uShadowBias + slopeBias) * receiverBiasScale;
  vec2 texelSize = vec2(1.0) / vec2(textureSize(shadowMap, 0));

  vec2 offset = vec2(0.0);
  float receiverDepth = coord.z + dot(receiverPlaneBias, offset);
  float shadow = (receiverDepth - bias > texture(shadowMap, coord.xy + offset).r) ? 0.0 : 1.0;
  offset = texelSize * vec2(-1.0, -1.0);
  receiverDepth = coord.z + dot(receiverPlaneBias, offset);
  shadow += (receiverDepth - bias > texture(shadowMap, coord.xy + offset).r) ? 0.0 : 1.0;
  offset = texelSize * vec2(1.0, -1.0);
  receiverDepth = coord.z + dot(receiverPlaneBias, offset);
  shadow += (receiverDepth - bias > texture(shadowMap, coord.xy + offset).r) ? 0.0 : 1.0;
  offset = texelSize * vec2(-1.0, 1.0);
  receiverDepth = coord.z + dot(receiverPlaneBias, offset);
  shadow += (receiverDepth - bias > texture(shadowMap, coord.xy + offset).r) ? 0.0 : 1.0;
  offset = texelSize * vec2(1.0, 1.0);
  receiverDepth = coord.z + dot(receiverPlaneBias, offset);
  shadow += (receiverDepth - bias > texture(shadowMap, coord.xy + offset).r) ? 0.0 : 1.0;

  shadow /= 5.0;
  return mix(1.0, shadow, shadowMapEdgeFade(coord));
}

const vec2 POISSON_DISK[8] = vec2[8](
  vec2(-0.94201624, -0.39906216),
  vec2(0.94558609, -0.76890725),
  vec2(-0.094184101, -0.92938870),
  vec2(0.34495938, 0.29387760),
  vec2(-0.91588581, 0.45771432),
  vec2(-0.81544232, -0.87912464),
  vec2(0.97484398, 0.75648379),
  vec2(0.44323325, -0.97511554)
);

float sampleShadowMap(sampler2D shadowMap, vec4 shadowCoord, float slopeBias, float receiverBiasScale) {
  vec3 coord = shadowCoord.xyz / shadowCoord.w;
  coord = coord * 0.5 + 0.5;
  vec2 receiverPlaneBias = shadowReceiverPlaneDepthBias(coord);

  if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z < 0.0 || coord.z > 1.0) {
    return 1.0;
  }

  float bias = (uShadowBias + slopeBias) * receiverBiasScale;
  vec2 texelSize = vec2(1.0) / vec2(textureSize(shadowMap, 0));

  float shadow = 0.0;
  float totalWeight = 0.0;
  for (int x = -2; x <= 2; x++) {
    for (int y = -2; y <= 2; y++) {
      float weight = (3.0 - abs(float(x))) * (3.0 - abs(float(y)));
      vec2 offset = vec2(float(x), float(y)) * texelSize;
      float depth = texture(shadowMap, coord.xy + offset).r;
      float receiverDepth = coord.z + dot(receiverPlaneBias, offset);
      shadow += weight * ((receiverDepth - bias > depth) ? 0.0 : 1.0);
      totalWeight += weight;
    }
  }

  shadow /= totalWeight;
  return mix(1.0, shadow, shadowMapEdgeFade(coord));
}

float getShadow() {
  float NdotL = dot(vWorldNormal, uSunDirection);
  if (NdotL <= 0.0) {
    return mix(1.0, 0.0, uShadowStrength);
  }

  if (uShadowStrength < 0.01) {
    return 1.0;
  }

  float sunExposure = vLight.a;
  if (sunExposure < 0.05) {
    return mix(1.0, 0.0, uShadowStrength);
  }

  float slopeBias = max(uShadowSlopeBiasScale * (1.0 - NdotL), uShadowSlopeBiasMin);
  float topFaceReceiver = smoothstep(0.5, 0.95, vWorldNormal.y);
  float sideFaceReceiver = smoothstep(0.5, 0.95, max(abs(vWorldNormal.x), abs(vWorldNormal.z)));
  float receiverBiasScale = mix(1.0, uShadowSideFaceBiasScale, sideFaceReceiver);
  receiverBiasScale = mix(receiverBiasScale, uShadowTopFaceBiasScale, topFaceReceiver);
  float blendRegion = 0.1;

  float rawShadow;
  if (vViewDepth < uCascadeSplit0) {
    float shadow0 = sampleShadowMap(uShadowMap0, vShadowCoord0, slopeBias, receiverBiasScale);
    float blendStart = uCascadeSplit0 * (1.0 - blendRegion);
    if (vViewDepth > blendStart) {
      float shadow1 = sampleShadowMap(uShadowMap1, vShadowCoord1, slopeBias * 1.5, receiverBiasScale);
      float t = (vViewDepth - blendStart) / (uCascadeSplit0 - blendStart);
      rawShadow = mix(shadow0, shadow1, t);
    } else {
      rawShadow = shadow0;
    }
  } else if (vViewDepth < uCascadeSplit1) {
    float shadow1 = sampleShadowMap(uShadowMap1, vShadowCoord1, slopeBias * 1.5, receiverBiasScale);
    float blendStart = uCascadeSplit1 * (1.0 - blendRegion);
    if (vViewDepth > blendStart) {
      float shadow2 = sampleShadowMapFast(uShadowMap2, vShadowCoord2, slopeBias * 2.0, receiverBiasScale);
      float t = (vViewDepth - blendStart) / (uCascadeSplit1 - blendStart);
      rawShadow = mix(shadow1, shadow2, t);
    } else {
      rawShadow = shadow1;
    }
  } else if (vViewDepth < uCascadeSplit2) {
    float shadow2 = sampleShadowMapFast(uShadowMap2, vShadowCoord2, slopeBias * 2.0, receiverBiasScale);
    float fadeStart = uCascadeSplit2 * (1.0 - blendRegion);
    if (vViewDepth > fadeStart) {
      float t = (vViewDepth - fadeStart) / (uCascadeSplit2 - fadeStart);
      rawShadow = mix(shadow2, 1.0, t);
    } else {
      rawShadow = shadow2;
    }
  } else {
    return 1.0;
  }

  return mix(1.0, rawShadow, uShadowStrength);
}

#include <common>
`,
    )
    .replace(
      "#include <map_fragment>",
      `
#ifdef USE_MAP
  vec2 finalUv;
  
  if (vIsGreedy > 0.5) {
    float cellSize = 1.0 / uAtlasSize;
    float padding = cellSize / 4.0;
    
    vec3 absNormal = abs(vWorldNormal);
    vec2 localUv;
    if (absNormal.y > 0.5) {
      if (vWorldNormal.y > 0.0) {
        localUv = vec2(1.0 - fract(vWorldPosition.x), fract(vWorldPosition.z));
      } else {
        localUv = vec2(fract(vWorldPosition.x), 1.0 - fract(vWorldPosition.z));
      }
    } else if (absNormal.x > 0.5) {
      if (vWorldNormal.x > 0.0) {
        localUv = vec2(1.0 - fract(vWorldPosition.z), fract(vWorldPosition.y));
      } else {
        localUv = vec2(fract(vWorldPosition.z), fract(vWorldPosition.y));
      }
    } else {
      if (vWorldNormal.z > 0.0) {
        localUv = vec2(fract(vWorldPosition.x), fract(vWorldPosition.y));
      } else {
        localUv = vec2(1.0 - fract(vWorldPosition.x), fract(vWorldPosition.y));
      }
    }
    
    vec2 cellMin = floor(vMapUv / cellSize) * cellSize;
    vec2 innerMin = cellMin + padding;
    float innerSize = cellSize - padding * 2.0;
    finalUv = innerMin + localUv * innerSize;
  } else {
    finalUv = vMapUv;
  }
  
  
  vec4 sampledDiffuseColor = texture2D(map, finalUv);
  #ifdef DECODE_VIDEO_TEXTURE
    sampledDiffuseColor = vec4(mix(pow(sampledDiffuseColor.rgb * 0.9478672986 + vec3(0.0521327014), vec3(2.4)), sampledDiffuseColor.rgb * 0.0773993808, vec3(lessThanEqual(sampledDiffuseColor.rgb, vec3(0.04045)))), sampledDiffuseColor.w);
  #endif
  
  if (uShowGreedyDebug > 0.5) {
    if (vIsGreedy > 0.5) {
      sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, vec3(0.0, 1.0, 0.0), 0.4);
    } else {
      sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, vec3(1.0, 0.0, 0.0), 0.4);
    }
  }
  
  diffuseColor *= sampledDiffuseColor;
#endif
`,
    )
    .replace(
      "#include <envmap_fragment>",
      `
#include <envmap_fragment>

float shadow = getShadow();

float rawNdotL = dot(vWorldNormal, uSunDirection);
float NdotL = max(rawNdotL * 0.85 + 0.15, 0.0);
float sunExposure = vLight.a;

vec3 sunContribution = uSunColor * NdotL * shadow * uSunlightIntensity * sunExposure;

vec3 cpuTorchLight = vLight.rgb;
vec3 smoothTorch = cpuTorchLight * cpuTorchLight * (3.0 - 2.0 * cpuTorchLight);
${LOCAL_LIGHTS_OWNERSHIP_FRAGMENT}

float ambientFloor = max(uMinLightLevel + uBaseAmbient, 0.0);
float sunVisibility = clamp(sunExposure, 0.0, 1.0);
vec3 downTransmit = vec3(1.0);
vec3 underwaterFill = vec3(0.0);
// Seen from under water, terrain is lit by what the column above it lets
// down. The column is measured from the surface of the water the camera is
// in (uCameraWaterPlaneY), never from the world's nominal waterline:
// uWaterLevel is a sea level, and a world without a sea keeps the default,
// so a pool on flat ground at y=5 charged eighty blocks of extinction to
// every fragment in view — black terrain fogged toward the ambient, the
// whole scene a dark green. For a sea the two agree anyway.
//
// Only a face that touches water is under it. The mesher marks those
// (vWaterExposed); a dry face below the plane — the ground past a pool's
// wall, a lit pocket beside a flooded shaft — keeps its air lighting.
// Sunlight cannot tell the two apart: water is light-invariant in the
// light grid, so a seabed under open sky reads as bright as a beach.
if (uCameraSubmersion > 0.001 && vWorldPosition.y < uCameraWaterPlaneY) {
  float fragmentWaterDepth = uCameraWaterPlaneY - vWorldPosition.y;
  float isFragmentUnderwater = max(vWaterExposed, vIsFluid);

  // The branch is camera-uniform and skips four exponentials on every dry
  // terrain pixel; mix() would evaluate the expensive argument eagerly.
  // Inside it the blend rides the smoothed submersion, so the terrain
  // crosses over with the fog and the water surface as the camera breaks
  // the waterline instead of snapping at the first submerged frame.
  float submergedShade = uCameraSubmersion * isFragmentUnderwater;
  downTransmit = mix(
    vec3(1.0),
    exp(-${WATER_DOWNWELLING_EXTINCTION_GLSL} * fragmentWaterDepth),
    submergedShade
  );
  underwaterFill = ${WATER_SURFACE_SCATTER_GLSL}
    * (${WATER_OPTICS.scatterFillSunStrength.toFixed(
      4,
    )} * uSunlightIntensity + ${WATER_OPTICS.scatterFillBase.toFixed(4)})
    * downTransmit * submergedShade;
}
vec3 globalAmbient =
  (vec3(0.025, 0.03, 0.04) * sunVisibility + uAmbientColor * ambientFloor) * downTransmit;

float ambientOcclusion = mix(0.72, 1.0, shadow);
float tunnelDarkening = mix(ambientFloor, 1.0, sunVisibility);

float hemisphereBlend = vWorldNormal.y * 0.5 + 0.5;
vec3 groundColor = uAmbientColor * 0.4;
vec3 skyAmbient = mix(groundColor, uAmbientColor, hemisphereBlend);

float texLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
float isBrightTex = smoothstep(0.75, 0.95, texLuma);

float aoFactor = mix(vAO, 1.0, vIsFluid * 0.8);
float torchDominance = torchBrightness / (torchBrightness + dot(sunContribution, vec3(0.33)) + 0.01);
float torchAOReduction = torchDominance * 0.03;
float enhancedAO = mix(aoFactor, 1.0, torchAOReduction);

// Constant per-axis face shade (uFaceShades: x = +-X, y = +-Z, z = -Y, w = +Y)
// keeps adjacent faces of a cube distinct even when sun and flood-fill light
// give them identical values, so convex edges stay readable in flat lighting.
vec3 faceShadeWeights = abs(vWorldNormal);
faceShadeWeights /= max(faceShadeWeights.x + faceShadeWeights.y + faceShadeWeights.z, 0.0001);
float verticalFaceShade = vWorldNormal.y > 0.0 ? uFaceShades.w : uFaceShades.z;
float faceShade = faceShadeWeights.x * uFaceShades.x
  + faceShadeWeights.z * uFaceShades.y
  + faceShadeWeights.y * verticalFaceShade;

vec3 sunTotal = skyAmbient * ambientOcclusion * tunnelDarkening * downTransmit;
vec3 reducedSun = sunContribution * mix(1.0, 0.7, isBrightTex);
reducedSun *= downTransmit;
sunTotal += reducedSun;

vec3 bounceLight = uAmbientColor * 0.04 * (1.0 - shadow) * sunExposure * uSunlightIntensity;
bounceLight *= downTransmit;
sunTotal += bounceLight;
sunTotal += globalAmbient;
sunTotal += underwaterFill;

vec3 totalLight = 1.0 - (1.0 - sunTotal) * (1.0 - torchLight);

// Dynamic cones (flashlight, headlights) screen-blend in like torch light,
// piercing the water's ambient attenuation with their own Beer-Lambert
// falloff handled inside lightConeSurface.
vec3 coneLight = lightConeSurface(vWorldPosition.xyz, vWorldNormal);
totalLight = 1.0 - (1.0 - totalLight) * (1.0 - coneLight);

${LOCAL_LIGHTS_BLEND_FRAGMENT}

vec3 warmTint = vec3(1.05, 0.92, 0.75);
vec3 coolTint = vec3(0.92, 0.95, 1.05);
vec3 temperatureShift = mix(coolTint, warmTint, torchDominance);
totalLight *= temperatureShift;

totalLight *= enhancedAO;
totalLight *= faceShade;

totalLight = (totalLight * (2.51 * totalLight + 0.03))
           / (totalLight * (2.43 * totalLight + 0.59) + 0.14);
vec3 darknessFloor = vec3(ambientFloor) *
  mix(vec3(0.8, 0.88, 1.0), vec3(1.0), sunVisibility) * downTransmit;
totalLight = max(totalLight, darknessFloor * faceShade);

// An emissive face is its own light source: it bypasses the lighting model
// entirely and renders the texture at its declared strength. Fog and water
// shading still apply after, so a distant lava lake fades like everything
// else.
if (vEmissive > 0.0) {
  outgoingLight.rgb = diffuseColor.rgb * vEmissive;
} else {
  outgoingLight.rgb *= totalLight;
}

${ABOVE_SURFACE_WATER_FOG_FRAGMENT}

if (vIsFluid > 0.5) {
  float waveTime = uTime * 0.0005;
  vec3 wPos = vWorldPosition.xyz;
  vec3 absWaterNormal = abs(vWorldNormal);
  float topWaterFace = smoothstep(0.45, 0.9, vWorldNormal.y);
  float sideWaterFace = smoothstep(0.45, 0.9, max(absWaterNormal.x, absWaterNormal.z));

  // In air, only the outward water face draws. Fluids are DoubleSide and
  // do not write depth, so the near wall, its back, the far wall, and the
  // underside of the surface would otherwise stack into a milky pane —
  // the thing a Barrier tank window is supposed to not be. Underwater
  // viewing keeps both sides so the surface is still visible from below.
  if (uCameraSubmersion < 0.5 && !gl_FrontFacing) {
    discard;
  }
  // The window treatment below is only for a vertical face pressed against
  // a see-through solid — the mesher flags those as panes. A vertical face
  // against air is the water's own surface (the front of a spreading flow,
  // a waterfall, a leak's edge) and keeps the lake shading: fading or
  // culling it left a spread's edge walls missing under its floating top.
  float airSideFace = sideWaterFace * (1.0 - uCameraSubmersion) * vIsFluidPane;
  vec3 viewDir = normalize(cameraPosition - wPos);
  // Head-on tank walls drop out entirely (Barrier windows are supposed to
  // be a hole). Geometric normal, not the waved one — sides never wave.
  float geoNdotV = max(dot(vWorldNormal, viewDir), 0.0);
  if (airSideFace * geoNdotV > ${WATER_OPTICS.airSideFaceCullCos.toFixed(4)}) {
    discard;
  }

  float distToCamera = length(cameraPosition - wPos);

  // Distance bands from WATER_OPTICS for the near-water cues (crests,
  // caustics, flow, the tight glint) and the far handover of grazing
  // reflectivity. The ripple normal itself needs no band: the slope map's
  // mip chain averages it flat as its features go subpixel.
  float rippleLod = 1.0 - smoothstep(
    ${WATER_OPTICS.rippleFadeStartBlocks.toFixed(1)},
    ${WATER_OPTICS.rippleFadeEndBlocks.toFixed(1)},
    distToCamera
  );
  float baseWaveLod = 1.0 - smoothstep(
    ${WATER_OPTICS.baseWaveFadeStartBlocks.toFixed(1)},
    ${WATER_OPTICS.baseWaveFadeEndBlocks.toFixed(1)},
    distToCamera
  );

  // Side and bottom faces keep their geometric normal. Top faces read theirs
  // from the tileable ripple slope map, sampled at three world scales and
  // summed (WATER_OPTICS.surfaceNormalLayers): a swell, ripples on it, and
  // capillary texture on those, each drifting on its own heading. Ridged
  // noise gives the field sharp crests between smooth troughs, so the sun
  // breaks into glitter on it and the sky reflection has grain — the four
  // analytic sinusoids this replaces had no crease anywhere and rendered
  // both as one smooth bulge. The lens term is where the slope field is
  // locally flat — the surface focusing light onto the floor — and drives
  // the caustics below, so they travel with the ripples they belong to.
  vec3 waterNormal = vWorldNormal;
  float causticLens = 0.0;
  // Height channel of the medium and fine layers, for crest highlights.
  float crestMed = 0.5;
  float crestFine = 0.5;
  // Flow. Water runs downhill along its own surface, and the top face is a
  // bilinear patch through the mesher's corner heights, which step down one
  // stage per block away from the source. That rest height is a potential
  // for the flow: neighbouring faces share their corners, so it is
  // continuous across the whole sheet, and it falls away from the source.
  // Its contours are the crests of a flow running downstream — smooth
  // across every face by construction, dense where the fall is steep, and
  // absent on still water, whose surface is flat. The wave displacement
  // never enters: the varying is the rest height.
  //
  // Downhill, for tilting the normal, is the mesher's per-corner flow,
  // interpolated across the face. Its length is the strength: unit inside
  // a running sheet, shrinking to nothing across a face whose far corners
  // sit on still water. (A slope read per face from screen derivatives
  // left a visible seam wherever two faces disagreed on direction — the
  // straight run through a spread's middle against its diagonal wings.)
  // flowTilt is the crest wave along the flow vector (direction times
  // strength); flowCrest is the same wave scaled by strength alone, for the
  // highlight.
  vec2 flowTilt = vec2(0.0);
  float flowCrest = 0.0;
  if (vWorldNormal.y >= 0.5) {
    // A slow isotropic wobble bends the contours so they read as water,
    // not as a survey map; continuous, so it cannot introduce a seam.
    float flowWobble = sin(wPos.x * 1.7 + wPos.z * 1.1 + waveTime * 0.9) * 0.5
      + sin(wPos.z * 2.3 - wPos.x * 0.7 - waveTime * 1.3) * 0.35;
    float flowPhase = -vFluidRestY * ${FLOW_CREST_PHASE_PER_HEIGHT.toFixed(4)}
      - waveTime * ${WATER_OPTICS.flowBandSpeed.toFixed(4)}
      + flowWobble;
    float flowWave = cos(flowPhase) * rippleLod;
    flowTilt = vFluidFlow * flowWave;
    flowCrest = flowWave * min(length(vFluidFlow), 1.0);
  }
  if (vWorldNormal.y >= 0.5) {
    float waterSeconds = uTime * 0.001;
    vec2 waterSlopeSum = vec2(0.0);
${WATER_SURFACE_NORMAL_LAYERS_GLSL}
    crestMed = waterTexel1.b;
    crestFine = waterTexel2.b;
    // The bump eases off toward grazing incidence, on the geometric normal
    // so the ripples cannot pump their own fade: at the horizon they are
    // subpixel and would only add noise to what should mirror the sky.
    float bumpScale = mix(
      ${WATER_OPTICS.grazingBumpKeep.toFixed(4)},
      1.0,
      geoNdotV
    );
    vec2 waterSlope = waterSlopeSum * bumpScale
      // The flow crests tilt the normal too, so reflection, refraction and
      // the caustics below all travel downstream with them.
      + flowTilt * ${WATER_OPTICS.flowSlopeAmplitude.toFixed(4)};
    waterNormal = normalize(vec3(waterSlope.x, 1.0, waterSlope.y));
    // A facet steep enough to reflect the view ray back down into the water
    // is eased toward flat, so the reflection never samples the sky from
    // under the horizon.
    vec3 foldProbe = reflect(-viewDir, waterNormal);
    float foldback = pow(
      1.0 - max(dot(vWorldNormal, foldProbe), 0.0),
      ${WATER_OPTICS.reflectionFoldbackExponent.toFixed(1)}
    ) * ${WATER_OPTICS.reflectionFoldbackStrength.toFixed(4)};
    waterNormal = normalize(mix(waterNormal, vWorldNormal, foldback));
    causticLens = 1.0 - smoothstep(
      0.0,
      ${WATER_OPTICS.causticLensSlope.toFixed(4)},
      length(waterSlope)
    );
  }

  float NdotV = max(dot(waterNormal, viewDir), 0.0);
  float fresnelBase = mix(0.01, 0.04, topWaterFace);
  float fresnelMax = mix(0.22, 0.56, topWaterFace);
  float fresnel = fresnelBase + uWaterFresnelStrength * pow(1.0 - NdotV, 5.0);
  fresnel = clamp(fresnel, 0.01, fresnelMax);
  // Where the large octave has faded, its statistical effect on grazing
  // reflectivity is applied instead, so far water keeps the tint-dominant
  // shade it had when the octave was evaluated per fragment.
  fresnel *= mix(${WATER_OPTICS.distantFresnelFactor.toFixed(
    4,
  )}, 1.0, baseWaveLod);

  // Head-on tank walls keep none of the lake-surface gloss; grazing
  // waterfall sides keep most of it. NdotV is 1 looking straight at the
  // pane and falls off at an angle.
  float airSideWeight = airSideFace * NdotV;
  float airSideGloss = mix(
    1.0,
    ${WATER_OPTICS.airSideFaceGlossScale.toFixed(4)},
    airSideWeight
  );
  fresnel *= airSideGloss;

  vec3 reflectDir = reflect(-viewDir, waterNormal);
  // The dome the sky shader draws, read along the reflected ray with the
  // same offset and exponent: a bright horizon band climbing into the
  // zenith color. A ripple that tips the ray toward the horizon picks up
  // the horizon's light, which is the grain a water reflection has; the
  // flat two-color ramp this replaces barely changed across a whole facet.
  float skyH = normalize(reflectDir * uSkyFogDimension + uSkyFogOffset).y;
  vec3 skyReflection = mix(
    uSkyMiddleColor,
    uSkyTopColor,
    pow(max(skyH, 0.0), uSkyFogExponent)
  );

  // Seen from below, the surface only transmits sky within the Snell window
  // overhead; grazing angles reflect the dark water body instead.
  float snellWindow = smoothstep(0.55, 0.78, abs(dot(waterNormal, viewDir)));
  vec3 belowSurfaceSky = mix(uUnderwaterAmbient, skyReflection, snellWindow);
  skyReflection = mix(skyReflection, belowSurfaceSky, uCameraSubmersion);

  // Both the lobes and the glint mirror the drawn disc, not the shading
  // light: that one is held above a minimum elevation and tilted off the
  // sun's plane for terrain's sake, which put the reflection a good twenty
  // degrees to one side of the sun and closer than its mirror point.
  vec3 halfVec = normalize(uCelestialDirection + viewDir);
  float specAngle = max(dot(waterNormal, halfVec), 0.0);
  float spec32 = specAngle * specAngle;
  spec32 *= spec32;
  spec32 *= spec32;
  spec32 *= spec32;
  spec32 *= spec32;
  float specMed = spec32 * spec32 * spec32 * uSunlightIntensity
    * ${WATER_OPTICS.specularMediumStrength.toFixed(4)};
  vec3 specularColor = uSunColor * (
    spec32 * uSunlightIntensity * (
      ${WATER_OPTICS.specularBroadBaseStrength.toFixed(4)}
      + topWaterFace * ${WATER_OPTICS.specularBroadTopStrength.toFixed(4)}
    )
    + specMed
  );
  // The reflected sun: a tight disc up close, where the rippled normal
  // shatters it into glitter; wider and dimmer on far water, where the mips
  // have calmed the normal and the tight disc would refocus into one blob.
  float sunAlignment = max(dot(reflectDir, uCelestialDirection), 0.0);
  float sunGlintNear = smoothstep(
    ${WATER_OPTICS.sunGlintStartCos.toFixed(4)},
    ${WATER_OPTICS.sunGlintFullCos.toFixed(4)},
    sunAlignment
  ) * ${WATER_OPTICS.sunGlintStrength.toFixed(4)};
  float sunGlintFar = smoothstep(
    ${WATER_OPTICS.sunGlintFarStartCos.toFixed(4)},
    ${WATER_OPTICS.sunGlintFullCos.toFixed(4)},
    sunAlignment
  ) * ${WATER_OPTICS.sunGlintFarStrength.toFixed(4)};
  float sunGlint = mix(sunGlintFar, sunGlintNear, rippleLod);
  sunGlint *= topWaterFace * (1.0 - uCameraSubmersion);
  specularColor += uSunColor * (sunGlint * uSunlightIntensity);
  specularColor *= airSideGloss;
${LOCAL_LIGHTS_SPECULAR_FRAGMENT}
  vec3 baseWater = outgoingLight.rgb;

  float depthFactor = 1.0 - exp(-distToCamera * 0.008);
  float verticalDepthFactor = 1.0 - exp(-max(0.0, vWaterSurfaceY - wPos.y) * ${WATER_OPTICS.downwellingExtinction.green.toFixed(
    5,
  )});
  vec3 shallowWater = mix(baseWater, uWaterTint, 0.1);
  vec3 deepWater = mix(baseWater, uWaterTint, 0.28);
  vec3 waterColor = mix(shallowWater, deepWater, max(depthFactor, verticalDepthFactor) * 0.72);
  // Indoor lamps light the water texture like a solid; a tank wall then
  // reads as frosted glass. Pull head-on air-side faces toward the tint
  // so they stay a colored window instead of a washed-white pane.
  waterColor = mix(
    waterColor,
    uWaterTint,
    airSideWeight * ${WATER_OPTICS.airSideFaceTintMix.toFixed(4)}
  );

  float streakStrength = sideWaterFace * uWaterStreakStrength * airSideGloss;
  if (streakStrength > 0.001) {
    float sideSelector = step(absWaterNormal.x, absWaterNormal.z);
    float sideCoord = mix(wPos.z, wPos.x, sideSelector);
    float streakNoise = snoise(vec3(sideCoord * 1.4, wPos.y * 0.32 - waveTime * 0.75, 17.0));
    float fineStreakNoise = snoise(vec3(sideCoord * 5.0, wPos.y * 0.9 - waveTime * 1.4, 27.0));
    float streak = smoothstep(0.35, 0.95, streakNoise * 0.7 + fineStreakNoise * 0.3);
    vec3 streakColor = mix(waterColor * 0.96, waterColor + uWaterTint * 0.08, streak);
    waterColor = mix(waterColor, streakColor, streakStrength);
  }

  float surfaceRipple = 0.0;
  float rippleGate = topWaterFace * rippleLod;
  if (rippleGate > 0.001) {
    // Crests of the medium and fine ripple layers catch the sky — the same
    // height field the normal was read from, so each highlight sits on the
    // ridge it belongs to and moves with it.
    float crest = crestMed * 0.6 + crestFine * 0.4;
    surfaceRipple = smoothstep(
      ${WATER_OPTICS.crestHighlightStart.toFixed(4)},
      ${WATER_OPTICS.crestHighlightFull.toFixed(4)},
      crest
    ) * rippleLod;
    vec3 surfaceHighlight = mix(waterColor, skyReflection, 0.34);
    waterColor = mix(waterColor, surfaceHighlight, topWaterFace * surfaceRipple * uWaterStreakStrength * 1.8);
    // Crest tops of the flow train catch the sky, broken up by the still
    // ripple field so they read as water running, not bars scrolling.
    float flowBand = smoothstep(0.15, 0.95, flowCrest) * (0.7 + 0.3 * (crestMed * 2.0 - 1.0));
    waterColor = mix(
      waterColor,
      surfaceHighlight,
      topWaterFace * flowBand * ${WATER_OPTICS.flowStreakStrength.toFixed(4)}
    );
  }

  // The water the refraction sample is seen through. On a top face it is
  // the column under the surface, down to its floor. On an air-side wall
  // it is what stands behind the face, seen through the wall's own voxel
  // of water: a fluid face only exists where the voxel holds fluid, so
  // that much path is always there, and without it the wall composited
  // the scene behind it at zero depth and read as a hole in the water.
  // The depth varying is undefined on a wall's bottom row, so a wall never
  // reads it; a pane keeps its window treatment.
  float wallDepth = sideWaterFace * (1.0 - vIsFluidPane)
    * ${WATER_OPTICS.wallPathBlocks.toFixed(4)};
  float floorDepth = min(
    vFluidDepthBelow * topWaterFace + wallDepth,
    ${WATER_OPTICS.floorAbsorptionMaxDepth.toFixed(4)}
  );
  vec3 floorTransmit = exp(
    -${WATER_DOWNWELLING_EXTINCTION_GLSL}
    * floorDepth
    * ${WATER_OPTICS.floorAbsorptionPathScale.toFixed(4)}
  );
  float wetFloor = mix(1.0, ${WATER_OPTICS.wetFloorDarken.toFixed(4)}, topWaterFace);
  float causticLight = shadow * sunExposure * uSunlightIntensity;
  float caustic = causticLens * causticLens
    * exp(-vFluidDepthBelow * ${WATER_OPTICS.causticDepthFalloff.toFixed(4)})
    * causticLight * rippleLod * topWaterFace;
  vec3 floorShade = floorTransmit * wetFloor
    * (1.0 + ${WATER_OPTICS.causticStrength.toFixed(4)} * caustic);
  float thicknessScatter = (1.0 - exp(
    -floorDepth * ${WATER_OPTICS.shallowScatterDensity.toFixed(4)}
  )) * ${WATER_OPTICS.shallowScatterMaxMix.toFixed(4)};

  // The refraction branch below composites the floor itself, so alpha left
  // to the blend only shows the dry ground through the water a second time.
  float refractionLive = uWaterRefractionReady * (1.0 - step(0.5, uCameraSubmersion));
  // Seen from the air a wall is as much the water's surface as its top is,
  // and takes the same opacity floor: at about half of it a spread's
  // leading edge and a waterfall's face let most of the dry scene straight
  // through. Seen from inside the water a wall is the way out — near normal
  // incidence it transmits almost everything — so it keeps the lighter
  // floor it always had, and the view out of a tank stays clear.
  float wallOpacity = mix(
    ${WATER_OPTICS.submergedWallAlphaScale.toFixed(4)},
    1.0,
    1.0 - uCameraSubmersion
  );
  float refractionFace = max(topWaterFace, sideWaterFace * wallOpacity);
  if (refractionFace > 0.01) {
    // Panes keep the texture alpha (already ~0.26). Raising it toward 0.27
    // on every stacked face is what frosted the tank window.
    float alphaFloor = mix(
      ${WATER_OPTICS.surfaceAlphaFloor.toFixed(4)},
      ${WATER_OPTICS.refractedSurfaceAlphaFloor.toFixed(4)},
      refractionLive
    ) * refractionFace * (1.0 - airSideFace);
    diffuseColor.a = max(diffuseColor.a, alphaFloor);
  }
  diffuseColor.a *= mix(
    1.0,
    ${WATER_OPTICS.airSideFaceAlphaScale.toFixed(4)},
    airSideWeight
  );
  float fresnelAlpha = fresnel * fresnel * topWaterFace
    * ${WATER_OPTICS.fresnelAlphaStrength.toFixed(4)};
  diffuseColor.a = mix(diffuseColor.a, 1.0, fresnelAlpha);

  if (uWaterRefractionReady > 0.5 && refractionFace > 0.01 && uCameraSubmersion < 0.5) {
    vec2 screenUv = gl_FragCoord.xy / max(uSceneTextureSize, vec2(1.0));
    // Displacement follows the surface slope directly, so the floor bends
    // under the same ripples the reflection shows. The separate slow swell
    // this replaces wobbled the whole bed at once — the set-gel look — and
    // normalizing the offset pinned every sample onto a fixed-radius orbit
    // that flashed between unrelated pixels each frame.
    vec2 refractionSlope = waterNormal.xz
      * ${WATER_OPTICS.refractionSlopeScale.toFixed(4)};
    // Displaced sampling only holds up where the sample lands on geometry
    // behind the surface: up-facing water viewed from above. Vertical faces
    // sample undistorted (each crossed face would stamp its own ghost copy)
    // and grazing views fade out, on the static geometric normal so ripple
    // animation cannot pump the fade.
    float refractionIncidence = smoothstep(
      ${WATER_OPTICS.refractionGrazingCutoffCos.toFixed(4)},
      ${WATER_OPTICS.refractionFullStrengthCos.toFixed(4)},
      clamp(dot(vWorldNormal, viewDir), 0.0, 1.0)
    );
    vec2 refractionOffset =
      refractionSlope * uWaterRefractionStrength * topWaterFace * refractionIncidence;
    vec2 refractedUv = clamp(screenUv + refractionOffset, vec2(0.001), vec2(0.999));
    // The sample is the floor lit through the column: absorbed on the way
    // down and back, wet, and lensed by the surface above it.
    vec3 refractedScene = texture2D(uSceneColor, refractedUv).rgb * floorShade;
    float tintAmount = 0.12 + fresnel * 0.28 + surfaceRipple * 0.08 + thicknessScatter;
    waterColor = mix(refractedScene, waterColor, tintAmount);
  } else {
    // No floor to shade: the caustics land on the surface layer instead,
    // where they still read as light moving through water.
    waterColor *= 1.0 + ${WATER_OPTICS.causticStrength.toFixed(4)} * 0.5 * caustic;
  }

  outgoingLight.rgb = mix(waterColor, skyReflection, fresnel);
  outgoingLight.rgb += specularColor;

  float waterDepth = max(0.0, vWaterSurfaceY - vWorldPosition.y);
  vec3 fluidMu = ${WATER_DOWNWELLING_EXTINCTION_GLSL}
    * (uWaterAbsorption * ${WATER_OPTICS.surfaceAbsorptionScale.toFixed(4)});
  outgoingLight.rgb *= exp(-fluidMu * waterDepth);
}
`,
    )
    .replace(
      "#include <fog_fragment>",
      `
${CHUNK_SKY_FOG_FRAGMENT}

${LIGHT_CONES_SCATTER_FRAGMENT}

if (uShadowDebugMode > 0.5) {
  if (uShadowDebugMode < 1.5) {
    gl_FragColor.rgb = vec3(shadow);
  } else if (uShadowDebugMode < 2.5) {
    float debugNdotL = max(dot(vWorldNormal, uSunDirection), 0.0);
    gl_FragColor.rgb = vec3(debugNdotL);
  } else if (uShadowDebugMode < 3.5) {
    gl_FragColor.rgb = vec3(vAO);
  } else if (uShadowDebugMode < 4.5) {
    if (vViewDepth < uCascadeSplit0) {
      gl_FragColor.rgb = vec3(1.0, 0.0, 0.0);
    } else if (vViewDepth < uCascadeSplit1) {
      gl_FragColor.rgb = vec3(0.0, 1.0, 0.0);
    } else if (vViewDepth < uCascadeSplit2) {
      gl_FragColor.rgb = vec3(0.0, 0.0, 1.0);
    } else {
      gl_FragColor.rgb = vec3(1.0, 1.0, 0.0);
    }
  } else if (uShadowDebugMode < 5.5) {
    float debugNdotL2 = dot(vWorldNormal, uSunDirection);
    float debugSlopeBias = max(0.005 * (1.0 - debugNdotL2), 0.001);
    gl_FragColor.rgb = vec3(debugSlopeBias * 100.0);
  } else if (uShadowDebugMode < 6.5) {
    gl_FragColor.rgb = vec3(sunExposure);
  } else if (uShadowDebugMode < 7.5) {
    gl_FragColor.rgb = vec3(tunnelDarkening);
  }
}

${LOCAL_LIGHTS_DEBUG_TAIL_FRAGMENT}
`,
    ),
};

const FLUID_BRANCH_OPEN = "if (vIsFluid > 0.5) {";

// The fluid surface pass (wave-normal noise stack, refraction sampling,
// depth tinting) lives in the shared fragment source, but only fluid
// materials should pay for it: a branch on a varying cannot be specialized
// by the compiler, so its registers and samplers would otherwise tax every
// terrain fragment in the scene. Non-fluid materials compile it out; the
// fluid variant keeps it and swaps the 5x5 PCF shadow loop for the 5-tap
// fast path, since a wave-animated surface swallows soft shadow detail.
export const SHADER_LIGHTING_CHUNK_SHADERS = {
  vertex: FULL_CHUNK_SHADERS.vertex,
  fragment: FULL_CHUNK_SHADERS.fragment.replace(
    FLUID_BRANCH_OPEN,
    "if (false) {",
  ),
};

export const SHADER_LIGHTING_FLUID_CHUNK_SHADERS = {
  vertex: FULL_CHUNK_SHADERS.vertex,
  fragment: FULL_CHUNK_SHADERS.fragment
    .replace(
      "float shadow0 = sampleShadowMap(uShadowMap0, vShadowCoord0, slopeBias, receiverBiasScale);",
      "float shadow0 = sampleShadowMapFast(uShadowMap0, vShadowCoord0, slopeBias, receiverBiasScale);",
    )
    .split(
      "float shadow1 = sampleShadowMap(uShadowMap1, vShadowCoord1, slopeBias * 1.5, receiverBiasScale);",
    )
    .join(
      "float shadow1 = sampleShadowMapFast(uShadowMap1, vShadowCoord1, slopeBias * 1.5, receiverBiasScale);",
    ),
};

// See-through solids (glass, foliage) draw as stacked double-sided layers,
// so a full-screen pane multiplies whatever the fragment costs by every
// layer behind it. They take the same 5-tap shadow fast path as fluids —
// tinted glass and leaf clusters swallow soft shadow detail exactly as
// waves do — while compiling the fluid surface branch out like the opaque
// shader does.
export const SHADER_LIGHTING_SEE_THROUGH_CHUNK_SHADERS = {
  vertex: FULL_CHUNK_SHADERS.vertex,
  fragment: SHADER_LIGHTING_CHUNK_SHADERS.fragment
    .replace(
      "float shadow0 = sampleShadowMap(uShadowMap0, vShadowCoord0, slopeBias, receiverBiasScale);",
      "float shadow0 = sampleShadowMapFast(uShadowMap0, vShadowCoord0, slopeBias, receiverBiasScale);",
    )
    .split(
      "float shadow1 = sampleShadowMap(uShadowMap1, vShadowCoord1, slopeBias * 1.5, receiverBiasScale);",
    )
    .join(
      "float shadow1 = sampleShadowMapFast(uShadowMap1, vShadowCoord1, slopeBias * 1.5, receiverBiasScale);",
    ),
};

export const SHADER_LIGHTING_CROSS_CHUNK_SHADERS = {
  vertex: SHADER_LIGHTING_CHUNK_SHADERS.vertex,
  fragment: SHADER_LIGHTING_CHUNK_SHADERS.fragment
    .replace(
      `float NdotL = max(dot(vWorldNormal, uSunDirection), 0.0);
float sunExposure = vLight.a;

vec3 sunContribution = uSunColor * NdotL * shadow * uSunlightIntensity;`,
      `float sunExposure = vLight.a;

vec3 sunContribution = vec3(sunExposure * sunExposure * uSunlightIntensity);`,
    )
    .replace(
      `float getShadow() {
  float NdotL = dot(vWorldNormal, uSunDirection);
  if (NdotL <= 0.0) {
    return mix(1.0, 0.0, uShadowStrength);
  }`,
      `float getShadow() {
  float NdotL = 0.5;
  if (false) {
    return mix(1.0, 0.0, uShadowStrength);
  }`,
    )
    // Cross quads all share the same diagonal normal blend, so face shade
    // would uniformly darken plants without adding any edge contrast.
    .replace(
      `float faceShade = faceShadeWeights.x * uFaceShades.x
  + faceShadeWeights.z * uFaceShades.y
  + faceShadeWeights.y * verticalFaceShade;`,
      `float faceShade = 1.0;`,
    ),
};

export function createSwayShader(
  baseShaders: { vertex: string; fragment: string },
  options: Partial<{
    speed: number;
    amplitude: number;
    scale: number;
    rooted: boolean;
    yScale: number;
  }> = {},
) {
  const { speed, amplitude, rooted, scale, yScale } = {
    speed: 1,
    amplitude: 0.1,
    rooted: false,
    scale: 1,
    yScale: 1,
    ...options,
  };

  // How far this vertex is from the rooted end, 0 at the root and 1 at the
  // tip. Measured across the whole vertical run when the mesher supplied one,
  // so a plant column arcs as a single frond; measured within the block when
  // it did not, which is the same thing for a plant one block tall.
  const rootScaleCode = !rooted
    ? "1.0"
    : baseShaders.vertex.includes("float stackIndexF")
      ? "((stackIndexF + swayBlockPosition.y - floor(swayBlockPosition.y)) / stackHeight)"
      : "(swayBlockPosition.y - floor(swayBlockPosition.y))";

  // Sway math runs in block space: quantized materials store `position` in
  // fixed-point counts, and both the fract-based root measure and the noise
  // phase are meaningless at that scale. Displacement converts back so it
  // survives the matrix that dequantizes the mesh.
  const swayCode = `
vec3 swayBlockPosition = vec3(position) / POSITION_UNITS_PER_BLOCK;
float swayScale = uTime * 0.00002 * ${speed.toFixed(2)};
float rootScale = ${rootScaleCode};
float swayNoise = snoise(vec3(
  swayBlockPosition.x * swayScale + uWindOffset.x,
  swayBlockPosition.y * swayScale * ${yScale.toFixed(2)},
  swayBlockPosition.z * swayScale + uWindOffset.y
));
transformed.x += rootScale * ${scale.toFixed(
    2,
  )} * swayNoise * 2.0 * ${amplitude.toFixed(2)} * POSITION_UNITS_PER_BLOCK;
transformed.z += rootScale * ${scale.toFixed(
    2,
  )} * swayNoise * ${amplitude.toFixed(
    2,
  )} * uWindSpeed * 0.5 * POSITION_UNITS_PER_BLOCK;
`;

  let vertexShader = baseShaders.vertex;

  if (!vertexShader.includes("snoise")) {
    vertexShader = vertexShader.replace(
      "#include <common>",
      `${SIMPLEX_NOISE_GLSL}\n#include <common>`,
    );
  }

  if (vertexShader.includes("#include <begin_vertex>")) {
    vertexShader = vertexShader.replace(
      "#include <begin_vertex>",
      `
vec3 transformed = vec3(position);
${swayCode}`,
    );
  } else if (vertexShader.includes("vec3 transformed = vec3(position);")) {
    vertexShader = vertexShader.replace(
      "vec3 transformed = vec3(position);",
      `vec3 transformed = vec3(position);
${swayCode}`,
    );
  }

  return {
    vertexShader,
    fragmentShader: baseShaders.fragment,
  };
}

/**
 * Table-driven variant of {@link createSwayShader} for the shared cutout
 * buckets: instead of compiling one material per species with its sway
 * constants baked into the source, every quad carries a `swayProfile`
 * attribute indexing a vec4-pair uniform table (params: speed, amplitude,
 * scale, yScale; flags: rooted, cross shading). Profile 0 is reserved as
 * "no sway" so geometry without a registered profile — and geometry whose
 * material never binds the attribute, which WebGL defaults to 0 — stays
 * still.
 *
 * Cross-quad plants historically used a separate fragment (fixed sun
 * incidence, no face shade); that difference rides the profile's cross flag
 * through the `vCrossShading` varying so one program serves both shapes.
 */
export function createSwayTableShader(
  baseShaders: { vertex: string; fragment: string },
  profileCapacity: number,
) {
  const tableLength = profileCapacity * 2;

  const vertexShader = baseShaders.vertex
    .replace(
      "#include <common>",
      `
attribute float swayProfile;
uniform vec4 uSwayParams[${tableLength}];
varying float vCrossShading;

#include <common>
`,
    )
    .replace(
      "vec3 transformed = vec3(position);",
      `vec3 transformed = vec3(position);
int swayIdx = int(swayProfile + 0.5) * 2;
vec4 swayParams = uSwayParams[swayIdx];
vec4 swayFlags = uSwayParams[swayIdx + 1];
vec3 swayBlockPosition = vec3(position) / POSITION_UNITS_PER_BLOCK;
float swayScale = uTime * 0.00002 * swayParams.x;
// Rooted plants bend from the dirt, but a linear 0→1 over two blocks
// leaves the stem dead and only the bloom moving. sqrt keeps the root
// planted and puts the stem at ~70% of the tip.
float stemT = clamp(
  (stackIndexF + swayBlockPosition.y - floor(swayBlockPosition.y)) / stackHeight,
  0.0,
  1.0
);
float rootScale = mix(1.0, sqrt(stemT), swayFlags.x);
float swayNoise = snoise(vec3(
  swayBlockPosition.x * swayScale + uWindOffset.x,
  swayBlockPosition.y * swayScale * swayParams.w,
  swayBlockPosition.z * swayScale + uWindOffset.y
));
float swayShift = rootScale * swayParams.z * swayNoise * swayParams.y;
transformed.x += swayShift * 2.0 * POSITION_UNITS_PER_BLOCK;
transformed.z += swayShift * uWindSpeed * 0.5 * POSITION_UNITS_PER_BLOCK;
vCrossShading = swayFlags.y;
`,
    );

  const fragmentShader = baseShaders.fragment
    .replace(
      "varying float vAO;",
      `varying float vCrossShading;
varying float vAO;`,
    )
    .replace(
      "float NdotL = dot(vWorldNormal, uSunDirection);",
      "float NdotL = mix(dot(vWorldNormal, uSunDirection), 0.5, vCrossShading);",
    )
    .replace(
      `float faceShade = faceShadeWeights.x * uFaceShades.x
  + faceShadeWeights.z * uFaceShades.y
  + faceShadeWeights.y * verticalFaceShade;`,
      `float faceShade = mix(
  faceShadeWeights.x * uFaceShades.x
    + faceShadeWeights.z * uFaceShades.y
    + faceShadeWeights.y * verticalFaceShade,
  1.0,
  vCrossShading
);`,
    );

  return { vertexShader, fragmentShader };
}
