/**
 * One chunk material bucket drawn from the GPU: every section of the
 * bucket in one vertex buffer, culled and packed by a compute pass for each
 * camera that draws it, and drawn with one indirect call.
 *
 * Region-arena pages (`chunk-region-arenas.ts`) cull their sections on the
 * CPU for every pass and draw each visible one with its own call; with a
 * hundred pages a frame across the main view and the sun's cascades that
 * per-draw work was most of a WebGPU frame's render CPU. Here the CPU only
 * writes a section's own vertices when it lands and dispatches one cull per
 * pass; the GPU tests each section's sphere against the pass's frustum and
 * copies the visible sections' indices into the pass's index buffer, whose
 * length the indirect draw reads.
 *
 * WebGPU without `multi-draw-indirect` draws one index range per call, so
 * the visible sections are packed into one range rather than drawn by
 * per-section indirect calls (one JS call each, the cost this removes).
 * Passes reuse one packed buffer: each cull is submitted before the draw it
 * feeds and after the draw before it.
 *
 * The vertex stage finds a vertex's section by its `sectionId` attribute and
 * reads the section's origin and reveal from `records`
 * (`GpuTerrainSections`, used by the chunk material).
 */

import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  type ComputeNode,
  Frustum,
  IndirectStorageBufferAttribute,
  Matrix4,
  Mesh,
  type Material,
  type Renderer,
  Sphere,
  StorageBufferAttribute,
  Vector4,
} from "three/webgpu";
import {
  atomicAdd,
  atomicLoad,
  atomicStore,
  dot,
  Fn,
  If,
  instanceIndex,
  localId,
  Loop,
  select,
  storage,
  uint,
  uniform,
  uniformArray,
  vec3,
  workgroupArray,
  workgroupBarrier,
  workgroupId,
} from "three/tsl";

import { setSectionBounds } from "./chunk-region-arenas";
import { isShadowView } from "./shadow-casters";
import type { Vec4Node } from "./shading/types";
import { POSITION_BLOCK_BIAS } from "./vertex-quantization";

/** three's `AttributeType.INDEX` (not exported). */
const INDEX_ATTRIBUTE = 2;

/** The attributes a merged section carries, as `mergeSectionGeometries` lays them. */
const SECTION_ATTRIBUTES = [
  "position",
  "uv",
  "light",
  "lightTwist",
  "normal",
  "biomeTint",
] as const;

/** Slots are reserved in steps of this many vertices. */
const SLOT_STEP = 256;
/** Room a new slot leaves for a remesh to grow into. */
const SLOT_SLACK = 1.1;
/** How much larger than needed a freed slot a section may take. */
const REUSE_SLACK = 1.3;
/** Indices a slot reserves per vertex it reserves (quads: 6 per 4). */
const INDEX_PER_VERTEX = 1.5;
/** Threads per workgroup of the cull. */
const WORKGROUP = 64;

const slotSize = (vertices: number) =>
  Math.ceil((vertices * SLOT_SLACK) / SLOT_STEP) * SLOT_STEP;

type Slot = {
  id: number;
  vertexStart: number;
  /** Vertices reserved (a multiple of `SLOT_STEP`). */
  capacity: number;
  indexStart: number;
  indexCount: number;
};

/** What the chunk material reads a GPU-drawn section by. */
export type GpuTerrainSections = {
  /** Per section: (origin x, y, z, reveal), then (sphere centre, radius). */
  readonly records: { element(index: unknown): Vec4Node };
};

/**
 * A compute kernel sized by its own `dispatchSize`: a thread count, or an
 * indirect buffer (three takes either; its types know the first).
 */
type CullKernel = Omit<ComputeNode, "dispatchSize"> & {
  dispatchSize: number | IndirectStorageBufferAttribute | null;
};

const flagUniform = () => uniform(0, "uint");

