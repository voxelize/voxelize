import { Color } from "three";
import { describe, expect, it } from "vitest";

import {
  SHADER_LIGHTING_CHUNK_SHADERS,
  SHADER_LIGHTING_FLUID_CHUNK_SHADERS,
} from "./shaders";
import {
  ABOVE_SURFACE_WATER_FOG_FRAGMENT,
  FLOW_CREST_PHASE_PER_HEIGHT,
  FLUID_SPILL_CORNER_MIN_HEIGHT,
  getDownwellingTransmittance,
  getUnderwaterAmbientColor,
  measureWaterColumn,
  UNDERWATER_FOG_FRAGMENT,
  WATER_DOWNWELLING_EXTINCTION_GLSL,
  WATER_OPTICS,
  WATER_SURFACE_NORMAL_LAYERS_GLSL,
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

  it("compiles reflected-sun and Fresnel-opacity terms into the fluid shader", () => {
    const fragment = SHADER_LIGHTING_FLUID_CHUNK_SHADERS.fragment;
    expect(fragment).toContain(
      "float sunAlignment = max(dot(reflectDir, uCelestialDirection), 0.0);",
    );
    expect(fragment).toContain("float sunGlintNear = smoothstep(");
    expect(fragment).toContain("float sunGlintFar = smoothstep(");
    expect(fragment).toContain(
      "float sunGlint = mix(sunGlintFar, sunGlintNear, rippleLod);",
    );
    expect(fragment).toContain("float fresnelAlpha = fresnel * fresnel");
  });

  it("mirrors the drawn celestial disc, not the clamped shading light", () => {
    const fragment = SHADER_LIGHTING_FLUID_CHUNK_SHADERS.fragment;
    expect(fragment).toContain("uniform vec3 uCelestialDirection;");
    // The Blinn-Phong lobes and the glint disc must share one sun, or the
    // halo sits beside the glitter. And that sun is the one the sky box
    // draws: the shading light is held above a minimum elevation and tilted
    // off the sun's plane, which is exactly what put the reflection a good
    // twenty degrees to one side of the disc in the sky.
    expect(fragment).toContain(
      "vec3 halfVec = normalize(uCelestialDirection + viewDir);",
    );
    expect(fragment).not.toContain("normalize(uSunDirection + viewDir)");
    expect(fragment).not.toContain("dot(reflectDir, uSunDirection)");
  });

  it("reflects the sky dome's own gradient along the reflected ray", () => {
    const fragment = SHADER_LIGHTING_FLUID_CHUNK_SHADERS.fragment;
    // Same offset and exponent as the sky shader and the sky fog, so the
    // reflection is the sky the player sees, horizon band included.
    expect(fragment).toContain(
      "float skyH = normalize(reflectDir * uSkyFogDimension + uSkyFogOffset).y;",
    );
    expect(fragment).toContain("pow(max(skyH, 0.0), uSkyFogExponent)");
    expect(fragment).not.toContain("reflectDir.y * 0.5 + 0.5");
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

  it("samples every layer into the surface normal and drives refraction from it", () => {
    const fragment = SHADER_LIGHTING_FLUID_CHUNK_SHADERS.fragment;
    expect(fragment).toContain("uniform sampler2D uWaterNormalMap;");
    expect(fragment).toContain(WATER_SURFACE_NORMAL_LAYERS_GLSL);
    const layers = WATER_OPTICS.surfaceNormalLayers;
    layers.forEach((layer, index) => {
      expect(fragment).toContain(
        `vec4 waterTexel${index} = texture2D(uWaterNormalMap, waterUv${index});`,
      );
      const gate = index === layers.length - 1 ? " * ripplePatch" : "";
      expect(fragment).toContain(
        `waterSlopeSum += (waterTexel${index}.rg * 2.0 - 1.0)\n    * ${layer.bump.toFixed(4)}${gate};`,
      );
    });
    // The swell's height gates the finest layer into gust patches.
    expect(fragment).toContain(
      `float ripplePatch = mix(\n    ${WATER_OPTICS.ripplePatchFloor.toFixed(4)},\n    1.0,\n    waterTexel0.b\n  );`,
    );
    expect(WATER_OPTICS.ripplePatchFloor).toBeGreaterThan(0);
    expect(WATER_OPTICS.ripplePatchFloor).toBeLessThan(1);
    expect(fragment).toContain("crestMed = waterTexel1.b;");
    expect(fragment).toContain("crestFine = waterTexel2.b;");
    expect(fragment).toContain(
      "waterNormal = normalize(vec3(waterSlope.x, 1.0, waterSlope.y));",
    );
    // The floor bends under the surface slope, not a separate swell.
    expect(fragment).toContain(
      `vec2 refractionSlope = waterNormal.xz\n      * ${WATER_OPTICS.refractionSlopeScale.toFixed(4)};`,
    );
    expect(fragment).not.toContain("broadRipple");
    // No per-pixel trigonometry left in the surface normal.
    expect(fragment).not.toContain("waveDir0");
  });

  it("compiles out of terrain shaders but still parses there", () => {
    // The sampler must be declared in every variant for the compiled-out
    // fluid branch to parse; it is inactive on terrain.
    expect(SHADER_LIGHTING_CHUNK_SHADERS.fragment).toContain(
      "uniform sampler2D uWaterNormalMap;",
    );
    expect(SHADER_LIGHTING_CHUNK_SHADERS.fragment).toContain("if (false) {");
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

  it("compiles the back-face discard and gloss fade into the fluid shader", () => {
    const fragment = SHADER_LIGHTING_FLUID_CHUNK_SHADERS.fragment;
    expect(fragment).toContain("uCameraSubmersion < 0.5 && !gl_FrontFacing");
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

  it("draws a pane at every angle: the only fluid discard is the back face", () => {
    const { fragment } = SHADER_LIGHTING_FLUID_CHUNK_SHADERS;
    // A pane used to be discarded when looked at head-on, so a tank read as
    // a dry room with fish floating in it. The test was per fragment against
    // the direction to the eye — a cone with its apex at the camera — and a
    // cone through a plane is a circle: a large pane close up drew as a
    // disc-shaped hole with a tinted rim. Now the tinted sheet always draws.
    expect(fragment).not.toContain("airSideFace * geoNdotV >");
    expect(fragment).not.toMatch(/paneCull|headOn|airFacing/);
    const fluidBranch = fragment.slice(
      fragment.indexOf("if (vIsFluid > 0.5) {"),
    );
    expect(fluidBranch.match(/discard;/g)).toHaveLength(1);
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

  it("compiles the floor optics into the fluid shader from the shared table", () => {
    const { vertex, fragment } = SHADER_LIGHTING_FLUID_CHUNK_SHADERS;
    // Thickness under the surface comes from the rest position plus the
    // mesher's below-count, so the wave cannot jump it by a block. On a
    // surface vertex that count is the corner's mean depth in quarter
    // blocks (mirrors SURFACE_DEPTH_UNITS_PER_BLOCK in vertex_light.rs), so
    // a step in the bed ramps across faces instead of drawing a hard
    // rectangle on the surface.
    expect(vertex).toContain("#define SURFACE_DEPTH_UNITS_PER_BLOCK 4.0");
    expect(vertex).toContain(
      "float fluidBelowBlocks = isSurfaceVertex == 1\n  ? stackIndexF / SURFACE_DEPTH_UNITS_PER_BLOCK\n  : stackIndexF;",
    );
    expect(vertex).toContain(
      "vFluidDepthBelow = float(isFluid) * (restWorldPosition.y - fluidVoxelY + fluidBelowBlocks);",
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

  it("looks through a wall's own water and gives it the surface's opacity", () => {
    const { fragment } = SHADER_LIGHTING_FLUID_CHUNK_SHADERS;
    // The wall's refraction sample takes the floor absorption and in-scatter
    // over its own voxel of water; a pane keeps its window treatment. A wall
    // at zero depth composited the dry scene behind it untouched and read as
    // a hole — a cascade drew as floating sheets with every riser missing.
    expect(fragment).toContain(
      `float wallDepth = sideWaterFace * (1.0 - vIsFluidPane)\n    * ${WATER_OPTICS.wallPathBlocks.toFixed(4)};`,
    );
    expect(fragment).toContain("vFluidDepthBelow * topWaterFace + wallDepth,");
    // From the air, the same alpha floor as a top face, not a fraction of
    // it; from under water the wall keeps its lighter floor so the view out
    // of a tank stays clear, blended on the smoothed submersion.
    expect(fragment).toContain(
      `float wallOpacity = mix(\n    ${WATER_OPTICS.submergedWallAlphaScale.toFixed(4)},\n    1.0,\n    1.0 - uCameraSubmersion\n  );`,
    );
    expect(fragment).toContain(
      "float refractionFace = max(topWaterFace, sideWaterFace * wallOpacity);",
    );
    expect(fragment).not.toMatch(/sideWaterFace \* 0\.\d+\)/);
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

  it("decodes the mesher's per-vertex flow from the surface vertex's count field", () => {
    const { vertex } = SHADER_LIGHTING_FLUID_CHUNK_SHADERS;
    // Mirrors FLOW_DIRECTIONS in crates/mesher/src/mesher/vertex_light.rs:
    // 15 directions in equal steps from +x toward +z, 0 for still water.
    expect(vertex).toContain("#define FLOW_DIRECTIONS 15.0");
    expect(vertex).toContain(
      "#define FLOW_STEP_RADIANS (6.28318530718 / FLOW_DIRECTIONS)",
    );
    // Only a waving fluid vertex carries flow there; its count is rebuilt.
    expect(vertex).toContain(
      "int isSurfaceVertex = isFluid & ((light >> WAVE_SHIFT) & 0x1);",
    );
    expect(vertex).toContain(
      "int flowCode = (light >> STACK_COUNT_SHIFT) & STACK_FIELD_BITS;",
    );
    expect(vertex).toContain("stackCount = stackIndex + 1;");
    expect(vertex).toContain(
      "float flowAngle = float(flowCode - 1) * FLOW_STEP_RADIANS;",
    );
    expect(vertex).toContain(
      "vFluidFlow = vec2(cos(flowAngle), sin(flowAngle));",
    );
  });

  it("draws the crests as contours of the rest surface", () => {
    const { vertex, fragment } = SHADER_LIGHTING_FLUID_CHUNK_SHADERS;
    // The rest height is its own varying: the waved position would bend
    // the contours with the swell, and the depth varying jumps by a whole
    // block across a hole in the floor while the surface does not.
    expect(vertex).toContain("vFluidRestY = restWorldPosition.y;");
    expect(fragment).toContain(
      `float flowPhase = -vFluidRestY * ${FLOW_CREST_PHASE_PER_HEIGHT.toFixed(4)}`,
    );
    expect(fragment).toContain(
      `- waveTime * ${WATER_OPTICS.flowBandSpeed.toFixed(4)}`,
    );
    // No per-face slope anywhere in the flow: direction is the interpolated
    // per-vertex field, and the crests tilt the normal along it.
    expect(fragment).not.toContain("dFdx(restSurface)");
    expect(fragment).toContain("flowTilt = vFluidFlow * flowWave;");
    expect(fragment).toContain(
      `+ flowTilt * ${WATER_OPTICS.flowSlopeAmplitude.toFixed(4)};`,
    );
    expect(fragment).toContain(
      "flowCrest = flowWave * min(length(vFluidFlow), 1.0);",
    );
    expect(fragment).toContain(WATER_OPTICS.flowStreakStrength.toFixed(4));
    expect(fragment).toContain("smoothstep(0.15, 0.95, flowCrest)");
  });
});

describe("terrain seen from under water", () => {
  it("measures depth from the camera's own water surface, not the nominal waterline", () => {
    const { fragment } = SHADER_LIGHTING_FLUID_CHUNK_SHADERS;
    // uWaterLevel is a sea level; a world without a sea keeps the default,
    // and a pool on flat ground then charged ~80 blocks of extinction to
    // every fragment in view. The camera's measured column is right for a
    // pool and agrees with the waterline for a sea.
    expect(fragment).toContain(
      "if (uCameraSubmersion > 0.001 && vWorldPosition.y < uCameraWaterPlaneY) {",
    );
    expect(fragment).toContain(
      "float fragmentWaterDepth = uCameraWaterPlaneY - vWorldPosition.y;",
    );
    expect(fragment).not.toContain(
      "float fragmentWaterDepth = uWaterLevel - vWorldPosition.y;",
    );
    // Submerged emitters take the same plane.
    expect(fragment).toContain(
      "if (uCameraSubmersion > 0.001 && llOrigin.y < uCameraWaterPlaneY) {",
    );
    expect(fragment).toContain(
      "float llSubmersion = clamp(uCameraWaterPlaneY - llOrigin.y, 0.0, 1.0);",
    );
    expect(fragment).not.toContain("llOrigin.y < uWaterLevel");
  });

  it("tells submerged faces from dry ones by the mesher's water contact, not by sunlight", () => {
    const { fragment } = SHADER_LIGHTING_FLUID_CHUNK_SHADERS;
    // Water is light-invariant in the light grid, so a seabed under open
    // sky is as bright as a beach; the old sunlight heuristic declared every
    // sunlit seabed a dry pocket and dropped its scatter fill.
    expect(fragment).toContain(
      "float isFragmentUnderwater = max(vWaterExposed, vIsFluid);",
    );
    expect(fragment).not.toContain("expectedUnderwaterSun");
    // The darkening rides the smoothed submersion so the terrain crosses
    // over with the fog and the surface at the waterline.
    expect(fragment).toContain(
      "float submergedShade = uCameraSubmersion * isFragmentUnderwater;",
    );
    expect(fragment).toContain(
      `downTransmit = mix(\n    vec3(1.0),\n    exp(-${WATER_DOWNWELLING_EXTINCTION_GLSL} * fragmentWaterDepth),\n    submergedShade\n  );`,
    );
    expect(fragment).toContain("* downTransmit * submergedShade;");
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

  it("leaves a spill corner out of the wave so it stays welded to the wall above", () => {
    const { vertex } = SHADER_LIGHTING_FLUID_CHUNK_SHADERS;
    // The voxel read matches the depth varying's: a surface vertex sits at
    // vy + h with h in (0, 1].
    expect(vertex).toContain(
      "float waveVoxelY = ceil(worldPosForWave.y - 1e-3) - 1.0;",
    );
    expect(vertex).toContain(
      "float waveRestHeight = worldPosForWave.y - waveVoxelY;",
    );
    expect(vertex).toContain(
      `if (waveRestHeight < ${FLUID_SPILL_CORNER_MIN_HEIGHT.toFixed(4)}) {`,
    );
    // The displacement itself lives inside that gate.
    const gate = vertex.indexOf(
      `if (waveRestHeight < ${FLUID_SPILL_CORNER_MIN_HEIGHT.toFixed(4)}) {`,
    );
    const displacement = vertex.indexOf(
      "transformed.y += (wave1 + wave2 + wave3) * POSITION_UNITS_PER_BLOCK;",
    );
    expect(gate).toBeGreaterThan(-1);
    expect(displacement).toBeGreaterThan(gate);
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
