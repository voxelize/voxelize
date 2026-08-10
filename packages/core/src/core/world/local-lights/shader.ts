import { WATER_VIEW_EXTINCTION_GLSL } from "../water-optics";

import { GRID_CELLS_PER_ROW, MAX_LIGHTS_PER_CELL } from "./clustering";

/**
 * The four strengths an emissive face can render at, indexed by the two AO
 * bits under the vertex emissive bit. Mirrors `EMISSIVE_LEVELS` in
 * `crates/mesher/src/mesher/vertex_light.rs`; change neither side alone.
 */
export const EMISSIVE_LEVELS: [number, number, number, number] = [
  1.0, 1.75, 2.5, 3.5,
];

/**
 * Same diffuse wrap the cone lights use, so a surface grazing any local
 * light keeps the same rim response.
 */
const LAMBERT_WRAP = 0.25;

/**
 * Safety gain on the analytic claim when it suppresses the baked flood
 * term: the two models approximate the same sources with different falloff
 * curves, so ownership must saturate decisively near a source (fully
 * analytic — N·L and shadows undiluted) while still fading smoothly to the
 * flood look at the claim's edge. Shared by the chunk shader and the CPU
 * entity mirror; change neither side alone.
 */
export const BLOCK_LIGHT_OWNERSHIP_GAIN = 1.5;

export const LOCAL_LIGHTS_UNIFORM_DECLARATIONS = `
uniform highp usampler2D uLightGrid;
uniform sampler2D uLightData;
uniform vec3 uLightGridOrigin;
uniform vec3 uLightGridDims;
uniform float uLightGridCellSize;
uniform int uClusteredLightCount;
uniform float uLocalMaskKnee;
uniform float uLocalSpecularStrength;
// 0..1: how strongly analytic claims suppress the baked flood term.
uniform float uLocalOwnership;
uniform float uLocalLightDebugMode;
uniform sampler2D uLocalShadowAtlas;
// [atlas px, cell px, linear depth bias (blocks), normal bias (texels)]
uniform vec4 uLocalShadowParams;
// [pcf radius (texels), shadow strength, unused, unused]
uniform vec4 uLocalShadowParams2;
`;

/**
 * The clustered local light response. `localLightCell` resolves a world
 * position to its grid cell (or -1 outside the window); the surface and
 * specular functions walk the cell's fixed slot list, breaking at the first
 * empty slot, so an empty world costs one integer compare per fragment.
 *
 * Record layout (one row per selected light, six RGBA32F texels):
 *   t0 = [x, y, z, range]
 *   t1 = [r*i, g*i, b*i, flags]   flags: 1 masked | 2 flicker | 4 shadowed | shape << 4
 *        (a static shadow holder carries masked *and* shadowed: the diffuse
 *        ladder prefers its atlas, while the fluid specular pass occludes by
 *        the mask so the atlas sampler stays inlined exactly once)
 *   t2 = spot [dir.xyz, cosOuter] / capsule [end offset.xyz, 0]
 *   t3 = [flickerSpeed, flickerAmplitude, flickerPhase, spotInvCosDelta]
 *   t4 = [shadow slot (-1 none), static face mask, dynamic face mask, near]
 *   t5 = [far, guard tanHalf, 0, 0]
 *
 * Shadow lookup mirrors the camera construction in `shadow-atlas.ts`
 * (face bases, guard FOV, GL perspective depth); change neither side alone.
 * Depth compares run in *linear* light-space distance so bias is a world
 * unit, not a resolution- and range-dependent NDC fudge.
 */