/** One view's cull: its packed list and what the cull keeps for it. */
type CullView = {
  /** The visible sections' indices, packed; drawn as the index. */
  packed: StorageBufferAttribute;
  /** The indirect draw: the packed length, one instance. */
  readonly args: IndirectStorageBufferAttribute;
  /** Each section's visibility in the view the packed list holds. */
  readonly visibility: StorageBufferAttribute;
  /** Set by the cull when a section's visibility moved (atomic). */
  readonly changed: StorageBufferAttribute;
  /** The pack's workgroups: every section slot, or none when nothing moved. */
  readonly packDispatch: IndirectStorageBufferAttribute;
  readonly planes: ReturnType<typeof uniformArray>;
  /** 1: pack whatever the cull finds (the list is another camera's). */
  readonly isRepackForced: ReturnType<typeof flagUniform>;
  kernels: { cull: CullKernel; decide: CullKernel; pack: CullKernel } | null;
  isPackedIndexed: boolean;
  /** What the packed list was last culled for. */
  readonly culled: { camera: Camera | null; viewProjection: Matrix4; version: number };
};

const _frustum = new Frustum();
const _matrix = new Matrix4();
const _sphere = new Sphere();

export type GpuTerrainBucketOptions = {
  /** Vertices the bucket holds before it grows. */
  vertexCapacity: number;
  /** Sections the bucket holds before it grows. */
  sectionCapacity: number;
  /** Fixed-point counts per block of the positions. */
  positionUnits: number;
  /** Run before each pass's cull (the bucket's material following its base). */
  beforeDraw?: () => void;
  /** The world's buckets, culled together (one dispatch a view). */
  culls?: GpuTerrainCulls;
};

export class GpuTerrainBucket {
  readonly mesh: Mesh;
  readonly sections: GpuTerrainSections;

  private geometry = new BufferGeometry();
  private attributes = new Map<string, BufferAttribute>();
  private sectionIds: BufferAttribute;
  private sourceIndex: StorageBufferAttribute;
  private records: StorageBufferAttribute;
  private flags: StorageBufferAttribute;

  private readonly slots = new Map<string, Slot>();
  private readonly free = new Map<number, Slot[]>();
  private nextId = 0;
  private vertexEnd = 0;
  private indexEnd = 0;

  private readonly sectionCount = uniform(0, "uint");
  /**
   * The views this bucket is culled for, each with its own packed list: the
   * main one, and (made when one first casts) the shadow views'. Sharing one
   * list, a sun cascade drawn between two frames left the main view to
   * repack every index it shows on each of them.
   */
  private readonly views: { main: CullView; shadow: CullView | null };
  /**
   * Bumped by every change to what a cull reads (a section placed, shown,
   * hidden or freed, the buffers grown); a reveal moves only the shading.
   */
  private version = 0;

  constructor(
    material: Material,
    private readonly options: GpuTerrainBucketOptions,
  ) {
    const { vertexCapacity, sectionCapacity } = options;
    this.sectionIds = new BufferAttribute(new Uint32Array(vertexCapacity), 1);
    this.sourceIndex = new StorageBufferAttribute(
      new Uint32Array(Math.ceil(vertexCapacity * INDEX_PER_VERTEX)),
      1,
    );
    this.records = new StorageBufferAttribute(
      new Float32Array(sectionCapacity * 8),
      4,
    );
    this.flags = new StorageBufferAttribute(
      new Uint32Array(sectionCapacity * 4),
      4,
    );
    this.views = { main: this.makeView(), shadow: null };

    this.geometry.setAttribute("sectionId", this.sectionIds);
    this.show(this.views.main);

    this.sections = {
      records: storage(
        this.records,
        "vec4",
        sectionCapacity * 2,
      ).toReadOnly() as unknown as GpuTerrainSections["records"],
    };

    this.mesh = new Mesh(this.geometry, material);
    this.mesh.name = "gpu-terrain";
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.userData.gpuTerrain = this;
    // Drawn as a region arena's page is (one mesh for many sections, its
    // geometry swapped when it grows).
    this.mesh.userData.isChunkRegionArena = true;
    this.mesh.onBeforeRender = (renderer, _scene, camera) =>
      this.cullFor(renderer as unknown as Renderer, camera);
    options.culls?.add(this);
  }

