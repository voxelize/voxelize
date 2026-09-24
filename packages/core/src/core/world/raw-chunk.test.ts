import { describe, expect, it } from "vitest";

import { RawChunk, SerializedChunkPayload } from "./raw-chunk";

const options = {
  size: 2,
  maxHeight: 2,
  maxLightLevel: 15,
  subChunks: 1,
};

describe("RawChunk.deserialize", () => {
  it("copies the selected shared-buffer slice for worker mutation", () => {
    const elementCount = options.size * options.maxHeight * options.size;
    const bytesPerArray = elementCount * Uint32Array.BYTES_PER_ELEMENT;
    const buffer = new SharedArrayBuffer(bytesPerArray * 4);
    const voxelsByteOffset = bytesPerArray;
    const lightsByteOffset = bytesPerArray * 2;
    const sourceVoxels = new Uint32Array(
      buffer,
      voxelsByteOffset,
      elementCount,
    );
    const sourceLights = new Uint32Array(
      buffer,
      lightsByteOffset,
      elementCount,
    );
    sourceVoxels[0] = 123;
    sourceLights[1] = 456;

    const payload: SerializedChunkPayload = {
      id: "chunk",
      x: 0,
      z: 0,
      voxels: buffer,
      lights: buffer,
      voxelsByteOffset,
      voxelsLength: elementCount,
      lightsByteOffset,
      lightsLength: elementCount,
      transferMode: "shared",
      options,
    };

    const chunk = RawChunk.deserialize(payload);

    expect(chunk.voxels.data).toHaveLength(elementCount);
    expect(chunk.lights.data).toHaveLength(elementCount);
    expect(chunk.voxels.data[0]).toBe(123);
    expect(chunk.lights.data[1]).toBe(456);

    chunk.voxels.data[0] = 789;
    chunk.lights.data[1] = 987;

    expect(sourceVoxels[0]).toBe(123);
    expect(sourceLights[1]).toBe(456);
  });
});

describe("RawChunk voxel reads", () => {
  it("reads inside the chunk and returns 0 outside it, on every axis", () => {
    const chunk = new RawChunk("chunk", [1, -1], options);
    chunk.voxels.data = new Uint32Array(
      options.size * options.maxHeight * options.size,
    );
    chunk.lights.data = new Uint32Array(chunk.voxels.data.length);
    // Chunk [1, -1] with size 2 spans x 2..3, z -2..-1.
    chunk.setRawValue(3, 1, -1, 77);
    chunk.setRawLight(2, 0, -2, 9);

    expect(chunk.getRawValue(3, 1, -1)).toBe(77);
    expect(chunk.getRawValue(3.9, 1.2, -1.5)).toBe(77);
    expect(chunk.getRawLight(2, 0, -2)).toBe(9);

    expect(chunk.getRawValue(1, 1, -1)).toBe(0);
    expect(chunk.getRawValue(4, 1, -1)).toBe(0);
    expect(chunk.getRawValue(3, -1, -1)).toBe(0);
    expect(chunk.getRawValue(3, 2, -1)).toBe(0);
    expect(chunk.getRawValue(3, 1, -3)).toBe(0);
    expect(chunk.getRawValue(3, 1, 0)).toBe(0);
    expect(chunk.getRawLight(3, 1, 0)).toBe(0);
  });
});

describe("RawChunk.isAirRange", () => {
  function column() {
    const chunk = new RawChunk("sky", [-2, 3], {
      ...options,
      maxHeight: 8,
      subChunks: 4,
    });
    chunk.voxels.data = new Uint32Array(2 * 8 * 2);
    chunk.lights.data = new Uint32Array(chunk.voxels.data.length);
    return chunk;
  }

  it("checks every column and includes the first and last voxel of the range", () => {
    const chunk = column();
    expect(chunk.isAirRange(2, 4)).toBe(true);
    for (let x = -4; x < -2; x++)
      for (let z = 6; z < 8; z++) {
        for (const y of [2, 3]) {
          chunk.setRawValue(x, y, z, 1);
          expect(chunk.isAirRange(2, 4)).toBe(false);
          chunk.setRawValue(x, y, z, 0);
          expect(chunk.isAirRange(2, 4)).toBe(true);
        }
      }
  });

  it("does not mistake blocks immediately above or below for section contents", () => {
    const chunk = column();
    chunk.setRawValue(-4, 1, 6, 1);
    chunk.setRawValue(-3, 4, 7, 1);
    expect(chunk.isAirRange(2, 4)).toBe(true);
    expect(chunk.isAirRange(0, 2)).toBe(false);
    expect(chunk.isAirRange(4, 6)).toBe(false);
  });

  it("rechecks bulk replacement and metadata rather than caching emptiness", () => {
    const chunk = column();
    expect(chunk.isAirRange(0, 8)).toBe(true);
    const storage = new Uint32Array(new SharedArrayBuffer(32 * 4));
    storage[31] = 0x10000000;
    chunk.voxels.data = storage;
    expect(chunk.isAirRange(6, 8)).toBe(false);
    storage[31] = 0;
    expect(chunk.isAirRange(6, 8)).toBe(true);
  });

  it("does not declare missing or malformed data empty", () => {
    const chunk = column();
    for (const bounds of [
      [-1, 2],
      [6, 9],
      [2, 2],
      [4, 2],
      [0.5, 2],
      [0, NaN],
    ]) {
      expect(chunk.isAirRange(bounds[0], bounds[1])).toBe(false);
    }
    chunk.voxels.data = new Uint32Array(0);
    expect(chunk.isAirRange(0, 8)).toBe(false);
    chunk.voxels.data = new Uint32Array(31);
    expect(chunk.isAirRange(0, 8)).toBe(false);
  });
});
