import {
  abs,
  cameraPosition,
  clamp,
  cos,
  Discard,
  dFdx,
  dFdy,
  dot,
  exp,
  float,
  floor,
  frontFacing,
  If,
  length,
  mat2,
  max,
  min,
  mix,
  normalize,
  pow,
  reflect,
  refract,
  screenCoordinate,
  select,
  sin,
  smoothstep,
  sqrt,
  step,
  vec2,
  vec3,
} from "three/tsl";

import { SURFACE_WEATHER as S } from "../surface-weather";
import {
  FLOW_CREST_PHASE_PER_HEIGHT,
  UNDERSIDE_CRITICAL_COS,
  WATER_OPTICS as W,
  WATER_PANE_EXTINCTION,
} from "../water-optics";

import type { ChunkUniforms, ShaderLightingUniforms } from "./chunk-uniforms";
import type { ChunkVaryings } from "./chunk-vertex";
import { perspectiveDepthToViewZ } from "./conventions";
import type { LocalLightShading } from "./local-lights";
import { simplexNoise3Node } from "./noise";
import type { SkyFogShading } from "./sky-fog";
import type { SurfaceWeatherShading } from "./surface-weather";
import type { FloatNode, Vec3Node, Vec4Node } from "./types";

const vec3Of = (c: { red: number; green: number; blue: number }) =>
  vec3(c.red, c.green, c.blue);

const DOWNWELLING = vec3Of(W.downwellingExtinction);
const PANE_EXTINCTION = vec3Of(WATER_PANE_EXTINCTION);

export type WaterSurfaceInputs = {
  v: ChunkVaryings;
  /** The water's texture as lit like any face (outgoingLight). */
  lit: Vec3Node;
  /** The texture alpha after the alpha test. */
  alpha: FloatNode;
  totalLight: Vec3Node;
  shadow: FloatNode;
  sunExposure: FloatNode;
  voxelLight: Vec4Node;
};

export type WaterSurfaceDeps = {
  chunk: ChunkUniforms;
  lighting: ShaderLightingUniforms;
  sky: SkyFogShading;
  weather: SurfaceWeatherShading;
  local: LocalLightShading;
};

/**
 * The slope-map gradients of every surface normal layer at this fragment,
 * taken at the top of the fragment (uniform control flow) so the samples in
 * the top-face branch can use them: the map's mip chain averages the
 * ripples flat as they go subpixel, which is the only distance fade the
 * ripple normal needs.
 */
function rippleLayers(chunk: ChunkUniforms, worldPosition: Vec3Node) {
  const seconds = chunk.time.mul(0.001);
  // The surface is drawn per 1/16-block texel: ripples sampled at texel
  // centres, so they step like the block art.
  const rippleXZ = floor(worldPosition.xz.mul(16)).add(0.5).div(16);
  return W.surfaceNormalLayers.map((layer) => {
    const c = Math.cos(layer.rotation);
    const s = Math.sin(layer.rotation);
    const [driftX, driftZ] = layer.drift;
    // Tile size and stretch fold into one per-axis scale on the rotated
    // position: the axis with the larger factor repeats sooner, so the
    // ridges come out long along the other one.
    const scale = vec2(
      layer.stretch[0] / layer.tileBlocks,
      layer.stretch[1] / layer.tileBlocks,
    );
    const uv = mat2(c, s, -s, c)
      .mul(rippleXZ.add(vec2(driftX, driftZ).mul(seconds)))
      .mul(scale)
      .toVar();
    return { uv, dx: dFdx(uv).toVar(), dy: dFdy(uv).toVar(), bump: layer.bump };
  });
}

/**
 * The fluid branch of the chunk shading: the water surface seen from the
 * air (ripples, flow, reflection, glint, refraction through the floor, a
 * tank window's run of water) and from below (the Snell window), with the
 * water's own absorption on top. Discards the faces water should not show.
 */
