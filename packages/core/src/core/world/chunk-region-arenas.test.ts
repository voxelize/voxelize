import {
  type BatchedMesh,
  BufferAttribute,
  BufferGeometry,
  Group,
  MeshBasicMaterial,
} from "three";
import { describe, expect, it } from "vitest";

import { CustomChunkShaderMaterial } from "./chunk-materials";
import { ChunkRegionArenas } from "./chunk-region-arenas";

/** `quads` unit quads in a row, the shape a section's opaque bucket takes. */
const sectionGeometry = (quads: number) => {
  const positions = new Float32Array(quads * 4 * 3);
  const indices = new Uint32Array(quads * 6);
  for (let q = 0; q < quads; q++) {
    positions.set([q, 0, 0, q + 1, 0, 0, q + 1, 1, 0, q, 1, 0], q * 12);
    const v = q * 4;
    indices.set([v, v + 1, v + 2, v, v + 2, v + 3], q * 6);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
};

const makeArenas = (
  parent: Group,
  onRegionMesh?: (mesh: BatchedMesh, isAdded: boolean) => void,
) =>
  new ChunkRegionArenas(
    {
      regionSizeInChunks: 4,
      initialVertexCapacity: 64,
      slotSlack: 1.25,
      growthFactor: 2,
      indexPerVertexRatio: 1.5,
    },
    64,
    () => new MeshBasicMaterial() as unknown as CustomChunkShaderMaterial,
    parent,
    1,
    onRegionMesh,
  );

describe("ChunkRegionArenas remesh", () => {
  it("swaps a section's geometry within one call, whatever the new size", () => {
    // Whether the rewrite fits the slot, needs a new slot, or grows the
    // whole region, the section is never without a slot between calls: no
    // frame can draw the region with the section missing.
    const parent = new Group();
    const arenas = makeArenas(parent);
    const isShown = () =>
      arenas.setSectionReveal(1, 1, 0, 1) && arenas.stats.sections === 1;

    arenas.setSectionGeometry(1, 1, 0, sectionGeometry(2), 16, 0, 16);
    expect(isShown()).toBe(true);
    for (const quads of [1, 2, 6, 40, 3, 200]) {
      arenas.setSectionGeometry(1, 1, 0, sectionGeometry(quads), 16, 0, 16);
      expect(isShown()).toBe(true);
      expect(parent.children).toHaveLength(1);
    }
  });

  it("clears a section only when its new geometry is empty", () => {
    const parent = new Group();
    const arenas = makeArenas(parent);
    arenas.setSectionGeometry(0, 0, 1, sectionGeometry(4), 0, 32, 0);
    arenas.setSectionGeometry(0, 0, 1, sectionGeometry(0), 0, 32, 0);
    expect(arenas.stats.sections).toBe(0);
    expect(parent.children).toHaveLength(0);
  });
});

describe("ChunkRegionArenas region meshes", () => {
  it("names each region mesh to its host once as it joins and once as it leaves", () => {
    // The host hides a region from the shadow passes or plans its texels
    // the way it did the section meshes; a region that grows keeps its
    // place in those sets, and only the last section leaving retires it.
    const parent = new Group();
    const events: [BatchedMesh, boolean][] = [];
    const arenas = makeArenas(parent, (mesh, isAdded) =>
      events.push([mesh, isAdded]),
    );

    arenas.setSectionGeometry(0, 0, 0, sectionGeometry(2), 0, 0, 0);
    arenas.setSectionGeometry(1, 0, 0, sectionGeometry(200), 16, 0, 0);
    arenas.setSectionGeometry(5, 0, 0, sectionGeometry(2), 80, 0, 0);
    expect(events.map(([, isAdded]) => isAdded)).toEqual([true, true]);
    const [[first], [second]] = events;
    expect(first).not.toBe(second);
    expect(parent.children).toEqual([first, second]);

    arenas.clearSection(0, 0, 0);
    expect(events).toHaveLength(2);
    arenas.clearSection(1, 0, 0);
    expect(events[2]).toEqual([first, false]);
    arenas.dispose();
    expect(events[3]).toEqual([second, false]);
  });
});
