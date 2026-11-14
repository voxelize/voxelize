import {
  cameraFar,
  cameraNear,
  abs,
  attribute,
  batch,
  batchColor,
  cameraPosition,
  clamp,
  dFdx,
  dFdy,
  diffuseColor,
  Discard,
  dot,
  exp,
  float,
  floor,
  Fn,
  If,
  instancedMesh,
  length,
  mat3,
  materialAlphaTest,
  max,
  min,
  mix,
  normalize,
  positionGeometry,
  positionLocal,
  screenCoordinate,
  screenUV,
  select,
  smoothstep,
  uniform,
  varyingProperty,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  type BatchedMesh,
  type Color,
  type InstancedMesh,
  Matrix4,
  NodeMaterial,
  type NodeBuilder,
  type Object3D,
  type Texture,
  Vector2,
  type Vector3,
  Vector4,
} from "three/webgpu";

import {
  BLOCK_LIGHT_TRANSFER,
  BLOCK_LIGHT_WARM_TINT,
} from "../block-light-transfer";
import type { GpuTerrainSections } from "../gpu-terrain-bucket";
import { type LightConeUniforms, markLightConesCovered } from "../light-cones";
import { WATER_DEPTH_BIAS_BLOCKS } from "../water-depth-constants";
import {
  WATER_OPTICS as W,
  WATER_SURFACE_SCATTER_COLOR,
} from "../water-optics";

import {
  acesFitNode,
  blockLightAdaptNode,
  blockLightCurveNode,
  blockLightCurveFilledNode,
  BLOCK_LIGHT_GAIN,
  luminance709,
} from "./block-light";
import type {
  ArrayUniform,
  ChunkUniforms,
  ShaderLightingUniforms,
} from "./chunk-uniforms";
import {
  chunkVertex,
  type ChunkSwayInputs,
  type ChunkVaryings,
} from "./chunk-vertex";
import { perspectiveDepthToViewZ } from "./conventions";
import { markMaterialPropertyRead, narrowRefresh } from "./draw-refresh";
import { farSeam } from "./far-seam";
import { lightConeShading } from "./light-cones";
import { type LocalLightInputs, localLightShading } from "./local-lights";
import { simplexNoise3Node } from "./noise";
import { shadeSkyTint } from "./shade-tint";
import { sunShadow } from "./shadows";
import { skyFog } from "./sky-fog";
import { surfaceWeather } from "./surface-weather";
import {
  type FloatNode,
  materialValue,
  type Vec2Node,
  type Vec3Node,
  type Vec4Node,
} from "./types";
import { materialTexture, perDrawInputs, placeholderTexture } from "./uniforms";
import { waterCausticWeb } from "./water-caustics";
import { waterSurface } from "./water-surface";

/**
 * How a chunk material draws:
 * - `opaque`: solid faces, the soft 5x5 shadow.
 * - `cutout`: the shared cutout buckets (leaves, plants, tufts), swaying by
 *   the per-vertex profile table.
 * - `seeThrough`: blended see-through blocks (glass, panes), the fast
 *   shadow, split around the water's depth by `waterDepthSide`.
 * - `fluid`: water and other fluids: the surface branch and the fast shadow.
 */
export type ChunkMaterialKind = "opaque" | "cutout" | "seeThrough" | "fluid";

/** A block's fixed sway (`customShaders.sway`), baked into its program. */
export type ChunkSwayConstants = {
  speed: number;
  amplitude: number;
  scale: number;
  rooted: boolean;
  yScale: number;
  /** Cross-quad shading: fixed sun incidence, no face shade. */
  isCrossShaded: boolean;
};

export const DEFAULT_CHUNK_SWAY: ChunkSwayConstants = {
  speed: 1,
  amplitude: 0.1,
  rooted: false,
  scale: 1,
  yScale: 1,
  isCrossShaded: false,
};

/** What a chunk vertex hook can read. */
export type ChunkVertexHookContext = {
  /** The vertex's world position before any displacement. */
  restWorld: Vec3Node;
  /** The geometry position in blocks (the mesher's section space). */
  blockPosition: Vec3Node;
  /** 0 at a vertical run's root, 1 at its tip. */
  runHeight: FloatNode;
};

/** What a chunk lighting hook can read. */
export type ChunkLitHookContext = {
  v: ChunkVaryings;
  /** The atlas texel as sampled, before tints. */
  sampled: Vec4Node;
  /** The albedo the face shades with (tints and weather applied). */
  albedo: Vec3Node;
  /** The light multiplier the face would be lit by. */
  totalLight: Vec3Node;
  /** The sky and sun part of it, before block light. */
  sunTotal: Vec3Node;
  uniforms: ChunkShadingInputs;
  /** What the hooks' `prepare` returned, or undefined without one. */
  prepared: unknown;
};

/** What a hook's fragment preparation can read. */
export type ChunkPrepareHookContext = {
  v: ChunkVaryings;
  uniforms: ChunkShadingInputs;
};

/**
 * Game-side customization of a block's chunk shading: TSL nodes the chunk
 * graph calls at its stages. `key` names the customization for program
 * caching: two materials with the same key and kind share one program.
 */
export type ChunkShadingHooks = {
  key: string;
  /**
   * Runs once at the top of the lighting, outside every branch: derivatives
   * (`dFdx`, `fwidth`) and implicit-LOD samples belong here, since inside a
   * branch they read neighbours that may not run it. What it returns (made
   * `toVar` there) reaches `lit` as `prepared`.
   */
  prepare?: (context: ChunkPrepareHookContext) => unknown;
  /**
   * Remap the uv before it is sampled (an animation strip). The texture's
   * mip gradients follow the remapped uv.
   */
  sampleUv?: (uv: Vec2Node, context: ChunkPrepareHookContext) => Vec2Node;
  /**
   * The lit colour of a face that shades normally (emissive faces bypass
   * it): `albedo * totalLight` unless replaced.
   */
  lit?: (context: ChunkLitHookContext) => Vec3Node;
  /** An extra displacement in world blocks. */
  displace?: (context: ChunkVertexHookContext) => Vec3Node;
  /**
   * Per-material values the hooks read, by `materialValue("hookValues.<name>",
   * type)`: blocks whose hooks differ only in numbers share one key, and so
   * one graph, with their numbers here.
   */
  values?: Record<string, number | Vector2 | Vector3 | Vector4 | Color>;
  /** Scale the fluid swell's amplitude and speed. */
  wave?: { amplitude: FloatNode; speed: FloatNode };
};