export function waterSurface(deps: WaterSurfaceDeps) {
  const { chunk: c, lighting: l, sky, weather, local } = deps;
  const extinctionMu = DOWNWELLING.mul(
    l.waterAbsorption.mul(W.surfaceAbsorptionScale),
  );

  /** Prepared at the top of the fragment, before any branch. */
  const prepare = (v: ChunkVaryings) => ({
    layers: rippleLayers(c, v.worldPosition),
  });

  const shade = (
    inputs: WaterSurfaceInputs,
    prepared: ReturnType<typeof prepare>,
  ) => {
    const { v, totalLight, shadow, sunExposure, voxelLight } = inputs;
    const color = vec3(inputs.lit).toVar();
    const alpha = float(inputs.alpha).toVar();

    const waveTime = c.time.mul(0.0005);
    const wPos = v.worldPosition;
    const normal = v.worldNormal;
    const absNormal = abs(normal);
    const topFace = smoothstep(0.45, 0.9, normal.y);
    const sideFace = smoothstep(0.45, 0.9, max(absNormal.x, absNormal.z));
    const submersion = c.cameraSubmersion;

    // In air, only the outward water face draws: the near wall, its back,
    // the far wall and the surface's underside would otherwise stack into
    // a milky pane. Under water both sides keep, so the surface shows from
    // below.
    If(submersion.lessThan(0.5).and(frontFacing.not()), () => {
      Discard();
    });
    // Under water, a vertical fluid face below the local surface is a seam
    // between two water voxels, not a boundary the eye can meet.
    If(
      submersion
        .greaterThanEqual(0.5)
        .and(sideFace.greaterThan(0.5))
        .and(v.isFluidPane.lessThan(0.5))
        .and(v.waterSurfaceY.sub(wPos.y).greaterThan(0.02)),
      () => {
        Discard();
      },
    );

    // A vertical face pressed against a see-through solid (a tank window)
    // is a pane: it draws at every angle as the tinted sheet of water it is.
    const airSideFace = sideFace.mul(submersion.oneMinus()).mul(v.isFluidPane);
    const toCamera = cameraPosition.sub(wPos);
    const viewDir = normalize(toCamera);
    const geoNdotV = max(dot(normal, viewDir), 0);
    const distToCamera = length(toCamera);
    const paneZ = v.viewDepth;
    const screenUv = screenCoordinate.div(max(c.sceneTextureSize, vec2(1)));

    // The water a tank window looks into: from this pane to the first thing
    // behind it in the frame, but never past where the water ends.
    const paneTransmit = vec3(1).toVar();
    If(airSideFace.greaterThan(0.001), () => {
      const run = float(W.paneFallbackPathBlocks).toVar();
      If(c.waterExitReady.greaterThan(0.5).or(c.sceneDepthReady.greaterThan(0.5)), () => {
        const toZ = (depth: FloatNode) =>
          perspectiveDepthToViewZ(depth, c.waterDepthClip.x, c.waterDepthClip.y);
        const endZ = float(c.waterDepthClip.y).toVar();
        If(c.waterExitReady.greaterThan(0.5), () => {
          endZ.assign(min(endZ, toZ(c.waterExitDepth.sample(screenUv).r)));
        });
        If(c.sceneDepthReady.greaterThan(0.5), () => {
          endZ.assign(min(endZ, toZ(c.sceneDepth.sample(screenUv).r)));
        });
        run.assign(
          max(endZ.sub(paneZ), 0).mul(distToCamera).div(max(paneZ, 1e-3)),
        );
        // With only one of the two measured the run may overshoot.
        If(c.sceneDepthReady.lessThan(0.5).or(c.waterExitReady.lessThan(0.5)), () => {
          run.assign(min(run, W.paneFallbackPathBlocks));
        });
      });
      run.assign(min(run, W.paneMaxPathBlocks));
      paneTransmit.assign(exp(PANE_EXTINCTION.negate().mul(run)));
    });

    const rippleLod = smoothstep(
      W.rippleFadeStartBlocks,
      W.rippleFadeEndBlocks,
      distToCamera,
    ).oneMinus();
    const baseWaveLod = smoothstep(
      W.baseWaveFadeStartBlocks,
      W.baseWaveFadeEndBlocks,
      distToCamera,
    ).oneMinus();
    // How much of the sky this surface sees: open water 1, a pool sealed in
    // rock 0. Gates everything the sky and the sun put on the water.
    const skyOpen = smoothstep(W.skyExposureNone, W.skyExposureFull, sunExposure);

    // The surface normal: top faces read the tileable ripple slope map at
    // three world scales (a swell, ripples on it, capillary texture on
    // those) plus the flow crests; sides keep the geometric normal.
    const waterNormal = vec3(normal).toVar();
    const causticLens = float(0).toVar();
    const crestMed = float(0.5).toVar();
    const crestFine = float(0.5).toVar();
    const flowTilt = vec2(0).toVar();
    const flowCrest = float(0).toVar();
    const ringCrest = float(0).toVar();
    If(normal.y.greaterThanEqual(0.5), () => {
      // Flow: the rest height's contours are the crests of a flow running
      // downstream, continuous across the sheet; the wobble bends them so
      // they read as water, not as a survey map.
      const wobble = sin(wPos.x.mul(1.7).add(wPos.z.mul(1.1)).add(waveTime.mul(0.9)))
        .mul(0.5)
        .add(
          sin(wPos.z.mul(2.3).sub(wPos.x.mul(0.7)).sub(waveTime.mul(1.3))).mul(
            0.35,
          ),
        );
      const phase = v.fluidRestY
        .mul(-FLOW_CREST_PHASE_PER_HEIGHT)
        .sub(waveTime.mul(W.flowBandSpeed))
        .add(wobble);
      const flowWave = cos(phase).mul(rippleLod);
      flowTilt.assign(v.fluidFlow.mul(flowWave));
      flowCrest.assign(flowWave.mul(min(length(v.fluidFlow), 1)));

      const slopeSum = vec2(0).toVar();
      const texels = prepared.layers.map((layer) =>
        c.waterNormalMap.sample(layer.uv).grad(layer.dx, layer.dy),
      );
      const lastLayer = prepared.layers.length - 1;
      const ripplePatch = mix(W.ripplePatchFloor, 1, texels[0].b);
      prepared.layers.forEach((layer, index) => {
        const gate = index === lastLayer && index !== 0 ? ripplePatch : float(1);
        slopeSum.addAssign(
          texels[index].rg.mul(2).sub(1).mul(layer.bump).mul(gate),
        );
      });
      crestMed.assign(texels[1].b);
      crestFine.assign(texels[2].b);
      // The bump eases off toward grazing incidence, on the geometric
      // normal so the ripples cannot pump their own fade.
      const bumpScale = mix(W.grazingBumpKeep, 1, geoNdotV);
      const slope = slopeSum
        .mul(bumpScale)
        .add(flowTilt.mul(W.flowSlopeAmplitude))
        .toVar();

      // Rain rings on open water, where it rains rather than snows.
      If(c.surfaceWeather.x.greaterThan(0), () => {
        const sample = weather.sample(wPos.xz);
        const rain = clamp(c.surfaceWeather.x, 0, 1);
        const ringRain = rain
          .mul(skyOpen)
          .mul(weather.above(wPos.xz, wPos.y, sample.a).oneMinus())
          .mul(smoothstep(S.ringFadeFrom, S.ringFadeTo, distToCamera).oneMinus());
        If(ringRain.greaterThan(0), () => {
          const seconds = c.time.mul(0.001);
          const rippleXZ = floor(wPos.xz.mul(16)).add(0.5).div(16);
          const rings = weather.rings(rippleXZ, seconds, rain);
          const keep = ringRain.div(max(rain, 1e-4));
          slope.addAssign(rings.xy.mul(S.ringSlope).mul(keep));
          ringCrest.assign(min(rings.z, 1).mul(keep));
        });
      });

      const bent = normalize(vec3(slope.x, 1, slope.y));
      // A facet steep enough to reflect the view back into the water eases
      // toward flat, so the reflection never samples the sky from below.
      const foldProbe = reflect(viewDir.negate(), bent);
      const foldback = pow(
        max(dot(normal, foldProbe), 0).oneMinus(),
        W.reflectionFoldbackExponent,
      ).mul(W.reflectionFoldbackStrength);
      waterNormal.assign(normalize(mix(bent, normal, foldback)));
      causticLens.assign(
        smoothstep(0, W.causticLensSlope, length(slope)).oneMinus(),
      );
    });

    const ndotv = max(dot(waterNormal, viewDir), 0);
    const fresnelBase = mix(0.01, 0.04, topFace);
    const fresnelMax = mix(0.22, 0.56, topFace);
    const fresnelRaw = clamp(
      fresnelBase.add(l.waterFresnelStrength.mul(pow(ndotv.oneMinus(), 5))),
      0.01,
      fresnelMax,
    ).mul(mix(W.distantFresnelFactor, 1, baseWaveLod));
    // Three flat steps between the floor and the ceiling of the reflection.
    const fresnelSpan = fresnelMax.sub(fresnelBase);
    const fresnelStep = fresnelBase.add(
      floor(
        fresnelRaw.sub(fresnelBase).div(max(fresnelSpan, 1e-4)).mul(3).add(0.5),
      )
        .div(3)
        .mul(fresnelSpan),
    );
    // Head-on tank walls keep none of the lake-surface gloss.
    const airSideWeight = airSideFace.mul(ndotv);
    const airSideGloss = mix(1, W.airSideFaceGlossScale, airSideWeight);
    const fresnel = fresnelStep.mul(airSideGloss);

    const reflectDir = reflect(viewDir.negate(), waterNormal);
    // The dome the sky draws, along the reflected ray, with its own light.
    const skyH = normalize(reflectDir.mul(c.skyFogDimension).add(c.skyFogOffset)).y;
    const skyLit = mix(
      l.skyMiddleColor,
      l.skyTopColor,
      pow(max(skyH, 0), c.skyFogExponent),
    ).add(sky.glow(reflectDir));
    // A surface that sees no sky mirrors the rock around it instead, with a
    // faint sheen of the water's own tint so the ripples still show.
    const skyAboveOrEnclosed = mix(
      totalLight
        .mul(W.enclosedReflectance)
        .add(l.waterTint.mul(W.enclosedTintFloor * W.enclosedSheenStrength)),
      skyLit,
      skyOpen,
    );
    // From below, the surface transmits sky only within the Snell window.
    const snellWindow = smoothstep(0.55, 0.78, abs(dot(waterNormal, viewDir))).mul(
      topFace,
    );
    const skyReflection = mix(
      skyAboveOrEnclosed,
      mix(c.underwaterAmbient, skyAboveOrEnclosed, snellWindow),
      submersion,
    );

    // Lobes, glint and caustics all mirror the drawn disc and are the
    // sun's beam: a sky that scatters it leaves none to mirror.
    const sunBeam = c.sunlightIntensity.mul(l.directSunlight).mul(skyOpen);
    const halfVec = normalize(l.celestialDirection.add(viewDir));
    let spec32: FloatNode = max(dot(waterNormal, halfVec), 0);
    for (let k = 0; k < 5; k++) spec32 = spec32.mul(spec32);
    const specMed = spec32
      .mul(spec32)
      .mul(spec32)
      .mul(sunBeam)
      .mul(W.specularMediumStrength);
    const specular = l.sunColor
      .mul(
        spec32
          .mul(sunBeam)
          .mul(topFace.mul(W.specularBroadTopStrength).add(W.specularBroadBaseStrength))
          .add(specMed),
      )
      .toVar();
    // The reflected sun: a tight disc up close, where the rippled normal
    // shatters it into glitter; wider and dimmer far off.
    const sunAlignment = max(dot(reflectDir, l.celestialDirection), 0);
    const glintNear = smoothstep(W.sunGlintStartCos, W.sunGlintFullCos, sunAlignment).mul(
      W.sunGlintStrength,
    );
    const glintFar = smoothstep(
      W.sunGlintFarStartCos,
      W.sunGlintFullCos,
      sunAlignment,
    ).mul(W.sunGlintFarStrength);
    // The glint in three flat steps: sparks, not a soft blob.
    const glint = floor(mix(glintFar, glintNear, rippleLod).div(W.sunGlintStrength).mul(3).add(0.5))
      .div(3)
      .mul(W.sunGlintStrength)
      .mul(topFace)
      .mul(submersion.oneMinus());
    specular.addAssign(l.sunColor.mul(glint.mul(sunBeam)));
    specular.mulAssign(airSideGloss);
    // Torch sparkle: the clustered lights are the only local sources with a
    // position to reflect. A tank window takes none (a flat mirror smeared
    // a lamp's glare across the glass).
    specular.addAssign(
      local
        .specular(wPos, waterNormal, viewDir, voxelLight.xyz)
        .mul(airSideFace.oneMinus()),
    );

    const baseWater = inputs.lit;
    const depthFactor = exp(distToCamera.mul(-0.008)).oneMinus();
    const verticalDepthFactor = exp(
      max(v.waterSurfaceY.sub(wPos.y), 0).mul(-W.downwellingExtinction.green),
    ).oneMinus();
    // The tint is the water's colour, lit the way the surface stands where
    // it sees no sky, down to a floor that keeps it from going black.
    const enclosedLight = max(clamp(totalLight, 0, 1), vec3(W.enclosedTintFloor));
    const waterTint = l.waterTint.mul(mix(enclosedLight, vec3(1), skyOpen));
    const waterColor = mix(
      mix(baseWater, waterTint, 0.1),
      mix(baseWater, waterTint, 0.28),
      max(depthFactor, verticalDepthFactor).mul(0.72),
    ).toVar();
    // Head-on air-side faces stay a coloured window, not a frosted pane.
    waterColor.assign(
      mix(waterColor, l.waterTint, airSideWeight.mul(W.airSideFaceTintMix)),
    );
    // What the run behind a window scatters toward the eye.
    const paneScatter = c.underwaterAmbient.mul(mix(enclosedLight, vec3(1), skyOpen));
    const paneFog = dot(paneTransmit, vec3(1 / 3)).oneMinus();

    const streakStrength = sideFace.mul(l.waterStreakStrength).mul(airSideGloss);
    If(streakStrength.greaterThan(0.001), () => {
      const sideCoord = mix(wPos.z, wPos.x, step(absNormal.x, absNormal.z));
      const streakNoise = simplexNoise3Node(
        vec3(sideCoord.mul(1.4), wPos.y.mul(0.32).sub(waveTime.mul(0.75)), 17),
      );
      const fineNoise = simplexNoise3Node(
        vec3(sideCoord.mul(5), wPos.y.mul(0.9).sub(waveTime.mul(1.4)), 27),
      );
      const streak = smoothstep(
        0.35,
        0.95,
        streakNoise.mul(0.7).add(fineNoise.mul(0.3)),
      );
      const streakColor = mix(
        waterColor.mul(0.96),
        waterColor.add(waterTint.mul(0.08)),
        streak,
      );
      waterColor.assign(mix(waterColor, streakColor, streakStrength));
    });

    const surfaceRipple = float(0).toVar();
    If(topFace.mul(rippleLod).greaterThan(0.001), () => {
      // Crests of the medium and fine layers catch the sky.
      const crest = crestMed.mul(0.6).add(crestFine.mul(0.4));
      surfaceRipple.assign(
        smoothstep(W.crestHighlightStart, W.crestHighlightFull, crest).mul(
          rippleLod,
        ),
      );
      const highlight = mix(waterColor, skyReflection, 0.34);
      waterColor.assign(
        mix(
          waterColor,
          highlight,
          topFace.mul(surfaceRipple).mul(l.waterStreakStrength).mul(1.8),
        ),
      );
      // Crest tops of the flow train, broken up by the still ripple field.
      const band = smoothstep(0.15, 0.95, flowCrest).mul(
        crestMed.mul(2).sub(1).mul(0.3).add(0.7),
      );
      waterColor.assign(
        mix(waterColor, highlight, topFace.mul(band).mul(W.flowStreakStrength)),
      );
    });

    // The water the refraction sample is seen through: the column under a
    // top face down to its floor, or a wall's own voxel of water.
    const wallDepth = sideFace.mul(v.isFluidPane.oneMinus()).mul(W.wallPathBlocks);
    const floorDepth = min(
      v.fluidDepthBelow.mul(topFace).add(wallDepth),
      W.floorAbsorptionMaxDepth,
    );
    const floorTransmit = exp(
      DOWNWELLING.negate().mul(floorDepth).mul(W.floorAbsorptionPathScale),
    );
    const wetFloor = mix(1, W.wetFloorDarken, topFace);
    const caustic = causticLens
      .mul(causticLens)
      .mul(exp(v.fluidDepthBelow.mul(-W.causticDepthFalloff)))
      .mul(shadow.mul(sunExposure).mul(sunBeam))
      .mul(rippleLod)
      .mul(topFace);
    const floorShade = floorTransmit
      .mul(wetFloor)
      .mul(caustic.mul(W.causticStrength).add(1));
    const thicknessScatter = exp(floorDepth.mul(-W.shallowScatterDensity))
      .oneMinus()
      .mul(W.shallowScatterMaxMix);

    // The refraction composites the floor itself, so alpha left to the
    // blend only shows the dry ground a second time.
    const refractionLive = c.waterRefractionReady.mul(step(0.5, submersion).oneMinus());
    // From the air a wall is as much the surface as the top and takes its
    // opacity floor; from inside it is the way out and stays clear.
    const wallOpacity = mix(W.submergedWallAlphaScale, 1, submersion.oneMinus());
    const refractionFace = max(topFace, sideFace.mul(wallOpacity));
    If(refractionFace.greaterThan(0.01), () => {
      const alphaFloor = mix(W.surfaceAlphaFloor, W.refractedSurfaceAlphaFloor, refractionLive)
        .mul(refractionFace)
        .mul(airSideFace.oneMinus());
      alpha.assign(max(alpha, alphaFloor));
    });
    alpha.mulAssign(mix(1, W.airSideFaceAlphaScale, airSideWeight));
    // A window shows the water behind it: with the capture live it draws
    // that view itself; without it the run's fog is a layer over the scene.
    alpha.assign(
      mix(alpha, mix(max(alpha, paneFog), 1, refractionLive), airSideFace),
    );
    // Seen from inside, a side face that is not a pane is the way out of
    // the water or the wall along an unloaded neighbour: both clear.
    const submergedSideClear = submersion
      .mul(sideFace)
      .mul(v.isFluidPane.oneMinus());
    alpha.mulAssign(submergedSideClear.oneMinus());
    alpha.assign(mix(alpha, 1, fresnel.mul(fresnel).mul(topFace).mul(W.fresnelAlphaStrength)));

    const refractedUv = vec2(screenUv).toVar();
    If(
      c.waterRefractionReady
        .greaterThan(0.5)
        .and(refractionFace.greaterThan(0.01))
        .and(submersion.lessThan(0.5)),
      () => {
        // Displacement follows the surface slope, on up-facing water seen
        // from above; vertical faces sample undistorted, grazing views fade.
        const incidence = smoothstep(
          W.refractionGrazingCutoffCos,
          W.refractionFullStrengthCos,
          clamp(dot(normal, viewDir), 0, 1),
        );
        const offset = waterNormal.xz
          .mul(W.refractionSlopeScale)
          .mul(c.waterRefractionStrength)
          .mul(topFace)
          .mul(incidence);
        refractedUv.assign(clamp(screenUv.add(offset), vec2(0.001), vec2(0.999)));
        // The floor lit through the column, wet, lensed by the surface.
        const floorSeen = c.sceneColor.sample(refractedUv).rgb.mul(floorShade);
        // Through a window, the scene lies at the end of its run of water.
        const refracted = mix(
          floorSeen,
          floorSeen.mul(paneTransmit).add(paneScatter.mul(paneTransmit.oneMinus())),
          airSideFace,
        );
        const tintAmount = fresnel
          .mul(0.28)
          .add(0.12)
          .add(surfaceRipple.mul(0.08))
          .add(thicknessScatter)
          .mul(mix(1, W.airSideFaceRefractionTintScale, airSideFace));
        waterColor.assign(mix(refracted, waterColor, tintAmount));
      },
    ).Else(() => {
      // No floor to shade: the caustics land on the surface layer instead.
      waterColor.mulAssign(caustic.mul(W.causticStrength * 0.5).add(1));
      waterColor.assign(
        mix(waterColor, paneScatter, airSideFace.mul(smoothstep(0, 0.3, paneFog))),
      );
    });

    // The bed fades with the measured local column, deepened by the frame's
    // depth where the mesher's few blocks of depth stop.
    If(topFace.greaterThan(0.5).and(submersion.lessThan(0.5)), () => {
      const columnDepth = float(v.fluidDepthBelow).toVar();
      If(c.sceneDepthReady.greaterThan(0.5), () => {
        const behindZ = perspectiveDepthToViewZ(
          c.sceneDepth.sample(refractedUv).r,
          c.waterDepthClip.x,
          c.waterDepthClip.y,
        );
        const behindPath = max(behindZ.sub(paneZ), 0)
          .mul(distToCamera)
          .div(max(paneZ, 1e-3));
        columnDepth.assign(behindPath.mul(max(viewDir.y, 0)));
      });
      const deepTransmit = exp(
        max(columnDepth.sub(W.deepSurfaceClearDepth), 0).mul(-W.deepSurfaceExtinction),
      );
      const deepScatter = mix(
        baseWater,
        c.underwaterAmbient
          .mul(
            vec3(
              W.deepSurfaceScatterScale.red,
              W.deepSurfaceScatterScale.green,
              W.deepSurfaceScatterScale.blue,
            ),
          )
          .mul(
            exp(
              DOWNWELLING.negate()
                .mul(min(columnDepth, 16))
                .mul(W.aboveSurfaceScatterDepthScale),
            ),
          ),
        skyOpen,
      );
      waterColor.assign(mix(deepScatter, waterColor, deepTransmit));
      alpha.assign(alpha.oneMinus().mul(deepTransmit).oneMinus());
    });

    color.assign(mix(waterColor, skyReflection, fresnel).add(specular));
    // A rain ring's crest catches the sky it mirrors.
    If(ringCrest.greaterThan(0), () => {
      color.assign(
        mix(
          color,
          weather.skyAlong(reflectDir).mul(1.15),
          ringCrest.mul(S.ringCrest).mul(topFace),
        ),
      );
    });

    // From below, the surface is a Snell window evaluated per 1/16-block
    // texel: inside the critical angle the frame drawn before the water,
    // dimming toward the rim by Fresnel; beyond it a mirror of the water
    // below, broken by the sun's glitter. The rim is decided per texel, so
    // it is a ragged pixel edge the ripples keep moving.
    If(submersion.greaterThan(0.5).and(topFace.greaterThan(0.5)), () => {
      const snellXZ = floor(wPos.xz.mul(16)).add(0.5).div(16);
      const ray = normalize(vec3(snellXZ.x, wPos.y, snellXZ.y).sub(cameraPosition));
      const snellNormal = normalize(
        mix(vec3(0, 1, 0), waterNormal, rippleLod.mul(W.undersideWindowRippleKeep)),
      );
      const cosI = clamp(dot(ray, snellNormal), 0, 1);
      const sinT2 = cosI
        .mul(cosI)
        .oneMinus()
        .mul(W.refractiveIndex * W.refractiveIndex);
      const inside = step(sinT2, 1);
      const cosT = sqrt(max(sinT2.oneMinus(), 0));
      const transmitted = inside.mul(
        pow(cosT.oneMinus(), 5).mul(0.98).add(0.02).oneMinus(),
      );

      // Beyond the window: the in-scatter along the reflected ray, lifted
      // toward the lit bed where the water under the surface is shallow.
      const down = reflect(ray, snellNormal);
      const shallow = smoothstep(0, W.undersideShallowBedDepth, v.fluidDepthBelow)
        .oneMinus()
        .mul(W.undersideShallowBedLift);
      // The ripples as three flat steps of light and shade on the mirror.
      const ripple = floor(
        clamp(
          dot(waterNormal.xz, normalize(l.celestialDirection.xz.add(vec2(1e-4)))).mul(6),
          -1,
          1,
        ).add(0.5),
      );
      const rippleShade = ripple.mul(W.undersideReflectionRipple).add(1);
      const mirror = mix(
        c.underwaterAmbient
          .mul(down.y.mul(W.underwaterInScatterTilt).add(1))
          .mul(W.undersideReflectionScale),
        c.underwaterAmbient.mul(vec3(1.18, 1.12, 0.98)),
        shallow,
      ).mul(rippleShade);

      // The dry world's share through the surface, under the same ripple
      // shade so the band past the rim keeps moving with the waves.
      const leak = mix(
        W.undersideSceneGrazingShare,
        1,
        clamp(cosI.div(UNDERSIDE_CRITICAL_COS), 0, 1),
      ).mul(W.undersideSceneTransmit);

      // The sun through a ripple facet: a texel whose ray leaves the water
      // toward the sun glints, inside the window and at its rim.
      const out = refract(ray, snellNormal.negate(), W.refractiveIndex);
      const glitter = inside
        .mul(
          step(
            W.undersideGlitterCos,
            dot(out, l.celestialDirection).div(max(length(out), 1e-4)),
          ),
        )
        .mul(sunBeam);

      const snellAlpha = float(1).toVar();
      If(c.waterRefractionReady.greaterThan(0.5), () => {
        // The frame drawn before water, shifted along the ripple slope more
        // toward the rim, where the surface bends the view most.
        const snellUv = screenUv.add(
          snellNormal.xz
            .mul(cosI.oneMinus())
            .mul(W.refractionSlopeScale * W.undersideDistortion)
            .mul(c.waterRefractionStrength),
        );
        const scene = c.sceneColor.sample(clamp(snellUv, vec2(0.001), vec2(0.999))).rgb;
        color.assign(
          mix(
            mix(mirror, scene.mul(rippleShade), leak),
            scene.mul(W.undersideWindowGain),
            transmitted,
          ),
        );
      }).Else(() => {
        // No capture: the scene behind shows through the blend instead.
        snellAlpha.assign(transmitted.oneMinus().mul(leak.oneMinus()));
        color.assign(mirror);
      });
      color.addAssign(
        l.sunColor
          .mul(glitter)
          .mul(W.undersideGlitterStrength)
          .div(max(snellAlpha, 0.05)),
      );
      alpha.assign(snellAlpha);
    });

    color.mulAssign(exp(extinctionMu.negate().mul(max(v.waterSurfaceY.sub(wPos.y), 0))));
    return { color, alpha };
  };

  return { prepare, shade };
}

export type WaterSurfaceShading = ReturnType<typeof waterSurface>;
