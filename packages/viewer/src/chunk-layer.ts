/**
 * The meshed chunks around the focus for one source: which are wanted,
 * which are on their way (workers fetch and build them off the main
 * thread), and which land this frame. Copying arrays into GPU buffers is
 * the only main-thread work, and it is spent under a byte budget per frame
 * so a burst of arrivals never lands as one long frame.
 *
 * Each material's chunks live in one section pool (section-pool.ts), so
 * the material draws as a multi-draw per page per pass (the main view and
 * each shadow cascade) instead of one draw per chunk: thousands of draws a
 * frame, each with its own uniform uploads, were nearly all of the
 * viewer's frame time.
 */
import {
  POSITION_BLOCK_BIAS,
  SHARED_OPAQUE_MATERIAL_KEY,
  type CSMRenderer,
} from "@voxelize/core";
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  type Camera,
  Group,
  Matrix4,
  Quaternion,
  Scene,
  Sphere,
  Vector3,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";

import { chunkKey, chunksAround } from "./lod";
import type { ViewerMaterials } from "./materials";
import type {
  MeshedChunk,
  MeshGroup,
  MeshWorkerInit,
  MeshWorkerLoad,
  MeshWorkerResult,
} from "./mesh-worker";
import { PoolPage, SectionPool, type SectionSlot } from "./section-pool";

/** Bytes a chunk's geometry of one material copies into its pool. */
const groupBytes = (g: MeshGroup) =>
  g.positions.byteLength +
  g.uvs.byteLength +
  g.lights.byteLength +
  g.indices.byteLength +
  g.normals.byteLength +
  g.lightTwist.byteLength +
  g.biomeTint.byteLength;

export type ChunkLayerOptions = {
  workerUrl: string;
  workers: number;
  batchSize: number;
  maxInFlight: number;
  /**
   * Bytes copied into the pools per frame: geometry, and any pool page
   * made, which three uploads whole.
   */
  uploadBytesPerFrame: number;
  /** Rings kept past the wanted radius before a chunk is let go. */
  keepRings: number;
  /**
   * The fewest vertices a pool page holds: the shared opaque material's
   * (nearly every vertex), and every other material's (a block with its own
   * texture may cover a few faces in all). A page holds more where its
   * sections are big.
   */
  pageVertices: number;
  otherPageVertices: number;
};

export const DEFAULT_CHUNK_LAYER_OPTIONS: ChunkLayerOptions = {
  workerUrl: "/viewer-worker.js",
  workers: 2,
  batchSize: 12,
  maxInFlight: 4,
  // Keeps pace with the backend (about 200 chunks a second) at 60 fps; 8 MB
  // let a pan's arrivals swamp the GPU under load (64 fps against 105).
  uploadBytesPerFrame: 3 * 1024 * 1024,
  keepRings: 3,
  pageVertices: 1 << 19,
  otherPageVertices: 1 << 12,
};

type Resident = {
  cx: number;
  cz: number;
  /** The chunk's sections, by the pool they sit in. */
  sections: { pool: SectionPool; slot: SectionSlot }[];
  summary: MeshedChunk["summary"];
  vertices: number;
};

/** One material's pool, whose group carries its draw order and visibility. */
type MaterialPool = {
  pool: SectionPool;
  /** A material that never shades the ground below it (water, glass). */
  skipsShadow: boolean;
};

const matrix = new Matrix4();
const offset = new Vector3();
const scale = new Vector3();
const noRotation = new Quaternion();

export type ChunkLayerStats = {
  wanted: number;
  resident: number;
  pending: number;
  queued: number;
  requests: number;
  failures: number;
  lastError: string | null;
  chunksLoaded: number;
  bytesLoaded: number;
  vertices: number;
  lastBatchMs: number;
  peakUploadMs: number;
  /** Materials with a pool, the pool pages (one multi-draw each a pass) and their sections. */
  materials: number;
  pages: number;
  sections: number;
  /** Vertices the pages hold, in use or not. */
  capacity: number;
};

/** The slice of the sun's shadow maps a chunk layer reports its pools to. */
export type ChunkShadowCasters = Pick<
  CSMRenderer,
  "addNeverCaster" | "removeNeverCaster"
>;

export class ChunkLayer {
  readonly group = new Group();

  readonly stats: ChunkLayerStats = {
    wanted: 0,
    resident: 0,
    pending: 0,
    queued: 0,
    requests: 0,
    failures: 0,
    lastError: null,
    chunksLoaded: 0,
    bytesLoaded: 0,
    vertices: 0,
    lastBatchMs: 0,
    peakUploadMs: 0,
    materials: 0,
    pages: 0,
    sections: 0,
    capacity: 0,
  };

