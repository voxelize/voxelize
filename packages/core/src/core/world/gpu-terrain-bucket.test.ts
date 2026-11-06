import {
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  MeshBasicNodeMaterial,
  OrthographicCamera,
  PerspectiveCamera,
} from "three/webgpu";
import { describe, expect, it } from "vitest";

import {
  GpuTerrainArenas,
  GpuTerrainBucket,
  GpuTerrainCulls,
} from "./gpu-terrain-bucket";
import { markShadowView } from "./shadow-casters";
import { POSITION_BLOCK_BIAS } from "./vertex-quantization";

const UNITS = 8;

/** A section as `mergeSectionGeometries` lays one: a quad of `vertices / 4`. */
const section = (vertices: number, offset = 0) => {
  const geometry = new BufferGeometry();
  const positions = new Uint16Array(vertices * 4);
  for (let v = 0; v < vertices; v++) {
    positions[v * 4] = (v % 4) * UNITS + offset;
    positions[v * 4 + 1] = Math.floor(v / 4) * UNITS;
    positions[v * 4 + 2] = offset;
  }
  geometry.setAttribute("position", new BufferAttribute(positions, 4));
  geometry.setAttribute("uv", new BufferAttribute(new Uint16Array(vertices * 2), 2, true));
  geometry.setAttribute("light", new BufferAttribute(new Int32Array(vertices).fill(7), 1));
  geometry.setAttribute("lightTwist", new BufferAttribute(new Uint8Array(vertices * 4), 4));
  geometry.setAttribute("normal", new BufferAttribute(new Int8Array(vertices * 4), 4, true));
  const indices = new Uint32Array((vertices / 4) * 6);
  for (let q = 0; q < vertices / 4; q++) {
    indices.set([0, 1, 2, 2, 1, 3].map((i) => i + q * 4), q * 6);
  }
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
};

const make = () =>
  new GpuTerrainBucket(new MeshBasicNodeMaterial(), {
    vertexCapacity: 1 << 14,
    sectionCapacity: 64,
    positionUnits: UNITS,
  });

type Internals = {
  attributes: Map<string, BufferAttribute>;
  sectionIds: BufferAttribute;
  sourceIndex: BufferAttribute;
  records: BufferAttribute;
  flags: BufferAttribute;
  slots: Map<string, { id: number; vertexStart: number; indexStart: number }>;
};

