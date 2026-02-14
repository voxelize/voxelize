import { ChunkProtocol } from "@voxelize/protocol";

import { Coords2 } from "../../types";
import { ChunkUtils } from "../../utils";

import { Chunk } from "./chunk";

export type ChunkStage =
  | { stage: "requested"; retryCount: number; cx: number; cz: number }
  | { stage: "processing"; source: "update" | "load"; data: ChunkProtocol }
  | { stage: "loaded"; chunk: Chunk };

type StageType = ChunkStage["stage"];

const normalizeFiniteNonNegativeLimit = (value: number): number => {
  if (value === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY;
  }
  if (Number.isSafeInteger(value)) {
    return value > 0 ? value : 0;
  }
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
};

const incrementRetryCountSafely = (retryCount: number) =>
  !Number.isFinite(retryCount) || retryCount < 0
    ? 1
    : retryCount >= Number.MAX_SAFE_INTEGER
    ? Number.MAX_SAFE_INTEGER
    : Number.isSafeInteger(retryCount)
    ? retryCount + 1
    : Math.floor(retryCount) + 1;

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
      state.retryCount = incrementRetryCountSafely(state.retryCount);
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

  getRequestedCoords(
    name: string
  ): { cx: number; cz: number; retryCount: number } | undefined {
    const state = this.states.get(name);
    return state?.stage === "requested" ? state : undefined;
  }

  shouldRequestAt(cx: number, cz: number, chunkRerequestInterval: number) {
    const rerequestLimit = normalizeFiniteNonNegativeLimit(
      chunkRerequestInterval
    );

    const name = ChunkUtils.getChunkNameAt(cx, cz);
    const state = this.states.get(name);

    if (!state) {
      return true;
    }

    if (state.stage === "loaded" || state.stage === "processing") {
      return false;
    }

    state.retryCount = incrementRetryCountSafely(state.retryCount);
    if (state.retryCount > rerequestLimit) {
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
    let names = this.indices.loaded.values();
    let name = names.next();
    while (!name.done) {
      const chunkName = name.value;
      const state = this.states.get(chunkName);
      if (state?.stage === "loaded") {
        yield [chunkName, state.chunk];
      }
      name = names.next();
    }
  }

  *processingEntries(): IterableIterator<[string, ChunkProtocol]> {
    let names = this.indices.processing.values();
    let name = names.next();
    while (!name.done) {
      const chunkName = name.value;
      const state = this.states.get(chunkName);
      if (state?.stage === "processing") {
        yield [chunkName, state.data];
      }
      name = names.next();
    }
  }

  *requestedEntries(): IterableIterator<[string, number, number]> {
    let names = this.indices.requested.values();
    let name = names.next();
    while (!name.done) {
      const chunkName = name.value;
      const state = this.states.get(chunkName);
      if (state?.stage === "requested") {
        yield [chunkName, state.cx, state.cz];
      }
      name = names.next();
    }
  }

  forEach(stage: StageType, callback: (name: string) => void): void {
    let names = this.indices[stage].values();
    let name = names.next();
    while (!name.done) {
      callback(name.value);
      name = names.next();
    }
  }

  forEachLoaded(callback: (chunk: Chunk, name: string) => void): void {
    let names = this.indices.loaded.values();
    let name = names.next();
    while (!name.done) {
      const chunkName = name.value;
      const state = this.states.get(chunkName);
      if (state?.stage === "loaded") {
        callback(state.chunk, chunkName);
      }
      name = names.next();
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
  private inFlightCount = 0;

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
    return (
      state !== undefined &&
      state.inFlightGeneration === null &&
      state.generation !== state.displayedGeneration
    );
  }

  startJob(key: string): MeshState | null {
    const state = this.states.get(key);
    if (!state) {
      return null;
    }
    if (
      state.inFlightGeneration !== null ||
      state.generation === state.displayedGeneration
    ) {
      return null;
    }

    this.inFlightCount++;
    state.inFlightGeneration = state.generation;
    this.dirty.delete(key);
    return state;
  }

  abortJob(key: string): number {
    const state = this.states.get(key);
    if (!state) {
      return 0;
    }

    if (state.inFlightGeneration !== null) {
      this.inFlightCount--;
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

    if (state.inFlightGeneration !== null) {
      this.inFlightCount--;
    }
    state.inFlightGeneration = null;
    const displayedGeneration = state.displayedGeneration;

    let status = 0;
    if (jobGeneration < displayedGeneration) {
      if (state.generation > displayedGeneration) {
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
    if (state.inFlightGeneration !== null) {
      this.inFlightCount--;
    }
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
    const normalizedMaxCount = normalizeFiniteNonNegativeLimit(maxCount);
    if (normalizedMaxCount <= 0) {
      return { keys: [], hasMore: false };
    }
    if (this.dirty.size === 0) {
      return { keys: [], hasMore: false };
    }
    const states = this.states;
    const dirty = this.dirty;

    const hasFiniteLimit = normalizedMaxCount !== Number.POSITIVE_INFINITY;
    if (!hasFiniteLimit) {
      const dirtyKeys: string[] = [];
      let dirtyEntries = dirty.values();
      let dirtyEntry = dirtyEntries.next();
      while (!dirtyEntry.done) {
        const key = dirtyEntry.value;
        const state = states.get(key);
        if (!state) {
          dirty.delete(key);
          dirtyEntry = dirtyEntries.next();
          continue;
        }
        if (
          state.inFlightGeneration === null &&
          state.generation !== state.displayedGeneration
        ) {
          dirtyKeys.push(key);
        } else if (state.inFlightGeneration === null) {
          dirty.delete(key);
        }
        dirtyEntry = dirtyEntries.next();
      }
      return {
        keys: dirtyKeys,
        hasMore: false,
      };
    }

    const dirtyKeys = new Array<string>(
      Math.min(dirty.size, normalizedMaxCount)
    );
    let dirtyCount = 0;
    let hasMore = false;

    let dirtyEntries = dirty.values();
    let dirtyEntry = dirtyEntries.next();
    while (!dirtyEntry.done) {
      const key = dirtyEntry.value;
      const state = states.get(key);
      if (!state) {
        dirty.delete(key);
        dirtyEntry = dirtyEntries.next();
        continue;
      }
      if (state.inFlightGeneration !== null) {
        dirtyEntry = dirtyEntries.next();
        continue;
      }
      if (state.generation === state.displayedGeneration) {
        dirty.delete(key);
        dirtyEntry = dirtyEntries.next();
        continue;
      }

      if (dirtyCount >= normalizedMaxCount) {
        hasMore = true;
        break;
      }

      dirtyKeys[dirtyCount] = key;
      dirtyCount++;
      dirtyEntry = dirtyEntries.next();
    }
    dirtyKeys.length = dirtyCount;
    return {
      keys: dirtyKeys,
      hasMore,
    };
  }

  hasDirtyChunks(): boolean {
    if (this.dirty.size === 0) {
      return false;
    }
    const states = this.states;
    const dirty = this.dirty;

    let dirtyEntries = dirty.values();
    let dirtyEntry = dirtyEntries.next();
    while (!dirtyEntry.done) {
      const key = dirtyEntry.value;
      const state = states.get(key);
      if (!state) {
        dirty.delete(key);
        dirtyEntry = dirtyEntries.next();
        continue;
      }
      if (state.inFlightGeneration !== null) {
        dirtyEntry = dirtyEntries.next();
        continue;
      }
      if (state.generation === state.displayedGeneration) {
        dirty.delete(key);
        dirtyEntry = dirtyEntries.next();
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
    const states = this.states;
    const dirty = this.dirty;

    let keyEntries = keys.values();
    let keyEntry = keyEntries.next();
    while (!keyEntry.done) {
      const key = keyEntry.value;
      const state = states.get(key);
      if (state !== undefined && state.inFlightGeneration !== null) {
        this.inFlightCount--;
      }
      states.delete(key);
      dirty.delete(key);
      keyEntry = keyEntries.next();
    }
    this.keysByChunk.delete(chunkKey);
  }

  hasInFlightJob(key: string): boolean {
    const state = this.states.get(key);
    return state !== undefined && state.inFlightGeneration !== null;
  }

  hasAnyInFlightJobs(): boolean {
    return this.inFlightCount > 0;
  }
}
