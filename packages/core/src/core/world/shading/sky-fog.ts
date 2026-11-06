import { AdditiveBlending } from "three/webgpu";
import {
  abs,
  cameraPosition,
  clamp,
  dot,
  exp,
  float,
  Fn,
  length,
  max,
  min,
  mix,
  normalize,
  output,
  positionWorld,
  pow,
  smoothstep,
  sqrt,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

import { WATER_OPTICS, WATER_VIEW_EXTINCTION } from "../water-optics";

import type { ChunkUniforms, ShaderLightingUniforms } from "./chunk-uniforms";
import type { FloatNode, Vec3Node } from "./types";

/** The inputs every fogged surface reads: the chunk set and the beam. */
export type SkyFogInputs = Pick<
  ChunkUniforms,
  | "fogColor"
  | "fogNear"
  | "fogFar"
  | "fogHeightOrigin"
  | "fogHeightDensity"
  | "fogVerticalBlend"
  | "aerialHaze"
  | "skyFogTopColor"
  | "skyFogMiddleColor"
  | "skyFogBottomColor"
  | "skyFogOffset"
  | "skyFogVoidOffset"
  | "skyFogExponent"
  | "skyFogExponent2"
  | "skyFogDimension"
  | "skyFogStrength"
  | "skyGlowSunDirection"
  | "skyGlowColor"
  | "skySunHaloColor"
  | "skyMoonHaloColor"
  | "skySunDiscColor"
  | "skyMoonDiscColor"
  | "skyDiscRadii"
  | "cameraSubmersion"
  | "cameraWaterPlaneY"
  | "underwaterAmbient"
  | "underwaterViewScale"
> &
  Pick<ShaderLightingUniforms, "directSunlight">;

const WATER_VIEW_EXTINCTION_VEC = vec3(
  WATER_VIEW_EXTINCTION.red,
  WATER_VIEW_EXTINCTION.green,
  WATER_VIEW_EXTINCTION.blue,
);

/** The sky's own light: its glow toward the sun and moon, and their discs. */
export type SkyGlowInputs = Pick<
  SkyFogInputs,
  | "skyGlowSunDirection"
  | "skyGlowColor"
  | "skySunHaloColor"
  | "skyMoonHaloColor"
  | "skySunDiscColor"
  | "skyMoonDiscColor"
  | "skyDiscRadii"
  | "directSunlight"
>;

/**
 * The sky's own light along a unit ray. The sky dome draws it and every
 * fogged surface tints toward it, so a ridge hazed into a sunset glows
 * exactly like the sky behind it.
 */
export function skyGlow(u: SkyGlowInputs) {
  // Angle from each disc's centre as a chord: radians while small, and
  // monotonic all the way round, with no acos. The moon is opposite the sun.
  const discAngles = (ray: Vec3Node) => {
    const sunDot = dot(ray, u.skyGlowSunDirection);
    return {
      sunDot,
      sun: sqrt(max(sunDot.mul(-2).add(2), 0)),
      moon: sqrt(max(sunDot.mul(2).add(2), 0)),
      radii: max(u.skyDiscRadii, vec2(1e-3)),
    };
  };

  /**
   * The sky's own light along the unit ray `ray`: a broad aura around the
   * sun, alive before it rises (the "light is coming" of pre-dawn); a band
   * along the horizon on the sun's side; and round each disc a corona
   * hugging its limb inside the halo the haze scatters wider. All of it is
   * the beam's: cloud veils it.
   */
  const glow = (ray: Vec3Node): Vec3Node => {
    const angles = discAngles(ray);
    const aura = pow(max(angles.sunDot, 0), 14);
    const rayFlat = normalize(ray.xz.add(vec2(1e-5, 0)));
    const sunFlat = normalize(u.skyGlowSunDirection.xz.add(vec2(1e-5, 0)));
    const side = clamp(dot(rayFlat, sunFlat).mul(0.5).add(0.5), 0, 1);
    const band = exp(abs(ray.y).mul(-5.5)).mul(side).mul(side);
    // The corona runs on from the limb, in disc radii past it.
    const beyond = max(
      vec2(angles.sun, angles.moon).sub(angles.radii),
      0,
    ).div(angles.radii);
    return u.skyGlowColor
      .mul(min(aura.mul(0.85).add(band.mul(0.55)), 1))
      .add(
        u.skySunHaloColor.mul(
          exp(beyond.x.mul(-2.4))
            .add(exp(angles.sun.mul(-10)).mul(0.6))
            .add(exp(angles.sun.mul(-3.2)).mul(0.22)),
        ),
      )
      .add(
        u.skyMoonHaloColor.mul(
          exp(beyond.y.mul(-3))
            .mul(2.5)
            .add(exp(angles.moon.mul(-14)).mul(0.7))
            .add(exp(angles.moon.mul(-4)).mul(0.15)),
        ),
      )
      .mul(u.directSunlight);
  };

  /**
   * The sun's and the moon's discs along `ray`, for the fog alone (the host
   * draws the discs in the sky). Terrain hides a disc by depth even where
   * its fog has made it the sky's own colour, so without these a sun
   * setting behind a hazed-out ridge vanished in mid-air.
   */
  const discs = (ray: Vec3Node): Vec3Node => {
    const angles = discAngles(ray);
    const cover = smoothstep(
      angles.radii.mul(0.9),
      angles.radii.mul(1.1),
      vec2(angles.sun, angles.moon),
    ).oneMinus();
    const horizon = smoothstep(-0.035, 0.05, ray.y);
    return u.skySunDiscColor
      .mul(cover.x)
      .add(u.skyMoonDiscColor.mul(cover.y))
      .mul(horizon)
      .mul(u.directSunlight);
  };

  return { glow, discs };
}

/** The sky's fog over one world's uniforms: its glow, gradient and haze. */
export function skyFog(u: SkyFogInputs) {
  const { glow, discs } = skyGlow(u);

  /** The sky dome's two-ramp gradient along `ray` (camera-centred, as the dome draws it). */
  const dome = (ray: Vec3Node): Vec3Node => {
    const domePos = ray.mul(u.skyFogDimension);
    const h = normalize(domePos.add(u.skyFogOffset)).y;
    const h2 = normalize(domePos.add(u.skyFogVoidOffset)).y;
    const upper = mix(
      u.skyFogMiddleColor,
      u.skyFogTopColor,
      max(pow(max(h, 0), u.skyFogExponent), 0),
    );
    return mix(
      upper,
      u.skyFogBottomColor,
      max(pow(max(h2.negate(), 0), u.skyFogExponent2), 0),
    );
  };

  /**
   * How much fog a fragment at `worldPosition` takes, before the reveal and
   * the camera's submersion: distance fog (horizontal outdoors, true 3D
   * under cover) and ground fog below the fog line. `flatDistance`, when
   * given, replaces the horizontal distance (a cloud deck hazes by its
   * distance scaled down, so it thins far later than the ground below).
   */
  const fogFactor = (
    worldPosition: Vec3Node,
    flatDistance?: FloatNode,
  ): FloatNode => {
    const flat = flatDistance ?? length(worldPosition.xz.sub(cameraPosition.xz));
    const depth = mix(
      flat,
      length(worldPosition.sub(cameraPosition)),
      u.fogVerticalBlend,
    );
    const distFog = smoothstep(u.fogNear, u.fogFar, depth);
    const heightFog = exp(
      u.fogHeightDensity
        .negate()
        .mul(max(u.fogHeightOrigin.sub(worldPosition.y), 0)),
    ).oneMinus();
    const heightDistScale = smoothstep(
      u.fogNear.mul(0.3),
      u.fogFar.mul(0.6),
      depth,
    );
    const range = max(distFog, heightFog.mul(heightDistScale));
    // Aerial perspective: the air between the eye and a far ridge scatters
    // the sky's light into the view, so each ridge sits a step paler and
    // bluer than the one before it, long before the range fog closes in.
    // Thickest low, thinning with the height the path runs at (its
    // midpoint); open air only: under rock the walls are near.
    const air = u.aerialHaze;
    const pathHeight = max(
      mix(cameraPosition.y, worldPosition.y, 0.5).sub(air.y),
      0,
    );
    const density = air.x.mul(exp(pathHeight.div(max(air.z, 1)).negate()));
    const aerial = exp(depth.mul(density).negate())
      .oneMinus()
      .mul(air.w)
      .mul(u.fogVerticalBlend.oneMinus());
    return range.oneMinus().mul(aerial.oneMinus()).oneMinus();
  };

  /**
   * The colour fog tints toward along `ray`: the sky behind, with its glow.
   * The discs come through only where the haze is all but total
   * ({@link haze}).
   */
  const fogTint = (ray: Vec3Node, withGlow: boolean): Vec3Node => {
    const tint = mix(u.fogColor, dome(ray), u.skyFogStrength);
    if (!withGlow) return tint;
    // The sky's own light belongs to open air: under rock (the same cover
    // that switches the fog to true 3D distance) there is no sky to see
    // through the walls, and a halo lit far cave walls pale blue-white.
    return tint.add(
      glow(ray).mul(u.skyFogStrength).mul(u.fogVerticalBlend.oneMinus()),
    );
  };

  /**
   * `color` hazed toward the sky along `ray` by `factor`. A solid surface
   * hazed out entirely is the sky, sun and moon included, so a sun setting
   * behind a ridge does not vanish in mid-air; one only partly hazed is
   * still a ridge, and the disc behind it stays hidden (weighting the disc
   * by the haze put half a moon over half-hazed trees). A see-through veil
   * (`isSolid` false: a cloud) lets the disc through as it hazes, so a sun
   * low behind the far, hazed deck still burns through it.
   */
  const haze = (
    color: Vec3Node,
    ray: Vec3Node,
    factor: FloatNode,
    isSolid = true,
  ): Vec3Node =>
    mix(color, fogTint(ray, true), factor).add(
      discs(ray)
        .mul(u.skyFogStrength)
        .mul(u.fogVerticalBlend.oneMinus())
        .mul(isSolid ? smoothstep(0.92, 1, factor) : factor),
    ) as Vec3Node;

  const underwater = underwaterFog(u);

  /**
   * The finished fog on `color` at `worldPosition`: the sky fog (into the
   * sky's own colour, glow and discs), then the water the camera looks
   * through. `reveal` 0 draws the surface as pure fog tint (the terrain
   * fade-in), 1 fogs it normally. Additive effects (`isEmission`) only
   * attenuate. `flatDistance` as in {@link fogFactor}; `isSolid` as in
   * {@link haze}.
   */
  const apply = (
    color: Vec3Node,
    worldPosition: Vec3Node,
    reveal: FloatNode,
    isEmission = false,
    flatDistance?: FloatNode,
    isSolid = true,
  ): Vec3Node => {
    const ray = normalize(worldPosition.sub(cameraPosition));
    const factor = mix(
      1,
      fogFactor(worldPosition, flatDistance).mul(u.cameraSubmersion.oneMinus()),
      reveal,
    );
    const fogged = isEmission
      ? color.mul(factor.oneMinus())
      : haze(color, ray, factor, isSolid);
    return underwater(fogged, worldPosition, isEmission);
  };

  return { glow, discs, dome, fogFactor, fogTint, haze, underwater, apply };
}

export type SkyFogShading = ReturnType<typeof skyFog>;

/** The inputs of the fog the camera looks through under water. */
export type UnderwaterFogInputs = {
  cameraSubmersion: FloatNode;
  cameraWaterPlaneY: FloatNode;
  underwaterAmbient: Vec3Node;
  underwaterViewScale: FloatNode;
};

/**
 * Per-channel (Beer-Lambert) fog along the camera's underwater view path,
 * clamped at the waterline plane so geometry above the surface only takes
 * the submerged segment. Emission loses light along the ray but gains no
 * ambient water light. Mixed in by the camera's submersion, so dry it is
 * the colour unchanged.
 */
export function underwaterFog(u: UnderwaterFogInputs) {
  return (
    color: Vec3Node,
    worldPosition: Vec3Node,
    isEmission = false,
  ): Vec3Node => {
    const ray = worldPosition.sub(cameraPosition);
    const dist = max(length(ray), 1e-4);
    const toPlane = u.cameraWaterPlaneY
      .sub(cameraPosition.y)
      .mul(dist)
      .div(max(ray.y, 1e-4));
    const path = ray.y
      .greaterThan(1e-4)
      .select(min(dist, max(toPlane, 0)), dist);
    const transmit = exp(
      WATER_VIEW_EXTINCTION_VEC.negate().mul(path).mul(u.underwaterViewScale),
    );
    const inScatter = u.underwaterAmbient.mul(
      ray.y.div(dist).mul(WATER_OPTICS.underwaterInScatterTilt).add(1),
    );
    const fogged = isEmission
      ? color.mul(transmit)
      : color.mul(transmit).add(inScatter.mul(transmit.oneMinus()));
    return u.cameraSubmersion
      .greaterThan(0.001)
      .select(mix(color, fogged, u.cameraSubmersion), color);
  };
}

/**
 * The world's fog as a scene fog node (`Scene.fogNode`): every node
 * material in the world that leaves `fog` on (the default) takes the same
 * sky fog and camera water the chunks wear, after its own shading. Additive
 * materials only fade, adding no fog colour. Materials that apply the fog
 * themselves (chunks, entity pools, the sky) turn `fog` off.
 */
export function worldFogNode(u: SkyFogInputs) {
  const fog = skyFog(u);
  return Fn((builder) => {
    const material = builder.material as { blending?: number } | null;
    const isAdditive = material?.blending === AdditiveBlending;
    return vec4(
      fog.apply(output.rgb, positionWorld, float(1), isAdditive),
      output.a,
    );
  })();
}
