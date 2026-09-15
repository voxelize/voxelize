import { Color, IUniform, MathUtils } from "three";

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

  /**
   * The reflected sun. Up close the surface normal carries the full ripple
   * field, so a tight disc around the mirror direction breaks into the
   * glitter of a real sun path: every facet tilted onto the sun is one
   * spark. Alignment cosines bound the disc; strength is its peak.
   */
  sunGlintStartCos: 0.996,
  sunGlintFullCos: 0.9998,
  sunGlintStrength: 0.9,

  /**
   * The same glint on far water, blended in across the ripple fade band.
   * Out there the slope map's mips have averaged the ripples flat, and the
   * tight disc would focus back into one hard blob; a wider, dimmer disc
   * reads as the soft sun path a calm distance shows instead.
   */
  sunGlintFarStartCos: 0.95,
  sunGlintFarStrength: 0.3,

  /**
   * The two Blinn-Phong lobes under the glint: a broad one (power 32) that
   * is the sun's halo smeared across the ripples, and a medium one (power
   * 96) between it and the disc. Strengths are the peak added on a facet
   * aligned to the sun; the broad lobe takes its full strength on top faces
   * and the base on walls. Low, because the disc carries the brightness —
   * with strong lobes the whole sun path saturated into one white patch.
   */
  specularBroadBaseStrength: 0.04,
  specularBroadTopStrength: 0.06,
  specularMediumStrength: 0.12,

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
   * Distance band (blocks) over which the largest ripple layer's share of
   * the grazing reflectivity hands over to the statistical factor below.
   * The slope map's mips flatten the normal on their own out here; what
   * they cannot supply is the reflectivity a wavy surface has in aggregate.
   */
  baseWaveFadeStartBlocks: 144,
  baseWaveFadeEndBlocks: 256,

  /**
   * What grazing-angle fresnel decays toward across the base-wave fade
   * band. A wavy surface tilts half its normals toward the viewer, so its
   * aggregate reflectivity sits well below a flat mirror's; once the mips
   * no longer supply that variation per-fragment, this factor supplies it
   * statistically, keeping far water the same tint-dominant shade it had
   * when the ripples were resolved.
   */
  distantFresnelFactor: 0.55,

  /**
   * Distance band (blocks) over which the near-water treatments fade: crest
   * highlights, caustics, the flow crests, and the tight sun glint. Beyond
   * it the fine ripples are subpixel and those cues would only shimmer.
   */
  rippleFadeStartBlocks: 48,
  rippleFadeEndBlocks: 96,

  /**
   * The tileable slope map the surface normal is read from, baked once per
   * world (`water-normal-texture.ts`). Ridged noise: every octave folds
   * about zero so its zero crossings become sharp crests between smooth
   * troughs — the silhouette wind ripples actually have. The former sum of
   * four sinusoids had no creases anywhere, and a surface without them
   * reads as gel: one smooth bulge of sun, one smooth wobble of floor.
   * Texture lookups also replace the per-pixel trigonometry, and the mip
   * chain calms far water for free where the old octaves had to be faded
   * by hand.
   */
  surfaceNormalTexture: {
    size: 256,
    latticePeriod: 4,
    // Two octaves, not a fractal stack: each layer should be glassy facets
    // with crests at one dominant scale, and the three layers between them
    // cover the range. Crests at every octave in every layer read as grain.
    octaves: 2,
    gain: 0.5,
    ridgeSharpness: 1.3,
    seed: 1337,
    // 4, not the device maximum: at grazing incidence the bump already
    // fades toward flat, so the extra taps 8x or 16x would spend on the
    // horizon band sharpen ripples the shader is suppressing anyway. Each
    // level doubles the worst-case taps of every layer on every far pixel.
    anisotropy: 4,
  },

  /**
   * The slope map sampled at three world scales and summed into the
   * surface normal, the way every shader-pack water does it: a swell, the
   * ripples riding it, and the capillary texture riding those. `tileBlocks`
   * is the world size of one repeat; `drift` is the pattern's velocity in
   * blocks per second, each layer on its own heading so the sheet never
   * reads as one texture sliding; `rotation` turns the tile so the three
   * scales do not line up; `stretch` scales the tile along its rotated
   * axes, so a layer's ridges run long across one direction the way wind
   * ripples run across the wind instead of forming isotropic cells; `bump`
   * is the slope the tile's steepest facet contributes, so the sum bounds
   * the surface tilt. Most of the bump sits in the fine layer: that is the
   * glitter, while a coarse layer with the same bump reads as marble veins.
   */
  surfaceNormalLayers: [
    {
      tileBlocks: 40,
      drift: [0.5, 0.3],
      rotation: 0.0,
      stretch: [1.0, 1.0],
      bump: 0.05,
    },
    {
      tileBlocks: 10,
      drift: [-0.25, 0.45],
      rotation: 1.1,
      stretch: [1.0, 1.8],
      bump: 0.08,
    },
    {
      tileBlocks: 2.8,
      drift: [-0.3, -0.25],
      rotation: 2.3,
      stretch: [1.0, 1.6],
      bump: 0.11,
    },
  ],

  /**
   * The fine layer's bump is modulated by the swell layer's height, so the
   * capillary ripples come in patches — calm water between gusts, a
   * roughened patch where one is passing, drifting with the swell. Below
   * the floor share of its bump the fine layer never drops; without the
   * modulation the whole surface carried the same grain everywhere and
   * read as frosted glass.
   */
  ripplePatchFloor: 0.3,

  /**
   * Share of the ripple bump kept at grazing incidence (on the geometric
   * normal). Near the horizon the ripples are subpixel and the slope map
   * would only add noise to what should be a mirror of the sky.
   */
  grazingBumpKeep: 0.3,

  /**
   * A rippled normal can reflect the view ray back down into the water.
   * Such a facet is pulled toward flat by up to this share, growing with
   * the power below as the reflected ray dips toward the surface plane, so
   * the reflection never samples the sky from under the horizon.
   */
  reflectionFoldbackStrength: 0.5,
  reflectionFoldbackExponent: 8,

  /**
   * Crests of the medium and fine ripple layers (the slope map's height
   * channel) catch the sky. Height is 0..1 across the tile; the band maps
   * it onto the highlight's strength. Read off the same field the normal
   * comes from, so a highlight sits on the ridge it belongs to.
   */
  crestHighlightStart: 0.62,
  crestHighlightFull: 0.95,

  /**
   * Screen-space refraction displacement per unit of surface slope, before
   * `uWaterRefractionStrength`. The floor bends where the surface tilts —
   * the same ripples the reflection shows — instead of under a separate
   * slow swell that wobbled the whole bed like a set gel.
   */
  refractionSlopeScale: 2.0,

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

