import { Color, IUniform, MathUtils } from "three";

import { LightUtils } from "../../utils/light-utils";

/**
 * Per-channel coefficients for Beer-Lambert water extinction, expressed per
 * block (~meter) of water. All water rendering derives from this one table.
 */
export type WaterChannelCoefficients = {
  red: number;
  green: number;
  blue: number;
};

/**
 * The single source of truth for how water absorbs and scatters light.
 *
 * Every underwater visual — fog color and density, terrain and entity light
 * attenuation, sky dome fading, first-person prop tinting — is derived from
 * these values so the whole scene stays physically coherent.
 */
export const WATER_OPTICS = Object.freeze({
  /**
   * Beer-Lambert downwelling extinction per channel, per block of depth.
   * Tuned slightly steeper than clear-ocean measurements so the full spectral
   * curve unfolds within the game's ~40-block ocean depths: red dies within
   * ~8 blocks, green by ~30, and blue carries past 60 before fading to black.
   */
  downwellingExtinction: { red: 0.38, green: 0.1, blue: 0.048 },

  /**
   * Scale from downwelling extinction to extinction along the camera's view
   * ray, which drives the exponential in-scattering fog while submerged.
   */
  viewExtinctionScale: 0.85,

  /**
   * Fraction of downwelling extinction applied to the in-scattered color for
   * above-surface views. Full endpoint extinction makes a deep column collapse
   * into an oil-dark patch because much of the visible scatter came from
   * shallower points along the ray; this approximates that integrated path.
   */
  aboveSurfaceScatterDepthScale: 0.3,

  /**
   * In-scattered water color just below the surface under full sun (SRGB).
   * Deeper ambient colors come from filtering this through
   * {@link WATER_OPTICS.downwellingExtinction}, which naturally walks the
   * palette from bright teal to saturated blue to near-black.
   */
  surfaceScatterColor: "#37b6c5",

  /** Fraction of surface scatter that remains under moonlight and stars. */
  nightScatterFloor: 0.06,

  /** Eye depth over which underwater rendering blends in at the waterline. */
  waterlineFadeDepth: 0.12,

  /** Smoothing speed (per second) when the camera submerges. */
  submersionRiseSpeed: 16,

  /** Smoothing speed (per second) when the camera surfaces. */
  submersionFallSpeed: 11,

  /** Smoothing speed (per second) for camera depth changes. */
  depthSmoothingSpeed: 7,

  /**
   * Extinction used to fade the sky dome and celestial sprites with camera
   * depth, so the sun and sky stay visible from the shallows but vanish in
   * the deep.
   */
  skyFadeExtinction: 0.1,

  /** Sun-scaled strength of the ambient scatter glow on submerged terrain. */
  scatterFillSunStrength: 0.2,

  /** Sunless base strength of the ambient scatter glow on submerged terrain. */
  scatterFillBase: 0.03,

  /**
   * Scale from downwelling extinction to the water surface's own
   * tint-with-depth absorption, seen when looking at water from outside.
   */
  surfaceAbsorptionScale: 0.55,

  /** Grazing-angle opacity added by the water's Fresnel reflection. */
  fresnelAlphaStrength: 0.65,

  /** Reflected-sun alignment where the cheap analytic glint begins. */
  sunGlintStartCos: 0.985,

  /** Reflected-sun alignment where the analytic glint reaches full strength. */
  sunGlintFullCos: 0.9995,

  /** Peak intensity of the analytic sun glint. */
  sunGlintStrength: 0.8,

  /**
   * View-incidence cosine (geometric surface normal vs. view direction)
   * below which the surface's screen-space refraction distortion is fully
   * suppressed. At grazing angles the displaced sample no longer lands on
   * geometry that sits behind the surface, which reads as ghost copies and
   * frame-to-frame color flashing; reflection dominates there anyway.
   */
  refractionGrazingCutoffCos: 0.3,

  /**
   * View-incidence cosine above which refraction distortion runs at full
   * strength. Top-down views (open ocean, pools seen from above) sit near
   * 1.0 and keep their full rippled-displacement look.
   */
  refractionFullStrengthCos: 0.85,

  /**
   * Per-channel floor of the near-camera light filter so first-person props
   * keep a readable silhouette even in the abyss.
   */
  lightFilterFloor: 0.04,

  /**
   * Drawing-buffer pixel count above which the refraction capture turns
   * itself off. The capture is a mid-render-pass framebuffer copy, which on
   * tile-based GPUs splits the pass and pays a full store + reload of the
   * framebuffer. Measured: fine at 7.5M pixels, 33ms frames at 14.7M. The
   * line sits just above a native Retina laptop (1728x1080 at 2x = 7.5M) so
   * ordinary high-density play keeps its refraction; 4K-at-2x and capture
   * sessions skip the copy once it would scale with output. Evaluated
   * against the live buffer every frame, so a render scale that steps a
   * huge display down far enough brings the capture back.
   */
  refractionMaxDrawingBufferPixels: 8_000_000,

  /**
   * Distance band (blocks) over which the medium wave octave of the water
   * surface fades out. Beyond the end of the band its ~0.7-block wavelength
   * is subpixel at typical resolutions, so evaluating it only costs ALU and
   * reads as specular shimmer.
   */
  mediumWaveFadeStartBlocks: 64,
  mediumWaveFadeEndBlocks: 128,

  /**
   * Distance band (blocks) over which the large wave octave (~3-block
   * wavelength) fades out — the same subpixel argument as the other bands,
   * one octave up. The low-frequency swell (20-block wavelength) is spared:
   * it stays resolvable to the horizon, and without any normal variation
   * distant water collapses into a flat mirror of the sky — a bright sheet
   * that reads as an artifact behind shoreline foliage.
   */
  baseWaveFadeStartBlocks: 144,
  baseWaveFadeEndBlocks: 256,

  /**
   * What grazing-angle fresnel decays toward across the base-wave fade
   * band. A wavy surface tilts half its normals toward the viewer, so its
   * aggregate reflectivity sits well below a flat mirror's; once the large
   * octave no longer supplies that variation per-fragment, this factor
   * supplies it statistically, keeping far water the same tint-dominant
   * shade it had when the octave was evaluated.
   */
  distantFresnelFactor: 0.55,

  /**
   * Distance band (blocks) over which the surface ripple/sparkle octaves
   * fade out, for the same subpixel reason as the medium wave band.
   */
  rippleFadeStartBlocks: 48,
  rippleFadeEndBlocks: 96,

  /**
   * Analytic directional slopes for the surface normal. Keeping these in
   * data makes water style tunable without restoring the former per-pixel
   * finite-difference simplex stack (eleven 3D noise evaluations).
   */
  surfaceNormalWaves: [
    { direction: [0.8, 0.6], frequency: 0.32, speed: 0.25, slope: 0.11 },
    { direction: [-0.6, 0.8], frequency: 0.58, speed: -0.18, slope: 0.07 },
    { direction: [0.7, -0.7], frequency: 1.4, speed: 0.45, slope: 0.045 },
    // Fine ripple octave (~2-block wavelength). Fades with the ripple band:
    // it exists to break the reflection up close, where a flat sheet over
    // ground reads as a tint rather than a surface.
    { direction: [-0.3, -0.95], frequency: 3.1, speed: -0.6, slope: 0.03 },
  ],
  surfaceRippleWaves: [
    { direction: [1.0, 0.35], frequency: 1.8, speed: 0.9 },
    { direction: [-0.4, 1.0], frequency: 4.8, speed: -1.2 },
  ],

  /**
   * Standing water over ground, as seen from above through its surface.
   * The refraction sample is the floor of the column, so it takes the
   * floor's optics rather than reading as the dry ground it was a moment
   * before the water arrived:
   *
   * - Beer-Lambert absorption over the down-and-back light path, as
   *   `floorAbsorptionPathScale` blocks of extinction per block of water,
   *   using the same per-channel table as everything else. Depth is capped
   *   at `floorAbsorptionMaxDepth`: past that the water-exposed floor's own
   *   fog already carries the deep look, and stacking both went black.
   * - A flat wet-surface darkening (`wetFloorDarken`) so the shoreline
   *   reads even under a film too thin to absorb anything — wet stone is
   *   darker than dry stone, and that boundary is the strongest cue that
   *   there is water here at all.
   * - The water's own in-scatter growing with thickness, at
   *   `shallowScatterDensity` per block up to `shallowScatterMaxMix` of the
   *   surface color, so a two-block pool is visibly more water than a
   *   spreading edge a tenth of a block deep.
   */
  floorAbsorptionPathScale: 1.6,
  floorAbsorptionMaxDepth: 4,
  wetFloorDarken: 0.8,
  shallowScatterDensity: 0.5,
  shallowScatterMaxMix: 0.35,

  /**
   * An air-side wall — a waterfall's face, the front of a spread, a column
   * pouring off a step — is looked at through water too: a fluid face only
   * exists where its voxel holds fluid, so at least that voxel of water
   * stands behind it. The wall's refraction sample takes this many blocks
   * of the floor absorption and in-scatter above. Without it the wall
   * composited the scene behind it untouched, at a depth of zero, and read
   * as a hole: a cascade down a staircase drew as floating sheets with
   * every riser missing. Panes keep their window treatment.
   */
  wallPathBlocks: 1.0,
  /**
   * Share of the surface's opacity floor a wall keeps while the camera is
   * under water. Seen from inside, a wall is the way out — near normal
   * incidence it transmits almost everything — so it stays lighter than the
   * surface; raising it with the air-side walls veiled the view out of a
   * tank. The blend follows the smoothed submersion, so the wall's opacity
   * crosses over with everything else as the camera breaks the surface.
   */
  submergedWallAlphaScale: 0.55,

  /**
   * Caustics on the floor: bright where the surface is locally flat and
   * acts as a lens, read off the same analytic slope field that shapes the
   * normal so the light moves with the ripples it belongs to. A slope of
   * `causticLensSlope` or more is fully dark. They fade with depth as real
   * caustics blur (`causticDepthFalloff` per block), with sun and shadow,
   * and with the ripple distance band.
   */
  causticStrength: 0.35,
  causticLensSlope: 0.1,
  causticDepthFalloff: 0.7,

  /**
   * Flow. Water runs downhill along its own surface, and a fluid's top face
   * is a bilinear patch through the mesher's corner heights, which step
   * down one stage per block away from the source. That rest height is a
   * potential for the flow: neighbouring faces share their corner heights,
   * so it is continuous across the whole sheet, and it falls away from the
   * source. Its contour lines are therefore the crests of a flow running
   * downstream — smooth across every face by construction, spaced
   * `flowCrestSpacingBlocks` apart where the sheet falls a full stage per
   * block, wider where the fall is gentler, and absent on still water,
   * whose surface is flat. Drawing crests off a per-face direction instead
   * left a phase seam at every voxel edge.
   *
   * The crests tilt the normal downhill (`flowSlopeAmplitude`, so
   * reflection, refraction and caustics travel with them) and catch a
   * highlight on their tops (`flowStreakStrength`). Downhill is the flow
   * the mesher packs at every surface vertex — the slope of the rendered
   * surface at that corner, the same value for every face meeting there —
   * interpolated across the face, so the direction field is continuous
   * and the cue fades out across a face whose far corners sit on still
   * water. (A slope read per face from screen derivatives left a visible
   * seam wherever two faces disagreed on direction.) `flowBandSpeed` is in
   * the shader's wave-time units, which advance 0.5/s: on a full-stage
   * slope the crests run 6.5 × 0.5 / (2π / (0.1 × 1.5)) / 0.1 ≈ 0.8 blocks
   * per second.
   */
  flowCrestSpacingBlocks: 1.5,
  flowBandSpeed: 6.5,
  flowSlopeAmplitude: 0.09,
  flowStreakStrength: 0.4,

  /**
   * Opacity floor of a water face, top or air-side wall alike. With the
   * refraction capture live the shader composites the floor itself, so
   * whatever alpha leaves to the blend only shows the dry ground through
   * the water again and dilutes every cue above. Without the capture the
   * surface is a plain tinted layer and keeps more of the ground visible
   * through it. Walls used to take about half of this, which is the other
   * half of why a spread's leading edge and a waterfall's face vanished.
   */
  surfaceAlphaFloor: 0.58,
  refractedSurfaceAlphaFloor: 0.8,

  /**
   * A vertical water face pressed against a see-through solid (a Barrier or
   * glass tank wall) is a window pane, not a lake surface. Fluids draw
   * DoubleSide and do not write depth, so the near pane, its back, and the
   * far wall of a tank otherwise stack into a milky sheet. These scales fade
   * the lake treatment on panes at head-on incidence; grazing angles keep
   * more of it. The mesher marks panes (`FLUID_PANE_BIT`); a vertical face
   * against open air — the front of a spreading flow, a waterfall, a leak's
   * edge — is the water's own surface and never takes this treatment.
   * Underwater viewing is untouched (`airSideFace` is 0 while submerged).
   */
  airSideFaceAlphaScale: 0.42,
  airSideFaceGlossScale: 0.0,
  airSideFaceTintMix: 0.85,
  /**
   * Head-on cosine above which a pane is not drawn at all. A Barrier tank
   * window is a wall you look straight at; it is supposed to be a hole.
   */
  airSideFaceCullCos: 0.7,

  /** Max blocks scanned upward when measuring a water column's surface. */
  maxSurfaceScanBlocks: 96,

  /**
   * Height of a resting fluid surface within its voxel. Mirrors
   * FLUID_BASE_HEIGHT in the mesher so the waterline plane matches the
   * rendered surface.
   */
  fluidSurfaceHeight: 0.875,

  /**
   * How far a flowing fluid's surface drops per stage of spread. Mirrors
   * FLUID_STAGE_DROPOFF in the mesher; sets the crest spacing of the flow
   * cue in blocks rather than in height.
   */
  fluidStageDropoff: 0.1,
});