  /** Sections and vertices held, for stats. */
  get stats() {
    return {
      sections: this.slots.size,
      vertices: this.vertexEnd,
      vertexCapacity: this.sectionIds.count,
    };
  }

  setSectionGeometry(
    key: string,
    geometry: BufferGeometry,
    x: number,
    y: number,
    z: number,
  ) {
    const vertexCount = geometry.getAttribute("position").count;
    const index = geometry.getIndex();
    if (vertexCount === 0 || !index || index.count === 0) {
      this.clearSection(key);
      return;
    }
    this.ensureAttributes(geometry);
    let slot = this.slots.get(key);
    if (
      slot &&
      (vertexCount > slot.capacity ||
        index.count > slot.capacity * INDEX_PER_VERTEX)
    ) {
      this.release(slot);
      this.slots.delete(key);
      slot = undefined;
    }
    const isFresh = !slot;
    if (!slot) {
      slot = this.allocate(vertexCount, index.count);
      this.slots.set(key, slot);
    }

    // Vertices, each tagged with its section.
    for (const name of SECTION_ATTRIBUTES) {
      const target = this.attributes.get(name);
      if (!target) continue;
      const source = geometry.getAttribute(name) as BufferAttribute | undefined;
      const start = slot.vertexStart * target.itemSize;
      const length = vertexCount * target.itemSize;
      if (source) {
        target.array.set(source.array as ArrayLike<number>, start);
      } else {
        target.array.fill(0, start, start + length);
      }
      target.addUpdateRange(start, length);
      target.needsUpdate = true;
    }
    this.sectionIds.array.fill(
      slot.id,
      slot.vertexStart,
      slot.vertexStart + vertexCount,
    );
    this.sectionIds.addUpdateRange(slot.vertexStart, vertexCount);
    this.sectionIds.needsUpdate = true;

    // Indices into the bucket's vertices.
    const indices = this.sourceIndex.array as Uint32Array;
    const source = index.array;
    for (let i = 0; i < index.count; i++) {
      indices[slot.indexStart + i] = source[i] + slot.vertexStart;
    }
    this.sourceIndex.addUpdateRange(slot.indexStart, index.count);
    this.sourceIndex.needsUpdate = true;
    slot.indexCount = index.count;

    // The record: origin (as the arenas' section transform), reveal kept,
    // and a sphere around the section's vertices.
    // As the arenas' section transform: quantized positions are fixed point
    // from a biased origin, float ones (the sorted transparents: water)
    // blocks from the section's corner.
    const isQuantized =
      geometry.getAttribute("position").array instanceof Uint16Array;
    const units = isQuantized ? this.options.positionUnits : 1;
    const bias = isQuantized ? POSITION_BLOCK_BIAS : 0;
    const records = this.records.array as Float32Array;
    const at = slot.id * 8;
    // A remesh in place keeps the section's reveal; a section new to its
    // slot starts drawn as itself.
    const reveal = isFresh ? 1 : records[at + 3];
    records[at] = x - bias;
    records[at + 1] = y - bias;
    records[at + 2] = z - bias;
    records[at + 3] = reveal;
    setSectionBounds(geometry);
    const box = geometry.boundingBox!;
    const half = box.max.clone().sub(box.min).multiplyScalar(0.5 / units);
    records[at + 4] = records[at] + (box.min.x + box.max.x) * 0.5 / units;
    records[at + 5] = records[at + 1] + (box.min.y + box.max.y) * 0.5 / units;
    records[at + 6] = records[at + 2] + (box.min.z + box.max.z) * 0.5 / units;
    records[at + 7] = half.length();
    this.records.addUpdateRange(at, 8);
    this.records.needsUpdate = true;

    const flags = this.flags.array as Uint32Array;
    flags[slot.id * 4] = slot.indexStart;
    flags[slot.id * 4 + 1] = index.count;
    if (flags[slot.id * 4 + 3] === 0) flags[slot.id * 4 + 2] = 1;
    flags[slot.id * 4 + 3] = 1;
    this.flags.addUpdateRange(slot.id * 4, 4);
    this.flags.needsUpdate = true;
    this.version += 1;
  }

