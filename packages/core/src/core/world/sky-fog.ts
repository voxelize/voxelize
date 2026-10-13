import {
  createUnderwaterFogFragment,
  UNDERWATER_FOG_UNIFORM_DECLARATIONS,
} from "./water-optics";

/**
 * The sky's own light (`SkyGlowUniforms` in sky.ts): where the sun's disc is
 * drawn, never clamped or tilted like the shading light; the colours of the
 * light around it, each already scaled by its strength; and the discs
 * themselves, as the host draws them, for the fog to carry. Black leaves
 * the sky and the fog exactly as they were.
 */
export const SKY_GLOW_UNIFORM_DECLARATIONS = `
uniform vec3 uSkyGlowSunDirection;
uniform vec3 uSkyGlowColor;
uniform vec3 uSkySunHaloColor;
uniform vec3 uSkyMoonHaloColor;
uniform vec3 uSkySunDiscColor;
uniform vec3 uSkyMoonDiscColor;
uniform vec2 uSkyDiscRadii;
`;

// Angle from each disc's centre as a chord: radians while small, and
// monotonic all the way round, with no acos. The moon is opposite the sun.
const skyDiscAngles = (ray: string) => `
  float skyGlowSunDot = dot(${ray}, uSkyGlowSunDirection);
  float skyGlowSunAngle = sqrt(max(2.0 - 2.0 * skyGlowSunDot, 0.0));
  float skyGlowMoonAngle = sqrt(max(2.0 + 2.0 * skyGlowSunDot, 0.0));
  vec2 skyGlowRadii = max(uSkyDiscRadii, vec2(1e-3));`;

/**
 * GLSL statements declaring `target` as the sky's own light along the unit
 * ray `direction`: a broad aura around the sun, alive before it rises (the
 * "light is coming" of pre-dawn); a band along the horizon on the sun's
 * side; and round each disc a corona hugging its limb inside the halo the
 * haze scatters wider. The sky dome adds it to its gradient and every
 * fogged surface to its fog colour, so a ridge hazed into a sunset glows
 * exactly like the sky behind it. All of it is the beam's: cloud veils it.
 *
 * Statements in their own block, not a function, so they compose inside any
 * `main` (the fog fragment is spliced into many) and namespace cleanly.
 */
export const createSkyGlowStatements = (direction: string, target: string) => `
vec3 ${target} = vec3(0.0);
{
  vec3 skyGlowRay = ${direction};
  ${skyDiscAngles("skyGlowRay")}
  float skyGlowAura = pow(max(skyGlowSunDot, 0.0), 14.0);
  vec2 skyGlowRayFlat = normalize(skyGlowRay.xz + vec2(1e-5, 0.0));
  vec2 skyGlowSunFlat = normalize(uSkyGlowSunDirection.xz + vec2(1e-5, 0.0));
  float skyGlowSide = clamp(dot(skyGlowRayFlat, skyGlowSunFlat) * 0.5 + 0.5, 0.0, 1.0);
  float skyGlowBand = exp(-abs(skyGlowRay.y) * 5.5) * skyGlowSide * skyGlowSide;
  // The corona runs on from the limb, in disc radii past it.
  vec2 skyGlowBeyond = max(vec2(skyGlowSunAngle, skyGlowMoonAngle) - skyGlowRadii, 0.0) / skyGlowRadii;
  ${target} = (
    uSkyGlowColor * min(skyGlowAura * 0.85 + skyGlowBand * 0.55, 1.0)
    + uSkySunHaloColor * (
      exp(-skyGlowBeyond.x * 2.4)
      + exp(-skyGlowSunAngle * 10.0) * 0.6
      + exp(-skyGlowSunAngle * 3.2) * 0.22
    )
    + uSkyMoonHaloColor * (
      exp(-skyGlowBeyond.y * 3.0) * 2.5
      + exp(-skyGlowMoonAngle * 14.0) * 0.7
      + exp(-skyGlowMoonAngle * 4.0) * 0.15
    )
  ) * uDirectSunlight;
}`;

/**
 * GLSL statements declaring `target` as the sun's and the moon's discs along
 * the unit ray `direction`, for the fog alone (the host draws the discs in
 * the sky). Terrain hides a disc by depth even where its fog has made it
 * the sky's own colour, so without these a sun setting behind a hazed-out
 * ridge vanished in mid-air; with them a fully hazed ridge is the sky,
 * disc and all, and a nearer one lets the disc through as much as its haze
 * does. The horizon takes them from below, as it does in the sky.
 */
export const createSkyDiscStatements = (direction: string, target: string) => `
vec3 ${target} = vec3(0.0);
{
  vec3 skyDiscRay = ${direction};
  ${skyDiscAngles("skyDiscRay")}
  vec2 skyDiscAngle = vec2(skyGlowSunAngle, skyGlowMoonAngle);
  vec2 skyDiscCover = 1.0 - smoothstep(skyGlowRadii * 0.9, skyGlowRadii * 1.1, skyDiscAngle);
  float skyDiscHorizon = smoothstep(-0.035, 0.05, skyDiscRay.y);
  ${target} = (uSkySunDiscColor * skyDiscCover.x + uSkyMoonDiscColor * skyDiscCover.y)
    * skyDiscHorizon * uDirectSunlight;
}`;

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
// The share of the sun reaching the world as a beam (directSunlight in
// chunk-renderer.ts): glints, caustics, the sun's glitter through a water
// surface and the sun's halo in the haze scale by it; diffuse daylight does
// not.
uniform float uDirectSunlight;
${SKY_GLOW_UNIFORM_DECLARATIONS}
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
${
  isEmission
    ? ""
    : `
// The sky's own light along the same ray, discs included, so the haze
// glows toward the sun and moon exactly as the sky behind it does, and a
// ridge hazed out entirely is the sky itself. It belongs to open air:
// under rock (the same cover that switches the fog to true 3D distance)
// there is no sky to see through the walls, and a halo lit far cave walls
// pale blue-white.
${createSkyGlowStatements("fogRay", "fogGlow")}
${createSkyDiscStatements("fogRay", "fogDiscs")}
fogTint += (fogGlow + fogDiscs) * uSkyFogStrength * (1.0 - uFogVerticalBlend);
`
}
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
