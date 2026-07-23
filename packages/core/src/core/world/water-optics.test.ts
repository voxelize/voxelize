import { Color } from "three";
import { describe, expect, it } from "vitest";

import {
  getDownwellingTransmittance,
  getUnderwaterAmbientColor,
  measureWaterColumn,
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

  it("absorbs red within ten blocks and lets blue outlast green", () => {
    const out = getDownwellingTransmittance(10, new Color());
    expect(out.r).toBeLessThan(0.05);
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

describe("lod water look", () => {
  it("keeps the cheap distant-water tunables in renderable ranges", () => {
    const lod = WATER_OPTICS.lodWater;
    expect(lod.tintStrength).toBeGreaterThan(0);
    expect(lod.tintStrength).toBeLessThanOrEqual(1);
    expect(lod.depthDarkenFloor).toBeGreaterThan(0);
    expect(lod.depthDarkenFloor).toBeLessThan(1);
    expect(lod.fresnelBase).toBeGreaterThanOrEqual(0);
    expect(lod.fresnelBase).toBeLessThan(lod.fresnelMax);
    expect(lod.fresnelMax).toBeLessThanOrEqual(1);
    expect(lod.rippleFrequency).toBeGreaterThan(0);
    expect(lod.rippleSpeed).toBeGreaterThan(0);
    expect(lod.rippleNormalStrength).toBeGreaterThan(0);
    expect(lod.rippleHighlightStrength).toBeGreaterThan(0);
    expect(lod.rippleHighlightStrength).toBeLessThanOrEqual(1);
    expect(lod.glintStrength).toBeGreaterThan(0);
  });

  it("keeps the single blended layer translucent head-on and denser at grazing", () => {
    const lod = WATER_OPTICS.lodWater;
    // Head-on the layer must actually be see-through (the seabed carries
    // the translucency cue), yet substantial enough to read as water.
    expect(lod.surfaceAlpha).toBeGreaterThan(0.2);
    expect(lod.surfaceAlpha).toBeLessThan(0.85);
    // Grazing incidence converges on the near water's reflective, more
    // opaque read without ever exceeding full opacity.
    expect(lod.grazingAlphaMax).toBeGreaterThan(lod.surfaceAlpha);
    expect(lod.grazingAlphaMax).toBeLessThanOrEqual(1);
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
});

describe("WaterOptics", () => {
  it("snaps submersion in quickly when the camera dives", () => {
    const optics = new WaterOptics();
    optics.update({
      isFluidAt: () => true,
      cameraX: 0.5,
      cameraY: 50,
      cameraZ: 0.5,
      sunStrength: 1,
      deltaSeconds: 0.1,
    });
    expect(optics.submersion).toBeGreaterThan(0.7);
    expect(optics.waterPlaneY).toBeGreaterThan(50);
  });

  it("clears submersion after surfacing", () => {
    const optics = new WaterOptics();
    optics.update({
      isFluidAt: () => true,
      cameraX: 0.5,
      cameraY: 50,
      cameraZ: 0.5,
      sunStrength: 1,
      deltaSeconds: 0.1,
    });
    for (let frame = 0; frame < 20; frame += 1) {
      optics.update({
        isFluidAt: () => false,
        cameraX: 0.5,
        cameraY: 90,
        cameraZ: 0.5,
        sunStrength: 1,
        deltaSeconds: 0.1,
      });
    }
    expect(optics.submersion).toBe(0);
    expect(optics.lightFilter.r).toBeCloseTo(1);
  });
});