/**
 * Radians of flow-crest phase per block of rest height: one full crest every
 * {@link WATER_OPTICS.flowCrestSpacingBlocks} blocks on a sheet falling a
 * full stage per block.
 */
export const FLOW_CREST_PHASE_PER_HEIGHT =
  (2 * Math.PI) /
  (WATER_OPTICS.fluidStageDropoff * WATER_OPTICS.flowCrestSpacingBlocks);

export const WATER_SURFACE_SCATTER_COLOR = new Color(
  WATER_OPTICS.surfaceScatterColor,
);

function scaleCoefficients(
  coefficients: WaterChannelCoefficients,
  scale: number,
): WaterChannelCoefficients {
  return {
    red: coefficients.red * scale,
    green: coefficients.green * scale,
    blue: coefficients.blue * scale,
  };
}

export const WATER_VIEW_EXTINCTION: WaterChannelCoefficients =
  scaleCoefficients(
    WATER_OPTICS.downwellingExtinction,
    WATER_OPTICS.viewExtinctionScale,
  );

function coefficientsToGlslVec3(
  coefficients: WaterChannelCoefficients,
): string {
  return `vec3(${coefficients.red.toFixed(5)}, ${coefficients.green.toFixed(
    5,
  )}, ${coefficients.blue.toFixed(5)})`;
}

