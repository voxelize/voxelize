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
 * The pack is incremental for a view that keeps its camera: a section that
 * turns visible, or is remeshed while visible, is appended to the list; one
 * that turns hidden or is freed has its copy overwritten with degenerate
 * triangles (a hole). Only another camera's list, a grow, a list too full
 * of holes or too long repacks everything. Walking used to repack every
 * visible index whenever one section streamed in or crossed the frustum:
 * most of the frame's GPU time while moving.
 *
 * The vertex stage finds a vertex's section by its `sectionId` attribute and
 * reads the section's origin and reveal from `records`
 * (`GpuTerrainSections`, used by the chunk material).
 */

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
  uvec4,
  vec3,
  workgroupArray,
  workgroupBarrier,
  workgroupId,
} from "three/tsl";
import {
  Box3,
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
  Vector3,
  Vector4,
} from "three/webgpu";

import { setSectionBounds } from "./chunk-region-arenas";
import type { Vec4Node } from "./shading/types";
import { isShadowView } from "./shadow-casters";
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
/**
 * How full a bucket gets before its next size is made and compiled ahead
 * (see `GpuTerrainBucket.prepareGrowth`).
 */
const GROW_AHEAD = 0.75;
/**
 * The vertex room a bucket of `vertices` grows to. A grow uploads the whole
 * bucket again, so a bucket that keeps growing as the player travels (an
 * ocean's water) must reach its size in few steps: by halves, water on the
 * island world grew twelve times in a ten-second walk. Past a million
 * vertices, doubling would allocate hundreds of megabytes at a step, so a
 * large bucket grows by half.
 */
const nextVertexCapacity = (vertices: number) =>
  vertices < 1 << 20 ? vertices * 2 : Math.ceil(vertices * 1.5);
/**
 * A list holding more holes than this share of its length, or longer than
 * this share of its room, is repacked whole (see `buildCull`).
 */
const MAX_HOLE_SHARE = 0.5;
const MAX_FILL_SHARE = 0.6;
/**
 * A view's `slots` entry for a section with no copy in its list. A copy is
 * held under the list's epoch (from 1), which a whole repack advances: every
 * copy made before it stops being held at once.
 */
const NOT_HELD = 0;
/** A view's `state` words. */
const STATE = {
  /** 0 no pack, 1 incremental, 2 whole. */
  mode: 0,
  /** Indices the list holds as holes. */
  holes: 1,
  /** An append ran past the room. */
  overflow: 2,
  /** The list's epoch (see {@link NOT_HELD}). */
  epoch: 3,
  /** Sections the cull listed whose copy must change. */
  work: 4,
  /** Sections the cull found shown. */
  shown: 5,
} as const;
const STATE_WORDS = 8;
/**
 * A section's `flags`: (index start, index count, bits, stamp). The bits:
 * shown (the game's visibility: plants past their radius, held chunks) and
 * live (holds a section). The stamp is bumped whenever its indices are
 * rewritten: a view's copy made under an older stamp is stale. One word
 * each, so a cull binds no more storage buffers than every device allows.
 */
const SHOWN_BIT = 1;
const LIVE_BIT = 2;
const DRAWN_BITS = SHOWN_BIT | LIVE_BIT;

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
type CullKernels = {
  cull: CullKernel;
  decide: CullKernel;
  pack: CullKernel;
  finish: CullKernel;
};

type CullView = {
  /** The visible sections' indices, packed; drawn as the index. */
  packed: StorageBufferAttribute;
  /** The indirect draw: the packed length, one instance. */
  readonly args: IndirectStorageBufferAttribute;
  /** Whether each section shows in the view (the cull's answer). */
  readonly visibility: StorageBufferAttribute;
  /**
   * Per section, its copy in the packed list: (start, index count, the
   * section's stamp when copied, 1 when held).
   */
  readonly slots: StorageBufferAttribute;
  /**
   * The sections whose copy must change, then (from the section capacity)
   * the sections shown: both listed by the cull.
   */
  readonly lists: StorageBufferAttribute;
  /** The pack's words ({@link STATE}; atomic). */
  readonly state: StorageBufferAttribute;
  /** The pack's workgroups: one a listed section, or none. */
  readonly packDispatch: IndirectStorageBufferAttribute;
  readonly planes: ReturnType<typeof uniformArray>;
  /** 1: repack the list whole (another camera's, or new buffers). */
  readonly isRepackForced: ReturnType<typeof flagUniform>;
  kernels: CullKernels | null;
  isPackedIndexed: boolean;
  /** What the packed list was last culled for. */
  readonly culled: {
    camera: Camera | null;
    viewProjection: Matrix4;
    version: number;
    layout: number;
  };
};

