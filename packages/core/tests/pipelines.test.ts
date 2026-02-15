import { describe, expect, it } from "vitest";

import { ChunkPipeline, MeshPipeline } from "../src/core/world/pipelines";
import { ChunkUtils } from "../src/utils/chunk-utils";

describe("MeshPipeline.hasInFlightJob", () => {
  it("returns false for unknown mesh keys", () => {
    const pipeline = new MeshPipeline();
    expect(pipeline.hasInFlightJob("unknown")).toBe(false);
  });

  it("tracks in-flight state for started and completed jobs", () => {
    const pipeline = new MeshPipeline();
    pipeline.onVoxelChange(4, 8, 0);
    const key = MeshPipeline.makeKey(4, 8, 0);

    expect(pipeline.hasAnyInFlightJobs()).toBe(false);
    const started = pipeline.startJob(key);
    expect(started).not.toBeNull();
    expect(pipeline.hasInFlightJob(key)).toBe(true);
    expect(pipeline.hasAnyInFlightJobs()).toBe(true);

    const inFlightGeneration = started?.inFlightGeneration;
    if (inFlightGeneration === null || inFlightGeneration === undefined) {
      throw new Error("Expected in-flight generation to be set after startJob");
    }
    pipeline.completeJobStatus(key, inFlightGeneration);
    expect(pipeline.hasInFlightJob(key)).toBe(false);
    expect(pipeline.hasAnyInFlightJobs()).toBe(false);
    expect(pipeline.startJob(key)).toBeNull();
  });

  it("clears aggregate in-flight state when in-flight chunks are removed", () => {
    const pipeline = new MeshPipeline();
    pipeline.onVoxelChange(2, 3, 1);
    const key = MeshPipeline.makeKey(2, 3, 1);

    const started = pipeline.startJob(key);
    expect(started).not.toBeNull();
    expect(pipeline.hasAnyInFlightJobs()).toBe(true);

    pipeline.remove(2, 3);
    expect(pipeline.hasAnyInFlightJobs()).toBe(false);
  });

  it("clears aggregate in-flight state when a started job aborts", () => {
    const pipeline = new MeshPipeline();
    pipeline.onVoxelChange(6, 7, 2);
    const key = MeshPipeline.makeKey(6, 7, 2);

    const started = pipeline.startJob(key);
    expect(started).not.toBeNull();
    expect(pipeline.hasAnyInFlightJobs()).toBe(true);

    pipeline.abortJob(key);
    expect(pipeline.hasInFlightJob(key)).toBe(false);
    expect(pipeline.hasAnyInFlightJobs()).toBe(false);
  });

  it("clears aggregate in-flight state when chunk becomes fresh from server", () => {
    const pipeline = new MeshPipeline();
    pipeline.onVoxelChange(9, 4, 0);
    const key = MeshPipeline.makeKey(9, 4, 0);

    const started = pipeline.startJob(key);
    expect(started).not.toBeNull();
    expect(pipeline.hasAnyInFlightJobs()).toBe(true);

    pipeline.markFreshFromServer(9, 4, 0);
    expect(pipeline.hasInFlightJob(key)).toBe(false);
    expect(pipeline.hasAnyInFlightJobs()).toBe(false);
  });

  it("does not start duplicate in-flight jobs for the same key", () => {
    const pipeline = new MeshPipeline();
    pipeline.onVoxelChange(10, 11, 0);
    const key = MeshPipeline.makeKey(10, 11, 0);

    const started = pipeline.startJob(key);
    expect(started).not.toBeNull();
    expect(pipeline.startJob(key)).toBeNull();
    expect(pipeline.hasAnyInFlightJobs()).toBe(true);
  });
});

describe("MeshPipeline.getDirtyKeysAndHasMore", () => {
  it("returns empty keys for fractional limits below one", () => {
    const pipeline = new MeshPipeline();
    pipeline.onVoxelChange(1, 2, 0);

    const result = pipeline.getDirtyKeysAndHasMore(0.9);
    expect(result.keys).toHaveLength(0);
    expect(result.hasMore).toBe(false);
  });

  it("returns empty keys for non-finite dirty-key limits", () => {
    const pipeline = new MeshPipeline();
    pipeline.onVoxelChange(1, 2, 0);

    expect(pipeline.getDirtyKeysAndHasMore(Number.NaN).keys).toHaveLength(0);
    expect(
      pipeline.getDirtyKeysAndHasMore(Number.NEGATIVE_INFINITY).keys
    ).toHaveLength(0);
  });

  it("floors fractional limits when selecting dirty keys", () => {
    const pipeline = new MeshPipeline();
    pipeline.onVoxelChange(1, 2, 0);
    pipeline.onVoxelChange(3, 4, 0);

    const result = pipeline.getDirtyKeysAndHasMore(1.8);
    expect(result.keys).toHaveLength(1);
    expect(result.hasMore).toBe(true);
  });

  it("returns all dirty keys when limit is infinite", () => {
    const pipeline = new MeshPipeline();
    pipeline.onVoxelChange(1, 2, 0);
    pipeline.onVoxelChange(3, 4, 0);
    pipeline.onVoxelChange(5, 6, 0);

    const result = pipeline.getDirtyKeysAndHasMore(Number.POSITIVE_INFINITY);
    expect(result.keys).toHaveLength(3);
    expect(result.hasMore).toBe(false);
  });
});