function colorToGlslVec3(color: Color): string {
  return `vec3(${color.r.toFixed(5)}, ${color.g.toFixed(5)}, ${color.b.toFixed(
    5,
  )})`;
}

export const WATER_DOWNWELLING_EXTINCTION_GLSL = coefficientsToGlslVec3(
  WATER_OPTICS.downwellingExtinction,
);

export const WATER_VIEW_EXTINCTION_GLSL = coefficientsToGlslVec3(
  WATER_VIEW_EXTINCTION,
);

export const WATER_SURFACE_SCATTER_GLSL = colorToGlslVec3(
  WATER_SURFACE_SCATTER_COLOR,
);

/**
 * Extinction of the voxel sunlight encoding per water block, matching the
 * Beer-Lambert transmittance used by the light engine. The chunk shader uses
 * it to tell genuinely submerged fragments apart from dry ground that merely
 * sits below the nominal water level.
 */
export const VOXEL_SUNLIGHT_EXTINCTION_PER_WATER_BLOCK = -Math.log(
  LightUtils.BEER_LAMBERT_TRANSMITTANCE_NUM /
    LightUtils.BEER_LAMBERT_TRANSMITTANCE_DEN,
);

export const UNDERWATER_FOG_UNIFORM_DECLARATIONS = `
uniform float uCameraSubmersion;
uniform float uCameraWaterPlaneY;
uniform vec3 uUnderwaterAmbient;
`;

