import {
  abs,
  any,
  clamp,
  dot,
  float,
  floor,
  Fn,
  ivec2,
  ivec3,
  length,
  max,
  min,
  mix,
  normalize,
  pow,
  select,
  sin,
  smoothstep,
  uint,
  uvec2,
  uvec3,
  vec2,
  vec3,
} from "three/tsl";

import {
  SURFACE_POCK_MEAN,
  SURFACE_WEATHER as S,
  type SurfaceWeatherUniforms,
} from "../surface-weather";

import type { ChunkUniforms } from "./chunk-uniforms";
import type { FloatNode, UintNode, Vec2Node, Vec3Node, Vec4Node } from "./types";

/** Integer avalanche (lowbias32), the base of every surface-weather hash. */
const weatherMix = /*@__PURE__*/ Fn(
  ([seed]: [UintNode]) => {
    const h = uint(seed).toVar();
    h.assign(h.bitXor(h.shiftRight(16)));
    h.assign(h.mul(uint(0x7feb352d)));
    h.assign(h.bitXor(h.shiftRight(15)));
    h.assign(h.mul(uint(0x846ca68b)));
    h.assign(h.bitXor(h.shiftRight(16)));
    return h;
  },
  { seed: "uint", return: "uint" },
);

const INV_2_24 = 1 / 16777216;

/** `surfaceWeatherHash2` on the CPU: one value per unit cell of `p`. */
export const weatherHash2 = /*@__PURE__*/ Fn(
  ([p]: [Vec2Node]) => {
    const q = uvec2(ivec2(floor(p)));
    return float(weatherMix(q.x.add(weatherMix(q.y))).shiftRight(8)).mul(
      INV_2_24,
    );
  },
  { p: "vec2", return: "float" },
);

/** `surfaceWeatherHash3` on the CPU. */
export const weatherHash3 = /*@__PURE__*/ Fn(
  ([p]: [Vec3Node]) => {
    const q = uvec3(ivec3(floor(p)));
    return float(
      weatherMix(q.x.add(weatherMix(q.y.add(weatherMix(q.z))))).shiftRight(8),
    ).mul(INV_2_24);
  },
  { p: "vec3", return: "float" },
);

/** Value noise on the integer lattice (`surfaceWeatherNoise`). */
export const weatherNoise = /*@__PURE__*/ Fn(
  ([p]: [Vec2Node]) => {
    const i = floor(p);
    const f = p.sub(i);
    const t = f.mul(f).mul(f.mul(-2).add(3));
    const a = weatherHash2(i);
    const b = weatherHash2(i.add(vec2(1, 0)));
    const c = weatherHash2(i.add(vec2(0, 1)));
    const d = weatherHash2(i.add(vec2(1, 1)));
    return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
  },
  { p: "vec2", return: "float" },
);

/**
 * The surface-weather shading of one world, over its uniforms: wet ground,
 * rain pocks and rings near the player, the coat on the far layer.
 */
