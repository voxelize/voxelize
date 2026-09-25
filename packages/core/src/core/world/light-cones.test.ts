import { describe, expect, it } from "vitest";

import {
  LIGHT_CONE_SCATTER_STYLE,
  LIGHT_CONES,
  LIGHT_CONES_FUNCTIONS,
  LIGHT_CONES_UNIFORM_DECLARATIONS,
  LightCones,
  styleLightConeScatter,
} from "./light-cones";

const LEGACY = { x: 0, y: 0, z: 0 };
const VOXEL = {
  x: LIGHT_CONES.scatterTexelsPerBlock,
  y: LIGHT_CONES.scatterBands,
  z: LIGHT_CONES.scatterCeiling,
};

describe("light cone scatter style", () => {
  it("defaults to the voxel look and flips back to the smooth beam", () => {
    expect(LIGHT_CONE_SCATTER_STYLE.value.toArray()).toEqual([
      VOXEL.x,
      VOXEL.y,
      VOXEL.z,
    ]);
    for (const scatter of [0, 0.004, 0.05, 0.3, 1.4]) {
      expect(styleLightConeScatter(scatter, LEGACY)).toBe(scatter);
    }
  });

  it("rounds to a few flat levels capped at the ceiling", () => {
    const levels = new Set<number>();
    for (let i = 0; i <= 2000; i++) {
      levels.add(styleLightConeScatter(i / 1000, VOXEL));
    }
    // Zero plus one level per band, the top band being the ceiling.
    expect(levels.size).toBe(VOXEL.y + 1);
    expect(Math.max(...levels)).toBeCloseTo(VOXEL.z, 12);
    // A submerged beam that used to add more than its own colour is held
    // to the ceiling instead of whiting out.
    expect(styleLightConeScatter(1.4, VOXEL)).toBeCloseTo(VOXEL.z, 12);
    // The faintest tail rounds to a clean zero, not a sliver.
    expect(styleLightConeScatter(VOXEL.z / 100, VOXEL)).toBe(0);
    // A dry flashlight's few-percent shaft still lands on a visible step.
    expect(styleLightConeScatter(0.05, VOXEL)).toBeGreaterThan(0.03);
    expect(styleLightConeScatter(0.05, VOXEL)).toBeLessThan(0.1);
  });

  it("caps without banding when only the ceiling is set", () => {
    const capOnly = { x: 0, y: 0, z: 0.3 };
    expect(styleLightConeScatter(0.12, capOnly)).toBeCloseTo(0.12, 12);
    expect(styleLightConeScatter(0.9, capOnly)).toBeCloseTo(0.3, 12);
  });

  it("is one switch every material binding shares", () => {
    const a = new LightCones();
    const b = new LightCones();
    expect(a.uniformBindings.uConeScatterStyle).toBe(LIGHT_CONE_SCATTER_STYLE);
    expect(b.uniformBindings.uConeScatterStyle).toBe(LIGHT_CONE_SCATTER_STYLE);
    expect(a.uniforms.coneScatterStyle).toBe(LIGHT_CONE_SCATTER_STYLE);
  });

  it("declares and uses the style uniform in the shader chunks", () => {
    expect(LIGHT_CONES_UNIFORM_DECLARATIONS).toContain(
      "uniform vec3 uConeScatterStyle;",
    );
    expect(LIGHT_CONES_FUNCTIONS).toContain(
      "floor(lcCamSnap + lcRayDir * (lcT * lcSnap)) * lcSnapInv + lcSnapOffset",
    );
    expect(LIGHT_CONES_FUNCTIONS).toContain(
      "lightConeScatterStyled(lcSum * (lcStrength * lcStep))",
    );
    // The surface term is not styled: only the scattered shaft is.
    const start = LIGHT_CONES_FUNCTIONS.indexOf("vec3 lightConeSurface");
    const surface = LIGHT_CONES_FUNCTIONS.slice(
      start,
      LIGHT_CONES_FUNCTIONS.indexOf("\n}\n", start),
    );
    expect(surface).toContain("lcTotal +=");
    expect(surface).not.toContain("uConeScatterStyle");
  });
});