/**
 * Makes `packed` an index buffer before anything binds it as storage, so
 * it can be both: a buffer a cull meets first is made storage and vertex
 * only.
 */
function markIndexed(renderer: Renderer, packed: StorageBufferAttribute) {
  (
    renderer as unknown as {
      _attributes: { update(a: unknown, type: number): void };
    }
  )._attributes.update(packed, INDEX_ATTRIBUTE);
}

/**
 * Where a cull stands with the pipelines built for it off the frame; a cull
 * with no entry builds on its first dispatch, as three does by default.
 *
 * `compiling`: three keeps a pipeline it is still building as the kernel's
 * own, so a dispatch before it lands binds no pipeline. The backend throws
 * inside the frame's draw, and a draw abandoned there leaves the renderer's
 * pass state as it was mid-frame: the canvas stays blank from then on. A
 * slow GPU process (a cold shader cache, a second world loading in another
 * frame of the page) is all it takes, so nothing dispatches such a cull.
 *
 * `failed`: its compile threw part way, with pipelines maybe still on their
 * way. It is dropped for one built on first use.
 */
const aheadOf = new WeakMap<CullKernels, "compiling" | "failed">();
/** Culls a frame has dispatched: their pipelines exist. */
const dispatched = new WeakSet<CullKernels>();

/** Builds `culls`' compute pipelines without dispatching them. */
function compileAhead(renderer: Renderer, culls: CullKernels[]): Promise<void> {
  const kernels: CullKernel[] = [];
  const held: CullKernels[] = [];
  for (const cull of culls) {
    kernels.push(cull.cull, cull.decide, cull.pack, cull.finish);
    // One a frame already dispatched has its pipelines: it keeps culling.
    if (dispatched.has(cull)) continue;
    aheadOf.set(cull, "compiling");
    held.push(cull);
  }
  const settle = (state?: "failed") => {
    for (const cull of held) {
      if (state) aheadOf.set(cull, state);
      else aheadOf.delete(cull);
    }
  };
  let compile: Promise<void>;
  try {
    compile = (
      renderer as unknown as {
        compileComputeAsync(nodes: unknown[]): Promise<void>;
      }
    ).compileComputeAsync(kernels);
  } catch (error) {
    settle("failed");
    return Promise.reject(error);
  }
  return compile.then(
    () => settle(),
    (error: unknown) => {
      settle("failed");
      throw error;
    },
  );
}

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

/**
 * A bucket's geometry, with bounds that hold everything: it draws whatever
 * its cull packs, anywhere in the world. Without bounds three computes them
 * the first time it sorts the mesh into a list (frustum culling off or
 * not), a pass over every vertex the bucket holds: on a bucket grown to
 * millions of vertices, a 200 ms frame in the shadow cascades.
 */
function unboundedGeometry() {
  const geometry = new BufferGeometry();
  geometry.boundingSphere = new Sphere(new Vector3(), Infinity);
  geometry.boundingBox = new Box3(
    new Vector3(-Infinity, -Infinity, -Infinity),
    new Vector3(Infinity, Infinity, Infinity),
  );
  return geometry;
}

export class GpuTerrainBucket {
  readonly mesh: Mesh;
  readonly sections: GpuTerrainSections;

