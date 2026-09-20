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
