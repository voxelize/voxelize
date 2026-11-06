import {
  AdditiveBlending,
  type Color,
  InstancedMesh,
  Material,
  MathUtils,
  Mesh,
  Object3D,
  Vector3,
  Vector4,
} from "three/webgpu";

import { arrayUniform } from "./shading/chunk-uniforms";
import { worldUniform } from "./shading/uniforms";

/**
 * Engine-side budget and falloff shaping for dynamic spot-light cones
 * (flashlights, vehicle headlights). The cone list is rebuilt every frame by
 * the game; shaders iterate a small fixed array so the cost stays flat.
 */
export const LIGHT_CONES = Object.freeze({
  /**
   * Hard cap on simultaneous cones. Eight covers the intended loadout: the
   * local player's flashlight plus a scene's worth of mounted fixtures — or
   * nearby players' flashlights and one vehicle's two headlights. Emitters
   * beyond the budget are dropped farthest-first by the game driver. Raising
   * this is not free — the shader breaks out at the live cone count, so
   * empty scenes cost nothing extra, but every scattering cone adds
   * `scatterSamples` taps per fragment.
   */
  maxCones: 8,

  /**
   * Fixed sample count of the per-cone in-scattering estimate, spread over
   * the stretch of the view ray inside the cone (found exactly, so none land
   * outside it). Four samples there read as a continuous volumetric beam
   * without a real ray march; spread over the whole ray they streaked.
   */
  scatterSamples: 4,

  /**
   * The voxel-native look of a submerged beam's scattered shaft. It fades
   * in with the cone origin's submersion: in dry air the
   * faint glow rounded up to the first flat band and drew a hard-edged oval,
   * so a dry shaft stays smooth.
   *
   * - `scatterTexelsPerBlock`: each scatter sample is moved to the centre of
   *   the texel cell it falls in (a 1/N-block grid) before the cone is
   *   evaluated, so the shaft's edges step on the block texel grid.
   * - `scatterBands`: each cone's scattered term is rounded to this many
   *   flat levels, evenly spaced in sqrt(term / ceiling); the faintest tail
   *   rounds to zero. Off (0) by default: the flat levels drew hard rings
   *   and a ragged stepped edge across the floor, where the snapped grain
   *   alone keeps the beam voxel-native.
   * - `scatterCeiling`: the most a cone's scattered term may add, as a
   *   fraction of the cone's own colour times intensity, so a submerged
   *   beam glows murky instead of whiting out. It is also the top band.
   */
  scatterTexelsPerBlock: 16,
  scatterBands: 0,
  scatterCeiling: 0.3,

  /**
   * Wrap term of the diffuse response inside the cone, so surfaces facing
   * away from the beam still catch a rim of light instead of clipping black.
   */
  lambertWrap: 0.25,

  /** Numerical guard for angular falloff denominators. */
  minCosDelta: 1e-3,
});

const MAX = LIGHT_CONES.maxCones;
const scratchDirection = new Vector3();

/**
 * One cone's scattered term under `style` (the shader's
 * `lightConeScatterStyled`, per channel peak), for tests and tooling.
 */
export function styleLightConeScatter(
  scatter: number,
  style: { x: number; y: number; z: number },
): number {
  if (style.y <= 0 && style.z <= 0) return scatter;
  if (scatter <= 0) return scatter;
  const top = style.z > 0 ? style.z : 1;
  let level = Math.min(scatter / top, 1);
  if (style.y > 0) {
    const step = Math.floor(Math.sqrt(level) * style.y + 0.5) / style.y;
    level = step * step;
  }
  return level * top;
}

/**
 * Whether a material takes the light cones per pixel. Set by everything
 * that shades with them (`lightConeShading` in shading/light-cones.ts);
 * {@link auditLightCones} reports any drawn,
 * world-lit mesh without it, so a new material cannot quietly skip the
 * beam the way a custom creature material once did.
 */
export function markLightConesCovered(material: Material): void {
  material.userData.lightConesCovered = true;
}

/** Marked by whatever shades it with the cones (shading/light-cones.ts). */
export function isLightConesCovered(material: Material): boolean {
  return material.userData.lightConesCovered === true;
}

/**
 * Exempt a material, or an object and everything under it, from
 * {@link auditLightCones}, with the reason it should not catch a beam (the
 * sky, a full-screen pass, an overlay, FX lit on the CPU). The reason stays
 * in the code next to what it exempts, so every exemption is a decision
 * someone can read.
 */
export function exemptFromLightCones(
  target: Material | Object3D,
  reason: string,
): void {
  target.userData.lightConesExempt = reason;
}

