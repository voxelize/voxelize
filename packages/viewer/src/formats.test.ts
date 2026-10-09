import { describe, expect, it } from "vitest";

import {
  decodeBundle,
  decodeChunkMesh,
  decodeFarTile,
  encodeBundle,
} from "./formats";

/** A chunk mesh file laid out as `server/viewer/format.rs` writes one. */
function chunkMeshFile(): Uint8Array {
  const size = 2;
  const bytes: number[] = [];
  const u32 = (v: number) =>
    bytes.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
  const u16 = (v: number) => bytes.push(v & 255, (v >> 8) & 255);
  const f32 = (v: number) => {
    const b = new Uint8Array(new Float32Array([v]).buffer);
    bytes.push(...b);
  };
  const pad = () => {
    while (bytes.length % 4) bytes.push(0);
  };
  bytes.push(..."VXVM".split("").map((c) => c.charCodeAt(0)));
  u32(1);
  u32(-3 >>> 0);
  u32(7);
  u32(size);
  u32(64);
  u32(32);
  u32(1);
  bytes.push(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12);
  for (let i = 0; i < size * size; i++) {
    u16(10 + i);
    u16(5);
    u16(9 + i);
    u16(6);
    u16(0);
  }
  pad();
  u32(1);
  u32(1);
  u32(42);
  const name = "py";
  u32(name.length);
  bytes.push(...name.split("").map((c) => c.charCodeAt(0)));
  pad();
  u32(0);
  u32(0);
  u32(0);
  u32(0);
  u32(4);
  u32(6);
  for (const v of [0, 1, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1]) f32(v);
  for (const v of [0, 0, 1, 0, 0, 1, 1, 1]) f32(v);
  for (const v of [15, 15, 15, 15]) u32(v);
  for (const v of [0, 1, 2, 2, 1, 3]) u32(v);
  return new Uint8Array(bytes);
}

describe("formats", () => {
  it("reads a chunk mesh file as typed views", () => {
    const file = chunkMeshFile();
    const mesh = decodeChunkMesh(file.buffer as ArrayBuffer);
    expect([
      mesh.cx,
      mesh.cz,
      mesh.chunkSize,
      mesh.maxHeight,
      mesh.levelHeight,
    ]).toEqual([-3, 7, 2, 64, 32]);
    expect(Array.from(mesh.biomeTints ?? [])).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(Array.from(mesh.summary.top)).toEqual([10, 11, 12, 13]);
    expect(Array.from(mesh.summary.ground)).toEqual([9, 10, 11, 12]);
    expect(mesh.geometries).toHaveLength(1);
    const g = mesh.geometries[0];
    expect([g.level, g.voxel, g.faceName, g.at]).toEqual([1, 42, "py", null]);
    expect(g.positions).toHaveLength(12);
    expect(Array.from(g.indices)).toEqual([0, 1, 2, 2, 1, 3]);
    expect(g.positions.buffer).toBe(file.buffer);
  });

  it("refuses a file of another format version", () => {
    const file = chunkMeshFile();
    file[4] = 9;
    expect(() => decodeChunkMesh(file.buffer as ArrayBuffer)).toThrow(
      /format 9/,
    );
  });

  it("keeps files aligned inside a bundle and finds each one", () => {
    const mesh = chunkMeshFile();
    const bundle = encodeBundle([
      { header: { cx: -3, cz: 7, key: "abc" }, file: mesh },
      { header: { cx: 9, cz: 9, empty: true } },
      { header: { cx: 1, cz: 1 }, file: mesh },
    ]);
    const entries = decodeBundle<{ cx: number; empty?: boolean }>(
      bundle.buffer as ArrayBuffer,
    );
    expect(entries.map((e) => e.header.cx)).toEqual([-3, 9, 1]);
    expect(entries[1].length).toBe(0);
    for (const entry of [entries[0], entries[2]]) {
      expect(entry.offset % 4).toBe(0);
      expect(
        decodeChunkMesh(
          bundle.buffer as ArrayBuffer,
          entry.offset,
          entry.length,
        ).cz,
      ).toBe(7);
    }
  });

  it("reads a far tile and its extra layers", () => {
    const size = 2;
    const bytes: number[] = [];
    const u32 = (v: number) =>
      bytes.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
    bytes.push(..."VXVF".split("").map((c) => c.charCodeAt(0)));
    u32(1);
    u32(-16 >>> 0);
    u32(32);
    u32(4);
    u32(size);
    u32(1);
    for (const list of [
      [90, 91, 92, 93],
      [2, 2, 3, 3],
      [0, 87, 0, 0],
    ]) {
      for (const v of list) bytes.push(v & 255, v >> 8);
    }
    u32(4);
    bytes.push(7, 8, 9, 10);
    const tile = decodeFarTile(new Uint8Array(bytes).buffer);
    expect([tile.x0, tile.z0, tile.step, tile.size]).toEqual([-16, 32, 4, 2]);
    expect(Array.from(tile.heights)).toEqual([90, 91, 92, 93]);
    expect(Array.from(tile.water)).toEqual([0, 87, 0, 0]);
    expect(Array.from(tile.layers[0])).toEqual([7, 8, 9, 10]);
  });
});