  /** Whether a section draws (plants beyond their radius, held chunks). */
  setSectionVisible(key: string, isVisible: boolean) {
    const slot = this.slots.get(key);
    if (!slot) return;
    const flags = this.flags.array as Uint32Array;
    const value = isVisible ? 1 : 0;
    if (flags[slot.id * 4 + 2] === value) return;
    flags[slot.id * 4 + 2] = value;
    this.flags.addUpdateRange(slot.id * 4 + 2, 1);
    this.flags.needsUpdate = true;
    this.version += 1;
  }

  /** How much of a section shows through its fog tint, 0 to 1. */
  setSectionReveal(key: string, reveal: number) {
    const slot = this.slots.get(key);
    if (!slot) return false;
    const records = this.records.array as Float32Array;
    const value = Math.min(1, Math.max(0.0001, reveal));
    if (records[slot.id * 8 + 3] !== value) {
      records[slot.id * 8 + 3] = value;
      this.records.addUpdateRange(slot.id * 8 + 3, 1);
      this.records.needsUpdate = true;
    }
    return true;
  }

  clearSection(key: string) {
    const slot = this.slots.get(key);
    if (!slot) return;
    this.release(slot);
    this.slots.delete(key);
  }

  hasSection(key: string) {
    return this.slots.has(key);
  }

  dispose() {
    this.options.culls?.delete(this);
    this.geometry.dispose();
    this.slots.clear();
    this.free.clear();
  }

  /**
   * Culls and packs the sections for `camera`'s pass, before its draw (the
   * mesh's own `onBeforeRender`, or a stand-in that shares its geometry):
   * with the world's other buckets when it has {@link GpuTerrainCulls}.
   * The geometry then draws that view's packed list.
   */
  cullFor(renderer: Renderer, camera: Camera) {
    const { culls } = this.options;
    if (culls) {
      culls.cullFor(renderer, camera, this);
    } else {
      _matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      const kernels = this.prepareCull(renderer, camera, _matrix);
      if (kernels) renderer.compute(kernels as unknown as ComputeNode[]);
    }
    this.show(this.viewFor(camera));
  }

  /**
   * Readies this bucket's cull for a view (`viewProjection`, `camera`'s)
   * and returns its kernels, in order; null when the view's packed list
   * already holds that view of these sections (the main camera draws water
   * depth, the scene and the blended phases from one view), or there is
   * nothing to cull.
   */
  prepareCull(
    renderer: Renderer,
    camera: Camera,
    viewProjection: Matrix4,
  ): CullKernel[] | null {
    this.options.beforeDraw?.();
    if (this.nextId === 0) return null;
    const view = this.viewFor(camera);
    const culled = view.culled;
    if (
      culled.camera === camera &&
      culled.version === this.version &&
      culled.viewProjection.equals(viewProjection)
    ) {
      return null;
    }
    // Another camera's list, or sections changed: pack whatever the cull
    // finds. The same camera moved a little: pack only if a section's
    // visibility moved with it (the GPU decides, and dispatches no pack
    // when none did: the camera drifts every frame, and repacking millions
    // of unchanged indices each time was the frame at a dense field).
    view.isRepackForced.value =
      culled.camera !== camera || culled.version !== this.version ? 1 : 0;
    culled.camera = camera;
    culled.version = this.version;
    culled.viewProjection.copy(viewProjection);
    view.kernels ??= this.buildCull(view);
    if (!view.isPackedIndexed) {
      // Made as an index buffer first, so it can be both: a buffer the
      // cull meets first is made storage and vertex only.
      (
        renderer as unknown as {
          _attributes: { update(a: unknown, type: number): void };
        }
      )._attributes.update(view.packed, INDEX_ATTRIBUTE);
      view.isPackedIndexed = true;
    }
    _frustum.setFromProjectionMatrix(
      viewProjection,
      camera.coordinateSystem,
      (camera as { reversedDepth?: boolean }).reversedDepth,
    );
    const planes = view.planes.array as Vector4[];
    for (let p = 0; p < 6; p++) {
      const { normal, constant } = _frustum.planes[p];
      planes[p].set(normal.x, normal.y, normal.z, constant);
    }
    this.sectionCount.value = this.nextId;
    // One thread a section slot made so far, none past them.
    const { cull, decide, pack } = view.kernels;
    cull.dispatchSize = this.nextId;
    return [cull, decide, pack];
  }

