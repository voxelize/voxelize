import {
  Group,
  MeshDepthMaterial,
  Object3D,
  PerspectiveCamera,
  RGBADepthPacking,
  Scene,
  WebGLRenderer,
} from "three";
import type { Material, Mesh } from "three";

import {
  LIGHT_FLAG_SHADOW_REQUEST,
  LIGHT_FLAG_STATIC,
  LIGHT_SHAPE_SPOT,
  LightSourceRegistry,
} from "./registry";
import {
  CELLS_PER_SHADOW_SLOT,
  LocalShadowAtlas,
  orientPointFaceCamera,
  orientSpotCamera,
  POINT_FACE_GUARD_TAN_HALF,
  SHADOW_FACE_FORWARD,
  SPOT_GUARD_SCALE,
} from "./shadow-atlas";
import { ShadowFrameLedger } from "./shadow-ledger";
import { LocalLightStats } from "./types";

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/** All six cube faces present. */
const FULL_FACE_MASK = 0b111111;

/** Conservative world-space radius of an entity caster, in blocks. */
const ENTITY_CASTER_RADIUS = 1.6;

/** Anchor movement (blocks) beyond which a moving light's maps are stale. */
const MOVE_EPSILON = 0.01;

/** Shadow cameras hug the light; nearer geometry cannot occlude usefully. */
const SHADOW_NEAR = 0.25;

/** Scratch views for the face-render camera calls; zero per-face allocation. */
const pointViewScratch = {
  light: [0, 0, 0] as [number, number, number],
  face: 0,
  tanHalf: 0,
  near: SHADOW_NEAR,
  far: 1,
};
const spotViewScratch = {
  light: [0, 0, 0] as [number, number, number],
  direction: [0, 0, 0] as [number, number, number],
  tanHalf: 0,
  near: SHADOW_NEAR,
  far: 1,
};

export type ShadowInvalidationCause =
  | "blockEdit"
  | "chunkMeshed"
  | "eviction"
  | "tierChange"
  | "contextRestore"
  | "manualRegion"
  | "lightMoved"
  | "lightRotated";

export interface ShadowInvalidationEntry {
  frame: number;
  slot: number;
  cause: ShadowInvalidationCause;
}

/** Packed per-record shadow data destined for texels 4–5 of the light row. */
export interface ShadowTexelRecord {
  slot: number;
  staticMask: number;
  dynamicMask: number;
  near: number;
  far: number;
  tanHalf: number;
}

interface ShadowSlot {
  /** Registry slot index of the owner, or -1 when empty. */
  index: number;
  generation: number;
  /** Anchor position the cached static faces were rendered from. */
  x: number;
  y: number;
  z: number;
  far: number;
  tanHalf: number;
  isSpot: boolean;
  /** Spot only: cone direction and outer cosine the cached faces were aimed
   * with, so a rotated or re-angled cone re-renders instead of sampling a
   * map that still points the old way. */
  dirX: number;
  dirY: number;
  dirZ: number;
  cosOuter: number;
  /** The owning light mutates position (held/orbit lights). */
  isMovingLight: boolean;
  /** Mount-aware faces this light may ever render (bitmask). */
  allowedMask: number;
  /** Static faces whose cached content is valid and sampleable. */
  staticMask: number;
  /** Static faces queued for a (re-)render, drained through the ledger. */
  staticPending: number;
  /** Dynamic overlay faces holding casters as of the last overlay pass. */
  dynamicMask: number;
}

/**
 * The L3 tier: decides which clustered lights earn a shadow slot (with
 * eviction hysteresis so orbiting the camera does not thrash the atlas),
 * owns the cached-static / dynamic-overlay face state machine per slot, and
 * renders the faces the {@link ShadowFrameLedger} grants each frame.
 *
 * A frame with zero shadow slots costs one integer compare in `update` and
 * an early return in `render`.
 */
export class LocalShadowScheduler {
  readonly atlas: LocalShadowAtlas;

  /** Ring buffer of the most recent invalidations, for the debug HUD. */
  readonly invalidationLog: ShadowInvalidationEntry[] = [];

  private readonly registry: LightSourceRegistry;
  private readonly slots: ShadowSlot[] = [];
  private maxSlots: number;
  private faceCostUnits: number;
  private evictionRatio: number;
  private evictionFrames: number;

  /** getIsOpaqueAt hook, wired by the world; null skips mount awareness. */
  getIsOpaqueAt: ((vx: number, vy: number, vz: number) => boolean) | null =
    null;

  /** Called whenever packed shadow texels must be rewritten. */
  onShadowDataChanged: (() => void) | null = null;

