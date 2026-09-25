import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import { Matrix4, PerspectiveCamera, Uniform, Vector3 } from "three";

import {
  AIRLIGHT_SEEN_GLSL,
  AIRLIGHT_SLOTS,
  AIRLIGHT_UNIFORMS_GLSL,
  LocalLightAirlight,
} from "../../core/world/local-lights/airlight";

/**
 * Lamp light in the air (block-light plan step 5): along each view ray, the
 * light the air scatters toward the eye from the few local lights the
 * camera can see, integrated in closed form up to the surface the ray hits.
 * A ray passing near a torch collects warmth that thickens toward the
 * source; a ray that ends on a wall before reaching the light collects only
 * the air in front of the wall. No ray march, one pass merged with the rest
 * of the effect chain, and an early out when no member glows (daylight, no
 * lights in view, strength 0).
 *
 * Voxel-native by default (`uAirBands` > 0): each ray ends at the centre of
 * the 1/16-block texel it lands in, so the glow is one flat value per texel
 * of the surface behind it, and that value is cut into a few flat
 * brightness bands. The sky behind gets none. `uAirBands` 0 is the smooth
 * haze it replaced, kept for A/B.
 */
const fragmentShader = /* glsl */ `
${AIRLIGHT_UNIFORMS_GLSL}
${AIRLIGHT_SEEN_GLSL}
uniform float uAirActive;
uniform float uAirBands;
uniform float uAirStrength;
uniform float uAirMaxAdded;
uniform float uAirSkyDistance;
uniform mat4 uAirInverseProjection;
uniform mat4 uAirCameraWorld;
uniform vec3 uAirCameraPosition;

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  outputColor = inputColor;
  if (uAirCount == 0 || uAirActive < 0.5) return;
  bool isBanded = uAirBands > 0.5;
  if (isBanded && depth >= 1.0) return;

  vec4 farPoint = uAirInverseProjection * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 viewRay = normalize(farPoint.xyz / farPoint.w);
  float viewZ = perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
  float rayLength = depth >= 1.0 ? uAirSkyDistance : viewZ / viewRay.z;
  vec3 ray = normalize((uAirCameraWorld * vec4(viewRay, 0.0)).xyz);
  if (isBanded) {
    // End the ray at the centre of the texel it lands in (a 32nd of a
    // block past the face, so always inside the block it hit): every pixel
    // of that texel then integrates the same ray.
    vec3 rayEnd = uAirCameraPosition + ray * (rayLength + 0.03125);
    vec3 toEnd = (floor(rayEnd * 16.0) + 0.5) * 0.0625 - uAirCameraPosition;
    rayLength = length(toEnd);
    ray = toEnd / max(rayLength, 1e-4);
  }

  vec3 scattered = vec3(0.0);
  for (int i = 0; i < AIRLIGHT_SLOTS; i++) {
    if (i >= uAirCount) break;
    vec3 toLight = uAirPos[i].xyz - uAirCameraPosition;
    float closest = dot(toLight, ray);
    float miss2 = max(dot(toLight, toLight) - closest * closest, 0.0);
    float range = uAirPos[i].w;
    if (miss2 >= range * range) continue;
    float core = uAirColor[i].w;
    float spread = sqrt(miss2 + core * core);
    // Closed form of the integral of 1 / (spread^2 + (s - closest)^2) for s
    // from the eye to the surface: inverse-square light, softened by the core.
    float along = (atan((rayLength - closest) / spread) + atan(closest / spread)) / spread;
    // Nothing past the light's range, easing to zero at its edge.
    float window = 1.0 - miss2 / (range * range);
    scattered += uAirColor[i].rgb * (uAirSeen[i] * core * core * along * window * window);
  }

  // Soft ceiling: a dense field thickens the air, never paints it white.
  vec3 air = scattered * uAirStrength;
  air = uAirMaxAdded * (1.0 - exp(-air / uAirMaxAdded));
  if (isBanded) {
    // Flat bands, even in perceived brightness, hue kept; the faint tail
    // below the first band is clean zero, not a soft fringe.
    float peak = max(max(air.r, air.g), air.b);
    float level = floor(sqrt(peak / uAirMaxAdded) * uAirBands) / uAirBands;
    air *= (level * level * uAirMaxAdded) / max(peak, 1e-6);
  }
  outputColor = vec4(inputColor.rgb + air, inputColor.a);
}
`;

/**
 * Screen-space half of the air light. Reads the uniform set a
 * {@link LocalLightAirlight} maintains; the camera's matrices are refreshed
 * on every frame the pass renders.
 */
export class LocalLightAirlightEffect extends Effect {
  private readonly camera: PerspectiveCamera;
  private readonly inverseProjection: Uniform<Matrix4>;
  private readonly cameraWorld: Uniform<Matrix4>;
  private readonly cameraPosition: Uniform<Vector3>;

  constructor(
    camera: PerspectiveCamera,
    airlight: LocalLightAirlight,
    options: { skyDistance?: number } = {},
  ) {
    const set = airlight.uniforms;
    const inverseProjection = new Uniform(new Matrix4());
    const cameraWorld = new Uniform(new Matrix4());
    const cameraPosition = new Uniform(new Vector3());
    super("LocalLightAirlightEffect", fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ["uAirCount", set.count as Uniform],
        ["uAirPos", set.positions as Uniform],
        ["uAirColor", set.colors as Uniform],
        ["uAirSeen", set.seen as Uniform],
        ["uAirActive", set.airActive as Uniform],
        ["uAirBands", set.bands as Uniform],
        ["uAirStrength", set.strength as Uniform],
        ["uAirMaxAdded", set.maxAdded as Uniform],
        ["uAirSkyDistance", new Uniform(options.skyDistance ?? 192)],
        ["uAirInverseProjection", inverseProjection],
        ["uAirCameraWorld", cameraWorld],
        ["uAirCameraPosition", cameraPosition],
      ]),
    });
    this.camera = camera;
    this.inverseProjection = inverseProjection;
    this.cameraWorld = cameraWorld;
    this.cameraPosition = cameraPosition;
    if (set.positions.value.length !== AIRLIGHT_SLOTS) {
      throw new Error("air-light uniform arrays must hold AIRLIGHT_SLOTS");
    }
  }

  update(): void {
    this.inverseProjection.value.copy(this.camera.projectionMatrixInverse);
    this.cameraWorld.value.copy(this.camera.matrixWorld);
    this.camera.getWorldPosition(this.cameraPosition.value);
  }
}