export const LOCAL_LIGHTS_FUNCTIONS = `
const vec2 LL_PCF_TAPS[4] = vec2[4](
  vec2(-0.6, -0.2), vec2(0.6, 0.2), vec2(-0.2, 0.6), vec2(0.2, -0.6)
);

// The one inlining site for atlas math: both cells (cached static world,
// per-frame dynamic casters) sample through a single loop, because software
// rasterizers (and register allocators) pay for every inlined copy of this
// body whether or not a fragment ever takes the branch.
float localLightShadow(
  int llRec, vec3 llPos, vec3 llNormal, int llShape, vec3 llLightPos, vec3 llSpotDir
) {
  vec4 llT4 = texelFetch(uLightData, ivec2(4, llRec), 0);
  int llSlot = int(floor(llT4.x + 0.5));
  if (llSlot < 0) return 1.0;
  float llNear = llT4.w;
  vec4 llT5 = texelFetch(uLightData, ivec2(5, llRec), 0);
  float llFar = llT5.x;
  float llTanHalf = llT5.y;

  // Receiver offset along the normal by the light-space texel footprint,
  // scaled up as the light grazes the surface: at glancing incidence one
  // texel of map resolution spans a long stretch of receiver, and the only
  // artifact-free correction is to lift the sample off the plane. This is
  // resolution-aware, so contact shadows never detach at close range.
  vec3 llToLightDir = normalize(llLightPos - llPos);
  float llNdl = clamp(dot(llNormal, llToLightDir), 0.0, 1.0);
  float llSlope = clamp(sqrt(1.0 - llNdl * llNdl) / max(llNdl, 0.05), 0.0, 8.0);
  float llW0 = max(length(llPos - llLightPos), llNear);
  float llTexelWorld = (2.0 * llTanHalf * llW0) / uLocalShadowParams.y;
  vec3 llRel = llPos
    + llNormal * (uLocalShadowParams.w * llTexelWorld * (1.0 + llSlope))
    - llLightPos;

  int llFace;
  float llW;
  vec2 llFaceUv;
  if (llShape == 1) {
    vec3 llUpRef = abs(llSpotDir.y) > 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    vec3 llRight = normalize(cross(llSpotDir, llUpRef));
    vec3 llUp = cross(llRight, llSpotDir);
    llW = dot(llRel, llSpotDir);
    if (llW <= llNear) return 1.0;
    vec2 llNdc = vec2(dot(llRel, llRight), dot(llRel, llUp)) / (llW * llTanHalf);
    if (abs(llNdc.x) >= 1.0 || abs(llNdc.y) >= 1.0) return 1.0;
    llFace = 0;
    llFaceUv = llNdc * 0.5 + 0.5;
  } else {
    vec3 llA = abs(llRel);
    vec2 llUv;
    if (llA.x >= llA.y && llA.x >= llA.z) {
      llFace = llRel.x > 0.0 ? 0 : 1;
      llW = llA.x;
      llUv = vec2(llRel.x > 0.0 ? llRel.z : -llRel.z, llRel.y);
    } else if (llA.y >= llA.z) {
      llFace = llRel.y > 0.0 ? 2 : 3;
      llW = llA.y;
      llUv = vec2(llRel.y > 0.0 ? llRel.x : -llRel.x, llRel.z);
    } else {
      llFace = llRel.z > 0.0 ? 4 : 5;
      llW = llA.z;
      llUv = vec2(llRel.z > 0.0 ? -llRel.x : llRel.x, llRel.y);
    }
    if (llW <= llNear) return 1.0;
    llFaceUv = (llUv / (llW * llTanHalf)) * 0.5 + 0.5;
  }

  float llBias = uLocalShadowParams.z + llTexelWorld * (0.75 + llSlope);
  float llAtlas = uLocalShadowParams.x;
  float llCellPx = uLocalShadowParams.y;
  float llPerRow = floor(llAtlas / llCellPx + 0.5);
  float llPcf = uLocalShadowParams2.x;
  float llBorder = (llPcf + 1.0) / llCellPx;
  vec2 llClamped = clamp(llFaceUv, vec2(llBorder), vec2(1.0 - llBorder));
  vec2 llTexel = vec2(llPcf / llAtlas);
  int llMasks = int(llT4.y + 0.5) | (int(llT4.z + 0.5) << 6);

  float llVis = 1.0;
  for (int llLayer = 0; llLayer < 2; llLayer++) {
    if ((llMasks & (1 << (llFace + llLayer * 6))) == 0) continue;
    int llCell = llSlot * 12 + llLayer * 6 + llFace;
    vec2 llBaseUv = (vec2(
      mod(float(llCell), llPerRow),
      floor(float(llCell) / llPerRow)
    ) * llCellPx + llClamped * llCellPx) / llAtlas;
    float llHits = 0.0;
    for (int t = 0; t < 4; t++) {
      float llD01 = texture(uLocalShadowAtlas, llBaseUv + LL_PCF_TAPS[t] * llTexel).r;
      float llZn = llD01 * 2.0 - 1.0;
      float llStored = (2.0 * llFar * llNear) / (llFar + llNear - llZn * (llFar - llNear));
      llHits += (llW - llBias > llStored) ? 0.0 : 1.0;
    }
    llVis = min(llVis, llHits * 0.25);
  }
  return mix(1.0, llVis, uLocalShadowParams2.y);
}

int localLightCell(vec3 llPos) {
  vec3 llRel = (llPos - uLightGridOrigin) / uLightGridCellSize;
  if (any(lessThan(llRel, vec3(0.0))) || any(greaterThanEqual(llRel, uLightGridDims))) {
    return -1;
  }
  ivec3 llCell = ivec3(llRel);
  return (llCell.z * int(uLightGridDims.y) + llCell.y) * int(uLightGridDims.x) + llCell.x;
}

int localLightSlot(int llCell, int llSlot) {
  ivec2 llCoord = ivec2(
    (llCell % ${GRID_CELLS_PER_ROW}) * ${MAX_LIGHTS_PER_CELL} + llSlot,
    llCell / ${GRID_CELLS_PER_ROW}
  );
  return int(texelFetch(uLightGrid, llCoord, 0).r);
}

float localLightFlicker(vec4 llT3) {
  float llT = uTime * 0.001 * llT3.x * 6.28318;
  float llWobble = sin(llT + llT3.z) * sin(llT * 0.531 + llT3.z * 1.7) * 0.5 + 0.5;
  return 1.0 - llT3.y * llWobble;
}

// Alongside the lit response, computes llFloodRemainder: the fraction of
// the baked flood term this fragment should keep. Selected lights *claim*
// their coverage with falloff and cone shaping only — no Lambert, flicker,
// occlusion, or shadow, so a torch's shadowed side and its facing-away
// surfaces stay owned (dark) instead of being refilled by flat flood. The
// claim fades over the outer two cells of the grid window (the window edge
// steps with the camera in whole cells; the fade keeps that step invisible)
// and is scaled by uLocalOwnership, so 0 renders the exact legacy frame.
vec3 localLightSurface(
  vec3 llPos, vec3 llNormal, vec3 llFlood, out float llFloodRemainder
) {
  llFloodRemainder = 1.0;
  if (uClusteredLightCount == 0) return vec3(0.0);
  int llCell = localLightCell(llPos);
  if (llCell < 0) return vec3(0.0);

  float llMask = smoothstep(
    0.0,
    uLocalMaskKnee,
    max(max(llFlood.r, llFlood.g), llFlood.b)
  );

  float llClaim = 0.0;
  vec3 llTotal = vec3(0.0);
  for (int s = 0; s < ${MAX_LIGHTS_PER_CELL}; s++) {
    int llRec = localLightSlot(llCell, s);
    if (llRec == 0) break;
    llRec -= 1;

    vec4 llT0 = texelFetch(uLightData, ivec2(0, llRec), 0);
    vec4 llT1 = texelFetch(uLightData, ivec2(1, llRec), 0);
    int llFlags = int(llT1.w + 0.5);
    int llShape = llFlags >> 4;

    vec3 llOrigin = llT0.xyz;
    vec3 llSpotDir = vec3(0.0);
    if (llShape == 2) {
      // Capsule: light from the closest point on the segment.
      vec4 llT2 = texelFetch(uLightData, ivec2(2, llRec), 0);
      vec3 llAxis = llT2.xyz;
      float llLen2 = max(dot(llAxis, llAxis), 1e-6);
      float llT = clamp(dot(llPos - llT0.xyz, llAxis) / llLen2, 0.0, 1.0);
      llOrigin = llT0.xyz + llAxis * llT;
    }

    vec3 llToLight = llOrigin - llPos;
    float llD2 = dot(llToLight, llToLight);
    float llRange = llT0.w;
    if (llD2 >= llRange * llRange) continue;
    float llDist = sqrt(max(llD2, 1e-6));
    vec3 llL = llToLight / llDist;

    float llNorm = llDist / llRange;
    float llFall = 1.0 - llNorm * llNorm;
    llFall *= llFall;

    float llAngular = 1.0;
    if (llShape == 1) {
      vec4 llT2 = texelFetch(uLightData, ivec2(2, llRec), 0);
      vec4 llT3s = texelFetch(uLightData, ivec2(3, llRec), 0);
      llSpotDir = llT2.xyz;
      llAngular = clamp((dot(-llL, llT2.xyz) - llT2.w) * llT3s.w, 0.0, 1.0);
      llAngular *= llAngular;
    }

    // llT1.rgb is color pre-multiplied by intensity × share, so this is the
    // light's unoccluded luminance claim at the fragment.
    llClaim += (llFall * llAngular) * dot(llT1.rgb, vec3(0.2126, 0.7152, 0.0722));

    float llLambert = max(dot(llNormal, llL), 0.0) * ${(1 - LAMBERT_WRAP).toFixed(4)} + ${LAMBERT_WRAP.toFixed(4)};

    float llFlicker = 1.0;
    if ((llFlags & 2) != 0) {
      llFlicker = localLightFlicker(texelFetch(uLightData, ivec2(3, llRec), 0));
    }

    // Occlusion ladder: a granted shadow slot samples its atlas maps
    // (per-light, entity-aware); otherwise a masked light multiplies by the
    // shared flood mask; otherwise the light is unoccluded. The common
    // masked-point case costs the same select it did before shadows.
    float llOcclusion = (llFlags & 1) != 0 ? llMask : 1.0;
    if ((llFlags & 4) != 0) {
      llOcclusion = localLightShadow(llRec, llPos, llNormal, llShape, llT0.xyz, llSpotDir);
    }

    // Submerged emitters lose energy to the water column, with the same
    // extinction the cone lights use; the waterline transition spans one
    // block so a bobbing lantern does not pop. Gated on camera submersion
    // exactly like the terrain's downwelling attenuation: the nominal
    // waterline must not drown dry lights in below-sea-level terrain.
    float llSubmersion =
      clamp(uWaterLevel - llOrigin.y, 0.0, 1.0) * uCameraSubmersion;
    vec3 llTransmit = exp(-${WATER_VIEW_EXTINCTION_GLSL} * llDist * llSubmersion);

    llTotal += llT1.rgb * (llFall * llAngular * llLambert * llFlicker * llOcclusion) * llTransmit;
  }

  // The window edge steps by whole cells as the camera moves; fading the
  // claim over the outer two cells hands coverage back to the flood term
  // before that hard edge can show.
  vec3 llCellPos = (llPos - uLightGridOrigin) / uLightGridCellSize;
  vec3 llEdge = min(llCellPos, uLightGridDims - llCellPos);
  float llWindowFade = clamp(min(min(llEdge.x, llEdge.y), llEdge.z) * 0.5, 0.0, 1.0);

  float llFloodLum = max(max(llFlood.r, llFlood.g), llFlood.b);
  float llFloodSmooth = llFloodLum * llFloodLum * (3.0 - 2.0 * llFloodLum);
  llFloodRemainder = 1.0 - clamp(
    (llClaim * uLocalOwnership * llWindowFade * ${BLOCK_LIGHT_OWNERSHIP_GAIN.toFixed(2)})
      / max(llFloodSmooth, 1e-3),
    0.0,
    1.0
  );

  return llTotal;
}

vec3 localLightSpecular(vec3 llPos, vec3 llNormal, vec3 llViewDir, vec3 llFlood) {
  if (uClusteredLightCount == 0 || uLocalSpecularStrength <= 0.0) return vec3(0.0);
  int llCell = localLightCell(llPos);
  if (llCell < 0) return vec3(0.0);

  float llMask = smoothstep(
    0.0,
    uLocalMaskKnee,
    max(max(llFlood.r, llFlood.g), llFlood.b)
  );

  vec3 llTotal = vec3(0.0);
  for (int s = 0; s < ${MAX_LIGHTS_PER_CELL}; s++) {
    int llRec = localLightSlot(llCell, s);
    if (llRec == 0) break;
    llRec -= 1;

    vec4 llT0 = texelFetch(uLightData, ivec2(0, llRec), 0);
    vec3 llToLight = llT0.xyz - llPos;
    float llD2 = dot(llToLight, llToLight);
    float llRange = llT0.w;
    if (llD2 >= llRange * llRange) continue;
    float llDist = sqrt(max(llD2, 1e-6));

    float llNorm = llDist / llRange;
    float llFall = 1.0 - llNorm * llNorm;
    llFall *= llFall;

    vec3 llHalf = normalize(llToLight / llDist + llViewDir);
    float llSpec = max(dot(llNormal, llHalf), 0.0);
    llSpec *= llSpec;
    llSpec *= llSpec;
    llSpec *= llSpec;
    llSpec *= llSpec;
    llSpec *= llSpec;

    vec4 llT1 = texelFetch(uLightData, ivec2(1, llRec), 0);
    // The same flood-mask occlusion the masked diffuse path applies — the
    // masked bit rides along on shadow holders exactly so this pass never
    // glints from a light behind a wall, without inlining a second resident
    // copy of the atlas sampler into the water branch.
    int llFlags = int(llT1.w + 0.5);
    float llOcclusion = (llFlags & 1) != 0 ? llMask : 1.0;
    llTotal += llT1.rgb * (llSpec * llFall * llOcclusion);
  }
  return llTotal * uLocalSpecularStrength;
}
`;

