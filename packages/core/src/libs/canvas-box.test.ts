import { describe, expect, it } from "vitest";

import { canvasBoxSegments } from "./canvas-box";

// A CanvasBox painted with `texelsPerBlock` gets square texels: each axis
// resolves to its own pixel count, so a long thin box is not one 8x8 canvas
// stretched three different ways.
describe("canvasBoxSegments", () => {
  it("gives every axis the pixel count its length asks for", () => {
    expect(
      canvasBoxSegments({ width: 0.3, height: 0.14, depth: 0.06 }, 100),
    ).toEqual({ widthSegments: 30, heightSegments: 14, depthSegments: 6 });
  });

  it("keeps a full block at the pack's sixteen texels", () => {
    expect(canvasBoxSegments({ width: 1, height: 1, depth: 1 }, 16)).toEqual({
      widthSegments: 16,
      heightSegments: 16,
      depthSegments: 16,
    });
  });

  it("never rounds a sliver down to zero texels", () => {
    expect(
      canvasBoxSegments({ width: 1, height: 0.01, depth: 0.02 }, 16),
    ).toEqual({ widthSegments: 16, heightSegments: 1, depthSegments: 1 });
  });

  it("refuses a density that cannot paint anything", () => {
    expect(() =>
      canvasBoxSegments({ width: 1, height: 1, depth: 1 }, 0),
    ).toThrow(/texelsPerBlock must be positive/);
  });
});
