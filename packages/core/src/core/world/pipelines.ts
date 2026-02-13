import { ChunkProtocol } from "@voxelize/protocol";

import { Coords2 } from "../../types";
import { ChunkUtils } from "../../utils";

import { Chunk } from "./chunk";

export type ChunkStage =
  | { stage: "requested"; retryCount: number; cx: number; cz: number }
  | { stage: "processing"; source: "update" | "load"; data: ChunkProtocol }
  | { stage: "loaded"; chunk: Chunk };

type StageType = ChunkStage["stage"];

export class ChunkPipeline {
  private states = new Map<string, ChunkStage>();
  private indices: Record<StageType, Set<string>> = {
    requested: new Set(),
    processing: new Set(),
    loaded: new Set(),
  };

  private setStage(name: string, stage: ChunkStage): void {
    const old = this.states.get(name);
    if (old) {
      this.indices[old.stage].delete(name);
    }
    this.states.set(name, stage);
    this.indices[stage.stage].add(name);
  }

  getStage(name: string): StageType | null {
    return this.states.get(name)?.stage ?? null;
  }

  isInStage(name: string, stage: StageType): boolean {
    return this.indices[stage].has(name);
  }

  getInStage(stage: StageType): Set<string> {
    return this.indices[stage];
  }

  markRequested(coords: Coords2): void {
    this.markRequestedAt(coords[0], coords[1]);
  }

  markRequestedAt(cx: number, cz: number): void {
    const name = ChunkUtils.getChunkNameAt(cx, cz);
    this.setStage(name, {
      stage: "requested",
      retryCount: 0,
      cx,
      cz,
    });
  }

  incrementRetry(name: string): number {
    const state = this.states.get(name);
    if (state?.stage === "requested") {
      state.retryCount++;
      return state.retryCount;
    }
    return 0;
  }

  resetRetry(name: string): void {
    const state = this.states.get(name);
    if (state?.stage === "requested") {
      state.retryCount = 0;
    }
  }

  getRetryCount(name: string): number {
    const state = this.states.get(name);
    return state?.stage === "requested" ? state.retryCount : 0;
  }

  shouldRequestAt(cx: number, cz: number, chunkRerequestInterval: number) {
    const name = ChunkUtils.getChunkNameAt(cx, cz);
    const state = this.states.get(name);

    if (!state) {
      return true;
    }

    if (state.stage === "loaded" || state.stage === "processing") {
      return false;
    }

    state.retryCount++;
    if (state.retryCount > chunkRerequestInterval) {
      this.indices.requested.delete(name);
      this.states.delete(name);
      return true;
    }

    return false;
  }

  markProcessing(
    coords: Coords2,
    source: "update" | "load",
    data: ChunkProtocol
  ): void {
    this.markProcessingAt(coords[0], coords[1], source, data);
  }

  markProcessingAt(
    cx: number,
    cz: number,
    source: "update" | "load",
    data: ChunkProtocol
  ): void {
    const name = ChunkUtils.getChunkNameAt(cx, cz);
    const existing = this.states.get(name);

    if (existing?.stage === "processing") {
      const merged = existing.data;
      merged.id = data.id;
      merged.x = data.x;
      merged.z = data.z;

      if (data.meshes && data.meshes.length > 0) {
        merged.meshes = data.meshes;
      }
      if (data.voxels !== undefined) {
        merged.voxels = data.voxels;
      }
      if (data.lights !== undefined) {
        merged.lights = data.lights;
      }

      existing.source = source;
      return;
    }

    this.setStage(name, { stage: "processing", source, data });
  }

  markLoaded(coords: Coords2, chunk: Chunk): void {
    this.markLoadedAt(coords[0], coords[1], chunk);
  }

  markLoadedAt(cx: number, cz: number, chunk: Chunk): void {
    const name = ChunkUtils.getChunkNameAt(cx, cz);
    this.setStage(name, { stage: "loaded", chunk });
  }

  getLoadedChunk(name: string): Chunk | undefined {
    const state = this.states.get(name);
    return state?.stage === "loaded" ? state.chunk : undefined;
  }

