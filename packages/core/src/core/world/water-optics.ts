import { Color, MathUtils } from "three";

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
   * Distance band (blocks) over which the medium wave octave of the water
   * surface fades out. Beyond the end of the band its ~0.7-block wavelength
   * is subpixel at typical resolutions, so evaluating it only costs ALU and
   * reads as specular shimmer.
   */
  mediumWaveFadeStartBlocks: 64,
  mediumWaveFadeEndBlocks: 128,

  /**
   * Distance band (blocks) over which the surface ripple/sparkle octaves
   * fade out, for the same subpixel reason as the medium wave band.
   */
  rippleFadeStartBlocks: 48,
  rippleFadeEndBlocks: 96,

  /** Max blocks scanned upward when measuring a water column's surface. */
  maxSurfaceScanBlocks: 96,

  /**
   * Height of a resting fluid surface within its voxel. Mirrors
   * FLUID_BASE_HEIGHT in the mesher so the waterline plane matches the
   * rendered surface.
   */
  fluidSurfaceHeight: 0.875,
});

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
