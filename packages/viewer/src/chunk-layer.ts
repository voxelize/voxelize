/**
 * The meshed chunks around the focus for one source: which are wanted,
 * which are on their way (workers fetch and build them off the main
 * thread), and which become meshes this frame. Turning arrays into GPU
 * buffers is the only main-thread work, and it is spent under a byte budget
 * per frame so a burst of arrivals never lands as one long frame.
 */
import { SHARED_OPAQUE_MATERIAL_KEY, type CSMRenderer } from "@voxelize/core";
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  Sphere,
  Vector3,
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

export type ChunkLayerOptions = {
  workerUrl: string;
  workers: number;
  batchSize: number;
  maxInFlight: number;
  /** Bytes of vertex data turned into meshes per frame. */
  uploadBytesPerFrame: number;
  /** Rings kept past the wanted radius before a chunk is let go. */
  keepRings: number;
};

export const DEFAULT_CHUNK_LAYER_OPTIONS: ChunkLayerOptions = {
  workerUrl: "/viewer-worker.js",
  workers: 2,
  batchSize: 12,
  maxInFlight: 4,
  uploadBytesPerFrame: 8 * 1024 * 1024,
  keepRings: 3,
};

type Resident = {
  cx: number;
  cz: number;
  meshes: Mesh[];
  summary: MeshedChunk["summary"];
  vertices: number;
};

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
};

/** The slice of the sun's shadow maps a chunk layer reports its meshes to. */
export type ChunkShadowCasters = Pick<
  CSMRenderer,
  "addSkipShadowObject" | "removeSkipShadowObject"
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
  };

  /** Bumps whenever the set of meshed chunks changes. */
  generation = 0;

  private resident = new Map<string, Resident>();

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
    const init: MeshWorkerInit = { type: "init", ...materials.keyTables() };
    for (let i = 0; i < this.options.workers; i++) {
      const worker = new Worker(this.options.workerUrl);
      worker.onmessage = (event: MessageEvent<MeshWorkerResult>) =>
        this.receive(event.data);
      worker.postMessage(init);
      this.workers.push(worker);
    }
  }

  /**
   * Report every mesh, now and as they stream, to the sun's shadow maps. A
   * depth pass draws every visible mesh whatever its `castShadow`, so a mesh
   * whose material skips shadows (water, glass) has to be on their list or
   * it shades the ground beneath it.
   */
  setShadowCasters(casters: ChunkShadowCasters | null) {
    for (const r of this.resident.values()) {
      for (const mesh of r.meshes) {
        this.shadowCasters?.removeSkipShadowObject(mesh);
        casters?.addSkipShadowObject(mesh);
      }
    }
    this.shadowCasters = casters;
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
  }

  /** Every wanted chunk is meshed (or known empty) and nothing is in flight. */
  isIdle() {
    if (this.queue.length || this.inFlight.size) return false;
    return this.wanted.every(([a, b]) => this.resident.has(chunkKey(a, b)));
  }

  setVisibility(visibility: { water: boolean; plants: boolean }) {
    this.visibility = visibility;
    for (const r of this.resident.values()) {
      for (const mesh of r.meshes)
        mesh.visible = this.isVisible(mesh.userData.material);
    }
  }

  forEachMeshed(callback: (cx: number, cz: number) => void) {
    for (const r of this.resident.values()) {
      if (r.meshes.length) callback(r.cx, r.cz);
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
    for (const r of this.resident.values()) this.release(r);
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
      const meshes = chunk.groups.map((g) => this.mesh(chunk, g));
      for (const g of chunk.groups) bytes += g.positions.byteLength * 2;
      this.resident.set(key, {
        cx: chunk.cx,
        cz: chunk.cz,
        meshes,
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

  private mesh(chunk: MeshedChunk, g: MeshGroup): Mesh {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(g.positions, 3));
    geometry.setAttribute("uv", new BufferAttribute(g.uvs, 2));
    geometry.setAttribute("light", new BufferAttribute(g.lights, 1));
    geometry.setAttribute("lightTwist", new BufferAttribute(g.lightTwist, 4));
    geometry.setAttribute(
      "biomeTint",
      new BufferAttribute(g.biomeTint, 3, true),
    );
    geometry.setAttribute("normal", new BufferAttribute(g.normals, 3));
    geometry.setIndex(new BufferAttribute(g.indices, 1));
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < g.positions.length; i += 3) {
      const y = g.positions[i];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    geometry.boundingBox = new Box3(
      new Vector3(-1, minY - 1, -1),
      new Vector3(chunk.chunkSize + 1, maxY + 1, chunk.chunkSize + 1),
    );
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(
      new Sphere(),
    );
    const material =
      this.materials.materialFor(g.material) ??
      this.materials.materialFor(SHARED_OPAQUE_MATERIAL_KEY);
    if (!material) {
      throw new Error(
        `no material ${g.material} and no shared opaque material to fall back on`,
      );
    }
    const mesh = new Mesh(geometry, material);
    mesh.userData.material = g.material;
    mesh.position.set(
      chunk.cx * chunk.chunkSize,
      0,
      chunk.cz * chunk.chunkSize,
    );
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.castShadow = !material.userData.skipShadow;
    mesh.receiveShadow = true;
    if (material.transparent && !material.depthWrite) mesh.renderOrder = 2;
    else if (material.transparent) mesh.renderOrder = 1;
    mesh.visible = this.isVisible(g.material);
    this.group.add(mesh);
    mesh.updateMatrixWorld();
    this.shadowCasters?.addSkipShadowObject(mesh);
    return mesh;
  }

  private release(r: Resident) {
    for (const mesh of r.meshes) {
      this.shadowCasters?.removeSkipShadowObject(mesh);
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
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
