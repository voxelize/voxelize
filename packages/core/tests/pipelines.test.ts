import { describe, expect, it } from "vitest";

import { MeshPipeline } from "../src/core/world/pipelines";

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
