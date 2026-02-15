import { EventEmitter } from "events";

import { AABB } from "@voxelize/aabb";
import { Engine as PhysicsEngine } from "@voxelize/physics-engine";
import {
  EntityOperation,
  EntityProtocol,
  GeometryProtocol,
  MeshProtocol,
  MessageProtocol,
  UpdateProtocol,
} from "@voxelize/protocol";
import { raycast } from "@voxelize/raycast";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Camera,
  CanvasTexture,
  Clock,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SRGBColorSpace,
  Scene,
  ShaderLib,
  ShaderMaterial,
  Sphere,
  Texture,
  MathUtils as ThreeMathUtils,
  Uniform,
  UniformsUtils,
  Vector3,
  WebGLRenderer,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import {
  TRANSPARENT_FLUID_RENDER_ORDER,
  TRANSPARENT_RENDER_ORDER,
} from "../../common";
import { NetIntercept } from "../../core/network";
import {
  prepareTransparentMesh,
  sortTransparentMeshOnBeforeRender,
} from "../../core/transparent-sorter";
import { WorkerPool } from "../../libs";
import { setWorkerInterval } from "../../libs/setWorkerInterval";
import { Coords2, Coords3, JsonValue } from "../../types";
import {
  BLUE_LIGHT,
  BlockUtils,
  ChunkUtils,
  GREEN_LIGHT,
  LightColor,
  LightUtils,
  RED_LIGHT,
  SUNLIGHT,
  ThreeUtils,
  findSimilar,
  formatSuggestion,
} from "../../utils";

function computeNormalsFromBuffers(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>
): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;
    const e1x = positions[ib] - positions[ia];
    const e1y = positions[ib + 1] - positions[ia + 1];
    const e1z = positions[ib + 2] - positions[ia + 2];
    const e2x = positions[ic] - positions[ia];
    const e2y = positions[ic + 1] - positions[ia + 1];
    const e2z = positions[ic + 2] - positions[ia + 2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }
    normals[ia] = nx;
    normals[ia + 1] = ny;
    normals[ia + 2] = nz;
    normals[ib] = nx;
    normals[ib + 1] = ny;
    normals[ib + 2] = nz;
    normals[ic] = nx;
    normals[ic + 1] = ny;
    normals[ic + 2] = nz;
  }
  return normals;
}

function computeFlatNormals(geometry: BufferGeometry) {
  const pos = (geometry.getAttribute("position") as BufferAttribute).array;
  const idx = geometry.getIndex();
  if (!idx || idx.count < 3) return;
  geometry.setAttribute(
    "normal",
    new BufferAttribute(computeNormalsFromBuffers(pos, idx.array), 3)
  );
}

import {
  Block,
  BlockDynamicPattern,
  BlockRotation,
  BlockUpdate,
  BlockUpdateWithSource,
  PY_ROTATION,
} from "./block";
import { Chunk } from "./chunk";
import { ChunkRenderer } from "./chunk-renderer";
import { Clouds, CloudsOptions } from "./clouds";
import { CSMRenderer } from "./csm-renderer";
import { ItemDef, ItemRegistry } from "./items";
import { LightSourceRegistry } from "./light-registry";
import { LightVolume } from "./light-volume";
import { Loader } from "./loader";
import {
  ChunkPipeline,
  MESH_JOB_ACCEPTED,
  MESH_JOB_NEEDS_REMESH,
  MeshPipeline,
} from "./pipelines";
import { Registry } from "./registry";
import {
  DEFAULT_CHUNK_SHADERS,
  SHADER_LIGHTING_CHUNK_SHADERS,
} from "./shaders";
import { Sky, SkyOptions } from "./sky";
import { AtlasTexture } from "./textures";
import { UV } from "./uv";
import LightWorker from "./workers/light-worker.ts?worker&inline";
import MeshWorker from "./workers/mesh-worker.ts?worker";

export * from "./block";
export * from "./chunk";
export * from "./chunk-renderer";
export * from "./clouds";
export * from "./csm-renderer";
export * from "./entity-shadow-uniforms";
export * from "./items";
export * from "./light-registry";
export * from "./light-volume";
export * from "./loader";
export * from "./pipelines";
export * from "./registry";
export * from "./shaders";
export * from "./shadow-sampling";
export * from "./sky";
export * from "./textures";
export * from "./uv";

export type TextureInfo = {
  blockId: number;
  blockName: string;
  faceName: string;
  type: "shared" | "independent" | "isolated";
  canvas: HTMLCanvasElement | null;
  range: UV | null;
  materialKey: string;
};

export type ChunkMeshEventData = {
  chunk: Chunk;
  coords: Coords2;
  level: number;
  meshes: Mesh[];
};

export type ChunkEventData = {
  chunk: Chunk;
  coords: Coords2;
  allMeshes: Map<number, Mesh[]>;
};

export type ChunkUpdateReason = "voxel" | "light";

export type ChunkMeshUpdateEventData = ChunkMeshEventData & {
  reason: ChunkUpdateReason;
};

export type ChunkUpdateEventData = ChunkEventData & {
  reason: ChunkUpdateReason;
};

export type ChunkDataEventData = {
  chunk: Chunk;
  coords: Coords2;
};

export type WorldChunkEvents = {
  "chunk-data-loaded": (data: ChunkDataEventData) => void;
  "chunk-mesh-loaded": (data: ChunkMeshEventData) => void;
  "chunk-mesh-unloaded": (data: ChunkMeshEventData) => void;
  "chunk-mesh-updated": (data: ChunkMeshUpdateEventData) => void;
  "chunk-loaded": (data: ChunkEventData) => void;
  "chunk-unloaded": (data: ChunkEventData) => void;
  "chunk-updated": (data: ChunkUpdateEventData) => void;
};

export type LightNode = {
  voxel: Coords3;
  level: number;
};

export type BlockUpdateListener = (args: {
  oldValue: number;
  newValue: number;
  voxel: Coords3;
}) => void;

export type BlockEntityUpdateData<T> = {
  id: string;
  voxel: Coords3;
  etype: string;
  operation: EntityOperation;
  oldValue: T | null;
  newValue: T | null;
};

export type BlockEntityUpdateListener<T> = (
  args: BlockEntityUpdateData<T>
) => void;

export type VoxelDelta = {
  coords: Coords3;
  oldVoxel: number;
  newVoxel: number;
  oldRotation?: BlockRotation;
  newRotation?: BlockRotation;
  oldStage?: number;
  newStage?: number;
  timestamp: number;
  sequenceId: number;
};

export type BoundingBox = {
  min: Coords3;
  shape: Coords3;
};

export type LightJob = {
  jobId: string;
  color: LightColor;
  lightOps: {
    removals: Coords3[];
    floods: LightNode[];
  };
  boundingBox: BoundingBox;
  startSequenceId: number;
  retryCount: number;
  batchId: number;
};

export type LightBatchResult = {
  color: LightColor;
  modifiedChunks: { coords: Coords2; lights: Uint32Array }[];
  boundingBox: BoundingBox;
};

export type LightBatch = {
  batchId: number;
  startSequenceId: number;
  totalJobs: number;
  completedJobs: number;
  results: LightBatchResult[];
};

type ChunkLightColorResults = {
  coords: Coords2;
  sunlight?: Uint32Array;
  red?: Uint32Array;
  green?: Uint32Array;
  blue?: Uint32Array;
  colorCount: number;
  firstColor: LightColor;
  firstLights: Uint32Array;
};

export type LightOperations = {
  removals: {
    sunlight: Coords3[];
    red: Coords3[];
    green: Coords3[];
    blue: Coords3[];
  };
  floods: {
    sunlight: LightNode[];
    red: LightNode[];
    green: LightNode[];
    blue: LightNode[];
  };
  hasOperations: boolean;
};

export type ProcessedUpdate = {
  vx: number;
  vy: number;
  vz: number;
  oldId: number;
  newId: number;
  oldBlock: Block;
  newBlock: Block;
  oldRotation: BlockRotation;
  newRotation: BlockRotation;
  oldStage: number;
  stage: number;
};

export type LightWorkerResult = {
  jobId: string;
  modifiedChunks: {
    coords: Coords2;
    lights: Uint32Array;
  }[];
  appliedDeltas: {
    lastSequenceId: number;
  };
};

const VOXEL_NEIGHBORS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, 1, 0],
  [0, -1, 0],
];

type LightOpsChannel = keyof LightOperations["removals"];
const LIGHT_COLOR_CHANNELS: ReadonlyArray<{
  color: LightColor;
  channel: LightOpsChannel;
}> = [
  { color: "SUNLIGHT", channel: "sunlight" },
  { color: "RED", channel: "red" },
  { color: "GREEN", channel: "green" },
  { color: "BLUE", channel: "blue" },
];

