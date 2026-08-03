import { describe, expect, it } from "vitest";

import {
  POSITION_BLOCK_BIAS,
  isMainThreadSortedBlock,
  positionUnitsPerBlock,
  quantizeNormals,
  quantizePositions,
  quantizeUvs,
} from "./vertex-quantization";

const flags = (
  overrides: Partial<Parameters<typeof isMainThreadSortedBlock>[0]>,
) => ({
  isFluid: false,
  isSeeThrough: false,
  transparentStandalone: false,
  lightAttenuation: 0,
  ...overrides,
});

describe("isMainThreadSortedBlock", () => {
  it("keeps floats only for the depth-non-writing transparents", () => {
    // Mirrors depthWrite in chunk-materials.ts: sorted means transparent and
    // not depth-writing. Opaque terrain quantizes.
    expect(isMainThreadSortedBlock(flags({}))).toBe(false);

    // Fluids sort.
    expect(
      isMainThreadSortedBlock(flags({ isFluid: true, isSeeThrough: true })),
    ).toBe(true);

    // Glass: see-through, no attenuation, not standalone — sorts.
    expect(isMainThreadSortedBlock(flags({ isSeeThrough: true }))).toBe(true);

    // Leaves: see-through with light attenuation — depth-writing cutout,
    // quantizes.
    expect(
      isMainThreadSortedBlock(
        flags({ isSeeThrough: true, lightAttenuation: 1 }),
      ),
    ).toBe(false);

    // Plants: see-through standalone — depth-writing cutout, quantizes.
    expect(
      isMainThreadSortedBlock(
        flags({ isSeeThrough: true, transparentStandalone: true }),
      ),
    ).toBe(false);
  });
});

describe("positionUnitsPerBlock", () => {
  it("derives a power-of-two scale that keeps the section span in u16", () => {
    const shortSections = positionUnitsPerBlock({
      chunkSize: 16,
      maxHeight: 256,
      subChunks: 8,
    });
    expect(shortSections).toBe(512);

    // A world configured as a single 352-block sub-chunk must still fit: at
    // 256 units per block every vertex above ~224 blocks wrapped the u16
    // range and shredded the terrain.
    const tallSection = positionUnitsPerBlock({
      chunkSize: 16,
      maxHeight: 352,
      subChunks: 1,
    });
    expect(tallSection).toBe(128);
    expect((352 + 2 * POSITION_BLOCK_BIAS) * tallSection).toBeLessThanOrEqual(
      65535,
    );
  });

  it("keeps the tallest representable coordinate inside u16", () => {
    const units = positionUnitsPerBlock({
      chunkSize: 16,
      maxHeight: 352,
      subChunks: 1,
    });
    const quantized = quantizePositions(new Float32Array([352 + 31.9]), units);
    expect(quantized[0]).toBeLessThanOrEqual(65535);
    expect(quantized[0] / units - POSITION_BLOCK_BIAS).toBeCloseTo(383.9, 1);
  });
});

describe("quantization", () => {
  const units = positionUnitsPerBlock({
    chunkSize: 16,
    maxHeight: 256,
    subChunks: 8,
  });

  it("round-trips positions within half a quantization step", () => {
    const positions = new Float32Array([0, 0.1, 15.9375, 32, 63.999, -0.207]);
    const quantized = quantizePositions(positions, units);
    for (let i = 0; i < positions.length; i++) {
      const roundTripped = quantized[i] / units - POSITION_BLOCK_BIAS;
      expect(Math.abs(roundTripped - positions[i])).toBeLessThanOrEqual(
        0.5 / units,
      );
    }
  });

  it("quantizes identical world planes identically across chunk frames", () => {
    // Neighboring chunks see the same face at local coordinates that differ
    // by an integer number of blocks; equal fractional parts must land on
    // the same lattice point or chunk borders crack.
    const fraction = 0.1;
    const inChunkA = quantizePositions(
      new Float32Array([16 + fraction]),
      units,
    )[0];
    const inChunkB = quantizePositions(
      new Float32Array([0 + fraction]),
      units,
    )[0];
    expect(inChunkA - inChunkB).toBe(16 * units);
  });

  it("keeps uvs in the normalized u16 domain", () => {
    const uvs = quantizeUvs(new Float32Array([0, 0.5, 1, 1.0000001]));
    expect(Array.from(uvs)).toEqual([0, 32768, 65535, 65535]);
  });

  it("stores unit normals within i8 precision", () => {
    const diagonal = Math.SQRT1_2;
    const normals = quantizeNormals(new Float32Array([1, -1, diagonal]));
    expect(normals[0]).toBe(127);
    expect(normals[1]).toBe(-127);
    expect(Math.abs(normals[2] / 127 - diagonal)).toBeLessThan(0.01);
  });
});
