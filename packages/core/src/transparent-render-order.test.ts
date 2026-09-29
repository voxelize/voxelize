import { describe, expect, it } from "vitest";

import {
  TRANSPARENT_CUTOUT_RENDER_ORDER,
  TRANSPARENT_FLUID_RENDER_ORDER,
  TRANSPARENT_RENDER_ORDER,
  transparentChunkRenderOrder,
} from "./common";

describe("transparentChunkRenderOrder", () => {
  it("draws depth-writing cutouts, then blended see-through, then fluid", () => {
    const cutout = transparentChunkRenderOrder(false, true);
    const blended = transparentChunkRenderOrder(false, false);
    const fluid = transparentChunkRenderOrder(true, false);
    expect(cutout).toBe(TRANSPARENT_CUTOUT_RENDER_ORDER);
    expect(blended).toBe(TRANSPARENT_RENDER_ORDER);
    expect(fluid).toBe(TRANSPARENT_FLUID_RENDER_ORDER);
    expect(cutout).toBeLessThan(blended);
    expect(blended).toBeLessThan(fluid);
    // Fluid keeps its own order whatever its depth write.
    expect(transparentChunkRenderOrder(true, true)).toBe(fluid);
  });

  it("leaves room for a no-depth layer between cutouts and glass", () => {
    const between = TRANSPARENT_CUTOUT_RENDER_ORDER + 0.5;
    expect(between).toBeGreaterThan(transparentChunkRenderOrder(false, true));
    expect(between).toBeLessThan(transparentChunkRenderOrder(false, false));
  });
});