const isExempt = (target: Material | Object3D) =>
  typeof target.userData.lightConesExempt === "string";

export type LightConeAuditEntry = {
  /** Names from the scene root down to the mesh. */
  path: string;
  material: string;
};

/**
 * Every visible mesh under `root` drawn with a material that neither takes
 * the light cones nor is exempt from them. Lines, points and sprites are
 * skipped (they have no surface to light), as are instanced meshes drawing
 * no instances, self-illuminated materials and additive glows, which
 * already shine past the dark.
 */
export function auditLightCones(root: Object3D): LightConeAuditEntry[] {
  const missing: LightConeAuditEntry[] = [];
  const visit = (object: Object3D, path: string) => {
    if (!object.visible || isExempt(object)) return;
    const here = `${path}/${object.name || object.type}`;
    const mesh = object as Mesh;
    const isEmpty = (mesh as InstancedMesh).isInstancedMesh
      ? (mesh as InstancedMesh).count === 0
      : false;
    if (mesh.isMesh && !isEmpty) {
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const material of materials) {
        if (!material || !material.visible) continue;
        if (isLightConesCovered(material)) continue;
        if (isExempt(material)) continue;
        if (material.blending === AdditiveBlending) continue;
        // `markSelfIlluminated` (LightShined): a lens, a screen.
        if (material.userData.isSelfIlluminated === true) continue;
        missing.push({
          path: here,
          material: material.name || material.type,
        });
      }
    }
    for (const child of object.children) visit(child, here);
  };
  visit(root, "");
  return missing;
}

export type LightConeInput = {
  origin: Vector3;
  direction: Vector3;
  color: Color;
  intensity: number;
  /** Full outer cone angle in degrees. */
  angleDeg: number;
  /** Inner (full-brightness) cone angle as a fraction of the outer angle. */
  innerRatio: number;
  range: number;
  scatterStrength: number;
  /** 0 above water to 1 submerged; drives extinction and beam glow. */
  submersion: number;
};

/**
 * The live cones, packed four `vec4` per cone so they bind as one buffer:
 * `(origin.xyz, submersion)`, `(direction.xyz, 0)`, `(colour x intensity,
 * 0)`, `(cosOuter, 1 / (cosInner - cosOuter), range, scatterStrength)`.
 */
export type LightConeUniforms = ReturnType<typeof createLightConeUniforms>;

export const LIGHT_CONE_STRIDE = 4;

function createLightConeUniforms() {
  return {
    coneCount: worldUniform(0),
    cones: arrayUniform(
      Array.from(
        { length: MAX * LIGHT_CONE_STRIDE },
        (_, i) =>
          i % LIGHT_CONE_STRIDE === 1
            ? new Vector4(0, 0, 1, 0)
            : i % LIGHT_CONE_STRIDE === 3
              ? new Vector4(1, 1, 1, 0)
              : new Vector4(0, 0, 0, 0),
      ),
      "vec4",
    ),
  };
}

/**
 * Owns the shared cone uniform storage. The game clears and refills it every
 * frame (`beginFrame` + `pushCone`); every material shading with these
 * uniforms (`lightConeShading`) sees the same values with zero copying.
 */
export class LightCones {
  public readonly uniforms: LightConeUniforms = createLightConeUniforms();

  beginFrame(): void {
    this.uniforms.coneCount.value = 0;
  }

  pushCone(input: LightConeInput): boolean {
    const index = this.uniforms.coneCount.value;
    if (index >= MAX) return false;

    const halfOuter = MathUtils.degToRad(input.angleDeg / 2);
    const cosOuter = Math.cos(halfOuter);
    const cosInner = Math.cos(
      halfOuter * MathUtils.clamp(input.innerRatio, 0, 1),
    );
    const invCosDelta =
      1 / Math.max(cosInner - cosOuter, LIGHT_CONES.minCosDelta);

    const slots = this.uniforms.cones.value;
    const base = index * LIGHT_CONE_STRIDE;
    slots[base].set(
      input.origin.x,
      input.origin.y,
      input.origin.z,
      MathUtils.clamp(input.submersion, 0, 1),
    );
    const direction = scratchDirection.copy(input.direction).normalize();
    slots[base + 1].set(direction.x, direction.y, direction.z, 0);
    slots[base + 2].set(
      input.color.r * input.intensity,
      input.color.g * input.intensity,
      input.color.b * input.intensity,
      0,
    );
    slots[base + 3].set(
      cosOuter,
      invCosDelta,
      Math.max(input.range, 1e-3),
      input.scatterStrength,
    );

    this.uniforms.coneCount.value = index + 1;
    return true;
  }
}
