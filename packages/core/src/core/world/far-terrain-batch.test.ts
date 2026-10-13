import { ShaderMaterial } from "three";
import { describe, expect, it } from "vitest";

import { FarBatch } from "./far-terrain-batch";
import type { FarMeshData } from "./far-terrain-mesh";

/** A mesh of `quads` quads, as the far mesher writes them. */
const quads = (count: number): FarMeshData => {
  const vertices = count * 4;
  const index = new Uint32Array(count * 6);
  for (let q = 0; q < count; q++) {
    const a = q * 4;
    index.set([a, a + 1, a + 2, a, a + 2, a + 3], q * 6);
  }
  return {
    position: new Int16Array(vertices * 3),
    column: new Int16Array(vertices * 2),
    material: new Uint8Array(vertices * 4),
    tint: new Uint8Array(vertices * 4),
    index,
    quads: count,
    counts: { tops: count, risers: 0, skirts: 0, crowns: 0 },
    minY: 0,
    maxY: 10,
  };
};

describe("FarBatch", () => {
  it("reuses a dropped tile's slot for the next tile of its size", () => {
    const batch = new FarBatch(new ShaderMaterial(), 1 << 16, 8);
    const a = batch.add(quads(100), 0, 0, 64, "a");
    expect(a.capacity).toBe(4096);
    batch.remove(a);
    const b = batch.add(quads(900), 64, 0, 64, "b");
    // 3600 vertices fit the same 4096 slot: no new geometry.
    expect(b.geometryId).toBe(a.geometryId);
    expect(b.instanceId).toBe(a.instanceId);
    expect(batch.slots).toBe(1);
    expect(b.indexCount).toBe(900 * 6);
  });

  it("gives a larger tile a larger slot and keeps both", () => {
    const batch = new FarBatch(new ShaderMaterial(), 1 << 16, 8);
    const small = batch.add(quads(10), 0, 0, 64, "small");
    const large = batch.add(quads(2000), 0, 0, 64, "large");
    expect(large.capacity).toBe(8192);
    expect(large.geometryId).not.toBe(small.geometryId);
    expect(batch.slots).toBe(2);
  });

  it("grows its buffers and instance table when they fill", () => {
    const batch = new FarBatch(new ShaderMaterial(), 8192, 2);
    const slots = [0, 1, 2, 3].map((i) =>
      batch.add(quads(1000), i * 64, 0, 64, `t${i}`),
    );
    expect(new Set(slots.map((slot) => slot.geometryId)).size).toBe(4);
    expect(batch.mesh.maxInstanceCount).toBeGreaterThanOrEqual(4);
  });

  it("shows a slot only while its opacity is above zero", () => {
    const batch = new FarBatch(new ShaderMaterial(), 1 << 16, 8);
    const slot = batch.add(quads(10), 0, 0, 64, "a");
    expect(slot.visible).toBe(false);
    expect(batch.mesh.getVisibleAt(slot.instanceId)).toBe(false);
    batch.setFade(slot, 0.5, true);
    expect(batch.mesh.getVisibleAt(slot.instanceId)).toBe(true);
    batch.setFade(slot, 0, false);
    expect(batch.mesh.getVisibleAt(slot.instanceId)).toBe(false);
  });
});
