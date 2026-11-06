import { Color } from "three/webgpu";
import { describe, expect, it } from "vitest";

import {
  FLOW_CREST_PHASE_PER_HEIGHT,
  FLUID_SPILL_CORNER_MIN_HEIGHT,
  getDownwellingTransmittance,
  getUnderwaterAmbientColor,
  findWaterBodySurface,
  measureWaterColumn,
  UNDERSIDE_CRITICAL_COS,
  underwaterInScatterScale,
  undersideSceneShare,
  undersideTransmission,
  WATER_OPTICS,
  WaterOptics,
} from "./water-optics";

describe("getDownwellingTransmittance", () => {
  it("keeps full transmission at the surface", () => {
    const out = getDownwellingTransmittance(0, new Color());
    expect(out.r).toBeCloseTo(1);
    expect(out.g).toBeCloseTo(1);
    expect(out.b).toBeCloseTo(1);
  });

  it("keeps shallow reef color and loses red before green and blue", () => {
    const out = getDownwellingTransmittance(10, new Color());
    expect(out.r).toBeGreaterThan(0.2);
    expect(out.r).toBeLessThan(0.3);
    expect(getDownwellingTransmittance(30, new Color()).r).toBeLessThan(0.02);
    expect(out.b).toBeGreaterThan(out.g);
    expect(out.g).toBeGreaterThan(out.r);
  });

  it("fades even blue toward black in the abyss", () => {
    const out = getDownwellingTransmittance(80, new Color());
    expect(out.b).toBeLessThan(0.05);
  });
});

describe("getUnderwaterAmbientColor", () => {
  it("darkens monotonically with depth", () => {
    const shallow = getUnderwaterAmbientColor(2, 1, new Color());
    const mid = getUnderwaterAmbientColor(15, 1, new Color());
    const deep = getUnderwaterAmbientColor(40, 1, new Color());
    const luminance = (c: Color) => c.r + c.g + c.b;
    expect(luminance(shallow)).toBeGreaterThan(luminance(mid));
    expect(luminance(mid)).toBeGreaterThan(luminance(deep));
  });

  it("scales with sun strength but keeps a night floor", () => {
    const day = getUnderwaterAmbientColor(5, 1, new Color());
    const night = getUnderwaterAmbientColor(5, 0, new Color());
    expect(night.b).toBeGreaterThan(0);
    expect(night.b).toBeLessThan(day.b);
    expect(night.b / day.b).toBeCloseTo(WATER_OPTICS.nightScatterFloor, 5);
  });
});

describe("refraction incidence band", () => {
  it("orders the grazing cutoff below full strength within [0, 1]", () => {
    expect(WATER_OPTICS.refractionGrazingCutoffCos).toBeGreaterThanOrEqual(0);
    expect(WATER_OPTICS.refractionFullStrengthCos).toBeLessThanOrEqual(1);
    expect(WATER_OPTICS.refractionGrazingCutoffCos).toBeLessThan(
      WATER_OPTICS.refractionFullStrengthCos,
    );
  });
});

describe("cheap analytic water gloss", () => {
  it("keeps the sun glint bands ordered and Fresnel opacity bounded", () => {
    expect(WATER_OPTICS.sunGlintStartCos).toBeGreaterThanOrEqual(0);
    expect(WATER_OPTICS.sunGlintStartCos).toBeLessThan(
      WATER_OPTICS.sunGlintFullCos,
    );
    expect(WATER_OPTICS.sunGlintFullCos).toBeLessThanOrEqual(1);
    // Far water takes a wider, dimmer disc than near water: the mips have
    // flattened its normal, and the tight disc would refocus into a blob.
    expect(WATER_OPTICS.sunGlintFarStartCos).toBeLessThan(
      WATER_OPTICS.sunGlintStartCos,
    );
    expect(WATER_OPTICS.sunGlintFarStrength).toBeLessThan(
      WATER_OPTICS.sunGlintStrength,
    );
    expect(WATER_OPTICS.fresnelAlphaStrength).toBeGreaterThan(0);
    expect(WATER_OPTICS.fresnelAlphaStrength).toBeLessThanOrEqual(1);
  });

  it("keeps the sky and the sun off water that sees no sky", () => {
    // The ramp sits inside the light grid's range and leaves full sunlight
    // (open water) wholly on it, so open water is untouched.
    expect(WATER_OPTICS.skyExposureNone).toBeGreaterThanOrEqual(0);
    expect(WATER_OPTICS.skyExposureNone).toBeLessThan(
      WATER_OPTICS.skyExposureFull,
    );
    expect(WATER_OPTICS.skyExposureFull).toBeLessThan(1);
    expect(WATER_OPTICS.enclosedReflectance).toBeGreaterThan(0);
    expect(WATER_OPTICS.enclosedReflectance).toBeLessThan(1);
  });
});

