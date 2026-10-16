import {
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  MeshBasicMaterial,
} from "three";
import { describe, expect, it } from "vitest";

import { PoolPage, SectionPool } from "./section-pool";

/** A strip of `quads` quads whose x positions count up from `first`. */
function section(quads: number, first = 0) {
  const vertices = quads * 4;
  const positions = new Float32Array(vertices * 3);
  for (let v = 0; v < vertices; v++) positions[v * 3] = first + v;
  const indices = new Uint32Array(quads * 6);
  for (let q = 0; q < quads; q++) {
    indices.set(
      [0, 1, 2, 2, 1, 3].map((i) => q * 4 + i),
      q * 6,
    );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

const page = (pool: SectionPool) => pool.group.children[0] as PoolPage;

describe("a section pool", () => {
  it("copies each section to its slot with its indices rebased there", () => {
    const pool = new SectionPool(new MeshBasicMaterial(), 4096, false);
    pool.add(section(2, 100), new Matrix4());
    const second = pool.add(section(3, 500), new Matrix4());
    expect(pool.stats).toMatchObject({ pages: 1, slots: 2 });

    const batch = page(pool).geometry;
    const positions = batch.getAttribute("position").array;
    const index = batch.getIndex()?.array ?? new Uint32Array();
    const info = (
      page(pool) as unknown as {
        _geometryInfo: {
          vertexStart: number;
          indexStart: number;
          count: number;
        }[];
      }
    )._geometryInfo[second.geometryId];
    // Both sections sit in 256-vertex slots: the second starts at 256.
    expect(info.vertexStart).toBe(256);
    expect(positions[info.vertexStart * 3]).toBe(500);
    expect(positions[(info.vertexStart + 11) * 3]).toBe(511);
    expect(info.count).toBe(18);
    expect(
      Array.from(index.slice(info.indexStart, info.indexStart + 6)),
    ).toEqual([0, 1, 2, 2, 1, 3].map((i) => i + 256));
  });

  it("reuses a freed slot of the same size instead of growing", () => {
    const pool = new SectionPool(new MeshBasicMaterial(), 4096, false);
    const first = pool.add(section(2), new Matrix4());
    pool.remove(first);
    expect(pool.stats).toMatchObject({ slots: 0, freeSlots: 1 });
    const again = pool.add(section(1, 7), new Matrix4());
    expect(again).toBe(first);
    expect(pool.stats).toMatchObject({ pages: 1, slots: 1, freeSlots: 0 });
    // The short section draws only its own indices, not the slot's old tail.
    const info = (
      page(pool) as unknown as { _geometryInfo: { count: number }[] }
    )._geometryInfo[again.geometryId];
    expect(info.count).toBe(6);
  });

  it("sizes a page for many sections like the one that opens it", () => {
    const pool = new SectionPool(new MeshBasicMaterial(), 256, false);
    pool.add(section(1), new Matrix4());
    // A 256-vertex slot opens a page with room for 128 of them...
    expect(pool.stats).toMatchObject({ pages: 1, capacity: 256 * 128 });
    expect(pool.takeMadeBytes()).toBeGreaterThan(0);
    expect(pool.takeMadeBytes()).toBe(0);
    // ...so a bigger section still fits beside it, with nothing made.
    pool.add(section(200), new Matrix4());
    expect(pool.stats.pages).toBe(1);
    expect(pool.takeMadeBytes()).toBe(0);
  });
});
