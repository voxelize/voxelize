export const SHADOW_POISSON_DISK = `
const vec2 SHADOW_POISSON_DISK[8] = vec2[8](
  vec2(-0.94201624, -0.39906216),
  vec2(0.94558609, -0.76890725),
  vec2(-0.094184101, -0.92938870),
  vec2(0.34495938, 0.29387760),
  vec2(-0.91588581, 0.45771432),
  vec2(-0.81544232, -0.87912464),
  vec2(0.97484398, 0.75648379),
  vec2(0.44323325, -0.97511554)
);
`;

export const SHADOW_SAMPLE_FUNCTIONS = `
float shadowMapEdgeFade(vec3 coord) {
  float fadeWidth = 0.08;
  float fx = smoothstep(0.0, fadeWidth, coord.x) * smoothstep(0.0, fadeWidth, 1.0 - coord.x);
  float fy = smoothstep(0.0, fadeWidth, coord.y) * smoothstep(0.0, fadeWidth, 1.0 - coord.y);
  return fx * fy;
}

float sampleShadowMapFast(sampler2D shadowMap, vec4 shadowCoord, float bias) {
  vec3 coord = shadowCoord.xyz / shadowCoord.w;
  coord = coord * 0.5 + 0.5;

  if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z < 0.0 || coord.z > 1.0) {
    return 1.0;
  }

  vec2 texelSize = vec2(1.0) / vec2(textureSize(shadowMap, 0));

  float shadow = (coord.z - bias > texture(shadowMap, coord.xy).r) ? 0.0 : 1.0;
  shadow += (coord.z - bias > texture(shadowMap, coord.xy + texelSize * vec2(-1.0, -1.0)).r) ? 0.0 : 1.0;
  shadow += (coord.z - bias > texture(shadowMap, coord.xy + texelSize * vec2(1.0, -1.0)).r) ? 0.0 : 1.0;
  shadow += (coord.z - bias > texture(shadowMap, coord.xy + texelSize * vec2(-1.0, 1.0)).r) ? 0.0 : 1.0;
  shadow += (coord.z - bias > texture(shadowMap, coord.xy + texelSize * vec2(1.0, 1.0)).r) ? 0.0 : 1.0;

  shadow /= 5.0;
  return mix(1.0, shadow, shadowMapEdgeFade(coord));
}

float sampleShadowMapPCSS(sampler2D shadowMap, vec4 shadowCoord, float bias) {
  vec3 coord = shadowCoord.xyz / shadowCoord.w;
  coord = coord * 0.5 + 0.5;

  if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z < 0.0 || coord.z > 1.0) {
    return 1.0;
  }

  vec2 texelSize = vec2(1.0) / vec2(textureSize(shadowMap, 0));

  float blockerSum = 0.0;
  float blockerCount = 0.0;
  float searchRadius = 3.0;
  for (int i = 0; i < 4; i++) {
    vec2 offset = SHADOW_POISSON_DISK[i * 2] * texelSize * searchRadius;
    float sampleDepth = texture(shadowMap, coord.xy + offset).r;
    if (sampleDepth < coord.z - bias) {
      blockerSum += sampleDepth;
      blockerCount += 1.0;
    }
  }

  if (blockerCount < 0.5) {
    return 1.0;
  }

  float avgBlockerDepth = blockerSum / blockerCount;
  float penumbraSize = (coord.z - avgBlockerDepth) / avgBlockerDepth;
  float filterRadius = clamp(penumbraSize * 2.0, 1.0, 3.0);

  float spatialNoise = fract(sin(dot(coord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  float angle = spatialNoise * 6.283185;
  float s = sin(angle);
  float c = cos(angle);
  mat2 rotation = mat2(c, -s, s, c);

  float shadow = (coord.z - bias > texture(shadowMap, coord.xy).r) ? 0.0 : 1.0;
  for (int i = 0; i < 8; i++) {
    vec2 offset = rotation * SHADOW_POISSON_DISK[i] * texelSize * filterRadius;
    float depth = texture(shadowMap, coord.xy + offset).r;
    shadow += (coord.z - bias > depth) ? 0.0 : 1.0;
  }

  shadow /= 9.0;
  return mix(1.0, shadow, shadowMapEdgeFade(coord));
}
`;
