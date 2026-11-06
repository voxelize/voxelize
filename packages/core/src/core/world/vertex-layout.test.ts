import { describe, expect, it } from "vitest";

import {
  POSITION_STRIDE,
  packQuantizedPositions,
  padByteVectors,
} from "./vertex-layout";

// Vertex formats WebGPU reads as they are: three widened a three-wide
// 16-bit position to 32 bits on every upload, and re-padded three-wide
// bytes vertex by vertex.
describe("chunk vertex layout", () => {
  it("packs quantized positions four-wide, the sway profile fourth", () => {
    const source = new Uint16Array([1, 2, 3, 400, 500, 600]);
    const packed = packQuantizedPositions(source, 7);
    expect(POSITION_STRIDE).toBe(4);
    expect(Array.from(packed)).toEqual([1, 2, 3, 7, 400, 500, 600, 7]);
  });

  it("writes into a given range of a larger array", () => {
    const out = new Uint16Array(12).fill(9);
    packQuantizedPositions(new Uint16Array([1, 2, 3]), 0, out.subarray(4, 8));
    expect(Array.from(out)).toEqual([9, 9, 9, 9, 1, 2, 3, 0, 9, 9, 9, 9]);
  });

  it("pads byte vectors four-wide", () => {
    expect(Array.from(padByteVectors(new Int8Array([1, -2, 3])))).toEqual([
      1, -2, 3, 0,
    ]);
  });
});