/** Everything a world's chunk materials read alike. */
export type ChunkShadingInputs = {
  /** Distinguishes worlds in program caches (their uniform nodes differ). */
  readonly id: number;
  readonly chunk: ChunkUniforms;
  readonly lighting: ShaderLightingUniforms;
  readonly cones: LightConeUniforms;
  readonly local: LocalLightInputs;
  readonly swayTable: ArrayUniform<import("three/webgpu").Vector4, "vec4">;
  /**
   * The pass a world's blended layers are accumulating in, when it draws
   * them order-independently (`OrderIndependentTransparency.uniforms`).
   * With a separating surface in view every blended draw runs twice, once
   * for each side of it, and the accumulation drops the fragments of the
   * other side after they are shaded: a blended chunk fragment reads which
   * side the pass keeps and lights only there (`FragmentState.isKept`).
   */
  readonly blended: BlendedPassInputs | null;
};

/** See {@link ChunkShadingInputs.blended}. */
export type BlendedPassInputs = {
  /** 0 all, 1 what lies behind the separating surface, 2 the rest. */
  phase: FloatNode;
  separatorDepth: { sample(uv: Vec2Node): { level(level: FloatNode): Vec4Node } };
  separatorBias: FloatNode;
};

export type ChunkMaterialOptions = {
  kind: ChunkMaterialKind;
  sway?: Partial<ChunkSwayConstants> | null;
  hooks?: ChunkShadingHooks | null;
  /**
   * The chunk vertex stage (waves and sway move the surface) over a fragment
   * stage that writes nothing but depth: the water's depth passes.
   */
  depthOnly?: boolean;
};

const vChunk = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
  varyingProperty("vec4", `vChunk${i}`),
);
const vChunkUv = varyingProperty("vec2", "vChunkUv");

function readVaryings(): ChunkVaryings {
  const [s0, s1, s2, s3, s4, s5, s6, s7] = vChunk;
  return {
    worldPosition: s0.xyz,
    viewDepth: s0.w,
    worldNormal: s1.xyz,
    ao: s1.w,
    light: s2,
    lightTwist: s3,
    quadLightTail: s4.w,
    stageTint: s4.xyz,
    isFluid: s5.x,
    isGreedy: s5.y,
    isFluidPane: s5.z,
    isWaterExposed: s5.w,
    fluidDepthBelow: s6.x,
    fluidRestY: s6.y,
    fluidFlow: s6.zw,
    waterSurfaceY: s7.x,
    emissive: s7.y,
    chunkReveal: s7.z,
    crossShading: s7.w,
    mapUv: vChunkUv,
  } as unknown as ChunkVaryings;
}

/** A greedy face's coordinates inside its atlas cell, from its normal. */
function greedyFaceUv(normal: Vec3Node, local: Vec3Node): Vec2Node {
  const absNormal = abs(normal);
  return select(
    absNormal.y.greaterThan(0.5),
    select(
      normal.y.greaterThan(0),
      vec2(local.x.oneMinus(), local.z),
      vec2(local.x, local.z.oneMinus()),
    ),
    select(
      absNormal.x.greaterThan(0.5),
      select(
        normal.x.greaterThan(0),
        vec2(local.z.oneMinus(), local.y),
        vec2(local.z, local.y),
      ),
      select(
        normal.z.greaterThan(0),
        vec2(local.x, local.y),
        vec2(local.x.oneMinus(), local.y),
      ),
    ),
  );
}

type FragmentState = {
  v: ChunkVaryings;
  sampled: Vec4Node;
  /**
   * Whether the fragment's texel survives the alpha tests (above 0.5), or
   * null where the material has none. A discard only stops the write: the
   * rest of the shader still runs, so a cutout's holes (most of a plant's
   * quad, of a leaf block's face) would light for nothing. The lighting's
   * heavy steps are branched on this instead.
   */
  isKept: FloatNode | null;
  weatherRainHere: FloatNode;
  weatherFootprint: FloatNode;
  water: ReturnType<ReturnType<typeof waterSurface>["prepare"]> | null;
};

/** A depth-only fork's colour: nothing; one node, so the forks share a graph. */
const DEPTH_ONLY_COLOR = /*@__PURE__*/ vec4(0);

/** What a drawn chunk mesh's own material holds of its fixed sway. */
type FixedSwayHolder = { _swayMotion?: Vector4; _swayCrossShading?: number };
const NO_SWAY_MOTION = /*@__PURE__*/ new Vector4();

/**
 * A block's fixed sway, read before each draw off the drawn mesh's own
 * material (`ChunkMaterial._swayMotion`, `_swayCrossShading`): blocks that
 * differ only in their sway share one program. Read off the mesh, not the
 * material being drawn, because the depth passes draw through an override
 * material while the mesh keeps its own: the caster's shadow moves with its
 * leaves. Its only input is that material property (`narrowRefresh`).
 */
const FIXED_SWAY: ChunkSwayInputs = /*@__PURE__*/ (() => {
  const holder = (object: Object3D | null | undefined) =>
    (object as { material?: FixedSwayHolder } | null | undefined)?.material;
  const motion = uniform(new Vector4()).onObjectUpdate(
    ({ object }) => holder(object)?._swayMotion ?? NO_SWAY_MOTION,
  );
  const crossShading = uniform(0).onObjectUpdate(
    ({ object }) => holder(object)?._swayCrossShading ?? 0,
  );
  markMaterialPropertyRead(motion, "_swayMotion");
  markMaterialPropertyRead(crossShading, "_swayCrossShading");
  return {
    motion: motion as unknown as ChunkSwayInputs["motion"],
    crossShading: crossShading as unknown as ChunkSwayInputs["crossShading"],
  };
})();

/**
 * What a depth pass that overrides the material (the sun's cascades, the
 * local lights' shadow faces) moves a swaying chunk's vertices with. three
 * keeps a caster's `positionNode` on its override and nothing of its
 * `setupPosition`, so without one a swaying leaf or plant cast its rest
 * shape while it moved. One node per world, kind, sway or none and position
 * format: every material of a variant shares it, and with it one depth
 * graph. It reads world uniforms, the geometry and the drawn mesh's own
 * material (a fixed sway, `FIXED_SWAY`), never the material being drawn:
 * built into the override, that is the depth material.
 */
const casterPositions = new WeakMap<object, Map<string, Vec3Node>>();

function casterPositionNode(
  shading: ChunkShadingInputs,
  kind: ChunkMaterialKind,
  hasSway: boolean,
  positionUnits: number,
): Vec3Node {
  let nodes = casterPositions.get(shading);
  if (!nodes) {
    nodes = new Map();
    casterPositions.set(shading, nodes);
  }
  const key = `${kind}|${hasSway ? "sway" : "-"}|${positionUnits}`;
  let node = nodes.get(key);
  if (!node) {
    node = Fn((builder: NodeBuilder) => {
      const vertex = chunkVertex(
        { ...shading.chunk, emissiveLevels: shading.local.grid.emissiveLevels },
        builder,
        {
          swayTable: kind === "cutout" ? shading.swayTable : null,
          positionUnits: float(positionUnits),
        },
      );
      vertex.displace({
        sway: hasSway ? FIXED_SWAY : null,
        waveScale: null,
        hook: null,
      });
      return positionLocal;
    })() as unknown as Vec3Node;
    nodes.set(key, node);
  }
  return node;
}

