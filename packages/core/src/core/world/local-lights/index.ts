import { Vector3 } from "three";

import { LightClusterGrid } from "./clustering";
import { LocalLightsDebugOverlay } from "./debug";
import { LightSourceRegistry } from "./registry";
import {
  BlockProfileTable,
  EmitterBlock,
  ScannableChunk,
  SectionTracker,
} from "./scan";
import {
  BlockLightProfile,
  defaultLocalLightsOptions,
  INVALID_LIGHT_HANDLE,
  LIGHT_QUALITY_TIERS,
  LightHandle,
  LightQualityTier,
  LocalLightDescriptor,
  LocalLightSample,
  LocalLightsOptions,
  LocalLightStats,
} from "./types";

export * from "./types";
export {
  LightSourceRegistry,
  LIGHT_FLAG_STATIC,
  LIGHT_FLAG_MASKED,
  LIGHT_FLAG_FLICKER,
  LIGHT_FLAG_SHADOW_REQUEST,
} from "./registry";
export {
  LightClusterGrid,
  MAX_CLUSTERED_LIGHTS,
  MAX_LIGHTS_PER_CELL,
} from "./clustering";
export { BlockProfileTable, SectionTracker } from "./scan";
export type { EmitterBlock, ScannableChunk } from "./scan";
export {
  EMISSIVE_LEVELS,
  LOCAL_LIGHTS_FUNCTIONS,
  LOCAL_LIGHTS_UNIFORM_DECLARATIONS,
} from "./shader";

/**
 * What the facade needs from the world it lights. Resolved lazily because
 * chunk shape and the block registry only exist after the server handshake.
 */
export interface LocalLightsWorldConfig {
  chunkSize: number;
  maxHeight: number;
  subChunks: number;
  maxLightLevel: number;
}

type PendingScan = {
  chunk: ScannableChunk;
  cx: number;
  cz: number;
  sectionY: number;
};

/**
 * Local light emitters: the engine-owned registry, selection, clustering,
 * and GPU packing behind `world.localLights`. The game declares semantic
 * block profiles and dynamic sources; chunk scanning, diffing, aggregation,
 * culling, and rendering state are owned here.
 *
 * A world that registers no lights and declares no profiles pays one uniform
 * compare per fragment and nothing per frame on the CPU.
 */
export class LocalLights {
  readonly options: LocalLightsOptions;
  readonly registry: LightSourceRegistry;
  readonly grid: LightClusterGrid;

  /** Mutated in place; never reallocated. */
  readonly stats: LocalLightStats = {
    registered: 0,
    candidates: 0,
    clustered: 0,
    cellsOverflowed: 0,
    selectMs: 0,
    packMs: 0,
    scanMs: 0,
    selectMsPeak: 0,
    packMsPeak: 0,
    scanMsPeak: 0,
    sectionsPendingScan: 0,
    selectionChurn: 0,
    gridTextureUploads: 0,
    dataTextureUploads: 0,
  };

  private readonly getWorldConfig: () => LocalLightsWorldConfig;
  private readonly getBlocks: () => Iterable<EmitterBlock>;
  private readonly declaredProfiles = new Map<number, BlockLightProfile>();
  private readonly declaredProfilesByName = new Map<
    string,
    BlockLightProfile
  >();
  private readonly pendingScans = new Map<string, PendingScan>();

  private tracker: SectionTracker | null = null;
  private profileTable: BlockProfileTable | null = null;
  private tier: LightQualityTier;
  private lastCameraX = Number.NaN;
  private lastCameraY = Number.NaN;
  private lastCameraZ = Number.NaN;
  private debugOverlay: LocalLightsDebugOverlay | null = null;
  private isDisposed = false;

  constructor(
    options: Partial<LocalLightsOptions>,
    getWorldConfig: () => LocalLightsWorldConfig,
    getBlocks: () => Iterable<EmitterBlock>,
  ) {
    this.options = { ...defaultLocalLightsOptions, ...options };
    this.getWorldConfig = getWorldConfig;
    this.getBlocks = getBlocks;
    this.tier = this.options.qualityTier;

    this.registry = new LightSourceRegistry(this.options.maxRegisteredLights);
    this.grid = new LightClusterGrid(this.registry, this.options);
    this.setQualityTier(this.tier);
  }

  /**
   * The shared uniform objects every chunk material binds. One set for the
   * whole world; updates are zero-copy.
   */
  get uniformBindings() {
    const u = this.grid.uniforms;
    return {
      uLightGrid: u.lightGrid,
      uLightData: u.lightData,
      uLightGridOrigin: u.gridOrigin,
      uLightGridDims: u.gridDims,
      uLightGridCellSize: u.gridCellSize,
      uClusteredLightCount: u.clusteredCount,
      uLocalMaskKnee: u.maskKnee,
      uLocalSpecularStrength: u.specularStrength,
      uLocalLightDebugMode: u.debugMode,
      uEmissiveLevels: u.emissiveLevels,
    };
  }

  // ── game-facing declaration API ──────────────────────────────────────────