/**
 * Per-channel exponential (Beer-Lambert) fog along the camera's underwater
 * view path. Expects `vWorldPosition`, `cameraPosition`, and `gl_FragColor`
 * in scope. The path is clamped at the waterline plane so geometry above the
 * surface only receives fog for the submerged segment of the ray.
 */
export const UNDERWATER_FOG_FRAGMENT = `
if (uCameraSubmersion > 0.001) {
  vec3 uwRay = vWorldPosition.xyz - cameraPosition;
  float uwDist = max(length(uwRay), 1e-4);
  float uwPath = uwDist;
  if (uwRay.y > 1e-4) {
    float uwToPlane = (uCameraWaterPlaneY - cameraPosition.y) * uwDist / uwRay.y;
    uwPath = min(uwPath, max(uwToPlane, 0.0));
  }
  vec3 uwTransmit = exp(-${WATER_VIEW_EXTINCTION_GLSL} * uwPath);
  vec3 uwColor = gl_FragColor.rgb * uwTransmit + uUnderwaterAmbient * (1.0 - uwTransmit);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uwColor, uCameraSubmersion);
}
`;

/**
 * The above-surface counterpart of {@link UNDERWATER_FOG_FRAGMENT}: the same
 * Beer-Lambert in-scattering fog, but for water-exposed terrain seen from
 * outside the surface. It fades a submerged fragment toward the water's own
 * depth-filtered in-scattered color along the sub-surface segment of the view
 * ray. The scatter target darkens spectrally with the fragment's depth instead
 * of sending every long ray toward the bright surface teal, so deep water
 * reads as ocean rather than milky water.
 *
 * Expects `outgoingLight`, `uCameraSubmersion`, `uUnderwaterAmbient`,
 * `vWaterExposed`, and vertex-interpolated `vAboveSurfaceWaterTransmit` in
 * scope. The vertex stage computes the expensive ray length and exponential;
 * transmission varies smoothly enough across a voxel face to interpolate.
 * Runs before sky/height fog so nearer air fog layers on top.
 */