  private frame = 0;
  private challengerIndex = -1;
  private challengerGeneration = 0;
  private challengerFrames = 0;

  private readonly depthMaterial: MeshDepthMaterial;
  private readonly faceCamera = new PerspectiveCamera();
  private readonly casterScene = new Scene();
  private readonly hiddenObjects: { object: Object3D; visible: boolean }[] = [];
  private readonly reparentedCasters: {
    object: Object3D;
    parent: Object3D | null;
  }[] = [];
  private readonly poolMaterialSwaps: {
    mesh: Mesh;
    material: Material | Material[];
  }[] = [];
  private readonly viewportScratch: [number, number, number] = [0, 0, 0];

  /** Overlay-owned casters hidden for the duration of a world-cell render. */
  private readonly worldPassHidden: Object3D[] = [];

  /** Scratch for per-frame candidate scoring; no per-frame allocation. */
  private readonly candidateScores: Float64Array;
  private readonly candidateIndices: Uint32Array;
  private readonly candidateOrder: Uint32Array;

  private statsEvictions = 0;
  private statsInvalidations = 0;
  private cachedSlotFrames = 0;
  private activeSlotFrames = 0;

  constructor(
    registry: LightSourceRegistry,
    options: {
      maxShadowedLights: number;
      shadowAtlasSize: number;
      shadowSlotSize: number;
      shadowEvictionHysteresis: { ratio: number; frames: number };
    },
  ) {
    this.registry = registry;
    this.atlas = new LocalShadowAtlas(
      options.shadowAtlasSize,
      options.shadowSlotSize,
    );
    this.maxSlots = Math.min(
      options.maxShadowedLights,
      this.atlas.capacitySlots,
    );
    this.faceCostUnits = Math.max((options.shadowSlotSize / 256) ** 2, 1);
    this.evictionRatio = options.shadowEvictionHysteresis.ratio;
    this.evictionFrames = options.shadowEvictionHysteresis.frames;

    for (let s = 0; s < this.maxSlots; s++) this.slots.push(makeEmptySlot());

    this.depthMaterial = new MeshDepthMaterial({
      depthPacking: RGBADepthPacking,
    });

    this.candidateScores = new Float64Array(registry.capacity);
    this.candidateIndices = new Uint32Array(registry.capacity);
    this.candidateOrder = new Uint32Array(registry.capacity);
  }

  get activeSlotCount(): number {
    let count = 0;
    for (const slot of this.slots) if (slot.index >= 0) count++;
    return count;
  }

  get slotCapacity(): number {
    return this.maxSlots;
  }

  /**
   * Quality-tier change: new caps and atlas geometry. Every cached map is
   * dropped (the atlas may have been reallocated at a new size).
   */
  setTierCaps(
    maxShadowedLights: number,
    atlasSize: number,
    slotSize: number,
  ): void {
    // Idempotent on identical caps: re-applying the current tier (a
    // settings screen "apply", a world re-init on the same quality) must
    // not wipe every cached shadow map for nothing. Only an actual change
    // of atlas geometry or slot count invalidates.
    const atlasUnchanged =
      atlasSize === this.atlas.size && slotSize === this.atlas.cellSize;
    this.atlas.resize(atlasSize, slotSize);
    this.faceCostUnits = Math.max((slotSize / 256) ** 2, 1);
    const newMax = Math.min(maxShadowedLights, this.atlas.capacitySlots);
    if (atlasUnchanged && newMax === this.maxSlots) return;
    if (newMax !== this.maxSlots) {
      this.maxSlots = newMax;
      this.slots.length = 0;
      for (let s = 0; s < newMax; s++) this.slots.push(makeEmptySlot());
    }
    this.invalidateAll("tierChange");
  }

  /** GPU context restored: atlas contents are gone; re-render lazily. */
  onContextRestored(): void {
    this.invalidateAll("contextRestore");
  }

  invalidateAll(cause: ShadowInvalidationCause): void {
    let changed = false;
    for (let s = 0; s < this.slots.length; s++) {
      const slot = this.slots[s];
      if (slot.index < 0) continue;
      slot.staticMask = 0;
      slot.dynamicMask = 0;
      slot.staticPending = slot.allowedMask;
      this.logInvalidation(s, cause);
      changed = true;
    }
    if (changed) this.onShadowDataChanged?.();
  }

  /**
   * A voxel changed. Cached static maps of every slot whose range sphere
   * intersects the edited voxel re-render through the FIFO; edits outside
   * every range cost one AABB test per active slot.
   */
  notifyBlockEdit(vx: number, vy: number, vz: number): void {
    this.invalidateBox(vx, vy, vz, vx + 1, vy + 1, vz + 1, "blockEdit");
  }

