import {
  Color,
  type ColorRepresentation,
  type Node,
  Vector2,
  Vector4,
} from "three/webgpu";
import {
  abs,
  clamp,
  cos,
  dFdx,
  dFdy,
  dot,
  float,
  floor,
  Fn,
  fract,
  If,
  int,
  ivec2,
  ivec3,
  length,
  max,
  min,
  mix,
  normalize,
  select,
  sin,
  smoothstep,
  sqrt,
  step,
  uint,
  uvec3,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

import { SHADER_CLOCK_WRAP_SECONDS } from "./shader-clock";
import type {
  ChunkLitHookContext,
  ChunkPrepareHookContext,
  ChunkShadingHooks,
} from "./shading/chunk-material";
import type {
  FloatNode,
  IntNode,
  UVec3Node,
  Vec2Node,
  Vec3Node,
  Vec4Node,
} from "./shading/types";
import { ownUniform, uniformArray } from "./shading/uniforms";
import { snapToTexelNode } from "./voxel-native-shading";

/**
 * A surface for a hot, viscous fluid: a dark cooled crust broken into plates
 * over glowing seams, drifting along the fluid's own flow, built on the chunk
 * lighting shader so it sits in the same world as every other block face.
 *
 * - Flow. A top face drifts along the mesher's per-corner surface flow (the
 *   same field that bends the water's crests), a wall slides straight down,
 *   so a fall runs faster than the sheet feeding it, and an underside stays.
 *   Offsets restart every cycle behind a two-generation cross-over, the usual
 *   flow-map trick, so a varying flow field never shears the pattern for
 *   longer than one cycle. A still pool drifts a little on a heading drawn
 *   per generation.
 * - Crust. Each generation is a cellular field of plates. A plate forms hot
 *   when its generation rises, darkens as it cools, and heats up again and
 *   breaks as its generation fades, so the crust reforms continuously
 *   instead of cross-fading. A slow heat field makes some patches run
 *   hotter than others, so the cycle never pulses over a whole lake at once.
 * - Voxel grain. Everything is evaluated per texel on the block-aligned grid
 *   (`texelsPerBlock`, 16 by default), offsets advance in whole texels, and
 *   heat maps onto a six-entry palette in flat bands: pixel art, not a
 *   smooth noise render. A texel smaller than a screen pixel would alias
 *   into sparkle (there is no mip chain for a procedural pattern), so the
 *   pattern settles to its mean colour past a screen-footprint threshold.
 * - Light. Crust (palette 0 and 1) is lit by the sun and sky like a solid
 *   face, over a small self-light so it stays readable in the dark; seams
 *   (palette 2 to 5) glow at their own colour. Block light is left out on
 *   purpose: the fluid's own emitted light would flood its crust to full
 *   brightness and flatten it. A per-direction face shade darkens walls and
 *   undersides so a fall reads as a solid column, and crust plates pick up a
 *   faint dome relief from the sun's heading.
 *
 * Every value is a uniform, so a game can tune the look live on the returned
 * uniforms without a recompile. The hooks plug into `World.customizeMaterial`
 * for the fluid block, with kind `seeThrough`: the crust replaces the water's
 * surface optics, not the solid shading.
 */
export type CrustedFluidShaderOptions = {
  /**
   * Six colours from coldest to hottest: dark crust, lit crust, ember,
   * seam, hot seam, seam core. The first two are lit; the rest glow.
   */
  palette?: ColorRepresentation[];
  /** Texels per block of the grid the pattern snaps to. */
  texelsPerBlock?: number;
  /** Mean plate size, in texels. */
  plateTexels?: number;
  /** Seam half-width in plate units (distance to the plate border). */
  seamWidth?: number;
  /** Drift of a running top face, in blocks per second. */
  surfaceFlowSpeed?: number;
  /** Slide of a wall (a fall), in blocks per second. */
  fallFlowSpeed?: number;
  /**
   * Seconds per crust generation. Must divide the shader clock's wrap
   * period so the wrap lands on a generation boundary.
   */
  cycleSeconds?: number;
  /** Plate elongation down a wall (1 keeps them round). */
  fallStretch?: number;
  /** Heat thresholds for the ember, seam, hot seam and core bands. */
  bands?: [number, number, number, number];
  /** Fraction of a generation a new plate takes to cool into crust. */
  formTime?: number;
  /** Per-texel heat jitter, which dithers the band edges. */
  grain?: number;
  /**
   * Plate dome relief on crust, 0 to 1: how far the plate's shaded half
   * falls from the lit crust colour toward the dark one.
   */
  relief?: number;
  /** Crust hold on a wall: below 1 a fall runs hotter than a pool. */
  fallCrust?: number;
  /** Heat-field scale (per block), base, amplitude and speed (per second). */
  zone?: { scale: number; base: number; amplitude: number; speed: number };
  /** Crust brightness without any light. */
  crustSelfLight?: number;
  /** Crust response to the sun and sky light reaching the face. */
  crustSceneLight?: number;
  /** Multiplier on the glowing bands. */
  glowStrength?: number;
  /** Share of seam colour in the far mean colour. */
  meanGlow?: number;
  /**
   * Texels per screen pixel past which detail starts settling to the mean
   * colour; at 4x this it is settled.
   */
  farFadeTexelFootprint?: number;
  /**
   * How much more a grazing view may squeeze the pattern along one screen
   * axis than along the other before that axis alone settles it, like
   * anisotropic texture filtering. 1 settles by the squeezed axis alone,
   * which flattens a pool seen from its shore a few blocks out.
   */
  farFadeAnisotropy?: number;
  /** Face shade for the +-X walls, +-Z walls, underside and top. */
  faceShades?: { sideX: number; sideZ: number; bottom: number; top: number };
  /** Scale on the shared surface wave height and speed. */
  wave?: { amplitude: number; speed: number };
};

export const CRUSTED_FLUID_DEFAULTS: Required<CrustedFluidShaderOptions> = {
  palette: ["#1a0e0c", "#3a1c14", "#8a1e08", "#e0520c", "#ff8a1e", "#ffc24a"],
  texelsPerBlock: 16,
  plateTexels: 10,
  seamWidth: 0.1,
  surfaceFlowSpeed: 0.06,
  fallFlowSpeed: 0.9,
  cycleSeconds: 8,
  fallStretch: 1.8,
  bands: [0.38, 0.6, 0.8, 0.94],
  formTime: 0.3,
  grain: 0.06,
  relief: 1,
  fallCrust: 0.85,
  zone: { scale: 0.21, base: 1.5, amplitude: 0.7, speed: 0.04 },
  crustSelfLight: 0.55,
  crustSceneLight: 0.6,
  glowStrength: 1,
  meanGlow: 0.3,
  farFadeTexelFootprint: 1.2,
  farFadeAnisotropy: 8,
  faceShades: { sideX: 0.8, sideZ: 0.72, bottom: 0.55, top: 1 },
  wave: { amplitude: 0.35, speed: 0.4 },
};

/** A crusted fluid's chunk shading and the uniforms that tune it live. */
export type CrustedFluidSurface = {
  /** For `World.customizeMaterial(block, null, { kind: "seeThrough", hooks })`. */
  hooks: ChunkShadingHooks;
  uniforms: ReturnType<typeof crustUniforms>;
};

function crustUniforms(o: Required<CrustedFluidShaderOptions>) {
  return {
    /** Six colours, coldest to hottest. */
    palette: uniformArray(
      o.palette.map((c) => new Color(c)),
      "color",
    ),
    /** Surface flow, fall flow (blocks/s), cycle seconds, fall stretch. */
    flow: ownUniform(
      new Vector4(
        o.surfaceFlowSpeed,
        o.fallFlowSpeed,
        o.cycleSeconds,
        o.fallStretch,
      ),
    ),
    /** Texels per block, plate texels, seam width, far-fade footprint. */
    shape: ownUniform(
      new Vector4(
        o.texelsPerBlock,
        o.plateTexels,
        o.seamWidth,
        o.farFadeTexelFootprint,
      ),
    ),
    farAnisotropy: ownUniform(Math.max(o.farFadeAnisotropy, 1)),
    bands: ownUniform(new Vector4(...o.bands)),
    /** Form time, grain, relief, fall crust. */
    life: ownUniform(new Vector4(o.formTime, o.grain, o.relief, o.fallCrust)),
    /** Heat-field scale, base, amplitude, speed. */
    zone: ownUniform(
      new Vector4(o.zone.scale, o.zone.base, o.zone.amplitude, o.zone.speed),
    ),
    /** Crust self light, crust scene light, glow strength, mean glow. */
    light: ownUniform(
      new Vector4(
        o.crustSelfLight,
        o.crustSceneLight,
        o.glowStrength,
        o.meanGlow,
      ),
    ),
    /** Face shade of the +-X walls, +-Z walls, underside, top. */
    faceShades: ownUniform(
      new Vector4(
        o.faceShades.sideX,
        o.faceShades.sideZ,
        o.faceShades.bottom,
        o.faceShades.top,
      ),
    ),
    /** Scale on the swell's amplitude and speed. */
    wave: ownUniform(new Vector2(o.wave.amplitude, o.wave.speed)),
  };
}

/**
 * Integer hash (pcg3d): exact at any coordinate, unlike a sin() hash. The
 * bias keeps world coordinates positive before the unsigned cast.
 */
const crustHash3 = /*@__PURE__*/ Fn(([p]: [IntNode]) => {
  const start = uvec3((p as unknown as Vec3Node).add(ivec3(16777216)) as never)
    .mul(uint(1664525))
    .add(uint(1013904223)) as unknown as UVec3Node;
  const x = start.x.toVar();
  const y = start.y.toVar();
  const z = start.z.toVar();
  const mixRound = () => {
    x.addAssign(y.mul(z));
    y.addAssign(z.mul(x));
    z.addAssign(x.mul(y));
  };
  mixRound();
  x.assign(x.bitXor(x.shiftRight(uint(16))));
  y.assign(y.bitXor(y.shiftRight(uint(16))));
  z.assign(z.bitXor(z.shiftRight(uint(16))));
  mixRound();
  return uvec3(x, y, z);
}).setLayout({
  name: "crustHash3",
  type: "uvec3",
  inputs: [{ name: "p", type: "ivec3" }],
});

/** Three uniform draws in 0..1 for an integer cell. */
const crustUnit3 = (p: Vec3Node): Vec3Node =>
  vec3(
    (
      crustHash3(p as never) as unknown as {
        shiftRight(bits: Node): UVec3Node;
      }
    ).shiftRight(uvec3(8, 8, 8) as unknown as Node),
  ).mul(1 / 16777216);

/**
 * Plates of one generation around q (plate units): x = distance to the
 * plate border (F2 - F1), y = the plate's own draw, zw = the offset from
 * the plate's point to q.
 */
const crustPlates = /*@__PURE__*/ Fn(([q, seed]: [Vec2Node, IntNode]) => {
  const base = ivec2(floor(q));
  const f = q.sub(vec2(base));
  const d1 = float(8).toVar();
  const d2 = float(8).toVar();
  const nearest = vec3(0).toVar();
  const nearestOffset = vec2(0).toVar();
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const r = crustUnit3(ivec3(base.add(ivec2(i, j)), seed) as never);
      const toPoint = vec2(i, j).add(r.xy).sub(f);
      const d = dot(toPoint, toPoint);
      If(d.lessThan(d1), () => {
        d2.assign(d1);
        d1.assign(d);
        nearest.assign(r);
        nearestOffset.assign(toPoint);
      }).ElseIf(d.lessThan(d2), () => {
        d2.assign(d);
      });
    }
  }
  return vec4(sqrt(d2).sub(sqrt(d1)), nearest.z, nearestOffset.negate());
}).setLayout({
  name: "crustPlates",
  type: "vec4",
  inputs: [
    { name: "q", type: "vec2" },
    { name: "seed", type: "int" },
  ],
});