export const ABOVE_SURFACE_WATER_FOG_FRAGMENT = `
if (vWaterExposed > 0.5 && uCameraSubmersion < 1.0 && cameraPosition.y > uWaterLevel) {
  float aswDepth = max(uWaterLevel - vWorldPosition.y, 0.0);
  vec3 aswAmbient = uUnderwaterAmbient
    * exp(
      -${WATER_DOWNWELLING_EXTINCTION_GLSL}
      * aswDepth
      * ${WATER_OPTICS.aboveSurfaceScatterDepthScale.toFixed(4)}
    );
  vec3 aswColor = outgoingLight.rgb * vAboveSurfaceWaterTransmit
    + aswAmbient * (1.0 - vAboveSurfaceWaterTransmit);
  outgoingLight.rgb = mix(outgoingLight.rgb, aswColor, 1.0 - uCameraSubmersion);
}
`;

export interface UnderwaterFogUniforms {
  uCameraSubmersion: IUniform<number>;
  uCameraWaterPlaneY: IUniform<number>;
  uUnderwaterAmbient: IUniform<Color>;
}

export interface UnderwaterFogSource {
  submersion: number;
  waterPlaneY: number;
  ambientColor: Color;
}

export function createUnderwaterFogUniforms(): UnderwaterFogUniforms {
  return {
    uCameraSubmersion: { value: 0 },
    uCameraWaterPlaneY: { value: 0 },
    uUnderwaterAmbient: { value: new Color(0, 0, 0) },
  };
}

export function updateUnderwaterFogUniforms(
  target: UnderwaterFogUniforms,
  source: UnderwaterFogSource,
): void {
  target.uCameraSubmersion.value = source.submersion;
  target.uCameraWaterPlaneY.value = source.waterPlaneY;
  target.uUnderwaterAmbient.value.copy(source.ambientColor);
}

export function getDownwellingTransmittance(depth: number, out: Color): Color {
  const clampedDepth = Math.max(depth, 0);
  const { red, green, blue } = WATER_OPTICS.downwellingExtinction;
  return out.setRGB(
    Math.exp(-red * clampedDepth),
    Math.exp(-green * clampedDepth),
    Math.exp(-blue * clampedDepth),
  );
}

export function getEffectiveScatterStrength(sunStrength: number): number {
  const sun = MathUtils.clamp(sunStrength, 0, 1);
  return (
    WATER_OPTICS.nightScatterFloor + (1 - WATER_OPTICS.nightScatterFloor) * sun
  );
}

