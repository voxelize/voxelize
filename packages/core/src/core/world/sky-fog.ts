export const SKY_FOG_UNIFORM_DECLARATIONS = `
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
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uSunlightIntensity;
`;

export const createSkyFogFragment = (
  depthExpression = "sqrt(dot(fogDiff, fogDiff))",
) => `
vec2 fogDiff = vWorldPosition.xz - cameraPosition.xz;
float depth = ${depthExpression};
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
`;

export const SKY_FOG_FRAGMENT = createSkyFogFragment();