  private geometry = unboundedGeometry();
  private attributes = new Map<string, BufferAttribute>();
  private sectionIds: BufferAttribute;
  private sourceIndex: StorageBufferAttribute;
  private records: StorageBufferAttribute;
  /** Per section: see {@link SHOWN_BIT}. */
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
  /** Bumped when the buffers are replaced (a grow): every list repacks. */
  private layout = 0;
  /** The renderer the culls dispatch on, once one has (for compiles ahead). */
  private renderer: Renderer | null = null;
  /**
   * The next size's index buffers and each view's cull over them, made and
   * compiled once the bucket is {@link GROW_AHEAD} full, for the grow that
   * takes them.
   */
  private nextGrowth: {
    vertexCapacity: number;
    sourceIndex: StorageBufferAttribute;
    views: Map<
      CullView,
      { packed: StorageBufferAttribute; kernels: CullKernels }
    >;
  } | null = null;

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
    const half = box.max
      .clone()
      .sub(box.min)
      .multiplyScalar(0.5 / units);
    records[at + 4] = records[at] + ((box.min.x + box.max.x) * 0.5) / units;
    records[at + 5] = records[at + 1] + ((box.min.y + box.max.y) * 0.5) / units;
    records[at + 6] = records[at + 2] + ((box.min.z + box.max.z) * 0.5) / units;
    records[at + 7] = half.length();
    this.records.addUpdateRange(at, 8);
    this.records.needsUpdate = true;