  /** The view `camera` draws: the shadow views' list, or the main one. */
  private viewFor(camera: Camera): CullView {
    if (!isShadowView(camera)) return this.views.main;
    return (this.views.shadow ??= this.makeView());
  }

  /** The geometry draws `view`'s packed list. */
  private show(view: CullView) {
    if (this.geometry.index !== view.packed) this.geometry.setIndex(view.packed);
    if (this.geometry.indirect !== view.args) this.geometry.setIndirect(view.args);
  }

  /** A view's own buffers, sized for the bucket's indices and sections. */
  private makeView(): CullView {
    const args = new IndirectStorageBufferAttribute(new Uint32Array(5), 1);
    args.array.set([0, 1, 0, 0, 0]);
    return {
      packed: new StorageBufferAttribute(new Uint32Array(this.sourceIndex.count), 1),
      args,
      visibility: new StorageBufferAttribute(new Uint32Array(this.flags.count), 1),
      changed: new StorageBufferAttribute(new Uint32Array(1), 1),
      packDispatch: new IndirectStorageBufferAttribute(new Uint32Array([0, 1, 1]), 1),
      planes: uniformArray(
        Array.from({ length: 6 }, () => new Vector4()),
        "vec4",
      ),
      isRepackForced: flagUniform(),
      kernels: null,
      isPackedIndexed: false,
      culled: { camera: null, viewProjection: new Matrix4(), version: -1 },
    };
  }

  /**
   * Triangles the cull draws for `viewProjection`, counted on the CPU: the
   * GPU's own count stays on the GPU (the indirect draw's arguments), and
   * the renderer's tallies cannot see it. For stats; it walks every section.
   */
  countDrawnTriangles(camera: Camera, viewProjection: Matrix4) {
    _frustum.setFromProjectionMatrix(
      viewProjection,
      camera.coordinateSystem,
      (camera as { reversedDepth?: boolean }).reversedDepth,
    );
    const records = this.records.array as Float32Array;
    const flags = this.flags.array as Uint32Array;
    let indices = 0;
    for (const slot of this.slots.values()) {
      const at = slot.id * 4;
      if (flags[at + 2] !== 1 || flags[at + 3] !== 1) continue;
      const r = slot.id * 8 + 4;
      _sphere.center.set(records[r], records[r + 1], records[r + 2]);
      _sphere.radius = records[r + 3];
      if (_frustum.intersectsSphere(_sphere)) indices += flags[at + 1];
    }
    return indices / 3;
  }