/**
 * A GPU terrain section's origin and reveal, read by the vertex's
 * `sectionId` from the bucket the drawn mesh belongs to; null for a mesh
 * outside one.
 */
function gpuSectionOf(object: Object3D | undefined) {
  const bucket = object?.userData?.gpuTerrain as
    | { sections: GpuTerrainSections }
    | undefined;
  if (!bucket) return null;
  const id = attribute("sectionId", "uint");
  const record = bucket.sections.records.element(id.mul(2));
  return { origin: record.xyz, reveal: record.w };
}

/**
 * What a depth pass that overrides a GPU-drawn material moves its vertices
 * with: the section's origin, then the sway, as the material's own vertex
 * stage (`casterPositionNode` for a section drawn by a region arena). One
 * per material (`ChunkMaterial.gpuCasterPosition`), never shared: the node
 * reads the drawn bucket's own section records, and the material's program
 * (keyed by this node, with its bindings) would otherwise be shared by every
 * bucket of a kind, each drawing its sections at the first one's origins
 * (torch sticks gone, plants and leaves floating where another bucket's
 * sections sit). Made once, so rekeying the material keeps its program.
 */
function makeGpuSectionCasterPosition(
  shading: ChunkShadingInputs,
  kind: ChunkMaterialKind,
  hasSway: boolean,
  positionUnits: number,
): Vec3Node {
  return Fn((builder: NodeBuilder) => {
    const vertex = chunkVertex(
      { ...shading.chunk, emissiveLevels: shading.local.grid.emissiveLevels },
      builder,
      {
        swayTable: kind === "cutout" ? shading.swayTable : null,
        positionUnits: float(positionUnits),
      },
    );
    const section = gpuSectionOf(builder.object as Object3D);
    if (section) {
      positionLocal.assign(
        positionLocal.div(float(positionUnits)).add(section.origin),
      );
    }
    vertex.displace({
      sway: hasSway ? FIXED_SWAY : null,
      waveScale: null,
      hook: null,
    });
    return positionLocal;
  })() as unknown as Vec3Node;
}

/**
 * The chunk material: every face the mesher lays is drawn by one of these.
 * Its shading is a TSL graph built per kind (and sway, and hooks) once per
 * world: what varies per material (its texture, its weather response, its
 * reveal, a voxel box's texel frame, a pane's side of the water) is read
 * through material references, so any number of materials share a program.
 */
export class ChunkMaterial extends NodeMaterial {
  static override get type() {
    return "ChunkMaterial";
  }

  readonly isChunkMaterial = true;

  /** The atlas (or an own-texture face's texture) this material samples. */
  map: Texture = placeholderTexture("color");
  /** How far the material takes the weather (`SURFACE_RESPONSE`). */
  surfaceResponse = 1;
  /** The voxel sunlight over which its faces count as open to the sky. */
  surfaceOpenLight = new Vector2(0.85, 0.98);
  /** Terrain fade-in, 0 (pure fog tint) to 1 (drawn as itself). */
  chunkReveal = 1;
  /** A voxel box's frame back to where its faces were meshed. */
  greedyFrame: { readonly value: Matrix4 } = { value: new Matrix4() };
  hasGreedyFrame = 0;
  /** A pane fork's side of the water (`WATER_DEPTH_SIDE_*`). */
  waterDepthSide = 0;
  /** Fixed-point counts per block of the geometry's positions. */
  positionUnits = 1;
  /**
   * The values this material's hooks read (`ChunkShadingHooks.values`, by
   * `materialValue("hookValues.<name>", type)`).
   */
  hookValues: Record<string, unknown> = {};
  readonly perDrawNode = perDrawInputs;
  /**
   * Whether texels at or above `solidTexelCut` are dropped after the alpha
   * test: the translucent half of a see-through split (see-through-texels),
   * whose solid texels draw with the depth writers instead.
   */
  cutsSolidTexels = false;
  solidTexelCut = 1;
  /**
   * Drawn by a GPU terrain bucket (`gpu-terrain-bucket.ts`): a vertex takes
   * its section's origin and reveal from the bucket's records by its
   * `sectionId`. A flag of its own, so such a material keys its own graph.
   */
  drawsGpuSections = false;

  readonly shading: ChunkShadingInputs;
  private variant: {
    kind: ChunkMaterialKind;
    sway: ChunkSwayConstants | null;
    hooks: ChunkShadingHooks | null;
    depthOnly: boolean;
  };
  // What the build hands from one setup stage to the next. Underscored, so
  // three's material key (which skips `_` properties) reads a built and an
  // unbuilt material alike: they share one graph.
  private _fragmentState: FragmentState | null = null;

  /** The fixed sway's speed, amplitude times scale, y scale and rooted (0
   *  or 1), and its cross shading, as `FIXED_SWAY` reads them per draw
   *  (underscored: three's material key reads every other number as
   *  on/off). */
  _swayMotion = new Vector4();
  _swayCrossShading = 0;
  /** This material's own caster position when GPU-drawn (see
   *  `makeGpuSectionCasterPosition`); never copied to another material. */
  private _gpuCasterPosition: { key: string; node: Vec3Node } | null = null;

  constructor(shading: ChunkShadingInputs, options: ChunkMaterialOptions) {
    super();
    this.shading = shading;
    this.variant = ChunkMaterial.resolveVariant(options);
    this.applySway();
    this.hookValues = { ...(options.hooks?.values ?? {}) };
    // Its lighting takes the light cones per pixel.
    markLightConesCovered(this);
    this.fog = false;
    this.lights = false;
    this.applyDepthOnly();
    // The material's own vertex stage is `setupPosition`; this is only for
    // the depth passes that override it (see `casterPositionNode`).
    Object.defineProperty(this, "positionNode", {
      configurable: true,
      enumerable: true,
      get: () => this.casterPosition(),
      set: () => {},
    });
  }

  /**
   * The displacement a shadow pass draws this material's casters with:
   * the shared cutouts' sway table, or a block's fixed sway. A game hook
   * reads its own values off the material, which an override build cannot
   * reach, so a hooked material casts its rest shape.
   */
  private casterPosition(): Vec3Node | null {
    const { kind, sway, hooks, depthOnly } = this.variant;
    if (this.drawsGpuSections) {
      // A hooked material casts its rest shape (its hook reads the material,
      // which an override build cannot reach), as a section drawn otherwise.
      const casterKind = hooks?.displace ? "opaque" : kind;
      const hasSway = !hooks?.displace && sway !== null;
      const key = `${casterKind}|${hasSway ? "sway" : "-"}|${this.positionUnits}`;
      if (this._gpuCasterPosition?.key !== key) {
        this._gpuCasterPosition = {
          key,
          node: makeGpuSectionCasterPosition(
            this.shading,
            casterKind,
            hasSway,
            this.positionUnits,
          ),
        };
      }
      return this._gpuCasterPosition.node;
    }
    if (depthOnly || hooks?.displace) return null;
    if (kind !== "cutout" && !sway) return null;
    return casterPositionNode(
      this.shading,
      kind,
      sway !== null,
      this.positionUnits,
    );
  }

