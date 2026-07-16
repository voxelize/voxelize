import { ChunkProtocol } from "@voxelize/protocol";
import { describe, expect, it } from "vitest";

import { Coords2 } from "../../types";
import { ChunkUtils } from "../../utils";

import { Chunk } from "./chunk";
import { ChunkPipeline } from "./pipelines";

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
