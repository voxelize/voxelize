import { describe, expect, it } from "vitest";

import {
  CRUSTED_FLUID_DEFAULTS,
  createCrustedFluidShader,
} from "./crusted-fluid-shader";
import { SHADER_CLOCK_WRAP_SECONDS } from "./shader-clock";

describe("crusted fluid shader", () => {
  it("replaces the lit colour and scales the surface wave", () => {
    const shader = createCrustedFluidShader();
    expect(shader.fragmentShader).not.toContain(
      "outgoingLight.rgb *= totalLight;",
    );
    expect(shader.fragmentShader).toContain(
      "outgoingLight.rgb = crustColor * crustFaceShade;",
    );
    expect(shader.vertexShader).toContain("uTime * 0.0006 * uCrustWave.y");
    expect(shader.vertexShader).toContain(
      "POSITION_UNITS_PER_BLOCK * uCrustWave.x",
    );
  });

  it("declares every uniform it returns", () => {
    const shader = createCrustedFluidShader();
    for (const name of Object.keys(shader.uniforms)) {
      const source =
        name === "uCrustWave" ? shader.vertexShader : shader.fragmentShader;
      expect(source).toMatch(new RegExp(`uniform \\w+ ${name}(\\[\\d+\\])?;`));
    }
  });

  it("takes the 5-tap shadow path by default, like the water", () => {
    const shader = createCrustedFluidShader();
    expect(shader.fragmentShader).toContain("sampleShadowMapFast(uShadowMap0");
    expect(shader.fragmentShader).not.toContain("sampleShadowMap(uShadowMap0");
  });

  it("restarts generations on a shader clock wrap", () => {
    expect(
      SHADER_CLOCK_WRAP_SECONDS % CRUSTED_FLUID_DEFAULTS.cycleSeconds,
    ).toBe(0);
    expect(() => createCrustedFluidShader({ cycleSeconds: 10 })).toThrow(
      /cycleSeconds/,
    );
  });

  it("needs a six-colour palette", () => {
    expect(() => createCrustedFluidShader({ palette: ["#000"] })).toThrow(
      /six/,
    );
  });

  it("fails loudly when the base shader lacks an anchor", () => {
    expect(() =>
      createCrustedFluidShader({}, { vertex: "", fragment: "" }),
    ).toThrow(/exactly one/);
  });
});
