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
