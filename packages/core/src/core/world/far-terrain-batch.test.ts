import { ShaderMaterial } from "three";
import { describe, expect, it } from "vitest";

import { FarBatch } from "./far-terrain-batch";
import {
  FAR_POSITION_SIZE,
  FAR_QUAD_VERTICES,
  type FarMeshData,
} from "./far-terrain-mesh";

/** A mesh of `quads` quads, as the far mesher writes them. */
const quads = (count: number): FarMeshData => {
  const vertices = count * FAR_QUAD_VERTICES;
  return {
    position: new Int16Array(vertices * FAR_POSITION_SIZE),
    column: new Int16Array(vertices * 2),
    material: new Uint8Array(vertices * 4),
    tint: new Uint8Array(vertices * 4),
    quads: count,
    counts: { tops: count, risers: 0, skirts: 0, crowns: 0 },
    minY: 0,
    maxY: 10,
  };
};

/** What a page's multi-draw draws for a slot: its start and vertex count. */
const drawRange = (batch: FarBatch, geometryId: number, page = 0) =>
  batch.pages[page].getGeometryRangeAt(geometryId);

describe("FarBatch", () => {
  it("reuses a dropped tile's slot for the next tile it holds", () => {
    const batch = new FarBatch(new ShaderMaterial(), 1 << 16);
    const a = batch.add(quads(100), 0, 0, 64, "a");
    expect(a.capacity).toBe(1024);
    batch.remove(a);
    const b = batch.add(quads(150), 64, 0, 64, "b");
    // 900 vertices fit the same 1024 slot: no new geometry.
    expect(b.geometryId).toBe(a.geometryId);
    expect(b.instanceId).toBe(a.instanceId);
    expect(batch.slots).toBe(1);
    expect(b.vertexCount).toBe(150 * FAR_QUAD_VERTICES);
  });

  it("draws a tile's own vertices, not its slot's padding", () => {
    const batch = new FarBatch(new ShaderMaterial(), 1 << 16);
    const slot = batch.add(quads(100), 0, 0, 64, "a");
    expect(drawRange(batch, slot.geometryId)?.count).toBe(600);
    batch.remove(slot);
    const next = batch.add(quads(10), 0, 0, 64, "b");
    expect(next.geometryId).toBe(slot.geometryId);
    expect(drawRange(batch, next.geometryId)?.count).toBe(60);
  });

  it("reuses a larger free slot only within the slack", () => {
    const batch = new FarBatch(new ShaderMaterial(), 1 << 16);
    const large = batch.add(quads(1300), 0, 0, 64, "large");
    expect(large.capacity).toBe(8192);
    batch.remove(large);
    // A tile of a 1024 slot would hog a slot eight times its size: no.
    const tiny = batch.add(quads(10), 0, 0, 64, "tiny");
    expect(tiny.geometryId).not.toBe(large.geometryId);
    // A tile of a 2048 slot may take it, at four times its size.
    const middle = batch.add(quads(300), 0, 0, 64, "middle");
    expect(middle.geometryId).toBe(large.geometryId);
  });

  it("opens a new page when the last one is full", () => {
    const batch = new FarBatch(new ShaderMaterial(), 8192);
    const slots = [0, 1, 2, 3].map((i) =>
      batch.add(quads(600), i * 64, 0, 64, `t${i}`),
    );
    // Two 4096 slots fill an 8192-vertex page.
    expect(batch.pages).toHaveLength(2);
    expect(slots.map((slot) => batch.pages.indexOf(slot.page))).toEqual([
      0, 0, 1, 1,
    ]);
    // A tile larger than a page gets a page of its own.
    const huge = batch.add(quads(2000), 0, 0, 64, "huge");
    expect(huge.capacity).toBe(16384);
    expect(batch.pages).toHaveLength(3);
    expect(huge.page.unusedVertexCount).toBe(0);
  });

  it("grows a page's instance table when it fills", () => {
    const batch = new FarBatch(new ShaderMaterial(), 1 << 20);
    const slots = Array.from({ length: 70 }, (_, i) =>
      batch.add(quads(10), i * 64, 0, 64, `t${i}`),
    );
    expect(batch.pages).toHaveLength(1);
    expect(new Set(slots.map((slot) => slot.instanceId)).size).toBe(70);
    expect(batch.pages[0].maxInstanceCount).toBeGreaterThanOrEqual(70);
  });

  it("shows a slot only while its opacity is above zero", () => {
    const batch = new FarBatch(new ShaderMaterial(), 1 << 16);
    const slot = batch.add(quads(10), 0, 0, 64, "a");
    expect(slot.visible).toBe(false);
    expect(slot.page.getVisibleAt(slot.instanceId)).toBe(false);
    batch.setFade(slot, 0.5, true);
    expect(slot.page.getVisibleAt(slot.instanceId)).toBe(true);
    batch.setFade(slot, 0, false);
    expect(slot.page.getVisibleAt(slot.instanceId)).toBe(false);
  });
});