  /** Public API: invalidate every cached map intersecting a world region. */
  invalidateRegion(region: {
    min: [number, number, number];
    max: [number, number, number];
  }): void {
    const { min, max } = region;
    this.invalidateBox(
      min[0],
      min[1],
      min[2],
      max[0],
      max[1],
      max[2],
      "manualRegion",
    );
  }

  /**
   * A chunk's mesh (re-)built. Cached maps that reach into the chunk baked
   * whatever geometry existed at render time; streaming in late meshes must
   * refresh them or lights shine through terrain that "wasn't there yet".
   */
  notifyChunkMeshed(area: {
    minX: number;
    minZ: number;
    maxX: number;
    maxZ: number;
    maxHeight: number;
  }): void {
    this.invalidateBox(
      area.minX,
      0,
      area.minZ,
      area.maxX,
      area.maxHeight,
      area.maxZ,
      "chunkMeshed",
    );
  }

  private invalidateBox(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    cause: ShadowInvalidationCause,
  ): void {
    let changed = false;
    for (let s = 0; s < this.slots.length; s++) {
      const slot = this.slots[s];
      if (slot.index < 0) continue;
      const dx = Math.max(minX - slot.x, 0, slot.x - maxX);
      const dy = Math.max(minY - slot.y, 0, slot.y - maxY);
      const dz = Math.max(minZ - slot.z, 0, slot.z - maxZ);
      if (dx * dx + dy * dy + dz * dz > slot.far * slot.far) continue;
      slot.staticMask = 0;
      slot.staticPending = slot.allowedMask;
      this.logInvalidation(s, cause);
      this.statsInvalidations++;
      changed = true;
    }
    if (changed) this.onShadowDataChanged?.();
  }

  /**
   * Reconcile shadow slots against the clustered selection. Runs every
   * frame; the scoring loop is O(clustered ≤ 255) and the whole pass is a
   * no-op micro-loop when nothing shadow-requesting is selected.
   */
  update(
    selectedIndices: Uint32Array,
    selectedCount: number,
    cameraX: number,
    cameraY: number,
    cameraZ: number,
    stats: LocalLightStats,
  ): void {
    this.frame++;
    const registry = this.registry;
    const { positions, ranges, colors, intensities, priorityBiases, flags } =
      registry;

    // 1. Score the shadow-requesting subset of the clustered selection.
    let candidateCount = 0;
    for (let rank = 0; rank < selectedCount; rank++) {
      const i = selectedIndices[rank];
      if ((flags[i] & LIGHT_FLAG_SHADOW_REQUEST) === 0) continue;
      const dx = positions[i * 3] - cameraX;
      const dy = positions[i * 3 + 1] - cameraY;
      const dz = positions[i * 3 + 2] - cameraZ;
      const d2 = dx * dx + dy * dy + dz * dz;
      const luma =
        intensities[i] *
        (colors[i * 3] * LUMA_R +
          colors[i * 3 + 1] * LUMA_G +
          colors[i * 3 + 2] * LUMA_B);
      const range = ranges[i];
      this.candidateIndices[candidateCount] = i;
      this.candidateScores[candidateCount] =
        (luma * range * range) / Math.max(d2, 1) + priorityBiases[i];
      candidateCount++;
    }

    let changed = false;

    // 2. Drop holders that died, left the clustered set, or lost the flag.
    for (let s = 0; s < this.slots.length; s++) {
      const slot = this.slots[s];
      if (slot.index < 0) continue;
      const isAlive =
        registry.generationAt(slot.index) === slot.generation &&
        registry.isEnabledAt(slot.index);
      let isCandidate = false;
      if (isAlive) {
        for (let c = 0; c < candidateCount; c++) {
          if (this.candidateIndices[c] === slot.index) {
            isCandidate = true;
            break;
          }
        }
      }
      if (!isCandidate) {
        this.releaseSlot(s);
        changed = true;
      }
    }

    if (candidateCount > 0 || this.activeSlotCount > 0) {
      changed = this.reconcileSelection(candidateCount) || changed;
      changed = this.refreshSlotGeometry() || changed;
    }

    if (changed) this.onShadowDataChanged?.();

    for (const slot of this.slots) {
      if (slot.index < 0) continue;
      this.activeSlotFrames++;
      if (!slot.isMovingLight && slot.staticPending === 0) {
        this.cachedSlotFrames++;
      }
    }

    stats.shadowed = this.activeSlotCount;
    stats.atlasEvictions = this.statsEvictions;
    stats.shadowInvalidations = this.statsInvalidations;
    stats.atlasOccupancy =
      this.maxSlots === 0 ? 0 : this.activeSlotCount / this.maxSlots;
    stats.shadowCacheHitRate =
      this.activeSlotFrames === 0
        ? 1
        : this.cachedSlotFrames / this.activeSlotFrames;
  }

