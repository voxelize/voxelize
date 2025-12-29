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

/**
 * This is the default shaders used for the chunks.
 */
export const DEFAULT_CHUNK_SHADERS = {
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
uniform vec4 uAOTable;
uniform float uTime;

vec4 unpackLight(int l) {
  vec4 lightValues = vec4(
    (l >> 8) & 0xF,
    (l >> 4) & 0xF,
    l & 0xF,
    (l >> 12) & 0xF
  );
  return lightValues / 15.0;
}

#include <common>
`
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
`
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
`
    ),
  fragment: ShaderLib.basic.fragmentShader
    .replace(
      "#include <common>",
      `
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uSunlightIntensity;
uniform float uMinLightLevel;
uniform float uBaseAmbient;
uniform float uLightIntensityAdjustment;
uniform float uTime;
uniform float uAtlasSize;
uniform float uShowGreedyDebug;
varying float vAO;
varying float vIsFluid;
varying float vIsGreedy;
varying vec4 vLight; 
varying vec4 vWorldPosition;
varying vec3 vWorldNormal;

#include <common>
`
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
`
    )
    .replace(
      "#include <envmap_fragment>",
      `
#include <envmap_fragment>

// Adjusting light intensity for lighter voxel textures
float scale = 2.0;
float sunlightFactor = vLight.a * vLight.a * uSunlightIntensity * uLightIntensityAdjustment;
float s = clamp(sunlightFactor + uMinLightLevel * vLight.a + uBaseAmbient, 0.0, 1.0);
s -= s * exp(-s) * 0.02;

// Applying adjusted light intensity
outgoingLight.rgb *= s + pow(vLight.rgb * uLightIntensityAdjustment, vec3(scale));

// Apply AO with reduced impact for fluids
float aoFactor = mix(vAO, 1.0, vIsFluid * 0.8);
outgoingLight *= aoFactor;
`
    )
    .replace(
      "#include <fog_fragment>",
      `
    vec2 fogDiff = vWorldPosition.xz - cameraPosition.xz;
    float depth = sqrt(dot(fogDiff, fogDiff));
    float fogFactor = smoothstep(uFogNear, uFogFar, depth);

    gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, fogFactor);
    `
    ),
};

export const customShaders = {
  sway(
    options: Partial<{
      speed: number;
      amplitude: number;
      scale: number;
      rooted: boolean;
      yScale: number;
    }> = {}
  ) {
    return createSwayShader(DEFAULT_CHUNK_SHADERS, options);
  },

  swayShaderBased(
    options: Partial<{
      speed: number;
      amplitude: number;
      scale: number;
      rooted: boolean;
      yScale: number;
    }> = {}
  ) {
    return createSwayShader(SHADER_LIGHTING_CHUNK_SHADERS, options);
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
uniform mat4 uShadowMatrix0;
uniform mat4 uShadowMatrix1;
uniform mat4 uShadowMatrix2;
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

#include <common>
`
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
`
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

vShadowCoord0 = uShadowMatrix0 * worldPosition;
vShadowCoord1 = uShadowMatrix1 * worldPosition;
vShadowCoord2 = uShadowMatrix2 * worldPosition;
`
    ),
  fragment: ShaderLib.basic.fragmentShader
    .replace(
      "#include <common>",
      `
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
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
uniform float uShadowStrength;

uniform highp sampler3D uLightVolume;
uniform vec3 uLightVolumeMin;
uniform vec3 uLightVolumeSize;

uniform vec3 uWaterTint;
uniform float uWaterAbsorption;
uniform float uWaterLevel;

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

float sampleShadowMap(sampler2D shadowMap, vec4 shadowCoord, float slopeBias) {
  vec3 coord = shadowCoord.xyz / shadowCoord.w;
  coord = coord * 0.5 + 0.5;
  
  if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z < 0.0 || coord.z > 1.0) {
    return 1.0;
  }
  
  float bias = uShadowBias + slopeBias;
  
  float shadow = 0.0;
  vec2 texelSize = vec2(1.0) / vec2(textureSize(shadowMap, 0));
  
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      float depth = texture(shadowMap, coord.xy + vec2(x, y) * texelSize).r;
      shadow += (coord.z - bias > depth) ? 0.0 : 1.0;
    }
  }
  
  return shadow / 9.0;
}