const CHUNK_NEIGHBOR_OFFSETS: Coords2[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [0, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

const ZERO_DIRECTION: [number, number] = [0, 0];
const ZERO_VECTOR3 = new Vector3(0, 0, 0);
const ZERO_BLOCK_ROTATION = new BlockRotation();
const EMPTY_BLOCK_UPDATES: BlockUpdate[] = [];
const EMPTY_AABBS: AABB[] = [];
const NULL_GEOMETRY_RESULT = () => null;

/**
 * Custom shader material for chunks, simply a `ShaderMaterial` from ThreeJS with a map texture. Keep in mind that
 * if you want to change its map, you also have to change its `uniforms.map`.
 */
export type CustomChunkShaderMaterial = ShaderMaterial & {
  /**
   * The texture that this map runs on.
   */
  map: Texture;
};

/**
 * The client-side options to create a world. These are client-side only and can be customized to specific use.
 */
export type WorldClientOptions = {
  /**
   * The maximum chunk requests this world can request from the server per world update. Defaults to `12` chunks.
   */
  maxChunkRequestsPerUpdate: number;

  /**
   * The maximum amount of chunks received from the server that can be processed per world update.
   * By process, it means to be turned into a `Chunk` instance. Defaults to `8` chunks.
   */
  maxProcessesPerUpdate: number;

  /**
   * The maximum voxel updates that can be sent to the server per world update. Defaults to `1000` updates.
   */
  maxUpdatesPerUpdate: number;

  maxMeshesPerUpdate: number;

  /**
   * Whether to use client-only meshing. When true, chunks are always meshed locally.
   * When false, server-provided meshes are used for initial chunk load.
   * Defaults to `true`.
   */
  clientOnlyMeshing: boolean;

  /**
   * The minimum light level even when sunlight and torch light levels are at zero. Defaults to `0.04`.
   */
  minLightLevel: number;

  /**
   * The fraction of the day that sunlight starts to appear. Defaults to `0.25`.
   */
  sunlightStartTimeFrac: number;

  /**
   * The fraction of the day that sunlight starts to disappear. Defaults to `0.7`.
   */
  sunlightEndTimeFrac: number;

  /**
   * The fraction of the day that sunlight takes to change from appearing to disappearing
   * or disappearing to appearing. Defaults to `0.1`.
   */
  sunlightChangeSpan: number;

  /**
   * The interval between each time a chunk is re-requested to the server. Defaults to `300` updates.
   */
  chunkRerequestInterval: number;

  /**
   * The default render radius of the world, in chunks. Change this through `world.renderRadius`. Defaults to `8` chunks.
   */
  defaultRenderRadius: number;

  /**
   * The default dimension to a single unit of a block face texture. If any texture loaded is greater, it will be downscaled to this resolution.
   * Defaults to `8` pixels.
   */
  textureUnitDimension: number;

  /**
   * The exponent applied to the ratio that chunks are loaded, which would then be used to determine whether an angle to a chunk is worth loading.
   * Defaults to `8`.
   */
  chunkLoadExponent: number;

  /**
   * The options to create the sky. Defaults to `{}`.
   */
  skyOptions: Partial<SkyOptions>;

  /**
   * The options to create the clouds. Defaults to `{}`.
   */
  cloudsOptions: Partial<CloudsOptions>;

  /**
   * The uniforms to overwrite the default chunk material uniforms. Defaults to `{}`.
   */
  chunkUniformsOverwrite: Partial<ChunkRenderer["uniforms"]>;

  /**
   * The threshold to force the server's time to the client's time. Defaults to `0.1`.
   */
  timeForceThreshold: number;

  /**
   * The interval between each time the world requests the server for its stats. Defaults to 500ms.
   */
  statsSyncInterval: number;

  maxLightsUpdateTime: number;

  /**
   * Whether to use web workers for light calculations. Defaults to true.
   */
  useLightWorkers: boolean;

  /**
   * Maximum concurrent light workers. Defaults to 2.
   */
  maxLightWorkers: number;

  /**
   * Maximum number of retries for stale light jobs before falling back to sync. Defaults to 3.
   */
  lightJobRetryLimit: number;

  /**
   * How long to retain delta history in milliseconds. Defaults to 5000ms.
   */
  deltaRetentionTime: number;

  /**
   * Whether to merge chunk geometries to reduce draw calls. Useful for mobile. Defaults to false.
   */
  mergeChunkGeometries: boolean;

  /**
   * Whether shader-based lighting is enabled for this world.
   * When enabled, lighting uses GPU shaders with cascaded shadow maps.
   * CPU light propagation still runs to provide sunlight exposure data.
   * Defaults to `false`.
   */
  shaderBasedLighting: boolean;

  /**
   * Ratio of render radius beyond which plant meshes are hidden.
   * Plant meshes in chunks farther than `plantRenderRatio * renderRadius` chunks
   * from the player are set invisible to reduce draw calls.
   * Set to `1` to disable (show plants at full render distance).
   * Defaults to `0.5`.
   */
  plantRenderRatio: number;
};

const defaultOptions: WorldClientOptions = {
  maxChunkRequestsPerUpdate: 12,
  maxProcessesPerUpdate: 4,
  maxUpdatesPerUpdate: 1000,
  maxLightsUpdateTime: 5, // ms
  maxMeshesPerUpdate: 8,
  clientOnlyMeshing: false,
  minLightLevel: 0.04,
  chunkRerequestInterval: 10000,
  defaultRenderRadius: 6,
  textureUnitDimension: 8,
  chunkLoadExponent: 8,
  skyOptions: {},
  cloudsOptions: {},
  chunkUniformsOverwrite: {},
  sunlightStartTimeFrac: 0.25,
  sunlightEndTimeFrac: 0.7,
  sunlightChangeSpan: 0.15,
  timeForceThreshold: 0.1,
  statsSyncInterval: 500,
  useLightWorkers: true,
  maxLightWorkers: 4,
  lightJobRetryLimit: 3,
  deltaRetentionTime: 5000,
  mergeChunkGeometries: false,
  shaderBasedLighting: false,
  plantRenderRatio: 0.5,
};

/**
 * The options defined on the server-side, passed to the client on network joining.
 */
export type WorldServerOptions = {
  /**
   * The number of sub-chunks that divides a chunk vertically.
   */
  subChunks: number;

  /**
   * The width and depth of a chunk, in blocks.
   */
  chunkSize: number;

  /**
   * The height of a chunk, in blocks.
   */
  maxHeight: number;

  /**
   * The maximum light level that propagates in this world, including sunlight and torch light.
   */
  maxLightLevel: number;

  /**
   * The minimum chunk coordinate of this world, inclusive.
   */
  minChunk: [number, number];

  /**
   * The maximum chunk coordinate of this world, inclusive.
   */
  maxChunk: [number, number];

  /**
   * The gravity of everything physical in this world.
   */
  gravity: number[];

  /**
   * The minimum bouncing impulse of everything physical in this world.
   */
  minBounceImpulse: number;

  doesTickTime: boolean;

  /**
   * The air drag of everything physical.
   */
  airDrag: number;

  /**
   * The fluid drag of everything physical.
   */
  fluidDrag: number;

  /**
   * The density of the fluid in this world.
   */
  fluidDensity: number;

  /**
   * The time per day in seconds.
   */
  timePerDay: number;

  /**
   * Whether greedy meshing is enabled for this world.
   */
  greedyMeshing: boolean;
};

/**
 * The options to create a world. This consists of {@link WorldClientOptions} and {@link WorldServerOptions}.
 */
export type WorldOptions = WorldClientOptions & WorldServerOptions;

/**
 * A Voxelize world handles the chunk loading and rendering, as well as any 3D objects.
 * **This class extends the [ThreeJS `Scene` class](https://threejs.org/docs/#api/en/scenes/Scene).**
 * This means that you can add any ThreeJS objects to the world, and they will be rendered. The world
 * also implements {@link NetIntercept}, which means it intercepts chunk-related packets from the server
 * and constructs chunk meshes from them.
 *
 * There are a couple components that are by default created by the world that holds data:
 * - {@link World.registry}: A block registry that handles block textures and block instances.
 * - {@link World.chunks}: A chunk manager that stores all the chunks in the world.
 * - {@link World.physics}: A physics engine that handles voxel AABB physics simulation of client-side physics.
 * - {@link World.loader}: An asset loader that handles loading textures and other assets.
 * - {@link World.sky}: A sky that can render the sky and the sun.
 * - {@link World.clouds}: A clouds that renders the cubical clouds.
 *
 * One thing to keep in mind that there are no specific setters like `setVoxelByVoxel` or `setVoxelRotationByVoxel`.
 * This is because, instead, you should use `updateVoxel` and `updateVoxels` to update voxels.
 *
 * # Example
 * ```ts
 * const world = new VOXELIZE.World();
 *
 * // Update the voxel at `(0, 0, 0)` to a voxel type `12` in the world across the network.
 * world.updateVoxel(0, 0, 0, 12)
 *
 * // Register the interceptor with the network.
 * network.register(world);
 *
 * // Register an image to block sides.
 * world.applyBlockTexture("Test", VOXELIZE.ALL_FACES, "https://example.com/test.png");
 *
 * // Update the world every frame.
 * world.update(controls.position);
 * ```
 *
 * ![World](/img/docs/world.png)
 *
 * @category Core
 * @noInheritDoc
 */
export class World<T = MessageProtocol["json"]> extends Scene implements NetIntercept {
  /**
   * The options to create the world.
   */
  public options: WorldOptions;

  /**
   * Whether shader-based lighting is enabled for this world.
   * When true, lighting uses GPU shaders with cascaded shadow maps.
   * CPU light propagation still runs to provide sunlight exposure data.
   */
  public get usesShaderLighting(): boolean {
    return this.options.shaderBasedLighting === true;
  }

  /**
   * The block registry that holds all block data, such as texture and block properties.
   */
  public registry: Registry;

  /**
   * The item registry that holds all item definitions and provides utility methods for item operations.
   */
  public items: ItemRegistry;

  /**
   * An asset loader to load in things like textures, images, GIFs and audio buffers.
   */
  public loader: Loader;

  /**
   * Pipeline for chunk lifecycle state machine (request -> processing -> loaded).
   */
  public chunkPipeline: ChunkPipeline;

  /**
   * Pipeline for mesh generation with ordering guarantees.
   */
  public meshPipeline: MeshPipeline;

  /**
   * Chunk rendering state (materials, uniforms).
   */
  public chunkRenderer: ChunkRenderer;

  /**
   * The voxel physics engine using `@voxelize/physics-engine`.
   */
  public physics: PhysicsEngine;

  /**
   * The sky that renders the sky and the sun.
   */
  public sky: Sky;

  /**
   * The clouds that renders the cubical clouds.
   */
  public clouds: Clouds;

  /**
   * The CSM (Cascaded Shadow Map) renderer for shader-based lighting.
   * Only available when `shaderBasedLighting` is enabled.
   */
  public csmRenderer: CSMRenderer | null = null;

  /**
   * The light volume for shader-based lighting.
   * Stores torch light data in a 3D texture for GPU sampling.
   * Only available when `shaderBasedLighting` is enabled.
   */
  public lightVolume: LightVolume | null = null;

  /**
   * The light source registry for dynamic point lights.
   * Only available when `shaderBasedLighting` is enabled.
   */
  public lightRegistry: LightSourceRegistry | null = null;

  /**
   * Whether or not this world is connected to the server and initialized with data from the server.
   */
  public isInitialized = false;

  /**
   * The network packets to be sent to the server.
   * @hidden
   */
  public packets: MessageProtocol[] = [];

  /**
   * Internal event emitter for chunk lifecycle events.
   * @hidden
   */
  private chunkEvents = new EventEmitter();

  /**
   * The voxel cache that stores previous values.
   */
  private oldBlocks: Map<string, number[]> = new Map();

  /**
   * Cache for block meshes created by makeBlockMesh with cached option.
   */
  private blockMeshCache = new Map<string, Group>();

  /**
   * The internal clock.
   */
  private clock = new Clock();

  /**
   * A map of initialize listeners on chunks.
   */
  private chunkInitializeListeners = new Map<
    string,
    Set<(chunk: Chunk) => void>
  >();

  private blockEntitiesMap: Map<
    string,
    {
      id: string;
      data: T | null;
    }
  > = new Map();
  private blockEntityKeysByChunk = new Map<string, Set<string>>();
  // TODO: fix a bug where if the chunk is not loaded, the block entity will not be updated and will just go stray
  private blockEntityUpdateListeners = new Set<BlockEntityUpdateListener<T>>();

  private blockUpdateListeners = new Set<BlockUpdateListener>();

  /**
   * The JSON data received from the world. Call `initialize` to initialize.
   */
  private initialData: MessageProtocol["json"] | null = null;
  private initialEntities: MessageProtocol["entities"] | null = null;

  public extraInitData: Record<string, JsonValue> = {};

  /**
   * The internal time in seconds.
   */
  private _time = 0;

  /**
   * The internal render radius in chunks.
   */
  private _renderRadius = 0;

  /**
   * The internal delete radius in chunks.
   */
  private _deleteRadius = 0;

  private _plantBlockIds = new Set<number>();
  private _lastCenterChunk: Coords2 = [0, 0];

  private meshWorkerPool = new WorkerPool(MeshWorker, {
    maxWorker: Math.min(navigator.hardwareConcurrency ?? 4, 4),
    name: "mesh-worker",
  });

  private lightWorkerPool!: WorkerPool;

  private textureLoaderLastMap: Record<string, Date> = {};

  private isTrackingChunks = false;

  private blockUpdatesQueue: BlockUpdateWithSource[] = [];
  private blockUpdatesQueueHead = 0;
  private blockUpdatesToEmit: BlockUpdate[] = [];
  private blockUpdatesToEmitHead = 0;
  private clientUpdateBatchSize = 0;

  private voxelDeltas = new Map<string, VoxelDelta[]>();
  private deltaSequenceCounter = 0;
  private cleanupDeltasInterval: ReturnType<typeof setInterval> | null = null;

  private lightJobQueue: LightJob[] = [];
  private lightJobQueueHead = 0;
  private lightJobIdCounter = 0;
  private lightBatchIdCounter = 0;
  private isProcessingDirtyChunks = false;
  private shouldRerunDirtyChunkProcessing = false;
  private requestCandidateCxs = new Int32Array(0);
  private requestCandidateCzs = new Int32Array(0);
  private requestCandidateDistances = new Float64Array(0);
  private processCandidateData: import("@voxelize/protocol").ChunkProtocol[] =
    [];
  private processCandidateDistances = new Float64Array(0);
  private meshJobCxs = new Int32Array(0);
  private meshJobCzs = new Int32Array(0);
  private meshJobLevels = new Int32Array(0);
  private meshJobGenerations = new Uint32Array(0);
  private meshJobKeys: string[] = [];
  private meshWorkerPromises: Array<Promise<GeometryProtocol[] | null>> = [];
  private meshJobArrayCapacity = 0;
  private mergedMaterialGroupIndexByMaterial = new Map<
    CustomChunkShaderMaterial,
    number
  >();
  private mergedMaterialGeometryGroups: BufferGeometry[][] = [];
  private reusableMergedMaterialGeometryGroups: BufferGeometry[][] = [];
  private mergedMaterialGroupMaterials: CustomChunkShaderMaterial[] = [];
  private mergedMaterialGroupVoxels: number[] = [];
  private emitServerUpdateBlockCache = new Map<number, Block>();
  private applyServerUpdateBlockCache = new Map<number, Block>();
  private processLightUpdateBlockCache = new Map<number, Block>();
  private maxHeightBlockCache = new Map<number, Block>();
  private blockEntityTypeBlockCache = new Map<string, Block | null>();
  private blockFaceNameCache = new Map<
    number,
    Map<string, Block["faces"][number]>
  >();
  private chunkMaterialBaseKeyById = new Map<number, string>();
  private chunkMaterialIndependentKeyById = new Map<number, Map<string, string>>();
  private transparentRenderOrderById = new Map<number, number>();
  private textureGroupFirstFaceCache = new Map<
    string,
    { blockId: number; face: Block["faces"][number] } | null
  >();
  private syncLightAffectedChunks = new Map<number, Set<number>>();
  private reusableSyncLightAffectedZSets: Set<number>[] = [];
  private dynamicAABBRuleCoords: Coords3 = [0, 0, 0];
  private dynamicPassableRuleCoords: Coords3 = [0, 0, 0];
  private raycastVoxelCoords: Coords3 = [0, 0, 0];
  private readonly dynamicRuleQuery = {
    getVoxelAt: (x: number, y: number, z: number) =>
      this.getVoxelAtUnchecked(x, y, z),
    getVoxelRotationAt: (x: number, y: number, z: number) =>
      this.getVoxelRotationAtUnchecked(x, y, z),
    getVoxelStageAt: (x: number, y: number, z: number) =>
      this.getVoxelStageAtUnchecked(x, y, z),
  };

  private static readonly warmColor = new Color(1.0, 0.95, 0.9);
  private static readonly coolColor = new Color(0.9, 0.95, 1.0);
  private static readonly nightColor = new Color(0.15, 0.18, 0.25);
  private static readonly fogWarmTint = new Color(0.95, 0.88, 0.75);
  private static readonly dayAmbient = new Color(0.42, 0.42, 0.43);
  private static readonly nightAmbient = new Color(0.08, 0.1, 0.15);
  private lightJobsCompleteResolvers: (() => void)[] = [];
  private activeLightBatch: LightBatch | null = null;

  private accumulatedLightOps: LightOperations | null = null;
  private accumulatedStartSequenceId = 0;

  /**
   * Create a new Voxelize world.
   *
   * @param options The options to create the world.
   */
  constructor(options: Partial<WorldOptions> = {}) {
    super();

    const mergedOptions = {
      ...defaultOptions,
      ...options,
    } as WorldOptions;
    this.options = mergedOptions;
    const { statsSyncInterval } = mergedOptions;

    this.lightWorkerPool = new WorkerPool(LightWorker, {
      maxWorker: this.options.maxLightWorkers,
      name: "light-worker",
    });

    this.setupComponents();
    this.setupUniforms();
    this.startDeltaCleanup();

    setWorkerInterval(() => {
      this.packets.push({
        type: "METHOD",
        method: {
          name: "vox-builtin:get-stats",
          payload: {},
        },
      });
    }, statsSyncInterval);
  }

  private startDeltaCleanup() {
    this.cleanupDeltasInterval = setInterval(() => {
      if (this.voxelDeltas.size === 0) {
        return;
      }

      const cutoff = performance.now() - this.options.deltaRetentionTime;

      let deltaEntries = this.voxelDeltas.entries();
      let deltaEntry = deltaEntries.next();
      while (!deltaEntry.done) {
        const entry = deltaEntry.value;
        const chunkName = entry[0];
        const deltas = entry[1];
        if (this.pruneDeltasByCutoff(deltas, cutoff) === 0) {
          this.voxelDeltas.delete(chunkName);
        }
        deltaEntry = deltaEntries.next();
      }
    }, 1000);
  }

  private ensureRequestCandidateCapacity(capacity: number) {
    if (this.requestCandidateCxs.length >= capacity) {
      return;
    }

    this.requestCandidateCxs = new Int32Array(capacity);
    this.requestCandidateCzs = new Int32Array(capacity);
    this.requestCandidateDistances = new Float64Array(capacity);
  }

  private ensureProcessCandidateCapacity(capacity: number) {
    if (this.processCandidateData.length >= capacity) {
      return;
    }

    this.processCandidateData = new Array<
      import("@voxelize/protocol").ChunkProtocol
    >(capacity);
    this.processCandidateDistances = new Float64Array(capacity);
  }

  private ensureMeshJobMetadataCapacity(capacity: number) {
    if (this.meshJobCxs.length >= capacity) {
      return;
    }

    this.meshJobCxs = new Int32Array(capacity);
    this.meshJobCzs = new Int32Array(capacity);
    this.meshJobLevels = new Int32Array(capacity);
    this.meshJobGenerations = new Uint32Array(capacity);
  }

  private ensureMeshJobArrayCapacity(capacity: number) {
    if (this.meshJobArrayCapacity >= capacity) {
      return;
    }

    this.meshJobKeys = new Array<string>(capacity);
    this.meshWorkerPromises = new Array<Promise<GeometryProtocol[] | null>>(
      capacity
    );
    this.meshJobArrayCapacity = capacity;
  }

  private pruneDeltasByCutoff(deltas: VoxelDelta[], cutoff: number): number {
    const firstRetainedIndex = this.findFirstDeltaAfterTimestamp(deltas, cutoff);

    if (firstRetainedIndex === 0) {
      return deltas.length;
    }

    if (firstRetainedIndex >= deltas.length) {
      deltas.length = 0;
      return 0;
    }

    deltas.copyWithin(0, firstRetainedIndex);
    deltas.length = deltas.length - firstRetainedIndex;
    return deltas.length;
  }

  private findFirstDeltaAfter(deltas: VoxelDelta[], sequenceId: number): number {
    if (deltas.length === 0) {
      return 0;
    }

    if (deltas[deltas.length - 1].sequenceId <= sequenceId) {
      return deltas.length;
    }

    if (deltas[0].sequenceId > sequenceId) {
      return 0;
    }

    let low = 0;
    let high = deltas.length;

    while (low < high) {
      const mid = (low + high) >>> 1;
      if (deltas[mid].sequenceId <= sequenceId) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    return low;
  }

  private findFirstDeltaAfterTimestamp(deltas: VoxelDelta[], timestamp: number): number {
    if (deltas.length === 0) {
      return 0;
    }

    if (deltas[deltas.length - 1].timestamp <= timestamp) {
      return deltas.length;
    }

    if (deltas[0].timestamp > timestamp) {
      return 0;
    }

    let low = 0;
    let high = deltas.length;

    while (low < high) {
      const mid = (low + high) >>> 1;
      if (deltas[mid].timestamp <= timestamp) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    return low;
  }

  private async dispatchMeshWorker(
    cx: number,
    cz: number,
    level: number
  ): Promise<GeometryProtocol[] | null> {
    if (
      !this.options.shaderBasedLighting &&
      (this.hasPendingLightJobs() || this.activeLightBatch !== null)
    ) {
      await this.waitForLightJobsComplete();
    }

    const name = ChunkUtils.getChunkNameAt(cx, cz);
    if (this.chunkPipeline.isInStage(name, "processing")) {
      return null;
    }

    const centerChunk = this.getLoadedChunkByCoords(cx, cz);
    if (!centerChunk || !centerChunk.isReady) {
      return null;
    }

    const chunks: (Chunk | undefined)[] = new Array(
      CHUNK_NEIGHBOR_OFFSETS.length
    );
    chunks[4] = centerChunk;
    for (let i = 0; i < CHUNK_NEIGHBOR_OFFSETS.length; i++) {
      if (i === 4) {
        continue;
      }

      const offset = CHUNK_NEIGHBOR_OFFSETS[i];
      chunks[i] = this.getLoadedChunkByCoords(cx + offset[0], cz + offset[1]);
    }

    const { min, max } = centerChunk;
    const heightPerSubChunk = Math.floor(
      this.options.maxHeight / this.options.subChunks
    );
    const subChunkMin = [min[0], heightPerSubChunk * level, min[2]];
    const subChunkMax = [max[0], heightPerSubChunk * (level + 1), max[2]];

    const chunksData: (object | null)[] = new Array(chunks.length);
    const arrayBuffers: ArrayBuffer[] = [];
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      if (!chunk || !chunk.isReady) {
        chunksData[index] = null;
        continue;
      }

      const [chunkData, chunkArrayBuffers] = chunk.serialize();

      chunksData[index] = chunkData;
      for (
        let bufferIndex = 0;
        bufferIndex < chunkArrayBuffers.length;
        bufferIndex++
      ) {
        arrayBuffers.push(chunkArrayBuffers[bufferIndex]);
      }
    }

    const data = {
      chunksData,
      options: this.options,
      min: subChunkMin,
      max: subChunkMax,
    };

    const { geometries } = await new Promise<{
      geometries: GeometryProtocol[];
    }>((resolve, reject) => {
      this.meshWorkerPool.addJob({
        message: data,
        buffers: arrayBuffers,
        resolve,
        reject,
      });
    });

    if (this.chunkPipeline.isInStage(name, "processing")) {
      return null;
    }

    return geometries;
  }

  private applyMeshResult(
    cx: number,
    cz: number,
    level: number,
    geometries: GeometryProtocol[],
    generation?: number
  ): number {
    const key = MeshPipeline.makeKey(cx, cz, level);
    let completionStatus = 0;
    if (generation !== undefined) {
      completionStatus = this.meshPipeline.completeJobStatus(key, generation);
      if ((completionStatus & MESH_JOB_ACCEPTED) === 0) {
        return completionStatus;
      }
    }

    const mesh: MeshProtocol = {
      level,
      geometries,
    };

    this.buildChunkMesh(cx, cz, mesh);

    const chunk = this.getLoadedChunkByCoords(cx, cz);
    if (chunk) {
      const meshes = chunk.meshes.get(level);
      if (!meshes) {
        return completionStatus;
      }
      this.emitChunkEvent("chunk-mesh-updated", {
        chunk,
        coords: chunk.coords,
        level,
        meshes,
        reason: "voxel",
      });

      this.emitChunkEvent("chunk-updated", {
        chunk,
        coords: chunk.coords,
        allMeshes: chunk.meshes,
        reason: "voxel",
      });
    }

    return completionStatus;
  }

  async meshChunkLocally(
    cx: number,
    cz: number,
    level: number,
    generation?: number
  ) {
    const geometries = await this.dispatchMeshWorker(cx, cz, level);
    if (!geometries) return;
    this.applyMeshResult(cx, cz, level, geometries, generation);
  }

  /**
   * Apply a texture to a face or faces of a block. This will automatically load the image from the source
   * and draw it onto the block's texture atlas.
   *
   * @deprecated When applying the same texture to multiple faces, use texture groups instead
   * for better atlas efficiency. Define texture_group on the server-side block faces and use
   * {@link applyTextureGroup} or {@link applyTextureGroups} on the client.
   *
   * @param idOrName The ID or name of the block.
   * @param faceNames The face names to apply the texture to.
   * @param source The source of the texture.
   */
  applyBlockTexture(
    idOrName: number | string,
    faceNames: string | string[],
    source: string | Color | HTMLImageElement | Texture
  ) {
    this.checkIsInitialized("apply block texture", false);

    const block = this.getBlockOf(idOrName);

    const blockFaces = this.getBlockFacesByFaceNames(block.id, faceNames, true);
    if (!blockFaces || blockFaces.length === 0) {
      return;
    }

    const now = new Date();
    for (let faceIndex = 0; faceIndex < blockFaces.length; faceIndex++) {
      const face = blockFaces[faceIndex];
      const id = `${face.name}::${block.id}`;
      this.textureLoaderLastMap[id] = now;
    }

    // If it is a string, load the image.
    if (typeof source === "string") {
      this.loader.loadImage(source).then((data) => {
        const filteredFaceNames: string[] = [];
        for (let faceIndex = 0; faceIndex < blockFaces.length; faceIndex++) {
          const face = blockFaces[faceIndex];
          const id = `${face.name}::${block.id}`;
          if (this.textureLoaderLastMap[id] === now) {
            filteredFaceNames.push(face.name);
          }
        }
        this.applyBlockTexture(idOrName, filteredFaceNames, data);
      });
      return;
    }

    const data = source;

    for (let faceIndex = 0; faceIndex < blockFaces.length; faceIndex++) {
      const face = blockFaces[faceIndex];
      if (face.isolated) {
        // console.warn(
        //   `Attempting to apply texture onto an isolated face: ${block.name}, ${face.name}. Use 'applyBlockTextureAt' instead.`
        // );
        continue;
      }

      const mat = this.getBlockFaceMaterial(block.id, face.name);

      // If the face is independent, that means this face does not share a texture atlas with other faces.
      // In this case, we can just set the map to the texture.
      if (face.independent) {
        if (ThreeUtils.isTexture(source)) {
          mat.map = source;
          mat.uniforms.map = { value: source };
          mat.needsUpdate = true;
        } else if (data instanceof HTMLImageElement) {
          mat.map.image = data;
          mat.map.needsUpdate = true;
          mat.needsUpdate = true;
        } else if (ThreeUtils.isColor(data)) {
          const canvas = mat.map.image;
          canvas.width = 1;
          canvas.height = 1;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = data.getStyle();
          ctx.fillRect(0, 0, 1, 1);
          // Update the texture with the new color
          mat.map.needsUpdate = true;
          mat.needsUpdate = true;
        } else {
          throw new Error(
            `Cannot apply texture to face "${face.name}" on block "${block.name}" because the source is not an image or a color.`
          );
        }

        continue;
      }

      // Otherwise, we need to draw the image onto the texture atlas.
      const atlas = mat.map as AtlasTexture;
      atlas.drawImageToRange(face.range, data);

      // Update the texture with the new image
      mat.map.needsUpdate = true;
    }
  }

  getIsolatedBlockMaterialAt(
    voxel: Coords3,
    faceName: string,
    defaultDimension?: number
  ) {
    const block = this.getBlockAt(...voxel);
    const idOrName = block.id;
    return this.applyBlockTextureAt(
      idOrName,
      faceName,
      AtlasTexture.makeUnknownTexture(
        defaultDimension ?? this.options.textureUnitDimension
      ),
      voxel
    );
  }

  private getOrCreateIsolatedBlockMaterial(
    blockId: number,
    position: Coords3,
    faceName: string,
    defaultDimension?: number
  ) {
    return this.applyBlockTextureAt(
      blockId,
      faceName,
      AtlasTexture.makeUnknownTexture(
        defaultDimension ?? this.options.textureUnitDimension
      ),
      position
    );
  }

  applyBlockTextureAt(
    idOrName: number | string,
    faceName: string,
    source: string | Color | HTMLImageElement | Texture,
    voxel: Coords3
  ) {
    const block = this.getBlockOf(idOrName);
    const faces = this.getBlockFacesByFaceNames(block.id, faceName);

    if (!faces || faces.length !== 1) {
      throw new Error(
        `Face(s) "${faceName}" does not exist on block "${block.name}" or there are multiple faces with the same name.`
      );
    }

    const [face] = faces;
    if (!face.isolated) {
      throw new Error(
        `Cannot apply isolated texture to face "${face.name}" on block "${block.name}" because it is not isolated.`
      );
    }

    const mat = this.getBlockFaceMaterial(block.id, face.name, voxel);
    const isolatedMat = mat || this.makeShaderMaterial();

    // Handle different types of source inputs
    if (typeof source === "string") {
      this.loader.loadImage(source).then((image) => {
        if (isolatedMat.map) {
          isolatedMat.map.dispose();
        }
        isolatedMat.map = new Texture(image);
        isolatedMat.map.colorSpace = SRGBColorSpace;
        isolatedMat.map.needsUpdate = true;
        isolatedMat.needsUpdate = true;
      });
    } else if (source instanceof HTMLImageElement) {
      if (isolatedMat.map) {
        isolatedMat.map.dispose();
      }
      isolatedMat.map = new Texture(source);
      isolatedMat.map.colorSpace = SRGBColorSpace;
      isolatedMat.map.needsUpdate = true;
      isolatedMat.needsUpdate = true;
    } else if (ThreeUtils.isColor(source)) {
      if (isolatedMat.map) {
        if (isolatedMat.map instanceof AtlasTexture) {
          isolatedMat.map.paintColor(source);
          isolatedMat.map.needsUpdate = true;
        } else if (ThreeUtils.isCanvasTexture(isolatedMat.map)) {
          const canvas = isolatedMat.map.image;
          const ctx = canvas.getContext("2d");
          const canvasWidth = canvas.width;
          const canvasHeight = canvas.height;
          ctx.fillStyle = source.getStyle();
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);
          isolatedMat.map.needsUpdate = true;
        }
      } else {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = source.getStyle();
        ctx.fillRect(0, 0, 1, 1);
        isolatedMat.map = new CanvasTexture(canvas);
        isolatedMat.map.colorSpace = SRGBColorSpace;
        isolatedMat.map.needsUpdate = true;
        isolatedMat.needsUpdate = true;
      }
    } else if (ThreeUtils.isTexture(source)) {
      if (isolatedMat.map) {
        isolatedMat.map.dispose();
      }
      isolatedMat.map = source;
      isolatedMat.map.needsUpdate = true;
      isolatedMat.needsUpdate = true;
    } else {
      throw new Error("Unsupported source type for texture.");
    }

    if (isolatedMat.map) {
      isolatedMat.uniforms.map.value = isolatedMat.map;
    }
    isolatedMat.side = block.isSeeThrough ? DoubleSide : FrontSide;
    isolatedMat.transparent = block.isSeeThrough;

    if (!mat) {
      const key = this.makeChunkMaterialKey(block.id, face.name, voxel);
      this.chunkRenderer.materials.set(key, isolatedMat);
    }

    return isolatedMat;
  }

  /**
   * Apply multiple block textures at once. See {@link applyBlockTexture} for more information.
   *
   * @deprecated When applying the same texture to multiple faces, use texture groups instead
   * for better atlas efficiency. Define texture_group on the server-side block faces and use
   * {@link applyTextureGroup} or {@link applyTextureGroups} on the client.
   *
   * @param data The data to apply the block textures.
   * @returns A promise that resolves when all the textures are applied.
   */
  async applyBlockTextures(
    data: {
      idOrName: number | string;
      faceNames: string | string[];
      source: string | Color;
    }[]
  ) {
    const promises = new Array<void | Promise<void>>(data.length);
    for (let index = 0; index < data.length; index++) {
      const { idOrName, faceNames, source } = data[index];
      promises[index] = this.applyBlockTexture(idOrName, faceNames, source);
    }
    return Promise.all(promises);
  }

  async applyTextureGroup(
    groupName: string,
    source: string | Color | HTMLImageElement | Texture
  ) {
    this.checkIsInitialized("apply texture group", false);
    const firstFaceInGroup = this.getTextureGroupFirstFace(groupName);

    if (!firstFaceInGroup) {
      console.warn(`No faces found with texture group "${groupName}"`);
      return;
    }

    if (typeof source === "string") {
      const data = await this.loader.loadImage(source);
      return this.applyTextureGroup(groupName, data);
    }

    const mat = this.getBlockFaceMaterial(
      firstFaceInGroup.blockId,
      firstFaceInGroup.face.name
    );

    if (!mat) {
      console.warn(
        `No material found for texture group "${groupName}" (block ${firstFaceInGroup.blockId}, face ${firstFaceInGroup.face.name})`
      );
      return;
    }

    const atlas = mat.map as AtlasTexture;
    atlas.drawImageToRange(firstFaceInGroup.face.range, source);
    mat.map.needsUpdate = true;
  }

  async applyTextureGroups(
    data: {
      groupName: string;
      source: string | Color | HTMLImageElement | Texture;
    }[]
  ) {
    const promises = new Array<Promise<void>>(data.length);
    for (let index = 0; index < data.length; index++) {
      const { groupName, source } = data[index];
      promises[index] = this.applyTextureGroup(groupName, source);
    }
    return Promise.all(promises);
  }

  /**
   * Apply a set of keyframes to a block. This will load the keyframes from the sources and start the animation
   * to play the keyframes on the block's texture atlas.
   *
   * @param idOrName The ID or name of the block.
   * @param faceNames The face name or names to apply the texture to.
   * @param keyframes The keyframes to apply to the texture.
   * @param fadeFrames The number of frames to fade between each keyframe.
   */
  async applyBlockFrames(
    idOrName: number | string,
    faceNames: string | string[],
    keyframes: [number, string | Color | HTMLImageElement][],
    fadeFrames = 0
  ) {
    this.checkIsInitialized("apply block animation", false);

    const block = this.getBlockOf(idOrName);

    const realKeyframes = new Array<[number, Color | HTMLImageElement]>(
      keyframes.length
    );

    // Convert string sources to images.
    for (let keyframeIndex = 0; keyframeIndex < keyframes.length; keyframeIndex++) {
      const [duration, source] = keyframes[keyframeIndex];
      if (typeof source === "string") {
        realKeyframes[keyframeIndex] = [
          duration,
          await this.loader.loadImage(source),
        ];
        continue;
      }

      realKeyframes[keyframeIndex] = [duration, source];
    }

    const blockFaces = this.getBlockFacesByFaceNames(block.id, faceNames);
    if (!blockFaces) {
      throw new Error(
        `Face(s) "${faceNames}" does not exist on block "${block.name}"`
      );
    }

    for (let faceIndex = 0; faceIndex < blockFaces.length; faceIndex++) {
      const face = blockFaces[faceIndex];
      const mat = this.getBlockFaceMaterial(block.id, face.name);

      // If the block's material is not set up to an atlas texture, we need to set it up.
      if (!(mat.map instanceof AtlasTexture)) {
        const { image } = mat.map;

        if (image && image.width) {
          const atlas = new AtlasTexture(1, image.width);
          atlas.drawImageToRange(face.range, image);

          mat.map.dispose();
          mat.map = atlas;
          mat.uniforms.map = { value: atlas };
          mat.needsUpdate = true;
        } else {
          throw new Error(
            `Cannot animate face "${face.name}" on block "${block.name}" because it does not have a texture.`
          );
        }
      }

      // Register the animation. This will start the animation.
      (mat.map as AtlasTexture).registerAnimation(
        face.range,
        realKeyframes,
        fadeFrames
      );
    }
  }

  /**
   * Apply a GIF animation to a block. This will load the GIF from the source and start the animation
   * using {@link applyBlockFrames} internally.
   *
   * @param idOrName The ID or name of the block.
   * @param faceNames The face name or names to apply the texture to.
   * @param source The source of the GIF. Note that this must be a GIF file ending with `.gif`.
   * @param interval The interval between each frame of the GIF in milliseconds. Defaults to `66.666667ms`.
   */
  async applyBlockGif(
    idOrName: string,
    faceNames: string[] | string,
    source: string,
    interval = 66.666667
  ) {
    this.checkIsInitialized("apply GIF animation", false);

    if (!source.endsWith(".gif")) {
      console.warn(
        "There's a chance that this file isn't a GIF as it doesn't end with .gif"
      );
    }

    // Load the keyframes from this GIF.
    const images = await this.loader.loadGifImages(source);
    const keyframes = new Array<[number, HTMLImageElement]>(images.length);
    for (let index = 0; index < images.length; index++) {
      keyframes[index] = [interval, images[index]];
    }

    await this.applyBlockFrames(idOrName, faceNames, keyframes);
  }

  /**
   * Apply a resolution to a block. This will set the resolution of the block's texture atlas.
   * Keep in mind that this face or faces must be independent.
   *
   * @param idOrName The ID or name of the block.
   * @param faceNames The face name or names to apply the resolution to.
   * @param resolution The resolution to apply to the block, in pixels.
   */
  async setResolutionOf(
    idOrName: number | string,
    faceNames: string | string[],
    resolution:
      | number
      | {
          x: number;
          y: number;
        }
  ) {
    this.checkIsInitialized("apply resolution", false);

    const block = this.getBlockOf(idOrName);

    faceNames = Array.isArray(faceNames) ? faceNames : [faceNames];

    const blockFaces = this.getBlockFacesByFaceNames(block.id, faceNames);
    if (!blockFaces) {
      throw new Error(
        `Face(s) "${faceNames.join(", ")}" does not exist on block "${
          block.name
        }"`
      );
    }

    for (let faceIndex = 0; faceIndex < blockFaces.length; faceIndex++) {
      const face = blockFaces[faceIndex];
      if (!face.independent) {
        throw new Error(
          `Cannot apply resolution to face "${face.name}" on block "${block.name}" because it is not independent.`
        );
      }

      const mat = this.getBlockFaceMaterial(block.id, face.name);
      const canvas = mat.map.image ?? mat.map.source.data;

      // Wait for the image to load.
      if (canvas instanceof HTMLImageElement) {
        await new Promise<void>((resolve) => {
          if (canvas.complete) {
            resolve();
            return;
          }

          canvas.onload = () => {
            resolve();
          };
        });
      }

      if (!canvas) {
        throw new Error(
          `Cannot apply resolution to face "${face.name}" on block "${block.name}" because it does not have or has not loaded a texture.`
        );
      }

      const { width, height } = canvas;

      const newCanvas = document.createElement("canvas");

      const newXResolution =
        typeof resolution === "number" ? resolution : resolution.x;
      const newYResolution =
        typeof resolution === "number" ? resolution : resolution.y;

      newCanvas.width = newXResolution;
      newCanvas.height = newYResolution;

      const newCtx = newCanvas.getContext("2d");
      newCtx.drawImage(
        canvas,
        0,
        0,
        width,
        height,
        0,
        0,
        newXResolution,
        newYResolution
      );

      // Update the texture with the new image
      mat.map.image = newCanvas;
      mat.map.needsUpdate = true;
      mat.needsUpdate = true;
    }
  }

  getBlockFacesByFaceNames(
    id: number,
    faceNames: string | string[] | RegExp,
    warnUnknown = false
  ) {
    const block = this.getBlockOf(id);
    const allFaces = this.getAllBlockFaces(block);

    // Check for '*' wildcard to return all faces
    if (faceNames === "*") {
      return allFaces;
    }

    const faceNameArray = Array.isArray(faceNames) ? faceNames : [faceNames];
    const faceNameRegexes = new Array<RegExp>(faceNameArray.length);
    for (let matcherIndex = 0; matcherIndex < faceNameArray.length; matcherIndex++) {
      const faceNamePattern = faceNameArray[matcherIndex];
      faceNameRegexes[matcherIndex] =
        faceNamePattern instanceof RegExp
          ? new RegExp(faceNamePattern.source, faceNamePattern.flags)
          : new RegExp(faceNamePattern);
    }

    if (warnUnknown) {
      const uniqueFaceNames: string[] = [];
      const seenFaceNames = new Set<string>();
      for (let faceIndex = 0; faceIndex < allFaces.length; faceIndex++) {
        const faceName = allFaces[faceIndex].name;
        if (seenFaceNames.has(faceName)) {
          continue;
        }
        seenFaceNames.add(faceName);
        uniqueFaceNames.push(faceName);
      }

      for (
        let matcherIndex = 0;
        matcherIndex < faceNameArray.length;
        matcherIndex++
      ) {
        const fn = faceNameArray[matcherIndex];
        if (fn instanceof RegExp) {
          continue;
        }

        const regex = faceNameRegexes[matcherIndex];
        let hasMatch = false;
        for (let nameIndex = 0; nameIndex < uniqueFaceNames.length; nameIndex++) {
          regex.lastIndex = 0;
          if (regex.test(uniqueFaceNames[nameIndex])) {
            hasMatch = true;
            break;
          }
        }
        if (!hasMatch) {
          const suggestions = findSimilar(fn, uniqueFaceNames);
          const suggestionText = formatSuggestion(suggestions, uniqueFaceNames);
          console.warn(
            `[Voxelize] Face "${fn}" not found on block "${block.name}".${suggestionText}`
          );
        }
      }
    }

    const matchedFaces: Block["faces"] = [];
    for (let faceIndex = 0; faceIndex < allFaces.length; faceIndex++) {
      const face = allFaces[faceIndex];
      let isMatch = false;
      for (let matcherIndex = 0; matcherIndex < faceNameRegexes.length; matcherIndex++) {
        const matcher = faceNameRegexes[matcherIndex];
        matcher.lastIndex = 0;
        if (matcher.test(face.name)) {
          isMatch = true;
          break;
        }
      }
      if (isMatch) {
        matchedFaces.push(face);
      }
    }
    return matchedFaces;
  }

  private getAllBlockFaces(block: Block): Block["faces"] {
    const blockFaces = block.faces;
    const result = new Array<Block["faces"][number]>(blockFaces.length);
    const existingNames = new Set<string>();
    for (let faceIndex = 0; faceIndex < blockFaces.length; faceIndex++) {
      const face = blockFaces[faceIndex];
      result[faceIndex] = face;
      existingNames.add(face.name);
    }

    const dynamicPatterns = block.dynamicPatterns;
    if (dynamicPatterns) {
      for (let patternIndex = 0; patternIndex < dynamicPatterns.length; patternIndex++) {
        const parts = dynamicPatterns[patternIndex].parts;
        for (let partIndex = 0; partIndex < parts.length; partIndex++) {
          const partFaces = parts[partIndex].faces;
          for (let faceIndex = 0; faceIndex < partFaces.length; faceIndex++) {
            const face = partFaces[faceIndex];
            if (!existingNames.has(face.name)) {
              result.push(face);
              existingNames.add(face.name);
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * Get a chunk by its name.
   *
   * @param name The name of the chunk to get.
   * @returns The chunk with the given name, or undefined if it does not exist.
   */
  getChunkByName(name: string) {
    this.checkIsInitialized("get chunk by name", false);
    return this.chunkPipeline.getLoadedChunk(name);
  }

  /**
   * Get a chunk by its 2D coordinates.
   *
   * @param cx The x coordinate of the chunk.
   * @param cz The z coordinate of the chunk.
   * @returns The chunk at the given coordinates, or undefined if it does not exist.
   */
  getChunkByCoords(cx: number, cz: number) {
    this.checkIsInitialized("get chunk by coords", false);
    return this.getLoadedChunkByCoords(cx, cz);
  }

  /**
   * Get a chunk that contains a given position.
   *
   * @param px The x coordinate of the position.
   * @param py The y coordinate of the position.
   * @param pz The z coordinate of the position.
   * @returns The chunk that contains the position at the given position, or undefined if it does not exist.
   */
  getChunkByPosition(px: number, py: number, pz: number) {
    this.checkIsInitialized("get chunk by position", false);
    return this.getLoadedChunkAtVoxel(px, pz);
  }

  private getLoadedChunkByCoords(cx: number, cz: number) {
    return this.chunkPipeline.getLoadedChunkAt(cx, cz);
  }

  private getLoadedChunkAtVoxel(vx: number, vz: number) {
    return this.chunkPipeline.getLoadedChunk(
      ChunkUtils.getChunkNameByVoxel(vx, vz, this.options.chunkSize)
    );
  }

  private getVoxelAtUnchecked(px: number, py: number, pz: number) {
    const chunk = this.getLoadedChunkAtVoxel(px, pz);
    if (chunk === undefined) return 0;
    return chunk.getVoxel(px, py, pz);
  }

  private getVoxelRotationAtUnchecked(px: number, py: number, pz: number) {
    const chunk = this.getLoadedChunkAtVoxel(px, pz);
    if (chunk === undefined) return new BlockRotation();
    return chunk.getVoxelRotation(px, py, pz);
  }

  private getVoxelStageAtUnchecked(px: number, py: number, pz: number) {
    const chunk = this.getLoadedChunkAtVoxel(px, pz);
    if (chunk === undefined) return 0;
    return chunk.getVoxelStage(px, py, pz);
  }

  private getSunlightAtUnchecked(px: number, py: number, pz: number) {
    const chunk = this.getLoadedChunkAtVoxel(px, pz);
    if (chunk === undefined) return 0;
    return chunk.getSunlight(px, py, pz);
  }

  private getTorchLightAtUnchecked(
    px: number,
    py: number,
    pz: number,
    color: LightColor
  ) {
    const chunk = this.getLoadedChunkAtVoxel(px, pz);
    if (chunk === undefined) return 0;
    return chunk.getTorchLight(px, py, pz, color);
  }

  private getLightValuesAtUnchecked(vx: number, vy: number, vz: number) {
    const chunk = this.getLoadedChunkAtVoxel(vx, vz);
    if (chunk === undefined) return null;
    return {
      sunlight: chunk.getSunlight(vx, vy, vz),
      red: chunk.getTorchLight(vx, vy, vz, "RED"),
      green: chunk.getTorchLight(vx, vy, vz, "GREEN"),
      blue: chunk.getTorchLight(vx, vy, vz, "BLUE"),
    };
  }

  private getBlockAtUnchecked(px: number, py: number, pz: number) {
    const chunk = this.getLoadedChunkAtVoxel(px, pz);
    if (chunk === undefined) return null;
    const id = chunk.getVoxel(px, py, pz);
    return this.getBlockById(id);
  }

  /**
   * Get a voxel by a 3D world position.
   *
   * @param px The x coordinate of the position.
   * @param py The y coordinate of the position.
   * @param pz The z coordinate of the position.
   * @returns The voxel at the given position, or 0 if it does not exist.
   */
  getVoxelAt(px: number, py: number, pz: number) {
    this.checkIsInitialized("get voxel", false);
    return this.getVoxelAtUnchecked(px, py, pz);
  }

  setVoxelAt(px: number, py: number, pz: number, voxel: number) {
    this.checkIsInitialized("set voxel", false);
    const chunk = this.getLoadedChunkAtVoxel(px, pz);
    if (chunk === undefined) return;

    const oldVoxel = chunk.getVoxel(px, py, pz);
    if (oldVoxel === voxel) {
      return;
    }

    chunk.setVoxel(px, py, pz, voxel);
    this.recordVoxelDelta(px, py, pz, { oldVoxel, newVoxel: voxel }, chunk.name);
    this.trackChunkAt(px, py, pz);
  }

  /**
   * Get a voxel rotation by a 3D world position.
   *
   * @param px The x coordinate of the position.
   * @param py The y coordinate of the position.
   * @param pz The z coordinate of the position.
   * @returns The voxel rotation at the given position, or the default rotation if it does not exist.
   */
  getVoxelRotationAt(px: number, py: number, pz: number) {
    this.checkIsInitialized("get voxel rotation", false);
    return this.getVoxelRotationAtUnchecked(px, py, pz);
  }

  /**
   * Set a voxel rotation at a 3D world position.
   *
   * @param px The x coordinate of the position.
   * @param py The y coordinate of the position.
   * @param pz The z coordinate of the position.
   * @param rotation The rotation to set.
   */
  setVoxelRotationAt(
    px: number,
    py: number,
    pz: number,
    rotation: BlockRotation
  ) {
    this.checkIsInitialized("set voxel rotation", false);
    const chunk = this.getLoadedChunkAtVoxel(px, pz);
    if (chunk === undefined) return;

    const oldRotation = chunk.getVoxelRotation(px, py, pz);
    if (
      oldRotation.value === rotation.value &&
      oldRotation.yRotation === rotation.yRotation
    ) {
      return;
    }

    chunk.setVoxelRotation(px, py, pz, rotation);
    this.recordVoxelDelta(
      px,
      py,
      pz,
      { oldRotation, newRotation: rotation },
      chunk.name
    );
    this.trackChunkAt(px, py, pz);
  }

  /**
   * Get a voxel stage by a 3D world position.
   *
   * @param px The x coordinate of the position.
   * @param py The y coordinate of the position.
   * @param pz The z coordinate of the position.
   * @returns The voxel stage at the given position, or 0 if it does not exist.
   */
  getVoxelStageAt(px: number, py: number, pz: number) {
    this.checkIsInitialized("get voxel stage", false);
    return this.getVoxelStageAtUnchecked(px, py, pz);
  }

  setVoxelStageAt(px: number, py: number, pz: number, stage: number) {
    this.checkIsInitialized("set voxel stage", false);
    const chunk = this.getLoadedChunkAtVoxel(px, pz);
    if (chunk === undefined) return;

    const oldStage = chunk.getVoxelStage(px, py, pz);
    if (oldStage === stage) {
      return;
    }

    chunk.setVoxelStage(px, py, pz, stage);
    this.recordVoxelDelta(px, py, pz, { oldStage, newStage: stage }, chunk.name);
    this.trackChunkAt(px, py, pz);
  }

  /**
   * Get a voxel sunlight by a 3D world position.
   *
   * @param px The x coordinate of the position.
   * @param py The y coordinate of the position.
   * @param pz The z coordinate of the position.
   * @returns The voxel sunlight at the given position, or 0 if it does not exist.
   */
  getSunlightAt(px: number, py: number, pz: number) {
    this.checkIsInitialized("get sunlight", false);
    return this.getSunlightAtUnchecked(px, py, pz);
  }

  setSunlightAt(px: number, py: number, pz: number, level: number) {
    this.checkIsInitialized("set sunlight", false);
    const chunk = this.getLoadedChunkAtVoxel(px, pz);
    if (chunk === undefined) return;

    if (chunk.getSunlight(px, py, pz) === level) {
      return;
    }

    chunk.setSunlight(px, py, pz, level);
    this.trackChunkAt(px, py, pz);
  }

  /**
   * Get a voxel torch light by a 3D world position.
   *
   * @param px The x coordinate of the position.
   * @param py The y coordinate of the position.
   * @param pz The z coordinate of the position.
   * @param color The color of the torch light.
   * @returns The voxel torchlight at the given position, or 0 if it does not exist.
   */
  getTorchLightAt(px: number, py: number, pz: number, color: LightColor) {
    this.checkIsInitialized("get torch light", false);
    return this.getTorchLightAtUnchecked(px, py, pz, color);
  }

  setTorchLightAt(
    px: number,
    py: number,
    pz: number,
    level: number,
    color: LightColor
  ) {
    this.checkIsInitialized("set torch light", false);
    const chunk = this.getLoadedChunkAtVoxel(px, pz);
    if (chunk === undefined) return;

    if (chunk.getTorchLight(px, py, pz, color) === level) {
      return;
    }

    chunk.setTorchLight(px, py, pz, level, color);
    this.trackChunkAt(px, py, pz);
  }

  getLightValuesAt(vx: number, vy: number, vz: number) {
    this.checkIsInitialized("get light values", false);
    return this.getLightValuesAtUnchecked(vx, vy, vz);
  }

  /**
   * Get a color instance that represents what an object would be like
   * if it were rendered at the given 3D voxel coordinate. This is useful
   * to dynamically shade objects based on their position in the world. Also
   * used in {@link LightShined}.
   *
   * @param vx The voxel's X position.
   * @param vy The voxel's Y position.
   * @param vz The voxel's Z position.
   * @returns The voxel's light color at the given coordinate.
   */
  getLightColorAt(vx: number, vy: number, vz: number) {
    const chunk = this.getLoadedChunkAtVoxel(vx, vz);
    if (!chunk) return new Color(1, 1, 1);

    const sunlight = chunk.getSunlight(vx, vy, vz);
    const red = chunk.getTorchLight(vx, vy, vz, "RED");
    const green = chunk.getTorchLight(vx, vy, vz, "GREEN");
    const blue = chunk.getTorchLight(vx, vy, vz, "BLUE");
    const { sunlightIntensity, minLightLevel, baseAmbient } =
      this.chunkRenderer.uniforms;
    const invMaxLightLevel = 1 / this.options.maxLightLevel;

    const sunlightNorm = sunlight * invMaxLightLevel;
    const sunlightFactor = sunlightNorm * sunlightNorm * sunlightIntensity.value;
    const s = Math.min(
      sunlightFactor + minLightLevel.value * sunlightNorm + baseAmbient.value,
      1
    );

    const torchRed = red * invMaxLightLevel;
    const torchGreen = green * invMaxLightLevel;
    const torchBlue = blue * invMaxLightLevel;
    const torchR = torchRed * torchRed;
    const torchG = torchGreen * torchGreen;
    const torchB = torchBlue * torchBlue;
    const torchAttenuation = 1.0 - s * 0.8;

    return new Color(
      s + torchR * torchAttenuation,
      s + torchG * torchAttenuation,
      s + torchB * torchAttenuation
    );
  }

  /**
   * Get the block type data by a 3D world position.
   *
   * @param px The x coordinate of the position.
   * @param py The y coordinate of the position.
   * @param pz The z coordinate of the position.
   * @returns The block at the given position, or null if it does not exist.
   */
  getBlockAt(px: number, py: number, pz: number) {
    this.checkIsInitialized("get block", false);
    return this.getBlockAtUnchecked(px, py, pz);
  }

  /**
   * Get the highest block at a x/z position. Highest block means the first block counting downwards that
   * isn't empty (`isEmpty`).
   *
   * @param px The x coordinate of the position.
   * @param pz The z coordinate of the position.
   * @returns The highest block at the given position, or 0 if it does not exist.
   */
  getMaxHeightAt(px: number, pz: number) {
    this.checkIsInitialized("get max height", false);

    const vx = Math.floor(px);
    const vz = Math.floor(pz);
    const chunk = this.getLoadedChunkAtVoxel(vx, vz);
    if (!chunk) {
      return 0;
    }

    const blockCache = this.maxHeightBlockCache;
    blockCache.clear();
    const getCachedBlock = (id: number) => {
      let block = blockCache.get(id);
      if (!block) {
        block = this.getBlockById(id);
        blockCache.set(id, block);
      }
      return block;
    };

    for (let vy = this.options.maxHeight - 1; vy >= 0; vy--) {
      const block = getCachedBlock(chunk.getVoxel(vx, vy, vz));
      if (!block.isEmpty) {
        return vy;
      }
    }

    return 0;
  }

  /**
   * Get the previous value of a voxel by a 3D world position.
   *
   * @param px The x coordinate of the position.
   * @param py The y coordinate of the position.
   * @param pz The z coordinate of the position.
   * @param count By how much to look back in the history. Defaults to `1`.
   * @returns
   */
  getPreviousValueAt(px: number, py: number, pz: number, count = 1) {
    const name = ChunkUtils.getVoxelNameAt(px, py, pz);
    const arr = this.oldBlocks.get(name);
    if (!arr) {
      return 0;
    }

    return arr[arr.length - count] ?? 0;
  }

  getBlockOf(idOrName: number | string) {
    if (typeof idOrName === "number") {
      return this.getBlockById(idOrName);
    }

    return this.getBlockByName(idOrName);
  }

  private normalizeBlockNameLookup(name: string) {
    for (let index = 0; index < name.length; index++) {
      const code = name.charCodeAt(index);
      if (code >= 65 && code <= 90) {
        return name.toLowerCase();
      }
      if (code > 127) {
        return name.toLowerCase();
      }
    }
    return name;
  }

  /**
   * Get the block type data by a block id.
   *
   * @param id The block id.
   * @returns The block data for the given id, or null if it does not exist.
   */
  getBlockById(id: number) {
    const block = this.registry.blocksById.get(id);

    if (!block) {
      throw new Error(`Block with id ${id} does not exist`);
    }

    return block;
  }

  getBlockByIdSafe(id: number) {
    return this.registry.blocksById.get(id) ?? null;
  }

  /**
   * Get the block type data by a block name.
   *
   * @param name The block name.
   * @returns The block data for the given name, or null if it does not exist.
   */
  getBlockByName(name: string) {
    const block = this.registry.blocksByName.get(
      this.normalizeBlockNameLookup(name)
    );

    if (!block) {
      throw new Error(`Block with name ${name} does not exist`);
    }

    return block;
  }

  getBlockEntityDataAt(px: number, py: number, pz: number): T | null {
    this.checkIsInitialized("get block entity data", false);

    const vx = Math.floor(px);
    const vy = Math.floor(py);
    const vz = Math.floor(pz);
    const voxelName = ChunkUtils.getVoxelNameAt(vx, vy, vz);

    return this.blockEntitiesMap.get(voxelName)?.data ?? null;
  }

  getBlockEntityIdAt(px: number, py: number, pz: number): string | null {
    this.checkIsInitialized("get block entity id", false);

    const vx = Math.floor(px);
    const vy = Math.floor(py);
    const vz = Math.floor(pz);
    const voxelName = ChunkUtils.getVoxelNameAt(vx, vy, vz);

    return this.blockEntitiesMap.get(voxelName)?.id ?? null;
  }

  setBlockEntityDataAt(px: number, py: number, pz: number, data: T) {
    this.checkIsInitialized("set block entity data", false);

    const vx = Math.floor(px);
    const vy = Math.floor(py);
    const vz = Math.floor(pz);
    const voxelName = ChunkUtils.getVoxelNameAt(vx, vy, vz);

    const old = this.blockEntitiesMap.get(voxelName);
    if (!old) {
      return;
    }

    this.packets.push({
      type: "METHOD",
      method: {
        name: "vox-builtin:update-block-entity",
        payload: JSON.stringify({
          id: old.id,
          json: JSON.stringify(data),
        }),
      },
    });
  }

  /**
   * Get the status of a chunk.
   *
   * @param cx The x 2D coordinate of the chunk.
   * @param cz The z 2D coordinate of the chunk.
   * @returns The status of the chunk.
   */
  getChunkStatus(
    cx: number,
    cz: number
  ): "to request" | "requested" | "processing" | "loaded" | null {
    const name = ChunkUtils.getChunkNameAt(cx, cz);
    const stage = this.chunkPipeline.getStage(name);

    if (stage === "loaded") return "loaded";
    if (stage === "processing") return "processing";
    if (stage === "requested") return "requested";

    return null;
  }

  private resolveChunkMaterialForBlock(
    block: Block,
    faceName?: string,
    voxel?: Coords3
  ) {
    let materialKey: string;

    if (voxel && faceName && block.isolatedFaces.has(faceName)) {
      materialKey = this.makeChunkMaterialKey(block.id, faceName, voxel);
    } else if (faceName && block.independentFaces.has(faceName)) {
      const independentMaterialKeys = this.chunkMaterialIndependentKeyById.get(
        block.id
      );
      materialKey =
        independentMaterialKeys?.get(faceName) ??
        this.makeChunkMaterialKey(block.id, faceName);
    } else {
      materialKey =
        this.chunkMaterialBaseKeyById.get(block.id) ??
        this.makeChunkMaterialKey(block.id);
    }

    return this.chunkRenderer.materials.get(materialKey);
  }

  private getBlockFaceMaterialByIdWithoutCheck(
    id: number,
    faceName?: string,
    voxel?: Coords3
  ) {
    const materials = this.chunkRenderer.materials;
    if (faceName) {
      const independentMaterialKey =
        this.chunkMaterialIndependentKeyById.get(id)?.get(faceName);
      if (independentMaterialKey !== undefined) {
        return materials.get(independentMaterialKey);
      }
      if (voxel) {
        const block = this.registry.blocksById.get(id);
        if (!block) {
          return undefined;
        }
        if (block.isolatedFaces.has(faceName)) {
          return materials.get(this.makeChunkMaterialKey(id, faceName, voxel));
        }
      }
    }
    const baseMaterialKey = this.chunkMaterialBaseKeyById.get(id);
    if (baseMaterialKey !== undefined) {
      return materials.get(baseMaterialKey);
    }
    return materials.get(this.makeChunkMaterialKey(id));
  }

  getBlockFaceMaterial(
    idOrName: number | string,
    faceName?: string,
    voxel?: Coords3
  ) {
    this.checkIsInitialized("get material", false);

    const block = this.getBlockOf(idOrName);
    return this.resolveChunkMaterialForBlock(block, faceName, voxel);
  }

  getTextureInfo(): {
    sharedAtlas: { canvas: HTMLCanvasElement; countPerSide: number } | null;
    textures: TextureInfo[];
  } {
    this.checkIsInitialized("get texture info", false);

    const textures: TextureInfo[] = [];

    let sharedAtlas: {
      canvas: HTMLCanvasElement;
      countPerSide: number;
    } | null = null;

    let blockEntries = this.registry.blocksById.entries();
    let blockEntry = blockEntries.next();
    while (!blockEntry.done) {
      const [id, block] = blockEntry.value;
      const blockFaces = block.faces;
      for (let faceIndex = 0; faceIndex < blockFaces.length; faceIndex++) {
        const face = blockFaces[faceIndex];
        const isIsolated = face.isolated;
        const isIndependent = face.independent && !face.isolated;

        const materialKey = this.makeChunkMaterialKey(
          id,
          isIndependent || isIsolated ? face.name : undefined
        );
        const mat = this.chunkRenderer.materials.get(materialKey);

        if (!mat) continue;

        const isAtlas = mat.map instanceof AtlasTexture;

        if (!isIndependent && !isIsolated && isAtlas && !sharedAtlas) {
          sharedAtlas = {
            canvas: (mat.map as AtlasTexture).canvas,
            countPerSide: (mat.map as AtlasTexture).countPerSide,
          };
        }

        let canvas: HTMLCanvasElement | null = null;
        if (isAtlas) {
          canvas = (mat.map as AtlasTexture).canvas;
        } else if (mat.map?.image instanceof HTMLCanvasElement) {
          canvas = mat.map.image;
        }

        textures.push({
          blockId: id,
          blockName: block.name,
          faceName: face.name,
          type: isIsolated
            ? "isolated"
            : isIndependent
            ? "independent"
            : "shared",
          canvas,
          range: face.range,
          materialKey,
        });
      }
      blockEntry = blockEntries.next();
    }

    return { sharedAtlas, textures };
  }

  addChunkInitListener = (
    coords: Coords2,
    listener: (chunk: Chunk) => void
  ) => {
    return this.addChunkInitListenerAt(coords[0], coords[1], listener);
  };

  addChunkInitListenerAt = (
    cx: number,
    cz: number,
    listener: (chunk: Chunk) => void
  ) => {
    const name = ChunkUtils.getChunkNameAt(cx, cz);

    let listeners = this.chunkInitializeListeners.get(name);
    if (!listeners) {
      listeners = new Set();
      this.chunkInitializeListeners.set(name, listeners);
    }
    listeners.add(listener);

    return () => {
      const current = this.chunkInitializeListeners.get(name);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.chunkInitializeListeners.delete(name);
    };
  };

  addBlockUpdateListener = (listener: BlockUpdateListener) => {
    this.blockUpdateListeners.add(listener);

    return () => {
      this.blockUpdateListeners.delete(listener);
    };
  };

  addBlockEntityUpdateListener = (listener: BlockEntityUpdateListener<T>) => {
    this.blockEntityUpdateListeners.add(listener);

    return () => {
      this.blockEntityUpdateListeners.delete(listener);
    };
  };

  /**
   * Register a typed event listener for chunk lifecycle events.
   *
   * @param event The event name to listen to.
   * @param listener The callback function to execute when the event is emitted.
   * @returns The world instance for chaining.
   */
  public on<K extends keyof WorldChunkEvents>(
    event: K,
    listener: WorldChunkEvents[K]
  ): this {
    this.chunkEvents.on(event, listener);
    return this;
  }

  /**
   * Unregister a typed event listener for chunk lifecycle events.
   *
   * @param event The event name to stop listening to.
   * @param listener The callback function to remove.
   * @returns The world instance for chaining.
   */
  public off<K extends keyof WorldChunkEvents>(
    event: K,
    listener: WorldChunkEvents[K]
  ): this {
    this.chunkEvents.off(event, listener);
    return this;
  }

  /**
   * Register a one-time typed event listener for chunk lifecycle events.
   *
   * @param event The event name to listen to once.
   * @param listener The callback function to execute when the event is emitted.
   * @returns The world instance for chaining.
   */
  public once<K extends keyof WorldChunkEvents>(
    event: K,
    listener: WorldChunkEvents[K]
  ): this {
    this.chunkEvents.once(event, listener);
    return this;
  }

  /**
   * Emit a typed chunk lifecycle event.
   * @hidden
   */
  private emitChunkEvent<K extends keyof WorldChunkEvents>(
    event: K,
    data: Parameters<WorldChunkEvents[K]>[0]
  ): void {
    this.chunkEvents.emit(event, data);
  }

  /**
   * Whether or not if this chunk coordinate is within (inclusive) the world's bounds. That is, if this chunk coordinate
   * is within {@link WorldServerOptions | WorldServerOptions.minChunk} and {@link WorldServerOptions | WorldServerOptions.maxChunk}.
   *
   * @param cx The chunk's X position.
   * @param cz The chunk's Z position.
   * @returns Whether or not this chunk is within the bounds of the world.
   */
  isWithinWorld(cx: number, cz: number) {
    const { minChunk, maxChunk } = this.options;

    return (
      cx >= minChunk[0] &&
      cx <= maxChunk[0] &&
      cz >= minChunk[1] &&
      cz <= maxChunk[1]
    );
  }

  isChunkInView(
    center: Coords2,
    target: Coords2,
    direction: Vector3,
    threshold: number
  ) {
    return this.isChunkInViewAt(
      center[0],
      center[1],
      target[0],
      target[1],
      direction,
      threshold
    );
  }

  private isChunkInViewAt(
    cx: number,
    cz: number,
    tx: number,
    tz: number,
    direction: Vector3,
    threshold: number
  ) {
    const safeRadius = Math.max(this.renderRadius - 2, 1);
    const safeRadiusSquared = safeRadius * safeRadius;
    return this.isChunkInViewByTanAt(
      cx,
      cz,
      tx,
      tz,
      direction.x,
      direction.z,
      Math.tan(threshold),
      safeRadiusSquared
    );
  }

  private isChunkInViewByTanAt(
    cx: number,
    cz: number,
    tx: number,
    tz: number,
    directionX: number,
    directionZ: number,
    tanThreshold: number,
    safeRadiusSquared: number
  ) {
    const dx = tx - cx;
    const dz = tz - cz;

    if (dx * dx + dz * dz < safeRadiusSquared) {
      return true;
    }

    const dot = dz * directionZ + dx * directionX;
    if (dot <= 0) {
      return false;
    }
    const det = dz * directionX - dx * directionZ;

    return Math.abs(det) < dot * tanThreshold;
  }

  /**
   * Raycast through the world of voxels and return the details of the first block intersection.
   *
   * @param origin The origin of the ray.
   * @param direction The direction of the ray.
   * @param maxDistance The maximum distance of the ray.
   * @param options The options for the ray.
   * @param options.ignoreFluids Whether or not to ignore fluids. Defaults to `true`.
   * @param options.ignorePassables Whether or not to ignore passable blocks. Defaults to `false`.
   * @param options.ignoreSeeThrough Whether or not to ignore see through blocks. Defaults to `false`.
   * @param options.ignoreList A list of blocks to ignore. Defaults to `[]`.
   * @returns
   */
  raycastVoxels = (
    origin: Coords3,
    direction: Coords3,
    maxDistance: number,
    options: {
      ignoreFluids?: boolean;
      ignorePassables?: boolean;
      ignoreSeeThrough?: boolean;
      ignoreList?: number[];
    } = {}
  ) => {
    this.checkIsInitialized("raycast voxels", false);

    const ignoreFluids = options.ignoreFluids ?? true;
    const ignorePassables = options.ignorePassables ?? false;
    const ignoreSeeThrough = options.ignoreSeeThrough ?? false;
    const ignoreListSource = options.ignoreList;
    const ignoreListCount = ignoreListSource?.length ?? 0;
    const ignoreList =
      ignoreListSource && ignoreListCount > 4
        ? new Set(ignoreListSource)
        : null;

    return raycast(
      (wx, wy, wz) => {
        const block = this.getBlockAt(wx, wy, wz);

        if (!block) {
          return EMPTY_AABBS;
        }

        const {
          id,
          isFluid,
          isWaterlogged,
          isPassable,
          isSeeThrough,
          aabbs,
          dynamicFn,
          isDynamic,
          dynamicPatterns,
        } = block;

        if (ignoreList) {
          if (ignoreList.has(id)) {
            return EMPTY_AABBS;
          }
        } else if (ignoreListCount > 0 && ignoreListSource) {
          let isIgnored = false;
          for (let ignoreIndex = 0; ignoreIndex < ignoreListCount; ignoreIndex++) {
            if (ignoreListSource[ignoreIndex] === id) {
              isIgnored = true;
              break;
            }
          }
          if (isIgnored) {
            return EMPTY_AABBS;
          }
        }

        if (
          (isFluid && ignoreFluids && !isWaterlogged) ||
          (isPassable && ignorePassables) ||
          (isSeeThrough && ignoreSeeThrough)
        ) {
          return EMPTY_AABBS;
        }

        const rotation = this.getVoxelRotationAt(wx, wy, wz);
        const vx = Math.floor(wx);
        const vy = Math.floor(wy);
        const vz = Math.floor(wz);
        const coords = this.raycastVoxelCoords;
        coords[0] = vx;
        coords[1] = vy;
        coords[2] = vz;

        if (dynamicPatterns && dynamicPatterns.length > 0) {
          const aabbsWithFlags = this.getBlockAABBsForDynamicPatterns(
            wx,
            wy,
            wz,
            dynamicPatterns
          );
          const translatedAabbs = new Array<AABB>(aabbsWithFlags.length);
          for (let index = 0; index < aabbsWithFlags.length; index++) {
            const aabbWithFlag = aabbsWithFlags[index];
            translatedAabbs[index] = aabbWithFlag.worldSpace
              ? aabbWithFlag.aabb.translate(coords)
              : rotation.rotateAABB(aabbWithFlag.aabb).translate(coords);
          }
          return translatedAabbs;
        }

        const resolvedAabbs =
          isDynamic && dynamicFn ? dynamicFn([vx, vy, vz]).aabbs : aabbs;
        const translatedAabbs = new Array<AABB>(resolvedAabbs.length);
        for (let index = 0; index < resolvedAabbs.length; index++) {
          translatedAabbs[index] = rotation
            .rotateAABB(resolvedAabbs[index])
            .translate(coords);
        }
        return translatedAabbs;
      },
      origin,
      direction,
      maxDistance
    );
  };

  getBlockAABBsByIdAt = (id: number, vx: number, vy: number, vz: number) => {
    const block = this.getBlockById(id);

    if (block.dynamicPatterns && block.dynamicPatterns.length > 0) {
      const aabbsWithFlags = this.getBlockAABBsForDynamicPatterns(
        vx,
        vy,
        vz,
        block.dynamicPatterns
      );
      const resolvedAabbs = new Array<AABB>(aabbsWithFlags.length);
      for (let index = 0; index < aabbsWithFlags.length; index++) {
        resolvedAabbs[index] = aabbsWithFlags[index].aabb;
      }
      return resolvedAabbs;
    }

    return block.aabbs;
  };

  getBlockAABBsAt = (vx: number, vy: number, vz: number) => {
    const id = this.getVoxelAt(vx, vy, vz);
    return this.getBlockAABBsByIdAt(id, vx, vy, vz);
  };

  getBlockAABBsForDynamicPatterns = (
    vx: number,
    vy: number,
    vz: number,
    dynamicPatterns: BlockDynamicPattern[]
  ): { aabb: AABB; worldSpace: boolean }[] => {
    const voxelCoords = this.dynamicAABBRuleCoords;
    voxelCoords[0] = vx;
    voxelCoords[1] = vy;
    voxelCoords[2] = vz;

    for (let patternIndex = 0; patternIndex < dynamicPatterns.length; patternIndex++) {
      const dynamicPattern = dynamicPatterns[patternIndex];
      const aabbsWithFlags: { aabb: AABB; worldSpace: boolean }[] = [];
      const parts = dynamicPattern.parts;

      for (let partIndex = 0; partIndex < parts.length; partIndex++) {
        const part = parts[partIndex];
        if (
          !BlockUtils.evaluateBlockRule(
            part.rule,
            voxelCoords,
            this.dynamicRuleQuery
          )
        ) {
          continue;
        }

        const worldSpace = (part as { worldSpace?: boolean }).worldSpace ?? false;
        const partAabbs = part.aabbs;
        for (let aabbIndex = 0; aabbIndex < partAabbs.length; aabbIndex++) {
          const aabb = partAabbs[aabbIndex];
          const resolvedAabb =
            aabb instanceof AABB
              ? aabb
              : new AABB(
                  (aabb as AABB).minX,
                  (aabb as AABB).minY,
                  (aabb as AABB).minZ,
                  (aabb as AABB).maxX,
                  (aabb as AABB).maxY,
                  (aabb as AABB).maxZ
                );
          aabbsWithFlags.push({ aabb: resolvedAabb, worldSpace });
        }
      }

      if (aabbsWithFlags.length > 0) {
        return aabbsWithFlags;
      }
    }

    return [];
  };

  getBlockPassableForDynamicPatterns = (
    vx: number,
    vy: number,
    vz: number,
    dynamicPatterns: BlockDynamicPattern[],
    defaultPassable: boolean
  ): boolean => {
    const voxelCoords = this.dynamicPassableRuleCoords;
    voxelCoords[0] = vx;
    voxelCoords[1] = vy;
    voxelCoords[2] = vz;

    for (let patternIndex = 0; patternIndex < dynamicPatterns.length; patternIndex++) {
      const parts = dynamicPatterns[patternIndex].parts;
      for (let partIndex = 0; partIndex < parts.length; partIndex++) {
        const part = parts[partIndex];
        if (
          BlockUtils.evaluateBlockRule(
            part.rule,
            voxelCoords,
            this.dynamicRuleQuery
          ) &&
          part.isPassable !== undefined
        ) {
          return part.isPassable;
        }
      }
    }

    return defaultPassable;
  };

  getBlockFacesForDynamicPatterns = (
    blockId: number,
    dynamicPatterns: BlockDynamicPattern[]
  ): Block["faces"] => {
    const voxelCoords: Coords3 = [0, 0, 0];
    const ruleFunctions = {
      getVoxelAt: () => blockId,
      getVoxelRotationAt: () => ZERO_BLOCK_ROTATION,
      getVoxelStageAt: () => 0,
    };

    for (let patternIndex = 0; patternIndex < dynamicPatterns.length; patternIndex++) {
      const dynamicPattern = dynamicPatterns[patternIndex];
      const faces: Block["faces"] = [];
      const parts = dynamicPattern.parts;

      for (let partIndex = 0; partIndex < parts.length; partIndex++) {
        const part = parts[partIndex];
        if (!BlockUtils.evaluateBlockRule(part.rule, voxelCoords, ruleFunctions)) {
          continue;
        }

        const partFaces = part.faces;
        const start = faces.length;
        faces.length = start + partFaces.length;
        for (let faceIndex = 0; faceIndex < partFaces.length; faceIndex++) {
          faces[start + faceIndex] = partFaces[faceIndex];
        }
      }

      if (faces.length > 0) {
        return faces;
      }
    }

    return [];
  };

  /**
   * This sends a block update to the server and updates across the network. Block updates are queued to
   * {@link World.chunks | World.chunks.toUpdate} and scaffolded to the server {@link WorldClientOptions | WorldClientOptions.maxUpdatesPerUpdate} times
   * per tick. Keep in mind that for rotation and y-rotation, the value should be one of the following:
   * - Rotation: {@link PX_ROTATION} | {@link NX_ROTATION} | {@link PY_ROTATION} | {@link NY_ROTATION} | {@link PZ_ROTATION} | {@link NZ_ROTATION}
   * - Y-rotation: 0 to {@link Y_ROT_SEGMENTS} - 1.
   *
   * This ignores blocks that are not defined, and also ignores rotations for blocks that are not {@link Block | Block.rotatable} (Same for if
   * block is not {@link Block | Block.yRotatable}).
   *
   * @param vx The voxel's X position.
   * @param vy The voxel's Y position.
   * @param vz The voxel's Z position.
   * @param type The type of the voxel.
   * @param options The options for the voxel.
   * @param options.rotation The major axis rotation of the voxel.
   * @param options.yRotation The Y rotation on the major axis. Applies to blocks with major axis of PY or NY.
   * @param options.stage The stage of the voxel.
   * @param options.source Whether the update is from the client or server. Defaults to "client".
   */
  updateVoxel = (
    vx: number,
    vy: number,
    vz: number,
    type: number,
    options: {
      rotation?: number;
      yRotation?: number;
      stage?: number;
      source?: "client" | "server";
    }
  ) => {
    const {
      rotation = PY_ROTATION,
      yRotation = 0,
      stage = 0,
      source = "client",
    } = options;
    this.updateVoxels(
      [{ vx, vy, vz, type, rotation, yRotation, stage }],
      source
    );
  };

  /**
   * This sends a list of block updates to the server and updates across the network. Block updates are queued to
   * {@link World.chunks | World.chunks.toUpdate} and scaffolded to the server {@link WorldClientOptions | WorldClientOptions.maxUpdatesPerUpdate} times
   * per tick. Keep in mind that for rotation and y-rotation, the value should be one of the following:
   *
   * - Rotation: {@link PX_ROTATION} | {@link NX_ROTATION} | {@link PY_ROTATION} | {@link NY_ROTATION} | {@link PZ_ROTATION} | {@link NZ_ROTATION}
   * - Y-rotation: 0 to {@link Y_ROT_SEGMENTS} - 1.
   *
   * This ignores blocks that are not defined, and also ignores rotations for blocks that are not {@link Block | Block.rotatable} (Same for if
   * block is not {@link Block | Block.yRotatable}).
   *
   * @param updates A list of updates to send to the server.
   */
  updateVoxels = (
    updates: BlockUpdate[],
    source: "client" | "server" = "client"
  ) => {
    this.checkIsInitialized("update voxels", false);
    let blockCache: Map<number, Block | null> | null = null;
    let missingBlockIds: Set<number> | null = null;
    const getCachedBlock = (id: number) => {
      if (!blockCache) {
        blockCache = new Map();
      }

      const cachedBlock = blockCache.get(id);
      if (cachedBlock !== undefined) {
        return cachedBlock;
      }

      const block = this.getBlockByIdSafe(id);
      blockCache.set(id, block);
      return block;
    };

    for (let updateIndex = 0; updateIndex < updates.length; updateIndex++) {
      const update = updates[updateIndex];
      if (update.vy < 0 || update.vy >= this.options.maxHeight) {
        continue;
      }

      const { vx, vy, vz, type, rotation, yRotation, stage } = update;
      const block = getCachedBlock(type);
      if (!block) {
        if (!missingBlockIds) {
          missingBlockIds = new Set();
        }
        if (!missingBlockIds.has(type)) {
          missingBlockIds.add(type);
          console.warn(`Block ID ${type} does not exist.`);
        }
        continue;
      }

      const currId = this.getVoxelAtUnchecked(vx, vy, vz);
      const currRot = this.getVoxelRotationAtUnchecked(vx, vy, vz);
      const currStage = this.getVoxelStageAtUnchecked(vx, vy, vz);
      const currYRotation = BlockRotation.decode(currRot)[1];
      const isSameBlockType = currId === type;

      const rotationFallback = isSameBlockType ? currRot.value : PY_ROTATION;
      const normalizedRotationCandidate =
        rotation === undefined || Number.isNaN(rotation)
          ? rotationFallback
          : rotation;
      const normalizedRotation = block.rotatable
        ? normalizedRotationCandidate
        : PY_ROTATION;

      const yRotationFallback = isSameBlockType ? currYRotation : 0;
      const normalizedYRotation =
        block.yRotatable && yRotation !== undefined && !Number.isNaN(yRotation)
          ? yRotation
          : yRotationFallback;

      const stageFallback = isSameBlockType ? currStage : 0;
      const normalizedStage =
        stage === undefined || Number.isNaN(stage) ? stageFallback : stage;

      if (
        isSameBlockType &&
        currRot.value === normalizedRotation &&
        currYRotation === normalizedYRotation &&
        currStage === normalizedStage
      ) {
        continue;
      }

      const normalizedUpdate: BlockUpdate = {
        vx,
        vy,
        vz,
        type,
        rotation: normalizedRotation,
        yRotation: normalizedYRotation,
        stage: normalizedStage,
      };
      this.blockUpdatesQueue.push({ source, update: normalizedUpdate });
    }

    this.processClientUpdates();
  };

  private applyServerUpdatesImmediately(updates: UpdateProtocol[]) {
    const blockUpdates = new Array<BlockUpdateWithSource>(updates.length);
    let blockUpdateCount = 0;
    const blockCache = this.applyServerUpdateBlockCache;
    blockCache.clear();
    const getCachedBlock = (id: number) => {
      let block = blockCache.get(id);
      if (!block) {
        block = this.getBlockById(id);
        blockCache.set(id, block);
      }

      return block;
    };

    for (let updateIndex = 0; updateIndex < updates.length; updateIndex++) {
      const update = updates[updateIndex];
      const { vx, vy, vz, voxel } = update;

      if (vy < 0 || vy >= this.options.maxHeight) continue;

      const chunk = this.getLoadedChunkAtVoxel(vx, vz);
      if (!chunk) {
        continue;
      }

      const currentRaw = chunk.getRawValue(vx, vy, vz);
      if (currentRaw === voxel) {
        continue;
      }

      const type = BlockUtils.extractID(voxel);
      const block = getCachedBlock(type);
      let rotationValue = PY_ROTATION;
      let yRotationValue = 0;
      if (block.rotatable || block.yRotatable) {
        const rotation = BlockUtils.extractRotation(voxel);
        [rotationValue, yRotationValue] = BlockRotation.decode(rotation);
      }
      const stage = BlockUtils.extractStage(voxel);

      blockUpdates[blockUpdateCount] = {
        source: "server",
        update: {
          vx,
          vy,
          vz,
          type,
          rotation: rotationValue,
          yRotation: yRotationValue,
          stage,
        },
      };
      blockUpdateCount++;
    }

    if (blockUpdateCount === 0) return;
    blockUpdates.length = blockUpdateCount;

    this.isTrackingChunks = true;

    let processedOffset = 0;
    while (processedOffset < blockUpdates.length) {
      const { consumedCount } = this.processLightUpdates(
        blockUpdates,
        processedOffset,
        blockUpdates.length,
        false
      );
      if (consumedCount === 0) {
        break;
      }
      processedOffset += consumedCount;
    }

    this.flushAccumulatedLightOps();
    this.isTrackingChunks = false;

    if (this.options.useLightWorkers) {
      if (!this.hasPendingLightJobs() && this.activeLightBatch === null) {
        this.processDirtyChunks();
      }
    } else {
      this.processDirtyChunks();
    }
  }

  floodLight(
    queue: LightNode[],
    color: LightColor,
    min?: Coords3,
    max?: Coords3
  ) {
    if (!queue.length) {
      return;
    }

    const { maxHeight, minChunk, maxChunk, maxLightLevel, chunkSize } =
      this.options;

    const [startCX, startCZ] = minChunk;
    const [endCX, endCZ] = maxChunk;
    const hasMinBounds = min !== undefined;
    const minBoundX = hasMinBounds ? min[0] : 0;
    const minBoundZ = hasMinBounds ? min[2] : 0;
    const hasMaxBounds = max !== undefined;
    const maxBoundX = hasMaxBounds ? max[0] : 0;
    const maxBoundZ = hasMaxBounds ? max[2] : 0;

    const isSunlight = color === "SUNLIGHT";

    const voxelStateCache = new Map<
      string,
      { block: Block; rotation: BlockRotation }
    >();
    const getCachedVoxelState = (vx: number, vy: number, vz: number) => {
      const key = ChunkUtils.getVoxelNameAt(vx, vy, vz);
      let state = voxelStateCache.get(key);
      if (!state) {
        state = {
          block: this.getBlockAtUnchecked(vx, vy, vz),
          rotation: this.getVoxelRotationAtUnchecked(vx, vy, vz),
        };
        voxelStateCache.set(key, state);
      }
      return state;
    };

    let head = 0;
    while (head < queue.length) {
      const node = queue[head++];
      const { voxel, level } = node;

      if (level === 0) {
        continue;
      }

      const [vx, vy, vz] = voxel;
      const { block: sourceBlock, rotation: sourceRotation } =
        getCachedVoxelState(vx, vy, vz);
      const sourceTransparency =
        !isSunlight &&
        BlockUtils.getBlockTorchLightLevel(sourceBlock, color) > 0
          ? [true, true, true, true, true, true]
          : BlockUtils.getBlockRotatedTransparency(sourceBlock, sourceRotation);

      for (
        let neighborIndex = 0;
        neighborIndex < VOXEL_NEIGHBORS.length;
        neighborIndex++
      ) {
        const neighborOffset = VOXEL_NEIGHBORS[neighborIndex];
        const ox = neighborOffset[0];
        const oy = neighborOffset[1];
        const oz = neighborOffset[2];
        const nvy = vy + oy;

        if (nvy < 0 || nvy >= maxHeight) {
          continue;
        }

        const nvx = vx + ox;
        const nvz = vz + oz;
        const ncx = Math.floor(nvx / chunkSize);
        const ncz = Math.floor(nvz / chunkSize);

        if (
          ncx < startCX ||
          ncx > endCX ||
          ncz < startCZ ||
          ncz > endCZ ||
          (hasMinBounds && (nvx < minBoundX || nvz < minBoundZ)) ||
          (hasMaxBounds && (nvx >= maxBoundX || nvz >= maxBoundZ))
        ) {
          continue;
        }

        const nextVoxel = [nvx, nvy, nvz] as Coords3;
        const { block: nBlock, rotation: nRotation } = getCachedVoxelState(
          nvx,
          nvy,
          nvz
        );
        const nTransparency = BlockUtils.getBlockRotatedTransparency(
          nBlock,
          nRotation
        );
        const reduce =
          isSunlight &&
          !nBlock.lightReduce &&
          oy === -1 &&
          level === maxLightLevel
            ? 0
            : 1;

        if (level <= reduce) {
          continue;
        }

        const nextLevel = level - reduce;

        if (
          !LightUtils.canEnter(sourceTransparency, nTransparency, ox, oy, oz) ||
          (isSunlight
            ? this.getSunlightAtUnchecked(nvx, nvy, nvz)
            : this.getTorchLightAtUnchecked(nvx, nvy, nvz, color)) >= nextLevel
        ) {
          continue;
        }

        if (isSunlight) {
          this.setSunlightAt(nvx, nvy, nvz, nextLevel);
        } else {
          this.setTorchLightAt(nvx, nvy, nvz, nextLevel, color);
        }

        queue.push({ voxel: nextVoxel, level: nextLevel });
      }
    }
  }
  public removeLight(voxel: Coords3, color: LightColor) {
    const { maxHeight, maxLightLevel, chunkSize, minChunk, maxChunk } =
      this.options;
    const minChunkX = minChunk[0];
    const minChunkZ = minChunk[1];
    const maxChunkX = maxChunk[0];
    const maxChunkZ = maxChunk[1];

    const fill: LightNode[] = [];
    const queue: LightNode[] = [];
    const voxelStateCache = new Map<
      string,
      { block: Block; rotation: BlockRotation }
    >();
    const getCachedVoxelState = (vx: number, vy: number, vz: number) => {
      const key = ChunkUtils.getVoxelNameAt(vx, vy, vz);
      let state = voxelStateCache.get(key);
      if (!state) {
        state = {
          block: this.getBlockAtUnchecked(vx, vy, vz),
          rotation: this.getVoxelRotationAtUnchecked(vx, vy, vz),
        };
        voxelStateCache.set(key, state);
      }
      return state;
    };

    const isSunlight = color === "SUNLIGHT";
    const [vx, vy, vz] = voxel;

    queue.push({
      voxel,
      level: isSunlight
        ? this.getSunlightAtUnchecked(vx, vy, vz)
        : this.getTorchLightAtUnchecked(vx, vy, vz, color),
    });

    if (isSunlight) {
      this.setSunlightAt(vx, vy, vz, 0);
    } else {
      this.setTorchLightAt(vx, vy, vz, 0, color);
    }

    let head = 0;
    while (head < queue.length) {
      const node = queue[head++];
      const { voxel, level } = node;

      const [vx, vy, vz] = voxel;

      for (
        let neighborIndex = 0;
        neighborIndex < VOXEL_NEIGHBORS.length;
        neighborIndex++
      ) {
        const neighborOffset = VOXEL_NEIGHBORS[neighborIndex];
        const ox = neighborOffset[0];
        const oy = neighborOffset[1];
        const oz = neighborOffset[2];
        const nvy = vy + oy;

        if (nvy < 0 || nvy >= maxHeight) {
          continue;
        }

        const nvx = vx + ox;
        const nvz = vz + oz;
        const ncx = Math.floor(nvx / chunkSize);
        const ncz = Math.floor(nvz / chunkSize);

        if (
          ncx < minChunkX ||
          ncz < minChunkZ ||
          ncx > maxChunkX ||
          ncz > maxChunkZ
        ) {
          continue;
        }

        const { block: nBlock, rotation } = getCachedVoxelState(nvx, nvy, nvz);
        const nTransparency = BlockUtils.getBlockRotatedTransparency(
          nBlock,
          rotation
        );

        if (
          (isSunlight
            ? true
            : BlockUtils.getBlockTorchLightLevel(nBlock, color) === 0) &&
          !LightUtils.canEnterInto(nTransparency, ox, oy, oz)
        ) {
          continue;
        }

        const nVoxel = [nvx, nvy, nvz] as Coords3;
        const nl = isSunlight
          ? this.getSunlightAtUnchecked(nvx, nvy, nvz)
          : this.getTorchLightAtUnchecked(nvx, nvy, nvz, color);

        if (nl === 0) {
          continue;
        }

        if (
          nl < level ||
          (isSunlight &&
            oy === -1 &&
            level === maxLightLevel &&
            nl === maxLightLevel)
        ) {
          queue.push({ voxel: nVoxel, level: nl });

          if (isSunlight) {
            this.setSunlightAt(nvx, nvy, nvz, 0);
          } else {
            this.setTorchLightAt(nvx, nvy, nvz, 0, color);
          }
        } else if (isSunlight && oy === -1 ? nl > level : nl >= level) {
          fill.push({ voxel: nVoxel, level: nl });
        }
      }
    }

    this.floodLight(fill, color);
  }

  /**
   * Batch remove light from multiple voxels that previously emitted the same light color.
   * This drastically improves performance when many contiguous light sources are removed at once.
   */
  public removeLightsBatch(voxels: Coords3[], color: LightColor) {
    if (!voxels.length) return;

    const { maxHeight, maxLightLevel } = this.options;
    const isSunlight = color === "SUNLIGHT";

    const queue: LightNode[] = [];
    const fill: LightNode[] = [];
    const voxelStateCache = new Map<
      string,
      { block: Block; rotation: BlockRotation }
    >();
    const getCachedVoxelState = (vx: number, vy: number, vz: number) => {
      const key = ChunkUtils.getVoxelNameAt(vx, vy, vz);
      let state = voxelStateCache.get(key);
      if (!state) {
        state = {
          block: this.getBlockAtUnchecked(vx, vy, vz),
          rotation: this.getVoxelRotationAtUnchecked(vx, vy, vz),
        };
        voxelStateCache.set(key, state);
      }
      return state;
    };

    // Initialise the queue with all voxels to be cleared.
    for (let voxelIndex = 0; voxelIndex < voxels.length; voxelIndex++) {
      const voxel = voxels[voxelIndex];
      const vx = voxel[0];
      const vy = voxel[1];
      const vz = voxel[2];
      const level = isSunlight
        ? this.getSunlightAtUnchecked(vx, vy, vz)
        : this.getTorchLightAtUnchecked(vx, vy, vz, color);
      if (level === 0) continue;

      // Push into queue and immediately clear the light so we don't visit twice.
      queue.push({ voxel, level });
      if (isSunlight) {
        this.setSunlightAt(vx, vy, vz, 0);
      } else {
        this.setTorchLightAt(vx, vy, vz, 0, color);
      }
    }

    let head = 0;
    while (head < queue.length) {
      const { voxel, level } = queue[head++];
      const [vx, vy, vz] = voxel;

      for (
        let neighborIndex = 0;
        neighborIndex < VOXEL_NEIGHBORS.length;
        neighborIndex++
      ) {
        const neighborOffset = VOXEL_NEIGHBORS[neighborIndex];
        const ox = neighborOffset[0];
        const oy = neighborOffset[1];
        const oz = neighborOffset[2];
        const nvy = vy + oy;
        if (nvy < 0 || nvy >= maxHeight) continue;

        const nvx = vx + ox;
        const nvz = vz + oz;

        const { block: nBlock, rotation } = getCachedVoxelState(nvx, nvy, nvz);
        const nTransparency = BlockUtils.getBlockRotatedTransparency(
          nBlock,
          rotation
        );

        if (
          !isSunlight &&
          BlockUtils.getBlockTorchLightLevel(nBlock, color) === 0 &&
          !LightUtils.canEnterInto(nTransparency, ox, oy, oz)
        ) {
          continue;
        }

        const nl = isSunlight
          ? this.getSunlightAtUnchecked(nvx, nvy, nvz)
          : this.getTorchLightAtUnchecked(nvx, nvy, nvz, color);
        if (nl === 0) continue;

        if (
          nl < level ||
          (isSunlight &&
            oy === -1 &&
            level === maxLightLevel &&
            nl === maxLightLevel)
        ) {
          queue.push({ voxel: [nvx, nvy, nvz], level: nl });
          if (isSunlight) {
            this.setSunlightAt(nvx, nvy, nvz, 0);
          } else {
            this.setTorchLightAt(nvx, nvy, nvz, 0, color);
          }
        } else if (isSunlight && oy === -1 ? nl > level : nl >= level) {
          fill.push({ voxel: [nvx, nvy, nvz], level: nl });
        }
      }
    }

    // Re-flood remaining valid lights.
    this.floodLight(fill, color);
  }

  /**
   * Get a mesh of the model of the given block.
   *
   * @param id The ID of the block.
   * @param options The options of creating this block mesh.
   * @param options.material The type of material to use for this generated mesh.
   * @param options.separateFaces: Whether or not to separate the faces of the block into different meshes.
   * @param options.crumbs: Whether or not to mess up the block mesh's faces and UVs to make it look like crumbs.
   * @param options.centered: Whether or not to center the geometry vertices around origin (default: false).
   * @param options.cached: Whether to return a cached mesh if available (default: false). When true, the same mesh instance is returned for identical options. Callers should clone the mesh if they need to modify it.
   * @returns A 3D mesh (group) of the block model.
   */
  makeBlockMesh = (
    idOrName: number | string,
    options: Partial<{
      separateFaces: boolean;
      crumbs: boolean;
      material: "basic" | "standard";
      centered: boolean;
      cached: boolean;
    }> = {}
  ) => {
    this.checkIsInitialized("make block mesh", false);

    if (!idOrName) {
      return null;
    }

    const block = this.getBlockOf(idOrName);
    if (!block) return null;

    const { separateFaces, crumbs, material, centered, cached } = {
      separateFaces: false,
      crumbs: false,
      material: "basic",
      centered: false,
      cached: false,
      ...options,
    };

    const canCache = cached && !crumbs && !separateFaces;

    if (canCache) {
      const cacheKey = `${block.id}-${material}-${centered}`;
      const cachedMesh = this.blockMeshCache.get(cacheKey);
      if (cachedMesh) return cachedMesh;
    }

    let { faces } = block;
    const { isSeeThrough, dynamicPatterns } = block;

    if (dynamicPatterns && dynamicPatterns.length > 0) {
      faces = this.getBlockFacesForDynamicPatterns(block.id, dynamicPatterns);
    }

    const geometries = new Map<
      string,
      {
        positions: number[];
        uvs: number[];
        indices: number[];
        material: MeshStandardMaterial | MeshBasicMaterial;
      }
    >();

    for (let index = 0; index < faces.length; index++) {
      const face = faces[index];
      const faceScale = crumbs && separateFaces ? Math.random() + 0.5 : 1;

      const { corners, name, range } = face;

      const identifier = `${block.name}-${name}-${
        separateFaces ? index : "all"
      }`;

      let geometry = geometries.get(identifier);

      if (!geometry) {
        const chunkMat = face.isolated
          ? {
              map: AtlasTexture.makeUnknownTexture(
                this.options.textureUnitDimension
              ),
            }
          : this.getBlockFaceMaterial(block.id, name);

        const matOptions = {
          transparent: isSeeThrough,
          map: chunkMat?.map,
          side: isSeeThrough ? DoubleSide : FrontSide,
        };

        const mat =
          material === "basic"
            ? new MeshBasicMaterial(matOptions)
            : new MeshStandardMaterial(matOptions);

        geometry = {
          positions: [],
          uvs: [],
          indices: [],
          material: mat,
        };
        geometries.set(identifier, geometry);
      }

      const { positions, uvs, indices } = geometry;
      const positionOffset = centered ? 0.5 : 0;

      const ndx = Math.floor(positions.length / 3);
      let { startU, endU, startV, endV } = range;

      if (crumbs) {
        if (Math.random() < 0.5) {
          startU = startU + ((endU - startU) / 2) * Math.random();
          endV = endV - ((endV - startV) / 2) * Math.random();
        } else {
          endU = endU - ((endU - startU) / 2) * Math.random();
          startV = startV + ((endV - startV) / 2) * Math.random();
        }
      }

      for (let cornerIndex = 0; cornerIndex < corners.length; cornerIndex++) {
        const corner = corners[cornerIndex];
        const uv = corner.uv;
        const pos = corner.pos;
        positions.push(
          pos[0] * faceScale - positionOffset,
          pos[1] * faceScale - positionOffset,
          pos[2] * faceScale - positionOffset
        );
        uvs.push(
          uv[0] * (endU - startU) + startU,
          uv[1] * (endV - startV) + startV
        );
      }

      indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
    }

    const group = new Group();

    let geometryEntries = geometries.entries();
    let geometryEntry = geometryEntries.next();
    while (!geometryEntry.done) {
      const [identifier, geometryData] = geometryEntry.value;
      const { positions, uvs, indices, material } = geometryData;
      const geometry = new BufferGeometry();
      geometry.setAttribute(
        "position",
        new Float32BufferAttribute(positions, 3)
      );
      geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      computeFlatNormals(geometry);
      geometry.computeBoundingSphere();
      const mesh = new Mesh(geometry, material);
      mesh.name = identifier;
      group.add(mesh);
      geometryEntry = geometryEntries.next();
    }

    group.name = block.name;

    if (!centered) {
      group.position.x -= 0.5;
      group.position.y -= 0.5;
      group.position.z -= 0.5;
    }

    if (canCache) {
      const cacheKey = `${block.id}-${material}-${centered}`;
      this.blockMeshCache.set(cacheKey, group);
    }

    return group;
  };

  makeBlockFragments = (idOrName: number | string, count: number): Group[] => {
    this.checkIsInitialized("make block fragments", false);

    if (!idOrName) return [];

    const block = this.getBlockOf(idOrName);
    if (!block) return [];

    let { faces } = block;
    const { dynamicPatterns } = block;

    if (dynamicPatterns && dynamicPatterns.length > 0) {
      faces = this.getBlockFacesForDynamicPatterns(block.id, dynamicPatterns);
    }

    if (faces.length === 0) return [];

    const fragments: Group[] = [];

    for (let i = 0; i < count; i++) {
      const face = faces[Math.floor(Math.random() * faces.length)];
      const { range, name } = face;

      const chunkMat = face.isolated
        ? {
            map: AtlasTexture.makeUnknownTexture(
              this.options.textureUnitDimension
            ),
          }
        : this.getBlockFaceMaterial(block.id, name);

      const uRange = range.endU - range.startU;
      const vRange = range.endV - range.startV;
      const patchFraction = 0.25;
      const patchU = uRange * patchFraction;
      const patchV = vRange * patchFraction;
      const u0 = range.startU + Math.random() * (uRange - patchU);
      const v0 = range.startV + Math.random() * (vRange - patchV);
      const u1 = u0 + patchU;
      const v1 = v0 + patchV;

      const w = 0.04 + Math.random() * 0.08;
      const h = 0.04 + Math.random() * 0.08;
      const d = 0.04 + Math.random() * 0.08;
      const geo = new BoxGeometry(w, h, d);

      const uvAttr = geo.getAttribute("uv") as BufferAttribute;
      for (let j = 0; j < uvAttr.count; j++) {
        uvAttr.setXY(
          j,
          u0 + uvAttr.getX(j) * (u1 - u0),
          v0 + uvAttr.getY(j) * (v1 - v0)
        );
      }
      uvAttr.needsUpdate = true;

      const posAttr = geo.getAttribute("position") as BufferAttribute;
      const jitter = 0.015;
      for (let j = 0; j < posAttr.count; j++) {
        posAttr.setXYZ(
          j,
          posAttr.getX(j) + (Math.random() - 0.5) * jitter,
          posAttr.getY(j) + (Math.random() - 0.5) * jitter,
          posAttr.getZ(j) + (Math.random() - 0.5) * jitter
        );
      }
      posAttr.needsUpdate = true;

      geo.computeVertexNormals();
      geo.computeBoundingSphere();

      const mat = new MeshBasicMaterial({ map: chunkMat?.map });
      const mesh = new Mesh(geo, mat);
      const group = new Group();
      group.add(mesh);
      fragments.push(group);
    }

    return fragments;
  };

  customizeMaterialShaders = (
    idOrName: number | string,
    faceName: string | null = null,
    data: {
      vertexShader: string;
      fragmentShader: string;
      uniforms?: { [key: string]: Uniform };
    } = {
      vertexShader: DEFAULT_CHUNK_SHADERS.vertex,
      fragmentShader: DEFAULT_CHUNK_SHADERS.fragment,
      uniforms: {},
    }
  ) => {
    this.checkIsInitialized("customize material shaders", false);

    const {
      vertexShader = DEFAULT_CHUNK_SHADERS.vertex,
      fragmentShader = DEFAULT_CHUNK_SHADERS.fragment,
      uniforms = {},
    } = data;

    const mat = this.getBlockFaceMaterial(idOrName, faceName);

    if (!mat) {
      throw new Error(
        `Could not find material for block ${idOrName} and face ${faceName}`
      );
    }

    mat.vertexShader = vertexShader;
    mat.fragmentShader = fragmentShader;
    mat.uniforms = {
      ...mat.uniforms,
      ...uniforms,
    };
    mat.needsUpdate = true;

    return mat;
  };

  customizeBlockDynamic = (
    idOrName: number | string,
    fn: Block["dynamicFn"]
  ) => {
    this.checkIsInitialized("customize block dynamic", false);

    const block = this.getBlockOf(idOrName);

    if (!block) {
      throw new Error(
        `Block with ID ${idOrName} does not exist, could not overwrite dynamic function.`
      );
    }

    block.dynamicFn = fn;
  };

  /**
   * Initialize the world with the data received from the server. This includes populating
   * the registry, setting the options, and creating the texture atlas.
   */
  async initialize() {
    if (this.isInitialized) {
      console.warn("World has already been isInitialized.");
      return;
    }

    if (this.initialData === null) {
      throw new Error(
        "World has not received any initialization data from the server."
      );
    }

    const { blocks, items, options, stats, ...extra } = this.initialData;
    this.extraInitData = extra as Record<string, JsonValue>;

    this._time = stats.time;

    // Loading the items registry
    if (items && Array.isArray(items)) {
      this.items.initialize(items as ItemDef[]);
    }

    // Loading the block registry
    this.blockEntityTypeBlockCache.clear();
    this.blockFaceNameCache.clear();
    this.chunkMaterialBaseKeyById.clear();
    this.chunkMaterialIndependentKeyById.clear();
    this.transparentRenderOrderById.clear();
    this.textureGroupFirstFaceCache.clear();
    const hasOwnBlock = Object.prototype.hasOwnProperty;
    for (const name in blocks) {
      if (!hasOwnBlock.call(blocks, name)) {
        continue;
      }
      const block = blocks[name];
      const { id, aabbs, isDynamic } = block;

      const lowerName = name.toLowerCase();

      block.independentFaces = new Set();
      block.isolatedFaces = new Set();
      const faceNameMap = new Map<string, Block["faces"][number]>();

      const faces = block.faces;
      for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
        const face = faces[faceIndex];
        faceNameMap.set(face.name, face);
        if (face.independent) {
          block.independentFaces.add(face.name);
        }
        if (face.isolated) {
          block.isolatedFaces.add(face.name);
        }
      }
      this.blockFaceNameCache.set(id, faceNameMap);

      const blockAabbs = new Array<AABB>(aabbs.length);
      for (let aabbIndex = 0; aabbIndex < aabbs.length; aabbIndex++) {
        const { minX, minY, minZ, maxX, maxY, maxZ } = aabbs[aabbIndex];
        blockAabbs[aabbIndex] = new AABB(minX, minY, minZ, maxX, maxY, maxZ);
      }
      block.aabbs = blockAabbs;

      if (isDynamic) {
        block.dynamicFn = () => {
          return {
            aabbs: block.aabbs,
            faces: block.faces,
            isTransparent: block.isTransparent,
          };
        };
      }

      // Guarantee the `isLight` flag is correctly set even if the server did not provide it
      // A block is considered a light source if any coloured component is non-zero.
      block.isLight =
        (block.redLightLevel ?? 0) > 0 ||
        (block.greenLightLevel ?? 0) > 0 ||
        (block.blueLightLevel ?? 0) > 0;

      this.registry.blocksByName.set(lowerName, block);
      this.registry.blocksById.set(id, block);
      this.registry.nameMap.set(lowerName, id);
      this.registry.idMap.set(id, lowerName);
      if (block.isSeeThrough) {
        this.transparentRenderOrderById.set(
          id,
          block.isFluid
            ? TRANSPARENT_FLUID_RENDER_ORDER
            : TRANSPARENT_RENDER_ORDER
        );
      }
    }

    this._plantBlockIds.clear();
    let blockEntries = this.registry.blocksById.entries();
    let blockEntry = blockEntries.next();
    while (!blockEntry.done) {
      const [id, block] = blockEntry.value;
      if (block.faces.length === 0) {
        blockEntry = blockEntries.next();
        continue;
      }
      const blockFaces = block.faces;
      let allDiagonal = true;
      for (let faceIndex = 0; faceIndex < blockFaces.length; faceIndex++) {
        const dir = blockFaces[faceIndex].dir;
        if (dir[0] !== 0 || dir[1] !== 0 || dir[2] !== 0) {
          allDiagonal = false;
          break;
        }
      }
      if (allDiagonal) {
        this._plantBlockIds.add(id);
      }
      blockEntry = blockEntries.next();
    }

    // Loading the options
    // Preserve client-side shaderBasedLighting (server may still send it for backwards compatibility)
    const clientShaderBasedLighting = this.options.shaderBasedLighting;
    this.options = {
      ...this.options,
      ...options,
      shaderBasedLighting: clientShaderBasedLighting,
    };

    this.physics.options = this.options;

    // Initialize shader-based lighting components after server options are known
    if (this.usesShaderLighting && !this.csmRenderer) {
      this.csmRenderer = new CSMRenderer({
        cascades: 3,
        shadowMapSize: 4096,
        maxShadowDistance: 128,
        shadowBias: 0.0005,
        shadowNormalBias: 0.02,
        lightMargin: 32,
      });
      this.lightVolume = new LightVolume({
        size: [128, 64, 128],
        resolution: 1,
      });
      this.lightRegistry = new LightSourceRegistry();
    }

    await this.loadMaterials();

    const registryData = this.registry.serialize();
    this.meshWorkerPool.postMessage({ type: "init", registryData });
    this.lightWorkerPool.postMessage({ type: "init", registryData });

    this.isInitialized = true;
    this.renderRadius = this.options.defaultRenderRadius;

    if (this.initialEntities) {
      this.handleEntities(this.initialEntities);
      this.initialEntities = null;
    }
  }
  update(position?: Vector3, direction?: Vector3) {
    if (!this.isInitialized) {
      return;
    }

    const worldPosition = position ?? ZERO_VECTOR3;
    const worldDirection = direction ?? ZERO_VECTOR3;
    const delta = this.clock.getDelta();
    const chunkSize = this.options.chunkSize;
    const centerX = Math.floor(worldPosition.x / chunkSize);
    const centerZ = Math.floor(worldPosition.z / chunkSize);
    if (this.options.doesTickTime) {
      this._time = (this.time + delta) % this.options.timePerDay;
    }

    this.maintainChunks(centerX, centerZ);

    if (
      centerX !== this._lastCenterChunk[0] ||
      centerZ !== this._lastCenterChunk[1]
    ) {
      this._lastCenterChunk[0] = centerX;
      this._lastCenterChunk[1] = centerZ;
      this.updatePlantVisibility(centerX, centerZ);
    }

    this.requestChunks(centerX, centerZ, worldDirection);
    this.processChunks(centerX, centerZ);
    this.updatePhysics(delta);
    this.updateUniforms();
    this.updateSkyAndClouds(worldPosition);
    this.emitServerUpdates();
  }

  /**
   * The message interceptor.
   *
   * @hidden
   */
  onMessage(message: MessageProtocol) {
    const { type } = message;

    switch (type) {
      case "INIT": {
        const { json, entities } = message;

        this.initialData = json;

        if (entities) {
          this.initialEntities = entities;
        }

        break;
      }
      case "ENTITY": {
        const { entities } = message;

        if (entities && entities.length) {
          if (!this.isInitialized) {
            const existingEntities = this.initialEntities;
            if (!existingEntities || existingEntities.length === 0) {
              const initialEntities = new Array(entities.length);
              for (let index = 0; index < entities.length; index++) {
                initialEntities[index] = entities[index];
              }
              this.initialEntities = initialEntities;
            } else {
              const start = existingEntities.length;
              existingEntities.length = start + entities.length;
              for (let index = 0; index < entities.length; index++) {
                existingEntities[start + index] = entities[index];
              }
            }
          } else {
            this.handleEntities(entities);
          }
        }

        break;
      }
      case "STATS": {
        const { json } = message;

        if (Math.abs(json.time - this.time) > this.options.timeForceThreshold) {
          this._time = json.time;
        }

        break;
      }
      case "LOAD": {
        const { chunks } = message;
        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
          const chunk = chunks[chunkIndex];
          const { x, z } = chunk;
          this.chunkPipeline.markProcessingAt(x, z, "load", chunk);
        }

        break;
      }
      case "UPDATE": {
        const { updates } = message;

        if (updates && updates.length > 0) {
          this.applyServerUpdatesImmediately(updates);
        }

        break;
      }
    }
  }

  private handleEntities = (
    entities: EntityProtocol<{
      voxel: Coords3;
      json: string;
    }>[]
  ) => {
    const { chunkSize } = this.options;
    const hasBlockEntityListeners = this.blockEntityUpdateListeners.size > 0;

    for (let entityIndex = 0; entityIndex < entities.length; entityIndex++) {
      const entity = entities[entityIndex];
      const { id, type, metadata, operation } = entity;

      if (!type.startsWith("block::")) {
        continue;
      }

      if (!metadata || !metadata.voxel) {
        continue;
      }

      const [px, py, pz] = metadata.voxel;
      const vx = Math.floor(px);
      const vy = Math.floor(py);
      const vz = Math.floor(pz);
      if (!Number.isFinite(vx) || !Number.isFinite(vy) || !Number.isFinite(vz)) {
        continue;
      }
      const voxelId = ChunkUtils.getVoxelNameAt(vx, vy, vz);
      let voxelCoords: Coords3 | null = null;
      const data: T | null =
        operation === "DELETE" && !hasBlockEntityListeners
          ? null
          : (metadata.json as T | null) ?? null;
      const cx = Math.floor(vx / chunkSize);
      const cz = Math.floor(vz / chunkSize);
      const chunkName = ChunkUtils.getChunkNameAt(cx, cz);
      if (hasBlockEntityListeners) {
        voxelCoords = [vx, vy, vz];
        const originalData = this.blockEntitiesMap.get(voxelId) ?? null;
        const chunk = this.chunkPipeline.getLoadedChunk(chunkName);
        let chunkCoords: Coords2 | null = null;
        const shouldDeferUpdate =
          operation !== "DELETE" && !this.isChunkReadyForEntityUpdates(chunk);
        let listeners = this.blockEntityUpdateListeners.values();
        let listenerEntry = listeners.next();
        while (!listenerEntry.done) {
          const listener = listenerEntry.value;
          const updateData: BlockEntityUpdateData<T> = {
            id,
            voxel: voxelCoords,
            oldValue: originalData?.data ?? null,
            newValue: data as T | null,
            operation,
            etype: type,
          };

          if (shouldDeferUpdate) {
            this.deferBlockEntityUpdateUntilChunkReady(
              listener,
              chunkCoords ?? (chunkCoords = [cx, cz]),
              updateData
            );
            listenerEntry = listeners.next();
            continue;
          }

          listener(updateData);
          listenerEntry = listeners.next();
        }
      }

      switch (operation) {
        case "DELETE": {
          this.blockEntitiesMap.delete(voxelId);
          this.untrackBlockEntityKey(chunkName, voxelId);
          const block = this.resolveBlockByEntityType(type);
          if (block) {
            voxelCoords = voxelCoords ?? [vx, vy, vz];
            const faces = block.faces;
            for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
              const face = faces[faceIndex];
              if (face.isolated) {
                const materialKey = this.makeChunkMaterialKey(
                  block.id,
                  face.name,
                  voxelCoords
                );
                const material = this.chunkRenderer.materials.get(materialKey);
                if (material) {
                  material.dispose();
                  material.map?.dispose();
                }
                this.chunkRenderer.materials.delete(materialKey);
              }
            }
          }
          break;
        }

        case "CREATE":
        case "UPDATE": {
          this.blockEntitiesMap.set(voxelId, { id, data });
          this.trackBlockEntityKey(chunkName, voxelId);
          break;
        }
      }
    }
  };

  get time() {
    return this._time;
  }

  set time(time: number) {
    this._time = time;

    if (this.isInitialized) {
      this.packets.push({
        type: "METHOD",
        method: {
          name: "vox-builtin:set-time",
          payload: JSON.stringify({
            time,
          }),
        },
      });
    }
  }

  get renderRadius() {
    return this._renderRadius;
  }

  set renderRadius(radius: number) {
    this.checkIsInitialized("set render radius", false);

    radius = Math.floor(radius);

    this._renderRadius = radius;
    this._deleteRadius = radius * 1.1;

    const { chunkSize } = this.options;

    this.chunkRenderer.uniforms.fogNear.value = radius * 0.7 * chunkSize;
    this.chunkRenderer.uniforms.fogFar.value = radius * chunkSize;
  }

  get deleteRadius() {
    return this._deleteRadius;
  }

  private requestChunks(centerX: number, centerZ: number, direction: Vector3) {
    const {
      renderRadius,
      options: {
        chunkRerequestInterval,
        chunkLoadExponent,
        maxChunkRequestsPerUpdate,
      },
    } = this;
    const { minChunk, maxChunk } = this.options;
    const minChunkX = minChunk[0];
    const minChunkZ = minChunk[1];
    const maxChunkX = maxChunk[0];
    const maxChunkZ = maxChunk[1];
    if (maxChunkRequestsPerUpdate <= 0) {
      return;
    }

    const total = this.chunkPipeline.totalCount;
    const loadedCount = this.chunkPipeline.loadedCount;

    const ratio = total === 0 ? 1 : loadedCount / total;
    const directionX = direction.x;
    const directionZ = direction.z;
    const directionLengthSquared = directionX * directionX + directionZ * directionZ;
    const hasDirection =
      directionLengthSquared > 0 && Number.isFinite(directionLengthSquared);

    const angleThreshold = hasDirection
      ? ratio === 1
        ? (Math.PI * 3) / 8
        : Math.max(ratio ** chunkLoadExponent, 0.1)
      : 0;
    const tanAngleThreshold = hasDirection ? Math.tan(angleThreshold) : 0;

    const safeRadius = Math.max(renderRadius - 2, 1);
    const safeRadiusSquared = safeRadius * safeRadius;
    this.ensureRequestCandidateCapacity(maxChunkRequestsPerUpdate);
    const requestCxs = this.requestCandidateCxs;
    const requestCzs = this.requestCandidateCzs;
    const requestDistances = this.requestCandidateDistances;
    let selectedRequestCount = 0;
    let farthestRequestIndex = -1;
    let farthestRequestDistance = -1;

    const renderRadiusSquared = renderRadius * renderRadius;

    for (let ox = -renderRadius; ox <= renderRadius; ox++) {
      for (let oz = -renderRadius; oz <= renderRadius; oz++) {
        if (ox * ox + oz * oz > renderRadiusSquared) continue;

        const cx = centerX + ox;
        const cz = centerZ + oz;

        if (cx < minChunkX || cz < minChunkZ || cx > maxChunkX || cz > maxChunkZ) {
          continue;
        }

        if (
          hasDirection &&
          !this.isChunkInViewByTanAt(
            centerX,
            centerZ,
            cx,
            cz,
            directionX,
            directionZ,
            tanAngleThreshold,
            safeRadiusSquared
          )
        ) {
          continue;
        }

        if (this.chunkPipeline.shouldRequestAt(cx, cz, chunkRerequestInterval)) {
          const dx = cx - centerX;
          const dz = cz - centerZ;
          const distance = dx * dx + dz * dz;
          if (selectedRequestCount < maxChunkRequestsPerUpdate) {
            const writeIndex = selectedRequestCount;
            requestCxs[writeIndex] = cx;
            requestCzs[writeIndex] = cz;
            requestDistances[writeIndex] = distance;
            selectedRequestCount++;
            if (distance > farthestRequestDistance) {
              farthestRequestDistance = distance;
              farthestRequestIndex = writeIndex;
            }
          } else if (distance < farthestRequestDistance) {
            requestCxs[farthestRequestIndex] = cx;
            requestCzs[farthestRequestIndex] = cz;
            requestDistances[farthestRequestIndex] = distance;

            farthestRequestIndex = -1;
            farthestRequestDistance = -1;
            for (let index = 0; index < selectedRequestCount; index++) {
              const queuedDistance = requestDistances[index];
              if (queuedDistance > farthestRequestDistance) {
                farthestRequestDistance = queuedDistance;
                farthestRequestIndex = index;
              }
            }
          }
        }
      }
    }
    if (selectedRequestCount > 1) {
      for (let index = 1; index < selectedRequestCount; index++) {
        const cx = requestCxs[index];
        const cz = requestCzs[index];
        const distance = requestDistances[index];
        let insertIndex = index - 1;

        while (
          insertIndex >= 0 &&
          requestDistances[insertIndex] > distance
        ) {
          requestDistances[insertIndex + 1] = requestDistances[insertIndex];
          requestCxs[insertIndex + 1] = requestCxs[insertIndex];
          requestCzs[insertIndex + 1] = requestCzs[insertIndex];
          insertIndex--;
        }

        requestDistances[insertIndex + 1] = distance;
        requestCxs[insertIndex + 1] = cx;
        requestCzs[insertIndex + 1] = cz;
      }
    }
    const requestCount = selectedRequestCount;
    if (requestCount === 0) {
      return;
    }

    const requestChunks = new Array<Coords2>(requestCount);
    for (let index = 0; index < requestCount; index++) {
      const cx = requestCxs[index];
      const cz = requestCzs[index];
      requestChunks[index] = [cx, cz];
      this.chunkPipeline.markRequestedAt(cx, cz);
    }

    let directionPayload: [number, number] = ZERO_DIRECTION;
    if (hasDirection) {
      const invLength = 1 / Math.sqrt(directionLengthSquared);
      directionPayload = [directionX * invLength, directionZ * invLength];
    }
    this.packets.push({
      type: "LOAD",
      json: {
        center: [centerX, centerZ],
        direction: directionPayload,
        chunks: requestChunks,
      },
    });
  }

  private processChunks(centerX: number, centerZ: number) {
    if (this.chunkPipeline.processingCount === 0) return;
    const {
      maxProcessesPerUpdate,
      chunkSize,
      maxHeight,
      subChunks,
      maxLightLevel,
      clientOnlyMeshing,
    } = this.options;
    if (maxProcessesPerUpdate <= 0) {
      return;
    }

    this.ensureProcessCandidateCapacity(maxProcessesPerUpdate);
    const toProcessData = this.processCandidateData;
    const toProcessDistances = this.processCandidateDistances;
    let toProcessCount = 0;
    let farthestProcessIndex = -1;
    let farthestProcessDistance = -1;

    let processingChunks = this.chunkPipeline.getInStage("processing").values();
    let processingChunkName = processingChunks.next();
    while (!processingChunkName.done) {
      const name = processingChunkName.value;
      const procData = this.chunkPipeline.getProcessingChunkData(name);
      if (!procData) {
        processingChunkName = processingChunks.next();
        continue;
      }

      const dx = procData.x - centerX;
      const dz = procData.z - centerZ;
      const distance = dx * dx + dz * dz;
      if (toProcessCount < maxProcessesPerUpdate) {
        const writeIndex = toProcessCount;
        toProcessData[writeIndex] = procData;
        toProcessDistances[writeIndex] = distance;
        toProcessCount++;
        if (distance > farthestProcessDistance) {
          farthestProcessDistance = distance;
          farthestProcessIndex = writeIndex;
        }
      } else if (distance < farthestProcessDistance) {
        toProcessData[farthestProcessIndex] = procData;
        toProcessDistances[farthestProcessIndex] = distance;

        farthestProcessIndex = -1;
        farthestProcessDistance = -1;
        for (let index = 0; index < toProcessCount; index++) {
          const queuedDistance = toProcessDistances[index];
          if (queuedDistance > farthestProcessDistance) {
            farthestProcessDistance = queuedDistance;
            farthestProcessIndex = index;
          }
        }
      }
      processingChunkName = processingChunks.next();
    }

    if (toProcessCount === 0) {
      return;
    }

    if (toProcessCount > 1) {
      for (let index = 1; index < toProcessCount; index++) {
        const distance = toProcessDistances[index];
        const data = toProcessData[index];
        let insertIndex = index - 1;

        while (
          insertIndex >= 0 &&
          toProcessDistances[insertIndex] > distance
        ) {
          toProcessDistances[insertIndex + 1] = toProcessDistances[insertIndex];
          toProcessData[insertIndex + 1] = toProcessData[insertIndex];
          insertIndex--;
        }

        toProcessDistances[insertIndex + 1] = distance;
        toProcessData[insertIndex + 1] = data;
      }
    }

    for (let itemIndex = 0; itemIndex < toProcessCount; itemIndex++) {
      const item = toProcessData[itemIndex];
      const { x, z, id } = item;

      let chunk = this.getLoadedChunkByCoords(x, z);

      if (!chunk) {
        chunk = new Chunk(id, [x, z], {
          maxHeight,
          subChunks,
          size: chunkSize,
          maxLightLevel,
        });
      }

      chunk.setData(item);
      chunk.isDirty = false;

      this.chunkPipeline.markLoadedAt(x, z, chunk);

      this.emitChunkEvent("chunk-data-loaded", {
        chunk,
        coords: chunk.coords,
      });

      if (chunk.isReady) {
        this.buildChunkMeshesForChunkData(x, z, item, clientOnlyMeshing);
        this.triggerChunkInitListeners(chunk);
      } else {
        let disposer = () => {};
        disposer = this.addChunkInitListenerAt(x, z, () => {
          this.buildChunkMeshesForChunkData(x, z, item, clientOnlyMeshing);
          disposer();
        });
      }
    }
  }

  private isChunkReadyForEntityUpdates(
    chunk: Chunk | undefined
  ): chunk is Chunk {
    return !!chunk && chunk.meshes.size > 0;
  }

  private triggerChunkInitListeners(chunk: Chunk) {
    const listeners = this.chunkInitializeListeners.get(chunk.name);

    if (!listeners || listeners.size === 0) {
      return;
    }

    this.chunkInitializeListeners.delete(chunk.name);
    let listenerEntries = listeners.values();
    let listenerEntry = listenerEntries.next();
    while (!listenerEntry.done) {
      listenerEntry.value(chunk);
      listenerEntry = listenerEntries.next();
    }
  }

  private trackBlockEntityKey(chunkName: string, voxelKey: string) {
    let keys = this.blockEntityKeysByChunk.get(chunkName);
    if (!keys) {
      keys = new Set<string>();
      this.blockEntityKeysByChunk.set(chunkName, keys);
    }
    keys.add(voxelKey);
  }

  private untrackBlockEntityKey(chunkName: string, voxelKey: string) {
    const keys = this.blockEntityKeysByChunk.get(chunkName);
    if (!keys) {
      return;
    }

    keys.delete(voxelKey);
    if (keys.size === 0) {
      this.blockEntityKeysByChunk.delete(chunkName);
    }
  }

  private buildChunkMeshesForChunkData(
    x: number,
    z: number,
    data: import("@voxelize/protocol").ChunkProtocol,
    clientOnlyMeshing: boolean
  ) {
    if (clientOnlyMeshing) {
      this.markChunkAndNeighborsForMeshing(x, z);
      return;
    }

    for (let meshIndex = 0; meshIndex < data.meshes.length; meshIndex++) {
      const mesh = data.meshes[meshIndex];
      this.buildChunkMesh(x, z, mesh);
      this.meshPipeline.markFreshFromServer(x, z, mesh.level);
    }
  }

  private deferBlockEntityUpdateUntilChunkReady(
    listener: BlockEntityUpdateListener<T>,
    chunkCoords: Coords2,
    updateData: BlockEntityUpdateData<T>
  ) {
    let isResolved = false;
    let unbind = () => {};
    const fallbackTimeout = window.setTimeout(() => {
      if (isResolved) return;
      isResolved = true;
      unbind();
      listener(updateData);
    }, 3000);

    unbind = this.addChunkInitListener(chunkCoords, () => {
      if (isResolved) return;
      isResolved = true;
      window.clearTimeout(fallbackTimeout);
      listener(updateData);
      unbind();
    });
  }

  private pruneBlockEntitiesInChunk(chunkCoords: Coords2) {
    const [targetCx, targetCz] = chunkCoords;
    const chunkName = ChunkUtils.getChunkNameAt(targetCx, targetCz);
    const keys = this.blockEntityKeysByChunk.get(chunkName);
    if (!keys || keys.size === 0) {
      return;
    }

    let keyEntries = keys.values();
    let keyEntry = keyEntries.next();
    while (!keyEntry.done) {
      this.blockEntitiesMap.delete(keyEntry.value);
      keyEntry = keyEntries.next();
    }
    this.blockEntityKeysByChunk.delete(chunkName);
  }

  private maintainChunks(centerX: number, centerZ: number) {
    const { deleteRadius } = this;
    const { subChunks } = this.options;
    const deleteRadiusSquared = deleteRadius * deleteRadius;
    const deleted: Coords2[] = [];

    let loadedChunks = this.chunkPipeline.getInStage("loaded").values();
    let loadedChunkName = loadedChunks.next();
    while (!loadedChunkName.done) {
      const name = loadedChunkName.value;
      const chunk = this.chunkPipeline.getLoadedChunk(name);
      if (!chunk) {
        loadedChunkName = loadedChunks.next();
        continue;
      }

      const [x, z] = chunk.coords;
      const dx = x - centerX;
      const dz = z - centerZ;

      if (dx * dx + dz * dz > deleteRadiusSquared) {
        for (let level = 0; level < subChunks; level++) {
          const meshes = chunk.meshes.get(level);
          if (!meshes) {
            continue;
          }
          for (let meshIndex = 0; meshIndex < meshes.length; meshIndex++) {
            const mesh = meshes[meshIndex];
            if (mesh) {
              this.csmRenderer?.removeSkipShadowObject(mesh);
            }
          }
          this.emitChunkEvent("chunk-mesh-unloaded", {
            chunk,
            coords: chunk.coords,
            level,
            meshes,
          });
        }

        this.emitChunkEvent("chunk-unloaded", {
          chunk,
          coords: chunk.coords,
          allMeshes: new Map(chunk.meshes),
        });

        this.pruneBlockEntitiesInChunk(chunk.coords);
        chunk.dispose();
        this.meshPipeline.remove(x, z);
        this.chunkPipeline.remove(name);
        this.chunkInitializeListeners.delete(name);
        deleted.push(chunk.coords);
      }
      loadedChunkName = loadedChunks.next();
    }

    let requestedChunks = this.chunkPipeline.getInStage("requested").values();
    let requestedChunkName = requestedChunks.next();
    while (!requestedChunkName.done) {
      const name = requestedChunkName.value;
      const requested = this.chunkPipeline.getRequestedCoords(name);
      if (!requested) {
        requestedChunkName = requestedChunks.next();
        continue;
      }

      const x = requested.cx;
      const z = requested.cz;
      const dx = x - centerX;
      const dz = z - centerZ;
      if (dx * dx + dz * dz > deleteRadiusSquared) {
        this.chunkPipeline.remove(name);
        this.chunkInitializeListeners.delete(name);
        deleted.push([x, z]);
      }
      requestedChunkName = requestedChunks.next();
    }

    let processingChunks = this.chunkPipeline.getInStage("processing").values();
    let processingChunkName = processingChunks.next();
    while (!processingChunkName.done) {
      const name = processingChunkName.value;
      const procData = this.chunkPipeline.getProcessingChunkData(name);
      if (!procData) {
        processingChunkName = processingChunks.next();
        continue;
      }

      const { x, z } = procData;
      const dx = x - centerX;
      const dz = z - centerZ;
      if (dx * dx + dz * dz > deleteRadiusSquared) {
        this.chunkPipeline.remove(name);
        this.chunkInitializeListeners.delete(name);
      }
      processingChunkName = processingChunks.next();
    }

    if (deleted.length) {
      this.packets.push({
        type: "UNLOAD",
        json: {
          chunks: deleted,
        },
      });
    }
  }

  private get plantRadiusSq() {
    const plantRadius = this.options.plantRenderRatio * this.renderRadius;
    return plantRadius * plantRadius;
  }

  private setPlantMeshVisibility(meshes: Mesh[], showPlants: boolean) {
    if (this._plantBlockIds.size === 0) {
      return;
    }

    for (let meshIndex = 0; meshIndex < meshes.length; meshIndex++) {
      const mesh = meshes[meshIndex];
      if (mesh && this._plantBlockIds.has(mesh.userData.voxel)) {
        mesh.visible = showPlants;
      }
    }
  }

  private updatePlantVisibility(cx: number, cz: number) {
    if (this._plantBlockIds.size === 0) {
      return;
    }

    const { subChunks } = this.options;
    const radiusSq = this.plantRadiusSq;

    let loadedChunks = this.chunkPipeline.getInStage("loaded").values();
    let loadedChunkName = loadedChunks.next();
    while (!loadedChunkName.done) {
      const name = loadedChunkName.value;
      const chunk = this.chunkPipeline.getLoadedChunk(name);
      if (!chunk) {
        loadedChunkName = loadedChunks.next();
        continue;
      }

      const [x, z] = chunk.coords;
      const dx = x - cx;
      const dz = z - cz;
      const showPlants = dx * dx + dz * dz <= radiusSq;

      for (let level = 0; level < subChunks; level++) {
        const levelMeshes = chunk.meshes.get(level);
        if (!levelMeshes) {
          continue;
        }
        this.setPlantMeshVisibility(levelMeshes, showPlants);
      }
      loadedChunkName = loadedChunks.next();
    }
  }

  private triggerBlockUpdateListeners(
    vx: number,
    vy: number,
    vz: number,
    oldValue: number,
    newValue: number
  ) {
    let listeners = this.blockUpdateListeners.values();
    let listenerEntry = listeners.next();
    while (!listenerEntry.done) {
      listenerEntry.value({
        voxel: [vx, vy, vz],
        oldValue,
        newValue,
      });
      listenerEntry = listeners.next();
    }
  }

  private attemptBlockCache(
    vx: number,
    vy: number,
    vz: number,
    oldVal: number,
    newVal: number
  ) {
    if (oldVal === newVal) {
      return;
    }

    const name = ChunkUtils.getVoxelNameAt(vx, vy, vz);
    const arr = this.oldBlocks.get(name);
    if (arr) {
      arr.push(oldVal);
    } else {
      this.oldBlocks.set(name, [oldVal]);
    }
    this.triggerBlockUpdateListeners(vx, vy, vz, oldVal, newVal);
  }

  /**
   * Update the physics engine by ticking all inner AABBs.
   */
  private updatePhysics = (delta: number) => {
    if (!this.physics || !this.options.gravity) return;
    const { chunkSize, minChunk, maxChunk } = this.options;
    const minChunkX = minChunk[0];
    const minChunkZ = minChunk[1];
    const maxChunkX = maxChunk[0];
    const maxChunkZ = maxChunk[1];
    const gravity = this.options.gravity;
    const gravityX = gravity[0];
    const gravityY = gravity[1];
    const gravityZ = gravity[2];

    const noGravity =
      gravityX * gravityX + gravityY * gravityY + gravityZ * gravityZ <
      0.01;

    const bodies = this.physics.bodies;
    for (let bodyIndex = 0; bodyIndex < bodies.length; bodyIndex++) {
      const body = bodies[bodyIndex];
      const [vx, vy, vz] = body.getPosition() as Coords3;
      const cx = Math.floor(vx / chunkSize);
      const cz = Math.floor(vz / chunkSize);
      const chunk = this.getLoadedChunkAtVoxel(vx, vz);

      if (
        (!chunk || !chunk.isReady) &&
        cx >= minChunkX &&
        cz >= minChunkZ &&
        cx <= maxChunkX &&
        cz <= maxChunkZ
      ) {
        continue;
      }

      this.physics.iterateBody(body, delta, noGravity);
    }
  };

  public updateSkyAndClouds(position: Vector3) {
    const {
      sunlightStartTimeFrac,
      sunlightEndTimeFrac,
      sunlightChangeSpan,
      timePerDay,
      minLightLevel,
    } = this.options;

    this.sky.update(position, this.time, timePerDay);
    this.clouds.update(position);

    // Update the sunlight intensity
    const sunlightStartTime = Math.floor(sunlightStartTimeFrac * timePerDay);
    const sunlightEndTime = Math.floor(sunlightEndTimeFrac * timePerDay);
    const sunlightChangeSpanTime = Math.floor(sunlightChangeSpan * timePerDay);

    const sunlightIntensity = Math.max(
      minLightLevel,
      this.time < sunlightStartTime
        ? 0.0
        : this.time < sunlightStartTime + sunlightChangeSpanTime
        ? (this.time - sunlightStartTime) / sunlightChangeSpanTime
        : this.time <= sunlightEndTime
        ? 1.0
        : this.time <= sunlightEndTime + sunlightChangeSpanTime
        ? 1 - (this.time - sunlightEndTime) / sunlightChangeSpanTime
        : 0.0
    );

    this.chunkRenderer.uniforms.sunlightIntensity.value = sunlightIntensity;

    // Update the clouds' colors based on the sky's colors.
    const cloudColor = this.clouds.material.uniforms.uCloudColor.value;
    const cloudColorHSL = cloudColor.getHSL({});
    cloudColor.setHSL(
      cloudColorHSL.h,
      cloudColorHSL.s,
      ThreeMathUtils.clamp(sunlightIntensity, 0, 1)
    );

    const fogColor = this.chunkRenderer.uniforms.fogColor.value;
    if (fogColor) {
      const fogWarmLerp = 0.55 * sunlightIntensity;
      fogColor.lerpColors(
        this.sky.uMiddleColor.value,
        World.fogWarmTint,
        fogWarmLerp
      );
    }

    if (this.usesShaderLighting) {
      this.chunkRenderer.shaderLightingUniforms.skyTopColor.value.copy(
        this.sky.uTopColor.value
      );
      this.chunkRenderer.shaderLightingUniforms.skyMiddleColor.value.copy(
        this.sky.uMiddleColor.value
      );
    }
  }

  /**
   * Update the uniform values.
   */
  private updateUniforms = () => {
    const t = performance.now();
    this.chunkRenderer.uniforms.time.value = t;

    const windAngle = t * 0.00001 + Math.sin(t * 0.000003) * 0.5;
    this.chunkRenderer.uniforms.windDirection.value.set(
      Math.cos(windAngle),
      Math.sin(windAngle)
    );
  };

  updateShaderLighting(camera: Camera, position: Vector3) {
    if (!this.usesShaderLighting) return;

    const { timePerDay } = this.options;
    const timeRatio = this.time / timePerDay;
    const sunAngle = timeRatio * Math.PI * 2 - Math.PI / 2;

    const sunY = Math.sin(sunAngle);
    const sunX = Math.cos(sunAngle);

    const moonAngle = sunAngle + Math.PI;
    const moonY = Math.sin(moonAngle);
    const moonX = Math.cos(moonAngle);

    const sunDirection = this.chunkRenderer.shaderLightingUniforms.sunDirection;

    const horizonThreshold = 0.15;
    const minElevation = 0.35;
    const shadowFadeThreshold = 0.4;

    let lightX: number;
    let lightY: number;
    let shadowStrength: number;

    if (sunY > horizonThreshold) {
      lightX = sunX;
      lightY = Math.max(sunY, minElevation);

      if (sunY < shadowFadeThreshold) {
        const fadeT =
          (shadowFadeThreshold - sunY) /
          (shadowFadeThreshold - horizonThreshold);
        const smoothFadeT = fadeT * fadeT * (3 - 2 * fadeT);
        shadowStrength = 1.0 - smoothFadeT * 0.7;
      } else {
        shadowStrength = 1.0;
      }
    } else if (sunY < -horizonThreshold) {
      lightX = moonX;
      lightY = Math.max(moonY, minElevation);
      shadowStrength = 0.6;
    } else {
      const t = (horizonThreshold - sunY) / (2 * horizonThreshold);
      const smoothT = t * t * (3 - 2 * t);

      lightX = sunX * (1 - smoothT) + moonX * smoothT;
      lightY = Math.max(minElevation, sunY * (1 - smoothT) + moonY * smoothT);
      const dip = 1.0 - Math.sin(smoothT * Math.PI);
      shadowStrength = (0.3 * (1 - smoothT) + 0.6 * smoothT) * dip;
    }

    sunDirection.value.set(lightX, lightY, 0.3);
    sunDirection.value.normalize();

    const sunlightIntensity = Math.max(0, sunY);

    if (sunlightIntensity > 0.5) {
      this.chunkRenderer.shaderLightingUniforms.sunColor.value.copy(
        World.warmColor
      );
      this.chunkRenderer.shaderLightingUniforms.ambientColor.value.lerpColors(
        World.dayAmbient,
        World.warmColor,
        (sunlightIntensity - 0.5) * 0.3
      );
    } else if (sunlightIntensity > 0) {
      this.chunkRenderer.shaderLightingUniforms.sunColor.value.lerpColors(
        World.coolColor,
        World.warmColor,
        sunlightIntensity * 2
      );
      this.chunkRenderer.shaderLightingUniforms.ambientColor.value.lerpColors(
        World.nightAmbient,
        World.dayAmbient,
        sunlightIntensity * 2
      );
    } else {
      this.chunkRenderer.shaderLightingUniforms.sunColor.value.copy(
        World.nightColor
      );
      this.chunkRenderer.shaderLightingUniforms.ambientColor.value.copy(
        World.nightAmbient
      );
    }

    this.chunkRenderer.uniforms.sunlightIntensity.value = Math.max(
      0.05,
      sunlightIntensity
    );
    this.chunkRenderer.shaderLightingUniforms.sunlightIntensity.value =
      sunlightIntensity;

    if (this.csmRenderer) {
      this.csmRenderer.update(camera, sunDirection.value, position);

      const csmUniforms = this.csmRenderer.getUniforms();

      if (csmUniforms.uShadowMaps[0]) {
        this.chunkRenderer.shaderLightingUniforms.shadowMap0.value =
          csmUniforms.uShadowMaps[0];
      }
      if (csmUniforms.uShadowMaps[1]) {
        this.chunkRenderer.shaderLightingUniforms.shadowMap1.value =
          csmUniforms.uShadowMaps[1];
      }
      if (csmUniforms.uShadowMaps[2]) {
        this.chunkRenderer.shaderLightingUniforms.shadowMap2.value =
          csmUniforms.uShadowMaps[2];
      }

      this.chunkRenderer.shaderLightingUniforms.shadowMatrix0.value.copy(
        csmUniforms.uShadowMatrices[0]
      );
      this.chunkRenderer.shaderLightingUniforms.shadowMatrix1.value.copy(
        csmUniforms.uShadowMatrices[1]
      );
      this.chunkRenderer.shaderLightingUniforms.shadowMatrix2.value.copy(
        csmUniforms.uShadowMatrices[2]
      );

      this.chunkRenderer.shaderLightingUniforms.cascadeSplit0.value =
        csmUniforms.uCascadeSplits[0];
      this.chunkRenderer.shaderLightingUniforms.cascadeSplit1.value =
        csmUniforms.uCascadeSplits[1];
      this.chunkRenderer.shaderLightingUniforms.cascadeSplit2.value =
        csmUniforms.uCascadeSplits[2];
      this.chunkRenderer.shaderLightingUniforms.shadowBias.value =
        csmUniforms.uShadowBias;

      this.chunkRenderer.shaderLightingUniforms.shadowStrength.value =
        shadowStrength;
    }

    if (this.lightVolume && this.lightRegistry) {
      this.lightVolume.updateCenter(position);
      this.lightVolume.updateFromRegistry(this.lightRegistry);

      this.chunkRenderer.shaderLightingUniforms.lightVolume.value =
        this.lightVolume.getTexture();
      this.lightVolume.getVolumeMin(
        this.chunkRenderer.shaderLightingUniforms.lightVolumeMin.value
      );
      this.lightVolume.getVolumeSize(
        this.chunkRenderer.shaderLightingUniforms.lightVolumeSize.value
      );
    }
  }

  renderShadowMaps(
    renderer: WebGLRenderer,
    entities?: Object3D[],
    instancePools?: Group[]
  ) {
    if (!this.usesShaderLighting || !this.csmRenderer) return;

    if (
      (entities && entities.length > 0) ||
      (instancePools && instancePools.length > 0)
    ) {
      this.csmRenderer.markCascadesForEntityRender();
    }

    this.csmRenderer.render(renderer, this, entities, 32, instancePools);
  }

  private buildChunkMesh(cx: number, cz: number, data: MeshProtocol) {
    const chunk = this.getLoadedChunkByCoords(cx, cz);
    if (!chunk) return;

    const { maxHeight, subChunks, chunkSize, mergeChunkGeometries } =
      this.options;
    const { level, geometries } = data;
    const heightPerSubChunk = Math.floor(maxHeight / subChunks);
    const chunkBaseX = cx * chunkSize;
    const chunkBaseY = level * heightPerSubChunk;
    const chunkBaseZ = cz * chunkSize;

    const oldMeshes = chunk.meshes.get(level);
    if (oldMeshes) {
      const csmRenderer = this.csmRenderer;
      for (let i = 0; i < oldMeshes.length; i++) {
        const mesh = oldMeshes[i];
        csmRenderer?.removeSkipShadowObject(mesh);
        mesh.geometry.dispose();
        chunk.group.remove(mesh);
      }
    }

    chunk.meshes.delete(level);

    if (geometries.length === 0) return;

    let meshes: Mesh[];

    if (mergeChunkGeometries) {
      const materialGroupIndexByMaterial =
        this.mergedMaterialGroupIndexByMaterial;
      materialGroupIndexByMaterial.clear();
      const materialGeometryGroups = this.mergedMaterialGeometryGroups;
      materialGeometryGroups.length = 0;
      const materialGroupMaterials = this.mergedMaterialGroupMaterials;
      materialGroupMaterials.length = 0;
      const materialGroupVoxels = this.mergedMaterialGroupVoxels;
      materialGroupVoxels.length = 0;
      const reusableMaterialGeometryGroups =
        this.reusableMergedMaterialGeometryGroups;

      for (let geometryIndex = 0; geometryIndex < geometries.length; geometryIndex++) {
        const geo = geometries[geometryIndex];
        const { voxel, at, faceName, indices, lights, positions, uvs } = geo;
        const texturePosition = at && at.length ? at : undefined;
        const geometry = new BufferGeometry();

        geometry.setAttribute("position", new BufferAttribute(positions, 3));
        geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
        geometry.setAttribute("light", new BufferAttribute(lights, 1));
        geometry.setIndex(new BufferAttribute(indices, 1));
        const normals = geo.normals;
        if (normals && normals.length > 0) {
          geometry.setAttribute("normal", new BufferAttribute(normals, 3));
        } else {
          computeFlatNormals(geometry);
        }
        if (geo.bsCenter && geo.bsRadius !== undefined) {
          geometry.boundingSphere = new Sphere(
            new Vector3(geo.bsCenter[0], geo.bsCenter[1], geo.bsCenter[2]),
            geo.bsRadius
          );
        }

        let material = this.getBlockFaceMaterialByIdWithoutCheck(
          voxel,
          faceName,
          texturePosition
        );
        if (!material) {
          const block = this.getBlockById(voxel);
          const face = this.findBlockFaceByName(block, faceName);
          if (!face) {
            geometry.dispose();
            continue;
          }
          if (!face.isolated || !texturePosition) {
            geometry.dispose();
            continue;
          }
          try {
            material = this.getOrCreateIsolatedBlockMaterial(
              voxel,
              texturePosition,
              faceName
            );
          } catch {
            geometry.dispose();
            continue;
          }
        }
        let groupIndex = materialGroupIndexByMaterial.get(material);
        if (groupIndex === undefined) {
          let geometriesByMaterial = reusableMaterialGeometryGroups.pop();
          if (!geometriesByMaterial) {
            geometriesByMaterial = [];
          } else {
            geometriesByMaterial.length = 0;
          }
          groupIndex = materialGeometryGroups.length;
          materialGroupIndexByMaterial.set(material, groupIndex);
          materialGeometryGroups.push(geometriesByMaterial);
          materialGroupMaterials.push(material);
          materialGroupVoxels.push(voxel);
        }
        materialGeometryGroups[groupIndex].push(geometry);
      }

      meshes = new Array<Mesh>(materialGeometryGroups.length);
      let mergedMeshWriteIndex = 0;
      for (
        let groupIndex = 0;
        groupIndex < materialGeometryGroups.length;
        groupIndex++
      ) {
        const geometriesByMaterial = materialGeometryGroups[groupIndex];
        if (geometriesByMaterial.length === 0) continue;

        const material = materialGroupMaterials[groupIndex];
        const voxel = materialGroupVoxels[groupIndex];

        let finalGeometry: BufferGeometry;
        if (geometriesByMaterial.length === 1) {
          finalGeometry = geometriesByMaterial[0];
        } else {
          const geoCount = geometriesByMaterial.length;
          const merged = mergeGeometries(geometriesByMaterial, false);
          if (!merged) {
            for (let i = 0; i < geoCount; i++) {
              geometriesByMaterial[i].dispose();
            }
            continue;
          }
          for (let i = 0; i < geoCount; i++) {
            geometriesByMaterial[i].dispose();
          }
          finalGeometry = merged;
        }

        if (!finalGeometry.boundingSphere) {
          finalGeometry.computeBoundingSphere();
        }

        const mesh = new Mesh(finalGeometry, material);
        this.finalizeChunkMesh(
          mesh,
          voxel,
          chunkBaseX,
          chunkBaseY,
          chunkBaseZ,
          true,
          material.transparent,
          material.depthWrite
        );

        chunk.group.add(mesh);
        meshes[mergedMeshWriteIndex] = mesh;
        mergedMeshWriteIndex++;
      }
      meshes.length = mergedMeshWriteIndex;
      for (let groupIndex = 0; groupIndex < materialGeometryGroups.length; groupIndex++) {
        const geometriesByMaterial = materialGeometryGroups[groupIndex];
        geometriesByMaterial.length = 0;
        reusableMaterialGeometryGroups.push(geometriesByMaterial);
      }
      materialGeometryGroups.length = 0;
      materialGroupMaterials.length = 0;
      materialGroupVoxels.length = 0;
    } else {
      meshes = new Array<Mesh>(geometries.length);
      let meshWriteIndex = 0;
      for (let i = 0; i < geometries.length; i++) {
        const geo = geometries[i];
        const { voxel, at, faceName, indices, lights, positions, uvs } = geo;
        const texturePosition = at && at.length ? at : undefined;
        const geometry = new BufferGeometry();

        geometry.setAttribute("position", new BufferAttribute(positions, 3));
        geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
        geometry.setAttribute("light", new BufferAttribute(lights, 1));
        geometry.setIndex(new BufferAttribute(indices, 1));
        const normals = geo.normals;
        if (normals && normals.length > 0) {
          geometry.setAttribute("normal", new BufferAttribute(normals, 3));
        } else {
          computeFlatNormals(geometry);
        }
        if (geo.bsCenter && geo.bsRadius !== undefined) {
          geometry.boundingSphere = new Sphere(
            new Vector3(geo.bsCenter[0], geo.bsCenter[1], geo.bsCenter[2]),
            geo.bsRadius
          );
        } else {
          geometry.computeBoundingSphere();
        }

        let material = this.getBlockFaceMaterialByIdWithoutCheck(
          voxel,
          faceName,
          texturePosition
        );
        if (!material) {
          const block = this.getBlockById(voxel);
          const face = this.findBlockFaceByName(block, faceName);
          if (!face) {
            geometry.dispose();
            continue;
          }

          if (!face.isolated || !texturePosition) {
            console.warn("Unlikely situation happened...");
            geometry.dispose();
            continue;
          }

          try {
            material = this.getOrCreateIsolatedBlockMaterial(
              voxel,
              texturePosition,
              faceName
            );
          } catch (e) {
            console.error(e);
            geometry.dispose();
            continue;
          }
        }
        const mesh = new Mesh(geometry, material);
        this.finalizeChunkMesh(
          mesh,
          voxel,
          chunkBaseX,
          chunkBaseY,
          chunkBaseZ,
          false,
          material.transparent,
          material.depthWrite
        );

        chunk.group.add(mesh);
        meshes[meshWriteIndex] = mesh;
        meshWriteIndex++;
      }
      meshes.length = meshWriteIndex;
    }

    if (chunk.group.parent !== this) {
      this.add(chunk.group);
    }

    let levelMeshes = chunk.meshes.get(level);
    if (!levelMeshes) {
      levelMeshes = [];
      chunk.meshes.set(level, levelMeshes);
    }

    const meshCount = meshes.length;
    if (meshCount > 0) {
      const start = levelMeshes.length;
      levelMeshes.length = start + meshCount;
      for (let index = 0; index < meshCount; index++) {
        levelMeshes[start + index] = meshes[index];
      }
    }

    const [pcx, pcz] = this._lastCenterChunk;
    const dx = cx - pcx;
    const dz = cz - pcz;
    const showPlants = dx * dx + dz * dz <= this.plantRadiusSq;
    if (!showPlants) {
      this.setPlantMeshVisibility(meshes, false);
    }

    this.csmRenderer?.markAllCascadesForRender();

    this.emitChunkEvent("chunk-mesh-loaded", {
      chunk,
      coords: chunk.coords,
      level,
      meshes,
    });

    if (chunk.meshes.size === this.options.subChunks) {
      this.emitChunkEvent("chunk-loaded", {
        chunk,
        coords: chunk.coords,
        allMeshes: chunk.meshes,
      });
    }
  }

  private finalizeChunkMesh(
    mesh: Mesh,
    voxel: number,
    chunkBaseX: number,
    chunkBaseY: number,
    chunkBaseZ: number,
    merged: boolean,
    transparent: boolean,
    depthWrite: boolean
  ) {
    mesh.position.set(chunkBaseX, chunkBaseY, chunkBaseZ);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    const userData = mesh.userData;
    userData.isChunk = true;
    userData.voxel = voxel;
    if (merged) {
      userData.merged = true;
    }

    if (!transparent) {
      return;
    }

    let renderOrder = this.transparentRenderOrderById.get(voxel);
    if (renderOrder === undefined) {
      const block = this.getBlockByIdSafe(voxel);
      renderOrder = block?.isFluid
        ? TRANSPARENT_FLUID_RENDER_ORDER
        : TRANSPARENT_RENDER_ORDER;
      this.transparentRenderOrderById.set(voxel, renderOrder);
    }
    mesh.renderOrder = renderOrder;
    if (!depthWrite) {
      const geometryIndex = mesh.geometry.index;
      if (geometryIndex && geometryIndex.count > 6) {
        const sortData = prepareTransparentMesh(mesh);
        if (sortData) {
          userData.transparentSortData = sortData;
          mesh.onBeforeRender = sortTransparentMeshOnBeforeRender;
        }
      }
    }
    this.csmRenderer?.addSkipShadowObject(mesh);
  }

  private setupComponents() {
    const { skyOptions, cloudsOptions } = this.options;

    this.registry = new Registry();
    this.items = new ItemRegistry();
    this.items.setWorld(this);
    this.loader = new Loader();
    this.chunkPipeline = new ChunkPipeline();
    this.meshPipeline = new MeshPipeline();
    this.chunkRenderer = new ChunkRenderer();

    if (this.usesShaderLighting) {
      this.csmRenderer = new CSMRenderer({
        cascades: 3,
        shadowMapSize: 4096,
        maxShadowDistance: 128,
        shadowBias: 0.0005,
        shadowNormalBias: 0.02,
        lightMargin: 32,
      });
      this.lightVolume = new LightVolume({
        size: [128, 64, 128],
        resolution: 1,
      });
      this.lightRegistry = new LightSourceRegistry();
    }

    if (!cloudsOptions.uFogColor) {
      cloudsOptions.uFogColor = this.chunkRenderer.uniforms.fogColor;
    }

    this.sky = new Sky(skyOptions);
    this.clouds = new Clouds(cloudsOptions);

    this.add(this.sky, this.clouds);

    this.physics = new PhysicsEngine(
      (vx: number, vy: number, vz: number) => {
        const chunk = this.getLoadedChunkAtVoxel(vx, vz);
        if (!chunk) return [];

        const id = chunk.getVoxel(vx, vy, vz);
        const block = this.getBlockByIdSafe(id);
        if (!block) return [];

        const { aabbs, isPassable, isFluid, dynamicPatterns } = block;

        if (dynamicPatterns && dynamicPatterns.length > 0) {
          const passable = this.getBlockPassableForDynamicPatterns(
            vx,
            vy,
            vz,
            dynamicPatterns,
            isPassable
          );
          if (passable || isFluid) return [];

          const rotation = chunk.getVoxelRotation(vx, vy, vz);
          const aabbsWithFlags = this.getBlockAABBsForDynamicPatterns(
            vx,
            vy,
            vz,
            dynamicPatterns
          );
          const coords: Coords3 = [vx, vy, vz];
          const translatedAabbs = new Array<AABB>(aabbsWithFlags.length);
          for (let index = 0; index < aabbsWithFlags.length; index++) {
            const aabbWithFlag = aabbsWithFlags[index];
            translatedAabbs[index] = aabbWithFlag.worldSpace
              ? aabbWithFlag.aabb.translate(coords)
              : rotation.rotateAABB(aabbWithFlag.aabb).translate(coords);
          }
          return translatedAabbs;
        }

        if (isPassable || isFluid) return [];

        const rotation = chunk.getVoxelRotation(vx, vy, vz);
        const coords: Coords3 = [vx, vy, vz];
        const translatedAabbs = new Array<AABB>(aabbs.length);
        for (let index = 0; index < aabbs.length; index++) {
          translatedAabbs[index] = rotation.rotateAABB(aabbs[index]).translate(
            coords
          );
        }
        return translatedAabbs;
      },
      (vx: number, vy: number, vz: number) => {
        const chunk = this.getLoadedChunkAtVoxel(vx, vz);
        if (!chunk) return false;

        const id = chunk.getVoxel(vx, vy, vz);
        const block = this.getBlockByIdSafe(id);

        return block?.isFluid ?? false;
      },
      (vx: number, vy: number, vz: number) => {
        const chunk = this.getLoadedChunkAtVoxel(vx, vz);
        if (!chunk) return [];

        const id = chunk.getVoxel(vx, vy, vz);
        const block = this.getBlockByIdSafe(id);
        if (!block) return [];

        const { aabbs, isClimbable } = block;

        if (!isClimbable) return [];

        const rotation = chunk.getVoxelRotation(vx, vy, vz);
        const coords: Coords3 = [vx, vy, vz];
        const translatedAabbs = new Array<AABB>(aabbs.length);
        for (let index = 0; index < aabbs.length; index++) {
          translatedAabbs[index] = rotation.rotateAABB(aabbs[index]).translate(
            coords
          );
        }
        return translatedAabbs;
      },
      (vx: number, vy: number, vz: number) => {
        const chunk = this.getLoadedChunkAtVoxel(vx, vz);
        return chunk?.getVoxelStage(vx, vy, vz) ?? 0;
      },
      (vx: number, vy: number, vz: number) => {
        const chunk = this.getLoadedChunkAtVoxel(vx, vz);
        if (!chunk) return 0;
        const id = chunk.getVoxel(vx, vy, vz);
        const block = this.getBlockByIdSafe(id);
        return block?.fluidFlowForce ?? 0;
      },
      this.options
    );
  }

  private setupUniforms() {
    const { minLightLevel } = this.options;

    this.chunkRenderer.uniforms.minLightLevel.value = minLightLevel;
  }

  setShowGreedyDebug(show: boolean) {
    this.chunkRenderer.uniforms.showGreedyDebug.value = show ? 1.0 : 0.0;
  }

  private analyzeLightOperations(
    processedUpdates: ProcessedUpdate[]
  ): LightOperations {
    const { maxHeight, maxLightLevel } = this.options;

    const redRemoval: Coords3[] = [];
    const greenRemoval: Coords3[] = [];
    const blueRemoval: Coords3[] = [];
    const sunlightRemoval: Coords3[] = [];

    const redFlood: LightNode[] = [];
    const greenFlood: LightNode[] = [];
    const blueFlood: LightNode[] = [];
    const sunFlood: LightNode[] = [];
    const processedUpdateCount = processedUpdates.length;
    const removedLightSourceFlags = new Uint8Array(processedUpdateCount);
    let hasRemovedLightSources = false;

    for (let index = 0; index < processedUpdateCount; index++) {
      const update = processedUpdates[index];
      const { vx, vy, vz, oldBlock, newBlock, newRotation, oldStage } = update;
      let voxelCoords: Coords3 | null = null;

      let currentEmitsLight = oldBlock.isLight;
      let currentRedLevel = oldBlock.redLightLevel;
      let currentGreenLevel = oldBlock.greenLightLevel;
      let currentBlueLevel = oldBlock.blueLightLevel;

      if (oldBlock.dynamicPatterns) {
        currentEmitsLight = false;
        currentRedLevel = 0;
        currentGreenLevel = 0;
        currentBlueLevel = 0;
        const oldRuleFunctions = {
          getVoxelAt: (x: number, y: number, z: number) => {
            if (x === vx && y === vy && z === vz) return update.oldId;
            return this.getVoxelAtUnchecked(x, y, z);
          },
          getVoxelRotationAt: (x: number, y: number, z: number) => {
            if (x === vx && y === vy && z === vz) return update.oldRotation;
            return this.getVoxelRotationAtUnchecked(x, y, z);
          },
          getVoxelStageAt: (x: number, y: number, z: number) => {
            if (x === vx && y === vy && z === vz) return oldStage;
            return this.getVoxelStageAtUnchecked(x, y, z);
          },
        };

        const dynamicPatterns = oldBlock.dynamicPatterns;
        for (
          let patternIndex = 0;
          patternIndex < dynamicPatterns.length;
          patternIndex++
        ) {
          const parts = dynamicPatterns[patternIndex].parts;
          for (let partIndex = 0; partIndex < parts.length; partIndex++) {
            const part = parts[partIndex];
            const ruleMatched = BlockUtils.evaluateBlockRule(
              part.rule,
              voxelCoords ?? (voxelCoords = [vx, vy, vz]),
              oldRuleFunctions
            );

            if (ruleMatched) {
              if (part.redLightLevel !== undefined)
                currentRedLevel = part.redLightLevel;
              if (part.greenLightLevel !== undefined)
                currentGreenLevel = part.greenLightLevel;
              if (part.blueLightLevel !== undefined)
                currentBlueLevel = part.blueLightLevel;
              currentEmitsLight =
                currentRedLevel > 0 ||
                currentGreenLevel > 0 ||
                currentBlueLevel > 0;
              break;
            }
          }
        }
      }

      let newEmitsLight = newBlock.isLight;
      if (newBlock.dynamicPatterns) {
        newEmitsLight = false;
        const newRuleFunctions = {
          getVoxelAt: (x: number, y: number, z: number) => {
            if (x === vx && y === vy && z === vz) return update.newId;
            return this.getVoxelAtUnchecked(x, y, z);
          },
          getVoxelRotationAt: (x: number, y: number, z: number) => {
            if (x === vx && y === vy && z === vz) return newRotation;
            return this.getVoxelRotationAtUnchecked(x, y, z);
          },
          getVoxelStageAt: (x: number, y: number, z: number) => {
            if (x === vx && y === vy && z === vz) return update.stage;
            return this.getVoxelStageAtUnchecked(x, y, z);
          },
        };
        const dynamicPatterns = newBlock.dynamicPatterns;
        for (
          let patternIndex = 0;
          patternIndex < dynamicPatterns.length;
          patternIndex++
        ) {
          const parts = dynamicPatterns[patternIndex].parts;
          for (let partIndex = 0; partIndex < parts.length; partIndex++) {
            const part = parts[partIndex];
            const ruleMatched = BlockUtils.evaluateBlockRule(
              part.rule,
              voxelCoords ?? (voxelCoords = [vx, vy, vz]),
              newRuleFunctions
            );

            if (ruleMatched) {
              const hasLight =
                (part.redLightLevel || 0) > 0 ||
                (part.greenLightLevel || 0) > 0 ||
                (part.blueLightLevel || 0) > 0;
              if (hasLight) {
                newEmitsLight = true;
                break;
              }
            }
          }
          if (newEmitsLight) {
            break;
          }
        }
      }

      if (currentEmitsLight && !newEmitsLight) {
        const sourceVoxel: Coords3 = [vx, vy, vz];
        if (this.getSunlightAtUnchecked(vx, vy, vz) > 0) {
          sunlightRemoval.push(sourceVoxel);
        }

        if (currentRedLevel > 0) {
          redRemoval.push(sourceVoxel);
        }
        if (currentGreenLevel > 0) {
          greenRemoval.push(sourceVoxel);
        }
        if (currentBlueLevel > 0) {
          blueRemoval.push(sourceVoxel);
        }
        removedLightSourceFlags[index] = 1;
        hasRemovedLightSources = true;
      }
    }

    for (let index = 0; index < processedUpdateCount; index++) {
      const update = processedUpdates[index];
      const { vx, vy, vz, oldBlock, newBlock, oldRotation, newRotation } =
        update;
      let sourceVoxel: Coords3 | null = null;
      let voxelCoords: Coords3 | null = null;
      const isRemovedLightSource =
        hasRemovedLightSources && removedLightSourceFlags[index] === 1;

      if (isRemovedLightSource && !oldBlock.isOpaque) {
        continue;
      }

      const currentTransparency = BlockUtils.getBlockRotatedTransparency(
        oldBlock,
        oldRotation
      );
      const updatedTransparency = BlockUtils.getBlockRotatedTransparency(
        newBlock,
        newRotation
      );
      const sourceSunlightLevel = this.getSunlightAtUnchecked(vx, vy, vz);
      const sourceRedLevel = this.getTorchLightAtUnchecked(vx, vy, vz, "RED");
      const sourceGreenLevel = this.getTorchLightAtUnchecked(vx, vy, vz, "GREEN");
      const sourceBlueLevel = this.getTorchLightAtUnchecked(vx, vy, vz, "BLUE");

      if (newBlock.isOpaque || newBlock.lightReduce) {
        if (sourceSunlightLevel > 0) {
          if (!sourceVoxel) {
            sourceVoxel = [vx, vy, vz];
          }
          sunlightRemoval.push(sourceVoxel);
        }
        if (sourceRedLevel > 0) {
          if (!sourceVoxel) {
            sourceVoxel = [vx, vy, vz];
          }
          redRemoval.push(sourceVoxel);
        }
        if (sourceGreenLevel > 0) {
          if (!sourceVoxel) {
            sourceVoxel = [vx, vy, vz];
          }
          greenRemoval.push(sourceVoxel);
        }
        if (sourceBlueLevel > 0) {
          if (!sourceVoxel) {
            sourceVoxel = [vx, vy, vz];
          }
          blueRemoval.push(sourceVoxel);
        }
      } else {
        let removeCount = 0;
        const hasSunlightSource = sourceSunlightLevel > 0;
        const hasRedSource = sourceRedLevel > 0;
        const hasGreenSource = sourceGreenLevel > 0;
        const hasBlueSource = sourceBlueLevel > 0;

        for (
          let neighborIndex = 0;
          neighborIndex < VOXEL_NEIGHBORS.length;
          neighborIndex++
        ) {
          const neighborOffset = VOXEL_NEIGHBORS[neighborIndex];
          const ox = neighborOffset[0];
          const oy = neighborOffset[1];
          const oz = neighborOffset[2];
          const nvy = vy + oy;
          if (nvy < 0 || nvy >= maxHeight) {
            continue;
          }

          const nvx = vx + ox;
          const nvz = vz + oz;

          const nBlock = this.getBlockAt(nvx, nvy, nvz);
          const nRotation = this.getVoxelRotationAtUnchecked(nvx, nvy, nvz);
          const nTransparency = BlockUtils.getBlockRotatedTransparency(
            nBlock,
            nRotation
          );

          if (
            !(
              LightUtils.canEnter(
                currentTransparency,
                nTransparency,
                ox,
                oy,
                oz
              ) &&
              !LightUtils.canEnter(
                updatedTransparency,
                nTransparency,
                ox,
                oy,
                oz
              )
            )
          ) {
            continue;
          }

          if (hasSunlightSource) {
            const nSunlightLevel = this.getSunlightAtUnchecked(nvx, nvy, nvz);
            if (
              nSunlightLevel < sourceSunlightLevel ||
              (oy === -1 &&
                nSunlightLevel === maxLightLevel &&
                sourceSunlightLevel === maxLightLevel)
            ) {
              removeCount++;
              sunlightRemoval.push([nvx, nvy, nvz]);
            }
          }

          if (hasRedSource) {
            const nRedLevel = this.getTorchLightAtUnchecked(
              nvx,
              nvy,
              nvz,
              RED_LIGHT
            );
            if (nRedLevel < sourceRedLevel) {
              removeCount++;
              redRemoval.push([nvx, nvy, nvz]);
            }
          }

          if (hasGreenSource) {
            const nGreenLevel = this.getTorchLightAtUnchecked(
              nvx,
              nvy,
              nvz,
              GREEN_LIGHT
            );
            if (nGreenLevel < sourceGreenLevel) {
              removeCount++;
              greenRemoval.push([nvx, nvy, nvz]);
            }
          }

          if (hasBlueSource) {
            const nBlueLevel = this.getTorchLightAtUnchecked(
              nvx,
              nvy,
              nvz,
              BLUE_LIGHT
            );
            if (nBlueLevel < sourceBlueLevel) {
              removeCount++;
              blueRemoval.push([nvx, nvy, nvz]);
            }
          }
        }

        if (removeCount === 0) {
          if (sourceSunlightLevel !== 0) {
            if (!sourceVoxel) {
              sourceVoxel = [vx, vy, vz];
            }
            sunlightRemoval.push(sourceVoxel);
          }
          if (sourceRedLevel !== 0) {
            if (!sourceVoxel) {
              sourceVoxel = [vx, vy, vz];
            }
            redRemoval.push(sourceVoxel);
          }
          if (sourceGreenLevel !== 0) {
            if (!sourceVoxel) {
              sourceVoxel = [vx, vy, vz];
            }
            greenRemoval.push(sourceVoxel);
          }
          if (sourceBlueLevel !== 0) {
            if (!sourceVoxel) {
              sourceVoxel = [vx, vy, vz];
            }
            blueRemoval.push(sourceVoxel);
          }
        }
      }

      if (
        newBlock.isLight ||
        newBlock.dynamicPatterns
      ) {
        let redLevel = newBlock.redLightLevel;
        let greenLevel = newBlock.greenLightLevel;
        let blueLevel = newBlock.blueLightLevel;

        if (newBlock.dynamicPatterns) {
          const ruleFunctions = {
            getVoxelAt: (x: number, y: number, z: number) =>
              this.getVoxelAtUnchecked(x, y, z),
            getVoxelRotationAt: (x: number, y: number, z: number) =>
              this.getVoxelRotationAtUnchecked(x, y, z),
            getVoxelStageAt: (x: number, y: number, z: number) =>
              this.getVoxelStageAtUnchecked(x, y, z),
          };
          const dynamicPatterns = newBlock.dynamicPatterns;
          for (
            let patternIndex = 0;
            patternIndex < dynamicPatterns.length;
            patternIndex++
          ) {
            const parts = dynamicPatterns[patternIndex].parts;
            for (let partIndex = 0; partIndex < parts.length; partIndex++) {
              const part = parts[partIndex];
              const ruleMatched = BlockUtils.evaluateBlockRule(
                part.rule,
                voxelCoords ?? (voxelCoords = [vx, vy, vz]),
                ruleFunctions
              );

              if (ruleMatched) {
                if (part.redLightLevel !== undefined)
                  redLevel = part.redLightLevel;
                if (part.greenLightLevel !== undefined)
                  greenLevel = part.greenLightLevel;
                if (part.blueLightLevel !== undefined)
                  blueLevel = part.blueLightLevel;
                break;
              }
            }
          }
        }

        if (redLevel > 0) {
          if (!sourceVoxel) {
            sourceVoxel = [vx, vy, vz];
          }
          redFlood.push({
            voxel: sourceVoxel,
            level: redLevel,
          });
        }

        if (greenLevel > 0) {
          if (!sourceVoxel) {
            sourceVoxel = [vx, vy, vz];
          }
          greenFlood.push({
            voxel: sourceVoxel,
            level: greenLevel,
          });
        }

        if (blueLevel > 0) {
          if (!sourceVoxel) {
            sourceVoxel = [vx, vy, vz];
          }
          blueFlood.push({
            voxel: sourceVoxel,
            level: blueLevel,
          });
        }
      } else if (oldBlock.isOpaque && !newBlock.isOpaque) {
        for (
          let neighborIndex = 0;
          neighborIndex < VOXEL_NEIGHBORS.length;
          neighborIndex++
        ) {
          const neighborOffset = VOXEL_NEIGHBORS[neighborIndex];
          const ox = neighborOffset[0];
          const oy = neighborOffset[1];
          const oz = neighborOffset[2];
          const nvy = vy + oy;

          if (nvy < 0) {
            continue;
          }

          if (nvy >= maxHeight) {
            if (
              LightUtils.canEnter(
                [true, true, true, true, true, true],
                updatedTransparency,
                ox,
                -1,
                oz
              )
            ) {
              sunFlood.push({
                voxel: [vx + ox, vy, vz + oz],
                level: maxLightLevel,
              });
            }
            continue;
          }

          const nvx = vx + ox;
          const nvz = vz + oz;

          const nBlock = this.getBlockAt(nvx, nvy, nvz);
          const nRotation = this.getVoxelRotationAtUnchecked(nvx, nvy, nvz);
          const nTransparency = BlockUtils.getBlockRotatedTransparency(
            nBlock,
            nRotation
          );

          if (
            !LightUtils.canEnter(
              currentTransparency,
              nTransparency,
              ox,
              oy,
              oz
            ) &&
            LightUtils.canEnter(updatedTransparency, nTransparency, ox, oy, oz)
          ) {
            const level =
              this.getSunlightAtUnchecked(nvx, nvy, nvz) -
              (newBlock.lightReduce ? 1 : 0);
            if (level > 0) {
              sunFlood.push({
                voxel: [nvx, nvy, nvz],
                level: level,
              });
            }

            if (!isRemovedLightSource) {
              const redLevel =
                this.getTorchLightAtUnchecked(nvx, nvy, nvz, "RED") -
                (newBlock.lightReduce ? 1 : 0);
              if (redLevel > 0) {
                redFlood.push({
                  voxel: [nvx, nvy, nvz],
                  level: redLevel,
                });
              }

              const greenLevel =
                this.getTorchLightAtUnchecked(nvx, nvy, nvz, "GREEN") -
                (newBlock.lightReduce ? 1 : 0);
              if (greenLevel > 0) {
                greenFlood.push({
                  voxel: [nvx, nvy, nvz],
                  level: greenLevel,
                });
              }

              const blueLevel =
                this.getTorchLightAtUnchecked(nvx, nvy, nvz, "BLUE") -
                (newBlock.lightReduce ? 1 : 0);
              if (blueLevel > 0) {
                blueFlood.push({
                  voxel: [nvx, nvy, nvz],
                  level: blueLevel,
                });
              }
            }
          }
        }
      }
    }

    const hasOperations =
      redRemoval.length > 0 ||
      greenRemoval.length > 0 ||
      blueRemoval.length > 0 ||
      sunlightRemoval.length > 0 ||
      redFlood.length > 0 ||
      greenFlood.length > 0 ||
      blueFlood.length > 0 ||
      sunFlood.length > 0;

    return {
      removals: {
        sunlight: sunlightRemoval,
        red: redRemoval,
        green: greenRemoval,
        blue: blueRemoval,
      },
      floods: {
        sunlight: sunFlood,
        red: redFlood,
        green: greenFlood,
        blue: blueFlood,
      },
      hasOperations,
    };
  }

  private processLightUpdates = (
    updates: BlockUpdateWithSource[],
    startIndex = 0,
    endIndex = updates.length,
    collectClientUpdates = true
  ) => {
    const startTime = performance.now();
    const startSequenceId = this.deltaSequenceCounter;

    const { maxHeight, maxLightsUpdateTime } = this.options;
    const updateDeadline = startTime + maxLightsUpdateTime;
    const maxUpdates = endIndex - startIndex;
    if (maxUpdates <= 0) {
      return {
        consumedCount: 0,
        processedClientUpdates: EMPTY_BLOCK_UPDATES,
      };
    }

    let consumedCount = 0;
    const processedClientUpdates = collectClientUpdates
      ? new Array<BlockUpdate>(maxUpdates)
      : EMPTY_BLOCK_UPDATES;
    let processedClientUpdateCount = 0;
    const processedUpdates = new Array<ProcessedUpdate>(maxUpdates);
    let processedUpdateCount = 0;
    const blockCache = this.processLightUpdateBlockCache;
    blockCache.clear();
    const getCachedBlock = (id: number) => {
      let block = blockCache.get(id);
      if (!block) {
        block = this.getBlockById(id);
        blockCache.set(id, block);
      }
      return block;
    };

    for (let index = startIndex; index < endIndex; index++) {
      if (
        consumedCount > 0 &&
        (consumedCount & 15) === 0 &&
        performance.now() > updateDeadline
      ) {
        break;
      }

      const update = updates[index];
      consumedCount++;

      const {
        update: { type, vx, vy, vz, rotation, yRotation, stage },
      } = update;

      if (vy < 0 || vy >= maxHeight) continue;

      const chunk = this.getLoadedChunkAtVoxel(vx, vz);
      if (!chunk) {
        continue;
      }

      const currentRaw = chunk.getRawValue(vx, vy, vz);
      const currentId = BlockUtils.extractID(currentRaw);
      const currentBlock = getCachedBlock(currentId);
      const newBlock = getCachedBlock(type);
      const currentRotation = BlockUtils.extractRotation(currentRaw);
      const currentStage = BlockUtils.extractStage(currentRaw);
      const normalizedStage =
        stage === undefined || Number.isNaN(stage) ? 0 : stage;
      const hasRotation = newBlock.rotatable || newBlock.yRotatable;
      const normalizedRotation =
        rotation === undefined || Number.isNaN(rotation) ? PY_ROTATION : rotation;
      const normalizedYRotation =
        yRotation === undefined || Number.isNaN(yRotation) ? 0 : yRotation;
      const finalRotation = hasRotation
        ? BlockRotation.encode(normalizedRotation, normalizedYRotation)
        : currentRotation.value === PY_ROTATION && currentRotation.yRotation === 0
        ? currentRotation
        : new BlockRotation();

      const newValue = BlockUtils.insertAll(
        newBlock.id,
        hasRotation ? finalRotation : undefined,
        normalizedStage
      );
      if (currentRaw === newValue) {
        continue;
      }

      this.attemptBlockCache(vx, vy, vz, currentRaw, newValue);
      chunk.setRawValue(vx, vy, vz, newValue);

      const voxelChanged = currentId !== type;
      const rotationChanged =
        currentRotation.value !== finalRotation.value ||
        currentRotation.yRotation !== finalRotation.yRotation;
      const stageChanged = currentStage !== normalizedStage;

      const deltaData: Partial<
        Omit<VoxelDelta, "coords" | "timestamp" | "sequenceId">
      > = {};
      if (voxelChanged) {
        deltaData.oldVoxel = currentId;
        deltaData.newVoxel = type;
      }
      if (rotationChanged) {
        deltaData.oldRotation = currentRotation;
        deltaData.newRotation = finalRotation;
      }
      if (stageChanged) {
        deltaData.oldStage = currentStage;
        deltaData.newStage = normalizedStage;
      }
      this.recordVoxelDelta(vx, vy, vz, deltaData, chunk.name);
      this.trackChunkAt(vx, vy, vz);

      processedUpdates[processedUpdateCount] = {
        vx,
        vy,
        vz,
        oldId: currentId,
        newId: type,
        oldBlock: currentBlock,
        newBlock: newBlock,
        oldRotation: currentRotation,
        newRotation: finalRotation,
        oldStage: currentStage,
        stage: normalizedStage,
      };
      processedUpdateCount++;
      if (collectClientUpdates && update.source === "client") {
        processedClientUpdates[processedClientUpdateCount] = update.update;
        processedClientUpdateCount++;
      }
    }
    processedUpdates.length = processedUpdateCount;
    const lightOps = this.analyzeLightOperations(processedUpdates);

    if (this.options.useLightWorkers && lightOps.hasOperations) {
      if (!this.accumulatedLightOps) {
        this.accumulatedLightOps = lightOps;
        this.accumulatedStartSequenceId = startSequenceId;
      } else {
        this.accumulatedLightOps = this.mergeLightOperations(
          this.accumulatedLightOps,
          lightOps
        );
        this.accumulatedStartSequenceId = Math.min(
          this.accumulatedStartSequenceId,
          startSequenceId
        );
      }
    } else if (lightOps.hasOperations) {
      this.executeLightOperationsSyncAll(lightOps);
    }

    if (collectClientUpdates) {
      processedClientUpdates.length = processedClientUpdateCount;
    }
    return {
      consumedCount,
      processedClientUpdates,
    };
  };

  private processClientUpdates = () => {
    if (!this.hasPendingBlockUpdates() || this.isTrackingChunks) {
      return;
    }

    const maxUpdatesPerUpdate = this.options.maxUpdatesPerUpdate;
    if (maxUpdatesPerUpdate <= 0) {
      return;
    }

    this.clientUpdateBatchSize = maxUpdatesPerUpdate;
    this.isTrackingChunks = true;
    this.processUpdatesInIdleTime();
  };

  private processUpdatesInIdleTime = () => {
    if (this.hasPendingBlockUpdates()) {
      const batchEnd = Math.min(
        this.blockUpdatesQueueHead + this.clientUpdateBatchSize,
        this.blockUpdatesQueue.length
      );

      const { consumedCount, processedClientUpdates } = this.processLightUpdates(
        this.blockUpdatesQueue,
        this.blockUpdatesQueueHead,
        batchEnd
      );
      this.blockUpdatesQueueHead += consumedCount;
      this.normalizeBlockUpdatesQueue();
      this.appendBlockUpdatesToEmit(processedClientUpdates);

      if (this.hasPendingBlockUpdates()) {
        requestAnimationFrame(this.processUpdatesInIdleTime);
        return;
      }
    }

    this.flushAccumulatedLightOps();
    this.isTrackingChunks = false;
    this.processDirtyChunks();
  };

  private appendBlockUpdatesToEmit(updates: BlockUpdate[]) {
    const updateCount = updates.length;
    if (updateCount === 0) {
      return;
    }

    const start = this.blockUpdatesToEmit.length;
    this.blockUpdatesToEmit.length = start + updateCount;
    for (let index = 0; index < updateCount; index++) {
      this.blockUpdatesToEmit[start + index] = updates[index];
    }
  }

  private hasPendingBlockUpdates() {
    return this.blockUpdatesQueueHead < this.blockUpdatesQueue.length;
  }

  private normalizeBlockUpdatesQueue() {
    if (this.blockUpdatesQueueHead === 0) {
      return;
    }

    if (this.blockUpdatesQueueHead >= this.blockUpdatesQueue.length) {
      this.blockUpdatesQueue = [];
      this.blockUpdatesQueueHead = 0;
      return;
    }

    if (
      this.blockUpdatesQueueHead >= 1024 &&
      this.blockUpdatesQueueHead * 2 >= this.blockUpdatesQueue.length
    ) {
      this.blockUpdatesQueue.copyWithin(0, this.blockUpdatesQueueHead);
      this.blockUpdatesQueue.length -= this.blockUpdatesQueueHead;
      this.blockUpdatesQueueHead = 0;
    }
  }

  private processDirtyChunks = async () => {
    if (this.isProcessingDirtyChunks) {
      this.shouldRerunDirtyChunkProcessing = true;
      return;
    }

    this.isProcessingDirtyChunks = true;
    try {
      const maxConcurrentMeshJobs = this.options.maxMeshesPerUpdate ?? 8;
      if (maxConcurrentMeshJobs <= 0) {
        return;
      }

      const {
        keys: dirtyKeys,
        hasMore: hasMoreDirtyKeys,
      } = this.meshPipeline.getDirtyKeysAndHasMore(maxConcurrentMeshJobs);
      if (dirtyKeys.length === 0) {
        return;
      }

      const processCount = dirtyKeys.length;
      this.ensureMeshJobArrayCapacity(processCount);
      const workerPromises = this.meshWorkerPromises;
      const jobKeys = this.meshJobKeys;
      this.ensureMeshJobMetadataCapacity(processCount);
      const jobCxs = this.meshJobCxs;
      const jobCzs = this.meshJobCzs;
      const jobLevels = this.meshJobLevels;
      const jobGenerations = this.meshJobGenerations;
      let workerCount = 0;

      for (let index = 0; index < processCount; index++) {
        const key = dirtyKeys[index];
        const startedJob = this.meshPipeline.startJob(key);
        if (!startedJob) {
          continue;
        }

        const { cx, cz, level, generation } = startedJob;
        jobKeys[workerCount] = key;
        jobCxs[workerCount] = cx;
        jobCzs[workerCount] = cz;
        jobLevels[workerCount] = level;
        jobGenerations[workerCount] = generation;
        workerPromises[workerCount] = this.dispatchMeshWorker(
          cx,
          cz,
          level
        ).catch(NULL_GEOMETRY_RESULT);
        workerCount++;
      }
      if (workerCount === 0) {
        return;
      }
      workerPromises.length = workerCount;

      let shouldScheduleDirtyChunks = false;
      if (workerCount === 1) {
        const geometries = await workerPromises[0];
        if (geometries) {
          const completionStatus = this.applyMeshResult(
            jobCxs[0],
            jobCzs[0],
            jobLevels[0],
            geometries,
            jobGenerations[0]
          );
          if ((completionStatus & MESH_JOB_NEEDS_REMESH) !== 0) {
            shouldScheduleDirtyChunks = true;
          }
        } else {
          const abortStatus = this.meshPipeline.abortJob(jobKeys[0]);
          if ((abortStatus & MESH_JOB_NEEDS_REMESH) !== 0) {
            shouldScheduleDirtyChunks = true;
          }
        }
      } else {
        const geometriesResults = await Promise.all(workerPromises);
        for (let index = 0; index < geometriesResults.length; index++) {
          const geometries = geometriesResults[index];
          if (geometries) {
            const completionStatus = this.applyMeshResult(
              jobCxs[index],
              jobCzs[index],
              jobLevels[index],
              geometries,
              jobGenerations[index]
            );
            if ((completionStatus & MESH_JOB_NEEDS_REMESH) !== 0) {
              shouldScheduleDirtyChunks = true;
            }
          } else {
            const abortStatus = this.meshPipeline.abortJob(jobKeys[index]);
            if ((abortStatus & MESH_JOB_NEEDS_REMESH) !== 0) {
              shouldScheduleDirtyChunks = true;
            }
          }
        }
      }

      if (
        shouldScheduleDirtyChunks ||
        hasMoreDirtyKeys ||
        this.meshPipeline.hasDirtyChunks()
      ) {
        this.scheduleDirtyChunkProcessing();
      }
    } finally {
      this.isProcessingDirtyChunks = false;
      if (this.shouldRerunDirtyChunkProcessing) {
        this.shouldRerunDirtyChunkProcessing = false;
        this.scheduleDirtyChunkProcessing();
      }
    }
  };

  private scheduleDirtyChunkProcessing = (() => {
    let scheduled = false;
    return () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scheduled = false;
          this.processDirtyChunks();
        });
      });
    };
  })();

  private appendItems<T>(target: T[], source: T[]) {
    const sourceCount = source.length;
    if (sourceCount === 0) {
      return;
    }

    const start = target.length;
    target.length = start + sourceCount;
    for (let index = 0; index < sourceCount; index++) {
      target[start + index] = source[index];
    }
  }

  private mergeLightOperations(
    existing: LightOperations,
    newOps: LightOperations
  ): LightOperations {
    this.appendItems(existing.removals.sunlight, newOps.removals.sunlight);
    this.appendItems(existing.removals.red, newOps.removals.red);
    this.appendItems(existing.removals.green, newOps.removals.green);
    this.appendItems(existing.removals.blue, newOps.removals.blue);
    this.appendItems(existing.floods.sunlight, newOps.floods.sunlight);
    this.appendItems(existing.floods.red, newOps.floods.red);
    this.appendItems(existing.floods.green, newOps.floods.green);
    this.appendItems(existing.floods.blue, newOps.floods.blue);
    existing.hasOperations = existing.hasOperations || newOps.hasOperations;
    return existing;
  }

  private flushAccumulatedLightOps() {
    if (!this.accumulatedLightOps || !this.accumulatedLightOps.hasOperations) {
      return;
    }

    this.scheduleLightJobs(
      this.accumulatedLightOps,
      this.accumulatedStartSequenceId
    );

    this.accumulatedLightOps = null;
    this.accumulatedStartSequenceId = 0;
  }

  private scheduleLightJobs(
    lightOps: LightOperations,
    startSequenceId: number
  ) {
    const { maxLightLevel, chunkSize, minChunk, maxChunk, maxHeight } =
      this.options;
    const minVoxelX = minChunk[0] * chunkSize;
    const minVoxelZ = minChunk[1] * chunkSize;
    const maxVoxelX = (maxChunk[0] + 1) * chunkSize - 1;
    const maxVoxelZ = (maxChunk[1] + 1) * chunkSize - 1;
    const batchId = this.lightBatchIdCounter++;
    let queuedJobs = 0;

    for (
      let channelIndex = 0;
      channelIndex < LIGHT_COLOR_CHANNELS.length;
      channelIndex++
    ) {
      const { color, channel } = LIGHT_COLOR_CHANNELS[channelIndex];
      const removals = lightOps.removals[channel];
      const floods = lightOps.floods[channel];
      if (removals.length === 0 && floods.length === 0) {
        continue;
      }

      const job = this.createLightJob(
        color,
        removals,
        floods,
        startSequenceId,
        batchId,
        maxLightLevel,
        minVoxelX,
        minVoxelZ,
        maxVoxelX,
        maxVoxelZ,
        maxHeight
      );
      if (job) {
        this.lightJobQueue.push(job);
        queuedJobs++;
      }
    }

    if (queuedJobs === 0) {
      return;
    }
    this.processNextLightBatch();
  }

  private createLightJob(
    color: LightColor,
    removals: Coords3[],
    floods: LightNode[],
    startSequenceId: number,
    batchId: number,
    maxLightLevel: number,
    minVoxelX: number,
    minVoxelZ: number,
    maxVoxelX: number,
    maxVoxelZ: number,
    maxHeight: number
  ): LightJob | null {
    if (removals.length === 0 && floods.length === 0) {
      return null;
    }

    const firstVoxel = removals.length > 0 ? removals[0] : floods[0].voxel;
    let minX = firstVoxel[0];
    let minY = firstVoxel[1];
    let minZ = firstVoxel[2];
    let maxX = minX;
    let maxY = minY;
    let maxZ = minZ;

    for (let removalIndex = 0; removalIndex < removals.length; removalIndex++) {
      const removal = removals[removalIndex];
      const x = removal[0];
      const y = removal[1];
      const z = removal[2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }

    for (let floodIndex = 0; floodIndex < floods.length; floodIndex++) {
      const voxel = floods[floodIndex].voxel;
      const x = voxel[0];
      const y = voxel[1];
      const z = voxel[2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }

    minX -= maxLightLevel;
    minZ -= maxLightLevel;
    maxX += maxLightLevel;
    maxZ += maxLightLevel;

    minX = Math.max(minX, minVoxelX);
    minZ = Math.max(minZ, minVoxelZ);
    maxX = Math.min(maxX, maxVoxelX);
    maxZ = Math.min(maxZ, maxVoxelZ);
    minY = Math.max(minY, 0);
    maxY = Math.min(maxY, maxHeight - 1);

    const boundingBox: BoundingBox = {
      min: [minX, minY, minZ],
      shape: [maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1],
    };

    if (
      boundingBox.shape[0] <= 0 ||
      boundingBox.shape[1] <= 0 ||
      boundingBox.shape[2] <= 0
    ) {
      return null;
    }

    return {
      jobId: `light-${color}-${this.lightJobIdCounter++}`,
      color,
      lightOps: { removals, floods },
      boundingBox,
      startSequenceId,
      retryCount: 0,
      batchId,
    };
  }

  private hasPendingLightJobs(): boolean {
    return this.lightJobQueueHead < this.lightJobQueue.length;
  }

  private normalizeLightJobQueue() {
    if (this.lightJobQueueHead === 0) {
      return;
    }

    if (this.lightJobQueueHead >= this.lightJobQueue.length) {
      this.lightJobQueue = [];
      this.lightJobQueueHead = 0;
      return;
    }

    if (
      this.lightJobQueueHead >= 1024 &&
      this.lightJobQueueHead * 2 >= this.lightJobQueue.length
    ) {
      this.lightJobQueue.copyWithin(0, this.lightJobQueueHead);
      this.lightJobQueue.length -= this.lightJobQueueHead;
      this.lightJobQueueHead = 0;
    }
  }

  private processNextLightBatch() {
    if (!this.hasPendingLightJobs()) return;
    if (this.activeLightBatch !== null) return;

    const batchStart = this.lightJobQueueHead;
    const firstJob = this.lightJobQueue[batchStart];
    const batchId = firstJob.batchId;

    let batchEnd = batchStart + 1;
    while (
      batchEnd < this.lightJobQueue.length &&
      this.lightJobQueue[batchEnd].batchId === batchId
    ) {
      batchEnd++;
    }
    const totalJobs = batchEnd - batchStart;

    this.activeLightBatch = {
      batchId,
      startSequenceId: firstJob.startSequenceId,
      totalJobs,
      completedJobs: 0,
      results: new Array<LightBatchResult>(totalJobs),
    };

    for (let index = batchStart; index < batchEnd; index++) {
      this.executeLightJob(this.lightJobQueue[index]);
    }

    this.lightJobQueueHead = batchEnd;
    this.normalizeLightJobQueue();
  }

  private executeLightJob(job: LightJob) {
    const { jobId, boundingBox, lightOps, startSequenceId, color } = job;
    const { min, shape } = boundingBox;

    const [minX, , minZ] = min;
    const [width, , depth] = shape;
    const maxX = minX + width - 1;
    const maxZ = minZ + depth - 1;

    const { chunkSize } = this.options;
    const minChunkX = Math.floor(minX / chunkSize);
    const minChunkZ = Math.floor(minZ / chunkSize);
    const maxChunkX = Math.floor(maxX / chunkSize);
    const maxChunkZ = Math.floor(maxZ / chunkSize);
    const gridWidth = maxChunkX - minChunkX + 1;
    const gridDepth = maxChunkZ - minChunkZ + 1;
    const gridChunkCount = gridWidth * gridDepth;

    const relevantDeltas = new Array<{
      cx: number;
      cz: number;
      deltas: VoxelDelta[];
      startIndex: number;
    }>(gridChunkCount);
    let relevantDeltaCount = 0;
    let lastRelevantSequenceId = 0;
    const chunksData: (object | null)[] = new Array(gridChunkCount);
    const arrayBuffers: ArrayBuffer[] = [];
    let chunkDataIndex = 0;

    for (let cx = minChunkX; cx <= maxChunkX; cx++) {
      for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
        const dataIndex = chunkDataIndex;
        chunkDataIndex++;

        const chunk = this.getLoadedChunkByCoords(cx, cz);
        if (chunk && chunk.isReady) {
          const allDeltas = this.voxelDeltas.get(chunk.name);
          if (allDeltas) {
            const firstRelevantIndex = this.findFirstDeltaAfter(
              allDeltas,
              startSequenceId
            );
            if (firstRelevantIndex < allDeltas.length) {
              const chunkLastSequenceId =
                allDeltas[allDeltas.length - 1].sequenceId;
              if (chunkLastSequenceId > lastRelevantSequenceId) {
                lastRelevantSequenceId = chunkLastSequenceId;
              }
              relevantDeltas[relevantDeltaCount] = {
                cx,
                cz,
                deltas: allDeltas,
                startIndex: firstRelevantIndex,
              };
              relevantDeltaCount++;
            }
          }

          const [data, buffers] = chunk.serialize();
          chunksData[dataIndex] = data;
          for (let bufferIndex = 0; bufferIndex < buffers.length; bufferIndex++) {
            arrayBuffers.push(buffers[bufferIndex]);
          }
        } else {
          chunksData[dataIndex] = null;
        }
      }
    }
    relevantDeltas.length = relevantDeltaCount;

    this.lightWorkerPool.addJob({
      message: {
        type: "batchOperations",
        jobId,
        color,
        boundingBox,
        chunksData,
        chunkGridDimensions: [gridWidth, gridDepth],
        chunkGridOffset: [minChunkX, minChunkZ],
        lastRelevantSequenceId,
        relevantDeltas,
        lightOps,
        options: this.options,
      },
      buffers: arrayBuffers,
      resolve: (result) => this.handleLightJobResult(job, result),
      reject: (error) => this.handleLightJobFailure(job, error),
    });
  }

  private handleLightJobFailure(job: LightJob, error: Error) {
    console.error(`Light worker job ${job.jobId} failed.`, error);
    this.handleLightJobResult(job, {
      jobId: job.jobId,
      modifiedChunks: [],
      appliedDeltas: {
        lastSequenceId: 0,
      },
    });
  }

  private handleLightJobResult(job: LightJob, result: LightWorkerResult) {
    if (
      !this.activeLightBatch ||
      this.activeLightBatch.batchId !== job.batchId
    ) {
      return;
    }

    const batch = this.activeLightBatch;
    const resultIndex = batch.completedJobs;
    batch.results[resultIndex] = {
      color: job.color,
      modifiedChunks: result.modifiedChunks,
      boundingBox: job.boundingBox,
    };
    batch.completedJobs = resultIndex + 1;

    if (batch.completedJobs < batch.totalJobs) {
      return;
    }

    this.applyBatchResults(batch);
    this.activeLightBatch = null;
    this.processNextLightBatch();

    if (!this.hasPendingLightJobs() && this.activeLightBatch === null) {
      const resolvers = this.lightJobsCompleteResolvers;
      this.lightJobsCompleteResolvers = [];
      for (let i = 0; i < resolvers.length; i++) {
        resolvers[i]();
      }
      this.processDirtyChunks();
    }
  }

  private applyBatchResults(batch: LightBatch) {
    const { maxHeight, subChunks, maxLightLevel } = this.options;
    const subChunkHeight = maxHeight / subChunks;

    const chunkResultsByX = new Map<
      number,
      Map<number, ChunkLightColorResults>
    >();
    const chunkResultsList: ChunkLightColorResults[] = [];

    let globalMinY = maxHeight;
    let globalMaxY = 0;

    for (let resultIndex = 0; resultIndex < batch.results.length; resultIndex++) {
      const result = batch.results[resultIndex];
      const minY = Math.max(0, result.boundingBox.min[1] - maxLightLevel);
      const maxY = Math.min(
        maxHeight - 1,
        result.boundingBox.min[1] +
          result.boundingBox.shape[1] -
          1 +
          maxLightLevel
      );
      globalMinY = Math.min(globalMinY, minY);
      globalMaxY = Math.max(globalMaxY, maxY);

      for (
        let chunkIndex = 0;
        chunkIndex < result.modifiedChunks.length;
        chunkIndex++
      ) {
        const { coords, lights } = result.modifiedChunks[chunkIndex];
        const cx = coords[0];
        const cz = coords[1];
        let chunkResultsByZ = chunkResultsByX.get(cx);
        if (!chunkResultsByZ) {
          chunkResultsByZ = new Map();
          chunkResultsByX.set(cx, chunkResultsByZ);
        }

        let chunkResult = chunkResultsByZ.get(cz);
        const isNewChunkResult = chunkResult === undefined;
        if (!chunkResult) {
          chunkResult = {
            coords,
            colorCount: 1,
            firstColor: result.color,
            firstLights: lights,
          };
          chunkResultsByZ.set(cz, chunkResult);
          chunkResultsList.push(chunkResult);
        }

        switch (result.color) {
          case "SUNLIGHT":
            if (!isNewChunkResult && chunkResult.sunlight === undefined) {
              chunkResult.colorCount++;
            }
            chunkResult.sunlight = lights;
            break;
          case "RED":
            if (!isNewChunkResult && chunkResult.red === undefined) {
              chunkResult.colorCount++;
            }
            chunkResult.red = lights;
            break;
          case "GREEN":
            if (!isNewChunkResult && chunkResult.green === undefined) {
              chunkResult.colorCount++;
            }
            chunkResult.green = lights;
            break;
          case "BLUE":
            if (!isNewChunkResult && chunkResult.blue === undefined) {
              chunkResult.colorCount++;
            }
            chunkResult.blue = lights;
            break;
        }
      }
    }

    if (chunkResultsList.length === 0) {
      return;
    }

    const minLevel = Math.floor(globalMinY / subChunkHeight);
    const maxLevel = Math.min(
      subChunks - 1,
      Math.floor(globalMaxY / subChunkHeight)
    );

    for (let index = 0; index < chunkResultsList.length; index++) {
      const chunkResult = chunkResultsList[index];
      const { coords, colorCount, firstColor, firstLights } = chunkResult;
      const chunk = this.getLoadedChunkByCoords(coords[0], coords[1]);
      if (!chunk) continue;

      if (colorCount === 1) {
        this.mergeSingleColorResult(chunk, firstLights, firstColor);
      } else {
        this.mergeMultiColorResults(chunk, chunkResult);
      }

      chunk.isDirty = true;
      this.markChunkForRemeshLevelsAt(coords[0], coords[1], minLevel, maxLevel);
    }
  }

  private mergeSingleColorResult(
    chunk: Chunk,
    lights: Uint32Array,
    color: LightColor
  ) {
    const currentLights = chunk.lights.data;
    const mask = this.getLightColorMask(color);
    const inverseMask = ~mask >>> 0;

    for (let i = 0; i < currentLights.length; i++) {
      currentLights[i] = (currentLights[i] & inverseMask) | (lights[i] & mask);
    }
  }

  private mergeMultiColorResults(
    chunk: Chunk,
    colorResults: ChunkLightColorResults
  ) {
    const currentLights = chunk.lights.data;
    const fallbackSource = colorResults.firstLights;
    const sunlightSource = colorResults.sunlight ?? fallbackSource;
    const redSource = colorResults.red ?? fallbackSource;
    const greenSource = colorResults.green ?? fallbackSource;
    const blueSource = colorResults.blue ?? fallbackSource;

    for (let i = 0; i < currentLights.length; i++) {
      currentLights[i] =
        (sunlightSource[i] & 0xf000) |
        (redSource[i] & 0x0f00) |
        (greenSource[i] & 0x00f0) |
        (blueSource[i] & 0x000f);
    }
  }

  private getLightColorMask(color: LightColor): number {
    switch (color) {
      case "SUNLIGHT":
        return 0xf000;
      case "RED":
        return 0x0f00;
      case "GREEN":
        return 0x00f0;
      case "BLUE":
        return 0x000f;
    }
  }

  private waitForLightJobsComplete(): Promise<void> {
    if (!this.hasPendingLightJobs() && this.activeLightBatch === null) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.lightJobsCompleteResolvers.push(resolve);
    });
  }

  private executeLightOperationsSync(
    lightOps: { removals: Coords3[]; floods: LightNode[] },
    color: LightColor
  ) {
    if (lightOps.removals.length > 0) {
      this.removeLightsBatch(lightOps.removals, color);
    }

    if (lightOps.floods.length > 0) {
      this.floodLight(lightOps.floods, color);
    }

    const { chunkSize } = this.options;
    const affectedChunks = this.syncLightAffectedChunks;
    const reusableZSets = this.reusableSyncLightAffectedZSets;
    affectedChunks.clear();

    for (let removalIndex = 0; removalIndex < lightOps.removals.length; removalIndex++) {
      const voxel = lightOps.removals[removalIndex];
      const cx = Math.floor(voxel[0] / chunkSize);
      const cz = Math.floor(voxel[2] / chunkSize);
      let zSet = affectedChunks.get(cx);
      if (!zSet) {
        const pooled = reusableZSets.pop();
        zSet = pooled ? pooled : new Set<number>();
        affectedChunks.set(cx, zSet);
      }
      zSet.add(cz);
    }

    for (let floodIndex = 0; floodIndex < lightOps.floods.length; floodIndex++) {
      const voxel = lightOps.floods[floodIndex].voxel;
      const cx = Math.floor(voxel[0] / chunkSize);
      const cz = Math.floor(voxel[2] / chunkSize);
      let zSet = affectedChunks.get(cx);
      if (!zSet) {
        const pooled = reusableZSets.pop();
        zSet = pooled ? pooled : new Set<number>();
        affectedChunks.set(cx, zSet);
      }
      zSet.add(cz);
    }

    let affectedChunkEntries = affectedChunks.entries();
    let affectedChunkEntry = affectedChunkEntries.next();
    while (!affectedChunkEntry.done) {
      const entry = affectedChunkEntry.value;
      const cx = entry[0];
      const zSet = entry[1];
      let zValues = zSet.values();
      let zValue = zValues.next();
      while (!zValue.done) {
        this.markChunkForRemeshAt(cx, zValue.value);
        zValue = zValues.next();
      }
      zSet.clear();
      reusableZSets.push(zSet);
      affectedChunkEntry = affectedChunkEntries.next();
    }
    affectedChunks.clear();
  }

  private executeLightOperationsSyncAll(lightOps: LightOperations) {
    for (
      let channelIndex = 0;
      channelIndex < LIGHT_COLOR_CHANNELS.length;
      channelIndex++
    ) {
      const { color, channel } = LIGHT_COLOR_CHANNELS[channelIndex];
      const removals = lightOps.removals[channel];
      const floods = lightOps.floods[channel];

      if (removals.length > 0 || floods.length > 0) {
        this.executeLightOperationsSync({ removals, floods }, color);
      }
    }
  }

  /**
   * Scaffold the server updates onto the network, including chunk requests and block updates.
   */
  private emitServerUpdates = () => {
    if (!this.hasPendingBlockUpdatesToEmit()) {
      return;
    }

    const maxUpdatesPerUpdate = this.options.maxUpdatesPerUpdate;
    if (maxUpdatesPerUpdate <= 0) {
      return;
    }

    const batchEnd = Math.min(
      this.blockUpdatesToEmitHead + maxUpdatesPerUpdate,
      this.blockUpdatesToEmit.length
    );
    const updateCount = batchEnd - this.blockUpdatesToEmitHead;
    const vxValues = new Array<number>(updateCount);
    const vyValues = new Array<number>(updateCount);
    const vzValues = new Array<number>(updateCount);
    const voxelValues = new Array<number>(updateCount);
    const lightValues = new Array<number>(updateCount);
    const blockCache = this.emitServerUpdateBlockCache;
    blockCache.clear();
    const getCachedBlock = (id: number) => {
      let block = blockCache.get(id);
      if (!block) {
        block = this.getBlockById(id);
        blockCache.set(id, block);
      }
      return block;
    };

    for (let index = 0; index < updateCount; index++) {
      const update = this.blockUpdatesToEmit[this.blockUpdatesToEmitHead + index];
      const { type, rotation, yRotation, stage } = update;

      const block = getCachedBlock(type);

      let raw = type & 0xffff;
      const hasRotation = rotation !== undefined && !Number.isNaN(rotation);
      const hasYRotation =
        yRotation !== undefined && !Number.isNaN(yRotation);

      if (
        (block.rotatable || block.yRotatable) &&
        (hasRotation || hasYRotation)
      ) {
        const encodedRotation = hasRotation ? rotation : PY_ROTATION;
        const encodedYRotation = hasYRotation ? yRotation : 0;
        raw = BlockUtils.insertRotationValues(
          raw,
          encodedRotation,
          encodedYRotation
        );
      }

      if (stage !== undefined && !Number.isNaN(stage)) {
        raw = BlockUtils.insertStage(raw, stage);
      }

      vxValues[index] = update.vx;
      vyValues[index] = update.vy;
      vzValues[index] = update.vz;
      voxelValues[index] = raw;
      lightValues[index] = 0;
    }

    this.packets.push({
      type: "UPDATE",
      bulkUpdate: {
        vx: vxValues,
        vy: vyValues,
        vz: vzValues,
        voxels: voxelValues,
        lights: lightValues,
      },
    });

    this.blockUpdatesToEmitHead = batchEnd;
    this.normalizeBlockUpdatesToEmit();
  };

  private hasPendingBlockUpdatesToEmit(): boolean {
    return this.blockUpdatesToEmitHead < this.blockUpdatesToEmit.length;
  }

  private normalizeBlockUpdatesToEmit() {
    if (this.blockUpdatesToEmitHead === 0) {
      return;
    }

    if (this.blockUpdatesToEmitHead >= this.blockUpdatesToEmit.length) {
      this.blockUpdatesToEmit = [];
      this.blockUpdatesToEmitHead = 0;
      return;
    }

    if (
      this.blockUpdatesToEmitHead >= 1024 &&
      this.blockUpdatesToEmitHead * 2 >= this.blockUpdatesToEmit.length
    ) {
      this.blockUpdatesToEmit.copyWithin(0, this.blockUpdatesToEmitHead);
      this.blockUpdatesToEmit.length -= this.blockUpdatesToEmitHead;
      this.blockUpdatesToEmitHead = 0;
    }
  }

  /**
   * Make a chunk shader material with the current atlas.
   */
  private makeShaderMaterial = (
    fragmentShader?: string,
    vertexShader?: string,
    uniforms: Record<string, Uniform> = {}
  ) => {
    const useShaderLighting = this.usesShaderLighting;
    const baseShaders = useShaderLighting
      ? SHADER_LIGHTING_CHUNK_SHADERS
      : DEFAULT_CHUNK_SHADERS;

    const actualFragmentShader = fragmentShader ?? baseShaders.fragment;
    const actualVertexShader = vertexShader ?? baseShaders.vertex;

    const chunksUniforms = {
      ...this.chunkRenderer.uniforms,
      ...this.options.chunkUniformsOverwrite,
    };

    const shaderLightingUniforms = useShaderLighting
      ? {
          uSunDirection: this.chunkRenderer.shaderLightingUniforms.sunDirection,
          uSunColor: this.chunkRenderer.shaderLightingUniforms.sunColor,
          uAmbientColor: this.chunkRenderer.shaderLightingUniforms.ambientColor,
          uShadowMap0: this.chunkRenderer.shaderLightingUniforms.shadowMap0,
          uShadowMap1: this.chunkRenderer.shaderLightingUniforms.shadowMap1,
          uShadowMap2: this.chunkRenderer.shaderLightingUniforms.shadowMap2,
          uShadowMatrix0:
            this.chunkRenderer.shaderLightingUniforms.shadowMatrix0,
          uShadowMatrix1:
            this.chunkRenderer.shaderLightingUniforms.shadowMatrix1,
          uShadowMatrix2:
            this.chunkRenderer.shaderLightingUniforms.shadowMatrix2,
          uCascadeSplit0:
            this.chunkRenderer.shaderLightingUniforms.cascadeSplit0,
          uCascadeSplit1:
            this.chunkRenderer.shaderLightingUniforms.cascadeSplit1,
          uCascadeSplit2:
            this.chunkRenderer.shaderLightingUniforms.cascadeSplit2,
          uShadowBias: this.chunkRenderer.shaderLightingUniforms.shadowBias,
          uShadowStrength:
            this.chunkRenderer.shaderLightingUniforms.shadowStrength,
          uLightVolume: this.chunkRenderer.shaderLightingUniforms.lightVolume,
          uLightVolumeMin:
            this.chunkRenderer.shaderLightingUniforms.lightVolumeMin,
          uLightVolumeSize:
            this.chunkRenderer.shaderLightingUniforms.lightVolumeSize,
          uWaterTint: this.chunkRenderer.shaderLightingUniforms.waterTint,
          uWaterAbsorption:
            this.chunkRenderer.shaderLightingUniforms.waterAbsorption,
          uWaterLevel: this.chunkRenderer.shaderLightingUniforms.waterLevel,
          uSkyTopColor: this.chunkRenderer.shaderLightingUniforms.skyTopColor,
          uSkyMiddleColor:
            this.chunkRenderer.shaderLightingUniforms.skyMiddleColor,
          uShadowDebugMode:
            this.chunkRenderer.shaderLightingUniforms.shadowDebugMode,
        }
      : {};

    const material = new ShaderMaterial({
      vertexColors: true,
      fragmentShader: actualFragmentShader,
      vertexShader: actualVertexShader,
      uniforms: {
        ...UniformsUtils.clone(ShaderLib.basic.uniforms),
        uLightIntensityAdjustment: chunksUniforms.lightIntensityAdjustment,
        uSunlightIntensity: chunksUniforms.sunlightIntensity,
        uAOTable: chunksUniforms.ao,
        uMinLightLevel: chunksUniforms.minLightLevel,
        uBaseAmbient: chunksUniforms.baseAmbient,
        uFogNear: chunksUniforms.fogNear,
        uFogFar: chunksUniforms.fogFar,
        uFogColor: chunksUniforms.fogColor,
        uFogHeightOrigin: chunksUniforms.fogHeightOrigin,
        uFogHeightDensity: chunksUniforms.fogHeightDensity,
        uWindDirection: chunksUniforms.windDirection,
        uWindSpeed: chunksUniforms.windSpeed,
        uTime: chunksUniforms.time,
        uAtlasSize: chunksUniforms.atlasSize,
        uShowGreedyDebug: chunksUniforms.showGreedyDebug,
        ...shaderLightingUniforms,
        ...uniforms,
      },
    }) as CustomChunkShaderMaterial;

    Object.defineProperty(material, "renderStage", {
      get: function () {
        return material.uniforms.renderStage.value;
      },

      set: function (stage) {
        material.uniforms.renderStage.value = parseFloat(stage);
      },
    });

    material.map = AtlasTexture.makeUnknownTexture(
      this.options.textureUnitDimension
    );
    material.uniforms.map = { value: material.map };

    return material;
  };

  private async loadMaterials() {
    const { textureUnitDimension } = this.options;

    const perSide = (total: number) => {
      let countPerSide = 1;
      const sqrt = Math.ceil(Math.sqrt(total));
      while (countPerSide < sqrt) {
        countPerSide *= 2;
      }

      return countPerSide;
    };

    const make = (
      transparent: boolean,
      map: Texture,
      isFluid: boolean,
      lightReduce: boolean,
      transparentStandalone: boolean
    ) => {
      const mat = this.makeShaderMaterial();

      mat.side = transparent ? DoubleSide : FrontSide;
      mat.transparent = transparent;
      if (transparent) {
        mat.depthWrite = !isFluid && transparentStandalone;
        mat.alphaTest = 0.1;
        mat.uniforms.alphaTest.value = 0.1;
      }
      mat.map = map;
      mat.uniforms.map.value = map;
      mat.userData.skipShadow = isFluid || (transparent && !lightReduce);

      return mat;
    };

    const blocksById = this.registry.blocksById;

    const textureGroups = new Set<string>();
    let ungroupedFaces = 0;
    let blocksByIdValues = blocksById.values();
    let blockValue = blocksByIdValues.next();
    while (!blockValue.done) {
      const block = blockValue.value;
      const blockFaces = block.faces;
      for (let faceIndex = 0; faceIndex < blockFaces.length; faceIndex++) {
        const face = blockFaces[faceIndex];
        if (face.independent || face.isolated) continue;
        if (face.textureGroup) {
          textureGroups.add(face.textureGroup);
        } else {
          ungroupedFaces++;
        }
      }
      blockValue = blocksByIdValues.next();
    }
    const totalSlots = textureGroups.size + ungroupedFaces;
    const countPerSide = perSide(totalSlots);
    const atlas = new AtlasTexture(countPerSide, textureUnitDimension);

    this.chunkRenderer.uniforms.atlasSize.value = countPerSide;
    this.chunkMaterialBaseKeyById.clear();
    this.chunkMaterialIndependentKeyById.clear();

    blocksByIdValues = blocksById.values();
    blockValue = blocksByIdValues.next();
    while (!blockValue.done) {
      const block = blockValue.value;
      const mat = make(
        block.isSeeThrough,
        atlas,
        block.isFluid,
        block.lightReduce,
        block.transparentStandalone
      );
      const key = this.makeChunkMaterialKey(block.id);
      this.chunkRenderer.materials.set(key, mat);
      this.chunkMaterialBaseKeyById.set(block.id, key);

      const blockFaces = block.faces;
      let independentMaterialKeys: Map<string, string> | undefined;
      for (let faceIndex = 0; faceIndex < blockFaces.length; faceIndex++) {
        const face = blockFaces[faceIndex];
        if (!face.independent || face.isolated) continue;

        const independentMat = make(
          block.isSeeThrough,
          AtlasTexture.makeUnknownTexture(textureUnitDimension),
          block.isFluid,
          block.lightReduce,
          block.transparentStandalone
        );
        const independentKey = this.makeChunkMaterialKey(block.id, face.name);
        this.chunkRenderer.materials.set(independentKey, independentMat);
        if (!independentMaterialKeys) {
          independentMaterialKeys = new Map<string, string>();
          this.chunkMaterialIndependentKeyById.set(
            block.id,
            independentMaterialKeys
          );
        }
        independentMaterialKeys.set(face.name, independentKey);
      }
      blockValue = blocksByIdValues.next();
    }
  }

  private makeChunkMaterialKey(id: number, faceName?: string, voxel?: Coords3) {
    if (voxel) {
      return `${id}-${faceName}-${voxel[0]}-${voxel[1]}-${voxel[2]}`;
    }
    if (faceName) {
      return `${id}-${faceName}`;
    }
    return `${id}`;
  }

  private findBlockFaceByName(block: Block, faceName: string) {
    const cachedFaces = this.blockFaceNameCache.get(block.id);
    if (cachedFaces) {
      return cachedFaces.get(faceName) ?? null;
    }

    const faces = block.faces;
    for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
      const face = faces[faceIndex];
      if (face.name === faceName) {
        return face;
      }
    }
    return null;
  }

  private resolveBlockByEntityType(type: string): Block | null {
    const cachedBlock = this.blockEntityTypeBlockCache.get(type);
    if (cachedBlock !== undefined) {
      return cachedBlock;
    }

    const blockNamePrefixIndex = type.indexOf("::");
    if (blockNamePrefixIndex < 0) {
      this.blockEntityTypeBlockCache.set(type, null);
      return null;
    }

    const blockNameStart = blockNamePrefixIndex + 2;
    const blockNameEnd = type.indexOf("::", blockNameStart);
    const blockName =
      blockNameEnd >= 0
        ? type.slice(blockNameStart, blockNameEnd)
        : type.slice(blockNameStart);
    const block =
      this.registry.blocksByName.get(this.normalizeBlockNameLookup(blockName)) ??
      null;
    this.blockEntityTypeBlockCache.set(type, block);
    return block;
  }

  private getTextureGroupFirstFace(groupName: string) {
    const cachedFirstFace = this.textureGroupFirstFaceCache.get(groupName);
    if (cachedFirstFace !== undefined) {
      return cachedFirstFace;
    }

    let result: { blockId: number; face: Block["faces"][number] } | null = null;
    let blockEntries = this.registry.blocksById.entries();
    let blockEntry = blockEntries.next();
    while (!blockEntry.done) {
      const [id, block] = blockEntry.value;
      const blockFaces = block.faces;
      for (let faceIndex = 0; faceIndex < blockFaces.length; faceIndex++) {
        const face = blockFaces[faceIndex];
        if (face.isolated) {
          continue;
        }
        if (face.textureGroup === groupName) {
          result = { blockId: id, face };
          break;
        }
      }
      if (result) {
        break;
      }
      blockEntry = blockEntries.next();
    }

    this.textureGroupFirstFaceCache.set(groupName, result);
    return result;
  }

  private markTrackedChunkLevels(
    chunkX: number,
    chunkZ: number,
    level: number,
    touchesLowerBoundary: boolean,
    touchesUpperBoundary: boolean
  ) {
    if (touchesLowerBoundary) {
      this.meshPipeline.onVoxelChange(chunkX, chunkZ, level - 1);
    } else if (touchesUpperBoundary) {
      this.meshPipeline.onVoxelChange(chunkX, chunkZ, level + 1);
    }
    this.meshPipeline.onVoxelChange(chunkX, chunkZ, level);
  }

  private trackChunkAt(vx: number, vy: number, vz: number) {
    if (!this.isTrackingChunks) return;
    const { chunkSize, maxHeight, subChunks } = this.options;

    const ivx = Math.floor(vx);
    const ivy = Math.floor(vy);
    const ivz = Math.floor(vz);
    const cx = Math.floor(ivx / chunkSize);
    const cz = Math.floor(ivz / chunkSize);
    const lcx = ivx - cx * chunkSize;
    const lcz = ivz - cz * chunkSize;

    const subChunkHeight = maxHeight / subChunks;
    const level = Math.floor(ivy / subChunkHeight);

    const touchesLowerBoundary = ivy % subChunkHeight === 0 && level > 0;
    const touchesUpperBoundary =
      ivy % subChunkHeight === subChunkHeight - 1 && level < subChunks - 1;

    this.markTrackedChunkLevels(
      cx,
      cz,
      level,
      touchesLowerBoundary,
      touchesUpperBoundary
    );

    if (lcx === 0)
      this.markTrackedChunkLevels(
        cx - 1,
        cz,
        level,
        touchesLowerBoundary,
        touchesUpperBoundary
      );
    if (lcz === 0)
      this.markTrackedChunkLevels(
        cx,
        cz - 1,
        level,
        touchesLowerBoundary,
        touchesUpperBoundary
      );
    if (lcx === 0 && lcz === 0)
      this.markTrackedChunkLevels(
        cx - 1,
        cz - 1,
        level,
        touchesLowerBoundary,
        touchesUpperBoundary
      );
    if (lcx === chunkSize - 1)
      this.markTrackedChunkLevels(
        cx + 1,
        cz,
        level,
        touchesLowerBoundary,
        touchesUpperBoundary
      );
    if (lcz === chunkSize - 1)
      this.markTrackedChunkLevels(
        cx,
        cz + 1,
        level,
        touchesLowerBoundary,
        touchesUpperBoundary
      );
    if (lcx === chunkSize - 1 && lcz === chunkSize - 1) {
      this.markTrackedChunkLevels(
        cx + 1,
        cz + 1,
        level,
        touchesLowerBoundary,
        touchesUpperBoundary
      );
    }
  }

  private recordVoxelDelta(
    px: number,
    py: number,
    pz: number,
    deltaData: Partial<Omit<VoxelDelta, "coords" | "timestamp" | "sequenceId">>,
    chunkName?: string
  ) {
    const vx = Math.floor(px);
    const vy = Math.floor(py);
    const vz = Math.floor(pz);
    const voxelChunkName =
      chunkName ??
      ChunkUtils.getChunkNameByVoxel(vx, vz, this.options.chunkSize);

    const delta: VoxelDelta = {
      coords: [vx, vy, vz],
      oldVoxel: deltaData.oldVoxel ?? 0,
      newVoxel: deltaData.newVoxel ?? 0,
      oldRotation: deltaData.oldRotation,
      newRotation: deltaData.newRotation,
      oldStage: deltaData.oldStage,
      newStage: deltaData.newStage,
      timestamp: performance.now(),
      sequenceId: this.deltaSequenceCounter++,
    };

    const deltas = this.voxelDeltas.get(voxelChunkName);
    if (deltas) {
      deltas.push(delta);
    } else {
      this.voxelDeltas.set(voxelChunkName, [delta]);
    }
  }

  private markChunkForRemesh(coords: Coords2) {
    this.markChunkForRemeshAt(coords[0], coords[1]);
  }

  private markChunkForRemeshAt(cx: number, cz: number) {
    const { subChunks } = this.options;
    this.markChunkForRemeshLevelsAt(cx, cz, 0, subChunks - 1);
  }

  private markChunkForRemeshLevels(
    coords: Coords2,
    minLevel: number,
    maxLevel: number
  ) {
    this.markChunkForRemeshLevelsAt(
      coords[0],
      coords[1],
      minLevel,
      maxLevel
    );
  }

  private markChunkForRemeshLevelsAt(
    cx: number,
    cz: number,
    minLevel: number,
    maxLevel: number
  ) {
    for (let level = minLevel; level <= maxLevel; level++) {
      this.meshPipeline.onVoxelChange(cx, cz, level);
    }
  }

  private markChunkAndNeighborsForMeshing(cx: number, cz: number) {
    const { subChunks, minChunk, maxChunk } = this.options;
    const minChunkX = minChunk[0];
    const minChunkZ = minChunk[1];
    const maxChunkX = maxChunk[0];
    const maxChunkZ = maxChunk[1];

    for (let outerIndex = 0; outerIndex < CHUNK_NEIGHBOR_OFFSETS.length; outerIndex++) {
      const offset = CHUNK_NEIGHBOR_OFFSETS[outerIndex];
      const nx = cx + offset[0];
      const nz = cz + offset[1];

      if (nx < minChunkX || nz < minChunkZ || nx > maxChunkX || nz > maxChunkZ) {
        continue;
      }

      const neighborChunk = this.getLoadedChunkByCoords(nx, nz);

      if (!neighborChunk || !neighborChunk.isReady) {
        continue;
      }

      let allNeighborsReady = true;
      for (let innerIndex = 0; innerIndex < CHUNK_NEIGHBOR_OFFSETS.length; innerIndex++) {
        const neighborOffset = CHUNK_NEIGHBOR_OFFSETS[innerIndex];
        const nnx = nx + neighborOffset[0];
        const nnz = nz + neighborOffset[1];
        if (
          nnx < minChunkX ||
          nnz < minChunkZ ||
          nnx > maxChunkX ||
          nnz > maxChunkZ
        ) {
          continue;
        }

        const nn = this.getLoadedChunkByCoords(nnx, nnz);
        if (!nn || !nn.isReady) {
          allNeighborsReady = false;
          break;
        }
      }

      if (allNeighborsReady) {
        for (let level = 0; level < subChunks; level++) {
          this.meshPipeline.onVoxelChange(nx, nz, level);
        }
      }
    }

    this.scheduleDirtyChunkProcessing();
  }

  /**
   * A sanity check to make sure that an action is not being performed after
   * the world has been isInitialized.
   */
  private checkIsInitialized(action: string, beforeInit = true) {
    if (beforeInit ? this.isInitialized : !this.isInitialized) {
      throw new Error(
        `Cannot ${action} ${beforeInit ? "after" : "before"} the world ${
          beforeInit ? "has been" : "is"
        } isInitialized. ${
          beforeInit
            ? "This has to be called before `world.init`."
            : "Remember to call the asynchronous function `world.init` beforehand."
        }`
      );
    }
  }
}
