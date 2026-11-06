import {
  type BatchedMesh,
  BufferAttribute,
  BufferGeometry,
  Group,
  MeshBasicNodeMaterial,
} from "three/webgpu";
import { describe, expect, it } from "vitest";

import { ChunkMaterial } from "./chunk-materials";
import { ChunkRegionArenas, setSectionBounds } from "./chunk-region-arenas";

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
      pageVertexCapacity: 64,
      slotSlack: 1.25,
      indexPerVertexRatio: 1.5,
    },
    64,
    () => new MeshBasicNodeMaterial() as unknown as ChunkMaterial,
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

describe("ChunkRegionArenas pages", () => {
  const capacities = (parent: Group) =>
    parent.children.map(
      (child) => (child as BatchedMesh).geometry.getAttribute("position").count,
    );

  it("opens a page when one fills, and never grows one", () => {
    // A grown buffer is rebuilt and uploaded whole in one frame; a region
    // gains room a page at a time instead.
    const parent = new Group();
    const arenas = makeArenas(parent);
    for (let cx = 0; cx < 4; cx++) {
      arenas.setSectionGeometry(cx, 0, 0, sectionGeometry(5), cx * 16, 0, 0);
    }
    // Four sections of 25 reserved vertices: two to a 64-vertex page.
    expect(arenas.stats).toEqual({ regions: 1, pages: 2, sections: 4 });
    expect(capacities(parent)).toEqual([64, 64]);

    // A section larger than a page gets a page of its own, sized to it.
    arenas.setSectionGeometry(0, 1, 0, sectionGeometry(40), 0, 0, 16);
    expect(capacities(parent)).toEqual([64, 64, 200]);
  });

  it("compacts a page to fit a slot into the room freed slots left", () => {
    const parent = new Group();
    const arenas = makeArenas(parent);
    arenas.setSectionGeometry(0, 0, 0, sectionGeometry(5), 0, 0, 0);
    arenas.setSectionGeometry(1, 0, 0, sectionGeometry(5), 16, 0, 0);
    arenas.clearSection(0, 0, 0);
    // The page's end has 14 vertices free, its freed slot 25 more.
    arenas.setSectionGeometry(2, 0, 0, sectionGeometry(5), 32, 0, 0);
    expect(arenas.stats).toEqual({ regions: 1, pages: 1, sections: 2 });
    expect(arenas.setSectionReveal(1, 0, 0, 1)).toBe(true);
    expect(arenas.setSectionReveal(2, 0, 0, 1)).toBe(true);
  });

  it("names each page to its host once as it joins and once as it leaves", () => {
    // The host hides a page from the shadow passes or plans its texels the
    // way it did the section meshes; a page leaves when its last section
    // does, or with the arenas.
    const parent = new Group();
    const events: [BatchedMesh, boolean][] = [];
    const arenas = makeArenas(parent, (mesh, isAdded) =>
      events.push([mesh, isAdded]),
    );

    arenas.setSectionGeometry(0, 0, 0, sectionGeometry(2), 0, 0, 0);
    arenas.setSectionGeometry(5, 0, 0, sectionGeometry(2), 80, 0, 0);
    expect(events.map(([, isAdded]) => isAdded)).toEqual([true, true]);
    const [[first], [second]] = events;
    expect(first).not.toBe(second);
    expect(parent.children).toEqual([first, second]);

    arenas.clearSection(0, 0, 0);
    expect(events[2]).toEqual([first, false]);
    expect(arenas.stats.regions).toBe(1);
    arenas.dispose();
    expect(events[3]).toEqual([second, false]);
    expect(parent.children).toEqual([]);
  });
});

describe("ChunkRegionArenas pages in an area", () => {
  it("collects the pages of every region over the chunk range, and only those", () => {
    const parent = new Group();
    const arenas = makeArenas(parent);
    // Regions are 4x4 chunks: (1,1) and (2,3) share region 0,0; (9,1) is
    // region 2,0; (-3,1) is region -1,0.
    arenas.setSectionGeometry(1, 1, 0, sectionGeometry(2), 16, 0, 16);
    arenas.setSectionGeometry(2, 3, 0, sectionGeometry(2), 16, 0, 16);
    arenas.setSectionGeometry(9, 1, 0, sectionGeometry(2), 16, 0, 16);
    arenas.setSectionGeometry(-3, 1, 0, sectionGeometry(2), 16, 0, 16);
    const near: unknown[] = [];
    arenas.collectPagesIn(0, 3, 0, 3, near as never);
    expect(near).toHaveLength(1);
    const wide: unknown[] = [];
    arenas.collectPagesIn(-1, 8, 0, 1, wide as never);
    expect(wide).toHaveLength(3);
    for (const mesh of wide) expect(parent.children).toContain(mesh);
  });
});


describe("setSectionBounds", () => {
  it("bounds a section from its positions, as the batch's slot takes them", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Uint16Array([4, 9, 2, 0, 10, 3, 7, 0, 6, 1, 5, 0]), 4),
    );
    setSectionBounds(geometry);
    expect(geometry.boundingBox!.min.toArray()).toEqual([4, 1, 2]);
    expect(geometry.boundingBox!.max.toArray()).toEqual([10, 9, 7]);
    // The sphere holds the box.
    const sphere = geometry.boundingSphere!;
    expect(sphere.containsPoint(geometry.boundingBox!.min)).toBe(true);
    expect(sphere.containsPoint(geometry.boundingBox!.max)).toBe(true);
  });
});