  /**
   * The cull, in three dispatches. `cull`: one thread a section tests its
   * sphere against the view and records whether it shows, flagging any
   * section whose answer moved. `decide`: one thread sizes the pack, every
   * section slot when something moved (or a repack is forced) and the
   * packed length reset, none otherwise. `pack`: one workgroup a section,
   * dispatched from `decide`'s size: a shown section takes room in the
   * packed indices and the whole workgroup copies its indices there.
   * Dispatches in one pass see each other's writes in order.
   */
  private buildCull(view: CullView) {
    const capacity = this.flags.count;
    const records = storage(this.records, "vec4", capacity * 2).toReadOnly();
    const flags = storage(this.flags, "uvec4", capacity).toReadOnly();
    const visibility = storage(view.visibility, "uint", capacity);
    const changed = storage(view.changed, "uint", 1).toAtomic();
    const packDispatch = storage(view.packDispatch, "uint", 3);
    const source = storage(
      this.sourceIndex,
      "uint",
      this.sourceIndex.count,
    ).toReadOnly();
    const packed = storage(view.packed, "uint", view.packed.count);
    const length = storage(view.args, "uint", 5).toAtomic();
    const planes = view.planes;
    const count = this.sectionCount;
    const isForced = view.isRepackForced;

    const cull = (
      Fn(() => {
        const id = instanceIndex;
        If(id.lessThan(count), () => {
          const flag = flags.element(id);
          const sphere = records.element(id.mul(2).add(1));
          const isInside = flag.z.equal(1).and(flag.w.equal(1)).toVar();
          for (let p = 0; p < 6; p++) {
            const plane = planes.element(p) as unknown as Vec4Node;
            If(
              dot(plane.xyz, vec3(sphere.xyz))
                .add(plane.w)
                .lessThan(sphere.w.negate()),
              () => {
                isInside.assign(false);
              },
            );
          }
          const shows = select(isInside, uint(1), uint(0));
          If(shows.notEqual(visibility.element(id)), () => {
            atomicStore(changed.element(0), uint(1));
          });
          visibility.element(id).assign(shows);
        });
      })() as unknown as { computeKernel(workgroup: number[]): CullKernel }
    ).computeKernel([WORKGROUP]);

    const decide = (
      Fn(() => {
        If(
          atomicLoad(changed.element(0)).equal(1).or(isForced.equal(1)),
          () => {
            packDispatch.element(0).assign(count);
            atomicStore(length.element(0), uint(0));
          },
        ).Else(() => {
          packDispatch.element(0).assign(0);
        });
        atomicStore(changed.element(0), uint(0));
      })() as unknown as { computeKernel(workgroup: number[]): CullKernel }
    ).computeKernel([1]);
    decide.dispatchSize = 1;

    // Lane 0 takes the section's room; the workgroup then copies it.
    const shared = workgroupArray("uint", 2) as unknown as {
      element(index: unknown): ReturnType<typeof uint>;
    };
    const pack = (
      Fn(() => {
        const id = workgroupId.x;
        const lane = localId.x;
        If(lane.equal(0), () => {
          shared.element(uint(0)).assign(0);
          If(
            id.lessThan(count).and(visibility.element(id).equal(1)),
            () => {
              shared.element(uint(0)).assign(1);
              shared
                .element(uint(1))
                .assign(atomicAdd(length.element(0), flags.element(id).y));
            },
          );
        });
        workgroupBarrier();
        If(shared.element(uint(0)).equal(1), () => {
          const flag = flags.element(id);
          const start = shared.element(uint(1));
          Loop(
            {
              start: lane,
              end: flag.y,
              type: "uint",
              condition: "<",
              update: WORKGROUP,
            },
            ({ i }: { i: ReturnType<typeof uint> }) => {
              packed
                .element(start.add(i))
                .assign(source.element(flag.x.add(i)));
            },
          );
        });
      })() as unknown as { computeKernel(workgroup: number[]): CullKernel }
    ).computeKernel([WORKGROUP]);
    pack.dispatchSize = view.packDispatch;
    return { cull, decide, pack };
  }

  /** The bucket's own attributes, shaped as the first section's. */
  private ensureAttributes(geometry: BufferGeometry) {
    if (this.attributes.size > 0) return;
    const capacity = this.sectionIds.count;
    for (const name of SECTION_ATTRIBUTES) {
      const source = geometry.getAttribute(name) as BufferAttribute | undefined;
      if (!source) continue;
      const ArrayType = (source.array as unknown as { constructor: new (n: number) => ArrayLike<number> })
        .constructor;
      const attribute = new BufferAttribute(
        new ArrayType(capacity * source.itemSize) as never,
        source.itemSize,
        source.normalized,
      );
      this.attributes.set(name, attribute);
      this.geometry.setAttribute(name, attribute);
    }
  }

