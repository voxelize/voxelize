import { describe, expect, it } from "vitest";
import { vec2 } from "three/tsl";

import { textureSlot } from "./shading/uniforms";

describe("textureSlot", () => {
  // three's default transforms a slot's every sample by its texture matrix:
  // a mat3 uniform in the object group, refreshed and rewritten per draw.
  it("samples without the texture matrix, and its samples keep that", () => {
    const slot = textureSlot("color");
    expect(slot.updateMatrix).toBe(false);
    expect(slot.sample(vec2(0.5, 0.5)).updateMatrix).toBe(false);
    expect(slot.load(vec2(1, 1)).updateMatrix).toBe(false);
  });
});