  /** Restart the cache-hit measurement window (benchmark harnesses). */
  resetCacheCounters(): void {
    this.cachedSlotFrames = 0;
    this.activeSlotFrames = 0;
  }

  /**
   * Fill empty slots in score order; evict only through sustained-challenger
   * hysteresis so selection jitter never thrashes cached maps.
   */
  private reconcileSelection(candidateCount: number): boolean {
    let changed = false;

    // Highest-score-first candidate order (insertion sort into preallocated
    // scratch — candidate counts are tiny); ties break on lower slot index,
    // matching the clustered selection's rule.
    const order = this.candidateOrder;
    const scores = this.candidateScores;
    const indices = this.candidateIndices;
    for (let c = 0; c < candidateCount; c++) {
      let insert = c;
      while (insert > 0) {
        const previous = order[insert - 1];
        const isWorse =
          scores[previous] < scores[c] ||
          (scores[previous] === scores[c] && indices[previous] > indices[c]);
        if (!isWorse) break;
        order[insert] = previous;
        insert--;
      }
      order[insert] = c;
    }

    // Fill empty slots immediately — hysteresis guards eviction, not entry.
    for (let o = 0; o < candidateCount; o++) {
      const index = indices[order[o]];
      if (this.holderSlotOf(index) >= 0) continue;
      let empty = -1;
      for (let s = 0; s < this.slots.length; s++) {
        if (this.slots[s].index < 0) {
          empty = s;
          break;
        }
      }
      if (empty < 0) break;
      this.assignSlot(empty, index);
      changed = true;
    }

    // Eviction: the single best unheld candidate challenges the weakest
    // holder; it must out-score it by `ratio` for `frames` consecutive
    // frames before the swap happens.
    let weakestSlot = -1;
    let weakestScore = Infinity;
    for (let s = 0; s < this.slots.length; s++) {
      const slot = this.slots[s];
      if (slot.index < 0) continue;
      let score = 0;
      for (let c = 0; c < candidateCount; c++) {
        if (this.candidateIndices[c] === slot.index) {
          score = this.candidateScores[c];
          break;
        }
      }
      if (score < weakestScore) {
        weakestScore = score;
        weakestSlot = s;
      }
    }

    let challenger = -1;
    let challengerScore = 0;
    for (let o = 0; o < candidateCount; o++) {
      const index = indices[order[o]];
      if (this.holderSlotOf(index) < 0) {
        challenger = index;
        challengerScore = scores[order[o]];
        break;
      }
    }

    if (
      challenger >= 0 &&
      weakestSlot >= 0 &&
      challengerScore > weakestScore * this.evictionRatio
    ) {
      const generation = this.registry.generationAt(challenger);
      if (
        challenger === this.challengerIndex &&
        generation === this.challengerGeneration
      ) {
        this.challengerFrames++;
      } else {
        this.challengerIndex = challenger;
        this.challengerGeneration = generation;
        this.challengerFrames = 1;
      }
      if (this.challengerFrames >= this.evictionFrames) {
        this.releaseSlot(weakestSlot);
        this.logInvalidation(weakestSlot, "eviction");
        this.statsEvictions++;
        this.assignSlot(weakestSlot, challenger);
        this.challengerIndex = -1;
        this.challengerFrames = 0;
        changed = true;
      }
    } else {
      this.challengerIndex = -1;
      this.challengerFrames = 0;
    }

    return changed;
  }

  private holderSlotOf(index: number): number {
    for (let s = 0; s < this.slots.length; s++) {
      if (this.slots[s].index === index) return s;
    }
    return -1;
  }