  /**
   * Declare (or replace) the semantic light profile for a block id or name.
   * Affects every present and future emitter of that block: all tracked
   * sections rescan through the amortized queue.
   */
  setBlockProfile(block: number | string, profile: BlockLightProfile): void {
    if (typeof block === "number") {
      this.declaredProfiles.set(block, profile);
    } else {
      this.declaredProfilesByName.set(block.toLowerCase(), profile);
    }
    this.invalidateProfiles();
  }

  clearBlockProfile(block: number | string): void {
    const removed =
      typeof block === "number"
        ? this.declaredProfiles.delete(block)
        : this.declaredProfilesByName.delete(block.toLowerCase());
    if (removed) this.invalidateProfiles();
  }

  // ── dynamic sources ──────────────────────────────────────────────────────

  add(descriptor: LocalLightDescriptor, position: Vector3): LightHandle {
    return this.registry.add(descriptor, position.x, position.y, position.z);
  }

  remove(handle: LightHandle): boolean {
    return this.registry.remove(handle);
  }

  setPosition(handle: LightHandle, position: Vector3): boolean {
    return this.registry.setPosition(
      handle,
      position.x,
      position.y,
      position.z,
    );
  }

  setDirection(handle: LightHandle, direction: Vector3): boolean {
    return this.registry.setDirection(
      handle,
      direction.x,
      direction.y,
      direction.z,
    );
  }

  setIntensity(handle: LightHandle, intensity: number): boolean {
    return this.registry.setIntensity(handle, intensity);
  }

  setColor(handle: LightHandle, r: number, g: number, b: number): boolean {
    return this.registry.setColor(handle, r, g, b);
  }

  setRange(handle: LightHandle, range: number): boolean {
    return this.registry.setRange(handle, range);
  }

  setEnabled(handle: LightHandle, isEnabled: boolean): boolean {
    return this.registry.setEnabled(handle, isEnabled);
  }

  /**
   * CPU sample of the selected lights' combined irradiance at a point, for
   * entities, held items, and particles. Writes into `out`; no allocation.
   */
  queryLocalLights(position: Vector3, out: LocalLightSample): void {
    out.color[0] = 0;
    out.color[1] = 0;
    out.color[2] = 0;
    out.count = this.grid.sampleIrradiance(
      position.x,
      position.y,
      position.z,
      out.color,
    );
  }

  // ── quality tiers ────────────────────────────────────────────────────────

  setQualityTier(tier: LightQualityTier): void {
    this.tier = tier;
    const preset = LIGHT_QUALITY_TIERS[tier];
    this.grid.setTierCaps(
      preset.maxClusteredLights,
      preset.maxLightsPerCell,
      preset.analyticRadius,
      preset.fluidSpecularStrength * this.options.fluidSpecularStrength,
    );
  }

  getQualityTier(): LightQualityTier {
    return this.tier;
  }

  // ── debug ────────────────────────────────────────────────────────────────

  /** 0 off, 1 cell occupancy heatmap, 2 isolated contribution, 3 leak mask. */
  setDebugMode(mode: 0 | 1 | 2 | 3): void {
    this.grid.uniforms.debugMode.value = mode;
  }

  getDebugMode(): number {
    return this.grid.uniforms.debugMode.value;
  }

  /**
   * Wireframe bounds of every selected light, colored by state. Attached to
   * the given parent (typically the world); allocated on first use only.
   */
  showDebugOverlay(parent: { add(object: object): void }): void {
    if (!this.debugOverlay) {
      this.debugOverlay = new LocalLightsDebugOverlay(this.registry, this.grid);
    }
    parent.add(this.debugOverlay.object);
  }

  hideDebugOverlay(): void {
    this.debugOverlay?.object.removeFromParent();
  }

  // ── world integration (called by World; not game-facing) ────────────────

  /** A chunk's data arrived or re-arrived: queue every section for a scan. */
  handleChunkLoaded(cx: number, cz: number, chunk: ScannableChunk): void {
    const { subChunks } = this.getWorldConfig();
    const tracker = this.ensureTracker();
    for (let sectionY = 0; sectionY < subChunks; sectionY++) {
      const key = tracker.sectionKey(cx, cz, sectionY);
      this.pendingScans.set(key, { chunk, cx, cz, sectionY });
    }
  }

  /** A chunk left the render distance: its registrations release now. */
  handleChunkUnloaded(cx: number, cz: number): void {
    const { subChunks } = this.getWorldConfig();
    const tracker = this.ensureTracker();
    for (let sectionY = 0; sectionY < subChunks; sectionY++) {
      const key = tracker.sectionKey(cx, cz, sectionY);
      this.pendingScans.delete(key);
      tracker.releaseSection(key);
    }
  }