  /** Bumps whenever the set of meshed chunks changes. */
  generation = 0;

  private resident = new Map<string, Resident>();

  private pools = new Map<string, MaterialPool>();

  private readonly positionUnits: number;

  private pending = new Set<string>();

  private queue: MeshedChunk[] = [];

  private wanted: [number, number][] = [];

  private wantedKeys = new Set<string>();

  private workers: Worker[] = [];

  private nextWorker = 0;

  private nextId = 1;

  private inFlight = new Map<number, string[]>();

  private visibility = { water: true, plants: true };

  private shadowCasters: ChunkShadowCasters | null = null;

  private options: ChunkLayerOptions;

  constructor(
    private readonly url: string,
    private readonly materials: ViewerMaterials,
    readonly chunkSize: number,
    options: Partial<ChunkLayerOptions> = {},
  ) {
    this.options = { ...DEFAULT_CHUNK_LAYER_OPTIONS, ...options };
    this.group.name = "viewer-chunks";
    this.group.matrixAutoUpdate = false;
    const tables = materials.keyTables();
    this.positionUnits = tables.positionUnits;
    const init: MeshWorkerInit = { type: "init", ...tables };
    for (let i = 0; i < this.options.workers; i++) {
      const worker = new Worker(this.options.workerUrl);
      worker.onmessage = (event: MessageEvent<MeshWorkerResult>) =>
        this.receive(event.data);
      worker.postMessage(init);
      this.workers.push(worker);
    }
  }

  /**
   * Keep the pool of every material that skips shadows (water, glass) out
   * of the sun's shadow maps, now and as they are made. A depth pass draws
   * every visible mesh whatever its `castShadow`, so without this they
   * would shade the ground beneath them.
   */
  setShadowCasters(casters: ChunkShadowCasters | null) {
    for (const { pool, skipsShadow } of this.pools.values()) {
      if (!skipsShadow) continue;
      this.shadowCasters?.removeNeverCaster(pool.group);
      casters?.addNeverCaster(pool.group);
    }
    this.shadowCasters = casters;
  }

  /** The pools' pages and slots, summed over materials. */
  get poolStats() {
    const out = {
      materials: this.pools.size,
      pages: 0,
      slots: 0,
      freeSlots: 0,
      capacity: 0,
      reserved: 0,
    };
    for (const { pool } of this.pools.values()) {
      const s = pool.stats;
      out.pages += s.pages;
      out.slots += s.slots;
      out.freeSlots += s.freeSlots;
      out.capacity += s.capacity;
      out.reserved += s.reserved;
    }
    return out;
  }

  /**
   * Links every chunk material's batched program for drawing into `target`
   * under `scene`'s fog and lights, before the first chunk lands: linked on
   * first use instead, each held a frame of a pan for 10-55 ms. Resolves
   * once the programs are ready (in parallel where the browser can).
   */
  async warm(
    renderer: WebGLRenderer,
    camera: Camera,
    target: WebGLRenderTarget,
    scene: Scene,
  ) {
    const holder = new Scene();
    const pages: PoolPage[] = [];
    for (const material of new Set(
      this.materials.chunkRenderer.materials.values(),
    )) {
      const quantized =
        material.defines?.POSITION_UNITS_PER_BLOCK !== undefined;
      const geometry = new BufferGeometry();
      geometry.setAttribute(
        "position",
        new BufferAttribute(
          quantized ? new Uint16Array(9) : new Float32Array(9),
          3,
        ),
      );
      geometry.setAttribute(
        "uv",
        new BufferAttribute(
          quantized ? new Uint16Array(6) : new Float32Array(6),
          2,
          quantized,
        ),
      );
      geometry.setAttribute("light", new BufferAttribute(new Int32Array(3), 1));
      geometry.setAttribute(
        "lightTwist",
        new BufferAttribute(new Uint8Array(12), 4),
      );
      geometry.setAttribute(
        "biomeTint",
        new BufferAttribute(new Uint8Array(9), 3, true),
      );
      geometry.setAttribute(
        "normal",
        new BufferAttribute(
          quantized ? new Int8Array(9) : new Float32Array(9),
          3,
          quantized,
        ),
      );
      geometry.setIndex(new BufferAttribute(new Uint32Array([0, 1, 2]), 1));
      const page = new PoolPage(1, 3, 3, material);
      page.addInstance(page.addGeometry(geometry));
      holder.add(page);
      pages.push(page);
    }
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    const ready = renderer.compileAsync(holder, camera, scene);
    renderer.setRenderTarget(previous);
    try {
      await ready;
    } finally {
      for (const page of pages) page.dispose();
    }
  }

