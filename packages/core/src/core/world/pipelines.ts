import { ChunkProtocol } from "@voxelize/protocol";

import { Coords2 } from "../../types";
import { ChunkUtils } from "../../utils";

import { Chunk } from "./chunk";

export type ChunkStage =
  | {
      stage: "requested";
      /** When the LOAD packet was queued for the next flush. */
      requestedAt: number;
      /** When that packet was handed to the socket, once it has been. */
      sentAt: number | null;
    }
  | {
      stage: "processing";
      source: "update" | "load";
      data: ChunkProtocol;
      requestedAt: number | null;
      sentAt: number | null;
      /** When the first payload's raw bytes reached the client, if known. */
      arrivedAt: number | null;
      /** When the first decoded payload for this chunk reached the main thread. */
      receivedAt: number;
    }
  | {
      stage: "loaded";
      chunk: Chunk;
      requestedAt: number | null;
      sentAt: number | null;
      arrivedAt: number | null;
      receivedAt: number | null;
      loadedAt: number;
    };

type StageType = ChunkStage["stage"];

/**
 * Where a chunk's time went on its way to being renderable, in
 * `performance.now()` milliseconds. Request to sent is this client's own
 * outbound queue (a flush the main thread had to get to); sent to arrive is
 * the server's pipeline plus the wire; arrive to receive is the client's
 * packet queue and worker decode; receive to loaded is its processing queue.
 * A field is null for a stage the chunk never went through here (a chunk
 * pushed by the server unasked has no request time; a payload whose
 * transport did not stamp it has no arrival time).
 */
export interface ChunkLoadTiming {
  requestedAt: number | null;
  sentAt: number | null;
  arrivedAt: number | null;
  receivedAt: number | null;
  loadedAt: number | null;
}

export interface ChunkRoundTrip {
  sentAt: number;
  wireMs: number;
  loadMs: number;
}

/// Enough round trips to cover a teleport's worth of chunks without
/// remembering a whole session.
const RECENT_ROUND_TRIP_CAPACITY = 64;

export class ChunkPipeline {
  private states = new Map<string, ChunkStage>();
  private recentRoundTrips: ChunkRoundTrip[] = [];
  private indices: Record<StageType, Set<string>> = {
    requested: new Set(),
    processing: new Set(),
    loaded: new Set(),
  };

  /**
   * Bumps whenever a chunk enters or leaves the loaded stage. A caller that
   * memoizes a loaded-chunk lookup (the world's by-coords getter) compares
   * against it instead of re-resolving the name on every voxel read.
   */
  public loadedGeneration = 0;

  private setStage(name: string, stage: ChunkStage): void {
    const old = this.states.get(name);
    if (old) {
      this.indices[old.stage].delete(name);
    }
    this.states.set(name, stage);
    this.indices[stage.stage].add(name);
    if (old?.stage === "loaded" || stage.stage === "loaded") {
      this.loadedGeneration++;
    }
  }