  /** Track anchor movement and spot-direction-derived parameters. */
  private refreshSlotGeometry(): boolean {
    const { positions, ranges, aux } = this.registry;
    let changed = false;
    for (let s = 0; s < this.slots.length; s++) {
      const slot = this.slots[s];
      if (slot.index < 0) continue;
      const i = slot.index;
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      const far = Math.max(ranges[i], SHADOW_NEAR + 0.5);
      const moved =
        Math.abs(x - slot.x) > MOVE_EPSILON ||
        Math.abs(y - slot.y) > MOVE_EPSILON ||
        Math.abs(z - slot.z) > MOVE_EPSILON ||
        Math.abs(far - slot.far) > MOVE_EPSILON;
      // A spot's cached face aims along its cone: rotating the cone (or
      // widening it) stales the map exactly like moving the anchor, so the
      // atlas must not keep aiming the old way after setDirection.
      let rotated = false;
      if (slot.isSpot) {
        const dx = aux[i * 4];
        const dy = aux[i * 4 + 1];
        const dz = aux[i * 4 + 2];
        const cosOuter = aux[i * 4 + 3];
        rotated =
          Math.abs(dx - slot.dirX) > MOVE_EPSILON ||
          Math.abs(dy - slot.dirY) > MOVE_EPSILON ||
          Math.abs(dz - slot.dirZ) > MOVE_EPSILON ||
          Math.abs(cosOuter - slot.cosOuter) > MOVE_EPSILON;
        if (rotated) {
          slot.dirX = dx;
          slot.dirY = dy;
          slot.dirZ = dz;
          slot.cosOuter = cosOuter;
          slot.tanHalf = spotGuardTanHalf(cosOuter);
        }
      }
      if (!moved && !rotated) continue;
      slot.x = x;
      slot.y = y;
      slot.z = z;
      slot.far = far;
      slot.allowedMask = this.computeAllowedMask(slot);
      slot.staticMask &= slot.allowedMask;
      slot.dynamicMask &= slot.allowedMask;
      slot.staticPending = slot.allowedMask;
      if (!slot.isMovingLight) {
        this.logInvalidation(s, moved ? "lightMoved" : "lightRotated");
      }
      changed = true;
    }
    return changed;
  }

  private assignSlot(s: number, index: number): void {
    const { positions, ranges, shapes, flags, aux } = this.registry;
    const slot = this.slots[s];
    slot.index = index;
    slot.generation = this.registry.generationAt(index);
    slot.x = positions[index * 3];
    slot.y = positions[index * 3 + 1];
    slot.z = positions[index * 3 + 2];
    slot.far = Math.max(ranges[index], SHADOW_NEAR + 0.5);
    slot.isSpot = shapes[index] === LIGHT_SHAPE_SPOT;
    slot.isMovingLight = (flags[index] & LIGHT_FLAG_STATIC) === 0;
    if (slot.isSpot) {
      slot.dirX = aux[index * 4];
      slot.dirY = aux[index * 4 + 1];
      slot.dirZ = aux[index * 4 + 2];
      slot.cosOuter = aux[index * 4 + 3];
      slot.tanHalf = spotGuardTanHalf(slot.cosOuter);
    } else {
      slot.dirX = 0;
      slot.dirY = 0;
      slot.dirZ = 0;
      slot.cosOuter = 0;
      slot.tanHalf = POINT_FACE_GUARD_TAN_HALF;
    }
    slot.allowedMask = this.computeAllowedMask(slot);
    slot.staticMask = 0;
    slot.dynamicMask = 0;
    slot.staticPending = slot.allowedMask;
  }

  private releaseSlot(s: number): void {
    const slot = this.slots[s];
    slot.index = -1;
    slot.generation = 0;
    slot.staticMask = 0;
    slot.dynamicMask = 0;
    slot.staticPending = 0;
    slot.allowedMask = FULL_FACE_MASK;
    slot.dirX = 0;
    slot.dirY = 0;
    slot.dirZ = 0;
    slot.cosOuter = 0;
  }

  /**
   * Mount-aware face skipping: a face whose first half-block is buried in an
   * opaque neighbor (the wall a torch hangs on, the ceiling a lantern hangs
   * from) never renders and never samples. Spots always use exactly face 0.
   */
  private computeAllowedMask(slot: ShadowSlot): number {
    if (slot.isSpot) return 0b1;
    if (!this.getIsOpaqueAt) return FULL_FACE_MASK;
    const vx = Math.floor(slot.x);
    const vy = Math.floor(slot.y);
    const vz = Math.floor(slot.z);
    let mask = 0;
    for (let f = 0; f < 6; f++) {
      const fwd = SHADOW_FACE_FORWARD[f];
      const isMount = this.getIsOpaqueAt(vx + fwd[0], vy + fwd[1], vz + fwd[2]);
      if (!isMount) mask |= 1 << f;
    }
    // A light entirely encased in opaque blocks keeps all faces rather than
    // none: rendering into stone is cheap (everything z-fails) and honest.
    return mask === 0 ? FULL_FACE_MASK : mask;
  }

  /** Texel provider for the clustered packer. */
  recordForIndex(index: number): ShadowTexelRecord | null {
    for (let s = 0; s < this.slots.length; s++) {
      const slot = this.slots[s];
      if (slot.index !== index) continue;
      if (this.registry.generationAt(index) !== slot.generation) return null;
      return {
        slot: s,
        staticMask: slot.staticMask,
        dynamicMask: slot.dynamicMask,
        near: SHADOW_NEAR,
        far: slot.far,
        tanHalf: slot.tanHalf,
      };
    }
    return null;
  }