  /** Sets what is wanted around (x, z) and spends this frame's budget. */
  update(x: number, z: number, radius: number) {
    const cx = Math.floor(x / this.chunkSize);
    const cz = Math.floor(z / this.chunkSize);
    this.wanted = chunksAround(cx, cz, radius);
    this.wantedKeys = new Set(this.wanted.map(([a, b]) => chunkKey(a, b)));
    this.request();
    this.upload();
    this.evict(cx, cz, radius + this.options.keepRings);
    this.stats.wanted = this.wanted.length;
    this.stats.resident = this.resident.size;
    this.stats.pending = this.pending.size;
    this.stats.queued = this.queue.length;
    const pools = this.poolStats;
    this.stats.materials = pools.materials;
    this.stats.pages = pools.pages;
    this.stats.sections = pools.slots;
    this.stats.capacity = pools.capacity;
  }

  /** Every wanted chunk is meshed (or known empty) and nothing is in flight. */
  isIdle() {
    if (this.queue.length || this.inFlight.size) return false;
    return this.wanted.every(([a, b]) => this.resident.has(chunkKey(a, b)));
  }

  setVisibility(visibility: { water: boolean; plants: boolean }) {
    if (
      visibility.water === this.visibility.water &&
      visibility.plants === this.visibility.plants
    )
      return;
    this.visibility = { ...visibility };
    for (const [material, { pool }] of this.pools)
      pool.group.visible = this.isVisible(material);
  }

  forEachMeshed(callback: (cx: number, cz: number) => void) {
    for (const r of this.resident.values()) {
      if (r.sections.length) callback(r.cx, r.cz);
    }
  }

  /** Top of the column (ground with `ground: true`), or null when not loaded. */
  heightAt(x: number, z: number, ground = false): number | null {
    const size = this.chunkSize;
    const cx = Math.floor(x / size);
    const cz = Math.floor(z / size);
    const r = this.resident.get(chunkKey(cx, cz));
    if (!r?.summary) return null;
    const i = (Math.floor(z) - cz * size) * size + (Math.floor(x) - cx * size);
    const y = ground ? r.summary.ground[i] : r.summary.top[i];
    return y > 0 ? y : null;
  }

  /** The block at the top of a loaded column. */
  topAt(
    x: number,
    z: number,
  ): { top: number; id: number; water: number } | null {
    const size = this.chunkSize;
    const cx = Math.floor(x / size);
    const cz = Math.floor(z / size);
    const r = this.resident.get(chunkKey(cx, cz));
    if (!r?.summary) return null;
    const i = (Math.floor(z) - cz * size) * size + (Math.floor(x) - cx * size);
    return {
      top: r.summary.top[i],
      id: r.summary.topId[i],
      water: r.summary.water[i],
    };
  }

  dispose() {
    for (const worker of this.workers) worker.terminate();
    for (const { pool, skipsShadow } of this.pools.values()) {
      if (skipsShadow) this.shadowCasters?.removeNeverCaster(pool.group);
      pool.dispose();
      this.group.remove(pool.group);
    }
    this.pools.clear();
    this.resident.clear();
  }

  private isVisible(material: string) {
    if (!this.visibility.water && this.materials.isFluid(material))
      return false;
    if (!this.visibility.plants && this.materials.isCutout(material))
      return false;
    return true;
  }

  private request() {
    while (this.inFlight.size < this.options.maxInFlight) {
      const batch: string[] = [];
      for (const [a, b] of this.wanted) {
        const key = chunkKey(a, b);
        if (this.resident.has(key) || this.pending.has(key)) continue;
        batch.push(key);
        if (batch.length >= this.options.batchSize) break;
      }
      if (batch.length === 0) return;
      const id = this.nextId++;
      for (const key of batch) this.pending.add(key);
      this.inFlight.set(id, batch);
      const message: MeshWorkerLoad = {
        type: "load",
        id,
        url: this.url,
        body: JSON.stringify({
          chunks: batch.map((k) => k.split(",").map(Number)),
        }),
      };
      this.workers[this.nextWorker++ % this.workers.length].postMessage(
        message,
      );
      this.stats.requests += 1;
    }
  }

  private receive(result: MeshWorkerResult) {
    const batch = this.inFlight.get(result.id) ?? [];
    this.inFlight.delete(result.id);
    if (result.type === "failed") {
      for (const key of batch) this.pending.delete(key);
      this.stats.failures += 1;
      this.stats.lastError = result.error;
      console.error(`[viewer] chunk batch failed: ${result.error}`);
      return;
    }
    this.stats.lastBatchMs = result.ms;
    this.stats.bytesLoaded += result.bytes;
    for (const chunk of result.chunks) this.queue.push(chunk);
  }

