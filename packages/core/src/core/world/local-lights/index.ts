import {
  Group,
  Object3D,
  Scene,
  Texture,
  Vector3,
  Vector4,
  WebGLRenderer,
} from "three";

import { LightClusterGrid } from "./clustering";
import { LocalLightsDebugOverlay } from "./debug";
import { LightSourceRegistry } from "./registry";
import {
  BlockProfileTable,
  EmitterBlock,
  ScannableChunk,
  SectionTracker,
} from "./scan";
import { ShadowFrameLedger } from "./shadow-ledger";
import { LocalShadowScheduler } from "./shadow-scheduler";
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
  LOCAL_LIGHTS_DEBUG_FUNCTIONS,
  LOCAL_LIGHTS_FUNCTIONS,
  LOCAL_LIGHTS_UNIFORM_DECLARATIONS,
} from "./shader";
export { ShadowFrameLedger } from "./shadow-ledger";
export { LocalShadowScheduler } from "./shadow-scheduler";
export type {
  ShadowInvalidationCause,
  ShadowInvalidationEntry,
  ShadowTexelRecord,
} from "./shadow-scheduler";
export {
  LocalShadowAtlas,
  POINT_FACE_GUARD_TAN_HALF,
  SHADOW_FACE_FORWARD,
  SHADOW_FACE_RIGHT,
  SHADOW_FACE_UP,
  SPOT_GUARD_SCALE,
  linearizeShadowDepth,
  makeShadowFaceProjection,
  orientPointFaceCamera,
  orientSpotCamera,
  projectPointLightFragment,
} from "./shadow-atlas";

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
  /** The L3 shadow tier: slot selection, cached faces, atlas renders. */
  readonly shadows: LocalShadowScheduler;
  /** The per-frame face-unit budget CSM and local shadows share. */
  readonly shadowLedger = new ShadowFrameLedger();

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
    shadowed: 0,
    shadowFacesRendered: 0,
    shadowFacesStatic: 0,
    shadowFacesDynamic: 0,
    shadowScheduleMs: 0,
    shadowScheduleMsPeak: 0,
    shadowInvalidations: 0,
    atlasEvictions: 0,
    atlasOccupancy: 0,
    shadowCacheHitRate: 1,
    ledgerUnitsCsm: 0,
    ledgerUnitsLocal: 0,
    atlasBytes: 0,
  };

  private readonly shadowUniforms = {
    atlas: { value: null as Texture | null },
    params: { value: new Vector4() },
    params2: { value: new Vector4() },
  };
  private shadowLedgerUnitsPerFrame: number;

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
    this.shadows = new LocalShadowScheduler(this.registry, this.options);
    this.shadowLedgerUnitsPerFrame = this.options.shadowLedgerUnitsPerFrame;

    // The packer reads shadow assignments; shadow changes on frames the
    // packer skipped rewrite just the shadow texels.
    this.grid.shadowProvider = (index) => this.shadows.recordForIndex(index);
    this.shadows.onShadowDataChanged = () =>
      this.grid.refreshShadowTexels(this.stats);

    this.shadowUniforms.params.value.set(
      this.options.shadowAtlasSize,
      this.options.shadowSlotSize,
      this.options.localShadowBias,
      this.options.localShadowNormalBiasTexels,
    );
    this.shadowUniforms.params2.value.set(
      this.options.localShadowPcfRadius,
      this.options.localShadowStrength,
      0,
      0,
    );

    this.setQualityTier(this.tier);
  }

  /**
   * Voxel opacity oracle for mount-aware shadow-face skipping, wired by the
   * world adapter. Null disables the skip (all six faces render).
   */
  set getIsOpaqueAt(
    fn: ((vx: number, vy: number, vz: number) => boolean) | null,
  ) {
    this.shadows.getIsOpaqueAt = fn;
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
      uLocalShadowAtlas: this.shadowUniforms.atlas,
      uLocalShadowParams: this.shadowUniforms.params,
      uLocalShadowParams2: this.shadowUniforms.params2,
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

  setColor(handle: LightHandle, color: [number, number, number]): boolean {
    return this.registry.setColor(handle, color);
  }

  setRange(handle: LightHandle, range: number): boolean {
    return this.registry.setRange(handle, range);
  }

  setEnabled(handle: LightHandle, isEnabled: boolean): boolean {
    return this.registry.setEnabled(handle, isEnabled);
  }

  /**
   * CPU sample of the selected lights' combined irradiance at a point, for
   * entities, held items, and particles. Writes into `out`; no allocation
   * (per-frame callers may reuse one `options` scratch object).
   *
   * `options.floodMask` is the caller's local flood-light level mapped
   * through the mask knee (1 = fully open); masked and shadow-fallback
   * lights multiply by it so an entity behind a wall stops tinting from a
   * blocked light. `options.timeMs` drives the same flicker curve the
   * shader evaluates.
   */
  queryLocalLights(
    position: Vector3,
    out: LocalLightSample,
    options?: { floodMask?: number; timeMs?: number },
  ): void {
    out.color[0] = 0;
    out.color[1] = 0;
    out.color[2] = 0;
    out.count = this.grid.sampleIrradiance(
      position.x,
      position.y,
      position.z,
      out.color,
      options,
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
    // Like the clustered caps, tier presets replace the shadow caps — the
    // constructor's options only seed state until this first call.
    this.shadows.setTierCaps(
      preset.maxShadowedLights,
      preset.shadowAtlasSize,
      preset.shadowSlotSize,
    );
    this.shadowLedgerUnitsPerFrame = preset.shadowLedgerUnitsPerFrame;
    this.shadowUniforms.params.value.x = preset.shadowAtlasSize;
    this.shadowUniforms.params.value.y = preset.shadowSlotSize;
    this.shadowUniforms.atlas.value = null;
  }

  getQualityTier(): LightQualityTier {
    return this.tier;
  }

  // ── debug ────────────────────────────────────────────────────────────────

  /**
   * 0 off, 1 cell occupancy heatmap, 2 isolated contribution, 3 leak mask,
   * 4 shadow-slot tint, 5 isolated local-shadow visibility.
   */
  setDebugMode(mode: 0 | 1 | 2 | 3 | 4 | 5): void {
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
   * A voxel changed. Only edits that touch an emitter queue a section
   * rescan; everything else costs one AABB test per active shadow slot.
   *
   * Takes the raw voxel words, not bare ids: rotating a torch in place
   * changes only the rotation bits, yet must re-anchor its light (the scan
   * signatures carry rotation) and refresh cached shadow maps (the stick
   * occludes differently) exactly like swapping the block would.
   */
  handleBlockUpdate(edit: {
    voxel: [number, number, number];
    /** Raw voxel words: id in the low 16 bits, rotation/stage above. */
    oldValue: number;
    newValue: number;
    chunk: ScannableChunk | null;
  }): void {
    const { voxel, oldValue, newValue, chunk } = edit;
    if (oldValue === newValue) return;
    const [vx, vy, vz] = voxel;
    // Any voxel change invalidates cached shadow maps whose range it
    // intersects — geometry occludes regardless of whether it emits.
    this.shadows.notifyBlockEdit(vx, vy, vz);
    if (!chunk) return;
    const table = this.ensureProfileTable();
    const oldId = oldValue & 0xffff;
    const newId = newValue & 0xffff;
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
    this.shadows.update(
      this.grid.selectedIndices,
      this.grid.selectedCount,
      position.x,
      position.y,
      position.z,
      stats,
    );
    this.debugOverlay?.update();
  }

  // ── shadow frame (called by World.renderShadowMaps; not game-facing) ────

  /**
   * Open this frame's shadow budget and reserve units for dynamic faces
   * (moving hero lights, entity overlays) before the CSM cascades spend.
   */
  beginShadowFrame(entities?: Object3D[]): void {
    this.shadowLedger.beginFrame(this.shadowLedgerUnitsPerFrame);
    const demand = this.shadows.estimateDynamicDemand(entities);
    if (demand > 0) this.shadowLedger.reserveDynamic(demand);
  }

  /**
   * Render whatever local shadow faces this frame's remaining budget grants:
   * moving-light refreshes and entity overlays first, then the invalidated
   * static FIFO. A frame with zero shadow slots returns immediately.
   */
  renderShadows(
    renderer: WebGLRenderer,
    scene: Scene,
    entities?: Object3D[],
    instancePools?: Group[],
    skipShadowObjects: readonly Object3D[] = [],
  ): void {
    this.shadows.render(
      renderer,
      scene,
      this.shadowLedger,
      entities,
      instancePools,
      skipShadowObjects,
      this.stats,
    );
    this.shadowUniforms.atlas.value = this.shadows.atlas.depthTexture;
    const ledger = this.shadowLedger.frameStats;
    this.stats.ledgerUnitsCsm = ledger.csmNearUnits + ledger.csmFarUnits;
    this.stats.ledgerUnitsLocal =
      ledger.localDynamicUnits + ledger.localStaticUnits;
    this.stats.atlasBytes = this.shadows.atlas.estimatedBytes;
  }

  /**
   * Invalidate every cached shadow map intersecting `[min, max)` — for game
   * systems that alter occluding geometry outside the block-update stream.
   */
  invalidateShadowRegion(min: Vector3, max: Vector3): void {
    this.shadows.invalidateRegion({
      min: [min.x, min.y, min.z],
      max: [max.x, max.y, max.z],
    });
  }

  /** A chunk mesh (re)built: refresh cached maps that reach into it. */
  handleChunkMeshed(cx: number, cz: number): void {
    const { chunkSize, maxHeight } = this.getWorldConfig();
    this.shadows.notifyChunkMeshed({
      minX: cx * chunkSize,
      minZ: cz * chunkSize,
      maxX: (cx + 1) * chunkSize,
      maxZ: (cz + 1) * chunkSize,
      maxHeight,
    });
  }

  /**
   * GPU context restored: CPU-side light state is authoritative, so all GPU
   * textures simply re-upload. Wire this to the canvas's
   * `webglcontextrestored` event.
   */
  onContextRestored(): void {
    this.grid.markTexturesDirty();
    this.shadows.onContextRestored();
  }

  /** Start a fresh peak-cost measurement window (benchmark harnesses). */
  resetPeakStats(): void {
    this.stats.selectMsPeak = 0;
    this.stats.packMsPeak = 0;
    this.stats.scanMsPeak = 0;
    this.stats.shadowScheduleMsPeak = 0;
    this.shadows.resetCacheCounters();
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.hideDebugOverlay();
    this.debugOverlay?.dispose();
    this.tracker?.releaseAll();
    this.pendingScans.clear();
    this.grid.dispose();
    this.shadows.dispose();
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