  /**
   * Estimated dynamic face units this frame wants, for the ledger
   * reservation taken before CSM renders its cascades. Mirrors exactly what
   * `render` will draw through the dynamic tier — a moving light's pending
   * world refreshes plus every slot's entity overlay faces — so an idle
   * held light with no casters nearby reserves nothing and never squeezes
   * the CSM far cascades or the static FIFO.
   */
  estimateDynamicDemand(entities?: Object3D[]): number {
    let faces = 0;
    for (const slot of this.slots) {
      if (slot.index < 0) continue;
      if (slot.isMovingLight && slot.staticPending !== 0) {
        faces += popcount(slot.staticPending & slot.allowedMask);
      }
      if (!entities || entities.length === 0) continue;
      for (let f = 0; f < 6; f++) {
        if ((slot.allowedMask & (1 << f)) === 0) continue;
        if (this.faceHasEntityCaster(slot, f, entities)) faces++;
      }
    }
    return faces * this.faceCostUnits;
  }

  /**
   * Render the faces the ledger grants. Order inside the local tier:
   * moving-light refreshes and entity overlays (dynamic units, reserved)
   * first, then the invalidated-static FIFO (free units only).
   */
  render(
    renderer: WebGLRenderer,
    scene: Scene,
    ledger: ShadowFrameLedger,
    entities: Object3D[] | undefined,
    instancePools: Group[] | undefined,
    skipShadowObjects: readonly Object3D[],
    stats: LocalLightStats,
  ): void {
    if (this.activeSlotCount === 0) return;

    const start = performance.now();
    const target = this.atlas.ensureAllocated();
    const previousTarget = renderer.getRenderTarget();
    const originalOverride = scene.overrideMaterial;

    let facesStatic = 0;
    let facesDynamic = 0;
    let texelsChanged = false;

    // Objects flagged skipShadow (fluids, glass, plants) hide exactly as
    // they do for CSM — one caster rule set, two consumers.
    const hidden = this.hiddenObjects;
    hidden.length = 0;
    for (const object of skipShadowObjects) {
      if (object.visible) {
        hidden.push({ object, visible: true });
        object.visible = false;
      }
    }

    renderer.setRenderTarget(target);

    for (let s = 0; s < this.slots.length; s++) {
      const slot = this.slots[s];
      if (slot.index < 0) continue;

      if (slot.isMovingLight && slot.staticPending !== 0) {
        // A moving light's world cache cannot survive its own motion:
        // pending faces re-render world-only depth through the reserved
        // dynamic tier. Entities never bake into these cells — they ride
        // the per-frame overlay below like every other slot, so a held
        // light that stops moving keeps live caster shadows instead of a
        // frozen imprint of wherever they stood at the last refresh.
        for (let f = 0; f < 6; f++) {
          const bit = 1 << f;
          if ((slot.staticPending & bit) === 0) continue;
          if (!ledger.requestLocal("dynamic", this.faceCostUnits)) break;
          this.renderFace(renderer, scene, slot, s, f, false, {
            includeWorld: true,
            excludeEntities: entities,
            excludePools: instancePools,
          });
          slot.staticPending &= ~bit;
          slot.staticMask |= bit;
          facesDynamic++;
          texelsChanged = true;
        }
      }

      // Entity overlay faces re-render every frame while a caster stands in
      // them; cached world faces are never touched.
      let overlayMask = 0;
      if (entities && entities.length > 0) {
        for (let f = 0; f < 6; f++) {
          const bit = 1 << f;
          if ((slot.allowedMask & bit) === 0) continue;
          if (!this.faceHasEntityCaster(slot, f, entities)) continue;
          if (!ledger.requestLocal("dynamic", this.faceCostUnits)) {
            // Denied: keep sampling last frame's overlay rather than
            // popping the caster's shadow off for a frame.
            overlayMask |= slot.dynamicMask & bit;
            continue;
          }
          this.renderFace(renderer, scene, slot, s, f, true, {
            includeWorld: false,
            entities,
            instancePools,
          });
          overlayMask |= bit;
          facesDynamic++;
        }
      }
      if (overlayMask !== slot.dynamicMask) {
        slot.dynamicMask = overlayMask;
        texelsChanged = true;
      }
    }

    // Invalidated static faces, FIFO across slots, free budget only.
    for (let s = 0; s < this.slots.length; s++) {
      const slot = this.slots[s];
      if (slot.index < 0 || slot.isMovingLight || slot.staticPending === 0) {
        continue;
      }
      for (let f = 0; f < 6; f++) {
        const bit = 1 << f;
        if ((slot.staticPending & bit) === 0) continue;
        if (!ledger.requestLocal("static", this.faceCostUnits)) break;
        this.renderFace(renderer, scene, slot, s, f, false, {
          includeWorld: true,
          excludeEntities: entities,
          excludePools: instancePools,
        });
        slot.staticPending &= ~bit;
        slot.staticMask |= bit;
        facesStatic++;
        texelsChanged = true;
      }
    }

    for (const { object, visible } of hidden) object.visible = visible;
    scene.overrideMaterial = originalOverride;
    renderer.setRenderTarget(previousTarget);

    if (texelsChanged) this.onShadowDataChanged?.();

    stats.shadowFacesStatic = facesStatic;
    stats.shadowFacesDynamic = facesDynamic;
    stats.shadowFacesRendered = facesStatic + facesDynamic;
    const elapsed = performance.now() - start;
    stats.shadowScheduleMs = elapsed;
    if (elapsed > stats.shadowScheduleMsPeak) {
      stats.shadowScheduleMsPeak = elapsed;
    }
  }