  private allocate(vertexCount: number, indexCount: number): Slot {
    const needed = Math.max(
      vertexCount,
      Math.ceil(indexCount / INDEX_PER_VERTEX),
    );
    const capacity = slotSize(needed);
    for (
      let size = capacity;
      size <= capacity * REUSE_SLACK;
      size += SLOT_STEP
    ) {
      const reused = this.free.get(size)?.pop();
      if (reused) return { ...reused, indexCount: 0 };
    }
    // A new range at the end, under an id of its own while the records
    // have room, else a freed slot's (its old range is left behind).
    let id: number;
    if (this.nextId < this.flags.count) {
      id = this.nextId++;
    } else {
      const spare = this.takeAnyFree();
      if (!spare) {
        throw new Error(
          `[gpu-terrain] ${this.mesh.name}: ${this.flags.count} sections live at once`,
        );
      }
      id = spare.id;
    }
    const indexRoom = capacity * INDEX_PER_VERTEX;
    if (
      this.vertexEnd + capacity > this.sectionIds.count ||
      this.indexEnd + indexRoom > this.sourceIndex.count
    ) {
      this.grow(this.vertexEnd + capacity);
    }
    const vertexStart = this.vertexEnd;
    const indexStart = this.indexEnd;
    this.vertexEnd += capacity;
    this.indexEnd += indexRoom;
    return { id, vertexStart, capacity, indexStart, indexCount: 0 };
  }

  private takeAnyFree(): Slot | null {
    for (const list of this.free.values()) {
      const slot = list.pop();
      if (slot) return slot;
    }
    return null;
  }

  /**
   * Room for `vertices` and more: the buffers half as large again, on a new
   * geometry (the old one's GPU buffers freed with it). One full upload,
   * as rare as a world's render radius growing past what it held.
   */
  private grow(vertices: number) {
    const vertexCapacity = Math.max(
      vertices,
      Math.ceil(this.sectionIds.count * 1.5),
    );
    const indexCapacity = Math.ceil(vertexCapacity * INDEX_PER_VERTEX);
    const resized = <T extends BufferAttribute>(
      attribute: T,
      count: number,
      make: (array: ArrayLike<number> & { constructor: unknown }) => T,
    ) => {
      const Kind = attribute.array.constructor as new (n: number) => Uint8Array;
      const array = new Kind(count * attribute.itemSize);
      array.set(attribute.array as Uint8Array);
      return make(array);
    };
    const geometry = new BufferGeometry();
    for (const [name, attribute] of this.attributes) {
      const next = resized(
        attribute,
        vertexCapacity,
        (array) =>
          new BufferAttribute(
            array as Uint8Array,
            attribute.itemSize,
            attribute.normalized,
          ),
      );
      this.attributes.set(name, next);
      geometry.setAttribute(name, next);
    }
    this.sectionIds = resized(
      this.sectionIds,
      vertexCapacity,
      (array) => new BufferAttribute(array as Uint32Array, 1),
    );
    geometry.setAttribute("sectionId", this.sectionIds);
    this.sourceIndex = resized(
      this.sourceIndex,
      indexCapacity,
      (array) => new StorageBufferAttribute(array as Uint32Array, 1),
    );
    // Each view packs into a list as long as the indices, read by a cull
    // built anew; the packed one is an index again.
    for (const view of [this.views.main, this.views.shadow]) {
      if (!view) continue;
      view.packed = new StorageBufferAttribute(new Uint32Array(indexCapacity), 1);
      view.kernels = null;
      view.isPackedIndexed = false;
    }
    const old = this.geometry;
    this.geometry = geometry;
    this.mesh.geometry = geometry;
    this.show(this.views.main);
    old.dispose();
    this.version += 1;
    console.info(
      `[gpu-terrain] ${this.mesh.name}: grew to ${vertexCapacity} vertices`,
    );
  }


  /** Hides a slot and keeps its room (and id) for the next section of its size. */
  private release(slot: Slot) {
    const flags = this.flags.array as Uint32Array;
    flags[slot.id * 4 + 3] = 0;
    this.flags.addUpdateRange(slot.id * 4 + 3, 1);
    this.flags.needsUpdate = true;
    this.version += 1;
    let list = this.free.get(slot.capacity);
    if (!list) {
      list = [];
      this.free.set(slot.capacity, list);
    }
    list.push(slot);
  }
}

/**
 * A bucket's sections by chunk and level, with the surface the world feeds
 * its region arenas through, so a bucket can be drawn either way.
 */
