/**
 * Stable identity of a registered local light. Packed `index:20 | generation:12`;
 * `0` is the invalid handle. Handles are plain numbers: storable, comparable,
 * and allocation-free.
 */
export type LightHandle = number;

export const INVALID_LIGHT_HANDLE: LightHandle = 0;

export type LightShape = "point" | "spot" | "capsule";

export type LightShadowPolicy =
  | "none" //        analytic only; may leak through occluders
  | "voxelMask" //   masked by the baked flood field (static sources only)
  | "shadowMap"; //  requests a shadow slot; honored by the shadow phase (Engine PR B)

export interface FlickerProfile {
  /** Hz of the primary intensity wobble. */
  speed: number;
  /** 0..1 fraction of intensity the wobble spans. */
  amplitude: number;
}

export interface LocalLightDescriptor {
  shape: LightShape;
  /** Linear RGB, each 0..1. Exactly one of `color` | `colorTemperatureK`. */
  color?: [number, number, number];
  /** Kelvin, converted once at registration (1800K torch .. 6500K daylight). */
  colorTemperatureK?: number;
  /** Peak contribution in tonemapped-scene-relative units; 1.0 is a full torch. */
  intensity: number;
  /** Hard cutoff in blocks; falloff reaches exactly 0 here. */
  range: number;
  /**
   * Static sources are maskable by the flood field and assert that
   * `setPosition` will never be called on them.
   */
  isStatic: boolean;
  shadowPolicy: LightShadowPolicy;
  /** Spot only: axis the cone opens around. */
  direction?: [number, number, number];
  /** Spot only: full outer cone angle in degrees. */
  angleDeg?: number;
  /** Spot only: inner full-brightness cone as a fraction of the outer. */
  innerRatio?: number;
  /** Capsule only: second endpoint relative to the position. */
  endOffset?: [number, number, number];
  /**
   * Scales this light's analytic contribution — and, with it, the coverage
   * claim that suppresses the baked flood term. `1` (default): the light's
   * full visible output is analytic wherever it reaches. Lower values lean
   * on the flood base instead (useful for aggregated dense fields whose few
   * proxy records cannot reproduce a distributed glow).
   */
  analyticShare?: number;
  /** Shader-evaluated intensity wobble; never touches selection or packing. */
  flicker?: FlickerProfile;
  /** Additive selection-score bias for gameplay-critical lights. */
  priorityBias?: number;
}

/**
 * Declared by the game per block id (or name). When none is declared for an
 * emitting block, the engine derives a default from the block's flood light
 * levels — point shape, color from normalized RGB levels, range from the max
 * channel level, static, `voxelMask` — so unconfigured emitter blocks work.
 */
export interface BlockLightProfile
  extends Partial<Omit<LocalLightDescriptor, "isStatic">> {
  /** Emitter origin within the voxel. Default `[0.5, 0.5, 0.5]`. */
  offset?: [number, number, number];
  /** Collapse dense same-block emitters into per-section proxies. */
  aggregation?: "none" | "cluster";
  /** Emitters per 16-block section above which aggregation kicks in. */
  aggregateThreshold?: number;
  /** Proxy records a section may hold once aggregated. */
  maxProxiesPerSection?: number;
}

/**
 * `off` is the user-facing disable: exactly the legacy flood-lit frame plus
 * emissive faces. `potato` is the identical-looking low-end fallback tier —
 * same rendering, kept separate so a device auto-downgrade and an explicit
 * user setting remain distinguishable.
 */
export type LightQualityTier =
  | "ultra"
  | "high"
  | "medium"
  | "low"
  | "potato"
  | "off";

