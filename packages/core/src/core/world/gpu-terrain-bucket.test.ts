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
  geometry.setAttribute(
    "uv",
    new BufferAttribute(new Uint16Array(vertices * 2), 2, true),
  );
  geometry.setAttribute(
    "light",
    new BufferAttribute(new Int32Array(vertices).fill(7), 1),
  );
  geometry.setAttribute(
    "lightTwist",
    new BufferAttribute(new Uint8Array(vertices * 4), 4),
  );
  geometry.setAttribute(
    "normal",
    new BufferAttribute(new Int8Array(vertices * 4), 4, true),
  );
  const indices = new Uint32Array((vertices / 4) * 6);
  for (let q = 0; q < vertices / 4; q++) {
    indices.set(
      [0, 1, 2, 2, 1, 3].map((i) => i + q * 4),
      q * 6,
    );
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
    const record = Array.from(
      state.records.array.slice(b.id * 8, b.id * 8 + 8),
    );
    expect(record.slice(0, 4)).toEqual([
      16 - POSITION_BLOCK_BIAS,
      32 - POSITION_BLOCK_BIAS,
      48 - POSITION_BLOCK_BIAS,
      1,
    ]);
    expect(record[7]).toBeGreaterThan(0);
    // Its indices, shown and live (bits 1 | 2), first stamped.
    expect(Array.from(state.flags.array.slice(b.id * 4, b.id * 4 + 4))).toEqual(
      [b.indexStart, 12, 3, 1],
    );
  });

  it("places a float-position section (water) at its corner, unscaled", () => {
    const bucket = make();
    const state = bucket as unknown as Internals;
    const water = new BufferGeometry();
    water.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([0, 0, 0, 16, 1, 16, 16, 1, 0, 0, 1, 16]),
        3,
      ),
    );
    water.setAttribute("light", new BufferAttribute(new Int32Array(4), 1));
    water.setIndex(new BufferAttribute(new Uint32Array([0, 1, 2, 2, 1, 3]), 1));
    bucket.setSectionGeometry("w", water, 32, 64, 96);
    const w = state.slots.get("w")!;
    const record = Array.from(
      state.records.array.slice(w.id * 8, w.id * 8 + 8),
    );
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
    // Live, not shown.
    expect(state.flags.array[a.id * 4 + 2]).toBe(2);
  });

  it("gives a cleared slot to the next section of its size, drawn afresh", () => {
    const bucket = make();
    const state = bucket as unknown as Internals;
    bucket.setSectionGeometry("a", section(8), 0, 0, 0);
    const a = state.slots.get("a")!;
    bucket.setSectionReveal("a", 0.5);
    bucket.clearSection("a");
    expect(state.flags.array[a.id * 4 + 2] & 2).toBe(0);
    bucket.setSectionGeometry("b", section(8), 0, 0, 0);
    const b = state.slots.get("b")!;
    expect(b.id).toBe(a.id);
    expect(b.vertexStart).toBe(a.vertexStart);
    expect(state.records.array[b.id * 8 + 3]).toBe(1);
    expect(state.flags.array[b.id * 4 + 2]).toBe(3);
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

  it("grows into a size made and compiled ahead, keeping its sections", async () => {
    const bucket = new GpuTerrainBucket(new MeshBasicNodeMaterial(), {
      vertexCapacity: 1024,
      sectionCapacity: 64,
      positionUnits: UNITS,
    });
    const compiled: unknown[][] = [];
    const renderer = {
      compileComputeAsync: async (kernels: unknown[]) => {
        compiled.push(kernels);
      },
      _attributes: { update: () => {} },
    } as never;
    await bucket.compileCulls(renderer);
    const state = bucket as unknown as Internals & {
      views: { main: { kernels: unknown; packed: unknown } };
      nextGrowth: {
        views: Map<unknown, { kernels: unknown; packed: unknown }>;
      } | null;
    };
    // A 128-vertex section takes a 256-vertex slot. Three quarters full:
    // the next size is made and its culls compiled.
    for (let i = 0; i < 3; i++) {
      bucket.setSectionGeometry(`s${i}`, section(128), i * 16, 0, 0);
    }
    expect(state.nextGrowth).not.toBeNull();
    expect(compiled).toHaveLength(2);
    const ahead = state.nextGrowth!.views.get(state.views.main)!;
    // Its pipelines land.
    await new Promise((resolve) => setTimeout(resolve));
    // The grow takes it: no cull is built on the frame that dispatches it.
    bucket.setSectionGeometry("s3", section(128), 48, 0, 0);
    bucket.setSectionGeometry("s4", section(128), 64, 0, 0);
    expect(bucket.stats.vertexCapacity).toBe(2048);
    expect(state.views.main.kernels).toBe(ahead.kernels);
    expect(state.views.main.packed).toBe(ahead.packed);
    for (let i = 0; i < 5; i++) {
      const slot = state.slots.get(`s${i}`)!;
      expect(state.sourceIndex.array[slot.indexStart]).toBe(slot.vertexStart);
    }
    // The ahead buffer is already on the GPU, so three uploads only its
    // update ranges: they must cover every section held before the grow,
    // not just the one written after it.
    const ranges = (
      state.sourceIndex as BufferAttribute & {
        updateRanges: { start: number; count: number }[];
      }
    ).updateRanges;
    const covered = (index: number) =>
      ranges.some((r) => index >= r.start && index < r.start + r.count);
    for (let i = 0; i < 5; i++) {
      const slot = state.slots.get(`s${i}`)!;
      expect(covered(slot.indexStart)).toBe(true);
    }
  });

  it("holds no array for a buffer only the GPU fills, made at its full length", async () => {
    const bucket = new GpuTerrainBucket(new MeshBasicNodeMaterial(), {
      vertexCapacity: 1024,
      sectionCapacity: 64,
      positionUnits: UNITS,
    });
    // What three makes each GPU buffer from: its type, and the array's
    // length at that moment (the buffer's size).
    const made = new Map<unknown, { type: number; length: number }>();
    const renderer = {
      compileComputeAsync: async () => {},
      _attributes: {
        update: (attribute: BufferAttribute, type: number) => {
          if (made.has(attribute)) return;
          made.set(attribute, { type, length: attribute.array.length });
        },
      },
    } as never;
    type View = { packed: BufferAttribute };
    const state = bucket as unknown as Internals & {
      views: { main: View; shadow: View };
      nextGrowth: {
        sourceIndex: BufferAttribute;
        views: Map<View, View>;
      } | null;
    };
    const INDEX = 2;
    const STORAGE = 3;
    const onGpuAlone = (
      attribute: BufferAttribute,
      type: number,
      count: number,
    ) => {
      expect(made.get(attribute)).toEqual({ type, length: count });
      expect(attribute.count).toBe(count);
      expect(attribute.array).toHaveLength(0);
      // The backend reads a list's index format off its array's type.
      expect(attribute.array).toBeInstanceOf(Uint32Array);
    };

    await bucket.compileCulls(renderer);
    onGpuAlone(state.views.main.packed, INDEX, 1536);
    onGpuAlone(state.views.shadow.packed, INDEX, 1536);

    // Three quarters full: the next size is made ahead, on the GPU alone.
    for (let i = 0; i < 3; i++) {
      bucket.setSectionGeometry(`s${i}`, section(128), i * 16, 0, 0);
    }
    const ahead = state.nextGrowth!;
    onGpuAlone(ahead.sourceIndex, STORAGE, 3072);
    onGpuAlone(ahead.views.get(state.views.main)!.packed, INDEX, 3072);
    onGpuAlone(ahead.views.get(state.views.shadow)!.packed, INDEX, 3072);

    // The grow takes them: the indices get their array, the lists none.
    await new Promise((resolve) => setTimeout(resolve));
    bucket.setSectionGeometry("s3", section(128), 48, 0, 0);
    bucket.setSectionGeometry("s4", section(128), 64, 0, 0);
    expect(state.sourceIndex).toBe(ahead.sourceIndex);
    expect(state.sourceIndex.array).toHaveLength(3072);
    for (let i = 0; i < 5; i++) {
      const slot = state.slots.get(`s${i}`)!;
      expect(state.sourceIndex.array[slot.indexStart]).toBe(slot.vertexStart);
    }
    onGpuAlone(state.views.main.packed, INDEX, 3072);
    onGpuAlone(state.views.shadow.packed, INDEX, 3072);
  });

  it("lays out a bucket with no sections as another's, for its pipelines", () => {
    const source = make();
    source.setSectionGeometry("a", section(8), 0, 0, 0);
    const empty = make();
    expect(empty.hasLayout).toBe(false);
    empty.adoptLayout(source.mesh.geometry);
    expect(empty.hasLayout).toBe(true);
    const from = source.mesh.geometry.attributes;
    const to = empty.mesh.geometry.attributes;
    for (const name of Object.keys(from)) {
      expect(to[name].array.constructor).toBe(from[name].array.constructor);
      expect(to[name].itemSize).toBe(from[name].itemSize);
      expect(to[name].normalized).toBe(from[name].normalized);
    }
    // Its own first section then fits the layout it already has.
    empty.setSectionGeometry("b", section(8), 0, 0, 0);
    expect(empty.mesh.geometry.attributes.light.array[0]).toBe(7);
  });

  it("stamps a section each time its indices are written", () => {
    const bucket = make();
    const stamp = () => (bucket as unknown as Internals).flags.array[3];
    bucket.setSectionGeometry("a", section(8), 0, 0, 0);
    expect(stamp()).toBe(1);
    // A remesh in place: the views' copies of it are stale.
    bucket.setSectionGeometry("a", section(8), 0, 0, 0);
    expect(stamp()).toBe(2);
    // A reveal or a visibility change moves no indices.
    bucket.setSectionReveal("a", 0.5);
    bucket.setSectionVisible("a", false);
    expect(stamp()).toBe(2);
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
  describe("on the GPU", () => {
    type Buffer = { label: string; size: number; usage: number };
    type Ranged = BufferAttribute & {
      updateRanges: { start: number; count: number }[];
    };
    const VERTEX = 1;
    const INDEX = 2;
    const STORAGE = 3;

    /**
     * A stand-in for three on WebGPU: buffers as plain records, three's
     * make-or-upload rule for an attribute, and every device call in order.
     */
    const gpu = () => {
      const records = new WeakMap<object, { buffer?: Buffer }>();
      const versions = new WeakMap<object, number>();
      /** Buffers three made its own way: mapped, the whole array copied in. */
      const copiedIn = new Set<Buffer>();
      const events: (
        | { kind: "upload"; attribute: Ranged; ranges: Ranged["updateRanges"] }
        | { kind: "copy"; source: Buffer; target: Buffer; size: number }
      )[] = [];
      const backend = {
        isWebGPUBackend: true,
        device: {
          createBuffer: (descriptor: Buffer): Buffer => ({ ...descriptor }),
          createCommandEncoder: () => {
            const queued: (typeof events)[number][] = [];
            return {
              copyBufferToBuffer: (
                source: Buffer,
                _from: number,
                target: Buffer,
                _to: number,
                size: number,
              ) => queued.push({ kind: "copy", source, target, size }),
              finish: () => queued,
            };
          },
          queue: {
            submit: (commands: (typeof events)[]) =>
              events.push(...commands.flat()),
          },
        },
        get: (attribute: object) => {
          let record = records.get(attribute);
          if (!record) records.set(attribute, (record = {}));
          return record;
        },
      };
      const update = (attribute: Ranged) => {
        const record = backend.get(attribute);
        if (!versions.has(attribute)) {
          if (!record.buffer) {
            record.buffer = {
              label: attribute.name,
              size: attribute.array.byteLength,
              usage: 0,
            };
            copiedIn.add(record.buffer);
          }
        } else if (versions.get(attribute)! < attribute.version) {
          events.push({
            kind: "upload",
            attribute,
            ranges: attribute.updateRanges.map((range) => ({ ...range })),
          });
          attribute.clearUpdateRanges();
        }
        versions.set(attribute, attribute.version);
      };
      const renderer = {
        backend,
        compileComputeAsync: async () => {},
        _attributes: { update },
      } as never;
      return { renderer, backend, events, copiedIn, update };
    };

    type State = Internals & {
      views: { main: { packed: BufferAttribute } };
      nextGrowth: { sourceIndex: BufferAttribute } | null;
    };

    const small = () =>
      new GpuTerrainBucket(new MeshBasicNodeMaterial(), {
        vertexCapacity: 1024,
        sectionCapacity: 64,
        positionUnits: UNITS,
      });

    /** What a frame that draws the bucket does to its buffers. */
    const draw = (
      bucket: GpuTerrainBucket,
      update: (attribute: Ranged) => void,
    ) => {
      const state = bucket as unknown as State;
      for (const attribute of Object.values(bucket.mesh.geometry.attributes)) {
        update(attribute as Ranged);
      }
      update(state.sourceIndex as Ranged);
    };

    it("makes a list only the GPU fills as an empty buffer, copying nothing in", async () => {
      const bucket = small();
      const { renderer, backend, copiedIn } = gpu();
      await bucket.compileCulls(renderer);
      const packed = (bucket as unknown as State).views.main.packed;
      const buffer = backend.get(packed).buffer!;
      // Its full length, as an index a cull can also write (index, storage,
      // copy source and target).
      expect(buffer.size).toBe(1536 * 4);
      expect(buffer.usage).toBe(0x10 | 0x80 | 0x4 | 0x8);
      expect(copiedIn.has(buffer)).toBe(false);
      expect(packed.array).toHaveLength(0);
    });

    it("carries what it holds to the larger buffers there, uploading only what is new", async () => {
      const bucket = small();
      const state = bucket as unknown as State;
      const { renderer, backend, events, copiedIn, update } = gpu();
      await bucket.compileCulls(renderer);
      // Three quarters full: the next size's indices are made ahead, empty.
      for (let i = 0; i < 3; i++) {
        bucket.setSectionGeometry(`s${i}`, section(128), i * 16, 0, 0);
      }
      const ahead = state.nextGrowth!.sourceIndex;
      expect(copiedIn.has(backend.get(ahead).buffer!)).toBe(false);
      draw(bucket, update);
      await new Promise((resolve) => setTimeout(resolve));
      const light = state.attributes.get("light")!;
      const heldBytes = backend.get(light).buffer!.size;
      // The last section the old buffers fit, still waiting for its upload
      // when the next one grows the bucket.
      bucket.setSectionGeometry("s3", section(128), 48, 0, 0);
      events.length = 0;
      bucket.setSectionGeometry("s4", section(128), 64, 0, 0);
      expect(bucket.stats.vertexCapacity).toBe(2048);

      // What waited goes up before anything is copied.
      const firstCopy = events.findIndex((event) => event.kind === "copy");
      const waiting = events
        .slice(0, firstCopy)
        .filter((event) => event.kind === "upload");
      expect(waiting.some((event) => event.attribute === light)).toBe(true);
      expect(events.slice(firstCopy).every((e) => e.kind === "copy")).toBe(
        true,
      );

      // Every vertex attribute, the section ids and the indices: the whole
      // old buffer into the start of one twice its size (the indices' was
      // made ahead).
      const copies = events.filter((event) => event.kind === "copy");
      expect(copies).toHaveLength(7);
      const grown = state.attributes.get("light")!;
      const lightCopy = copies.find(
        (copy) => copy.target === backend.get(grown).buffer,
      )!;
      expect(lightCopy.size).toBe(heldBytes);
      expect(lightCopy.target.size).toBe(heldBytes * 2);
      expect(copiedIn.has(lightCopy.target)).toBe(false);
      expect(state.sourceIndex).toBe(ahead);
      expect(
        copies.some((copy) => copy.target === backend.get(ahead).buffer),
      ).toBe(true);

      // The arrays hold only what is still to upload: the section written
      // after the grow, and nothing of the sections the copy carried.
      const s0 = state.slots.get("s0")!;
      const s4 = state.slots.get("s4")!;
      expect(grown.array[s0.vertexStart]).toBe(0);
      expect(grown.array[s4.vertexStart]).toBe(7);
      expect(state.sourceIndex.array[s0.indexStart + 1]).toBe(0);
      expect(state.sourceIndex.array[s4.indexStart]).toBe(s4.vertexStart);
      for (const attribute of [grown, state.sourceIndex] as Ranged[]) {
        const start = attribute === grown ? s4.vertexStart : s4.indexStart;
        expect(attribute.updateRanges).toHaveLength(1);
        expect(attribute.updateRanges[0].start).toBe(start);
      }

      // The frame after uploads those ranges and makes no buffer from an
      // array.
      events.length = 0;
      draw(bucket, update);
      expect(
        events.every((event) => event.kind === "upload" && event.ranges.length),
      ).toBe(true);
      expect(copiedIn.has(backend.get(grown).buffer!)).toBe(false);
    });

    it("copies the array where an attribute has no buffer to carry", async () => {
      const bucket = small();
      const state = bucket as unknown as State;
      const { renderer, backend, events } = gpu();
      await bucket.compileCulls(renderer);
      // No frame has drawn the bucket: nothing it holds is on the GPU yet.
      for (let i = 0; i < 6; i++) {
        bucket.setSectionGeometry(`s${i}`, section(128), i * 16, 0, 0);
      }
      expect(bucket.stats.vertexCapacity).toBe(2048);
      const light = state.attributes.get("light")!;
      expect(backend.get(light).buffer).toBeUndefined();
      expect(
        events.some(
          (event) =>
            event.kind === "copy" && event.target === backend.get(light).buffer,
        ),
      ).toBe(false);
      for (let i = 0; i < 6; i++) {
        const slot = state.slots.get(`s${i}`)!;
        expect(light.array[slot.vertexStart]).toBe(7);
        expect(state.sectionIds.array[slot.vertexStart]).toBe(slot.id);
        expect(state.sourceIndex.array[slot.indexStart]).toBe(slot.vertexStart);
      }
    });
  });

  describe("culls", () => {
    /** A renderer that records each compute submission's kernels. */
    const recorder = () => {
      const submissions: unknown[][] = [];
      const renderer = {
        compute: (kernels: unknown) =>
          submissions.push(Array.isArray(kernels) ? [...kernels] : [kernels]),
        compileComputeAsync: async () => {},
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
      // The main view's and the shadow views' cull, decide, pack and finish.
      expect(compiled[0]).toHaveLength(8);
      finish();
      await showing;
      expect(bucket.mesh.visible).toBe(true);
    });

    /**
     * Three's own contract, kept by a stand-in: a kernel whose pipeline
     * `compileComputeAsync` is still building has none to bind, and the
     * backend throws on its dispatch (inside a frame's draw, which the
     * renderer does not recover from).
     */
    const compilingRenderer = () => {
      const building = new Set<unknown>();
      const landings: (() => void)[] = [];
      const submissions: unknown[][] = [];
      const renderer = {
        compute: (kernels: unknown) => {
          const list = Array.isArray(kernels) ? [...kernels] : [kernels];
          for (const kernel of list) {
            if (building.has(kernel)) {
              throw new TypeError("setPipeline: not a GPUComputePipeline");
            }
          }
          submissions.push(list);
        },
        compileComputeAsync: (kernels: unknown[]) => {
          for (const kernel of kernels) building.add(kernel);
          return new Promise<void>((resolve) => {
            landings.push(() => {
              for (const kernel of kernels) building.delete(kernel);
              resolve();
            });
          });
        },
        _attributes: { update: () => {} },
      };
      /** Every compile asked for so far lands. */
      const land = async () => {
        for (const landing of landings.splice(0)) landing();
        await new Promise((resolve) => setTimeout(resolve));
      };
      return { renderer: renderer as never, submissions, land };
    };

    it("dispatches no cull whose pipelines are still compiling ahead", async () => {
      const culls = new GpuTerrainCulls();
      const bucket = new GpuTerrainBucket(new MeshBasicNodeMaterial(), {
        vertexCapacity: 1 << 12,
        sectionCapacity: 8,
        positionUnits: UNITS,
        culls,
      });
      const { renderer, submissions, land } = compilingRenderer();
      const camera = new PerspectiveCamera();
      camera.updateMatrixWorld();
      // A load: the bucket's culls compile while its first sections land
      // and frames draw it under the overlay.
      const compiling = bucket.compileCulls(renderer);
      bucket.setSectionGeometry("a", section(8), 0, 0, 0);
      bucket.cullFor(renderer, camera);
      // A stand-in asks for a hidden bucket's cull the same way.
      bucket.mesh.visible = false;
      bucket.cullFor(renderer, camera);
      bucket.mesh.visible = true;
      expect(submissions).toHaveLength(0);
      await land();
      await compiling;
      // The first frame after they land culls the view it skipped.
      bucket.cullFor(renderer, camera);
      expect(submissions).toHaveLength(1);
      expect(submissions[0]).toHaveLength(4);
    });

    it("keeps culling a view a frame built while it compiles ahead again", async () => {
      const bucket = make();
      bucket.setSectionGeometry("a", section(8), 0, 0, 0);
      const { renderer, submissions, land } = compilingRenderer();
      const camera = new PerspectiveCamera();
      camera.updateMatrixWorld();
      // Built by its first dispatch: its pipelines exist.
      bucket.cullFor(renderer, camera);
      expect(submissions).toHaveLength(1);
      const compiling = bucket.compileCulls(renderer);
      // A real renderer finds the main view's pipelines made; only the
      // stand-in's bookkeeping says otherwise, so settle it for that view.
      bucket.setSectionVisible("a", false);
      expect(
        bucket.prepareCull(renderer, camera, viewOf(camera)),
      ).not.toBeNull();
      await land();
      await compiling;
    });

    it("builds a grown view's cull afresh when the grow outruns its compile", async () => {
      const bucket = new GpuTerrainBucket(new MeshBasicNodeMaterial(), {
        vertexCapacity: 1024,
        sectionCapacity: 64,
        positionUnits: UNITS,
      });
      const { renderer, submissions, land } = compilingRenderer();
      const camera = new PerspectiveCamera();
      camera.updateMatrixWorld();
      const state = bucket as unknown as {
        views: { main: { kernels: unknown; packed: unknown } };
        nextGrowth: {
          views: Map<unknown, { kernels: unknown; packed: unknown }>;
        } | null;
      };
      bucket.setSectionGeometry("s0", section(128), 0, 0, 0);
      bucket.cullFor(renderer, camera);
      // Three quarters full: the next size is made, its culls compiling.
      bucket.setSectionGeometry("s1", section(128), 16, 0, 0);
      bucket.setSectionGeometry("s2", section(128), 32, 0, 0);
      const ahead = state.nextGrowth?.views.get(state.views.main);
      expect(ahead).toBeDefined();
      // Chunks keep streaming in: the bucket fills before they land.
      bucket.setSectionGeometry("s3", section(128), 48, 0, 0);
      bucket.setSectionGeometry("s4", section(128), 64, 0, 0);
      expect(bucket.stats.vertexCapacity).toBe(2048);
      // The buffers made ahead are taken; the cull still compiling is not.
      expect(state.views.main.packed).toBe(ahead?.packed);
      bucket.cullFor(renderer, camera);
      expect(state.views.main.kernels).not.toBe(ahead?.kernels);
      expect(submissions).toHaveLength(2);
      expect(submissions[1]).toHaveLength(4);
      await land();
    });

    it("drops a cull whose compile ahead failed for one built on first use", async () => {
      const bucket = make();
      bucket.setSectionGeometry("a", section(8), 0, 0, 0);
      const submissions: unknown[][] = [];
      const renderer = {
        compute: (kernels: unknown[]) => submissions.push([...kernels]),
        compileComputeAsync: () => Promise.reject(new Error("no device")),
        _attributes: { update: () => {} },
      } as never;
      const state = bucket as unknown as {
        views: { main: { kernels: unknown } };
      };
      await expect(bucket.compileCulls(renderer)).rejects.toThrow("no device");
      const failed = state.views.main.kernels;
      const camera = new PerspectiveCamera();
      camera.updateMatrixWorld();
      bucket.cullFor(renderer, camera);
      expect(state.views.main.kernels).not.toBe(failed);
      expect(submissions).toHaveLength(1);
    });

    it("also waits for the host's own draws before it shows", async () => {
      const bucket = make();
      const renderer = {
        compileComputeAsync: async () => {},
        _attributes: { update: () => {} },
      } as never;
      let finishDraws = () => {};
      let drawsAsked = 0;
      const showing = bucket.compileBeforeShowing(renderer, () => {
        drawsAsked += 1;
        return new Promise<void>((resolve) => (finishDraws = resolve));
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(drawsAsked).toBe(1);
      expect(bucket.mesh.visible).toBe(false);
      finishDraws();
      await showing;
      expect(bucket.mesh.visible).toBe(true);
    });

    it("culls a view once, again when the view or the sections change", () => {
      const bucket = make();
      bucket.setSectionGeometry("a", section(8), 0, 0, 0);
      const { renderer } = recorder();
      const camera = new PerspectiveCamera();
      camera.updateMatrixWorld();
      expect(
        bucket.prepareCull(renderer, camera, viewOf(camera)),
      ).not.toBeNull();
      // The same view: the packed list already holds it.
      expect(bucket.prepareCull(renderer, camera, viewOf(camera))).toBeNull();
      // A section hidden: the list changes.
      bucket.setSectionVisible("a", false);
      expect(
        bucket.prepareCull(renderer, camera, viewOf(camera)),
      ).not.toBeNull();
      // The camera turned.
      camera.rotation.y = 0.5;
      camera.updateMatrixWorld();
      expect(
        bucket.prepareCull(renderer, camera, viewOf(camera)),
      ).not.toBeNull();
      // A reveal shades, it does not change the list.
      bucket.setSectionReveal("a", 0.5);
      expect(bucket.prepareCull(renderer, camera, viewOf(camera))).toBeNull();
    });

    it("repacks whole only for another camera's list or new buffers", () => {
      const bucket = make();
      const forced = () =>
        (
          bucket as unknown as {
            views: { main: { isRepackForced: { value: number } } };
          }
        ).views.main.isRepackForced.value;
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
      // Sections changed under the same view: culled again, and the GPU
      // patches the list where a copy must change (an append, a hole).
      bucket.setSectionGeometry("b", section(8), 16, 0, 0);
      expect(
        bucket.prepareCull(renderer, camera, viewOf(camera)),
      ).not.toBeNull();
      expect(forced()).toBe(0);
      // New buffers (a grow): the list is repacked whole.
      for (let i = 0; i < 40; i++) {
        bucket.setSectionGeometry(`g${i}`, section(256), i * 16, 0, 16);
      }
      bucket.prepareCull(renderer, camera, viewOf(camera));
      expect(forced()).toBe(1);
    });

    it("keeps the main view's list through a shadow view's cull", () => {
      const bucket = make();
      bucket.setSectionGeometry("a", section(8), 0, 0, 0);
      const { renderer } = recorder();
      const camera = new PerspectiveCamera();
      const sun = markShadowView(
        new OrthographicCamera(-50, 50, 50, -50, 1, 200),
      );
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
      const options = {
        vertexCapacity: 1 << 12,
        sectionCapacity: 8,
        positionUnits: UNITS,
        culls,
      };
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
      // Each bucket's cull, decide, pack and finish.
      expect(submissions[0].length).toBe(8);
      // Only the bucket that changed is culled again.
      b.setSectionVisible("b", false);
      a.cullFor(renderer, camera);
      expect(submissions.length).toBe(2);
      expect(submissions[1].length).toBe(4);
      b.dispose();
      b.setSectionVisible("b", true);
      a.cullFor(renderer, camera);
      expect(submissions.length).toBe(2);
    });
  });
});
