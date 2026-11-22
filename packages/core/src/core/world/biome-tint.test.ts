import { describe, expect, it } from "vitest";

import { biomeTintAttribute, waterLookInChunk } from "./biome-tint";

const tinted = new Uint32Array([0x80000000]);
function color(field: Uint8Array, x: number, z: number) {
  return Array.from(
biomeTintAttribute(new Float32Array([x, 3, z]), tinted, field, 16).array,
).slice(0, 3);
}
describe("continuous regional material color", () => {
  it("shares an edge at every height and preserves intermediate colors", () => {
    const a = new Uint8Array([
      128, 128, 128, 177, 120, 79, 97, 134, 100, 113, 122, 147,
    ]);
    const b = new Uint8Array([
      ...a.slice(3, 6),
      128,
      128,
      128,
      ...a.slice(9, 12),
      97,
      134,
      100,
    ]);
    for (let z = 0; z <= 16; z += 0.5)
      expect(color(a, 16, z)).toEqual(color(b, 0, z));
    expect(color(a, 8, 0)).toEqual([153, 124, 104]);
    expect(color(a, 8, 8)).toEqual([129, 126, 114]);
  });
  it("keeps untinted faces authored and falls back on worlds without the field", () => {
    const field = new Uint8Array(12).fill(128);
    expect(
      Array.from(
biomeTintAttribute(
          new Float32Array([8, 3, 8]),
          new Uint32Array([0]),
          field,
          16,
        ).array,
).slice(0, 3),
    ).toEqual([0, 0, 0]);
    expect(
      Array.from(
biomeTintAttribute(new Float32Array([8, 3, 8]), tinted, undefined, 16)
          .array,
).slice(0, 3),
    ).toEqual([0, 0, 0]);
    expect(color(field, 8, 8)).toEqual([128, 128, 128]);
  });
  it("leaves a colour-table face to its table colour in every climate", () => {
    const field = new Uint8Array([
      128, 128, 128, 177, 120, 79, 97, 134, 100, 113, 122, 147,
    ]);
    for (let pigment = 1; pigment < 16; pigment++) {
      const tabled = new Uint32Array([
        (0x80000000 | (15 << 26) | (pigment << 22)) >>> 0,
      ]);
      expect(
        Array.from(
biomeTintAttribute(new Float32Array([8, 3, 8]), tabled, field, 16)
            .array,
).slice(0, 3),
      ).toEqual([0, 0, 0]);
    }
    // A tinted plant run at its highest code still takes the field.
    const tallest = new Uint32Array([
      (0x80000000 | (13 << 26) | (4 << 22)) >>> 0,
    ]);
    expect(
      Array.from(
biomeTintAttribute(new Float32Array([8, 3, 8]), tallest, field, 16)
          .array,
).slice(0, 3),
    ).not.toEqual([0, 0, 0]);
  });
  it("decodes quantized, biased coordinates identically and handles plant jitter", () => {
    const field = new Uint8Array([
      128, 128, 128, 177, 120, 79, 97, 134, 100, 113, 122, 147,
    ]);
    const packed = biomeTintAttribute(
      new Uint16Array([10 * 256, 4 * 256, 7 * 256]),
      tinted,
      field,
      16,
      256,
      2,
    );
    expect(Array.from(
packed.array,
).slice(0, 3)).toEqual(color(field, 8, 5));
    expect(color(field, -0.1, 0)).toEqual(color(field, 0, 0));
    expect(color(field, 16.1, 16)).toEqual(color(field, 16, 16));
  });
});

describe("a regional water look", () => {
  /** A fluid vertex: the fluid bit (18) of its light word. */
  const fluid = new Uint32Array([1 << 18]);
  /** Plain water at the west corners, a brown look at 80% at the east. */
  const brown = [102, 72, 33, 204];
  const half = new Uint8Array([0, 0, 0, 0, ...brown, 0, 0, 0, 0, ...brown]);
  const land = new Uint8Array(12).fill(128);
  /** `null` for a chunk the server sent no water corners for. */
  const look = (x: number, z: number, water: Uint8Array | null = half) =>
    Array.from(
      biomeTintAttribute(
        new Float32Array([x, 3, z]),
        fluid,
        land,
        16,
        1,
        0,
        water ?? undefined,
      ).array,
    );

  it("gives a fluid vertex the look blended across the chunk, all four bytes", () => {
    expect(look(0, 5)).toEqual([0, 0, 0, 0]);
    expect(look(16, 5)).toEqual(brown);
    expect(look(8, 5)).toEqual([51, 36, 17, 102]);
    // Premultiplied: halfway, the colour over the amount is still the brown.
    const [r, g, b, a] = look(8, 5);
    expect(r / a).toBeCloseTo(brown[0] / brown[3], 2);
    expect(g / a).toBeCloseTo(brown[1] / brown[3], 2);
    expect(b / a).toBeCloseTo(brown[2] / brown[3], 1);
  });

  it("shares an edge with the next chunk", () => {
    const east = new Uint8Array([...brown, 20, 60, 20, 255, ...brown, 0, 0, 0, 0]);
    for (let z = 0; z <= 16; z += 2)
      expect(look(16, z)).toEqual(look(0, z, east));
  });

  it("leaves water plain without the field, and land untouched by it", () => {
    expect(look(8, 8, null)).toEqual([0, 0, 0, 0]);
    expect(look(8, 8, new Uint8Array(16))).toEqual([0, 0, 0, 0]);
    // A tinted land vertex beside turned water keeps its biome colour and
    // a zero fourth byte.
    expect(
      Array.from(
        biomeTintAttribute(
          new Float32Array([16, 3, 8]),
          tinted,
          land,
          16,
          1,
          0,
          half,
        ).array,
      ),
    ).toEqual([128, 128, 128, 0]);
  });

  it("reads the same look for the camera as for the surface", () => {
    expect(waterLookInChunk(half, 0, 0.3)).toBeNull();
    expect(waterLookInChunk(undefined, 0.5, 0.5)).toBeNull();
    const at = waterLookInChunk(half, 0.5, 0.3);
    expect(at?.amount).toBeCloseTo(0.4, 2);
    expect(at?.r).toBeCloseTo(brown[0] / brown[3], 2);
    expect(at?.g).toBeCloseTo(brown[1] / brown[3], 2);
    expect(waterLookInChunk(half, 1, 0.9)?.amount).toBeCloseTo(0.8, 2);
  });
});
