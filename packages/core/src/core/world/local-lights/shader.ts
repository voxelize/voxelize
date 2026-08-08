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

export const LOCAL_LIGHTS_UNIFORM_DECLARATIONS = `
uniform highp usampler2D uLightGrid;
uniform sampler2D uLightData;
uniform vec3 uLightGridOrigin;
uniform vec3 uLightGridDims;
uniform float uLightGridCellSize;
uniform int uClusteredLightCount;
uniform float uLocalMaskKnee;
uniform float uLocalSpecularStrength;
uniform float uLocalLightDebugMode;
`;

/**
 * The clustered local light response. `localLightCell` resolves a world
 * position to its grid cell (or -1 outside the window); the surface and
 * specular functions walk the cell's fixed slot list, breaking at the first
 * empty slot, so an empty world costs one integer compare per fragment.
 *
 * Record layout (one row per selected light, four RGBA32F texels):
 *   t0 = [x, y, z, range]
 *   t1 = [r*i, g*i, b*i, flags]   flags: 1 masked | 2 flicker | shape << 4
 *   t2 = spot [dir.xyz, cosOuter] / capsule [end offset.xyz, 0]
 *   t3 = [flickerSpeed, flickerAmplitude, flickerPhase, spotInvCosDelta]
 */
export const LOCAL_LIGHTS_FUNCTIONS = `
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

vec3 localLightSurface(vec3 llPos, vec3 llNormal, vec3 llFlood) {
  if (uClusteredLightCount == 0) return vec3(0.0);
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
    vec4 llT1 = texelFetch(uLightData, ivec2(1, llRec), 0);
    int llFlags = int(llT1.w + 0.5);
    int llShape = llFlags >> 4;

    vec3 llOrigin = llT0.xyz;
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
      llAngular = clamp((dot(-llL, llT2.xyz) - llT2.w) * llT3s.w, 0.0, 1.0);
      llAngular *= llAngular;
    }

    float llLambert = max(dot(llNormal, llL), 0.0) * ${(1 - LAMBERT_WRAP).toFixed(4)} + ${LAMBERT_WRAP.toFixed(4)};

    float llFlicker = 1.0;
    if ((llFlags & 2) != 0) {
      llFlicker = localLightFlicker(texelFetch(uLightData, ivec2(3, llRec), 0));
    }

    float llOcclusion = (llFlags & 1) != 0 ? llMask : 1.0;

    // Submerged emitters lose energy to the water column, with the same
    // extinction the cone lights use; the waterline transition spans one
    // block so a bobbing lantern does not pop.
    float llSubmersion = clamp(uWaterLevel - llOrigin.y, 0.0, 1.0);
    vec3 llTransmit = exp(-${WATER_VIEW_EXTINCTION_GLSL} * llDist * llSubmersion);

    llTotal += llT1.rgb * (llFall * llAngular * llLambert * llFlicker * llOcclusion) * llTransmit;
  }
  return llTotal;
}

vec3 localLightSpecular(vec3 llPos, vec3 llNormal, vec3 llViewDir) {
  if (uClusteredLightCount == 0 || uLocalSpecularStrength <= 0.0) return vec3(0.0);
  int llCell = localLightCell(llPos);
  if (llCell < 0) return vec3(0.0);

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
    llTotal += llT1.rgb * (llSpec * llFall);
  }
  return llTotal * uLocalSpecularStrength;
}

vec3 localLightDebugColor(vec3 llPos, vec3 llBase, vec3 llNormal, vec3 llFlood) {
  if (uLocalLightDebugMode < 0.5) return llBase;
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
    // Isolated clustered contribution.
    return localLightSurface(llPos, llNormal, llFlood);
  }
  // Flood leak mask the masked lights multiply by.
  return vec3(smoothstep(0.0, uLocalMaskKnee, max(max(llFlood.r, llFlood.g), llFlood.b)));
}
`;
