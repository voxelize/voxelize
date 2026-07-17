import { ChunkProtocol } from "@voxelize/protocol";

import { Coords2 } from "../../types";
import { ChunkUtils } from "../../utils";

import { Chunk } from "./chunk";

export type ChunkStage =
  | { stage: "requested"; retryCount: number; requestedAt: number }
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

  private removeStage(name: string): void {
    const old = this.states.get(name);
    if (old) {
      this.indices[old.stage].delete(name);
      this.states.delete(name);
    }
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
    const name = ChunkUtils.getChunkName(coords);
    this.setStage(name, {
      stage: "requested",
      retryCount: 0,
      requestedAt: performance.now(),
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

  markProcessing(
    coords: Coords2,
    source: "update" | "load",
    data: ChunkProtocol,
  ): void {
    const name = ChunkUtils.getChunkName(coords);
    const existing = this.states.get(name);

    if (existing?.stage === "processing") {
      const merged: ChunkProtocol = {
        ...existing.data,
        ...data,
        meshes:
          data.meshes && data.meshes.length > 0
            ? data.meshes
            : existing.data.meshes,
        voxels: data.voxels ?? existing.data.voxels,
        lights: data.lights ?? existing.data.lights,
      };
      this.setStage(name, { stage: "processing", source, data: merged });
    } else {
      this.setStage(name, { stage: "processing", source, data });
    }
  }

  markLoaded(coords: Coords2, chunk: Chunk): void {
    const name = ChunkUtils.getChunkName(coords);
    this.setStage(name, { stage: "loaded", chunk });
  }

  getLoadedChunk(name: string): Chunk | undefined {
    const state = this.states.get(name);
    return state?.stage === "loaded" ? state.chunk : undefined;
  }

  getProcessingData(
    name: string,
  ): { source: "update" | "load"; data: ChunkProtocol } | undefined {
    const state = this.states.get(name);
    return state?.stage === "processing"
      ? { source: state.source, data: state.data }
      : undefined;
  }

  remove(name: string): Chunk | undefined {
    const chunk = this.getLoadedChunk(name);
    this.removeStage(name);
    return chunk;
  }

  resyncForRejoin(): string[] {
    // Requested chunks have no local data and the new server process holds
    // no interest for them: drop them so they are reissued as fresh requests.
    for (const name of [...this.indices.requested]) {
      this.removeStage(name);
    }

    // Processing and loaded chunks keep their local data; the caller
    // re-requests them to re-register server-side interest.
    return [...this.indices.processing, ...this.indices.loaded];
  }

  forEach(stage: StageType, callback: (name: string) => void): void {
    this.indices[stage].forEach(callback);
  }

  forEachLoaded(callback: (chunk: Chunk, name: string) => void): void {
    for (const name of this.indices.loaded) {
      const chunk = this.getLoadedChunk(name);
      if (chunk) callback(chunk, name);
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
  generation: number;
  inFlightGenerations: Set<number>;
  displayedGeneration: number;
}

export class MeshPipeline {
  private states = new Map<string, MeshState>();
  private dirty = new Set<string>();
  private urgentDirty = new Set<string>();

  private getOrCreate(key: string): MeshState {
    let state = this.states.get(key);
    if (!state) {
      state = {
        generation: 0,
        inFlightGenerations: new Set(),
        displayedGeneration: 0,
      };
      this.states.set(key, state);
    }
    return state;
  }

  static makeKey(cx: number, cz: number, level: number): string {
    return `${cx},${cz}:${level}`;
  }

  static parseKey(key: string): { cx: number; cz: number; level: number } {
    const [coordsPart, levelStr] = key.split(":");
    const [cx, cz] = coordsPart.split(",").map(Number);
    return { cx, cz, level: parseInt(levelStr) };
  }

  onVoxelChange(cx: number, cz: number, level: number, isUrgent = false): void {
    const key = MeshPipeline.makeKey(cx, cz, level);
    const state = this.getOrCreate(key);
    state.generation++;
    this.dirty.add(key);
    if (isUrgent) {
      this.urgentDirty.add(key);
    }
  }

  shouldStartJob(key: string): boolean {
    const state = this.states.get(key);
    if (!state) return false;
    if (state.generation === state.displayedGeneration) return false;
    if (state.inFlightGenerations.has(state.generation)) return false;
    return true;
  }

  startJob(key: string): number {
    const state = this.states.get(key);
    if (!state) return 0;
    state.inFlightGenerations.add(state.generation);
    this.dirty.delete(key);
    this.urgentDirty.delete(key);
    return state.generation;
  }

  onJobComplete(key: string, jobGeneration: number): boolean {
    const state = this.states.get(key);
    if (!state) return false;

    state.inFlightGenerations.delete(jobGeneration);

    if (
      jobGeneration < state.displayedGeneration ||
      jobGeneration < state.generation
    ) {
      return false;
    }

    state.displayedGeneration = jobGeneration;
    return true;
  }

  /**
   * Release an in-flight generation that produced no mesh (worker bail-out).
   * Re-queues the key so remesh can retry instead of leaving a permanent
   * ghost mesh when voxel data already changed but geometry never applied.
   */
  failJob(key: string, jobGeneration: number): void {
    const state = this.states.get(key);
    if (!state) return;
    state.inFlightGenerations.delete(jobGeneration);
    this.dirty.add(key);
  }

  needsRemesh(key: string): boolean {
    const state = this.states.get(key);
    if (!state) return false;
    return state.generation > state.displayedGeneration;
  }

  markFreshFromServer(cx: number, cz: number, level: number): void {
    const key = MeshPipeline.makeKey(cx, cz, level);
    let state = this.states.get(key);
    if (!state) {
      state = {
        generation: 0,
        inFlightGenerations: new Set(),
        displayedGeneration: 0,
      };
      this.states.set(key, state);
    }
    state.displayedGeneration = state.generation;
    state.inFlightGenerations.clear();
    this.dirty.delete(key);
    this.urgentDirty.delete(key);
  }

  getDirtyKeys(): string[] {
    const urgentKeys = [...this.urgentDirty].filter((key) =>
      this.shouldStartJob(key),
    );
    const regularKeys = [...this.dirty].filter(
      (key) => !this.urgentDirty.has(key) && this.shouldStartJob(key),
    );
    return [...urgentKeys, ...regularKeys];
  }

  hasDirtyChunks(): boolean {
    for (const key of this.urgentDirty) {
      if (this.shouldStartJob(key)) return true;
    }
    for (const key of this.dirty) {
      if (this.shouldStartJob(key)) return true;
    }
    return false;
  }

  remove(cx: number, cz: number): void {
    const prefix = `${cx},${cz}:`;
    for (const key of this.states.keys()) {
      if (key.startsWith(prefix)) {
        this.states.delete(key);
        this.dirty.delete(key);
        this.urgentDirty.delete(key);
      }
    }
  }

  hasInFlightJob(key: string): boolean {
    const state = this.states.get(key);
    return (state?.inFlightGenerations.size ?? 0) > 0;
  }

  hasAnyInFlightJobs(): boolean {
    for (const state of this.states.values()) {
      if (state.inFlightGenerations.size > 0) return true;
    }
    return false;
  }

  isUrgent(key: string): boolean {
    return this.urgentDirty.has(key);
  }
}