describe("ripple slope map", () => {
  it("keeps the layer table physically plausible", () => {
    const layers = WATER_OPTICS.surfaceNormalLayers;
    // The shader reads the medium and fine layers' height channels by
    // index for crest highlights.
    expect(layers).toHaveLength(3);
    for (const layer of layers) {
      expect(layer.tileBlocks).toBeGreaterThan(0);
      expect(layer.bump).toBeGreaterThan(0);
      expect(layer.stretch[0]).toBeGreaterThan(0);
      expect(layer.stretch[1]).toBeGreaterThan(0);
    }
    expect(WATER_OPTICS.specularBroadBaseStrength).toBeGreaterThanOrEqual(0);
    expect(WATER_OPTICS.specularBroadTopStrength).toBeGreaterThanOrEqual(0);
    expect(WATER_OPTICS.specularMediumStrength).toBeGreaterThanOrEqual(0);
    // Coarse to fine, so "medium" and "fine" name what they sample.
    expect(layers[0].tileBlocks).toBeGreaterThan(layers[1].tileBlocks);
    expect(layers[1].tileBlocks).toBeGreaterThan(layers[2].tileBlocks);
    // Summed at their steepest the layers stay well under a 45° facet.
    const maxSlope = layers.reduce((sum, layer) => sum + layer.bump, 0);
    expect(maxSlope).toBeLessThan(0.7);
    expect(WATER_OPTICS.grazingBumpKeep).toBeGreaterThan(0);
    expect(WATER_OPTICS.grazingBumpKeep).toBeLessThanOrEqual(1);
    expect(WATER_OPTICS.reflectionFoldbackStrength).toBeGreaterThanOrEqual(0);
    expect(WATER_OPTICS.reflectionFoldbackStrength).toBeLessThanOrEqual(1);
    expect(WATER_OPTICS.crestHighlightStart).toBeLessThan(
      WATER_OPTICS.crestHighlightFull,
    );
    expect(WATER_OPTICS.crestHighlightFull).toBeLessThanOrEqual(1);
    expect(WATER_OPTICS.refractionSlopeScale).toBeGreaterThan(0);
  });

  it("gates the finest ripple layer into gust patches", () => {
    expect(WATER_OPTICS.ripplePatchFloor).toBeGreaterThan(0);
    expect(WATER_OPTICS.ripplePatchFloor).toBeLessThan(1);
  });
});

describe("air-side vertical water faces", () => {
  it("keeps head-on scales inside (0, 1] with gloss at or below alpha", () => {
    expect(WATER_OPTICS.airSideFaceAlphaScale).toBeGreaterThan(0);
    expect(WATER_OPTICS.airSideFaceAlphaScale).toBeLessThanOrEqual(1);
    expect(WATER_OPTICS.airSideFaceGlossScale).toBeGreaterThanOrEqual(0);
    expect(WATER_OPTICS.airSideFaceGlossScale).toBeLessThan(
      WATER_OPTICS.airSideFaceAlphaScale,
    );
    expect(WATER_OPTICS.airSideFaceTintMix).toBeGreaterThan(0);
    expect(WATER_OPTICS.airSideFaceTintMix).toBeLessThanOrEqual(1);
  });
});

describe("the view through water by night", () => {
  it("closes in with no sun and keeps the clear look in full sun", () => {
    const optics = new WaterOptics();
    const column = { depth: 10, surfaceY: 60 };
    optics.update({ column, sunStrength: 1, deltaSeconds: 0.016 });
    expect(optics.viewExtinctionScale).toBe(1);
    optics.update({ column, sunStrength: 0, deltaSeconds: 0.016 });
    expect(optics.viewExtinctionScale).toBe(
      WATER_OPTICS.nightViewExtinctionBoost,
    );
  });
});