/** What the crust's fragment preparation takes before any branch. */
type CrustPrepared = { uv: Vec2Node; far: FloatNode };

let nextCrustSurface = 0;

/**
 * The crusted fluid surface: its lighting hook (the crust replaces the lit
 * colour), its derivative preparation and its wave scale, over uniforms a
 * game can tune live.
 */
export function createCrustedFluidSurface(
  options: CrustedFluidShaderOptions = {},
): CrustedFluidSurface {
  const o = { ...CRUSTED_FLUID_DEFAULTS, ...options };
  if (o.palette.length !== 6) {
    throw new Error("Crusted fluid palette needs exactly six colours");
  }
  if (
    !(o.cycleSeconds > 0) ||
    SHADER_CLOCK_WRAP_SECONDS % o.cycleSeconds !== 0
  ) {
    throw new Error(
      `Crusted fluid cycleSeconds must divide the shader clock wrap (${SHADER_CLOCK_WRAP_SECONDS}s)`,
    );
  }
  const u = crustUniforms(o);
  const palette = (i: number) =>
    u.palette.element(int(i)) as unknown as Vec3Node;

  /** Face-plane coordinates in blocks; on a wall, y runs up it. */
  const faceUv = (normal: Vec3Node, position: Vec3Node): Vec2Node => {
    const a = abs(normal);
    return select(
      a.y.lessThan(0.5),
      vec2(select(a.x.greaterThan(a.z), position.z, position.x), position.y),
      position.xz,
    );
  };

  const prepare = ({ v }: ChunkPrepareHookContext): CrustPrepared => {
    const uv = faceUv(v.worldNormal, v.worldPosition).toVar("crustUv");
    const texels = u.shape.x;
    // Texels a screen pixel spans along the most and the least squeezed
    // directions (the singular values of the screen-to-texel map). A grazing
    // view squeezes one far faster than the other; it may run up to the
    // anisotropy allowance ahead before it settles the pattern.
    const dx = dFdx(uv.mul(texels));
    const dy = dFdy(uv.mul(texels));
    const xx = dot(dx, dx);
    const yy = dot(dy, dy);
    const sum = xx.add(yy);
    const diff = length(vec2(xx.sub(yy), dot(dx, dy).mul(2)));
    const major = sqrt(sum.add(diff).mul(0.5));
    const minor = sqrt(max(sum.sub(diff).mul(0.5), 0));
    const far = smoothstep(
      u.shape.w,
      u.shape.w.mul(4),
      max(minor, major.div(u.farAnisotropy)),
    ).toVar("crustFar");
    return { uv, far };
  };

  const lit = ({ v, sunTotal, uniforms, prepared }: ChunkLitHookContext) => {
    const { uv, far } = prepared as CrustPrepared;
    const normal = v.worldNormal;
    const absNormal = abs(normal);
    const isWall = absNormal.y.lessThan(0.5);
    const isTop = normal.y.greaterThanEqual(0.5);
    const texels = u.shape.x;
    const texel = floor(uv.mul(texels));

    const seconds = uniforms.chunk.time.mul(0.001);
    const cycle = seconds.div(u.flow.z);
    const phaseA = fract(cycle);
    const phaseB = fract(cycle.add(0.5));
    const seedA = int(floor(cycle)).mul(2).toVar("crustSeedA");
    const seedB = int(floor(cycle.add(0.5))).mul(2).add(1).toVar("crustSeedB");
    const weightA = abs(phaseA.mul(2).sub(1)).oneMinus();
    const weightB = weightA.oneMinus();

    // Blocks per second across the face: the surface flow on a top, straight
    // down a wall, nothing underneath. A still pool drifts on a heading drawn
    // per generation, fading out where the sheet runs.
    const run = min(length(v.fluidFlow), 1);
    const flow = select(
      isWall,
      vec2(0, u.flow.y.negate()),
      select(isTop, v.fluidFlow.mul(u.flow.x), vec2(0)),
    );
    const poolDrift = select(isTop, run.oneMinus().mul(u.flow.x), float(0));
    const heading = (seed: IntNode) =>
      crustUnit3(ivec3(0, 0, seed) as never).x.mul(Math.PI * 2);
    const headingA = heading(seedA);
    const headingB = heading(seedB);
    const driftA = flow.add(vec2(cos(headingA), sin(headingA)).mul(poolDrift));
    const driftB = flow.add(vec2(cos(headingB), sin(headingB)).mul(poolDrift));
    // Whole texels, so the pattern steps on the block's own grid.
    const texelA = texel
      .sub(floor(driftA.mul(phaseA).mul(u.flow.z).mul(texels)))
      .toVar("crustTexelA");
    const texelB = texel
      .sub(floor(driftB.mul(phaseB).mul(u.flow.z).mul(texels)))
      .toVar("crustTexelB");
    const plateScale = vec2(1, select(isWall, float(1).div(u.flow.w), float(1))).div(
      u.shape.y,
    );
    // Per-texel draws riding with each generation: xy nudge the texel before
    // the plate lookup, so plate borders come out ragged by a texel instead
    // of as smooth polygons; z is grain.
    const noiseA = crustUnit3(
      ivec3(ivec2(texelA), seedA.add(7919)) as never,
    ).toVar("crustNoiseA");
    const noiseB = crustUnit3(
      ivec3(ivec2(texelB), seedB.add(7919)) as never,
    ).toVar("crustNoiseB");
    const plateA = crustPlates(
      texelA.add(0.5).add(noiseA.xy.sub(0.5).mul(0.8)).mul(plateScale),
      seedA,
    ) as unknown as Vec4Node;
    const plateB = crustPlates(
      texelB.add(0.5).add(noiseB.xy.sub(0.5).mul(0.8)).mul(plateScale),
      seedB,
    ) as unknown as Vec4Node;

    // Slow heat field: where it is high, generations hold their crust longer.
    const zonePos = snapToTexelNode(uv, texels).mul(u.zone.x);
    const zoneTime = seconds.mul(u.zone.w);
    const zone = sin(zonePos.x.add(zonePos.y.mul(0.7)).add(zoneTime)).mul(
      sin(zonePos.y.mul(1.3).sub(zonePos.x.mul(0.4)).sub(zoneTime.mul(0.8))),
    );
    const hold = u.zone.y
      .add(u.zone.z.mul(zone))
      .mul(select(isWall, u.life.w, float(1)));
    // The generation whose plate is further into its life shows.
    const lifeA = min(weightA.mul(hold), 1).sub(plateA.y);
    const lifeB = min(weightB.mul(hold), 1).sub(plateB.y);
    const showA = lifeA.greaterThanEqual(lifeB);
    const plate = select(showA, plateA, plateB).toVar("crustPlate");
    const age = clamp(max(lifeA, lifeB).div(u.life.x), 0, 1);

    const grain = select(showA, noiseA.z, noiseB.z).sub(0.5);
    // Each plate draws its own border width, so cracks vary along their run.
    const seamWidth = u.shape.z
      .mul(fract(plate.y.mul(13.7)).mul(0.8).add(0.6))
      .mul(age.oneMinus().mul(2.5).add(1));
    const seam = clamp(plate.x.div(seamWidth), 0, 1).oneMinus();
    const edge = clamp(plate.x.div(0.5), 0, 1).oneMinus();
    const body = age.oneMinus().mul(edge.mul(0.55).add(0.45));
    const heat = max(seam, body).add(grain.mul(u.life.y));

    // Dome relief: the half of a plate facing the sun (straight up on a
    // wall) takes the lit crust colour.
    const lightDir = select(
      isWall,
      vec2(0, 1),
      normalize(uniforms.lighting.sunDirection.xz.add(vec2(1e-4))),
    );
    const litSide = step(0, dot(plate.zw, lightDir).add(grain.mul(0.3)));
    const scene = sunTotal.mul(u.light.y).add(u.light.x);
    const tone = mix(mix(palette(1), palette(0), u.life.z), palette(1), litSide);
    const glow = select(
      heat.greaterThanEqual(u.bands.w),
      palette(5),
      select(
        heat.greaterThanEqual(u.bands.z),
        palette(4),
        select(heat.greaterThanEqual(u.bands.y), palette(3), palette(2)),
      ),
    ).mul(u.light.z);
    const near = select(heat.greaterThanEqual(u.bands.x), glow, tone.mul(scene));
    const mean = mix(palette(1).mul(scene), palette(3).mul(u.light.z), u.light.w);
    const color = mix(near, mean, far);

    const weights = absNormal.div(
      max(absNormal.x.add(absNormal.y).add(absNormal.z), 1e-4),
    );
    const faceShade = weights.x
      .mul(u.faceShades.x)
      .add(weights.z.mul(u.faceShades.y))
      .add(
        weights.y.mul(
          select(normal.y.greaterThan(0), u.faceShades.w, u.faceShades.z),
        ),
      );
    return color.mul(faceShade);
  };

  return {
    hooks: {
      key: `crusted-fluid:${nextCrustSurface++}`,
      prepare,
      lit,
      wave: { amplitude: u.wave.x, speed: u.wave.y },
    },
    uniforms: u,
  };
}
