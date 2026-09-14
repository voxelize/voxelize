import { Color } from "three";
import { describe, expect, it } from "vitest";

import { SHADER_LIGHTING_FLUID_CHUNK_SHADERS } from "./shaders";
import {
  ABOVE_SURFACE_WATER_FOG_FRAGMENT,
  getDownwellingTransmittance,
  getUnderwaterAmbientColor,
  measureWaterColumn,
  UNDERWATER_FOG_FRAGMENT,
  WATER_DOWNWELLING_EXTINCTION_GLSL,
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

  it("applies the window treatment only to faces the mesher flagged as panes", () => {
    const { vertex, fragment } = SHADER_LIGHTING_FLUID_CHUNK_SHADERS;
    // Bit 19 is the greedy flag on a solid vertex and the pane flag on a
    // fluid one; both decodes must come from the same bit.
    expect(vertex).toContain("#define FLUID_PANE_SHIFT 19");
    expect(vertex).toContain("#define GREEDY_SHIFT 19");
    expect(vertex).toContain("int isGreedy = bit19 & (1 - isFluid);");
    expect(vertex).toContain("int isFluidPane = bit19 & isFluid;");
    // A wall against air keeps the lake shading: the fade, tint, and
    // head-on discard all hang off airSideFace, which the pane flag gates.
    expect(fragment).toContain(
      "float airSideFace = sideWaterFace * (1.0 - uCameraSubmersion) * vIsFluidPane;",
    );
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
    expect(WATER_OPTICS.surfaceNormalWaves).toHaveLength(4);
  });

  it("compiles the floor optics into the fluid shader from the shared table", () => {
    const { vertex, fragment } = SHADER_LIGHTING_FLUID_CHUNK_SHADERS;
    // Thickness under the surface comes from the rest position plus the
    // mesher's below-count, so the wave cannot jump it by a block.
    expect(vertex).toContain(
      "vFluidDepthBelow = float(isFluid) * (restWorldPosition.y - fluidVoxelY + stackIndexF);",
    );
    expect(fragment).toContain("vec3 floorTransmit = exp(");
    expect(fragment).toContain(WATER_DOWNWELLING_EXTINCTION_GLSL);
    expect(fragment).toContain(
      WATER_OPTICS.floorAbsorptionPathScale.toFixed(4),
    );
    expect(fragment).toContain(WATER_OPTICS.floorAbsorptionMaxDepth.toFixed(4));
    expect(fragment).toContain(WATER_OPTICS.wetFloorDarken.toFixed(4));
    expect(fragment).toContain(WATER_OPTICS.shallowScatterDensity.toFixed(4));
    expect(fragment).toContain(WATER_OPTICS.shallowScatterMaxMix.toFixed(4));
    expect(fragment).toContain(WATER_OPTICS.causticStrength.toFixed(4));
    expect(fragment).toContain(WATER_OPTICS.causticLensSlope.toFixed(4));
    expect(fragment).toContain(WATER_OPTICS.causticDepthFalloff.toFixed(4));
    expect(fragment).toContain(WATER_OPTICS.surfaceAlphaFloor.toFixed(4));
    expect(fragment).toContain(
      WATER_OPTICS.refractedSurfaceAlphaFloor.toFixed(4),
    );
    // The floor shading rides the refraction sample; caustics land on the
    // surface layer when there is no capture to shade.
    expect(fragment).toContain(
      "texture2D(uSceneColor, refractedUv).rgb * floorShade;",
    );
    expect(fragment).toContain("causticLens = 1.0 - smoothstep(");
    // Caustics only where the sun reaches the surface.
    expect(fragment).toContain(
      "float causticLight = shadow * sunExposure * uSunlightIntensity;",
    );
  });
});

describe("ABOVE_SURFACE_WATER_FOG_FRAGMENT", () => {
  it("reuses the same view extinction as the underwater fog", () => {
    expect(UNDERWATER_FOG_FRAGMENT).toContain(WATER_VIEW_EXTINCTION_GLSL);
    expect(SHADER_LIGHTING_FLUID_CHUNK_SHADERS.vertex).toContain(
      WATER_VIEW_EXTINCTION_GLSL,
    );
  });

  it("darkens the in-scattered water color with fragment depth", () => {
    expect(ABOVE_SURFACE_WATER_FOG_FRAGMENT).toContain("uUnderwaterAmbient");
    expect(ABOVE_SURFACE_WATER_FOG_FRAGMENT).toContain(
      WATER_DOWNWELLING_EXTINCTION_GLSL,
    );
    expect(ABOVE_SURFACE_WATER_FOG_FRAGMENT).toContain(
      WATER_OPTICS.aboveSurfaceScatterDepthScale.toFixed(4),
    );
    expect(ABOVE_SURFACE_WATER_FOG_FRAGMENT).toContain(
      "uWaterLevel - vWorldPosition.y",
    );
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