  dispose(): void {
    this.atlas.dispose();
    this.depthMaterial.dispose();
    for (let s = 0; s < this.slots.length; s++) this.releaseSlot(s);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private renderFace(
    renderer: WebGLRenderer,
    scene: Scene,
    slot: ShadowSlot,
    slotId: number,
    face: number,
    isDynamicCell: boolean,
    casters: {
      includeWorld: boolean;
      entities?: Object3D[];
      instancePools?: Group[];
      /**
       * Overlay-owned casters that must never bake into a world cell: the
       * scene graph contains them as children, so a world depth pass would
       * otherwise stamp whatever pose and position they hold this instant
       * into a cache that outlives both.
       */
      excludeEntities?: Object3D[];
      excludePools?: Group[];
    },
  ): void {
    const camera = this.faceCamera;
    if (slot.isSpot) {
      const i = slot.index;
      const view = spotViewScratch;
      view.light[0] = slot.x;
      view.light[1] = slot.y;
      view.light[2] = slot.z;
      view.direction[0] = this.registry.aux[i * 4];
      view.direction[1] = this.registry.aux[i * 4 + 1];
      view.direction[2] = this.registry.aux[i * 4 + 2];
      view.tanHalf = slot.tanHalf;
      view.near = SHADOW_NEAR;
      view.far = slot.far;
      orientSpotCamera(camera, view);
    } else {
      const view = pointViewScratch;
      view.light[0] = slot.x;
      view.light[1] = slot.y;
      view.light[2] = slot.z;
      view.face = face;
      view.tanHalf = slot.tanHalf;
      view.near = SHADOW_NEAR;
      view.far = slot.far;
      orientPointFaceCamera(camera, view);
    }

    const cell = this.atlas.cellIndex(slotId, face, isDynamicCell);
    const viewport = this.viewportScratch;
    this.atlas.cellViewport(cell, viewport);
    const target = this.atlas.ensureAllocated();
    target.viewport.set(viewport[0], viewport[1], viewport[2], viewport[2]);
    target.scissor.set(viewport[0], viewport[1], viewport[2], viewport[2]);
    renderer.setRenderTarget(target);
    renderer.clear(true, true, false);

    if (casters.includeWorld) {
      // Entity casters live exclusively in the per-frame dynamic overlay.
      // They are also children of the world scene, so without this they
      // would render into the cached cell too — freezing their current
      // pose and position into depth that gets sampled long after they
      // walked away (the stamped-silhouette bug). Hide them for the world
      // pass; exact visibility is restored before returning.
      const hiddenCasters = this.worldPassHidden;
      hiddenCasters.length = 0;
      if (casters.excludeEntities) {
        for (const entity of casters.excludeEntities) {
          if (entity.visible) {
            hiddenCasters.push(entity);
            entity.visible = false;
          }
        }
      }
      if (casters.excludePools) {
        for (const pool of casters.excludePools) {
          if (pool.visible) {
            hiddenCasters.push(pool);
            pool.visible = false;
          }
        }
      }
      scene.overrideMaterial = this.depthMaterial;
      renderer.render(scene, camera);
      scene.overrideMaterial = null;
      for (const object of hiddenCasters) object.visible = true;
      hiddenCasters.length = 0;
    }

    if (casters.entities && casters.entities.length > 0) {
      const reparented = this.reparentedCasters;
      reparented.length = 0;
      for (const entity of casters.entities) {
        if (entity.userData.castsShadow === false) continue;
        if (!this.isEntityNearSlot(slot, entity)) continue;
        reparented.push({ object: entity, parent: entity.parent });
        this.casterScene.add(entity);
      }
      if (reparented.length > 0) {
        this.casterScene.overrideMaterial = this.depthMaterial;
        renderer.render(this.casterScene, camera);
        this.casterScene.overrideMaterial = null;
        for (const { object, parent } of reparented) {
          if (parent) {
            parent.add(object);
          } else {
            this.casterScene.remove(object);
          }
        }
        this.casterScene.children.length = 0;
      }
    }

    // Instanced pools carry their own depth materials (alpha-tested
    // impostors); swap exactly the way the CSM entity pass does.
    if (casters.instancePools && casters.instancePools.length > 0) {
      const swaps = this.poolMaterialSwaps;
      swaps.length = 0;
      for (const pool of casters.instancePools) {
        pool.traverse((child) => {
          const mesh = child as Mesh;
          if (mesh.isMesh && mesh.customDepthMaterial) {
            swaps.push({ mesh, material: mesh.material });
            mesh.material = mesh.customDepthMaterial;
          }
        });
      }
      if (swaps.length > 0) {
        for (const pool of casters.instancePools) {
          renderer.render(pool, camera);
        }
        for (const { mesh, material } of swaps) mesh.material = material;
      }
    }
  }

  private isEntityNearSlot(slot: ShadowSlot, entity: Object3D): boolean {
    const dx = entity.position.x - slot.x;
    const dy = entity.position.y - slot.y;
    const dz = entity.position.z - slot.z;
    const reach = slot.far + ENTITY_CASTER_RADIUS;
    return dx * dx + dy * dy + dz * dz <= reach * reach;
  }

  /**
   * Conservative test: does an entity intersect this face's frustum? A spot
   * slot's single face renders along its *cone*, not the cube-face basis, so
   * the axis comes from the slot's aim and the lateral bound is the exact
   * distance from that axis (visible spot response is circular; casters
   * outside it cannot darken anything the light shows).
   */
  private faceHasEntityCaster(
    slot: ShadowSlot,
    face: number,
    entities: Object3D[],
  ): boolean {
    const fwd = SHADOW_FACE_FORWARD[face];
    const fx = slot.isSpot ? slot.dirX : fwd[0];
    const fy = slot.isSpot ? slot.dirY : fwd[1];
    const fz = slot.isSpot ? slot.dirZ : fwd[2];
    for (const entity of entities) {
      if (entity.userData.castsShadow === false) continue;
      if (!this.isEntityNearSlot(slot, entity)) continue;
      const rx = entity.position.x - slot.x;
      const ry = entity.position.y - slot.y;
      const rz = entity.position.z - slot.z;
      const w = rx * fx + ry * fy + rz * fz;
      if (w < -ENTITY_CASTER_RADIUS) continue;
      const limit = Math.max(w, 0) * slot.tanHalf + ENTITY_CASTER_RADIUS;
      if (slot.isSpot) {
        const lateralSq = Math.max(rx * rx + ry * ry + rz * rz - w * w, 0);
        if (lateralSq <= limit * limit) return true;
        continue;
      }
      const uAbs = Math.abs(rx * (1 - Math.abs(fwd[0])));
      const vAbs = Math.abs(ry * (1 - Math.abs(fwd[1])));
      const sAbs = Math.abs(rz * (1 - Math.abs(fwd[2])));
      const lateral = Math.max(uAbs, vAbs, sAbs);
      if (lateral <= limit) return true;
    }
    return false;
  }

  private logInvalidation(slot: number, cause: ShadowInvalidationCause): void {
    this.invalidationLog.push({ frame: this.frame, slot, cause });
    if (this.invalidationLog.length > 32) this.invalidationLog.shift();
  }
}

function makeEmptySlot(): ShadowSlot {
  return {
    index: -1,
    generation: 0,
    x: 0,
    y: 0,
    z: 0,
    far: 1,
    tanHalf: POINT_FACE_GUARD_TAN_HALF,
    isSpot: false,
    dirX: 0,
    dirY: 0,
    dirZ: 0,
    cosOuter: 0,
    isMovingLight: false,
    allowedMask: FULL_FACE_MASK,
    staticMask: 0,
    dynamicMask: 0,
    staticPending: 0,
  };
}

/** Guarded half-FOV tangent for a spot cone's authored outer cosine. */
function spotGuardTanHalf(cosOuterRaw: number): number {
  const cosOuter = Math.min(Math.max(cosOuterRaw, 0.05), 0.999);
  return (Math.sqrt(1 - cosOuter * cosOuter) / cosOuter) * SPOT_GUARD_SCALE;
}

function popcount(mask: number): number {
  let count = 0;
  let m = mask;
  while (m) {
    count += m & 1;
    m >>= 1;
  }
  return count;
}
