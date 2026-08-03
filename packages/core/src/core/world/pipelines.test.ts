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

describe("ChunkPipeline.isRequestStale", () => {
  it("presumes a request lost once its own elapsed time passes the threshold", () => {
    const pipeline = new ChunkPipeline();
    pipeline.markRequested([0, 0]);
    const name = ChunkUtils.getChunkName([0, 0]);

    expect(pipeline.isRequestStale(name, 5000)).toBe(false);
    expect(pipeline.isRequestStale(name, 0)).toBe(true);
  });

  it("has nothing to reissue for a chunk that was never requested", () => {
    const pipeline = new ChunkPipeline();
    pipeline.markLoaded([1, 0], makeChunk([1, 0]));

    expect(pipeline.isRequestStale(ChunkUtils.getChunkName([1, 0]), 0)).toBe(
      false,
    );
    expect(pipeline.isRequestStale(ChunkUtils.getChunkName([9, 9]), 0)).toBe(
      false,
    );
  });

  it("restarts the clock when a chunk is requested again", () => {
    const pipeline = new ChunkPipeline();
    pipeline.markRequested([0, 0]);
    const name = ChunkUtils.getChunkName([0, 0]);
    expect(pipeline.isRequestStale(name, 0)).toBe(true);

    pipeline.remove(name);
    pipeline.markRequested([0, 0]);

    expect(pipeline.isRequestStale(name, 5000)).toBe(false);
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

  it("failJob requeues remesh after a null mesh-worker result", () => {
    const pipeline = new MeshPipeline();
    pipeline.onVoxelChange(2, 2, 0, true);
    const generation = pipeline.startJob("2,2:0");
    expect(pipeline.getDirtyKeys()).toEqual([]);
    expect(pipeline.shouldStartJob("2,2:0")).toBe(false);

    pipeline.failJob("2,2:0", generation);

    expect(pipeline.getDirtyKeys()).toEqual(["2,2:0"]);
    expect(pipeline.shouldStartJob("2,2:0")).toBe(true);
    expect(pipeline.needsRemesh("2,2:0")).toBe(true);
  });

  it("orders regular dirty keys nearest-first around the given center", () => {
    const pipeline = new MeshPipeline();
    pipeline.onVoxelChange(10, 10, 0);
    pipeline.onVoxelChange(2, 2, 0);
    pipeline.onVoxelChange(5, 5, 0);

    expect(pipeline.getDirtyKeys([1, 1])).toEqual([
      "2,2:0",
      "5,5:0",
      "10,10:0",
    ]);
    expect(pipeline.getDirtyKeys([9, 9])).toEqual([
      "10,10:0",
      "5,5:0",
      "2,2:0",
    ]);
  });

  it("keeps the urgent lane in insertion order ahead of sorted regular keys", () => {
    const pipeline = new MeshPipeline();
    pipeline.onVoxelChange(50, 50, 0, true);
    pipeline.onVoxelChange(1, 1, 0);

    expect(pipeline.getDirtyKeys([0, 0])).toEqual(["50,50:0", "1,1:0"]);
  });
});