export interface LocalLightsOptions {
  /** Pool capacity for registered lights (static emitters + dynamic sources). */
  maxRegisteredLights: number;
  /** Lights the clustered layer may select per pass; capped at 255. */
  maxClusteredLights: number;
  /** Grid slots filled per cell; the shader loop is compiled for 8. */
  maxLightsPerCell: number;
  /** Blocks from the camera within which lights become analytic. */
  analyticRadius: number;
  /** Grid cell size in blocks. */
  gridCellSize: number;
  /** Grid cells per axis `[x, y, z]`; the window scrolls with the camera. */
  gridDims: [number, number, number];
  /** Sections scanned for emitters per frame at most. */
  maxSectionScansPerFrame: number;
  /** Multiplier a light's score gets while selected, against churn. */
  selectionHysteresis: number;
  /** Initial quality tier. */
  qualityTier: LightQualityTier;
  /** Strength of local specular on fluids; 0 disables. */
  fluidSpecularStrength: number;
  /** Flood-mask knee: flood level (0..1) at which masked lights reach full. */
  maskKnee: number;
  /**
   * How strongly the analytic layer owns visible block-source lighting
   * where it claims coverage (0..1). At 1, a fragment inside a selected
   * light's falloff is lit by the per-pixel model alone — the baked flood
   * term fades out in proportion to the analytic claim, so nothing
   * double-lights; where no selected light reaches (beyond range, past the
   * selection cap, outside the grid window), the flood remainder returns
   * to 1 and the legacy look is untouched. At 0 the legacy flood term
   * renders exactly as before local lights existed.
   */
  blockLightOwnership: number;
  /** Shadowed local lights at once; each owns a fixed atlas region. */
  maxShadowedLights: number;
  /** Edge length of the shared depth atlas, in pixels. */
  shadowAtlasSize: number;
  /** Edge length of one atlas cell (one cube face render), in pixels. */
  shadowSlotSize: number;
  /** Face units the shadow ledger may spend per frame (CSM + local). */
  shadowLedgerUnitsPerFrame: number;
  /** Ledger cost of the CSM near cascade, in face units. */
  csmNearCascadeUnits: number;
  /** Ledger cost of one CSM far cascade, in face units. */
  csmFarCascadeUnits: number;
  /**
   * A challenger light must out-score a shadow holder by `ratio` for
   * `frames` consecutive frames before evicting it from the atlas.
   */
  shadowEvictionHysteresis: { ratio: number; frames: number };
  /** Constant occluder-side depth bias in blocks (linear light space). */
  localShadowBias: number;
  /** Receiver offset along the surface normal, in shadow texels. */
  localShadowNormalBiasTexels: number;
  /** PCF tap spread, in shadow texels. */
  localShadowPcfRadius: number;
  /** 1 = an occluded fragment loses the light entirely. */
  localShadowStrength: number;
}

export const defaultLocalLightsOptions: LocalLightsOptions = {
  maxRegisteredLights: 4096,
  maxClusteredLights: 192,
  maxLightsPerCell: 8,
  analyticRadius: 64,
  gridCellSize: 8,
  gridDims: [24, 12, 24],
  maxSectionScansPerFrame: 16,
  selectionHysteresis: 1.2,
  qualityTier: "high",
  fluidSpecularStrength: 1,
  maskKnee: 2 / 15,
  blockLightOwnership: 1,
  maxShadowedLights: 3,
  shadowAtlasSize: 2048,
  shadowSlotSize: 256,
  shadowLedgerUnitsPerFrame: 12,
  csmNearCascadeUnits: 4,
  csmFarCascadeUnits: 6,
  shadowEvictionHysteresis: { ratio: 1.25, frames: 30 },
  localShadowBias: 0.035,
  localShadowNormalBiasTexels: 1.5,
  localShadowPcfRadius: 1.0,
  localShadowStrength: 1.0,
};

/**
 * Tier presets are data only: applying one changes pack-time caps and
 * uniforms, never shaders. `potato` turns the clustered layer off entirely,
 * rendering exactly the pre-local-lights frame plus emissive faces.
 */
export const LIGHT_QUALITY_TIERS: Record<
  LightQualityTier,
  Pick<
    LocalLightsOptions,
    | "maxClusteredLights"
    | "maxLightsPerCell"
    | "analyticRadius"
    | "fluidSpecularStrength"
    | "blockLightOwnership"
    | "maxShadowedLights"
    | "shadowAtlasSize"
    | "shadowSlotSize"
    | "shadowLedgerUnitsPerFrame"
  >