describe("ChunkPipeline.shouldRequestAt", () => {
  it("treats non-finite retry intervals as immediate re-request", () => {
    const pipeline = new ChunkPipeline();
    pipeline.markRequestedAt(3, 4);
    const name = ChunkUtils.getChunkNameAt(3, 4);

    expect(pipeline.shouldRequestAt(3, 4, Number.NaN)).toBe(true);
    expect(pipeline.getStage(name)).toBeNull();
  });

  it("floors fractional retry intervals", () => {
    const pipeline = new ChunkPipeline();
    pipeline.markRequestedAt(5, 6);
    const name = ChunkUtils.getChunkNameAt(5, 6);

    expect(pipeline.shouldRequestAt(5, 6, 1.8)).toBe(false);
    expect(pipeline.getRetryCount(name)).toBe(1);
    expect(pipeline.shouldRequestAt(5, 6, 1.8)).toBe(true);
    expect(pipeline.getStage(name)).toBeNull();
  });

  it("never forces re-request for infinite retry intervals", () => {
    const pipeline = new ChunkPipeline();
    pipeline.markRequestedAt(7, 8);
    const name = ChunkUtils.getChunkNameAt(7, 8);

    expect(pipeline.shouldRequestAt(7, 8, Number.POSITIVE_INFINITY)).toBe(false);
    expect(pipeline.shouldRequestAt(7, 8, Number.POSITIVE_INFINITY)).toBe(false);
    expect(pipeline.getStage(name)).toBe("requested");
    expect(pipeline.getRetryCount(name)).toBe(2);
  });

  it("saturates retry counters at max safe integer", () => {
    const pipeline = new ChunkPipeline();
    pipeline.markRequestedAt(9, 10);
    const name = ChunkUtils.getChunkNameAt(9, 10);
    const requested = pipeline.getRequestedCoords(name);
    if (!requested) {
      throw new Error("Expected requested stage for retry saturation test");
    }

    requested.retryCount = Number.MAX_SAFE_INTEGER;
    expect(pipeline.incrementRetry(name)).toBe(Number.MAX_SAFE_INTEGER);
    expect(pipeline.getRetryCount(name)).toBe(Number.MAX_SAFE_INTEGER);
    expect(pipeline.shouldRequestAt(9, 10, Number.POSITIVE_INFINITY)).toBe(false);
    expect(pipeline.getRetryCount(name)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("normalizes invalid retry counters before incrementing", () => {
    const pipeline = new ChunkPipeline();
    pipeline.markRequestedAt(11, 12);
    const name = ChunkUtils.getChunkNameAt(11, 12);
    const requested = pipeline.getRequestedCoords(name);
    if (!requested) {
      throw new Error("Expected requested stage for invalid retry normalization test");
    }

    requested.retryCount = Number.NaN;
    expect(pipeline.incrementRetry(name)).toBe(1);
    expect(pipeline.getRetryCount(name)).toBe(1);
  });

  it("normalizes fractional retry counters before incrementing", () => {
    const pipeline = new ChunkPipeline();
    pipeline.markRequestedAt(15, 16);
    const name = ChunkUtils.getChunkNameAt(15, 16);
    const requested = pipeline.getRequestedCoords(name);
    if (!requested) {
      throw new Error("Expected requested stage for fractional retry normalization test");
    }

    requested.retryCount = 1.8;
    expect(pipeline.incrementRetry(name)).toBe(2);
    expect(pipeline.getRetryCount(name)).toBe(2);
  });

  it("normalizes negative retry counters in shouldRequestAt flow", () => {
    const pipeline = new ChunkPipeline();
    pipeline.markRequestedAt(13, 14);
    const name = ChunkUtils.getChunkNameAt(13, 14);
    const requested = pipeline.getRequestedCoords(name);
    if (!requested) {
      throw new Error("Expected requested stage for negative retry normalization test");
    }

    requested.retryCount = -5;
    expect(pipeline.shouldRequestAt(13, 14, 1)).toBe(false);
    expect(pipeline.getRetryCount(name)).toBe(1);
    expect(pipeline.shouldRequestAt(13, 14, 1)).toBe(true);
    expect(pipeline.getStage(name)).toBeNull();
  });
});
