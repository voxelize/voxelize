import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RawChunk } from "../core/world/raw-chunk";

import { ChunkSharedPool } from "./chunk-shared-pool";

const OPTIONS = { size: 4, maxHeight: 8, subChunks: 1, maxLightLevel: 15 };
const CELLS = OPTIONS.size * OPTIONS.maxHeight * OPTIONS.size;

function chunkAt(x: number, z: number, fill: number): RawChunk {
  const chunk = new RawChunk(`chunk-${x}-${z}`, [x, z], OPTIONS);
  chunk.voxels.data = new Uint32Array(CELLS).fill(fill);
  chunk.lights.data = new Uint32Array(CELLS).fill(fill + 100);
  return chunk;
}

function isOnPool(chunk: RawChunk): boolean {
  return (
    chunk.voxels.data.buffer instanceof SharedArrayBuffer &&
    chunk.lights.data.buffer instanceof SharedArrayBuffer
  );
}

describe("the shared chunk pool keeps a chunk's data where workers read it", () => {
  const scope = globalThis as { crossOriginIsolated?: boolean };
  let before: boolean | undefined;

  beforeEach(() => {
    before = scope.crossOriginIsolated;
    scope.crossOriginIsolated = true;
    ChunkSharedPool.resetForTests();
  });

  afterEach(() => {
    scope.crossOriginIsolated = before;
    ChunkSharedPool.resetForTests();
  });

  it("moves a chunk onto the shared buffer with its data", () => {
    const pool = ChunkSharedPool.getInstance();
    const chunk = chunkAt(0, 0, 7);

    expect(pool.ensureChunk(chunk)).toBe(true);
    expect(isOnPool(chunk)).toBe(true);
    expect(chunk.voxels.data.every((voxel) => voxel === 7)).toBe(true);
    expect(chunk.lights.data.every((light) => light === 107)).toBe(true);
    expect(pool.getStats().usedSlots).toBe(1);
  });

  it("moves a chunk back on after the server sends it again", () => {
    const pool = ChunkSharedPool.getInstance();
    const chunk = chunkAt(0, 0, 7);
    pool.ensureChunk(chunk);

    // What `Chunk.setData` does with a re-sent chunk: plain arrays in place
    // of the pool's views, the slot still held under the chunk's name.
    chunk.voxels.data = new Uint32Array(CELLS).fill(9);
    chunk.lights.data = new Uint32Array(CELLS).fill(109);
    expect(isOnPool(chunk)).toBe(false);

    expect(pool.ensureChunk(chunk)).toBe(true);
    expect(isOnPool(chunk)).toBe(true);
    expect(chunk.voxels.data.every((voxel) => voxel === 9)).toBe(true);
    expect(chunk.lights.data.every((light) => light === 109)).toBe(true);
    // The same slot, not a second one.
    expect(pool.getStats().usedSlots).toBe(1);
  });

  it("does not hand a chunk another chunk's slot", () => {
    const pool = ChunkSharedPool.getInstance();
    const first = chunkAt(0, 0, 1);
    const second = chunkAt(1, 0, 2);
    pool.ensureChunk(first);
    pool.ensureChunk(second);

    first.voxels.data = new Uint32Array(CELLS).fill(3);
    first.lights.data = new Uint32Array(CELLS).fill(103);
    pool.ensureChunk(first);

    expect(second.voxels.data.every((voxel) => voxel === 2)).toBe(true);
    expect(second.lights.data.every((light) => light === 102)).toBe(true);
    expect(first.voxels.data.every((voxel) => voxel === 3)).toBe(true);
  });

  it("clears what a reused slot held past a shorter light array", () => {
    const pool = ChunkSharedPool.getInstance();
    const first = chunkAt(0, 0, 1);
    pool.ensureChunk(first);
    pool.releaseChunk(first.name);

    const second = chunkAt(1, 0, 2);
    second.lights.data = new Uint32Array(CELLS / 2).fill(5);
    expect(pool.ensureChunk(second)).toBe(true);
    expect(second.lights.data.length).toBe(CELLS);
    expect(second.lights.data[CELLS / 2 - 1]).toBe(5);
    expect(second.lights.data[CELLS / 2]).toBe(0);
  });

  it("costs what the chunks it holds do, not its full size from the first one", () => {
    const pool = ChunkSharedPool.getInstance();
    const bytesPerSlot = CELLS * Uint32Array.BYTES_PER_ELEMENT * 2;
    pool.ensureChunk(chunkAt(0, 0, 1));
    const oneBlock = pool.getStats().bytesAllocated;
    expect(oneBlock).toBeLessThan(pool.getStats().maxSlots * bytesPerSlot);

    // A released slot is taken again before any new room is made.
    pool.releaseChunk("chunk-0-0");
    pool.ensureChunk(chunkAt(5, 5, 2));
    expect(pool.getStats().bytesAllocated).toBe(oneBlock);

    const chunks: RawChunk[] = [];
    const slots = oneBlock / bytesPerSlot;
    for (let i = 0; i < slots * 2; i++) {
      const chunk = chunkAt(i, 1, i + 10);
      expect(pool.ensureChunk(chunk)).toBe(true);
      chunks.push(chunk);
    }
    expect(pool.getStats().bytesAllocated).toBe(oneBlock * 3);
    // Chunks on different blocks each keep their own data.
    chunks.forEach((chunk, i) => {
      expect(chunk.voxels.data.every((voxel) => voxel === i + 10)).toBe(true);
      expect(chunk.lights.data.every((light) => light === i + 110)).toBe(true);
    });
  });

  it("holds no more chunks than its slots", () => {
    const pool = ChunkSharedPool.getInstance();
    const { maxSlots } = pool.getStats();
    for (let i = 0; i < maxSlots; i++) {
      expect(pool.ensureChunk(chunkAt(i, 2, 1))).toBe(true);
    }
    const extra = chunkAt(0, 3, 1);
    expect(pool.ensureChunk(extra)).toBe(false);
    expect(isOnPool(extra)).toBe(false);
    expect(pool.getStats().usedSlots).toBe(maxSlots);
  });
});
