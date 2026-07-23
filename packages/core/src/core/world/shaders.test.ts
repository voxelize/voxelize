import { describe, expect, it } from "vitest";

import {
  SHADER_LIGHTING_CHUNK_SHADERS,
  SHADER_LIGHTING_CROSS_CHUNK_SHADERS,
} from "./shaders";

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