  private upload() {
    const started = performance.now();
    let bytes = 0;
    while (bytes < this.options.uploadBytesPerFrame) {
      const chunk = this.queue.shift();
      if (!chunk) break;
      const key = chunkKey(chunk.cx, chunk.cz);
      this.pending.delete(key);
      if (!this.wantedKeys.has(key)) continue;
      const old = this.resident.get(key);
      if (old) this.release(old);
      const sections = chunk.groups.map((g) => {
        bytes += groupBytes(g);
        return this.place(chunk, g);
      });
      // A page made this frame is uploaded whole: it spends the budget too.
      for (const { pool } of this.pools.values()) bytes += pool.takeMadeBytes();
      this.resident.set(key, {
        cx: chunk.cx,
        cz: chunk.cz,
        sections,
        summary: chunk.summary,
        vertices: chunk.vertices,
      });
      this.stats.vertices += chunk.vertices;
      this.stats.chunksLoaded += 1;
      this.generation += 1;
    }
    this.stats.peakUploadMs = Math.max(
      this.stats.peakUploadMs,
      performance.now() - started,
    );
  }

  /** Copies one chunk's geometry of a material into its material's pool. */
  private place(chunk: MeshedChunk, g: MeshGroup) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(g.positions, 3));
    geometry.setAttribute("uv", new BufferAttribute(g.uvs, 2, g.quantized));
    geometry.setAttribute("light", new BufferAttribute(g.lights, 1));
    geometry.setAttribute("lightTwist", new BufferAttribute(g.lightTwist, 4));
    geometry.setAttribute(
      "biomeTint",
      new BufferAttribute(g.biomeTint, 3, true),
    );
    geometry.setAttribute(
      "normal",
      new BufferAttribute(g.normals, 3, g.quantized),
    );
    geometry.setIndex(new BufferAttribute(g.indices, 1));
    // The pool culls each section by its geometry's bounds, in the units
    // its positions are stored in; the section's matrix maps them to the
    // world (and dequantizes, as the game's arenas do).
    const size = chunk.chunkSize;
    const box = new Box3(
      new Vector3(-1, g.minY - 1, -1),
      new Vector3(size + 1, g.maxY + 1, size + 1),
    );
    const x = chunk.cx * size;
    const z = chunk.cz * size;
    if (g.quantized) {
      const units = this.positionUnits;
      box.min.addScalar(POSITION_BLOCK_BIAS).multiplyScalar(units);
      box.max.addScalar(POSITION_BLOCK_BIAS).multiplyScalar(units);
      matrix.compose(
        offset.set(
          x - POSITION_BLOCK_BIAS,
          -POSITION_BLOCK_BIAS,
          z - POSITION_BLOCK_BIAS,
        ),
        noRotation,
        scale.setScalar(1 / units),
      );
    } else {
      matrix.makeTranslation(x, 0, z);
    }
    geometry.boundingBox = box;
    geometry.boundingSphere = box.getBoundingSphere(new Sphere());
    const { pool } = this.poolFor(g.material);
    return { pool, slot: pool.add(geometry, matrix) };
  }

  private poolFor(key: string): MaterialPool {
    const existing = this.pools.get(key);
    if (existing) return existing;
    const material =
      this.materials.materialFor(key) ??
      this.materials.materialFor(SHARED_OPAQUE_MATERIAL_KEY);
    if (!material) {
      throw new Error(
        `no material ${key} and no shared opaque material to fall back on`,
      );
    }
    const pool = new SectionPool(
      material,
      key === SHARED_OPAQUE_MATERIAL_KEY
        ? this.options.pageVertices
        : this.options.otherPageVertices,
      material.transparent,
    );
    pool.group.name = `viewer-chunks-${key}`;
    // A group's render order sorts everything under it, as a mesh's did.
    if (material.transparent && !material.depthWrite)
      pool.group.renderOrder = 2;
    else if (material.transparent) pool.group.renderOrder = 1;
    pool.group.visible = this.isVisible(key);
    this.group.add(pool.group);
    const skipsShadow = material.userData.skipShadow === true;
    if (skipsShadow) this.shadowCasters?.addNeverCaster(pool.group);
    const entry: MaterialPool = { pool, skipsShadow };
    this.pools.set(key, entry);
    return entry;
  }

  private release(r: Resident) {
    for (const { pool, slot } of r.sections) pool.remove(slot);
    this.stats.vertices -= r.vertices;
  }

  private evict(cx: number, cz: number, keep: number) {
    const limit = keep * keep;
    for (const [key, r] of this.resident) {
      const dx = r.cx - cx;
      const dz = r.cz - cz;
      if (dx * dx + dz * dz > limit && !this.wantedKeys.has(key)) {
        this.release(r);
        this.resident.delete(key);
        this.generation += 1;
      }
    }
  }
}
