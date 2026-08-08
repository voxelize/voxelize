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
  /** Scales this light's analytic contribution against the flood base. */
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

export type LightQualityTier = "ultra" | "high" | "medium" | "low" | "potato";

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
  >
> = {
  ultra: {
    maxClusteredLights: 255,
    maxLightsPerCell: 8,
    analyticRadius: 96,
    fluidSpecularStrength: 1,
  },
  high: {
    maxClusteredLights: 192,
    maxLightsPerCell: 8,
    analyticRadius: 64,
    fluidSpecularStrength: 1,
  },
  medium: {
    maxClusteredLights: 128,
    maxLightsPerCell: 6,
    analyticRadius: 48,
    fluidSpecularStrength: 0,
  },
  low: {
    maxClusteredLights: 64,
    maxLightsPerCell: 4,
    analyticRadius: 32,
    fluidSpecularStrength: 0,
  },
  potato: {
    maxClusteredLights: 0,
    maxLightsPerCell: 0,
    analyticRadius: 0,
    fluidSpecularStrength: 0,
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
}

/** Zero-allocation output target for {@link LocalLights.queryLocalLights}. */
export interface LocalLightSample {
  /** Combined linear RGB arriving at the query point. */
  color: [number, number, number];
  /** Lights that contributed. */
  count: number;
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