  /**
   * three refreshes a node material's per-object bindings on every draw; a
   * chunk mesh's are refreshed only when what they read changed (see
   * `narrowRefresh`), the largest share of a chunk draw's CPU cost.
   */
  override setupObserver(builder: NodeBuilder) {
    return narrowRefresh(
      super.setupObserver(builder) as unknown as Parameters<
        typeof narrowRefresh
      >[0],
    ) as unknown as ReturnType<NodeMaterial["setupObserver"]>;
  }

  private static resolveVariant(options: ChunkMaterialOptions) {
    return {
      kind: options.kind,
      sway: options.sway ? { ...DEFAULT_CHUNK_SWAY, ...options.sway } : null,
      hooks: options.hooks ?? null,
      depthOnly: options.depthOnly === true,
    };
  }

  /** The kind, sway and hooks the program is built for. */
  get chunkOptions(): Readonly<{
    kind: ChunkMaterialKind;
    sway: ChunkSwayConstants | null;
    hooks: ChunkShadingHooks | null;
    depthOnly: boolean;
  }> {
    return this.variant;
  }

  get kind(): ChunkMaterialKind {
    return this.variant.kind;
  }

  /**
   * Whether the program never reads the side it draws, so one program
   * serves every side: a three patched to honour it leaves the side out of
   * the program key, and the back and front passes of a double-sided
   * see-through draw share one build instead of building the same code
   * twice (unpatched three ignores it). The fluid surface reads
   * `frontFacing` (in air only its outward face draws), so a fluid's sides
   * are two programs. The patch throws if a material that says so reads its
   * side.
   */
  get isSideAgnosticProgram(): boolean {
    return this.variant.kind !== "fluid";
  }

  /**
   * Rebuild this material's program for another kind, sway or hooks (a
   * game customizing a block). Meshes keep the material; the next draw
   * picks up the new program.
   */
  setVariant(options: Partial<ChunkMaterialOptions>) {
    this.variant = ChunkMaterial.resolveVariant({
      kind: options.kind ?? this.variant.kind,
      sway: options.sway === undefined ? this.variant.sway : options.sway,
      hooks: options.hooks === undefined ? this.variant.hooks : options.hooks,
      depthOnly: options.depthOnly ?? this.variant.depthOnly,
    });
    if (options.hooks !== undefined) {
      this.hookValues = { ...(options.hooks?.values ?? {}) };
    }
    this.applySway();
    this.applyDepthOnly();
    this.needsUpdate = true;
  }

  private applySway() {
    const { sway } = this.variant;
    // A new vector, never one changed in place: a narrow refresh compares
    // the property by identity.
    this._swayMotion = sway
      ? new Vector4(
          sway.speed,
          sway.scale * sway.amplitude,
          sway.yScale,
          sway.rooted ? 1 : 0,
        )
      : new Vector4();
    this._swayCrossShading = sway?.isCrossShaded ? 1 : 0;
  }

  private applyDepthOnly() {
    this.fragmentNode = this.variant.depthOnly ? DEPTH_ONLY_COLOR : null;
    this.colorWrite = !this.variant.depthOnly;
  }

  /** The program this material compiles to: same key, same program. */
  get variantKey(): string {
    const { kind, sway, hooks, depthOnly } = this.chunkOptions;
    // The sway's values are read per draw (`FIXED_SWAY`): one program for
    // every sway.
    const swayKey = sway ? "sway" : "-";
    // A blended draw reads the accumulation's pass (`setupDiffuseColor`).
    const isBlended = this.transparent && !this.depthWrite;
    return `${kind}|${swayKey}|${hooks?.key ?? "-"}|${depthOnly ? "depth" : "color"}|${isBlended ? "blended" : "written"}`;
  }

  override customProgramCacheKey(): string {
    const cut = this.cutsSolidTexels ? ":cut" : "";
    return `chunk:${this.shading.id}:${this.variantKey}${cut}:${super.customProgramCacheKey()}`;
  }

  /**
   * A fork with this material's program and inputs and its own copies of
   * the per-material values (`forkChunkMaterial`).
   */
  fork(): ChunkMaterial {
    const own = new ChunkMaterial(this.shading, this.variant);
    own.copy(this);
    return own;
  }

  override copy(source: ChunkMaterial): this {
    // three's generic copy deep-copies any property with a `copy` method:
    // it would copy the source's texture into this material's (the shared
    // placeholder). The texture is a reference, set below.
    this.map = undefined as unknown as Texture;
    super.copy(source);
    this.map = source.map;
    this.surfaceResponse = source.surfaceResponse;
    this.surfaceOpenLight.copy(source.surfaceOpenLight);
    this.chunkReveal = source.chunkReveal;
    // A frame source is shared: a box's frame is worked out as it is read.
    this.greedyFrame = source.greedyFrame;
    this.hasGreedyFrame = source.hasGreedyFrame;
    this.waterDepthSide = source.waterDepthSide;
    this.positionUnits = source.positionUnits;
    this.hookValues = { ...source.hookValues };
    this._swayMotion = source._swayMotion.clone();
    this._swayCrossShading = source._swayCrossShading;
    // Its own node, made on first read: the source's reads the source's
    // bucket.
    this._gpuCasterPosition = null;
    this.cutsSolidTexels = source.cutsSolidTexels;
    this.solidTexelCut = source.solidTexelCut;
    // A GPU bucket's forks (its water's depth draws) read its sections too.
    this.drawsGpuSections = source.drawsGpuSections;
    return this;
  }

  // ── vertex ────────────────────────────────────────────────────────────

  override setupPosition(builder: NodeBuilder) {
    const { object } = builder as NodeBuilder & {
      object: BatchedMesh & InstancedMesh;
    };
    const { chunk, local, swayTable } = this.shading;
    const { kind, sway, hooks } = this.chunkOptions;
    const positionUnits = materialValue("positionUnits", "float");

    const vertex = chunkVertex(
      { ...chunk, emissiveLevels: local.grid.emissiveLevels },
      builder,
      {
        swayTable: kind === "cutout" ? swayTable : null,
        positionUnits,
      },
    );

    // three's own transforms first: the section's place in a region arena,
    // an instance's matrix.
    if (object.isBatchedMesh) batch(object);
    const gpuSection = this.drawsGpuSections ? gpuSectionOf(object) : null;
    if (gpuSection) {
      positionLocal.assign(
        positionLocal.div(positionUnits).add(gpuSection.origin),
      );
    }
    if (
      object.isInstancedMesh &&
      object.instanceMatrix?.isInstancedBufferAttribute
    ) {
      instancedMesh(object);
    }

    vertex.displace({
      sway: sway ? FIXED_SWAY : null,
      waveScale: hooks?.wave ?? null,
      hook: hooks?.displace ?? null,
    });

    const batchReveal = gpuSection
      ? gpuSection.reveal
      : object.isBatchedMesh &&
          (object as unknown as { _colorsTexture: unknown })._colorsTexture
        ? batchColor.x
        : float(1);
    vertex.assign(vChunk, vChunkUv, batchReveal);
    return positionLocal;
  }

