import {
  Matrix4,
  type PerspectiveCamera,
  type TextureNode,
  Vector3,
} from "three/webgpu";
import {
  atan,
  Break,
  dot,
  exp,
  float,
  Fn,
  If,
  Loop,
  max,
  normalize,
  sqrt,
  vec3,
  vec4,
} from "three/tsl";

import {
  AIRLIGHT_SLOTS,
  type LocalLightAirlight,
} from "../../core/world/local-lights/airlight";
import {
  perspectiveDepthToViewZ,
  targetUvToNdc,
} from "../../core/world/shading/conventions";
import type {
  FloatNode,
  Vec2Node,
  Vec3Node,
  Vec4Node,
} from "../../core/world/shading/types";
import { ownUniform } from "../../core/world/shading/uniforms";

/**
 * Lamp light in the air: along each view ray, the light the air scatters
 * toward the eye from the few local lights the camera can see, integrated
 * in closed form up to the surface the ray hits. A ray passing near a torch
 * collects warmth that thickens toward the source; a ray that ends on a
 * wall before reaching the light collects only the air in front of the
 * wall. No ray march, one node in the frame's effect chain, and an early
 * out when no member glows (daylight, no lights in view, strength 0).
 *
 * It reads the uniform set a {@link LocalLightAirlight} maintains; the
 * camera's matrices are copied on every {@link update}, since a screen pass
 * draws with its own camera, not the scene's.
 */
export class LocalLightAirlightEffect {
  readonly uniforms = {
    inverseProjection: ownUniform(new Matrix4()),
    cameraWorld: ownUniform(new Matrix4()),
    cameraPosition: ownUniform(new Vector3()),
    near: ownUniform(0.1),
    far: ownUniform(1000),
    skyDistance: ownUniform(192),
  };

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly airlight: LocalLightAirlight,
    options: { skyDistance?: number } = {},
  ) {
    this.uniforms.skyDistance.value = options.skyDistance ?? 192;
    if (airlight.uniforms.seen.value.length !== AIRLIGHT_SLOTS) {
      throw new Error("air-light uniform arrays must hold AIRLIGHT_SLOTS");
    }
  }

  /** Copies the scene camera the effect reconstructs rays from. */
  update(): void {
    const u = this.uniforms;
    u.inverseProjection.value.copy(this.camera.projectionMatrixInverse);
    u.cameraWorld.value.copy(this.camera.matrixWorld);
    this.camera.getWorldPosition(u.cameraPosition.value);
    u.near.value = this.camera.near;
    u.far.value = this.camera.far;
  }

  /**
   * The frame's colour with the air light added. `depth` is the scene's
   * depth texture, read at `uv` (a target uv).
   */
  apply(color: Vec4Node, depth: TextureNode, uv: Vec2Node): Vec4Node {
    const u = this.uniforms;
    const set = this.airlight.uniforms;
    const member = (index: Parameters<typeof set.members.node.element>[0]) =>
      set.members.node.element(index) as unknown as Vec4Node;
    return Fn(() => {
      const result = vec4(color).toVar("airColor");
      If(set.count.greaterThan(0).and(set.airActive.greaterThan(0.5)), () => {
        const d = depth.sample(uv).level(float(0)).r.toVar("airDepth");
        const farPoint = u.inverseProjection.mul(vec4(targetUvToNdc(uv), 1, 1));
        const viewRay = normalize(farPoint.xyz.div(farPoint.w)).toVar("airViewRay");
        const viewZ = perspectiveDepthToViewZ(d, u.near, u.far);
        const rayLength = d
          .greaterThanEqual(1)
          .select(u.skyDistance, viewZ.div(max(viewRay.z.negate(), 1e-4)))
          .toVar("airRayLength");
        const ray = normalize(u.cameraWorld.mul(vec4(viewRay, 0)).xyz).toVar("airRay");
        const scattered = vec3(0).toVar("airScattered");
        Loop(AIRLIGHT_SLOTS, ({ i }) => {
          If(float(i).greaterThanEqual(set.count), () => {
            Break();
          });
          const position = member(i.mul(2));
          const light = member(i.mul(2).add(1));
          const toLight = position.xyz.sub(u.cameraPosition).toVar();
          const closest = dot(toLight, ray).toVar();
          const miss2 = max(dot(toLight, toLight).sub(closest.mul(closest)), 0).toVar();
          const range = position.w;
          If(miss2.lessThan(range.mul(range)), () => {
            const core = light.w;
            const spread = sqrt(miss2.add(core.mul(core))).toVar();
            // Closed form of the integral of 1 / (spread^2 + (s - closest)^2)
            // for s from the eye to the surface: inverse-square light,
            // softened by the core.
            const along = atan(rayLength.sub(closest).div(spread))
              .add(atan(closest.div(spread)))
              .div(spread);
            // Nothing past the light's range, easing to zero at its edge.
            const window = miss2.div(range.mul(range)).oneMinus();
            const seen = (set.seen.node.element(i) as unknown as Vec4Node).x;
            scattered.addAssign(
              (light.rgb as Vec3Node).mul(
                seen
                  .mul(core)
                  .mul(core)
                  .mul(along)
                  .mul(window)
                  .mul(window) as FloatNode,
              ),
            );
          });
        });
        // Soft ceiling: a dense field thickens the air, never paints it white.
        const air = exp(scattered.mul(set.strength).negate().div(set.maxAdded))
          .oneMinus()
          .mul(set.maxAdded);
        result.assign(vec4(result.rgb.add(air), result.a));
      });
      return result;
    })() as unknown as Vec4Node;
  }
}