export function surfaceWeather(
  u: SurfaceWeatherUniforms &
    Pick<
      ChunkUniforms,
      | "skyFogDimension"
      | "skyFogOffset"
      | "skyFogMiddleColor"
      | "skyFogTopColor"
      | "skyFogExponent"
    >,
) {
  const sample = (xz: Vec2Node): Vec4Node =>
    u.surfaceWeatherMap
      .sample(xz.sub(u.surfaceWeatherWindow.xy).mul(u.surfaceWeatherWindow.zw))
      .level(float(0)) as unknown as Vec4Node;

  /** 1 above the coat line (snow country), 0 below it, across a jittered band. */
  const above = (xz: Vec2Node, y: FloatNode, lineCode: FloatNode) => {
    const line = u.surfaceWeatherLine.x.add(
      lineCode.mul(u.surfaceWeatherLine.y),
    );
    const jitter = weatherNoise(
      xz.mul(1 / S.lineJitterLarge.cell).add(vec2(3.7, 9.1)),
    )
      .sub(0.5)
      .mul(S.lineJitterLarge.swing)
      .add(
        weatherNoise(xz.mul(1 / S.lineJitterSmall.cell).add(vec2(11.3, 2.9)))
          .sub(0.5)
          .mul(S.lineJitterSmall.swing),
      );
    const band = max(u.surfaceWeatherLine.z, 0.01);
    return smoothstep(line.sub(band), line.add(band), y.add(jitter));
  };

  /** The sky dome's ramp along `dir`, for what a wet crest mirrors. */
  const skyAlong = (dir: Vec3Node): Vec3Node => {
    const h = normalize(dir.mul(u.skyFogDimension).add(u.skyFogOffset)).y;
    return mix(
      u.skyFogMiddleColor,
      u.skyFogTopColor,
      pow(max(h, 0), u.skyFogExponent),
    );
  };

  /** Wet ground: darker and a little more saturated, never glossy. */
  const wetAlbedo = (albedo: Vec3Node, wet: FloatNode): Vec3Node => {
    const darker = albedo.mul(mix(1, S.wetDarken, wet));
    const luma = dot(darker, vec3(0.2126, 0.7152, 0.0722));
    return max(mix(vec3(luma), darker, wet.mul(S.wetSaturation).add(1)), 0);
  };

  /** How much of the rain a face takes: tops all of it, walls some, more into the wind. */
  const faceWet = (normal: Vec3Node): FloatNode => {
    const windDir = u.surfaceWind.xy.div(max(length(u.surfaceWind.xy), 1e-4));
    const windward = max(dot(normal.xz, windDir.negate()), 0).mul(
      clamp(u.surfaceWind.z, 0, 1),
    );
    const up = smoothstep(S.upFrom, S.upTo, normal.y);
    return max(
      up,
      abs(normal.y)
        .oneMinus()
        .mul(windward.mul(S.windwardWet).add(S.sideWet)),
    );
  };

  /** A drop's pixel splash at a 1/16 texel: a dot, then a plus, then a faint ring. */
  const pock = (texel: Vec2Node, seconds: FloatNode, chance: FloatNode) => {
    const cell = floor(texel.mul(1 / S.pockCellTexels));
    const local = texel.sub(cell.mul(S.pockCellTexels));
    const t = seconds
      .mul(S.pockRate)
      .add(weatherHash3(vec3(cell, -1)).mul(31));
    const slot = floor(t);
    const age = t.sub(slot).mul(1 / S.pockRate);
    const splashes = select(
      weatherHash3(vec3(cell, slot.mul(3))).lessThan(chance),
      1,
      0,
    );
    const centre = floor(
      vec2(
        weatherHash3(vec3(cell, slot.mul(3).add(1))),
        weatherHash3(vec3(cell, slot.mul(3).add(2))),
      ).mul(2),
    ).add(1);
    const reach = abs(local.x.sub(centre.x)).add(abs(local.y.sub(centre.y)));
    const [dotEnd, plusEnd, ringEnd] = S.pockFrames;
    const [dotWeight, plusWeight, ringWeight] = S.pockWeights;
    const frame = select(
      age.lessThan(dotEnd),
      select(reach.lessThan(0.5), dotWeight, 0),
      select(
        age.lessThan(plusEnd),
        select(abs(reach.sub(1)).lessThan(0.5), plusWeight, 0),
        select(
          age.lessThan(ringEnd),
          select(abs(reach.sub(2)).lessThan(0.5), ringWeight, 0),
          0,
        ),
      ),
    );
    return frame.mul(splashes) as FloatNode;
  };

  /** Rain rings on still water: (slope xy, crest z), layered in one-block cells. */
  const rings = Fn(([xz, seconds, rain]: [Vec2Node, FloatNode, FloatNode]) => {
    const total = vec3(0).toVar();
    for (let layer = 0; layer < S.ringLayers; layer++) {
      const share = clamp(rain.mul(S.ringLayers).sub(layer), 0, 1);
      const p = xz.add(vec2(0.37, 0.71).mul(layer));
      const cell = floor(p);
      const t = seconds
        .mul(1 / S.ringLife)
        .add(weatherHash3(vec3(cell, layer - 8)));
      const slot = floor(t);
      const age = t.sub(slot);
      const seed = slot.mul(8).add(layer * 2);
      const ringing = select(
        weatherHash3(vec3(cell, seed)).lessThan(share.mul(S.ringChance)),
        1,
        0,
      );
      const centre = cell.add(0.3).add(
        vec2(
          weatherHash3(vec3(cell.add(vec2(7, 0)), seed.add(1))),
          weatherHash3(vec3(cell.add(vec2(0, 7)), seed.add(1))),
        ).mul(0.4),
      );
      const away = p.sub(centre);
      const r = length(away);
      const life = age.oneMinus();
      const radius = life.mul(life).oneMinus().mul(S.ringRadius);
      const fade = life.mul(life).mul(ringing);
      const wave = sin(
        clamp(r.sub(radius).mul(S.ringSharpness), -Math.PI, Math.PI),
      );
      total.addAssign(
        vec3(
          away.div(max(r, 1e-4)).mul(wave).mul(fade),
          smoothstep(0.03, 0.07, abs(r.sub(radius))).oneMinus().mul(fade),
        ),
      );
    }
    return total;
  });

  // ── the far layer's coat ────────────────────────────────────────────

  const coatDrift = (xz: Vec2Node): FloatNode => {
    const drift = weatherNoise(xz.mul(1 / S.driftScaleLarge))
      .mul(S.driftWeightLarge)
      .add(
        weatherNoise(xz.mul(1 / S.driftScaleSmall).add(vec2(17.3))).mul(
          1 - S.driftWeightLarge,
        ),
      );
    return clamp(drift.sub(0.5).mul(S.driftContrast).add(0.5), 0, 1);
  };

  const coatDensity = (coat: FloatNode, drift: FloatNode): FloatNode => {
    const drifts = coat.sub(S.driftStart).mul(1 / (1 - S.driftStart));
    return max(
      smoothstep(drift.sub(S.driftSoftness), drift.add(S.driftSoftness), drifts),
      coat.mul(S.coatSpeckle),
    ).mul(min(coat.mul(25), 1));
  };

  const coatMean = (coat: FloatNode): FloatNode => {
    const c = clamp(coat, 0, 1);
    const speckle = c.mul(S.coatSpeckle);
    const drifts = c.sub(S.driftStart).mul(1 / (1 - S.driftStart));
    return speckle.add(
      speckle
        .oneMinus()
        .mul(smoothstep(S.coatMean.from, S.coatMean.to, drifts)),
    );
  };

  /**
   * The far layer's ground under the weather: the wet ground the chunks draw
   * and the snow laid near the player as blocks, averaged at the footprint
   * it is seen at (no texels, no pocks, no rings), so the two meet without a
   * seam.
   */
  const farAlbedo = (
    albedo: Vec3Node,
    p: Vec3Node,
    normal: Vec3Node,
    footprint: FloatNode,
  ): Vec3Node => {
    const weather = sample(p.xz);
    const isAbove = above(p.xz, p.y, weather.a);
    const up = smoothstep(S.upFrom, S.upTo, normal.y);
    const wet = clamp(weather.g.mul(u.surfaceWeather.y), 0, 1)
      .mul(isAbove.oneMinus())
      .mul(faceWet(normal));
    const coat = clamp(weather.r.mul(u.surfaceWeather.z), 0, 1).mul(isAbove);
    const cover = up.mul(
      mix(
        coatDensity(coat, coatDrift(p.xz)),
        coatMean(coat),
        smoothstep(S.driftFadeFrom, S.driftFadeTo, footprint),
      ),
    );
    return mix(wetAlbedo(albedo, wet), u.surfaceCoatColor, cover);
  };

  return {
    sample,
    above,
    skyAlong,
    wetAlbedo,
    faceWet,
    pock,
    rings,
    farAlbedo,
    /** Whether any weather term is live: all zero skips every one. */
    isActive: any(u.surfaceWeather.notEqual(vec3(0))),
    pockMean: SURFACE_POCK_MEAN,
  };
}

export type SurfaceWeatherShading = ReturnType<typeof surfaceWeather>;