  // ── fragment ──────────────────────────────────────────────────────────

  override setupDiffuseColor(builder: NodeBuilder) {
    const { chunk } = this.shading;
    const { kind, hooks } = this.chunkOptions;
    const v = readVaryings();
    const weather = surfaceWeather(chunk);

    // A blended pane draws twice, once on each side of the water, and each
    // draw drops what the other one owns. Compared as distances along the
    // view, so the bias stays a block-scale constant far off.
    if (kind === "seeThrough") {
      const side = materialValue("waterDepthSide", "float");
      If(side.greaterThan(0.5), () => {
        const waterDepthAt = select(
          chunk.waterDepthState.greaterThan(1.5),
          chunk.waterDepth.sample(
            screenCoordinate.div(max(chunk.waterDepthViewport, vec2(1))),
          ).r,
          select(chunk.waterDepthState.greaterThan(0.5), float(1), float(0)),
        );
        const waterZ = perspectiveDepthToViewZ(
          waterDepthAt,
          chunk.waterDepthClip.x,
          chunk.waterDepthClip.y,
        );
        const isBehindWater = v.viewDepth.greaterThan(
          waterZ.add(WATER_DEPTH_BIAS_BLOCKS),
        );
        If(isBehindWater.xor(side.lessThan(1.5)), () => {
          Discard();
        });
      });
    }

    // The seam with the far layer: over the outer half chunk of the loaded
    // area this fragment yields to the far layer by an ordered dither.
    // Fluids keep drawing; the far water plane lies under them anyway.
    if (kind !== "fluid") {
      If(farSeam(chunk).chunkYields(v.worldPosition.xz), () => {
        Discard();
      });
    }

    // The atlas uv. A greedy quad wraps its uv once per block, so its
    // texels come from where the face is drawn (a voxel box's own frame).
    const atlasSize = chunk.atlasSize;
    const cellSize = float(1).div(atlasSize);
    const padding = cellSize.div(4);
    const hasFrame = materialValue("hasGreedyFrame", "float").greaterThan(0.5);
    // Read through the source's `value` each draw (a voxel box's frame is
    // worked out from its group's matrix as it is read).
    const frame = materialValue("greedyFrame.value", "mat4");
    const greedyPosition = select(
      hasFrame,
      frame.mul(vec4(v.worldPosition, 1)).xyz,
      v.worldPosition,
    );
    const greedyNormal = select(
      hasFrame,
      normalize(mat3(frame).mul(v.worldNormal)),
      v.worldNormal,
    );
    const innerMin = floor(v.mapUv.div(cellSize)).mul(cellSize).add(padding);
    const innerSize = cellSize.sub(padding.mul(2));
    const isGreedy = v.isGreedy.greaterThan(0.5);
    const finalUv = select(
      isGreedy,
      innerMin.add(
        greedyFaceUv(greedyNormal, greedyPosition.fract()).mul(innerSize),
      ),
      v.mapUv,
    );
    // The mip gradients follow the face's unwrapped coordinates: implicit
    // derivatives across a greedy quad's per-block wrap picked the smallest
    // mip along every block edge inside it.
    const seamlessUv = select(
      isGreedy,
      innerMin.add(greedyFaceUv(greedyNormal, greedyPosition).mul(innerSize)),
      v.mapUv,
    );
    // Capped at half the tile, anisotropic taps along a grazing view stay
    // inside the tile and its margin at every mip.
    const tile = float(0.5).div(atlasSize);
    const cap = (d: Vec2Node) =>
      d.mul(min(1, tile.mul(0.5).div(max(length(d), 1e-8))));
    const uvDx = cap(dFdx(seamlessUv)).toVar();
    const uvDy = cap(dFdy(seamlessUv)).toVar();

    // The surface weather's footprint, in uniform control flow.
    const weatherFootprint = max(
      length(dFdx(v.worldPosition)),
      length(dFdy(v.worldPosition)),
    ).toVar();
    const water =
      kind === "fluid"
        ? waterSurface({
            chunk,
            lighting: this.shading.lighting,
            sky: skyFog({
              ...chunk,
              directSunlight: this.shading.lighting.directSunlight,
            }),
            weather,
            local: localLightShading(this.shading.local, chunk),
          }).prepare(v)
        : null;

    let sampleUv: Vec2Node = finalUv;
    let sampleDx: Vec2Node = uvDx;
    let sampleDy: Vec2Node = uvDy;
    if (hooks?.sampleUv) {
      sampleUv = hooks.sampleUv(finalUv, { v, uniforms: this.shading }).toVar();
      sampleDx = cap(dFdx(sampleUv));
      sampleDy = cap(dFdy(sampleUv));
    }
    // A chunk material can be built before its atlas is painted: the
    // placeholder stands in until the material being drawn has a map.
    const sampled = materialTexture("color", this, "map")
      .sample(sampleUv)
      .grad(sampleDx, sampleDy)
      .toVar("chunkTexel");

    const albedo = sampled.rgb.toVar("chunkAlbedo");
    If(chunk.showGreedyDebug.greaterThan(0.5), () => {
      albedo.assign(
        mix(albedo, select(isGreedy, vec3(0, 1, 0), vec3(1, 0, 0)), 0.4),
      );
    });
    albedo.mulAssign(v.stageTint);

    // The weather the ground holds: wet ground reads darker.
    const rainHere = float(0).toVar();
    if (kind !== "fluid") {
      const response = materialValue("surfaceResponse", "float");
      const openLight = materialValue("surfaceOpenLight", "vec2");
      If(weather.isActive.and(response.greaterThan(0)), () => {
        const light = bilinearVoxelLight(v);
        const gate = v.isFluid
          .oneMinus()
          .mul(v.isWaterExposed.oneMinus())
          .mul(select(v.emissive.greaterThan(0), 0, 1));
        const open = smoothstep(openLight.x, openLight.y, light.w).mul(gate);
        If(open.greaterThan(0), () => {
          const texelCentre = floor(v.worldPosition.xz.mul(16))
            .add(0.5)
            .div(16);
          const sample = weather.sample(texelCentre);
          const below = weather
            .above(texelCentre, v.worldPosition.y, sample.a)
            .oneMinus();
          const up = smoothstep(0.55, 0.9, v.worldNormal.y);
          const wet = clamp(sample.y.mul(chunk.surfaceWeather.y), 0, 1)
            .mul(below)
            .mul(open)
            .mul(weather.faceWet(v.worldNormal))
            .mul(response);
          If(wet.greaterThan(0), () => {
            albedo.assign(weather.wetAlbedo(albedo, wet));
          });
          rainHere.assign(
            clamp(chunk.surfaceWeather.x, 0, 1).mul(below).mul(open).mul(up),
          );
        });
      });
    }

    diffuseColor.assign(vec4(albedo, sampled.a));
    // The alpha test, on the texture's own alpha.
    let isKept: FloatNode | null = null;
    const blended =
      this.transparent && !this.depthWrite ? this.shading.blended : null;
    if (this.alphaTest > 0 || this.cutsSolidTexels || blended) {
      const kept = float(1).toVar("isKeptTexel");
      if (blended) {
        // The accumulation's own test (it discards after the shading), made
        // here first: the side this pass does not keep lights nothing.
        If(blended.phase.greaterThan(0.5), () => {
          const separator = blended.separatorDepth
            .sample(screenUV)
            .level(float(0)).r;
          const isBehind = v.viewDepth.greaterThan(
            perspectiveDepthToViewZ(separator, cameraNear, cameraFar).add(
              blended.separatorBias,
            ),
          );
          const keepsBehind = blended.phase.lessThan(1.5);
          kept.assign(select(isBehind.xor(keepsBehind), float(0), kept));
        });
      }
      if (this.alphaTest > 0) {
        const isHole = diffuseColor.a.lessThan(materialAlphaTest);
        isHole.discard();
        kept.assign(select(isHole, float(0), kept));
      }
      if (this.cutsSolidTexels) {
        const isSolid = diffuseColor.a.greaterThanEqual(
          materialValue("solidTexelCut", "float"),
        );
        isSolid.discard();
        kept.assign(select(isSolid, float(0), kept));
      }
      isKept = kept;
    }
    if ((builder as NodeBuilder & { isOpaque(): boolean }).isOpaque()) {
      diffuseColor.a.assign(1);
    }

    this._fragmentState = {
      v,
      sampled,
      isKept,
      weatherRainHere: rainHere,
      weatherFootprint,
      water,
    };
  }

