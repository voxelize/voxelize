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

describe("ChunkPipeline data for a loaded chunk", () => {
  it("keeps the chunk loaded and queues the data for that same chunk", () => {
    const pipeline = new ChunkPipeline();
    const loaded = makeChunk([0, 0]);
    const name = ChunkUtils.getChunkName([0, 0]);
    pipeline.markLoaded([0, 0], loaded);

    pipeline.markProcessing([0, 0], "load", protocolFor([0, 0]));

    expect(pipeline.getStage(name)).toBe("loaded");
    expect(pipeline.getLoadedChunk(name)).toBe(loaded);
    expect(pipeline.getReloads().get(name)?.data.x).toBe(0);
    expect(pipeline.isAwaitingData(name)).toBe(true);
    expect(pipeline.processingCount).toBe(1);

    pipeline.markLoaded([0, 0], loaded);

    expect(pipeline.getReloads().size).toBe(0);
    expect(pipeline.isAwaitingData(name)).toBe(false);
    expect(pipeline.processingCount).toBe(0);
  });

  it("layers the voxel message over the mesh message it follows", () => {
    const pipeline = new ChunkPipeline();
    const name = ChunkUtils.getChunkName([0, 0]);
    pipeline.markLoaded([0, 0], makeChunk([0, 0]));
    const meshes = [{ level: 0, geometries: [] }] as ChunkProtocol["meshes"];
    const voxels = new Uint32Array([7]);

    pipeline.markProcessing([0, 0], "load", {
      ...protocolFor([0, 0]),
      meshes,
      voxels: undefined,
      lights: undefined,
    });
    pipeline.markProcessing([0, 0], "load", {
      ...protocolFor([0, 0]),
      meshes: [],
      voxels,
    });

    const data = pipeline.getReloads().get(name)?.data;
    expect(data?.meshes).toBe(meshes);
    expect(data?.voxels).toBe(voxels);
  });

  it("drops queued data when the chunk is removed", () => {
    const pipeline = new ChunkPipeline();
    const name = ChunkUtils.getChunkName([0, 0]);
    pipeline.markLoaded([0, 0], makeChunk([0, 0]));
    pipeline.markProcessing([0, 0], "load", protocolFor([0, 0]));

    pipeline.remove(name);

    expect(pipeline.getReloads().size).toBe(0);
    expect(pipeline.getStage(name)).toBeNull();
  });

  it("still sends a chunk it has no data for through processing", () => {
    const pipeline = new ChunkPipeline();
    const name = ChunkUtils.getChunkName([1, 0]);
    pipeline.markRequested([1, 0]);

    pipeline.markProcessing([1, 0], "load", protocolFor([1, 0]));

    expect(pipeline.getStage(name)).toBe("processing");
    expect(pipeline.getReloads().size).toBe(0);
    expect(pipeline.isAwaitingData(name)).toBe(true);
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

describe("ChunkPipeline.getTiming", () => {
  it("carries the request time through receive and load", () => {
    const pipeline = new ChunkPipeline();
    const name = ChunkUtils.getChunkName([0, 0]);
    pipeline.markRequested([0, 0]);
    const requestedAt = pipeline.getTiming(name)?.requestedAt;
    expect(requestedAt).not.toBeNull();

    pipeline.markProcessing([0, 0], "load", protocolFor([0, 0]));
    const afterReceive = pipeline.getTiming(name);
    expect(afterReceive?.requestedAt).toBe(requestedAt);
    expect(afterReceive?.receivedAt).not.toBeNull();
    expect(afterReceive?.loadedAt).toBeNull();

    pipeline.markLoaded([0, 0], makeChunk([0, 0]));
    const afterLoad = pipeline.getTiming(name);
    expect(afterLoad?.requestedAt).toBe(requestedAt);
    expect(afterLoad?.receivedAt).toBe(afterReceive?.receivedAt);
    expect(afterLoad?.loadedAt).not.toBeNull();
    expect(afterLoad?.loadedAt ?? -Infinity).toBeGreaterThanOrEqual(
      afterLoad?.receivedAt ?? Infinity,
    );
  });

  it("keeps the first receive and arrival times when a second payload merges in", () => {
    const pipeline = new ChunkPipeline();
    const name = ChunkUtils.getChunkName([1, 0]);
    pipeline.markProcessing([1, 0], "load", protocolFor([1, 0]), 41);
    const first = pipeline.getTiming(name)?.receivedAt;

    pipeline.markProcessing([1, 0], "load", protocolFor([1, 0]), 99);

    expect(pipeline.getTiming(name)?.receivedAt).toBe(first);
    expect(pipeline.getTiming(name)?.arrivedAt).toBe(41);
    expect(pipeline.getTiming(name)?.requestedAt).toBeNull();

    pipeline.markLoaded([1, 0], makeChunk([1, 0]));
    expect(pipeline.getTiming(name)?.arrivedAt).toBe(41);
  });

  it("stamps the send once and carries it through to loaded", () => {
    const pipeline = new ChunkPipeline();
    const name = ChunkUtils.getChunkName([3, 0]);
    pipeline.markRequested([3, 0]);
    expect(pipeline.getTiming(name)?.sentAt).toBeNull();

    pipeline.markSent([3, 0], 500);
    pipeline.markSent([3, 0], 900);
    expect(pipeline.getTiming(name)?.sentAt).toBe(500);

    pipeline.markProcessing([3, 0], "load", protocolFor([3, 0]), 700);
    pipeline.markLoaded([3, 0], makeChunk([3, 0]));
    expect(pipeline.getTiming(name)?.sentAt).toBe(500);
    expect(pipeline.getTiming(name)?.arrivedAt).toBe(700);
  });

  it("ignores a send stamp for a chunk that is no longer waiting", () => {
    const pipeline = new ChunkPipeline();
    const name = ChunkUtils.getChunkName([4, 0]);
    pipeline.markProcessing([4, 0], "load", protocolFor([4, 0]));

    pipeline.markSent([4, 0], 123);

    expect(pipeline.getTiming(name)?.sentAt).toBeNull();
  });

  it("has no arrival time for a payload the transport did not stamp", () => {
    const pipeline = new ChunkPipeline();
    const name = ChunkUtils.getChunkName([2, 0]);
    pipeline.markProcessing([2, 0], "load", protocolFor([2, 0]));

    expect(pipeline.getTiming(name)?.arrivedAt).toBeNull();
  });

  it("knows nothing about a chunk it never saw", () => {
    const pipeline = new ChunkPipeline();
    expect(pipeline.getTiming(ChunkUtils.getChunkName([9, 9]))).toBeUndefined();
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

  it("knows whether a section has ever shown a mesh", () => {
    const pipeline = new MeshPipeline();
    expect(pipeline.hasDisplayed("0,0:0")).toBe(false);
    pipeline.onVoxelChange(0, 0, 0);
    const generation = pipeline.startJob("0,0:0");
    expect(pipeline.hasDisplayed("0,0:0")).toBe(false);
    expect(pipeline.onJobComplete("0,0:0", generation)).toBe(true);
    // Still true while a newer mesh is pending: the old one is on screen.
    pipeline.onVoxelChange(0, 0, 0);
    expect(pipeline.hasDisplayed("0,0:0")).toBe(true);
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

  it("expires a stuck in-flight job and requeues its key", () => {
    // The long-session hole shape: a dispatched job that never settles
    // (worker died, queue shed without release, a path missing failJob)
    // blocks single-flight dispatch for its chunk level forever. The
    // watchdog must declare it leaked, release it, and re-queue the key.
    const pipeline = new MeshPipeline();
    pipeline.onVoxelChange(7, 7, 1);
    pipeline.startJob("7,7:1", 1_000);

    // Within the ceiling: nothing expires, single-flight still holds.
    expect(pipeline.expireStuckJobs(20_000, 30_000)).toEqual([]);
    expect(pipeline.shouldStartJob("7,7:1")).toBe(false);

    // Past the ceiling: the leak is released and the key is dirty again.
    expect(pipeline.expireStuckJobs(31_001, 30_000)).toEqual(["7,7:1"]);
    expect(pipeline.shouldStartJob("7,7:1")).toBe(true);
    expect(pipeline.needsRemesh("7,7:1")).toBe(true);

    // A late completion from the expired job cannot regress the display:
    // its generation was already released, and the fresh dispatch owns it.
    const freshGeneration = pipeline.startJob("7,7:1", 31_002);
    expect(pipeline.onJobComplete("7,7:1", freshGeneration)).toBe(true);
  });

  it("a healthy in-flight job is never expired", () => {
    const pipeline = new MeshPipeline();
    pipeline.onVoxelChange(4, 4, 0);
    const generation = pipeline.startJob("4,4:0", 0);

    expect(pipeline.expireStuckJobs(29_999, 30_000)).toEqual([]);
    expect(pipeline.onJobComplete("4,4:0", generation)).toBe(true);
    expect(pipeline.expireStuckJobs(120_000, 30_000)).toEqual([]);
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

describe("ChunkPipeline.loadedGeneration", () => {
  it("bumps only when a chunk enters or leaves the loaded stage", () => {
    const pipeline = new ChunkPipeline();
    const start = pipeline.loadedGeneration;

    pipeline.markRequested([0, 0]);
    pipeline.markProcessing([0, 0], "load", protocolFor([0, 0]), null);
    expect(pipeline.loadedGeneration).toBe(start);

    pipeline.markLoaded([0, 0], makeChunk([0, 0]));
    expect(pipeline.loadedGeneration).toBe(start + 1);

    pipeline.markRequested([1, 0]);
    expect(pipeline.loadedGeneration).toBe(start + 1);

    pipeline.remove(ChunkUtils.getChunkName([0, 0]));
    expect(pipeline.loadedGeneration).toBe(start + 2);

    pipeline.remove(ChunkUtils.getChunkName([1, 0]));
    expect(pipeline.loadedGeneration).toBe(start + 2);
  });
});