  getLoadedChunkAt(cx: number, cz: number): Chunk | undefined {
    const state = this.states.get(ChunkUtils.getChunkNameAt(cx, cz));
    return state?.stage === "loaded" ? state.chunk : undefined;
  }

  getProcessingData(
    name: string
  ): { source: "update" | "load"; data: ChunkProtocol } | undefined {
    const state = this.states.get(name);
    return state?.stage === "processing" ? state : undefined;
  }

  getProcessingChunkData(name: string): ChunkProtocol | undefined {
    const state = this.states.get(name);
    return state?.stage === "processing" ? state.data : undefined;
  }

  remove(name: string): Chunk | undefined {
    const state = this.states.get(name);
    if (!state) {
      return undefined;
    }

    this.indices[state.stage].delete(name);
    this.states.delete(name);
    return state.stage === "loaded" ? state.chunk : undefined;
  }

  *loadedEntries(): IterableIterator<[string, Chunk]> {
    for (const name of this.indices.loaded) {
      const state = this.states.get(name);
      if (state?.stage === "loaded") {
        yield [name, state.chunk];
      }
    }
  }

  *processingEntries(): IterableIterator<[string, ChunkProtocol]> {
    for (const name of this.indices.processing) {
      const state = this.states.get(name);
      if (state?.stage === "processing") {
        yield [name, state.data];
      }
    }
  }

  *requestedEntries(): IterableIterator<[string, number, number]> {
    for (const name of this.indices.requested) {
      const state = this.states.get(name);
      if (state?.stage === "requested") {
        yield [name, state.cx, state.cz];
      }
    }
  }

  forEach(stage: StageType, callback: (name: string) => void): void {
    this.indices[stage].forEach(callback);
  }

  forEachLoaded(callback: (chunk: Chunk, name: string) => void): void {
    for (const [name, chunk] of this.loadedEntries()) {
      callback(chunk, name);
    }
  }

  get loadedCount(): number {
    return this.indices.loaded.size;
  }

  get requestedCount(): number {
    return this.indices.requested.size;
  }

  get processingCount(): number {
    return this.indices.processing.size;
  }

  get totalCount(): number {
    return this.states.size;
  }
}

interface MeshState {
  cx: number;
  cz: number;
  level: number;
  generation: number;
  inFlightGeneration: number | null;
  displayedGeneration: number;
}

export const MESH_JOB_ACCEPTED = 1;
export const MESH_JOB_NEEDS_REMESH = 2;

export class MeshPipeline {
  private states = new Map<string, MeshState>();
  private dirty = new Set<string>();
  private keysByChunk = new Map<string, Set<string>>();

