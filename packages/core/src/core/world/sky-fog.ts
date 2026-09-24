import {
  createUnderwaterFogFragment,
  UNDERWATER_FOG_UNIFORM_DECLARATIONS,
} from "./water-optics";

/**
 * Sky-fog uniforms minus the sun trio, for shaders whose lighting chunk
 * already declares `uSunDirection`, `uSunColor`, and `uSunlightIntensity`
 * (e.g. entity materials composing this alongside their shadow chunk).
 */
export const SKY_FOG_COMMON_UNIFORM_DECLARATIONS = `
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
uniform float uChunkReveal;
// 0 outdoors (fog by horizontal distance), rising to 1 under deep cover so a
// tall cave ceiling hazes with its true distance like the walls do.
uniform float uFogVerticalBlend;
${UNDERWATER_FOG_UNIFORM_DECLARATIONS}
`;

export const SKY_FOG_SUN_UNIFORM_DECLARATIONS = `
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uSunlightIntensity;
`;

export const SKY_FOG_UNIFORM_DECLARATIONS = `
${SKY_FOG_COMMON_UNIFORM_DECLARATIONS}
${SKY_FOG_SUN_UNIFORM_DECLARATIONS}
`;

/**
 * @param depthExpression GLSL for the fog distance of this fragment.
 * @param revealExpression GLSL in [0, 1] for how much of the surface shows
 * through its own fog color: 0 draws the fragment as pure fog tint (the
 * sky-dome gradient it would vanish into), 1 applies fog normally. Chunk
 * shaders multiply the material uniform by a per-section varying so the
 * terrain fade-in can address one section at a time.
 * @param isEmission Additive effects attenuate without adding sky color.
 */
export const createSkyAtmosphereFragment = (
  depthExpression = "sqrt(dot(fogDiff, fogDiff))",
  revealExpression = "uChunkReveal",
  isEmission = false,
) => `
vec2 fogDiff = vWorldPosition.xz - cameraPosition.xz;
float depth = mix(
  ${depthExpression},
  length(vWorldPosition.xyz - cameraPosition),
  uFogVerticalBlend
);
float distFog = smoothstep(uFogNear, uFogFar, depth);
float heightFog = 1.0 - exp(-uFogHeightDensity * max(0.0, uFogHeightOrigin - vWorldPosition.y));
float heightDistScale = smoothstep(uFogNear * 0.3, uFogFar * 0.6, depth);
float fogFactor = max(distFog, heightFog * heightDistScale);

vec3 fogRay = normalize(vWorldPosition.xyz - cameraPosition);
// Match the camera-centered sky shader. Absolute world coordinates make the
// sampled dome cross the origin far from spawn, collapsing its gradient into
// a radial seam across fully fogged terrain.
vec3 skyDomePos = fogRay * uSkyFogDimension;
float sfH = normalize(skyDomePos + uSkyFogOffset).y;
float sfH2 = normalize(skyDomePos + uSkyFogVoidOffset).y;
vec3 skyColor = mix(uSkyFogMiddleColor, uSkyFogTopColor, max(pow(max(sfH, 0.0), uSkyFogExponent), 0.0));
skyColor = mix(skyColor, uSkyFogBottomColor, max(pow(max(-sfH2, 0.0), uSkyFogExponent2), 0.0));

vec3 fogTint = mix(uFogColor, skyColor, uSkyFogStrength);

// The sun's halo in the haze belongs to open air: under rock (the same
// cover that switches the fog to true 3D distance) there is no sun to see
// through the walls, and the halo lit far cave walls pale blue-white.
float sunAlignment = pow(max(0.0, dot(fogRay, uSunDirection)), 6.0);
fogTint += uSunColor * sunAlignment * uSunlightIntensity * uSkyFogStrength * 0.35
  * (1.0 - uFogVerticalBlend);

float effectiveFogFactor = mix(1.0, fogFactor * (1.0 - uCameraSubmersion), ${revealExpression});
gl_FragColor.rgb = ${isEmission ? "gl_FragColor.rgb * (1.0 - effectiveFogFactor)" : "mix(gl_FragColor.rgb, fogTint, effectiveFogFactor)"};
`;

export const createSkyFogFragment = (
  depthExpression?: string,
  revealExpression?: string,
  isEmission = false,
) => `${createSkyAtmosphereFragment(depthExpression, revealExpression, isEmission)}
${createUnderwaterFogFragment(isEmission)}`;

export const SKY_FOG_FRAGMENT = createSkyFogFragment();
