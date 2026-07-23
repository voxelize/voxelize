import { describe, expect, it } from "vitest";

import {
  SHADER_LIGHTING_CHUNK_SHADERS,
  SHADER_LIGHTING_CROSS_CHUNK_SHADERS,
} from "./shaders";
import { WATER_OPTICS } from "./water-optics";

const braceBalance = (source: string) => {
  let balance = 0;
  for (const char of source) {
    if (char === "{") balance += 1;
    if (char === "}") balance -= 1;
  }
  return balance;
};

describe("chunk shader distant (LOD) water branch", () => {
  it("declares the uniform and carries the cheap water branch", () => {
    const { fragment } = SHADER_LIGHTING_CHUNK_SHADERS;
    expect(fragment).toContain("uniform float uLodWater;");
    expect(fragment).toContain("if (uLodWater > 0.5) {");
    // The branch must not reintroduce the refraction capture: distant water
    // never samples the scene color texture.
    const branch = fragment.slice(fragment.indexOf("if (uLodWater > 0.5) {"));
    expect(branch).not.toContain("uSceneColor");
  });

  it("writes a single translucent layer alpha so the LOD seabed shows through", () => {
    const { fragment } = SHADER_LIGHTING_CHUNK_SHADERS;
    const branch = fragment.slice(fragment.indexOf("if (uLodWater > 0.5) {"));
    // The blended layer's opacity is baked from the lodWater tunables —
    // head-on surface alpha ramping to the grazing maximum on the fresnel
    // curve — so near and LOD water share a translucency read at the seam.
    expect(branch).toContain(
      "diffuseColor.a = mix(lodAlpha, 1.0, lodDepthDarken);",
    );
    expect(branch).toContain(WATER_OPTICS.lodWater.surfaceAlpha.toFixed(4));
    expect(branch).toContain(WATER_OPTICS.lodWater.grazingAlphaMax.toFixed(4));
  });

  it("dead-codes the branch in the cross shader", () => {
    expect(SHADER_LIGHTING_CROSS_CHUNK_SHADERS.fragment).not.toContain(
      "if (uLodWater > 0.5) {",
    );
  });

  it("keeps the generated fragment shaders brace-balanced", () => {
    expect(braceBalance(SHADER_LIGHTING_CHUNK_SHADERS.fragment)).toBe(0);
    expect(braceBalance(SHADER_LIGHTING_CROSS_CHUNK_SHADERS.fragment)).toBe(0);
    expect(braceBalance(SHADER_LIGHTING_CHUNK_SHADERS.vertex)).toBe(0);
  });
});