  private removeStage(name: string): void {
    const old = this.states.get(name);
    if (old) {
      this.indices[old.stage].delete(name);
      this.states.delete(name);
      if (old.stage === "loaded") {
        this.loadedGeneration++;
      }
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
      requestedAt: performance.now(),
      sentAt: null,
    });
  }

  /** How many send stamps were offered, and how many landed on a waiting request. */
  public sentStampAttempts = 0;
  public sentStampHits = 0;

  /** The queued LOAD for this chunk reached the socket at `sentAt`. */
  markSent(coords: Coords2, sentAt: number): void {
    this.sentStampAttempts += 1;
    const state = this.states.get(ChunkUtils.getChunkName(coords));
    if (state?.stage === "requested" && state.sentAt === null) {
      state.sentAt = sentAt;
      this.sentStampHits += 1;
    }
  }

  /**
   * Whether a request has gone unanswered long enough to be presumed lost.
   * Measured in elapsed time rather than in world updates, so a chunk asks
   * again on schedule however slowly the client happens to be running.
   */
  isRequestStale(name: string, staleAfterMs: number): boolean {
    const state = this.states.get(name);
    if (state?.stage !== "requested") return false;
    return performance.now() - state.requestedAt >= staleAfterMs;
  }

  markProcessing(
    coords: Coords2,
    source: "update" | "load",
    data: ChunkProtocol,
    arrivedAt: number | null = null,
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
      this.setStage(name, {
        stage: "processing",
        source,
        data: merged,
        requestedAt: existing.requestedAt,
        sentAt: existing.sentAt,
        arrivedAt: existing.arrivedAt,
        receivedAt: existing.receivedAt,
      });
    } else {
      this.setStage(name, {
        stage: "processing",
        source,
        data,
        requestedAt:
          existing?.stage === "requested" ? existing.requestedAt : null,
        sentAt: existing?.stage === "requested" ? existing.sentAt : null,
        arrivedAt,
        receivedAt: performance.now(),
      });
    }
  }

  markLoaded(coords: Coords2, chunk: Chunk): void {
    const name = ChunkUtils.getChunkName(coords);
    const existing = this.states.get(name);
    const carried =
      existing?.stage === "requested" || existing?.stage === "processing"
        ? existing
        : null;
    const loadedAt = performance.now();
    const arrivedAt =
      existing?.stage === "processing" ? existing.arrivedAt : null;
    const sentAt = carried?.sentAt ?? null;
    if (sentAt !== null && arrivedAt !== null) {
      this.recentRoundTrips.push({
        sentAt,
        wireMs: arrivedAt - sentAt,
        loadMs: loadedAt - arrivedAt,
      });
      if (this.recentRoundTrips.length > RECENT_ROUND_TRIP_CAPACITY) {
        this.recentRoundTrips.shift();
      }
    }
    this.setStage(name, {
      stage: "loaded",
      chunk,
      requestedAt: carried?.requestedAt ?? null,
      sentAt,
      arrivedAt,
      receivedAt: existing?.stage === "processing" ? existing.receivedAt : null,
      loadedAt,
    });
  }

  /**
   * The last few chunk round trips this client completed: wire is socket send
   * to raw arrival (server + transport + the main thread getting to the
   * socket event), load is arrival to data applied. Lets a slow join window be
   * compared against the same path during play, when the main thread is idle.
   */
  readRecentRoundTrips(): readonly ChunkRoundTrip[] {
    return this.recentRoundTrips;
  }

  getTiming(name: string): ChunkLoadTiming | undefined {
    const state = this.states.get(name);
    if (!state) return undefined;
    switch (state.stage) {
      case "requested":
        return {
          requestedAt: state.requestedAt,
          sentAt: state.sentAt,
          arrivedAt: null,
          receivedAt: null,
          loadedAt: null,
        };
      case "processing":
        return {
          requestedAt: state.requestedAt,
          sentAt: state.sentAt,
          arrivedAt: state.arrivedAt,
          receivedAt: state.receivedAt,
          loadedAt: null,
        };
      case "loaded":
        return {
          requestedAt: state.requestedAt,
          sentAt: state.sentAt,
          arrivedAt: state.arrivedAt,
          receivedAt: state.receivedAt,
          loadedAt: state.loadedAt,
        };
    }
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
  /**
   * When each in-flight generation was dispatched, for the leak watchdog.
   * Single-flight dispatch means a generation that never settles blocks the
   * key forever, and every settle path missing a release becomes a chunk
   * that silently never re-meshes for the rest of the session.
   */
  inFlightStartedAt: Map<number, number>;
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
        inFlightStartedAt: new Map(),
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
    // Single-flight per key. A sustained update flood bumps the generation
    // every packet; dispatching a fresh job per bump used to pile dozens of
    // serialized 9-chunk payloads for the SAME chunk into the worker queue —
    // an unbounded allocation spiral. The stale completion below re-marks
    // the key dirty, so the newest generation always gets meshed.
    if (state.inFlightGenerations.size > 0) return false;
    return true;
  }

  startJob(key: string, nowMs: number = performance.now()): number {
    const state = this.states.get(key);
    if (!state) return 0;
    state.inFlightGenerations.add(state.generation);
    state.inFlightStartedAt.set(state.generation, nowMs);
    this.dirty.delete(key);
    this.urgentDirty.delete(key);
    return state.generation;
  }

  onJobComplete(key: string, jobGeneration: number): boolean {
    const state = this.states.get(key);
    if (!state) return false;

    state.inFlightGenerations.delete(jobGeneration);
    state.inFlightStartedAt.delete(jobGeneration);

    if (
      jobGeneration < state.displayedGeneration ||
      jobGeneration < state.generation
    ) {
      // The voxel data moved on while this job was in flight. With
      // single-flight dispatch there is no newer job already running, so
      // the key must re-enter the dirty set or the chunk would stall on
      // stale geometry forever.
      if (jobGeneration < state.generation) {
        this.dirty.add(key);
      }
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
    state.inFlightStartedAt.delete(jobGeneration);
    this.dirty.add(key);
  }

  /**
   * The leak watchdog: release any in-flight generation older than
   * `maxAgeMs` and re-queue its key. Single-flight dispatch turns one
   * unsettled job into a chunk level that never re-meshes again for the
   * whole session, and every historical instance of that (a shed queue, a
   * dispatch path missing its release, a worker that died) has looked like
   * this exact symptom: a walkable chunk that stopped rendering hours into
   * a long session and stayed gone until reload. Expiry converts whichever
   * such path still exists — or gets written next — from a permanent hole
   * into a logged self-heal. Returns the expired keys for the caller to
   * report.
   */
  expireStuckJobs(nowMs: number, maxAgeMs: number): string[] {
    const expired: string[] = [];
    for (const [key, state] of this.states) {
      if (state.inFlightGenerations.size === 0) continue;
      for (const generation of [...state.inFlightGenerations]) {
        const startedAt = state.inFlightStartedAt.get(generation);
        // A missing timestamp is itself a leak (added before the watchdog
        // existed, or through a path that bypassed startJob): expire it.
        if (startedAt !== undefined && nowMs - startedAt < maxAgeMs) {
          continue;
        }
        state.inFlightGenerations.delete(generation);
        state.inFlightStartedAt.delete(generation);
        this.dirty.add(key);
        expired.push(key);
      }
    }
    return expired;
  }

  needsRemesh(key: string): boolean {
    const state = this.states.get(key);
    if (!state) return false;
    return state.generation > state.displayedGeneration;
  }

  markFreshFromServer(cx: number, cz: number, level: number): void {
    const key = MeshPipeline.makeKey(cx, cz, level);
    const state = this.getOrCreate(key);
    state.displayedGeneration = state.generation;
    state.inFlightGenerations.clear();
    state.inFlightStartedAt.clear();
    this.dirty.delete(key);
    this.urgentDirty.delete(key);
  }

  /**
   * Dirty keys ready for dispatch: the urgent lane first in insertion order
   * (player edits stay latency-ordered), then regular keys nearest-first
   * around `center` so remesh work reaches the camera before the horizon.
   * Without a center the regular lane keeps insertion order.
   */
  getDirtyKeys(center?: Coords2): string[] {
    const urgentKeys = [...this.urgentDirty].filter((key) =>
      this.shouldStartJob(key),
    );
    const regularKeys = [...this.dirty].filter(
      (key) => !this.urgentDirty.has(key) && this.shouldStartJob(key),
    );
    if (center) {
      const [centerX, centerZ] = center;
      const distanceSq = (key: string) => {
        const { cx, cz } = MeshPipeline.parseKey(key);
        const dx = cx - centerX;
        const dz = cz - centerZ;
        return dx * dx + dz * dz;
      };
      regularKeys.sort((a, b) => distanceSq(a) - distanceSq(b));
    }
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

  inFlightJobCount(): number {
    let count = 0;
    for (const state of this.states.values()) {
      count += state.inFlightGenerations.size;
    }
    return count;
  }

  get dirtyCount(): number {
    return this.dirty.size;
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
