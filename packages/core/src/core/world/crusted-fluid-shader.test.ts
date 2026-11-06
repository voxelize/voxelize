import { Color } from "three/webgpu";
import { describe, expect, it } from "vitest";

import {
  CRUSTED_FLUID_DEFAULTS,
  createCrustedFluidSurface,
} from "./crusted-fluid-shader";
import { SHADER_CLOCK_WRAP_SECONDS } from "./shader-clock";

describe("crusted fluid surface", () => {
  it("replaces the lit colour and scales the surface wave", () => {
    const { hooks, uniforms } = createCrustedFluidSurface();
    expect(typeof hooks.lit).toBe("function");
    // Derivatives of the crust's uv run outside every branch.
    expect(typeof hooks.prepare).toBe("function");
    expect(hooks.wave).toBeDefined();
    expect(uniforms.wave.value.x).toBe(CRUSTED_FLUID_DEFAULTS.wave.amplitude);
    expect(uniforms.wave.value.y).toBe(CRUSTED_FLUID_DEFAULTS.wave.speed);
  });

  it("keys every surface's program apart", () => {
    const a = createCrustedFluidSurface();
    const b = createCrustedFluidSurface();
    expect(a.hooks.key).toMatch(/^crusted-fluid:/);
    expect(a.hooks.key).not.toBe(b.hooks.key);
  });

  it("exposes every option as a live uniform", () => {
    const { uniforms } = createCrustedFluidSurface({
      plateTexels: 7,
      bands: [0.1, 0.2, 0.3, 0.4],
      faceShades: { sideX: 0.5, sideZ: 0.4, bottom: 0.3, top: 0.9 },
    });
    expect(uniforms.shape.value.y).toBe(7);
    expect(uniforms.bands.value.toArray()).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(uniforms.faceShades.value.toArray()).toEqual([0.5, 0.4, 0.3, 0.9]);
    expect(uniforms.flow.value.z).toBe(CRUSTED_FLUID_DEFAULTS.cycleSeconds);
    const palette = uniforms.palette.array as Color[];
    expect(palette).toHaveLength(6);
    expect(palette[5].equals(new Color(CRUSTED_FLUID_DEFAULTS.palette[5]))).toBe(true);
  });

  it("settles a grazing view by its squeezed axis only past the anisotropy allowance", () => {
    expect(createCrustedFluidSurface().uniforms.farAnisotropy.value).toBe(
      CRUSTED_FLUID_DEFAULTS.farFadeAnisotropy,
    );
    expect(
      createCrustedFluidSurface({ farFadeAnisotropy: 0 }).uniforms
        .farAnisotropy.value,
    ).toBe(1);
  });

  it("restarts generations on a shader clock wrap", () => {
    expect(
      SHADER_CLOCK_WRAP_SECONDS % CRUSTED_FLUID_DEFAULTS.cycleSeconds,
    ).toBe(0);
    expect(() => createCrustedFluidSurface({ cycleSeconds: 10 })).toThrow(
      /cycleSeconds/,
    );
  });

  it("needs a six-colour palette", () => {
    expect(() => createCrustedFluidSurface({ palette: ["#000"] })).toThrow(
      /six/,
    );
  });
});
