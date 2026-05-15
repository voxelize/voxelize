import { ShaderLib } from "three";

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

export const SHADER_LIGHTING_CHUNK_SHADERS = {
  vertex: ShaderLib.basic.vertexShader
    .replace(
      "#include <common>",
      `
attribute int light;

varying float vAO;
varying float vIsFluid;
varying float vIsGreedy;
varying vec4 vLight;
varying vec4 vWorldPosition;
varying vec3 vWorldNormal;
varying float vViewDepth;
uniform vec4 uAOTable;
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
#include <color_vertex>

int ao = (light >> 16) & 0x3;
int isFluid = (light >> 18) & 0x1;
int isGreedy = (light >> 19) & 0x1;

vAO = uAOTable[ao] / 255.0;
vIsFluid = float(isFluid);
vIsGreedy = float(isGreedy);
vLight = unpackLight(light & 0xFFFF);
`,
    )
    .replace(
      "#include <begin_vertex>",
      `
vec3 transformed = vec3(position);

int shouldWave = (light >> 20) & 0x1;
if (shouldWave == 1) {
  vec3 worldPosForWave = (modelMatrix * vec4(position, 1.0)).xyz;
  float waveTime = uTime * 0.0006;

  float wave1 = snoise(vec3(worldPosForWave.x * 0.15 + waveTime * 0.3, worldPosForWave.z * 0.15 - waveTime * 0.2, 0.0)) * 0.08;
  float wave2 = snoise(vec3(worldPosForWave.x * 0.4 - waveTime * 0.5, worldPosForWave.z * 0.4 + waveTime * 0.4, 10.0)) * 0.04;
  float wave3 = snoise(vec3(worldPosForWave.x * 0.8 + waveTime * 0.7, worldPosForWave.z * 0.8 - waveTime * 0.5, 20.0)) * 0.02;

  transformed.y += wave1 + wave2 + wave3;
}
`,
    )
    .replace(
      "#include <worldpos_vertex>",
      `
vec4 worldPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  worldPosition = instanceMatrix * worldPosition;
#endif
worldPosition = modelMatrix * worldPosition;
vWorldPosition = worldPosition;
vWorldNormal = normalize(mat3(modelMatrix) * normal);

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
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogHeightOrigin;
uniform float uFogHeightDensity;
uniform vec3 uSkyFogTopColor;
uniform vec3 uSkyFogMiddleColor;
uniform vec3 uSkyFogBottomColor;
uniform float uSkyFogOffset;
uniform float uSkyFogVoidOffset;
uniform float uSkyFogExponent;
uniform float uSkyFogExponent2;
uniform float uSkyFogDimension;
uniform float uSkyFogStrength;
uniform float uTime;
uniform float uAtlasSize;
uniform float uShowGreedyDebug;

uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uSunlightIntensity;
uniform vec3 uAmbientColor;

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

uniform vec3 uSkyTopColor;
uniform vec3 uSkyMiddleColor;
uniform float uShadowDebugMode;

varying float vAO;
varying float vIsFluid;
varying float vIsGreedy;
varying vec4 vLight;
varying vec4 vWorldPosition;
varying vec3 vWorldNormal;
varying float vViewDepth;
varying vec4 vShadowCoord0;
varying vec4 vShadowCoord1;
varying vec4 vShadowCoord2;

${SIMPLEX_NOISE_GLSL}

float shadowMapEdgeFade(vec3 coord) {
  float fadeWidth = 0.08;
  float fx = smoothstep(0.0, fadeWidth, coord.x) * smoothstep(0.0, fadeWidth, 1.0 - coord.x);
  float fy = smoothstep(0.0, fadeWidth, coord.y) * smoothstep(0.0, fadeWidth, 1.0 - coord.y);
  return fx * fy;
}


float sampleShadowMapFast(sampler2D shadowMap, vec4 shadowCoord, float slopeBias, float receiverBiasScale) {
  vec3 coord = shadowCoord.xyz / shadowCoord.w;
  coord = coord * 0.5 + 0.5;

  if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z < 0.0 || coord.z > 1.0) {
    return 1.0;
  }

  float bias = (uShadowBias + slopeBias) * receiverBiasScale;
  vec2 texelSize = vec2(1.0) / vec2(textureSize(shadowMap, 0));

  float shadow = (coord.z - bias > texture(shadowMap, coord.xy).r) ? 0.0 : 1.0;
  shadow += (coord.z - bias > texture(shadowMap, coord.xy + texelSize * vec2(-1.0, -1.0)).r) ? 0.0 : 1.0;
  shadow += (coord.z - bias > texture(shadowMap, coord.xy + texelSize * vec2(1.0, -1.0)).r) ? 0.0 : 1.0;
  shadow += (coord.z - bias > texture(shadowMap, coord.xy + texelSize * vec2(-1.0, 1.0)).r) ? 0.0 : 1.0;
  shadow += (coord.z - bias > texture(shadowMap, coord.xy + texelSize * vec2(1.0, 1.0)).r) ? 0.0 : 1.0;

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
      shadow += weight * ((coord.z - bias > depth) ? 0.0 : 1.0);
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
float torchBrightness = max(max(smoothTorch.r, smoothTorch.g), smoothTorch.b);
vec3 torchLight = smoothTorch * 1.2;

vec3 globalAmbient = vec3(0.025, 0.03, 0.04);

float ambientOcclusion = mix(0.65, 1.0, shadow);
float tunnelDarkening = sunExposure * sunExposure;

float hemisphereBlend = vWorldNormal.y * 0.5 + 0.5;
vec3 groundColor = uAmbientColor * 0.4;
vec3 skyAmbient = mix(groundColor, uAmbientColor, hemisphereBlend);

float texLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
float isBrightTex = smoothstep(0.75, 0.95, texLuma);

float aoFactor = mix(vAO, 1.0, vIsFluid * 0.8);
float torchDominance = torchBrightness / (torchBrightness + dot(sunContribution, vec3(0.33)) + 0.01);
float torchAOReduction = torchDominance * 0.03;
float enhancedAO = mix(aoFactor, 1.0, torchAOReduction);

vec3 sunTotal = skyAmbient * ambientOcclusion * tunnelDarkening;
vec3 reducedSun = sunContribution * mix(1.0, 0.7, isBrightTex);
sunTotal += reducedSun;

vec3 bounceLight = uAmbientColor * 0.04 * (1.0 - shadow) * sunExposure * uSunlightIntensity;
sunTotal += bounceLight;
sunTotal += globalAmbient;

vec3 totalLight = 1.0 - (1.0 - sunTotal) * (1.0 - torchLight);

vec3 warmTint = vec3(1.05, 0.92, 0.75);
vec3 coolTint = vec3(0.92, 0.95, 1.05);
vec3 temperatureShift = mix(coolTint, warmTint, torchDominance);
totalLight *= temperatureShift;

totalLight *= enhancedAO;

if (vWorldPosition.y < uWaterLevel && vIsFluid < 0.5) {
  float causticsTime = uTime * 0.0003;
  float waterDepth = uWaterLevel - vWorldPosition.y;
  float depthFade = exp(-waterDepth * 0.15);

  float c1 = snoise(vec3(vWorldPosition.xz * 0.3 + causticsTime * 0.4, causticsTime));
  float c2 = snoise(vec3(vWorldPosition.xz * 0.5 - causticsTime * 0.3, causticsTime * 1.3 + 5.0));
  float caustic = (c1 * c1 + c2 * c2) * 0.5;

  float causticStrength = depthFade * shadow * uSunlightIntensity * 0.25;
  totalLight += vec3(caustic * causticStrength);
}

totalLight = (totalLight * (2.51 * totalLight + 0.03))
           / (totalLight * (2.43 * totalLight + 0.59) + 0.14);
outgoingLight.rgb *= totalLight;

if (vIsFluid > 0.5) {
  float waveTime = uTime * 0.0005;
  vec3 wPos = vWorldPosition.xyz;
  vec3 absWaterNormal = abs(vWorldNormal);
  float topWaterFace = smoothstep(0.45, 0.9, vWorldNormal.y);
  float sideWaterFace = smoothstep(0.45, 0.9, max(absWaterNormal.x, absWaterNormal.z));

  float eps = 0.08;

  float roughNoise = snoise(vec3(wPos.x * 0.04 - waveTime * 0.08, wPos.z * 0.04 + waveTime * 0.06, -10.0));
  float roughMul = 0.3 + 0.7 * (roughNoise * 0.5 + 0.5);

  float swellTiltX = snoise(vec3(wPos.x * 0.05 + waveTime * 0.07, wPos.z * 0.05 - waveTime * 0.05, -5.0)) * 0.07;
  float swellTiltZ = snoise(vec3(wPos.x * 0.05 - waveTime * 0.04, wPos.z * 0.05 + waveTime * 0.07, -8.0)) * 0.07;

  float lg1 = snoise(vec3(wPos.x * 0.3 + waveTime * 0.25, wPos.z * 0.3 - waveTime * 0.2, 0.0));
  float lg1x = snoise(vec3((wPos.x + eps) * 0.3 + waveTime * 0.25, wPos.z * 0.3 - waveTime * 0.2, 0.0));
  float lg1z = snoise(vec3(wPos.x * 0.3 + waveTime * 0.25, (wPos.z + eps) * 0.3 - waveTime * 0.2, 0.0));

  float md1 = snoise(vec3(wPos.x * 1.5 + waveTime * 0.4, wPos.z * 1.5 - waveTime * 0.35, 5.0));
  float md1x = snoise(vec3((wPos.x + eps) * 1.5 + waveTime * 0.4, wPos.z * 1.5 - waveTime * 0.35, 5.0));
  float md1z = snoise(vec3(wPos.x * 1.5 + waveTime * 0.4, (wPos.z + eps) * 1.5 - waveTime * 0.35, 5.0));

  float hLg0 = lg1 * 0.3;
  float hLgX = lg1x * 0.3;
  float hLgZ = lg1z * 0.3;

  float hMed0 = md1 * 0.6 * roughMul;
  float hMedX = md1x * 0.6 * roughMul;
  float hMedZ = md1z * 0.6 * roughMul;

  vec3 waterNormal = normalize(vec3(
    swellTiltX + (hLg0 - hLgX) * 0.8 + (hMed0 - hMedX) * 1.2,
    1.0,
    swellTiltZ + (hLg0 - hLgZ) * 0.8 + (hMed0 - hMedZ) * 1.2
  ));

  if (vWorldNormal.y < 0.5) {
    waterNormal = vWorldNormal;
  }

  vec3 viewDir = normalize(cameraPosition - wPos);
  float NdotV = max(dot(waterNormal, viewDir), 0.0);
  float fresnel = 0.02 + uWaterFresnelStrength * pow(1.0 - NdotV, 5.0);
  fresnel = clamp(fresnel, 0.02, 0.4);

  vec3 reflectDir = reflect(-viewDir, waterNormal);
  float skyBlend = clamp(reflectDir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 skyReflection = mix(uSkyMiddleColor, uSkyTopColor, skyBlend);

  vec3 halfVec = normalize(uSunDirection + viewDir);
  float specAngle = max(dot(waterNormal, halfVec), 0.0);
  float spec32 = specAngle * specAngle;
  spec32 *= spec32;
  spec32 *= spec32;
  spec32 *= spec32;
  spec32 *= spec32;
  float specMed = spec32 * spec32 * spec32 * uSunlightIntensity * 0.18;
  vec3 specularColor = uSunColor * (spec32 * uSunlightIntensity * 0.08 + specMed);

  vec3 baseWater = outgoingLight.rgb;

  float distToCamera = length(cameraPosition - wPos);
  float depthFactor = 1.0 - exp(-distToCamera * 0.008);
  float verticalDepthFactor = 1.0 - exp(-max(0.0, uWaterLevel - wPos.y) * 0.11);
  vec3 shallowWater = mix(baseWater, uWaterTint, 0.14);
  vec3 deepWater = mix(baseWater, uWaterTint, 0.38);
  vec3 waterColor = mix(shallowWater, deepWater, max(depthFactor, verticalDepthFactor) * 0.92);

  float sideSelector = step(absWaterNormal.x, absWaterNormal.z);
  float sideCoord = mix(wPos.z, wPos.x, sideSelector);
  float streakNoise = snoise(vec3(sideCoord * 1.4, wPos.y * 0.32 - waveTime * 0.75, 17.0));
  float fineStreakNoise = snoise(vec3(sideCoord * 5.0, wPos.y * 0.9 - waveTime * 1.4, 27.0));
  float streak = smoothstep(0.35, 0.95, streakNoise * 0.7 + fineStreakNoise * 0.3);
  vec3 streakColor = mix(waterColor * 0.96, waterColor + uWaterTint * 0.08, streak);
  waterColor = mix(waterColor, streakColor, sideWaterFace * uWaterStreakStrength);

  outgoingLight.rgb = mix(waterColor, skyReflection, fresnel);
  outgoingLight.rgb += specularColor;

  float waterDepth = max(0.0, uWaterLevel - vWorldPosition.y);
  vec3 absorption = vec3(0.025, 0.012, 0.004);
  outgoingLight.rgb *= exp(-absorption * waterDepth * uWaterAbsorption);
}
`,
    )
    .replace(
      "#include <fog_fragment>",
      `
vec2 fogDiff = vWorldPosition.xz - cameraPosition.xz;
float depth = sqrt(dot(fogDiff, fogDiff));
float distFog = smoothstep(uFogNear, uFogFar, depth);
float heightFog = 1.0 - exp(-uFogHeightDensity * max(0.0, uFogHeightOrigin - vWorldPosition.y));
float heightDistScale = smoothstep(uFogNear * 0.3, uFogFar * 0.6, depth);
float fogFactor = max(distFog, heightFog * heightDistScale);

vec3 fogRay = normalize(vWorldPosition.xyz - cameraPosition);
vec3 skyDomePos = cameraPosition + fogRay * uSkyFogDimension;
float sfH = normalize(skyDomePos + uSkyFogOffset).y;
float sfH2 = normalize(skyDomePos + uSkyFogVoidOffset).y;
vec3 skyColor = mix(uSkyFogMiddleColor, uSkyFogTopColor, max(pow(max(sfH, 0.0), uSkyFogExponent), 0.0));
skyColor = mix(skyColor, uSkyFogBottomColor, max(pow(max(-sfH2, 0.0), uSkyFogExponent2), 0.0));

vec3 fogTint = mix(uFogColor, skyColor, uSkyFogStrength);

float sunAlignment = pow(max(0.0, dot(fogRay, uSunDirection)), 6.0);
fogTint += uSunColor * sunAlignment * uSunlightIntensity * uSkyFogStrength * 0.35;

gl_FragColor.rgb = mix(gl_FragColor.rgb, fogTint, fogFactor);

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
`,
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
    .replace(`if (vIsFluid > 0.5) {`, `if (false) {`),
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

  const swayCode = `
float swayScale = uTime * 0.00002 * ${speed.toFixed(2)};
float rootScale = ${rooted ? "(position.y - floor(position.y))" : "1.0"};
float swayNoise = snoise(vec3(
  position.x * swayScale + uWindOffset.x,
  position.y * swayScale * ${yScale.toFixed(2)},
  position.z * swayScale + uWindOffset.y
));
transformed.x += rootScale * ${scale.toFixed(
    2,
  )} * swayNoise * 2.0 * ${amplitude.toFixed(2)};
transformed.z += rootScale * ${scale.toFixed(
    2,
  )} * swayNoise * ${amplitude.toFixed(2)} * uWindSpeed * 0.5;
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
