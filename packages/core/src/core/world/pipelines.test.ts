import { ChunkProtocol } from "@voxelize/protocol";
import { describe, expect, it } from "vitest";

import { Coords2 } from "../../types";
import { ChunkUtils } from "../../utils";

import { Chunk } from "./chunk";
import { ChunkPipeline, MeshPipeline } from "./pipelines";

const options = {
  size: 2,
  maxHeight: 2,
  maxLightLevel: 15,
  subChunks: 1,
};

const makeChunk = (coords: Coords2) =>
  new Chunk(ChunkUtils.getChunkName(coords), coords, options);

const protocolFor = (coords: Coords2): ChunkProtocol => ({
  id: ChunkUtils.getChunkName(coords),
  x: coords[0],
  z: coords[1],
  meshes: [],
  voxels: new Uint32Array(),
  lights: new Uint32Array(),
});

describe("ChunkPipeline.resyncForRejoin", () => {
  it("drops requested chunks so they are reissued immediately", () => {
    const pipeline = new ChunkPipeline();
    pipeline.markRequested([0, 0]);
    pipeline.markRequested([1, 0]);

    pipeline.resyncForRejoin();

    expect(pipeline.getStage(ChunkUtils.getChunkName([0, 0]))).toBeNull();
    expect(pipeline.getStage(ChunkUtils.getChunkName([1, 0]))).toBeNull();
    expect(pipeline.requestedCount).toBe(0);
  });

  it("returns processing and loaded chunks for interest re-registration", () => {
    const pipeline = new ChunkPipeline();
    pipeline.markRequested([0, 0]);
    pipeline.markProcessing([1, 0], "load", protocolFor([1, 0]));
    pipeline.markLoaded([2, 0], makeChunk([2, 0]));

    const toRefresh = pipeline.resyncForRejoin();

    expect(toRefresh).toEqual(
      expect.arrayContaining([
        ChunkUtils.getChunkName([1, 0]),
        ChunkUtils.getChunkName([2, 0]),
      ]),
    );
    expect(toRefresh).toHaveLength(2);
  });

  it("keeps local data for processing and loaded chunks", () => {
    const pipeline = new ChunkPipeline();
    const loaded = makeChunk([2, 0]);
    pipeline.markProcessing([1, 0], "load", protocolFor([1, 0]));
    pipeline.markLoaded([2, 0], loaded);

    pipeline.resyncForRejoin();

    expect(
      pipeline.getProcessingData(ChunkUtils.getChunkName([1, 0]))?.data.x,
    ).toBe(1);
    expect(pipeline.getLoadedChunk(ChunkUtils.getChunkName([2, 0]))).toBe(
      loaded,
    );
  });
});

describe("MeshPipeline voxel-change remesh", () => {
  it("marks dirty immediately so remesh can run before light workers finish", () => {
    const pipeline = new MeshPipeline();

    pipeline.onVoxelChange(3, 4, 2, true);

    expect(pipeline.getDirtyKeys()).toEqual(["3,4:2"]);
    expect(pipeline.isUrgent("3,4:2")).toBe(true);
    expect(pipeline.hasDirtyChunks()).toBe(true);

    const generation = pipeline.startJob("3,4:2");
    expect(generation).toBe(1);
    expect(pipeline.getDirtyKeys()).toEqual([]);

    // A concurrent light-driven remesh request must stay pending until the
    // in-flight mesh job completes, then remesh again.
    pipeline.onVoxelChange(3, 4, 2);
    expect(pipeline.needsRemesh("3,4:2")).toBe(true);
  });

  it("keeps needsRemesh true when voxels change while a mesh job is in flight", () => {
    const pipeline = new MeshPipeline();
    pipeline.onVoxelChange(1, 1, 0);
    const generation = pipeline.startJob("1,1:0");

    pipeline.onVoxelChange(1, 1, 0);
    expect(pipeline.needsRemesh("1,1:0")).toBe(true);
    expect(pipeline.onJobComplete("1,1:0", generation)).toBe(false);
    expect(pipeline.getDirtyKeys()).toEqual(["1,1:0"]);
  });
});