/**
 * Rest height within its voxel above which a fluid surface vertex is a spill
 * corner — one the mesher raised to the full block because fluid stands on
 * a voxel sharing it, so the sheet meets the wall of the block pouring onto
 * it. A resting surface sits at {@link WATER_OPTICS.fluidSurfaceHeight} and
 * every flow stage only lowers it, so nothing else reaches past this
 * midpoint. The vertex stage leaves these corners out of the wave: the wall
 * edge they are welded to sits on its voxel floor and cannot move with them.
 */
export const FLUID_SPILL_CORNER_MIN_HEIGHT =
  (WATER_OPTICS.fluidSurfaceHeight + 1) / 2;

/**
 * Samples every {@link WATER_OPTICS.surfaceNormalLayers} entry of the slope
 * map at the fragment's `wPos.xz` for `waterSeconds`, accumulating the
 * decoded, bump-weighted slopes into `waterSlopeSum` (declared by the
 * caller). Each layer's texel stays in scope as `waterTexel<i>` so the
 * height channel can be read for crest highlights without a second lookup;
 * the first layer's height also gates the last layer's bump into patches
 * ({@link WATER_OPTICS.ripplePatchFloor}). The red and green channels
 * decode `rg * 2 - 1` to -1..1, the tile's steepest facet at ±1 (see
 * `water-normal-texture.ts`).
 */
export const WATER_SURFACE_NORMAL_LAYERS_GLSL = WATER_OPTICS.surfaceNormalLayers
  .map((layer, index, layers) => {
    const cos = Math.cos(layer.rotation).toFixed(6);
    const sin = Math.sin(layer.rotation).toFixed(6);
    const negSin = (-Math.sin(layer.rotation)).toFixed(6);
    const [driftX, driftZ] = layer.drift;
    // Tile size and stretch fold into one per-axis scale on the rotated
    // position: the axis with the larger factor repeats sooner, so the
    // ridges come out long along the other one.
    const scaleX = (layer.stretch[0] / layer.tileBlocks).toFixed(6);
    const scaleY = (layer.stretch[1] / layer.tileBlocks).toFixed(6);
    const isSwell = index === 0;
    const isFinest = index === layers.length - 1;
    const patchGate = isFinest && !isSwell ? " * ripplePatch" : "";
    const patchDefinition = isSwell
      ? `
  float ripplePatch = mix(
    ${WATER_OPTICS.ripplePatchFloor.toFixed(4)},
    1.0,
    waterTexel0.b
  );`
      : "";
    return `
  vec2 waterUv${index} = mat2(${cos}, ${sin}, ${negSin}, ${cos})
    * (wPos.xz + vec2(${driftX.toFixed(4)}, ${driftZ.toFixed(4)}) * waterSeconds)
    * vec2(${scaleX}, ${scaleY});
  vec4 waterTexel${index} = texture2D(uWaterNormalMap, waterUv${index});${patchDefinition}
  waterSlopeSum += (waterTexel${index}.rg * 2.0 - 1.0)
    * ${layer.bump.toFixed(4)}${patchGate};`;
  })
  .join("");

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