  override setupLighting(/* builder */) {
    const state = this._fragmentState!;
    const { v } = state;
    const { chunk: c, lighting: l, cones } = this.shading;
    const { kind, sway, hooks } = this.chunkOptions;
    const local = localLightShading(this.shading.local, c);
    const coneShading = lightConeShading(cones);
    const weather = surfaceWeather(c);
    const prepared = hooks?.prepare?.({ v, uniforms: this.shading });

    const crossShading =
      kind === "cutout"
        ? v.crossShading
        : sway
          ? FIXED_SWAY.crossShading
          : float(0);
    const voxelLight = bilinearVoxelLight(v).toVar("voxelLight");
    const sunExposure = voxelLight.w;
    const normal = v.worldNormal;

    // A texel the alpha test dropped takes none of the heavy steps: the
    // cascade taps here, the clustered lights below (`FragmentState.isKept`).
    const isKept = state.isKept ? state.isKept.greaterThan(0.5) : null;
    const shadowNdotL = mix(dot(normal, l.sunDirection), 0.5, crossShading);
    const sunShadowHere = () =>
      sunShadow(l)({
        worldPosition: v.worldPosition,
        normal,
        viewDepth: v.viewDepth,
        sunExposure,
        ndotl: shadowNdotL,
        options: { isFast: kind === "seeThrough" || kind === "fluid" },
      });
    const shadow = float(1).toVar("sunShadow");
    if (isKept) {
      If(isKept, () => {
        shadow.assign(sunShadowHere());
      });
    } else {
      shadow.assign(sunShadowHere());
    }

    const rawNdotL = dot(normal, l.sunDirection);
    const ndotl = max(rawNdotL.mul(0.85).add(0.15), 0);
    const sunContribution = l.sunColor
      .mul(ndotl)
      .mul(shadow)
      .mul(c.sunlightIntensity)
      .mul(sunExposure)
      .toVar();

    // Flood level to light: a geometric per-level decay that keeps a
    // coloured light's hue while its channels are alive. A lamp's ceiling
    // keeps ceilingWeight of it: the flood has no direction.
    const ceiling = mix(
      1,
      BLOCK_LIGHT_TRANSFER.ceilingWeight,
      max(normal.y.negate(), 0),
    );
    const cpuTorch = voxelLight.xyz;
    const smoothTorch = blockLightCurveNode(cpuTorch).mul(ceiling).toVar();

    // Analytic ownership of block light: where clustered lights claim this
    // fragment, the baked flood yields (floodRemainder -> 0) and the
    // per-pixel model is the visible block light, so nothing double-lights.
    const cluster = local.surface(
      v.worldPosition,
      normal,
      cpuTorch,
      kind === "fluid" ? 0 : 8,
      true,
      isKept,
    );
    const clusterLight = vec3(cluster.total).toVar("clusterLight");
    const floodRemainder = cluster.floodRemainder;
    If(
      max(
        max(cluster.lightHue.x, cluster.lightHue.y),
        cluster.lightHue.z,
      ).greaterThan(0),
      () => {
        // Where the cell holds analytic lights, the flood keeps their hue in
        // the channels it has run out of, so a lamp's pool ends amber.
        smoothTorch.assign(
          blockLightCurveFilledNode(cpuTorch, cluster.lightHue).mul(ceiling),
        );
      },
    );
    // Daylight washes analytic block light, in proportion to the sun the
    // fragment lacks; the washed share hands back to the flood.
    const sunWash = clamp(
      sunExposure.mul(c.sunlightIntensity),
      0,
      1,
    ).oneMinus();
    clusterLight.mulAssign(sunWash.mul(ceiling));
    floodRemainder.assign(mix(1, floodRemainder, sunWash));

    const torchBrightness = max(
      max(max(smoothTorch.x, smoothTorch.y), smoothTorch.z).mul(floodRemainder),
      min(max(max(clusterLight.x, clusterLight.y), clusterLight.z), 1),
    );
    const torchLight = smoothTorch.mul(floodRemainder.mul(BLOCK_LIGHT_GAIN));

    const ambientFloor = max(c.minLightLevel.add(c.baseAmbient), 0);
    const sunVisibility = clamp(sunExposure, 0, 1);
    const downTransmit = vec3(1).toVar();
    const underwaterFill = vec3(0).toVar();
    const underwaterCaustic = float(0).toVar();
    // Seen from under water, terrain is lit by what the column above it lets
    // down, measured from the surface of the water the camera is in. Only a
    // face that touches water is under it.
    If(
      c.cameraSubmersion
        .greaterThan(0.001)
        .and(v.worldPosition.y.lessThan(c.cameraWaterPlaneY)),
      () => {
        const depth = c.cameraWaterPlaneY.sub(v.worldPosition.y);
        const shade = c.cameraSubmersion.mul(max(v.isWaterExposed, v.isFluid));
        downTransmit.assign(
          mix(vec3(1), exp(DOWNWELLING.negate().mul(depth)), shade),
        );
        underwaterFill.assign(
          SCATTER_COLOR.mul(
            c.sunlightIntensity
              .mul(W.scatterFillSunStrength)
              .add(W.scatterFillBase),
          )
            .mul(downTransmit)
            .mul(shade),
        );
        // The caustic net on the bed, projected down the sun so walls and
        // floors share one pattern, at the centre of the 1/16 texel.
        const texel = floor(v.worldPosition.mul(16).add(normal.mul(0.5)))
          .add(0.5)
          .div(16);
        const position = texel.xz.sub(
          l.sunDirection.xz
            .div(max(l.sunDirection.y, 0.3))
            .mul(texel.y.sub(c.cameraWaterPlaneY)),
        );
        underwaterCaustic.assign(
          waterCausticWeb(position, c.time.mul(0.001))
            .mul(exp(depth.mul(-W.bedCausticDepthFalloff)))
            .mul(shade)
            .mul(v.isFluid.oneMinus()),
        );
      },
    );
    const globalAmbient = vec3(0.025, 0.03, 0.04)
      .mul(sunVisibility)
      .add(l.ambientColor.mul(ambientFloor))
      .mul(downTransmit);

    const ambientOcclusion = mix(0.72, 1, shadow);
    const tunnelDarkening = mix(ambientFloor, 1, sunVisibility);
    const skyAmbient = mix(
      l.ambientColor.mul(0.4),
      l.ambientColor,
      normal.y.mul(0.5).add(0.5),
    );

    const albedo = diffuseColor.rgb;
    const texLuma = luminance709(albedo);
    const isBrightTex = smoothstep(0.75, 0.95, texLuma);

    const aoFactor = mix(v.ao, 1, v.isFluid.mul(0.8));
    const torchDominance = torchBrightness.div(
      torchBrightness
        .add(dot(sunContribution, vec3(0.33)))
        .add(BLOCK_LIGHT_TRANSFER.dominanceKnee),
    );
    const enhancedAO = mix(aoFactor, 1, torchDominance.mul(0.03));

    // A constant per-axis face shade keeps a cube's faces distinct in flat
    // light (x = +-X, y = +-Z, z = -Y, w = +Y); cross plants take none.
    const absNormal = abs(normal);
    const weights = absNormal.div(
      max(absNormal.x.add(absNormal.y).add(absNormal.z), 0.0001),
    );
    const verticalShade = select(
      normal.y.greaterThan(0),
      c.faceShades.w,
      c.faceShades.z,
    );
    const faceShade = mix(
      weights.x
        .mul(c.faceShades.x)
        .add(weights.z.mul(c.faceShades.y))
        .add(weights.y.mul(verticalShade)),
      1,
      crossShading,
    );

    const sunTotal = skyAmbient
      .mul(ambientOcclusion)
      .mul(
        shadeSkyTint(l.skyTopColor, c.sunlightIntensity, shadow, sunExposure),
      )
      .mul(tunnelDarkening)
      .mul(downTransmit)
      .add(sunContribution.mul(mix(1, 0.7, isBrightTex)).mul(downTransmit))
      .add(
        l.ambientColor
          .mul(0.04)
          .mul(shadow.oneMinus())
          .mul(sunExposure)
          .mul(c.sunlightIntensity)
          .mul(downTransmit),
      )
      .add(globalAmbient)
      .add(underwaterFill)
      // Room fill: the lamps the camera sees lift sky-less surfaces past
      // their flood's reach, like bounce light.
      .add(local.roomFill(v.worldPosition, normal, sunExposure, cpuTorch))
      .toVar("sunTotal");

    const screen = (a: Vec3Node, b: Vec3Node) =>
      a.oneMinus().mul(b.oneMinus()).oneMinus();
    const totalLight = screen(sunTotal, torchLight).toVar("totalLight");
    // Dynamic cones (flashlight, headlights) screen-blend in like torch
    // light, with their own water extinction.
    totalLight.assign(
      screen(totalLight, coneShading.surface(v.worldPosition, normal)),
    );
    // The zero-light guard is exactness: blending a zero cluster would
    // still perturb totalLight by an ulp.
    If(local.clusteredCount.greaterThan(0), () => {
      totalLight.assign(screen(totalLight, clusterLight));
    });

    // Lamplight white balance, then a warm push that fades toward white
    // with the flood light's saturation (a saturated emitter keeps its hue).
    totalLight.assign(blockLightAdaptNode(totalLight, torchDominance));
    const torchPeak = max(max(torchLight.x, torchLight.y), torchLight.z);
    const torchSaturation = select(
      torchPeak.greaterThan(0),
      min(min(torchLight.x, torchLight.y), torchLight.z)
        .div(max(torchPeak, 1e-8))
        .oneMinus(),
      0,
    );
    const warmTint = mix(
      vec3(...BLOCK_LIGHT_WARM_TINT),
      vec3(1),
      torchSaturation,
    );
    totalLight.mulAssign(mix(vec3(1), warmTint, torchDominance));
    totalLight.mulAssign(enhancedAO);
    totalLight.mulAssign(faceShade);

    // Block-lit fragments keep their light's hue through the tone map,
    // rescaled to the per-channel fit's luminance and lifted to the lamp's
    // white point; daylight keeps the per-channel fit exactly.
    const toneMapPeak = max(max(totalLight.x, totalLight.y), totalLight.z);
    const toneMapHue = totalLight.mul(
      acesFitNode(toneMapPeak).div(max(toneMapPeak, 1e-4)),
    );
    const fitted = acesFitNode(totalLight).toVar();
    const hueMatched = toneMapHue.mul(
      luminance709(fitted).div(max(luminance709(toneMapHue), 1e-4)),
    );
    totalLight.assign(
      mix(
        fitted,
        hueMatched.mul(BLOCK_LIGHT_TRANSFER.lampWhite),
        torchDominance,
      ),
    );

    // The darkness floor: no light at all, only a minimum to see by. It
    // warms with the lamp that takes the fragment over, and out of the sky
    // it carries albedo only up to a cap and keeps the vertex occlusion.
    const darknessFloor = mix(
      vec3(ambientFloor)
        .mul(mix(vec3(0.8, 0.88, 1), vec3(1), sunVisibility))
        .mul(downTransmit),
      vec3(ambientFloor).mul(warmTint).mul(downTransmit),
      clamp(torchDominance.mul(3), 0, 1),
    ).mul(
      mix(
        min(1, float(0.3).div(max(texLuma, 1e-4))).mul(mix(1, enhancedAO, 0.8)),
        1,
        sunVisibility,
      ),
    );
    totalLight.assign(max(totalLight, darknessFloor.mul(faceShade)));

    // An emissive face is its own light source: it bypasses the lighting
    // model and renders the texture at its declared strength.
    const lit = vec3(0).toVar("chunkLit");
    If(v.emissive.greaterThan(0), () => {
      lit.assign(albedo.mul(v.emissive));
    }).Else(() => {
      lit.assign(
        hooks?.lit
          ? hooks.lit({
              v,
              sampled: state.sampled,
              albedo,
              totalLight,
              sunTotal,
              uniforms: this.shading,
              prepared,
            })
          : albedo.mul(totalLight),
      );
    });

    // Bed caustics ride the lit colour, gated by the direct sun reaching
    // the face and by the beam the sky lets through.
    If(underwaterCaustic.greaterThan(0), () => {
      const causticSun = smoothstep(
        0.02,
        0.2,
        dot(sunContribution.mul(downTransmit), vec3(0.3333)),
      ).mul(l.directSunlight);
      lit.mulAssign(
        underwaterCaustic
          .mul(causticSun)
          .mul(l.bedCausticScale)
          .mul(W.bedCausticStrength)
          .add(1),
      );
    });

    // The rain's pocks on open ground: light the sky puts there.
    if (kind !== "fluid") {
      If(state.weatherRainHere.greaterThan(0), () => {
        const texel = floor(v.worldPosition.xz.mul(16));
        const seconds = c.time.mul(0.001);
        const texelPixels = float(1 / 16).div(
          max(state.weatherFootprint, 1e-5),
        );
        const near = smoothstep(0.8, 2.0, texelPixels);
        const chance = state.weatherRainHere.mul(0.6);
        const pock = mix(
          float(weather.pockMean).mul(chance),
          weather.pock(texel, seconds, chance),
          near,
        );
        lit.addAssign(
          pock.mul(
            mix(c.skyFogMiddleColor, c.skyFogTopColor, 0.5)
              .mul(0.35)
              .add(lit.mul(0.35)),
          ),
        );
      });
    }

    let outgoing: Vec3Node = lit;
    if (kind === "fluid" && state.water) {
      const sky = skyFog({ ...c, directSunlight: l.directSunlight });
      const water = waterSurface({
        chunk: c,
        lighting: l,
        sky,
        weather,
        local,
      });
      const surface = water.shade(
        {
          v,
          lit,
          alpha: diffuseColor.a,
          totalLight,
          shadow,
          sunExposure,
          voxelLight,
        },
        state.water,
      );
      diffuseColor.a.assign(surface.alpha);
      outgoing = surface.color;
    }

    this._lightingState = {
      shadow,
      sunExposure,
      tunnelDarkening,
      voxelLight,
      clusterLight,
      floodRemainder,
      rawNdotL,
    };
    return outgoing;
  }

