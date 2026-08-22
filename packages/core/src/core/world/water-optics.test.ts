import { Color } from "three";
import { describe, expect, it } from "vitest";

import { SHADER_LIGHTING_FLUID_CHUNK_SHADERS } from "./shaders";
import {
  ABOVE_SURFACE_WATER_FOG_FRAGMENT,
  getDownwellingTransmittance,
  getUnderwaterAmbientColor,
  measureWaterColumn,
  UNDERWATER_FOG_FRAGMENT,
  WATER_OPTICS,
  WATER_VIEW_EXTINCTION_GLSL,
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

describe("cheap analytic water gloss", () => {
  it("keeps the sun glint band ordered and Fresnel opacity bounded", () => {
    expect(WATER_OPTICS.sunGlintStartCos).toBeGreaterThanOrEqual(0);
    expect(WATER_OPTICS.sunGlintStartCos).toBeLessThan(
      WATER_OPTICS.sunGlintFullCos,
    );
    expect(WATER_OPTICS.sunGlintFullCos).toBeLessThanOrEqual(1);
    expect(WATER_OPTICS.fresnelAlphaStrength).toBeGreaterThan(0);
    expect(WATER_OPTICS.fresnelAlphaStrength).toBeLessThanOrEqual(1);
  });

  it("compiles reflected-sun and Fresnel-opacity terms into the fluid shader", () => {
    const fragment = SHADER_LIGHTING_FLUID_CHUNK_SHADERS.fragment;
    expect(fragment).toContain("float sunGlint = smoothstep(");
    expect(fragment).toContain("max(dot(reflectDir, uSunDirection), 0.0)");
    expect(fragment).toContain("float fresnelAlpha = fresnel * fresnel");
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
    expect(WATER_OPTICS.airSideFaceCullCos).toBeGreaterThan(0.5);
    expect(WATER_OPTICS.airSideFaceCullCos).toBeLessThan(1);
  });

  it("compiles the air-side discard and gloss fade into the fluid shader", () => {
    const fragment = SHADER_LIGHTING_FLUID_CHUNK_SHADERS.fragment;
    expect(fragment).toContain("uCameraSubmersion < 0.5 && !gl_FrontFacing");
    expect(fragment).toContain("airSideFace * airFacing >");
    expect(fragment).toContain(WATER_OPTICS.airSideFaceCullCos.toFixed(4));
    expect(fragment).toContain("float airSideWeight = airSideFace * NdotV");
    expect(fragment).toContain(WATER_OPTICS.airSideFaceAlphaScale.toFixed(4));
    expect(fragment).toContain(WATER_OPTICS.airSideFaceGlossScale.toFixed(4));
    expect(fragment).toContain(WATER_OPTICS.airSideFaceTintMix.toFixed(4));
  });
});

describe("ABOVE_SURFACE_WATER_FOG_FRAGMENT", () => {
  it("reuses the same view extinction as the underwater fog", () => {
    expect(UNDERWATER_FOG_FRAGMENT).toContain(WATER_VIEW_EXTINCTION_GLSL);
    expect(SHADER_LIGHTING_FLUID_CHUNK_SHADERS.vertex).toContain(
      WATER_VIEW_EXTINCTION_GLSL,
    );
  });

  it("fades submerged terrain toward the shared in-scattered water color", () => {
    expect(ABOVE_SURFACE_WATER_FOG_FRAGMENT).toContain("uUnderwaterAmbient");
    expect(ABOVE_SURFACE_WATER_FOG_FRAGMENT).toContain(
      "vAboveSurfaceWaterTransmit",
    );
  });

  it("only affects water-exposed faces viewed from above the surface", () => {
    expect(ABOVE_SURFACE_WATER_FOG_FRAGMENT).toContain("vWaterExposed > 0.5");
    expect(SHADER_LIGHTING_FLUID_CHUNK_SHADERS.vertex).toContain(
      "cameraPosition.y > uWaterLevel",
    );
    expect(ABOVE_SURFACE_WATER_FOG_FRAGMENT).toContain("uCameraSubmersion");
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