describe("the water behind a tank window", () => {
  it("fogs a window's run harder than a diver's view, and bounds the run", () => {
    expect(WATER_OPTICS.paneViewExtinctionScale).toBeGreaterThan(
      WATER_OPTICS.viewExtinctionScale,
    );
    expect(WATER_OPTICS.paneViewExtinctionScale).toBeLessThanOrEqual(1);
    expect(WATER_OPTICS.paneFallbackPathBlocks).toBeGreaterThan(0);
    expect(WATER_OPTICS.paneMaxPathBlocks).toBeGreaterThan(
      WATER_OPTICS.paneFallbackPathBlocks,
    );
    // A fish a block behind the glass keeps most of its colour; the far
    // wall of a two-dozen-block tank has lost most of its red.
    const red = (blocks: number) =>
      Math.exp(
        -WATER_OPTICS.downwellingExtinction.red *
          WATER_OPTICS.paneViewExtinctionScale *
          blocks,
      );
    expect(red(1)).toBeGreaterThan(0.85);
    expect(red(24)).toBeLessThan(0.5);
  });
});

describe("standing water over ground", () => {
  it("keeps the floor optics inside physical bounds", () => {
    expect(WATER_OPTICS.floorAbsorptionPathScale).toBeGreaterThan(0);
    expect(WATER_OPTICS.floorAbsorptionMaxDepth).toBeGreaterThan(0);
    expect(WATER_OPTICS.wetFloorDarken).toBeGreaterThan(0);
    expect(WATER_OPTICS.wetFloorDarken).toBeLessThanOrEqual(1);
    expect(WATER_OPTICS.shallowScatterDensity).toBeGreaterThan(0);
    expect(WATER_OPTICS.shallowScatterMaxMix).toBeGreaterThanOrEqual(0);
    expect(WATER_OPTICS.shallowScatterMaxMix).toBeLessThan(1);
    expect(WATER_OPTICS.causticStrength).toBeGreaterThanOrEqual(0);
    expect(WATER_OPTICS.causticLensSlope).toBeGreaterThan(0);
    expect(WATER_OPTICS.causticDepthFalloff).toBeGreaterThan(0);
    // The refracted composite owns the floor, so it may be more opaque than
    // the plain tinted layer, never less.
    expect(WATER_OPTICS.surfaceAlphaFloor).toBeGreaterThan(0);
    expect(WATER_OPTICS.refractedSurfaceAlphaFloor).toBeGreaterThanOrEqual(
      WATER_OPTICS.surfaceAlphaFloor,
    );
    expect(WATER_OPTICS.refractedSurfaceAlphaFloor).toBeLessThanOrEqual(1);
  });
});

describe("air-side walls", () => {
  it("keeps the wall path inside the floor's absorption range", () => {
    // A face exists only where its voxel holds fluid, so a wall always has
    // at least that voxel behind it; more than the absorption cap is moot.
    expect(WATER_OPTICS.wallPathBlocks).toBeGreaterThan(0);
    expect(WATER_OPTICS.wallPathBlocks).toBeLessThanOrEqual(
      WATER_OPTICS.floorAbsorptionMaxDepth,
    );
    // Under water a wall is lighter than the surface, never heavier.
    expect(WATER_OPTICS.submergedWallAlphaScale).toBeGreaterThan(0);
    expect(WATER_OPTICS.submergedWallAlphaScale).toBeLessThan(1);
  });
});

describe("flow direction", () => {
  it("keeps the flow cue tunables inside physical bounds", () => {
    expect(WATER_OPTICS.fluidStageDropoff).toBeGreaterThan(0);
    expect(WATER_OPTICS.flowCrestSpacingBlocks).toBeGreaterThan(0);
    expect(WATER_OPTICS.flowBandSpeed).toBeGreaterThan(0);
    expect(WATER_OPTICS.flowSlopeAmplitude).toBeGreaterThanOrEqual(0);
    expect(WATER_OPTICS.flowStreakStrength).toBeGreaterThanOrEqual(0);
    expect(WATER_OPTICS.flowStreakStrength).toBeLessThanOrEqual(1);
    // One crest per spacing on a full-stage slope.
    expect(
      FLOW_CREST_PHASE_PER_HEIGHT *
        WATER_OPTICS.fluidStageDropoff *
        WATER_OPTICS.flowCrestSpacingBlocks,
    ).toBeCloseTo(2 * Math.PI, 6);
  });
});


describe("spill corners", () => {
  it("names the corner by a height no resting surface reaches", () => {
    // The threshold has to clear every stage of a flowing surface (all at
    // or under the resting height) and sit under the full block.
    expect(FLUID_SPILL_CORNER_MIN_HEIGHT).toBeGreaterThan(
      WATER_OPTICS.fluidSurfaceHeight,
    );
    expect(FLUID_SPILL_CORNER_MIN_HEIGHT).toBeLessThan(1);
  });
});

