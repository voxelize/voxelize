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
});