  /**
   * A voxel changed. Only edits that add or remove an emitter queue a
   * section rescan; everything else is free.
   */
  handleBlockUpdate(
    vx: number,
    vy: number,
    vz: number,
    oldId: number,
    newId: number,
    chunk: ScannableChunk | null,
  ): void {
    if (oldId === newId || !chunk) return;
    const table = this.ensureProfileTable();
    const isOldEmitter =
      oldId < table.isLightById.length && table.isLightById[oldId] === 1;
    const isNewEmitter =
      newId < table.isLightById.length && table.isLightById[newId] === 1;
    if (!isOldEmitter && !isNewEmitter) return;

    const { chunkSize, maxHeight, subChunks } = this.getWorldConfig();
    const sectionHeight = maxHeight / subChunks;
    if (vy < 0 || vy >= maxHeight) return;
    const cx = Math.floor(vx / chunkSize);
    const cz = Math.floor(vz / chunkSize);
    const sectionY = Math.floor(vy / sectionHeight);
    const tracker = this.ensureTracker();
    const key = tracker.sectionKey(cx, cz, sectionY);
    this.pendingScans.set(key, { chunk, cx, cz, sectionY });
  }

  /**
   * Per-frame work: drain the bounded scan queue, then run selection and
   * packing (which no-op when nothing changed). Called from `World.update`.
   */
  update(position: Vector3): void {
    if (this.isDisposed) return;

    const stats = this.stats;
    const scanStart = performance.now();
    let scanned = 0;
    if (this.pendingScans.size > 0) {
      const table = this.ensureProfileTable();
      const tracker = this.ensureTracker();
      for (const [key, pending] of this.pendingScans) {
        if (scanned >= this.options.maxSectionScansPerFrame) break;
        this.pendingScans.delete(key);
        tracker.rescanSection(key, pending.chunk, pending.sectionY, table);
        scanned++;
      }
    }
    stats.scanMs = scanned > 0 ? performance.now() - scanStart : 0;
    if (stats.scanMs > stats.scanMsPeak) stats.scanMsPeak = stats.scanMs;
    stats.sectionsPendingScan = this.pendingScans.size;

    // A teleport-scale jump means the previous selection belongs to another
    // place; drop its hysteresis instead of dragging it along.
    const jump = Math.max(
      Math.abs(position.x - this.lastCameraX),
      Math.abs(position.y - this.lastCameraY),
      Math.abs(position.z - this.lastCameraZ),
    );
    if (Number.isFinite(jump) && jump > this.options.analyticRadius) {
      this.grid.resetHysteresis();
    }
    this.lastCameraX = position.x;
    this.lastCameraY = position.y;
    this.lastCameraZ = position.z;

    this.grid.update(position.x, position.y, position.z, stats);
    this.debugOverlay?.update();
  }

  /**
   * GPU context restored: CPU-side light state is authoritative, so all GPU
   * textures simply re-upload. Wire this to the canvas's
   * `webglcontextrestored` event.
   */
  onContextRestored(): void {
    this.grid.markTexturesDirty();
  }

  /** Start a fresh peak-cost measurement window (benchmark harnesses). */
  resetPeakStats(): void {
    this.stats.selectMsPeak = 0;
    this.stats.packMsPeak = 0;
    this.stats.scanMsPeak = 0;
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.hideDebugOverlay();
    this.debugOverlay?.dispose();
    this.tracker?.releaseAll();
    this.pendingScans.clear();
    this.grid.dispose();
  }

  // ── internals ────────────────────────────────────────────────────────────

  private ensureTracker(): SectionTracker {
    if (!this.tracker) {
      const { chunkSize, maxHeight, subChunks } = this.getWorldConfig();
      this.tracker = new SectionTracker(
        this.registry,
        chunkSize,
        maxHeight,
        subChunks,
      );
    }
    return this.tracker;
  }

  private ensureProfileTable(): BlockProfileTable {
    if (!this.profileTable) {
      const declared = new Map(this.declaredProfiles);
      if (this.declaredProfilesByName.size > 0) {
        for (const block of this.getBlocks()) {
          const named = this.declaredProfilesByName.get(
            (block as EmitterBlock & { name?: string }).name?.toLowerCase() ??
              "",
          );
          if (named && !declared.has(block.id)) declared.set(block.id, named);
        }
      }
      this.profileTable = new BlockProfileTable(
        this.getBlocks(),
        declared,
        this.getWorldConfig().maxLightLevel,
      );
    }
    return this.profileTable;
  }

  /** Profiles or registry changed: rebuild the table, rescan the world. */
  private invalidateProfiles(): void {
    this.profileTable = null;
    if (!this.tracker) return;
    // Tracked sections rescan through the same bounded queue as loads. The
    // chunk reference is looked up lazily at scan time via pending entries,
    // so only sections with a still-loaded chunk rescan.
    for (const key of [...this.tracker.trackedSections()]) {
      const [cx, cz, sectionY] = key.split(",").map(Number);
      const pending = this.findChunkForSection(cx, cz);
      if (pending) {
        this.pendingScans.set(key, { chunk: pending, cx, cz, sectionY });
      }
    }
  }

  /**
   * Chunk lookup for late profile changes. Populated by the world adapter;
   * null keeps late declarations working for future loads only.
   */
  getLoadedChunk: (cx: number, cz: number) => ScannableChunk | null = () =>
    null;

  private findChunkForSection(cx: number, cz: number): ScannableChunk | null {
    return this.getLoadedChunk(cx, cz);
  }
}

export const INVALID_LOCAL_LIGHT_HANDLE = INVALID_LIGHT_HANDLE;