/**
 * A world's GPU buckets, culled together: when one is about to draw for a
 * view, every bucket that does not already hold that view is culled in one
 * compute submission. One submission a bucket was ~20 a frame (each its own
 * command encoder and queue submit, ~10 µs of main thread apiece), several
 * of them the same view again. A bucket the pass does not draw is culled
 * too; on the GPU that is a few idle workgroups, and its own pass with that
 * view later finds it done.
 */
export class GpuTerrainCulls {
  private readonly buckets = new Set<GpuTerrainBucket>();
  private readonly kernels: CullKernel[] = [];

  add(bucket: GpuTerrainBucket) {
    this.buckets.add(bucket);
  }

  delete(bucket: GpuTerrainBucket) {
    this.buckets.delete(bucket);
  }

  /** Triangles every bucket draws for `camera` (stats; see the bucket's). */
  countDrawnTriangles(camera: Camera) {
    _matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    let triangles = 0;
    for (const bucket of this.buckets) {
      triangles += bucket.countDrawnTriangles(camera, _matrix);
    }
    return triangles;
  }

  /**
   * Culls every drawn bucket for `camera`'s view (and `requester`, drawn or
   * not: a stand-in may draw a hidden bucket's geometry). A bucket a pass
   * hides (fluids and glass from the shadow passes) is culled when it
   * draws, so it never makes a shadow list.
   */
  cullFor(renderer: Renderer, camera: Camera, requester?: GpuTerrainBucket) {
    _matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const kernels = this.kernels;
    kernels.length = 0;
    for (const bucket of this.buckets) {
      if (bucket !== requester && !bucket.mesh.visible) continue;
      const prepared = bucket.prepareCull(renderer, camera, _matrix);
      if (prepared) kernels.push(...prepared);
    }
    if (kernels.length > 0) renderer.compute(kernels as unknown as ComputeNode[]);
    kernels.length = 0;
  }
}

export class GpuTerrainArenas {
  private readonly levelsOf = new Map<string, Set<number>>();

  constructor(
    readonly bucket: GpuTerrainBucket,
    private readonly onMesh?: (mesh: Mesh, isAdded: boolean) => void,
    parent?: { add(mesh: Mesh): unknown },
  ) {
    parent?.add(bucket.mesh);
    onMesh?.(bucket.mesh, true);
  }

  setSectionGeometry(
    cx: number,
    cz: number,
    level: number,
    geometry: BufferGeometry,
    x: number,
    y: number,
    z: number,
  ) {
    this.bucket.setSectionGeometry(`${cx},${cz},${level}`, geometry, x, y, z);
    const chunk = `${cx},${cz}`;
    let levels = this.levelsOf.get(chunk);
    if (!levels) {
      levels = new Set();
      this.levelsOf.set(chunk, levels);
    }
    levels.add(level);
  }

  setSectionVisible(cx: number, cz: number, level: number, isVisible: boolean) {
    this.bucket.setSectionVisible(`${cx},${cz},${level}`, isVisible);
  }

  setSectionReveal(cx: number, cz: number, level: number, reveal: number) {
    return this.bucket.setSectionReveal(`${cx},${cz},${level}`, reveal);
  }

  clearSection(cx: number, cz: number, level: number) {
    this.bucket.clearSection(`${cx},${cz},${level}`);
    this.levelsOf.get(`${cx},${cz}`)?.delete(level);
  }

  clearChunk(cx: number, cz: number) {
    const chunk = `${cx},${cz}`;
    for (const level of this.levelsOf.get(chunk) ?? []) {
      this.bucket.clearSection(`${chunk},${level}`);
    }
    this.levelsOf.delete(chunk);
  }

  /** The bucket's one mesh: every pass culls it on the GPU for itself. */
  collectPagesIn(
    _minCx: number,
    _maxCx: number,
    _minCz: number,
    _maxCz: number,
    out: { push(mesh: Mesh): unknown },
  ) {
    out.push(this.bucket.mesh);
  }

  get stats() {
    return { regions: 1, pages: 1, sections: this.bucket.stats.sections };
  }

  dispose() {
    this.onMesh?.(this.bucket.mesh, false);
    this.bucket.mesh.removeFromParent();
    this.bucket.dispose();
  }
}