  private static makeChunkKey(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  private indexKeyForChunk(cx: number, cz: number, key: string) {
    const chunkKey = MeshPipeline.makeChunkKey(cx, cz);
    let keys = this.keysByChunk.get(chunkKey);
    if (!keys) {
      keys = new Set();
      this.keysByChunk.set(chunkKey, keys);
    }
    keys.add(key);
  }

  private getOrCreate(
    key: string,
    cx: number,
    cz: number,
    level: number
  ): MeshState {
    let state = this.states.get(key);
    if (!state) {
      state = {
        cx,
        cz,
        level,
        generation: 0,
        inFlightGeneration: null,
        displayedGeneration: 0,
      };
      this.states.set(key, state);
      this.indexKeyForChunk(cx, cz, key);
      return state;
    }
    return state;
  }

  static makeKey(cx: number, cz: number, level: number): string {
    return `${cx},${cz}:${level}`;
  }

  onVoxelChange(cx: number, cz: number, level: number): void {
    const key = MeshPipeline.makeKey(cx, cz, level);
    const state = this.getOrCreate(key, cx, cz, level);
    state.generation++;
    this.dirty.add(key);
  }

  shouldStartJob(key: string): boolean {
    const state = this.states.get(key);
    if (!state) return false;
    if (state.inFlightGeneration !== null) return false;
    if (state.generation === state.displayedGeneration) return false;
    return true;
  }

  startJob(key: string): MeshState | null {
    const state = this.states.get(key);
    if (!state) {
      return null;
    }

    state.inFlightGeneration = state.generation;
    this.dirty.delete(key);
    return state;
  }

  abortJob(key: string): number {
    const state = this.states.get(key);
    if (!state) {
      return 0;
    }

    state.inFlightGeneration = null;
    const needsRemesh = state.generation > state.displayedGeneration;
    if (needsRemesh) {
      this.dirty.add(key);
    }

    return needsRemesh ? MESH_JOB_NEEDS_REMESH : 0;
  }

  onJobComplete(key: string, jobGeneration: number): boolean {
    return (this.completeJobStatus(key, jobGeneration) & MESH_JOB_ACCEPTED) !== 0;
  }

  completeJobStatus(key: string, jobGeneration: number): number {
    const state = this.states.get(key);
    if (!state) {
      return 0;
    }

    state.inFlightGeneration = null;

    let status = 0;
    if (jobGeneration < state.displayedGeneration) {
      if (state.generation > state.displayedGeneration) {
        status |= MESH_JOB_NEEDS_REMESH;
      }
      return status;
    }

    status |= MESH_JOB_ACCEPTED;
    state.displayedGeneration = jobGeneration;
    if (state.generation > state.displayedGeneration) {
      status |= MESH_JOB_NEEDS_REMESH;
    }

    return status;
  }

  needsRemesh(key: string): boolean {
    const state = this.states.get(key);
    if (!state) return false;
    return state.generation > state.displayedGeneration;
  }

  markFreshFromServer(cx: number, cz: number, level: number): void {
    const key = MeshPipeline.makeKey(cx, cz, level);
    const state = this.getOrCreate(key, cx, cz, level);
    state.displayedGeneration = state.generation;
    state.inFlightGeneration = null;
    this.dirty.delete(key);
  }

  getDirtyKeys(maxCount = Number.POSITIVE_INFINITY): string[] {
    return this.getDirtyKeysAndHasMore(maxCount).keys;
  }

  getDirtyKeysAndHasMore(maxCount = Number.POSITIVE_INFINITY): {
    keys: string[];
    hasMore: boolean;
  } {
    if (maxCount <= 0) {
      return { keys: [], hasMore: false };
    }

    const dirtyKeys = new Array<string>(
      Number.isFinite(maxCount)
        ? Math.min(this.dirty.size, maxCount)
        : this.dirty.size
    );
    let dirtyCount = 0;
    let hasMore = false;

    for (const key of this.dirty) {
      const state = this.states.get(key);
      if (!state) {
        this.dirty.delete(key);
        continue;
      }
      if (state.inFlightGeneration !== null) {
        continue;
      }
      if (state.generation === state.displayedGeneration) {
        continue;
      }

      if (dirtyCount >= maxCount) {
        hasMore = true;
        break;
      }

      dirtyKeys[dirtyCount] = key;
      dirtyCount++;
    }

    dirtyKeys.length = dirtyCount;
    return {
      keys: dirtyKeys,
      hasMore,
    };
  }

  hasDirtyChunks(): boolean {
    for (const key of this.dirty) {
      const state = this.states.get(key);
      if (!state) {
        this.dirty.delete(key);
        continue;
      }
      if (state.inFlightGeneration !== null) {
        continue;
      }
      if (state.generation === state.displayedGeneration) {
        continue;
      }

      return true;
    }
    return false;
  }

  remove(cx: number, cz: number): void {
    const chunkKey = MeshPipeline.makeChunkKey(cx, cz);
    const keys = this.keysByChunk.get(chunkKey);
    if (!keys) {
      return;
    }

    for (const key of keys) {
      this.states.delete(key);
      this.dirty.delete(key);
    }
    this.keysByChunk.delete(chunkKey);
  }

  hasInFlightJob(key: string): boolean {
    const state = this.states.get(key);
    return state?.inFlightGeneration !== null;
  }

  hasAnyInFlightJobs(): boolean {
    for (const state of this.states.values()) {
      if (state.inFlightGeneration !== null) return true;
    }
    return false;
  }
}