describe("measureWaterColumn", () => {
  const columnTo = (surfaceVoxelY: number) => (vx: number, vy: number) =>
    vy <= surfaceVoxelY && vx === 0;

  it("returns null outside of fluid", () => {
    expect(measureWaterColumn(() => false, 0.5, 10, 0.5)).toBeNull();
  });

  it("finds the surface above the sample point", () => {
    const sample = measureWaterColumn(columnTo(85), 0.5, 60, 0.5);
    expect(sample).not.toBeNull();
    expect(sample?.surfaceY).toBeCloseTo(85 + WATER_OPTICS.fluidSurfaceHeight);
    expect(sample?.depth).toBeCloseTo(
      85 + WATER_OPTICS.fluidSurfaceHeight - 60,
    );
  });

  it("returns null when the eye pokes above the fluid surface", () => {
    const sample = measureWaterColumn(columnTo(85), 0.5, 85.95, 0.5);
    expect(sample).toBeNull();
  });

  it("puts the waterline at the roof of water sealed under one", () => {
    const sealedAt = (vx: number, vy: number) => vx === 0 && vy === 85;
    const sample = measureWaterColumn(columnTo(85), 0.5, 85.95, 0.5, sealedAt);
    expect(sample?.surfaceY).toBeCloseTo(86);
    expect(sample?.depth).toBeCloseTo(0.05);
    expect(sample?.roofed).toBe(true);
  });
});

describe("findWaterBodySurface", () => {
  // Water fills y <= 59 except where `rock` says otherwise.
  const sea =
    (rock: (vx: number, vy: number, vz: number) => boolean) =>
    (vx: number, vy: number, vz: number) =>
      vy <= 59 && !rock(vx, vy, vz);
  const sealedUnder =
    (isFluidAt: (vx: number, vy: number, vz: number) => boolean) =>
    (vx: number, vy: number, vz: number) =>
      vy < 59 && !isFluidAt(vx, vy + 1, vz);

  it("climbs out from under a shelf to the open sea's surface", () => {
    // A shelf at y 55-57 reaching three blocks around the column.
    const isFluidAt = sea(
      (vx, vy, vz) =>
        vy >= 55 && vy <= 57 && Math.abs(vx) <= 3 && Math.abs(vz) <= 3,
    );
    const surfaceY = findWaterBodySurface(
      isFluidAt,
      sealedUnder(isFluidAt),
      0,
      54,
      0,
    );
    expect(surfaceY).toBeCloseTo(59 + WATER_OPTICS.fluidSurfaceHeight);
  });

  it("keeps the highest roof of a cave sealed all round", () => {
    // A flooded chamber, x and z in 0..9, its roof at y 50 over x < 5 and
    // y 53 over the rest.
    const isFluidAt = (vx: number, vy: number, vz: number) =>
      vx >= 0 &&
      vx <= 9 &&
      vz >= 0 &&
      vz <= 9 &&
      vy >= 40 &&
      vy < (vx < 5 ? 50 : 53);
    const surfaceY = findWaterBodySurface(
      isFluidAt,
      (vx, vy, vz) => isFluidAt(vx, vy, vz) && !isFluidAt(vx, vy + 1, vz),
      1,
      49,
      1,
    );
    expect(surfaceY).toBe(53);
  });

  it("sees past an air bell to the sea it sits in", () => {
    // A bell over x and z in -3..3 traps air at y 49-53 in a sea to y 59.
    const isFluidAt = sea(
      (vx, vy, vz) =>
        vy >= 49 && vy <= 54 && Math.abs(vx) <= 3 && Math.abs(vz) <= 3,
    );
    const surfaceY = findWaterBodySurface(
      isFluidAt,
      sealedUnder(isFluidAt),
      0,
      48,
      0,
      true,
    );
    expect(surfaceY).toBeCloseTo(59 + WATER_OPTICS.fluidSurfaceHeight);
  });

  it("keeps a pool's own surface when nothing rises above it", () => {
    // A pool to y 48 in a dry cave: no water anywhere higher.
    const isFluidAt = (vx: number, vy: number, vz: number) =>
      Math.abs(vx) <= 5 && Math.abs(vz) <= 5 && vy >= 44 && vy <= 48;
    const surfaceY = findWaterBodySurface(
      isFluidAt,
      () => false,
      0,
      48,
      0,
      true,
    );
    expect(surfaceY).toBeCloseTo(48 + WATER_OPTICS.fluidSurfaceHeight);
  });
});