float getShadow() {
  if (uShadowStrength < 0.01) {
    return 1.0;
  }
  
  float NdotL = max(dot(vWorldNormal, uSunDirection), 0.0);
  float slopeBias = 0.005 * (1.0 - NdotL);
  
  float rawShadow;
  if (vViewDepth < uCascadeSplit0) {
    rawShadow = sampleShadowMap(uShadowMap0, vShadowCoord0, slopeBias);
  } else if (vViewDepth < uCascadeSplit1) {
    rawShadow = sampleShadowMap(uShadowMap1, vShadowCoord1, slopeBias * 1.5);
  } else if (vViewDepth < uCascadeSplit2) {
    rawShadow = sampleShadowMap(uShadowMap2, vShadowCoord2, slopeBias * 2.0);
  } else {
    return 1.0;
  }
  
  return mix(1.0, rawShadow, uShadowStrength);
}

vec3 sampleLightVolume() {
  vec3 coord = (vWorldPosition.xyz - uLightVolumeMin) / uLightVolumeSize;
  
  if (any(lessThan(coord, vec3(0.0))) || any(greaterThan(coord, vec3(1.0)))) {
    return vec3(0.0);
  }
  
  return texture(uLightVolume, coord).rgb;
}

#include <common>
`
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
`
    )
    .replace(
      "#include <envmap_fragment>",
      `
#include <envmap_fragment>

float shadow = getShadow();

float NdotL = max(dot(vWorldNormal, uSunDirection), 0.0);
float sunExposure = vLight.a;

vec3 sunContribution = uSunColor * NdotL * shadow * uSunlightIntensity;

vec3 cpuTorchLight = vLight.rgb;
float torchBrightness = max(max(cpuTorchLight.r, cpuTorchLight.g), cpuTorchLight.b);
vec3 torchLight = sampleLightVolume() + cpuTorchLight * 1.2;
float torchBloom = torchBrightness * torchBrightness * 0.3;

float ambientOcclusion = mix(0.5, 1.0, shadow);
float inTunnel = step(sunExposure, 0.1);
float tunnelDarkening = mix(1.0, mix(0.25, 1.0, sunExposure * 2.0), inTunnel);
vec3 totalLight = uAmbientColor * ambientOcclusion * tunnelDarkening;
totalLight += sunContribution;
totalLight += torchLight;
totalLight += vec3(torchBloom);

float aoFactor = mix(vAO, 1.0, vIsFluid * 0.8);
totalLight *= aoFactor;

totalLight = min(totalLight, vec3(2.5));

outgoingLight.rgb *= totalLight;

if (vIsFluid > 0.5) {
  outgoingLight.rgb = mix(outgoingLight.rgb, outgoingLight.rgb * uWaterTint, 0.5);
  
  float waterDepth = max(0.0, uWaterLevel - vWorldPosition.y);
  vec3 absorption = vec3(0.2, 0.1, 0.05);
  outgoingLight.rgb *= exp(-absorption * waterDepth * uWaterAbsorption);
}
`
    )
    .replace(
      "#include <fog_fragment>",
      `
vec2 fogDiff = vWorldPosition.xz - cameraPosition.xz;
float depth = sqrt(dot(fogDiff, fogDiff));
float fogFactor = smoothstep(uFogNear, uFogFar, depth);

gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, fogFactor);
`
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
  }> = {}
) {
  const { speed, amplitude, rooted, scale, yScale } = {
    speed: 1,
    amplitude: 0.1,
    rooted: false,
    scale: 1,
    yScale: 1,
    ...options,
  };

  return {
    vertexShader: baseShaders.vertex
      .replace("#include <common>", `${SIMPLEX_NOISE_GLSL}\n#include <common>`)
      .replace(
        "#include <begin_vertex>",
        `
vec3 transformed = vec3(position);
float scale = uTime * 0.00002 * ${speed.toFixed(2)};
transformed.x = position.x 
             + ${
               rooted ? "(position.y - floor(position.y))" : "1.0"
             } * ${scale.toFixed(
          2
        )} * snoise(vec3(position.x * scale, position.y * scale * ${yScale.toFixed(
          2
        )}, position.z * scale)) * 2.0 * ${amplitude.toFixed(2)};
`
      ),
    fragmentShader: baseShaders.fragment,
  };
}