    const flags = this.flags.array as Uint32Array;
    const flagAt = slot.id * 4;
    flags[flagAt] = slot.indexStart;
    flags[flagAt + 1] = index.count;
    // A remesh in place keeps the section's visibility; a section new to
    // its slot is shown.
    const bits = flags[flagAt + 2];
    flags[flagAt + 2] =
      (bits & LIVE_BIT ? bits & SHOWN_BIT : SHOWN_BIT) | LIVE_BIT;
    flags[flagAt + 3] = (flags[flagAt + 3] + 1) >>> 0;
    this.flags.addUpdateRange(flagAt, 4);
    this.flags.needsUpdate = true;
    this.version += 1;
  }

  /** Whether a section draws (plants beyond their radius, held chunks). */
  setSectionVisible(key: string, isVisible: boolean) {
    const slot = this.slots.get(key);
    if (!slot) return;
    const flags = this.flags.array as Uint32Array;
    const bits = flags[slot.id * 4 + 2];
    if (Boolean(bits & SHOWN_BIT) === isVisible) return;
    flags[slot.id * 4 + 2] = isVisible ? bits | SHOWN_BIT : bits & ~SHOWN_BIT;
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
    this.isDisposed = true;
    this.options.culls?.delete(this);
    this.geometry.dispose();
    this.slots.clear();
    this.free.clear();
  }

  private isDisposed = false;

  /**
   * Keeps the bucket out of every pass until its cull kernels compile off
   * the frame, for a bucket made in play (a rare block's, met after the
   * load warmup): three builds a compute pipeline synchronously on its
   * first dispatch, so the first frame that drew it built three. Its
   * sections show a few frames later instead. `draws` compiles any pass
   * the host draws the bucket in that nothing else compiles for it (a
   * torch's shadow cells), before it shows too. A failed compile is logged
   * and the bucket shown anyway, to build on first use as before.
   */
  compileBeforeShowing(
    renderer: Renderer,
    draws?: () => Promise<unknown>,
  ): Promise<void> {
    this.mesh.visible = false;
    const show = () => {
      if (!this.isDisposed) this.mesh.visible = true;
    };
    return this.compileCulls(renderer)
      .then(() => (draws && !this.isDisposed ? draws() : undefined))
      .then(show, (error: unknown) => {
        console.error(
          "GPU terrain: a bucket's culls or draws failed to compile ahead; they build on first use.",
          error,
        );
        show();
      });
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
      _matrix.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      );
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
    this.renderer = renderer;
    if (this.nextId === 0) return null;
    const view = this.viewFor(camera);
    // A cull still compiling ahead is not dispatched (see `aheadOf`): the
    // view keeps the list it has, none yet for a bucket made in a load or in
    // play, and is culled on the first frame after its pipelines land.
    const ahead = view.kernels ? aheadOf.get(view.kernels) : undefined;
    if (ahead === "compiling") return null;
    if (ahead === "failed") view.kernels = null;
    const culled = view.culled;
    if (
      culled.camera === camera &&
      culled.version === this.version &&
      culled.viewProjection.equals(viewProjection)
    ) {
      return null;
    }
    // Another camera's list, or new buffers: repack whole. The same camera
    // with sections changed or the view moved: the GPU patches the list
    // where a section's copy must change, or does nothing (the camera
    // drifts every frame; repacking millions of unchanged indices each
    // time, or for each section streamed in, was the frame while walking).
    view.isRepackForced.value =
      culled.camera !== camera || culled.layout !== this.layout ? 1 : 0;
    culled.camera = camera;
    culled.version = this.version;
    culled.layout = this.layout;
    culled.viewProjection.copy(viewProjection);
    view.kernels ??= this.buildCull(view);
    this.makePackedIndexed(renderer, view);
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
    const { cull, decide, pack, finish } = view.kernels;
    cull.dispatchSize = this.nextId;
    dispatched.add(view.kernels);
    return [cull, decide, pack, finish];
  }

  /**
   * Compiles the cull kernels of the main view and the shadow views' list
   * without dispatching them, for a load warmup: three builds a compute
   * pipeline synchronously on its first dispatch, in a frame.
   */
  compileCulls(renderer: Renderer): Promise<void> {
    this.renderer = renderer;
    const culls: CullKernels[] = [];
    for (const view of [
      this.views.main,
      (this.views.shadow ??= this.makeView()),
    ]) {
      this.makePackedIndexed(renderer, view);
      culls.push((view.kernels ??= this.buildCull(view)));
    }
    return compileAhead(renderer, culls);
  }

  /**
   * Makes the next size's index buffers and each view's cull over them,
   * and compiles those culls off the frame. A grow rebuilds every view's
   * cull (its packed list and the indices it reads are new buffers), and
   * three builds a compute pipeline synchronously on its first dispatch:
   * a bucket growing in play (an ocean's water as the player travels)
   * built three in a frame each time. The grow takes these instead.
   */
  private prepareGrowth() {
    const { renderer } = this;
    if (this.nextGrowth || !renderer) return;
    if (
      this.vertexEnd < this.sectionIds.count * GROW_AHEAD &&
      this.indexEnd < this.sourceIndex.count * GROW_AHEAD
    ) {
      return;
    }
    const vertexCapacity = nextVertexCapacity(this.sectionIds.count);
    const indexCapacity = Math.ceil(vertexCapacity * INDEX_PER_VERTEX);
    const sourceIndex = new StorageBufferAttribute(
      new Uint32Array(indexCapacity),
      1,
    );
    const views = new Map<
      CullView,
      { packed: StorageBufferAttribute; kernels: CullKernels }
    >();
    const culls: CullKernels[] = [];
    for (const view of [this.views.main, this.views.shadow]) {
      if (!view) continue;
      const packed = new StorageBufferAttribute(
        new Uint32Array(indexCapacity),
        1,
      );
      markIndexed(renderer, packed);
      const built = this.buildCull(view, sourceIndex, packed);
      views.set(view, { packed, kernels: built });
      culls.push(built);
    }
    this.nextGrowth = { vertexCapacity, sourceIndex, views };
    compileAhead(renderer, culls).catch((error: unknown) => {
      console.error(
        `[gpu-terrain] ${this.mesh.name}: the next size's culls failed to compile ahead; they build on first use.`,
        error,
      );
    });
  }

  /**
   * Makes a view's packed list an index buffer before anything binds it as
   * storage, so it can be both: a buffer the cull meets first is made
   * storage and vertex only.
   */
  private makePackedIndexed(renderer: Renderer, view: CullView) {
    if (view.isPackedIndexed) return;
    markIndexed(renderer, view.packed);
    view.isPackedIndexed = true;
  }

  /** The view `camera` draws: the shadow views' list, or the main one. */
  private viewFor(camera: Camera): CullView {
    if (!isShadowView(camera)) return this.views.main;
    return (this.views.shadow ??= this.makeView());
  }

  /** The geometry draws `view`'s packed list. */
  private show(view: CullView) {
    if (this.geometry.index !== view.packed)
      this.geometry.setIndex(view.packed);
    if (this.geometry.indirect !== view.args)
      this.geometry.setIndirect(view.args);
  }

  /** A view's own buffers, sized for the bucket's indices and sections. */
  private makeView(): CullView {
    const args = new IndirectStorageBufferAttribute(new Uint32Array(5), 1);
    args.array.set([0, 1, 0, 0, 0]);
    return {
      packed: new StorageBufferAttribute(
        new Uint32Array(this.sourceIndex.count),
        1,
      ),
      args,
      visibility: new StorageBufferAttribute(
        new Uint32Array(this.flags.count),
        1,
      ),
      slots: new StorageBufferAttribute(
        new Uint32Array(this.flags.count * 4),
        4,
      ),
      lists: new StorageBufferAttribute(
        new Uint32Array(this.flags.count * 2),
        1,
      ),
      state: new StorageBufferAttribute(
        Uint32Array.from({ length: STATE_WORDS }, (_, i) =>
          i === STATE.epoch ? 1 : 0,
        ),
        1,
      ),
      packDispatch: new IndirectStorageBufferAttribute(
        new Uint32Array([0, 1, 1]),
        1,
      ),
      planes: uniformArray(
        Array.from({ length: 6 }, () => new Vector4()),
        "vec4",
      ),
      isRepackForced: flagUniform(),
      kernels: null,
      isPackedIndexed: false,
      culled: {
        camera: null,
        viewProjection: new Matrix4(),
        version: -1,
        layout: -1,
      },
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
      if ((flags[at + 2] & DRAWN_BITS) !== DRAWN_BITS) continue;
      const r = slot.id * 8 + 4;
      _sphere.center.set(records[r], records[r + 1], records[r + 2]);
      _sphere.radius = records[r + 3];
      if (_frustum.intersectsSphere(_sphere)) indices += flags[at + 1];
    }
    return indices / 3;
  }

  /**
   * The cull, in four dispatches; dispatches in one pass see each other's
   * writes in order.
   *
   * `cull`: one thread a section tests its sphere against the view (and
   * whether it is shown and live), records the answer, lists the section
   * when it shows, and lists it as work when its copy in the list must
   * change: it shows without a current copy (none, or one older than its
   * indices by its stamp), or it holds a copy and no longer shows.
   *
   * `decide`: one thread picks the pack. Whole (forced, overflowed, more
   * holes than {@link MAX_HOLE_SHARE} of the list, or the list past
   * {@link MAX_FILL_SHARE} of its room with holes to win back): the list is
   * emptied, its epoch advanced, and the pack runs over the shown sections.
   * Incremental: the pack runs over the work alone. Else no pack.
   *
   * `pack`: one workgroup a listed section. A copy that must go is
   * overwritten with one index repeated (degenerate triangles, a hole); a
   * section that shows without a current copy is appended and the
   * workgroup copies its indices. An append past the room fills what part
   * of it fits with a hole and flags the overflow; the next cull repacks
   * whole. Standing still dispatches nothing; walking, only the sections
   * that changed.
   *
   * `finish`: one thread keeps the drawn length within the list and empties
   * the lists for the next cull.
   */
  private buildCull(
    view: CullView,
    sourceIndex = this.sourceIndex,
    packedIndex = view.packed,
  ) {
    const capacity = this.flags.count;
    const room = packedIndex.count;
    const records = storage(this.records, "vec4", capacity * 2).toReadOnly();
    const flags = storage(this.flags, "uvec4", capacity).toReadOnly();
    const visibility = storage(view.visibility, "uint", capacity);
    const slots = storage(view.slots, "uvec4", capacity);
    // The work list, then the shown list, in one buffer.
    const lists = storage(view.lists, "uint", capacity * 2);
    const work = { element: (i: unknown) => lists.element(i as never) };
    const shown = {
      element: (i: unknown) =>
        lists.element((i as ReturnType<typeof uint>).add(capacity)),
    };
    const state = storage(view.state, "uint", STATE_WORDS).toAtomic();
    const packDispatch = storage(view.packDispatch, "uint", 3);
    const source = storage(sourceIndex, "uint", sourceIndex.count).toReadOnly();
    const packed = storage(packedIndex, "uint", room);
    const length = storage(view.args, "uint", 5).toAtomic();
    const planes = view.planes;
    const count = this.sectionCount;
    const isForced = view.isRepackForced;
    const word = (name: keyof typeof STATE) => state.element(STATE[name]);
    const INCREMENTAL = 1;
    const WHOLE = 2;

    const cull = (
      Fn(() => {
        const id = instanceIndex;
        If(id.lessThan(count), () => {
          const flag = flags.element(id);
          const sphere = records.element(id.mul(2).add(1));
          const isInside = flag.z.equal(DRAWN_BITS).toVar();
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
          visibility.element(id).assign(select(isInside, uint(1), uint(0)));
          If(isInside, () => {
            shown.element(atomicAdd(word("shown"), uint(1))).assign(id);
          });
          const slot = slots.element(id);
          const isHeld = slot.w.equal(atomicLoad(word("epoch")));
          const isCurrent = isHeld.and(slot.z.equal(flag.w));
          // Shows without a current copy, or holds a copy it must not.
          const mustAppend = isInside.and(isCurrent.not());
          const mustHole = isHeld.and(isInside.not());
          If(mustAppend.or(mustHole), () => {
            work.element(atomicAdd(word("work"), uint(1))).assign(id);
          });
        });
      })() as unknown as { computeKernel(workgroup: number[]): CullKernel }
    ).computeKernel([WORKGROUP]);

    const decide = (
      Fn(() => {
        const listed = atomicLoad(length.element(0));
        const holes = atomicLoad(word("holes"));
        const isWhole = isForced
          .equal(1)
          .or(atomicLoad(word("overflow")).equal(1))
          .or(holes.toFloat().greaterThan(listed.toFloat().mul(MAX_HOLE_SHARE)))
          // Close to the room with holes to win back: compact before an
          // append could overflow.
          .or(
            listed
              .toFloat()
              .greaterThan(room * MAX_FILL_SHARE)
              .and(holes.greaterThan(0)),
          );
        If(isWhole, () => {
          atomicStore(word("mode"), uint(WHOLE));
          atomicAdd(word("epoch"), uint(1));
          atomicStore(word("holes"), uint(0));
          atomicStore(word("overflow"), uint(0));
          atomicStore(length.element(0), uint(0));
          packDispatch.element(0).assign(atomicLoad(word("shown")));
        })
          .ElseIf(atomicLoad(word("work")).greaterThan(0), () => {
            atomicStore(word("mode"), uint(INCREMENTAL));
            packDispatch.element(0).assign(atomicLoad(word("work")));
          })
          .Else(() => {
            atomicStore(word("mode"), uint(0));
            packDispatch.element(0).assign(0);
          });
      })() as unknown as { computeKernel(workgroup: number[]): CullKernel }
    ).computeKernel([1]);
    decide.dispatchSize = 1;

    // Lane 0 decides for the section; the workgroup then writes. The
    // shared words: 0 copy (1 yes), 1 copy start, 2 copy length, 3 hole
    // start, 4 hole length, 5 the index a hole repeats, 6 copy source.
    const shared = workgroupArray("uint", 7) as unknown as {
      element(index: unknown): ReturnType<typeof uint>;
    };
    const pack = (
      Fn(() => {
        const lane = localId.x;
        If(lane.equal(0), () => {
          shared.element(uint(0)).assign(0);
          shared.element(uint(4)).assign(0);
          const mode = atomicLoad(word("mode"));
          const isWhole = mode.equal(WHOLE);
          const id = select(
            isWhole,
            shown.element(workgroupId.x),
            work.element(workgroupId.x),
          ).toVar();
          const epoch = atomicLoad(word("epoch"));
          const flag = flags.element(id);
          const slot = slots.element(id);
          const stamp = flag.w;
          const shows = visibility.element(id).equal(1);
          // After a whole repack's new epoch nothing is held.
          const isHeld = slot.w.equal(epoch);
          const isCurrent = isHeld.and(slot.z.equal(stamp));
          // A copy that must go: hidden, freed, or older than the
          // section's indices.
          If(isHeld.and(isCurrent.and(shows).not()), () => {
            shared.element(uint(3)).assign(slot.x);
            shared.element(uint(4)).assign(slot.y);
            shared.element(uint(5)).assign(packed.element(slot.x));
            atomicAdd(word("holes"), slot.y);
          });
          If(shows.and(isCurrent.not()), () => {
            const start = atomicAdd(length.element(0), flag.y);
            If(start.add(flag.y).lessThanEqual(room), () => {
              shared.element(uint(0)).assign(1);
              shared.element(uint(1)).assign(start);
              shared.element(uint(2)).assign(flag.y);
              shared.element(uint(6)).assign(flag.x);
              slots.element(id).assign(uvec4(start, flag.y, stamp, epoch));
            }).Else(() => {
              // Past the room: what fits becomes a hole, and the next
              // cull repacks whole.
              atomicStore(word("overflow"), uint(1));
              If(start.lessThan(room), () => {
                shared.element(uint(3)).assign(start);
                shared.element(uint(4)).assign(uint(room).sub(start));
                shared.element(uint(5)).assign(source.element(flag.x));
              });
              slots.element(id).assign(uvec4(0, 0, 0, NOT_HELD));
            });
          }).ElseIf(shows.not(), () => {
            slots.element(id).assign(uvec4(0, 0, 0, NOT_HELD));
          });
        });
        workgroupBarrier();
        const holeLength = shared.element(uint(4));
        If(holeLength.greaterThan(0), () => {
          const holeStart = shared.element(uint(3));
          const repeated = shared.element(uint(5));
          Loop(
            {
              start: lane,
              end: holeLength,
              type: "uint",
              condition: "<",
              update: WORKGROUP,
            },
            ({ i }: { i: ReturnType<typeof uint> }) => {
              packed.element(holeStart.add(i)).assign(repeated);
            },
          );
        });
        If(shared.element(uint(0)).equal(1), () => {
          const start = shared.element(uint(1));
          const from = shared.element(uint(6));
          Loop(
            {
              start: lane,
              end: shared.element(uint(2)),
              type: "uint",
              condition: "<",
              update: WORKGROUP,
            },
            ({ i }: { i: ReturnType<typeof uint> }) => {
              packed.element(start.add(i)).assign(source.element(from.add(i)));
            },
          );
        });
      })() as unknown as { computeKernel(workgroup: number[]): CullKernel }
    ).computeKernel([WORKGROUP]);
    pack.dispatchSize = view.packDispatch;

    const finish = (
      Fn(() => {
        If(atomicLoad(length.element(0)).greaterThan(room), () => {
          atomicStore(length.element(0), uint(room));
        });
        atomicStore(word("work"), uint(0));
        atomicStore(word("shown"), uint(0));
      })() as unknown as { computeKernel(workgroup: number[]): CullKernel }
    ).computeKernel([1]);
    finish.dispatchSize = 1;

    return { cull, decide, pack, finish };
  }

  /** Whether the bucket's attributes are laid out (by a section or {@link adoptLayout}). */
  get hasLayout() {
    return this.attributes.size > 0;
  }

  /**
   * Lays the bucket's attributes out as `geometry`'s (a section, another
   * bucket's geometry, or a chunk stand-in), before any section of its own:
   * a bucket with no sections then draws with the pipelines its sections
   * will, so a load warmup can build them (the attributes' formats are a
   * pipeline's vertex layout). Every section the merge makes shares one
   * layout for quantized blocks; a fluid's float positions are another.
   */
  adoptLayout(geometry: BufferGeometry) {
    this.ensureAttributes(geometry);
  }

  /** The bucket's own attributes, shaped as the first section's. */
  private ensureAttributes(geometry: BufferGeometry) {
    if (this.attributes.size > 0) return;
    const capacity = this.sectionIds.count;
    for (const name of SECTION_ATTRIBUTES) {
      const source = geometry.getAttribute(name) as BufferAttribute | undefined;
      if (!source) continue;
      const ArrayType = (
        source.array as unknown as {
          constructor: new (n: number) => ArrayLike<number>;
        }
      ).constructor;
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
    this.prepareGrowth();
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
    // The size made ahead, when it holds what is asked for.
    const prepared =
      this.nextGrowth && this.nextGrowth.vertexCapacity >= vertices
        ? this.nextGrowth
        : null;
    this.nextGrowth = null;
    const vertexCapacity =
      prepared?.vertexCapacity ??
      Math.max(vertices, nextVertexCapacity(this.sectionIds.count));
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
    const geometry = unboundedGeometry();
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
    if (prepared) {
      // The size made ahead already has its GPU buffer (its culls bound it
      // to compile), so an upload is no longer whole by default: three
      // writes only the update ranges when there are any, and the section
      // that set off this grow adds one before the frame uploads. Without a
      // range over the copy, every section held before the grow read zeros
      // on the GPU and drew as degenerate triangles (water vanished as an
      // ocean's bucket grew).
      const held = this.sourceIndex.array as Uint32Array;
      (prepared.sourceIndex.array as Uint32Array).set(held);
      prepared.sourceIndex.clearUpdateRanges();
      prepared.sourceIndex.addUpdateRange(0, held.length);
      prepared.sourceIndex.needsUpdate = true;
      this.sourceIndex = prepared.sourceIndex;
    } else {
      this.sourceIndex = resized(
        this.sourceIndex,
        indexCapacity,
        (array) => new StorageBufferAttribute(array as Uint32Array, 1),
      );
    }
    // Each view packs into a list as long as the indices, read by a cull
    // over the new buffers: the one compiled ahead, else built anew (and
    // its packed list made an index again).
    for (const view of [this.views.main, this.views.shadow]) {
      if (!view) continue;
      const ready = prepared?.views.get(view);
      if (ready) {
        view.packed = ready.packed;
        // Its cull with it, unless the grow came before its pipelines (a
        // bucket filling faster than the GPU process compiles, as in a
        // load): the sections on screen must be culled this frame, so the
        // view builds a cull over the same buffers on first use, as a grow
        // with nothing made ahead does.
        view.kernels = aheadOf.has(ready.kernels) ? null : ready.kernels;
        view.isPackedIndexed = true;
        continue;
      }
      view.packed = new StorageBufferAttribute(
        new Uint32Array(indexCapacity),
        1,
      );
      view.kernels = null;
      view.isPackedIndexed = false;
    }
    const old = this.geometry;
    this.geometry = geometry;
    this.mesh.geometry = geometry;
    this.show(this.views.main);
    old.dispose();
    this.version += 1;
    this.layout += 1;
    console.info(
      `[gpu-terrain] ${this.mesh.name}: grew to ${vertexCapacity} vertices`,
    );
  }

  /** Hides a slot and keeps its room (and id) for the next section of its size. */
  private release(slot: Slot) {
    const flags = this.flags.array as Uint32Array;
    flags[slot.id * 4 + 2] &= ~LIVE_BIT;
    this.flags.addUpdateRange(slot.id * 4 + 2, 1);
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

  /** The buckets culled together. */
  get members(): ReadonlySet<GpuTerrainBucket> {
    return this.buckets;
  }
  private readonly kernels: CullKernel[] = [];

  add(bucket: GpuTerrainBucket) {
    this.buckets.add(bucket);
  }

  delete(bucket: GpuTerrainBucket) {
    this.buckets.delete(bucket);
  }

  /** Triangles every bucket draws for `camera` (stats; see the bucket's). */
  countDrawnTriangles(camera: Camera) {
    _matrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
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
    _matrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    const kernels = this.kernels;
    kernels.length = 0;
    for (const bucket of this.buckets) {
      if (bucket !== requester && !bucket.mesh.visible) continue;
      const prepared = bucket.prepareCull(renderer, camera, _matrix);
      if (prepared) kernels.push(...prepared);
    }
    if (kernels.length > 0)
      renderer.compute(kernels as unknown as ComputeNode[]);
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