  private _lightingState: {
    shadow: FloatNode;
    sunExposure: FloatNode;
    tunnelDarkening: FloatNode;
    voxelLight: Vec4Node;
    clusterLight: Vec3Node;
    floodRemainder: FloatNode;
    rawNdotL: FloatNode;
  } | null = null;

  override setupOutput(builder: NodeBuilder, outputNode: Vec4Node) {
    if (this.variant.depthOnly) return outputNode;
    const state = this._fragmentState!;
    const lighting = this._lightingState!;
    const { v } = state;
    const { chunk: c, lighting: l, cones } = this.shading;
    const sky = skyFog({ ...c, directSunlight: l.directSunlight });
    const coneShading = lightConeShading(cones);
    const local = localLightShading(this.shading.local, c);

    // Chunk fog reveals through both channels at once: the material's
    // value (a plain mesh) and the section's batching colour (an arena).
    const reveal = materialValue("chunkReveal", "float").mul(v.chunkReveal);
    const fogged = sky.apply(outputNode.rgb, v.worldPosition, reveal);
    const color = coneShading
      .applyScatter(fogged, v.worldPosition)
      .toVar("chunkColor");

    If(l.shadowDebugMode.greaterThan(0.5), () => {
      const mode = l.shadowDebugMode;
      If(mode.lessThan(1.5), () => {
        color.assign(vec3(lighting.shadow));
      })
        .ElseIf(mode.lessThan(2.5), () => {
          color.assign(vec3(max(lighting.rawNdotL, 0)));
        })
        .ElseIf(mode.lessThan(3.5), () => {
          color.assign(vec3(v.ao));
        })
        .ElseIf(mode.lessThan(4.5), () => {
          color.assign(
            select(
              v.viewDepth.lessThan(l.cascadeSplit0),
              vec3(1, 0, 0),
              select(
                v.viewDepth.lessThan(l.cascadeSplit1),
                vec3(0, 1, 0),
                select(
                  v.viewDepth.lessThan(l.cascadeSplit2),
                  vec3(0, 0, 1),
                  vec3(1, 1, 0),
                ),
              ),
            ),
          );
        })
        .ElseIf(mode.lessThan(5.5), () => {
          color.assign(
            vec3(max(lighting.rawNdotL.oneMinus().mul(0.005), 0.001).mul(100)),
          );
        })
        .ElseIf(mode.lessThan(6.5), () => {
          color.assign(vec3(lighting.sunExposure));
        })
        .ElseIf(mode.lessThan(7.5), () => {
          color.assign(vec3(lighting.tunnelDarkening));
        });
    });
    If(local.isDebugging, () => {
      color.assign(
        local.debugColor(
          v.worldPosition,
          color,
          v.worldNormal,
          lighting.voxelLight.xyz,
          lighting.clusterLight,
          lighting.floodRemainder,
        ),
      );
    });

    return super.setupOutput(builder, vec4(color, outputNode.a));
  }
}

const DOWNWELLING = vec3(
  W.downwellingExtinction.red,
  W.downwellingExtinction.green,
  W.downwellingExtinction.blue,
);

const SCATTER_COLOR = vec3(
  WATER_SURFACE_SCATTER_COLOR.r,
  WATER_SURFACE_SCATTER_COLOR.g,
  WATER_SURFACE_SCATTER_COLOR.b,
);

/**
 * The voxel light (red, green, blue, sun; 0..1) blended bilinearly across
 * the quad instead of linearly across each of its triangles (quad-light.ts).
 */
function bilinearVoxelLight(v: ChunkVaryings): Vec4Node {
  return max(v.light.sub(v.lightTwist.mul(v.quadLightTail)), 0);
}

export function isChunkMaterial(material: unknown): material is ChunkMaterial {
  return (material as ChunkMaterial | null)?.isChunkMaterial === true;
}