// Single-tap occlusion probe for the debug views: same face selection and
// linear compare as the real sampler, without the PCF loop, the spot basis,
// or the dynamic layer — a fraction of the inlined size, honest about where
// the cached static maps darken. Point/capsule faces only.
const LOCAL_SHADOW_DEBUG_PROBE = `
float localShadowDebugProbe(int llRec, vec3 llPos, vec3 llNormal) {
  vec4 llT4 = texelFetch(uLightData, ivec2(4, llRec), 0);
  int llSlot = int(floor(llT4.x + 0.5));
  if (llSlot < 0) return 1.0;
  vec4 llT5 = texelFetch(uLightData, ivec2(5, llRec), 0);
  vec3 llLightPos = texelFetch(uLightData, ivec2(0, llRec), 0).xyz;
  // Same slope-scaled normal offset as the real sampler, or grazing floors
  // stripe with acne in the debug view.
  vec3 llToL = normalize(llLightPos - llPos);
  float llNdl = clamp(dot(llNormal, llToL), 0.0, 1.0);
  float llSlope = clamp(sqrt(1.0 - llNdl * llNdl) / max(llNdl, 0.05), 0.0, 8.0);
  float llTexelWorld =
    (2.0 * llT5.y * max(length(llPos - llLightPos), llT4.w)) / uLocalShadowParams.y;
  vec3 llRel = llPos
    + llNormal * (uLocalShadowParams.w * llTexelWorld * (1.0 + llSlope))
    - llLightPos;
  vec3 llA = abs(llRel);
  int llFace;
  float llW;
  vec2 llUv;
  if (llA.x >= llA.y && llA.x >= llA.z) {
    llFace = llRel.x > 0.0 ? 0 : 1;
    llW = llA.x;
    llUv = vec2(llRel.x > 0.0 ? llRel.z : -llRel.z, llRel.y);
  } else if (llA.y >= llA.z) {
    llFace = llRel.y > 0.0 ? 2 : 3;
    llW = llA.y;
    llUv = vec2(llRel.y > 0.0 ? llRel.x : -llRel.x, llRel.z);
  } else {
    llFace = llRel.z > 0.0 ? 4 : 5;
    llW = llA.z;
    llUv = vec2(llRel.z > 0.0 ? -llRel.x : llRel.x, llRel.y);
  }
  if (llW <= llT4.w) return 1.0;
  if ((int(llT4.y + 0.5) & (1 << llFace)) == 0) return 1.0;
  vec2 llFaceUv = clamp((llUv / (llW * llT5.y)) * 0.5 + 0.5, 0.02, 0.98);
  float llPerRow = floor(uLocalShadowParams.x / uLocalShadowParams.y + 0.5);
  int llCell = llSlot * 12 + llFace;
  vec2 llBaseUv = (vec2(
    mod(float(llCell), llPerRow), floor(float(llCell) / llPerRow)
  ) + llFaceUv) * uLocalShadowParams.y / uLocalShadowParams.x;
  float llZn = texture(uLocalShadowAtlas, llBaseUv).r * 2.0 - 1.0;
  float llStored = (2.0 * llT5.x * llT4.w)
    / (llT5.x + llT4.w - llZn * (llT5.x - llT4.w));
  float llBias = uLocalShadowParams.z + llTexelWorld * (0.75 + llSlope);
  return (llW - llBias > llStored) ? 0.0 : 1.0;
}
`;

