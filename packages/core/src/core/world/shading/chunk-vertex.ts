import {
  attribute,
  cameraViewMatrix,
  ceil,
  clamp,
  cos,
  float,
  If,
  int,
  mat3,
  mix,
  modelWorldMatrix,
  modelWorldMatrixInverse,
  normalize,
  normalLocal,
  positionGeometry,
  positionLocal,
  select,
  sin,
  sqrt,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { NodeBuilder, Vector4 } from "three/webgpu";

import { fluidWaveNode } from "../fluid-waves";
import { QUAD_LIGHT_CORNER_FLAG, QUAD_LIGHT_TWIST_BIAS } from "../quad-light";
import { FLUID_SPILL_CORNER_MIN_HEIGHT } from "../water-optics";

import type { ArrayUniform, ChunkUniforms } from "./chunk-uniforms";
import { simplexNoise3Node } from "./noise";
import {
  componentOf,
  type FloatNode,
  type IntNode,
  type Vec2Node,
  type Vec3Node,
  type Vec4Node,
} from "./types";

/**
 * Bit map of the packed `light` attribute, mirroring
 * crates/mesher/src/mesher/vertex_light.rs. Change neither side alone.
 */
const LIGHT_MASK = 0xffff;
const AO_SHIFT = 16;
const AO_BITS = 0x3;
const FLUID_SHIFT = 18;
/** The greedy flag on a solid face, the pane flag on a fluid face. */
const GREEDY_SHIFT = 19;
const WAVE_SHIFT = 20;
const WATER_EXPOSED_SHIFT = 21;
const STACK_INDEX_SHIFT = 22;
const STACK_COUNT_SHIFT = 26;
const STACK_FIELD_BITS = 0xf;
/**
 * Under the sign bit, this stack-count code marks a colour-table face: its
 * index field names a table entry. Mirrors PIGMENT_CODE in vertex_light.rs.
 */
const PIGMENT_CODE = 15;
const EMISSIVE_SHIFT = 30;
/** On a waving fluid vertex the count field is the surface flow direction. */
const FLOW_DIRECTIONS = 15;
/**
 * ...and its index field the fluid standing below its corner, in these
 * units per block. Mirrors SURFACE_DEPTH_UNITS_PER_BLOCK in vertex_light.rs.
 */
const SURFACE_DEPTH_UNITS_PER_BLOCK = 4;

/** What a chunk vertex hands its fragments (packed into nine slots). */
export type ChunkVaryings = {
  worldPosition: Vec3Node;
  viewDepth: FloatNode;
  worldNormal: Vec3Node;
  ao: FloatNode;
  /** Voxel light (red, green, blue, sun), 0..1. */
  light: Vec4Node;
  /** The bilinear correction's twist x head weight (quad-light.ts). */
  lightTwist: Vec4Node;
  quadLightTail: FloatNode;
  stageTint: Vec3Node;
  isFluid: FloatNode;
  isGreedy: FloatNode;
  isFluidPane: FloatNode;
  isWaterExposed: FloatNode;
  fluidDepthBelow: FloatNode;
  fluidRestY: FloatNode;
  fluidFlow: Vec2Node;
  waterSurfaceY: FloatNode;
  emissive: FloatNode;
  /** The section's reveal from its arena's batching colour (1 otherwise). */
  chunkReveal: FloatNode;
  /** 1 for a cross-quad plant (fixed sun incidence, no face shade). */
  crossShading: FloatNode;
  mapUv: Vec2Node;
};

/** A block's fixed sway (`ChunkSwayConstants`, shading/chunk-material.ts). */
type SwayConstants = {
  speed: number;
  amplitude: number;
  scale: number;
  rooted: boolean;
  yScale: number;
  isCrossShaded: boolean;
};

export type ChunkDisplaceOptions = {
  /** A fixed sway baked into the program (a customized block). */
  sway: SwayConstants | null;
  /** Scales on the fluid swell's amplitude and speed (a crusted fluid). */
  waveScale: { amplitude: FloatNode; speed: FloatNode } | null;
  /** An extra displacement in world blocks. */
  hook:
    | ((context: {
        restWorld: Vec3Node;
        blockPosition: Vec3Node;
        runHeight: FloatNode;
      }) => Vec3Node)
    | null;
};

type VaryingSlot = Vec4Node & { assign(value: Vec4Node): unknown };

/**
 * The chunk vertex stage. Built inside the material's setupPosition (the
 * vertex stack): decodes the packed light attribute, then, once three's
 * batching and instancing have carried `positionLocal` into object space,
 * displaces it (`displace`) and writes the fragment varyings (`assign`).
 */
export function chunkVertex(
  u: Pick<
    ChunkUniforms,
    "ao" | "stageTints" | "pigmentTints" | "time" | "windOffset" | "windSpeed"
  > & { emissiveLevels: Vec4Node },
  builder: NodeBuilder,
  options: {
    /** Shared cutouts sway by the per-vertex profile table. */
    swayTable: ArrayUniform<Vector4, "vec4"> | null;
    /** Fixed-point counts per block of `position` (1 for float positions). */
    positionUnits: FloatNode;
  },
) {
  const geometry = builder.geometry;
  const has = (name: string) => geometry.hasAttribute(name);

  const light = int(attribute("light", "int")).toVar("chunkLight");
  const bits = (shift: number, mask: number): IntNode =>
    light.shiftRight(shift).bitAnd(mask);

  const ao = bits(AO_SHIFT, AO_BITS);
  const isFluid = bits(FLUID_SHIFT, 1);
  // A fluid never comes off the greedy path, so on a fluid vertex bit 19 is
  // the pane flag instead: a vertical face against a see-through solid.
  const bit19 = bits(GREEDY_SHIFT, 1);
  const isGreedy = bit19.bitAnd(int(1).sub(isFluid));
  const isFluidPane = bit19.bitAnd(isFluid);
  const isWaterExposed = bits(WATER_EXPOSED_SHIFT, 1);
  const isSigned = light.lessThan(0);

  const rawIndex = bits(STACK_INDEX_SHIFT, STACK_FIELD_BITS);
  const rawCount = bits(STACK_COUNT_SHIFT, STACK_FIELD_BITS).add(1);
  const biomeTint = has("biomeTint")
    ? vec3(attribute("biomeTint", "vec3"))
    : vec3(0);

  const stackIndex = int(rawIndex).toVar("chunkStackIndex");
  const stackCount = int(rawCount).toVar("chunkStackCount");
  const stageTint = vec3(1).toVar("chunkStageTint");
  // The sign bit is an explicit tag, never a numerical light value.
  If(isSigned.and(rawCount.sub(1).equal(PIGMENT_CODE)), () => {
    // A colour-table face: never regional and never a plant.
    stageTint.assign(u.pigmentTints.node.element(rawIndex).xyz);
    stackCount.assign(1);
    stackIndex.assign(0);
  }).ElseIf(isSigned, () => {
    // Byte-normalized RGB is a multiplier /128. Old worlds and non-chunk
    // previews carry zero and keep their stage palette.
    stageTint.assign(
      select(
        biomeTint.x.greaterThan(0),
        biomeTint.mul(255 / 128),
        u.stageTints.node.element(rawIndex).xyz,
      ),
    );
    // Short plant runs share four bits: count/index codes 0..1, 2..4,
    // 5..8, 9..13 (with_stage_tint in the mesher).
    const code = rawCount.sub(1);
    const count = select(
      code.lessThan(2),
      int(1),
      select(
        code.lessThan(5),
        int(2),
        select(code.lessThan(9), int(3), int(4)),
      ),
    );
    stackCount.assign(count);
    stackIndex.assign(code.sub(count.sub(1).mul(count.add(2)).div(2)));
  });

  // A fluid vertex that waves sits on its column's surface: its count field
  // carries the surface flow instead (0 still, else a direction).
  const isSurfaceVertex = isFluid.bitAnd(bits(WAVE_SHIFT, 1));
  const fluidFlow = vec2(0).toVar("chunkFluidFlow");
  If(isSurfaceVertex.equal(1), () => {
    const flowCode = bits(STACK_COUNT_SHIFT, STACK_FIELD_BITS);
    stackCount.assign(stackIndex.add(1));
    If(flowCode.greaterThan(0), () => {
      const angle = float(flowCode.sub(1)).mul(
        (Math.PI * 2) / FLOW_DIRECTIONS,
      );
      fluidFlow.assign(vec2(cos(angle), sin(angle)));
    });
  });

  const stackIndexF = float(stackIndex);
  const stackHeight = float(stackCount);
  // Blocks of fluid standing above this one.
  const fluidAbove = stackHeight.sub(1).sub(stackIndexF);

  const aoValue = componentOf(u.ao, ao).div(255);
  // Under the emissive bit the AO bits are a strength index.
  const emissive = float(bits(EMISSIVE_SHIFT, 1)).mul(
    componentOf(u.emissiveLevels, ao),
  );

  const nibbles = light.bitAnd(LIGHT_MASK);
  const voxelLight = vec4(
    float(nibbles.shiftRight(8).bitAnd(0xf)),
    float(nibbles.shiftRight(4).bitAnd(0xf)),
    float(nibbles.bitAnd(0xf)),
    float(nibbles.shiftRight(12).bitAnd(0xf)),
  ).div(15);

  // Bilinear voxel light (quad-light.ts): two factors whose product is the
  // correction. A geometry without the twist reads the neutral bytes.
  const twist = has("lightTwist")
    ? vec4(attribute("lightTwist", "vec4"))
    : vec4(QUAD_LIGHT_TWIST_BIAS);
  const head = float(twist.x.greaterThanEqual(QUAD_LIGHT_CORNER_FLAG));
  const tail = float(twist.y.greaterThanEqual(QUAD_LIGHT_CORNER_FLAG));
  const lightTwist = twist
    .sub(vec4(head, tail, 0, 0).mul(QUAD_LIGHT_CORNER_FLAG))
    .sub(QUAD_LIGHT_TWIST_BIAS)
    .mul(head.div(15));

  const crossShading = float(0).toVar("chunkCrossShading");
  const blockPosition = positionGeometry.div(options.positionUnits);
  /** 0 at a vertical run's root, 1 at its tip. */
  const runHeight = stackIndexF.add(blockPosition.y.fract()).div(stackHeight);

  /** The per-vertex sway profile of a shared cutout bucket. */
  const tableSway = (): Vec3Node => {
    const table = options.swayTable;
    if (!table) return vec3(0);
    // A quantized position's fourth lane (vertex-layout.ts).
    const profile =
      geometry.getAttribute("position")?.itemSize === 4
        ? int(attribute("position", "vec4").w.add(0.5))
        : int(0);
    const index = profile.mul(2);
    const params = table.node.element(index);
    const flags = table.node.element(index.add(1));
    const phase = u.time.mul(0.00002).mul(params.x);
    // Rooted plants bend from the dirt; sqrt keeps the root planted and
    // puts the stem at ~70% of the tip.
    const rootScale = mix(1, sqrt(clamp(runHeight, 0, 1)), flags.x);
    const noise = simplexNoise3Node(
      vec3(
        blockPosition.x.mul(phase).add(u.windOffset.x),
        blockPosition.y.mul(phase).mul(params.w),
        blockPosition.z.mul(phase).add(u.windOffset.y),
      ),
    );
    const shift = rootScale.mul(params.z).mul(noise).mul(params.y);
    crossShading.assign(flags.y);
    return vec3(shift.mul(2), 0, shift.mul(u.windSpeed).mul(0.5));
  };

  /** A customized block's fixed sway (`customShaders.sway`). */
  const fixedSway = (sway: SwayConstants): Vec3Node => {
    const phase = u.time.mul(0.00002 * sway.speed);
    const rootScale = sway.rooted ? runHeight : float(1);
    const noise = simplexNoise3Node(
      vec3(
        blockPosition.x.mul(phase).add(u.windOffset.x),
        blockPosition.y.mul(phase).mul(sway.yScale),
        blockPosition.z.mul(phase).add(u.windOffset.y),
      ),
    );
    const shift = rootScale.mul(sway.scale * sway.amplitude).mul(noise);
    if (sway.isCrossShaded) crossShading.assign(1);
    return vec3(shift.mul(2), 0, shift.mul(u.windSpeed).mul(0.5));
  };

  /**
   * The fluid swell at a world position: three octaves of simplex noise on
   * the shared clock (fluid-waves.ts sums the same on the CPU). A spill
   * corner (raised to the full block where fluid pours onto a lower sheet)
   * stays still, welded to the wall below it.
   */
  const wave = (
    world: Vec3Node,
    scale: ChunkDisplaceOptions["waveScale"],
  ): FloatNode => {
    const voxelY = ceil(world.y.sub(1e-3)).sub(1);
    const restHeight = world.y.sub(voxelY);
    let sum = fluidWaveNode(
      world.x,
      world.z,
      scale ? u.time.mul(scale.speed) : u.time,
    );
    if (scale) sum = sum.mul(scale.amplitude);
    return select(restHeight.lessThan(FLUID_SPILL_CORNER_MIN_HEIGHT), sum, 0);
  };

  /** The world position before displacement, set by `displace`. */
  const restWorld = vec3(0).toVar("chunkRestWorld");

  /**
   * Displaces `positionLocal` (already in object space) by the swell, the
   * sway and a game's hook, all worked out in world blocks (the mesher's
   * geometry is quantized, its placement in the object matrices) and
   * carried back through the inverse of object-to-world.
   */
  const displace = (displaceOptions: ChunkDisplaceOptions) => {
    restWorld.assign(modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz);
    const shouldWave = bits(WAVE_SHIFT, 1).equal(1);
    let offset: Vec3Node = vec3(
      0,
      select(shouldWave, wave(restWorld, displaceOptions.waveScale), 0),
      0,
    );
    if (options.swayTable) offset = offset.add(tableSway());
    if (displaceOptions.sway) {
      offset = offset.add(fixedSway(displaceOptions.sway));
    }
    if (displaceOptions.hook) {
      offset = offset.add(
        displaceOptions.hook({ restWorld, blockPosition, runHeight }),
      );
    }
    positionLocal.addAssign(mat3(modelWorldMatrixInverse).mul(offset));
  };

  /** Writes the packed varyings from the final (displaced) position. */
  const assign = (
    slots: VaryingSlot[],
    uvSlot: Vec2Node & { assign(value: Vec2Node): unknown },
    batchReveal: FloatNode,
  ) => {
    const worldPosition = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz;
    const worldNormal = normalize(mat3(modelWorldMatrix).mul(normalLocal));
    const viewDepth = cameraViewMatrix
      .mul(vec4(worldPosition, 1))
      .z.negate();
    // Water standing under a surface vertex down to the column's floor,
    // from the rest position (the swell could carry a vertex into the next
    // voxel). Meaningful on top faces only.
    const fluidVoxelY = ceil(restWorld.y.sub(1e-3)).sub(1);
    const fluidBelowBlocks = select(
      isSurfaceVertex.equal(1),
      stackIndexF.div(SURFACE_DEPTH_UNITS_PER_BLOCK),
      stackIndexF,
    );
    const fluidDepthBelow = float(isFluid).mul(
      restWorld.y.sub(fluidVoxelY).add(fluidBelowBlocks),
    );
    slots[0].assign(vec4(worldPosition, viewDepth));
    slots[1].assign(vec4(worldNormal, aoValue));
    slots[2].assign(voxelLight);
    slots[3].assign(lightTwist);
    slots[4].assign(vec4(stageTint, tail));
    slots[5].assign(
      vec4(
        float(isFluid),
        float(isGreedy),
        float(isFluidPane),
        float(isWaterExposed),
      ),
    );
    slots[6].assign(vec4(fluidDepthBelow, restWorld.y, fluidFlow));
    // The surface over a fluid fragment, read from its own column.
    slots[7].assign(
      vec4(
        worldPosition.y.add(fluidAbove),
        emissive,
        batchReveal,
        crossShading,
      ),
    );
    uvSlot.assign(uv());
  };

  return { displace, assign };
}