describe("WaterOptics", () => {
  it("snaps submersion in quickly when the camera dives", () => {
    const optics = new WaterOptics();
    optics.update({
      column: measureWaterColumn(() => true, 0.5, 50, 0.5),
      sunStrength: 1,
      deltaSeconds: 0.1,
    });
    expect(optics.submersion).toBeGreaterThan(0.7);
    expect(optics.waterPlaneY).toBeGreaterThan(50);
  });

  it("clears submersion after surfacing", () => {
    const optics = new WaterOptics();
    optics.update({
      column: measureWaterColumn(() => true, 0.5, 50, 0.5),
      sunStrength: 1,
      deltaSeconds: 0.1,
    });
    for (let frame = 0; frame < 20; frame += 1) {
      optics.update({
        column: null,
        sunStrength: 1,
        deltaSeconds: 0.1,
      });
    }
    expect(optics.submersion).toBe(0);
    expect(optics.lightFilter.r).toBeCloseTo(1);
  });
});

describe("the Snell window underside", () => {
  it("passes nearly everything straight up and nothing past the critical angle", () => {
    const critical = Math.asin(1 / WATER_OPTICS.refractiveIndex);
    expect(undersideTransmission(1)).toBeCloseTo(0.98, 3);
    expect(undersideTransmission(Math.cos(critical - 0.01))).toBeGreaterThan(0);
    expect(undersideTransmission(Math.cos(critical + 0.01))).toBe(0);
    expect(undersideTransmission(0)).toBe(0);
  });

  it("dims monotonically toward the rim, then drops to a mirror", () => {
    let previous = Infinity;
    for (let degrees = 0; degrees <= 60; degrees += 2) {
      const t = undersideTransmission(Math.cos((degrees * Math.PI) / 180));
      expect(t).toBeLessThanOrEqual(previous);
      previous = t;
    }
  });

  it("lifts the window above the sky it shows and keeps the band past the rim near the fog", () => {
    expect(WATER_OPTICS.undersideWindowGain).toBeGreaterThan(1);
    // The mirror scales the water's scatter colour (as the film did at
    // 1.3): about the fog's own brightness once the reflected ray's dive
    // darkens it, so the window is the bright feature without the rest of
    // the surface turning murkier than the ceiling it replaces.
    expect(WATER_OPTICS.undersideReflectionScale).toBeGreaterThan(0.9);
    expect(WATER_OPTICS.undersideReflectionScale).toBeLessThanOrEqual(
      WATER_OPTICS.undersideFilmScale + 0.1,
    );
    expect(WATER_OPTICS.undersideWindowRippleKeep).toBeGreaterThan(0.5);
    expect(WATER_OPTICS.undersideWindowRippleKeep).toBeLessThanOrEqual(1);
  });

  it("lets the dry world through past the rim, with no step at the rim", () => {
    const critical = Math.acos(UNDERSIDE_CRITICAL_COS);
    expect(Math.sin(critical) * WATER_OPTICS.refractiveIndex).toBeCloseTo(1, 6);
    const justInside = undersideSceneShare(Math.cos(critical - 0.002));
    const justOutside = undersideSceneShare(Math.cos(critical + 0.002));
    // A shore past the rim shows through instead of a blank wall...
    expect(justOutside).toBeGreaterThan(0.5);
    expect(undersideSceneShare(0)).toBeGreaterThan(0.3);
    // ...without a ring where the window meets the rest of the surface,
    expect(Math.abs(justInside - justOutside)).toBeLessThan(0.05);
    // and the window overhead still carries the most of it.
    expect(undersideSceneShare(1)).toBeGreaterThan(justOutside);
    expect(undersideSceneShare(0)).toBeLessThan(justOutside);
  });
});

describe("underwater in-scatter", () => {
  it("is brighter looking up than down and unchanged looking level", () => {
    expect(underwaterInScatterScale(1)).toBeGreaterThan(
      underwaterInScatterScale(0),
    );
    expect(underwaterInScatterScale(0)).toBe(1);
    expect(underwaterInScatterScale(-1)).toBeLessThan(1);
    expect(underwaterInScatterScale(-1)).toBeGreaterThan(0.4);
  });

  it("darkens with depth, since its colour is the depth-filtered scatter", () => {
    const shallow = getUnderwaterAmbientColor(2, 1, new Color());
    const deep = getUnderwaterAmbientColor(20, 1, new Color());
    for (const y of [-1, 0, 1]) {
      const scale = underwaterInScatterScale(y);
      expect(deep.g * scale).toBeLessThan(shallow.g * scale);
      expect(deep.b * scale).toBeLessThan(shallow.b * scale);
    }
  });
});