export function getUnderwaterAmbientColor(
  depth: number,
  sunStrength: number,
  out: Color,
): Color {
  getDownwellingTransmittance(depth, out);
  const scatter = getEffectiveScatterStrength(sunStrength);
  return out.multiply(WATER_SURFACE_SCATTER_COLOR).multiplyScalar(scatter);
}

export type FluidQuery = (vx: number, vy: number, vz: number) => boolean;

export type WaterColumnSample = {
  depth: number;
  surfaceY: number;
};

export function measureWaterColumn(
  isFluidAt: FluidQuery,
  x: number,
  y: number,
  z: number,
): WaterColumnSample | null {
  const vx = Math.floor(x);
  const vz = Math.floor(z);
  let vy = Math.floor(y);

  if (!isFluidAt(vx, vy, vz)) {
    return null;
  }

  const maxY = vy + WATER_OPTICS.maxSurfaceScanBlocks;
  while (vy + 1 <= maxY && isFluidAt(vx, vy + 1, vz)) {
    vy += 1;
  }

  const surfaceY = vy + WATER_OPTICS.fluidSurfaceHeight;
  const depth = surfaceY - y;
  if (depth <= 0) {
    return null;
  }

  return { depth, surfaceY };
}

function expSmooth(
  current: number,
  target: number,
  speed: number,
  deltaSeconds: number,
): number {
  const alpha = 1 - Math.exp(-speed * deltaSeconds);
  return MathUtils.lerp(current, target, alpha);
}

export type WaterOpticsFrameInput = {
  isFluidAt: FluidQuery;
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  sunStrength: number;
  deltaSeconds: number;
};

/**
 * Per-frame driver of the camera's underwater state. Smooths submersion and
 * depth across the waterline, and derives the ambient water color, sky fade,
 * and near-camera light filter that the renderer uniforms consume.
 */
export class WaterOptics {
  public submersion = 0;

  public depth = 0;

  public waterPlaneY = 0;

  public skyFade = 0;

  public readonly ambientColor = new Color(0, 0, 0);

  public readonly lightFilter = new Color(1, 1, 1);

  private readonly transmittanceScratch = new Color();

  update(input: WaterOpticsFrameInput): void {
    const { isFluidAt, cameraX, cameraY, cameraZ, sunStrength, deltaSeconds } =
      input;
    const delta = MathUtils.clamp(deltaSeconds, 0, 0.1);

    const column = measureWaterColumn(isFluidAt, cameraX, cameraY, cameraZ);
    const targetSubmersion = column
      ? MathUtils.clamp(column.depth / WATER_OPTICS.waterlineFadeDepth, 0, 1)
      : 0;
    const targetDepth = column ? column.depth : 0;
    if (column) {
      this.waterPlaneY = column.surfaceY;
    }

    const submersionSpeed =
      targetSubmersion > this.submersion
        ? WATER_OPTICS.submersionRiseSpeed
        : WATER_OPTICS.submersionFallSpeed;
    this.submersion = expSmooth(
      this.submersion,
      targetSubmersion,
      submersionSpeed,
      delta,
    );
    if (this.submersion < 0.002 && targetSubmersion === 0) {
      this.submersion = 0;
    }

    this.depth = column
      ? expSmooth(
          this.depth,
          targetDepth,
          WATER_OPTICS.depthSmoothingSpeed,
          delta,
        )
      : targetDepth;

    getUnderwaterAmbientColor(this.depth, sunStrength, this.ambientColor);

    this.skyFade =
      this.submersion *
      (1 - Math.exp(-WATER_OPTICS.skyFadeExtinction * this.depth));

    getDownwellingTransmittance(this.depth, this.transmittanceScratch);
    const floor = WATER_OPTICS.lightFilterFloor;
    this.lightFilter.setRGB(
      MathUtils.lerp(
        1,
        floor + (1 - floor) * this.transmittanceScratch.r,
        this.submersion,
      ),
      MathUtils.lerp(
        1,
        floor + (1 - floor) * this.transmittanceScratch.g,
        this.submersion,
      ),
      MathUtils.lerp(
        1,
        floor + (1 - floor) * this.transmittanceScratch.b,
        this.submersion,
      ),
    );
  }
}