> = {
  ultra: {
    maxClusteredLights: 255,
    maxLightsPerCell: 8,
    analyticRadius: 96,
    fluidSpecularStrength: 1,
    blockLightOwnership: 1,
    maxShadowedLights: 4,
    shadowAtlasSize: 4096,
    shadowSlotSize: 512,
    shadowLedgerUnitsPerFrame: 16,
  },
  high: {
    maxClusteredLights: 192,
    maxLightsPerCell: 8,
    analyticRadius: 64,
    fluidSpecularStrength: 1,
    blockLightOwnership: 1,
    maxShadowedLights: 3,
    shadowAtlasSize: 2048,
    shadowSlotSize: 256,
    shadowLedgerUnitsPerFrame: 12,
  },
  medium: {
    maxClusteredLights: 128,
    maxLightsPerCell: 6,
    analyticRadius: 48,
    fluidSpecularStrength: 0,
    blockLightOwnership: 1,
    maxShadowedLights: 2,
    shadowAtlasSize: 2048,
    shadowSlotSize: 256,
    shadowLedgerUnitsPerFrame: 8,
  },
  low: {
    maxClusteredLights: 64,
    maxLightsPerCell: 4,
    analyticRadius: 32,
    fluidSpecularStrength: 0,
    blockLightOwnership: 1,
    maxShadowedLights: 0,
    shadowAtlasSize: 1024,
    shadowSlotSize: 256,
    shadowLedgerUnitsPerFrame: 4,
  },
  potato: {
    maxClusteredLights: 0,
    maxLightsPerCell: 0,
    analyticRadius: 0,
    fluidSpecularStrength: 0,
    blockLightOwnership: 0,
    maxShadowedLights: 0,
    shadowAtlasSize: 1024,
    shadowSlotSize: 256,
    shadowLedgerUnitsPerFrame: 4,
  },
  off: {
    maxClusteredLights: 0,
    maxLightsPerCell: 0,
    analyticRadius: 0,
    fluidSpecularStrength: 0,
    blockLightOwnership: 0,
    maxShadowedLights: 0,
    shadowAtlasSize: 1024,
    shadowSlotSize: 256,
    shadowLedgerUnitsPerFrame: 4,
  },
};

/** Mutated in place every update; never reallocated. */
export interface LocalLightStats {
  registered: number;
  candidates: number;
  clustered: number;
  cellsOverflowed: number;
  /** Cost of the current frame's phases; `0` on frames that skipped them. */
  selectMs: number;
  packMs: number;
  scanMs: number;
  /** Worst frame since the last {@link LocalLights.resetPeakStats}. */
  selectMsPeak: number;
  packMsPeak: number;
  scanMsPeak: number;
  sectionsPendingScan: number;
  selectionChurn: number;
  gridTextureUploads: number;
  dataTextureUploads: number;
  /** Lights currently holding a shadow slot. */
  shadowed: number;
  /** Atlas faces rendered this frame (static + dynamic). */
  shadowFacesRendered: number;
  shadowFacesStatic: number;
  shadowFacesDynamic: number;
  /** Main-thread cost of the shadow schedule + face renders this frame. */
  shadowScheduleMs: number;
  shadowScheduleMsPeak: number;
  /** Cumulative cache invalidations (block edits, streaming, regions). */
  shadowInvalidations: number;
  /** Cumulative slot evictions through the challenger hysteresis. */
  atlasEvictions: number;
  /** Active shadow slots over capacity, 0..1. */
  atlasOccupancy: number;
  /**
   * Of the frames in which a shadowed light was live, the fraction served
   * entirely from its cached static faces. Resets with peak stats.
   */
  shadowCacheHitRate: number;
  /** Ledger units the CSM cascades consumed this frame. */
  ledgerUnitsCsm: number;
  /** Ledger units local faces consumed this frame. */
  ledgerUnitsLocal: number;
  /** GPU bytes held by the shadow atlas (0 until first allocation). */
  atlasBytes: number;
}

/** Zero-allocation output target for {@link LocalLights.queryLocalLights}. */
export interface LocalLightSample {
  /** Combined linear RGB arriving at the query point. */
  color: [number, number, number];
  /** Lights that contributed. */
  count: number;
  /**
   * Unoccluded luminance the selected lights *claim* at the point (falloff
   * and cone shaping only — no flicker, occlusion, or shadows). Consumers
   * that also apply a baked flood term scale it by the flood remainder
   * derived from this claim, mirroring the chunk shader's ownership blend,
   * so a point covered by analytic lights is never lit by both models.
   */
  claim: number;
}

/**
 * Kelvin to linear RGB, Tanner Helland's fit, normalized so the hottest
 * channel is 1. Evaluated once per registration, never per frame.
 */
export function colorTemperatureToRgb(
  kelvin: number,
): [number, number, number] {
  const t = Math.min(Math.max(kelvin, 1000), 40000) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const clamp = (v: number) => Math.min(Math.max(v, 0), 255) / 255;
  const cr = clamp(r);
  const cg = clamp(g);
  const cb = clamp(b);
  const max = Math.max(cr, cg, cb, 1e-4);
  return [cr / max, cg / max, cb / max];
}