export const LOCAL_LIGHTS_DEBUG_FUNCTIONS = `
${LOCAL_SHADOW_DEBUG_PROBE}

vec3 localLightDebugColor(
  vec3 llPos, vec3 llBase, vec3 llNormal, vec3 llFlood, vec3 llCluster, float llRemainder
) {
  if (uLocalLightDebugMode < 0.5) return llBase;
  if (uLocalLightDebugMode > 5.5) {
    // Mode 6: flood-ownership remainder — white where the legacy flood term
    // still renders, black where the analytic layer owns the fragment.
    return vec3(llRemainder);
  }
  int llCell = localLightCell(llPos);
  if (uLocalLightDebugMode < 1.5) {
    // Cell occupancy heatmap: black 0, green 1-2, yellow 3-5, red 6+.
    if (llCell < 0) return llBase * 0.2;
    int llCount = 0;
    for (int s = 0; s < ${MAX_LIGHTS_PER_CELL}; s++) {
      if (localLightSlot(llCell, s) == 0) break;
      llCount++;
    }
    vec3 llRamp = llCount == 0
      ? vec3(0.05)
      : llCount <= 2
        ? vec3(0.1, 0.8, 0.2)
        : llCount <= 5
          ? vec3(0.9, 0.8, 0.1)
          : vec3(0.9, 0.15, 0.1);
    return mix(llBase, llRamp, 0.75);
  }
  if (uLocalLightDebugMode < 2.5) {
    // Isolated clustered contribution (the main pass already computed it).
    return llCluster;
  }
  if (uLocalLightDebugMode < 3.5) {
    // Flood leak mask the masked lights multiply by.
    return vec3(smoothstep(0.0, uLocalMaskKnee, max(max(llFlood.r, llFlood.g), llFlood.b)));
  }
  // Modes 4 and 5 share one walk over the cell's shadowed lights, probing
  // each one's cached static map once.
  if (llCell < 0) return uLocalLightDebugMode < 4.5 ? llBase * 0.2 : vec3(1.0);
  vec3 llTint = llBase * 0.15;
  float llVisAll = 1.0;
  for (int s = 0; s < ${MAX_LIGHTS_PER_CELL}; s++) {
    int llRec = localLightSlot(llCell, s);
    if (llRec == 0) break;
    llRec -= 1;
    vec4 llT1d = texelFetch(uLightData, ivec2(1, llRec), 0);
    int llFlagsD = int(llT1d.w + 0.5);
    if ((llFlagsD & 4) == 0) continue;
    vec4 llT0d = texelFetch(uLightData, ivec2(0, llRec), 0);
    vec3 llToLd = llT0d.xyz - llPos;
    if (dot(llToLd, llToLd) >= llT0d.w * llT0d.w) continue;
    float llVisD = localShadowDebugProbe(llRec, llPos, llNormal);
    llVisAll *= llVisD;
    vec4 llT4d = texelFetch(uLightData, ivec2(4, llRec), 0);
    int llSlotD = int(floor(llT4d.x + 0.5));
    vec3 llSlotColor = llSlotD == 0 ? vec3(1.0, 0.3, 0.2)
      : llSlotD == 1 ? vec3(0.2, 1.0, 0.3)
      : llSlotD == 2 ? vec3(0.25, 0.4, 1.0)
      : vec3(1.0, 0.9, 0.2);
    llTint += llSlotColor * (0.2 + 0.8 * llVisD) * 0.6;
  }
  return uLocalLightDebugMode < 4.5 ? llTint : vec3(llVisAll);
}
`;