describe("GpuTerrainBucket", () => {
  it("writes a section's vertices, ids, rebased indices and record", () => {
    const bucket = make();
    const state = bucket as unknown as Internals;
    bucket.setSectionGeometry("a", section(8), 0, 0, 0);
    bucket.setSectionGeometry("b", section(8), 16, 32, 48);
    const b = state.slots.get("b")!;
    expect(b.vertexStart).toBeGreaterThan(0);
    // Vertices land in the slot, tagged with its section.
    expect(state.attributes.get("light")!.array[b.vertexStart]).toBe(7);
    expect(state.sectionIds.array[b.vertexStart]).toBe(b.id);
    expect(state.sectionIds.array[b.vertexStart + 7]).toBe(b.id);
    // Indices point into the bucket's vertices.
    expect(state.sourceIndex.array[b.indexStart]).toBe(b.vertexStart);
    expect(state.sourceIndex.array[b.indexStart + 5]).toBe(b.vertexStart + 3);
    // Origin as the arenas' section transform, drawn as itself, a sphere
    // around the section.
    const record = Array.from(state.records.array.slice(b.id * 8, b.id * 8 + 8));
    expect(record.slice(0, 4)).toEqual([
      16 - POSITION_BLOCK_BIAS,
      32 - POSITION_BLOCK_BIAS,
      48 - POSITION_BLOCK_BIAS,
      1,
    ]);
    expect(record[7]).toBeGreaterThan(0);
    // Its indices, drawn and live.
    expect(Array.from(state.flags.array.slice(b.id * 4, b.id * 4 + 4))).toEqual([
      b.indexStart,
      12,
      1,
      1,
    ]);
  });

  it("places a float-position section (water) at its corner, unscaled", () => {
    const bucket = make();
    const state = bucket as unknown as Internals;
    const water = new BufferGeometry();
    water.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 16, 1, 16, 16, 1, 0, 0, 1, 16]), 3),
    );
    water.setAttribute("light", new BufferAttribute(new Int32Array(4), 1));
    water.setIndex(new BufferAttribute(new Uint32Array([0, 1, 2, 2, 1, 3]), 1));
    bucket.setSectionGeometry("w", water, 32, 64, 96);
    const w = state.slots.get("w")!;
    const record = Array.from(state.records.array.slice(w.id * 8, w.id * 8 + 8));
    expect(record.slice(0, 3)).toEqual([32, 64, 96]);
    // The sphere in blocks: centred on the section's middle, not shrunk by
    // the quantized units.
    expect(record[4]).toBeCloseTo(40);
    expect(record[6]).toBeCloseTo(104);
    expect(record[7]).toBeGreaterThan(10);
  });

  it("keeps a section's reveal and visibility through a remesh in place", () => {
    const bucket = make();
    const state = bucket as unknown as Internals;
    bucket.setSectionGeometry("a", section(8), 0, 0, 0);
    bucket.setSectionReveal("a", 0.25);
    bucket.setSectionVisible("a", false);
    bucket.setSectionGeometry("a", section(8, 1), 0, 0, 0);
    const a = state.slots.get("a")!;
    expect(state.records.array[a.id * 8 + 3]).toBe(0.25);
    expect(state.flags.array[a.id * 4 + 2]).toBe(0);
  });

  it("gives a cleared slot to the next section of its size, drawn afresh", () => {
    const bucket = make();
    const state = bucket as unknown as Internals;
    bucket.setSectionGeometry("a", section(8), 0, 0, 0);
    const a = state.slots.get("a")!;
    bucket.setSectionReveal("a", 0.5);
    bucket.clearSection("a");
    expect(state.flags.array[a.id * 4 + 3]).toBe(0);
    bucket.setSectionGeometry("b", section(8), 0, 0, 0);
    const b = state.slots.get("b")!;
    expect(b.id).toBe(a.id);
    expect(b.vertexStart).toBe(a.vertexStart);
    expect(state.records.array[b.id * 8 + 3]).toBe(1);
    expect(state.flags.array[b.id * 4 + 3]).toBe(1);
  });

  it("grows past its room, keeping every section it held", () => {
    const bucket = new GpuTerrainBucket(new MeshBasicNodeMaterial(), {
      vertexCapacity: 1024,
      sectionCapacity: 64,
      positionUnits: UNITS,
    });
    const state = bucket as unknown as Internals;
    const before = bucket.mesh.geometry;
    for (let i = 0; i < 6; i++) {
      bucket.setSectionGeometry(`s${i}`, section(256), i * 16, 0, 0);
    }
    expect(bucket.mesh.geometry).not.toBe(before);
    expect(bucket.stats.vertexCapacity).toBeGreaterThan(1024);
    // Bounds come with the geometry, so three never scans its vertices for
    // them (a 200 ms frame on a bucket of millions).
    expect(bucket.mesh.geometry.boundingSphere?.radius).toBe(Infinity);
    expect(bucket.mesh.geometry.boundingBox?.max.x).toBe(Infinity);
    for (let i = 0; i < 6; i++) {
      const slot = state.slots.get(`s${i}`)!;
      expect(state.sectionIds.array[slot.vertexStart]).toBe(slot.id);
      expect(state.attributes.get("light")!.array[slot.vertexStart]).toBe(7);
      expect(state.sourceIndex.array[slot.indexStart]).toBe(slot.vertexStart);
    }
  });

  it("takes a freed slot's id when the records are full", () => {
    const bucket = new GpuTerrainBucket(new MeshBasicNodeMaterial(), {
      vertexCapacity: 1 << 14,
      sectionCapacity: 2,
      positionUnits: UNITS,
    });
    const state = bucket as unknown as Internals;
    bucket.setSectionGeometry("a", section(8), 0, 0, 0);
    bucket.setSectionGeometry("b", section(8), 0, 0, 0);
    const a = state.slots.get("a")!;
    bucket.clearSection("a");
    // Too large for a's freed slot: a new range under a's id.
    bucket.setSectionGeometry("c", section(1024), 0, 0, 0);
    const c = state.slots.get("c")!;
    expect(c.id).toBe(a.id);
    expect(c.vertexStart).not.toBe(a.vertexStart);
  });

  it("clears a chunk's every level through the arenas surface", () => {
    const arenas = new GpuTerrainArenas(make());
    arenas.setSectionGeometry(1, 2, 0, section(8), 0, 0, 0);
    arenas.setSectionGeometry(1, 2, 3, section(8), 0, 0, 0);
    arenas.setSectionGeometry(4, 2, 0, section(8), 0, 0, 0);
    arenas.clearChunk(1, 2);
    expect(arenas.bucket.hasSection("1,2,0")).toBe(false);
    expect(arenas.bucket.hasSection("1,2,3")).toBe(false);
    expect(arenas.bucket.hasSection("4,2,0")).toBe(true);
    expect(arenas.stats.sections).toBe(1);
  });
  describe("culls", () => {
    /** A renderer that records each compute submission's kernels. */
    const recorder = () => {
      const submissions: unknown[][] = [];
      const renderer = {
        compute: (kernels: unknown) =>
          submissions.push(Array.isArray(kernels) ? [...kernels] : [kernels]),
        _attributes: { update: () => {} },
      };
      return { renderer: renderer as never, submissions };
    };
    const viewOf = (camera: PerspectiveCamera) =>
      new Matrix4().multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      );

    it("stays out of the passes until its kernels compile ahead", async () => {
      const bucket = make();
      let finish = () => {};
      const compiled: unknown[][] = [];
      const renderer = {
        compileComputeAsync: (kernels: unknown[]) => {
          compiled.push(kernels);
          return new Promise<void>((resolve) => (finish = resolve));
        },
        _attributes: { update: () => {} },
      } as never;
      const showing = bucket.compileBeforeShowing(renderer);
      expect(bucket.mesh.visible).toBe(false);
      // The main view's and the shadow views' cull, decide and pack.
      expect(compiled[0]).toHaveLength(6);
      finish();
      await showing;
      expect(bucket.mesh.visible).toBe(true);
    });

    it("culls a view once, again when the view or the sections change", () => {
      const bucket = make();
      bucket.setSectionGeometry("a", section(8), 0, 0, 0);
      const { renderer } = recorder();
      const camera = new PerspectiveCamera();
      camera.updateMatrixWorld();
      expect(bucket.prepareCull(renderer, camera, viewOf(camera))).not.toBeNull();
      // The same view: the packed list already holds it.
      expect(bucket.prepareCull(renderer, camera, viewOf(camera))).toBeNull();
      // A section hidden: the list changes.
      bucket.setSectionVisible("a", false);
      expect(bucket.prepareCull(renderer, camera, viewOf(camera))).not.toBeNull();
      // The camera turned.
      camera.rotation.y = 0.5;
      camera.updateMatrixWorld();
      expect(bucket.prepareCull(renderer, camera, viewOf(camera))).not.toBeNull();
      // A reveal shades, it does not change the list.
      bucket.setSectionReveal("a", 0.5);
      expect(bucket.prepareCull(renderer, camera, viewOf(camera))).toBeNull();
    });

    it("leaves the pack to the GPU when only the view moved", () => {
      const bucket = make();
      const forced = () =>
        (bucket as unknown as {
          views: { main: { isRepackForced: { value: number } } };
        }).views.main.isRepackForced.value;
      bucket.setSectionGeometry("a", section(8), 0, 0, 0);
      const { renderer } = recorder();
      const camera = new PerspectiveCamera();
      const other = new PerspectiveCamera();
      camera.updateMatrixWorld();
      other.updateMatrixWorld();
      bucket.prepareCull(renderer, camera, viewOf(camera));
      expect(forced()).toBe(1);
      // The same view drifted: the GPU packs only if a section's answer moved.
      camera.position.x = 0.001;
      camera.updateMatrixWorld();
      bucket.prepareCull(renderer, camera, viewOf(camera));
      expect(forced()).toBe(0);
      // Another view's list: whatever it finds is packed.
      bucket.prepareCull(renderer, other, viewOf(other));
      expect(forced()).toBe(1);
      camera.position.x = 0.002;
      camera.updateMatrixWorld();
      bucket.prepareCull(renderer, camera, viewOf(camera));
      expect(forced()).toBe(1);
      // Sections changed under the same view: packed afresh too.
      bucket.setSectionGeometry("b", section(8), 16, 0, 0);
      camera.position.x = 0.003;
      camera.updateMatrixWorld();
      bucket.prepareCull(renderer, camera, viewOf(camera));
      expect(forced()).toBe(1);
    });

    it("keeps the main view's list through a shadow view's cull", () => {
      const bucket = make();
      bucket.setSectionGeometry("a", section(8), 0, 0, 0);
      const { renderer } = recorder();
      const camera = new PerspectiveCamera();
      const sun = markShadowView(new OrthographicCamera(-50, 50, 50, -50, 1, 200));
      camera.updateMatrixWorld();
      sun.position.set(0, 100, 0);
      sun.lookAt(0, 0, 0);
      sun.updateMatrixWorld();
      const geometry = bucket.mesh.geometry;
      bucket.cullFor(renderer, camera);
      const mainList = geometry.index;
      bucket.cullFor(renderer, sun);
      // The cascade draws a list of its own.
      expect(geometry.index).not.toBe(mainList);
      bucket.cullFor(renderer, camera);
      expect(geometry.index).toBe(mainList);
      // And the main view's list still holds the main view: nothing to cull.
      expect(bucket.prepareCull(renderer, camera, viewOf(camera))).toBeNull();
    });

    it("culls a world's buckets in one submission a view", () => {
      const culls = new GpuTerrainCulls();
      const options = { vertexCapacity: 1 << 12, sectionCapacity: 8, positionUnits: UNITS, culls };
      const a = new GpuTerrainBucket(new MeshBasicNodeMaterial(), options);
      const b = new GpuTerrainBucket(new MeshBasicNodeMaterial(), options);
      new GpuTerrainBucket(new MeshBasicNodeMaterial(), options); // empty
      a.setSectionGeometry("a", section(8), 0, 0, 0);
      b.setSectionGeometry("b", section(8), 0, 0, 0);
      const { renderer, submissions } = recorder();
      const camera = new PerspectiveCamera();
      camera.updateMatrixWorld();
      a.cullFor(renderer, camera);
      // b's draw in the same view finds its cull done.
      b.cullFor(renderer, camera);
      expect(submissions.length).toBe(1);
      // Each bucket's cull, decide and pack.
      expect(submissions[0].length).toBe(6);
      // Only the bucket that changed is culled again.
      b.setSectionVisible("b", false);
      a.cullFor(renderer, camera);
      expect(submissions.length).toBe(2);
      expect(submissions[1].length).toBe(3);
      b.dispose();
      b.setSectionVisible("b", true);
      a.cullFor(renderer, camera);
      expect(submissions.length).toBe(2);
    });
  });
});
