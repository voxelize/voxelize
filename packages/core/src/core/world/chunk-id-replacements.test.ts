import { ChunkProtocol } from "@voxelize/protocol";
import { describe, expect, it } from "vitest";

import { Coords2 } from "../../types";
import { ChunkUtils } from "../../utils";

import { Chunk } from "./chunk";
import { ChunkIdReplacementReport } from "./chunk-id-replacements";
import { ChunkPipeline } from "./pipelines";
import { RawChunk } from "./raw-chunk";

const options = {
  size: 2,
  maxHeight: 2,
  maxLightLevel: 15,
  subChunks: 1,
};

const cells = options.size * options.maxHeight * options.size;

const payload = (id: string, coords: Coords2, fill: number): ChunkProtocol => ({
  id,
  x: coords[0],
  z: coords[1],
  meshes: [],
  voxels: new Uint32Array(cells).fill(fill),
  lights: new Uint32Array(cells).fill(fill),
});

describe("a chunk answered under a new server id", () => {
  it("adopts the id and the data for the same coordinates", () => {
    const chunk = new Chunk("old-process-id", [3, -2], options);
    expect(chunk.setData(payload("old-process-id", [3, -2], 1))).toBe(false);

    // What a restarted server sends for the same place.
    expect(chunk.setData(payload("new-process-id", [3, -2], 7))).toBe(true);

    expect(chunk.id).toBe("new-process-id");
    expect(chunk.name).toBe(ChunkUtils.getChunkName([3, -2]));
    expect(chunk.voxels.data[0]).toBe(7);
    expect(chunk.lights.data[0]).toBe(7);
    // Later data under the adopted id is an ordinary refresh.
    expect(chunk.setData(payload("new-process-id", [3, -2], 8))).toBe(false);
  });

  it("does the same on a raw chunk", () => {
    const raw = new RawChunk("a", [0, 0], options);
    expect(raw.setData(payload("b", [0, 0], 5))).toBe(true);
    expect(raw.id).toBe("b");
    expect(raw.voxels.data[0]).toBe(5);
  });

  it("still refuses data for other coordinates", () => {
    const chunk = new Chunk("a", [0, 0], options);
    expect(() => chunk.setData(payload("a", [1, 0], 1))).toThrow(
      "Chunk coords mismatch",
    );
  });
});

describe("the chunk pipeline after a rejoin to a restarted server", () => {
  // The world's processChunks step for data aimed at a loaded chunk.
  const applyReloads = (
    pipeline: ChunkPipeline,
    report: ChunkIdReplacementReport,
  ) => {
    for (const [name, { data }] of [...pipeline.getReloads()]) {
      const chunk = pipeline.getLoadedChunk(name);
      if (!chunk) throw new Error(`no loaded chunk for ${name}`);
      if (chunk.setData(data)) report.note(0);
      pipeline.markLoaded([data.x, data.z], chunk);
    }
  };

  it("drains every refresh without an error and keeps the same chunks", () => {
    const pipeline = new ChunkPipeline();
    const report = new ChunkIdReplacementReport(1000);
    const coords: Coords2[] = [
      [0, 0],
      [1, 0],
      [0, 1],
    ];
    const before = coords.map((c) => {
      const chunk = new Chunk(`old-${c}`, c, options);
      chunk.setData(payload(`old-${c}`, c, 1));
      pipeline.markLoaded(c, chunk);
      return chunk;
    });

    const toRefresh = pipeline.resyncForRejoin();
    expect(toRefresh).toHaveLength(3);
    // Two come back regenerated under new ids, one was saved and kept its id.
    pipeline.markProcessing([0, 0], "load", payload("new-0", [0, 0], 9));
    pipeline.markProcessing([1, 0], "load", payload("new-1", [1, 0], 9));
    pipeline.markProcessing([0, 1], "load", payload("old-0,1", [0, 1], 9));

    expect(() => applyReloads(pipeline, report)).not.toThrow();

    expect(pipeline.getReloads().size).toBe(0);
    expect(pipeline.processingCount).toBe(0);
    coords.forEach((c, i) => {
      const chunk = pipeline.getLoadedChunk(ChunkUtils.getChunkName(c));
      expect(chunk).toBe(before[i]);
      expect(chunk?.voxels.data[0]).toBe(9);
    });
    expect(before.map((c) => c.id)).toEqual(["new-0", "new-1", "old-0,1"]);

    // One line for the burst, with its count, and nothing after.
    expect(report.take(500)).toBeNull();
    expect(report.take(1000)).toBe(2);
    expect(report.take(5000)).toBeNull();
  });

  it("ends a burst early when the next rejoin starts", () => {
    const report = new ChunkIdReplacementReport(1000);
    report.note(0);
    expect(report.take(10)).toBeNull();
    expect(report.take(10, true)).toBe(1);
    expect(report.take(10, true)).toBeNull();
  });
});
