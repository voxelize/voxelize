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
  Texture,
  MathUtils as ThreeMathUtils,
  Uniform,
  UniformsUtils,
  Vector2,
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
  TransparentMeshData,
  prepareTransparentMesh,
  sortTransparentMesh,
} from "../../core/transparent-sorter";
import { WorkerPool } from "../../libs";
import { setWorkerInterval } from "../../libs/setWorkerInterval";
import { Coords2, Coords3 } from "../../types";
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
import { LightSourceRegistry } from "./light-registry";
import { LightVolume } from "./light-volume";
import { Loader } from "./loader";
import { ChunkPipeline, MeshPipeline } from "./pipelines";
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
export * from "./light-registry";
export * from "./light-volume";
export * from "./loader";
export * from "./pipelines";
export * from "./registry";
export * from "./shaders";
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
  jobs: LightJob[];
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
  voxel: Coords3;
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
};

const defaultOptions: WorldClientOptions = {
  maxChunkRequestsPerUpdate: 16,
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
export class World<T = any> extends Scene implements NetIntercept {
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
   * The internal clock.
   */
  private clock = new Clock();

  /**
   * A map of initialize listeners on chunks.
   */
  private chunkInitializeListeners = new Map<
    string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ((chunk: Chunk) => void)[]
  >();

  private blockEntitiesMap: Map<
    string,
    {
      id: string;
      data: T | null;
    }
  > = new Map();
  // TODO: fix a bug where if the chunk is not loaded, the block entity will not be updated and will just go stray
  private blockEntityUpdateListeners = new Set<BlockEntityUpdateListener<T>>();

  private blockUpdateListeners = new Set<BlockUpdateListener>();

  /**
   * The JSON data received from the world. Call `initialize` to initialize.
   */
  private initialData: any = null;
  private initialEntities: any = null;

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

  private meshWorkerPool = new WorkerPool(MeshWorker, {
    maxWorker: navigator.hardwareConcurrency ?? 4,
    name: "mesh-worker",
  });

  private lightWorkerPool!: WorkerPool;

  private textureLoaderLastMap: Record<string, Date> = {};

  private isTrackingChunks = false;

  private blockUpdatesQueue: BlockUpdateWithSource[] = [];
  private blockUpdatesToEmit: BlockUpdate[] = [];

  private voxelDeltas = new Map<string, VoxelDelta[]>();
  private deltaSequenceCounter = 0;
  private cleanupDeltasInterval: number | null = null;

  private lightJobQueue: LightJob[] = [];
  private lightJobIdCounter = 0;
  private lightBatchIdCounter = 0;

  private static readonly warmColor = new Color(1.0, 0.95, 0.9);
  private static readonly coolColor = new Color(0.9, 0.95, 1.0);
  private static readonly nightColor = new Color(0.15, 0.18, 0.25);
  private static readonly dayAmbient = new Color(0.4, 0.42, 0.45);
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

    // @ts-ignore
    const { statsSyncInterval } = (this.options = {
      ...defaultOptions,
      ...options,
    });

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
      const now = performance.now();
      const cutoff = now - this.options.deltaRetentionTime;

      this.voxelDeltas.forEach((deltas, chunkName) => {
        const filtered = deltas.filter((d) => d.timestamp > cutoff);

        if (filtered.length === 0) {
          this.voxelDeltas.delete(chunkName);
        } else if (filtered.length < deltas.length) {
          this.voxelDeltas.set(chunkName, filtered);
        }
      });
    }, 1000) as unknown as number;
  }

  async meshChunkLocally(
    cx: number,
    cz: number,
    level: number,
    generation?: number
  ) {
    if (
      !this.options.shaderBasedLighting &&
      (this.lightJobQueue.length > 0 || this.activeLightBatch !== null)
    ) {
      await this.waitForLightJobsComplete();
    }

    const neighbors = [
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

    const chunks = neighbors.map(([dx, dz]) =>
      this.getChunkByCoords(cx + dx, cz + dz)
    );

    const centerChunk = chunks[4];
    if (!centerChunk) {
      return;
    }

    const { min, max } = centerChunk;
    const heightPerSubChunk = Math.floor(
      this.options.maxHeight / this.options.subChunks
    );
    const subChunkMin = [min[0], heightPerSubChunk * level, min[2]];
    const subChunkMax = [max[0], heightPerSubChunk * (level + 1), max[2]];

    const chunksData: unknown[] = [];
    const arrayBuffers: ArrayBuffer[] = [];

    for (const chunk of chunks) {
      if (!chunk || !chunk.isReady) {
        chunksData.push(null);
        continue;
      }

      const [chunkData, chunkArrayBuffers] = chunk.serialize();

      chunksData.push(chunkData);
      arrayBuffers.push(...chunkArrayBuffers);
    }

    const data = {
      chunksData,
      options: this.options,
      min: subChunkMin,
      max: subChunkMax,
    };

    const name = ChunkUtils.getChunkName([cx, cz]);
    if (this.chunkPipeline.isInStage(name, "processing")) {
      return;
    }

    const { geometries } = await new Promise<{
      geometries: GeometryProtocol[];
    }>((resolve) => {
      this.meshWorkerPool.addJob({
        message: data,
        buffers: arrayBuffers,
        resolve,
      });
    });

    if (this.chunkPipeline.isInStage(name, "processing")) {
      return;
    }

    const key = MeshPipeline.makeKey(cx, cz, level);
    const accepted =
      generation === undefined ||
      this.meshPipeline.onJobComplete(key, generation);
    if (generation !== undefined && !accepted) {
      return;
    }

    const mesh: MeshProtocol = {
      level,
      geometries,
    };

    this.buildChunkMesh(cx, cz, mesh);

    const chunk = this.getChunkByCoords(cx, cz);
    if (chunk) {
      const meshes = chunk.meshes.get(level) || [];
      this.emitChunkEvent("chunk-mesh-updated", {
        chunk,
        coords: [cx, cz],
        level,
        meshes,
        reason: "voxel",
      });

      this.emitChunkEvent("chunk-updated", {
        chunk,
        coords: [cx, cz],
        allMeshes: chunk.meshes,
        reason: "voxel",
      });
    }
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
    blockFaces.forEach((face) => {
      const id = `${face.name}::${block.id}`;
      this.textureLoaderLastMap[id] = now;
    });

    // If it is a string, load the image.
    if (typeof source === "string") {
      this.loader.loadImage(source).then((data) => {
        const filteredFaces = blockFaces.filter((face) => {
          const id = `${face.name}::${block.id}`;
          return this.textureLoaderLastMap[id] === now;
        });
        this.applyBlockTexture(
          idOrName,
          filteredFaces.map((f) => f.name),
          data
        );
      });
      return;
    }

    const data = source;

    blockFaces.forEach((face) => {
      if (face.isolated) {
        // console.warn(
        //   `Attempting to apply texture onto an isolated face: ${block.name}, ${face.name}. Use 'applyBlockTextureAt' instead.`
        // );
        return;
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

        return;
      }

      // Otherwise, we need to draw the image onto the texture atlas.
      const atlas = mat.map as AtlasTexture;
      atlas.drawImageToRange(face.range, data);

      // Update the texture with the new image
      mat.map.needsUpdate = true;
    });
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
    return Promise.all(
      data.map(({ idOrName, faceNames, source }) =>
        this.applyBlockTexture(idOrName, faceNames, source)
      )
    );
  }

  async applyTextureGroup(
    groupName: string,
    source: string | Color | HTMLImageElement | Texture
  ) {
    this.checkIsInitialized("apply texture group", false);

    const facesInGroup: { blockId: number; face: Block["faces"][0] }[] = [];

    for (const [id, block] of this.registry.blocksById) {
      for (const face of block.faces) {
        if (face.isolated) continue;
        if (face.textureGroup === groupName) {
          facesInGroup.push({ blockId: id, face });
        }
      }
    }

    if (facesInGroup.length === 0) {
      console.warn(`No faces found with texture group "${groupName}"`);
      return;
    }

    if (typeof source === "string") {
      const data = await this.loader.loadImage(source);
      return this.applyTextureGroup(groupName, data);
    }

    const firstEntry = facesInGroup[0];
    const mat = this.getBlockFaceMaterial(
      firstEntry.blockId,
      firstEntry.face.name
    );

    if (!mat) {
      console.warn(
        `No material found for texture group "${groupName}" (block ${firstEntry.blockId}, face ${firstEntry.face.name})`
      );
      return;
    }

    const atlas = mat.map as AtlasTexture;
    atlas.drawImageToRange(firstEntry.face.range, source);
    mat.map.needsUpdate = true;
  }

  async applyTextureGroups(
    data: {
      groupName: string;
      source: string | Color | HTMLImageElement | Texture;
    }[]
  ) {
    return Promise.all(
      data.map(({ groupName, source }) =>
        this.applyTextureGroup(groupName, source)
      )
    );
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

    const realKeyframes = [];

    // Convert string sources to images.
    for (const [duration, source] of keyframes) {
      if (typeof source === "string") {
        realKeyframes.push([duration, await this.loader.loadImage(source)]);
        continue;
      }

      realKeyframes.push([duration, source]);
    }

    const blockFaces = this.getBlockFacesByFaceNames(block.id, faceNames);
    if (!blockFaces) {
      throw new Error(
        `Face(s) "${faceNames}" does not exist on block "${block.name}"`
      );
    }

    blockFaces.forEach((face) => {
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
    });
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

    const keyframes = images.map(
      (image) => [interval, image] as [number, HTMLImageElement]
    );

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

    for (const face of blockFaces) {
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

    const allAvailableFaceNames = allFaces.map((f) => f.name);
    const uniqueFaceNames = [...new Set(allAvailableFaceNames)];

    const faceNameArray = Array.isArray(faceNames) ? faceNames : [faceNames];

    if (warnUnknown) {
      for (const fn of faceNameArray) {
        if (fn instanceof RegExp) continue;
        const regex = new RegExp(fn);
        const hasMatch = uniqueFaceNames.some((name) => regex.test(name));
        if (!hasMatch) {
          const suggestions = findSimilar(fn, uniqueFaceNames);
          const suggestionText = formatSuggestion(suggestions, uniqueFaceNames);
          console.warn(
            `[Voxelize] Face "${fn}" not found on block "${block.name}".${suggestionText}`
          );
        }
      }
    }

    return allFaces.filter((face) => {
      if (typeof faceNames === "string" || faceNames instanceof RegExp) {
        return new RegExp(faceNames).test(face.name);
      } else if (Array.isArray(faceNames)) {
        return faceNames.some((fn) => new RegExp(fn).test(face.name));
      }
      return false;
    });
  }

  private getAllBlockFaces(block: Block): Block["faces"] {
    const result = [...block.faces];
    const existingNames = new Set(block.faces.map((f) => f.name));

    if (block.dynamicPatterns) {
      for (const pattern of block.dynamicPatterns) {
        for (const part of pattern.parts) {
          for (const face of part.faces) {
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
    const name = ChunkUtils.getChunkName([cx, cz]);
    return this.getChunkByName(name);
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
    const coords = ChunkUtils.mapVoxelToChunk(
      [px | 0, py | 0, pz | 0],
      this.options.chunkSize
    );
    return this.getChunkByCoords(...coords);
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
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return 0;
    return chunk.getVoxel(px, py, pz);
  }

  setVoxelAt(px: number, py: number, pz: number, voxel: number) {
    this.checkIsInitialized("set voxel", false);
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return;

    const oldVoxel = chunk.getVoxel(px, py, pz);
    chunk.setVoxel(px, py, pz, voxel);

    if (oldVoxel !== voxel) {
      this.recordVoxelDelta(px, py, pz, { oldVoxel, newVoxel: voxel });
    }

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
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return new BlockRotation();
    return chunk.getVoxelRotation(px, py, pz);
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
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return;

    const oldRotation = chunk.getVoxelRotation(px, py, pz);
    chunk.setVoxelRotation(px, py, pz, rotation);

    if (
      oldRotation.value !== rotation.value ||
      oldRotation.yRotation !== rotation.yRotation
    ) {
      this.recordVoxelDelta(px, py, pz, { oldRotation, newRotation: rotation });
    }

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
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return 0;
    return chunk.getVoxelStage(px, py, pz);
  }

  setVoxelStageAt(px: number, py: number, pz: number, stage: number) {
    this.checkIsInitialized("set voxel stage", false);
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return;

    const oldStage = chunk.getVoxelStage(px, py, pz);
    chunk.setVoxelStage(px, py, pz, stage);

    if (oldStage !== stage) {
      this.recordVoxelDelta(px, py, pz, { oldStage, newStage: stage });
    }

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
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return 0;
    return chunk.getSunlight(px, py, pz);
  }

  setSunlightAt(px: number, py: number, pz: number, level: number) {
    this.checkIsInitialized("set sunlight", false);
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return;
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
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return 0;
    return chunk.getTorchLight(px, py, pz, color);
  }

  setTorchLightAt(
    px: number,
    py: number,
    pz: number,
    level: number,
    color: LightColor
  ) {
    this.checkIsInitialized("set torch light", false);
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return;
    chunk.setTorchLight(px, py, pz, level, color);
    this.trackChunkAt(px, py, pz);
  }

  getLightValuesAt(vx: number, vy: number, vz: number) {
    this.checkIsInitialized("get light values", false);
    const chunk = this.getChunkByPosition(vx, vy, vz);
    if (chunk === undefined) return null;
    return {
      sunlight: chunk.getSunlight(vx, vy, vz),
      red: chunk.getTorchLight(vx, vy, vz, "RED"),
      green: chunk.getTorchLight(vx, vy, vz, "GREEN"),
      blue: chunk.getTorchLight(vx, vy, vz, "BLUE"),
    };
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
    const lightValues = this.getLightValuesAt(vx, vy, vz);
    if (!lightValues) return new Color(1, 1, 1);

    const { sunlight, red, green, blue } = lightValues;
    const { sunlightIntensity, minLightLevel, baseAmbient } =
      this.chunkRenderer.uniforms;

    const sunlightNorm = sunlight / this.options.maxLightLevel;
    const sunlightFactor = sunlightNorm ** 2 * sunlightIntensity.value;
    const s = Math.min(
      sunlightFactor + minLightLevel.value * sunlightNorm + baseAmbient.value,
      1
    );

    const torchR = Math.pow(red / this.options.maxLightLevel, 2);
    const torchG = Math.pow(green / this.options.maxLightLevel, 2);
    const torchB = Math.pow(blue / this.options.maxLightLevel, 2);
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
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return null;
    const id = chunk.getVoxel(px, py, pz);
    return this.getBlockById(id);
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

    const vx = px | 0;
    const vz = pz | 0;

    for (let vy = this.options.maxHeight - 1; vy >= 0; vy--) {
      const block = this.getBlockAt(vx, vy, vz);

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
    const name = ChunkUtils.getVoxelName([px | 0, py | 0, pz | 0]);
    const arr = this.oldBlocks.get(name) || [];
    return arr[arr.length - count] || 0;
  }

  getBlockOf(idOrName: number | string) {
    if (typeof idOrName === "number") {
      return this.getBlockById(idOrName);
    }

    return this.getBlockByName(idOrName.toLowerCase());
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
    const block = this.registry.blocksByName.get(name.toLowerCase());

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
    const voxelName = ChunkUtils.getVoxelName([vx, vy, vz]);

    return this.blockEntitiesMap.get(voxelName)?.data || null;
  }

  setBlockEntityDataAt(px: number, py: number, pz: number, data: T) {
    this.checkIsInitialized("set block entity data", false);

    const vx = Math.floor(px);
    const vy = Math.floor(py);
    const vz = Math.floor(pz);
    const voxelName = ChunkUtils.getVoxelName([vx, vy, vz]);

    const old = this.blockEntitiesMap.get(voxelName);
    if (!old) {
      console.log("No entity found at:", px, py, pz);
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
    const name = ChunkUtils.getChunkName([cx, cz]);
    const stage = this.chunkPipeline.getStage(name);

    if (stage === "loaded") return "loaded";
    if (stage === "processing") return "processing";
    if (stage === "requested") return "requested";

    return null;
  }

  getBlockFaceMaterial(
    idOrName: number | string,
    faceName?: string,
    voxel?: Coords3
  ) {
    this.checkIsInitialized("get material", false);

    const block = this.getBlockOf(idOrName);

    if (voxel && faceName && block.isolatedFaces.has(faceName)) {
      return this.chunkRenderer.materials.get(
        this.makeChunkMaterialKey(block.id, faceName, voxel)
      );
    }

    if (faceName && block.independentFaces.has(faceName)) {
      return this.chunkRenderer.materials.get(
        this.makeChunkMaterialKey(block.id, faceName)
      );
    }

    return this.chunkRenderer.materials.get(
      this.makeChunkMaterialKey(block.id)
    );
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

    for (const [id, block] of this.registry.blocksById) {
      for (const face of block.faces) {
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
    }

    return { sharedAtlas, textures };
  }

  addChunkInitListener = (
    coords: Coords2,
    listener: (chunk: Chunk) => void
  ) => {
    const name = ChunkUtils.getChunkName(coords);

    // if (this.chunks.loaded.has(name)) {
    //   listener(this.chunks.loaded.get(name));
    //   return;
    // }

    const listeners = this.chunkInitializeListeners.get(name) || [];
    listeners.push(listener);
    this.chunkInitializeListeners.set(name, listeners);

    return () => {
      this.chunkInitializeListeners.delete(name);
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
    this.chunkEvents.on(event, listener as any);
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
    this.chunkEvents.off(event, listener as any);
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
    this.chunkEvents.once(event, listener as any);
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
    const [cx, cz] = center;
    const [tx, tz] = target;
    const dx = cx - tx;
    const dz = cz - tz;

    if (dx * dx + dz * dz < (this.renderRadius >> 1) ** 2) {
      return true;
    }

    const dot = (tz - cz) * direction.z + (tx - cx) * direction.x;
    const det = (tz - cz) * direction.x - (tx - cx) * direction.z;
    const angle = Math.atan2(det, dot);

    return Math.abs(angle) < threshold;
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

    const { ignoreFluids, ignorePassables, ignoreSeeThrough } = {
      ignoreFluids: true,
      ignorePassables: false,
      ignoreSeeThrough: false,
      ...options,
    };

    const ignoreList = new Set(options.ignoreList || []);

    return raycast(
      (wx, wy, wz) => {
        const block = this.getBlockAt(wx, wy, wz);

        if (!block) {
          return [];
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

        if (ignoreList.has(id)) {
          return [];
        }

        if (isDynamic && !dynamicFn) {
          console.warn(
            `Block of ID ${id} is dynamic but has no dynamic function.`
          );
        }

        if (
          (isFluid && ignoreFluids && !isWaterlogged) ||
          (isPassable && ignorePassables) ||
          (isSeeThrough && ignoreSeeThrough)
        ) {
          return [];
        }

        const rotation = this.getVoxelRotationAt(wx, wy, wz);
        const vx = Math.floor(wx);
        const vy = Math.floor(wy);
        const vz = Math.floor(wz);

        if (dynamicPatterns && dynamicPatterns.length > 0) {
          const aabbsWithFlags = this.getBlockAABBsForDynamicPatterns(
            wx,
            wy,
            wz,
            dynamicPatterns
          );
          return aabbsWithFlags.map(({ aabb, worldSpace }) =>
            worldSpace
              ? aabb.translate([vx, vy, vz])
              : rotation.rotateAABB(aabb).translate([vx, vy, vz])
          );
        }

        return (
          isDynamic
            ? dynamicFn
              ? dynamicFn([wx | 0, wy | 0, wz | 0]).aabbs
              : aabbs
            : aabbs
        ).map((aabb) => rotation.rotateAABB(aabb).translate([vx, vy, vz]));
      },
      origin,
      direction,
      maxDistance
    );
  };

  getBlockAABBsByIdAt = (id: number, vx: number, vy: number, vz: number) => {
    const block = this.getBlockById(id);

    if (!block) {
      return [];
    }
    if (block.dynamicPatterns && block.dynamicPatterns.length > 0) {
      return this.getBlockAABBsForDynamicPatterns(
        vx,
        vy,
        vz,
        block.dynamicPatterns
      ).map(({ aabb }) => aabb);
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
    for (const dynamicPattern of dynamicPatterns) {
      const aabbsWithFlags: { aabb: AABB; worldSpace: boolean }[] = [];

      for (const part of dynamicPattern.parts) {
        const patternsMatched = BlockUtils.evaluateBlockRule(
          part.rule,
          [vx, vy, vz],
          {
            getVoxelAt: (vx: number, vy: number, vz: number) =>
              this.getVoxelAt(vx, vy, vz),
            getVoxelRotationAt: (vx: number, vy: number, vz: number) =>
              this.getVoxelRotationAt(vx, vy, vz),
            getVoxelStageAt: (vx: number, vy: number, vz: number) =>
              this.getVoxelStageAt(vx, vy, vz),
          }
        );

        if (patternsMatched) {
          const worldSpace =
            (part as { worldSpace?: boolean }).worldSpace ?? false;
          for (const aabb of part.aabbs) {
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
    for (const dynamicPattern of dynamicPatterns) {
      for (const part of dynamicPattern.parts) {
        const patternsMatched = BlockUtils.evaluateBlockRule(
          part.rule,
          [vx, vy, vz],
          {
            getVoxelAt: (vx: number, vy: number, vz: number) =>
              this.getVoxelAt(vx, vy, vz),
            getVoxelRotationAt: (vx: number, vy: number, vz: number) =>
              this.getVoxelRotationAt(vx, vy, vz),
            getVoxelStageAt: (vx: number, vy: number, vz: number) =>
              this.getVoxelStageAt(vx, vy, vz),
          }
        );

        if (patternsMatched && part.isPassable !== undefined) {
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
    const vx = 0,
      vy = 0,
      vz = 0;

    const simulatedGetVoxelAt = () => blockId;

    const simulatedGetVoxelRotationAt = () => new BlockRotation();
    const simulatedGetVoxelStageAt = () => 0;

    for (const dynamicPattern of dynamicPatterns) {
      const faces: Block["faces"] = [];
      let patternsMatched = false;

      for (const part of dynamicPattern.parts) {
        const partMatched = BlockUtils.evaluateBlockRule(
          part.rule,
          [vx, vy, vz],
          {
            getVoxelAt: simulatedGetVoxelAt,
            getVoxelRotationAt: simulatedGetVoxelRotationAt,
            getVoxelStageAt: simulatedGetVoxelStageAt,
          }
        );

        if (partMatched) {
          patternsMatched = true;
          faces.push(...part.faces);
        }
      }

      if (patternsMatched && faces.length > 0) {
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

    const voxelUpdates = updates
      .filter((update) => {
        if (update.vy < 0 || update.vy >= this.options.maxHeight) {
          return false;
        }

        const { vx, vy, vz, type, rotation, yRotation, stage } = update;

        const currId = this.getVoxelAt(vx, vy, vz);
        const currRot = this.getVoxelRotationAt(vx, vy, vz);
        const currStage = this.getVoxelStageAt(vx, vy, vz);

        if (!this.getBlockById(type)) {
          console.warn(`Block ID ${type} does not exist.`);
          return false;
        }

        if (
          currId === type &&
          (rotation !== undefined ? currRot.value === rotation : false) &&
          (yRotation !== undefined ? currRot.yRotation === yRotation : false) &&
          (stage !== undefined ? currStage === stage : false)
        ) {
          return false;
        }

        return true;
      })
      .map((update) => {
        if (isNaN(update.rotation)) {
          update.rotation = 0;
        }

        if (!this.getBlockById(update.type).yRotatable) {
          update.yRotation = 0;
        }

        return update;
      });

    this.blockUpdatesQueue.push(
      ...voxelUpdates.map((update) => ({ source, update }))
    );

    this.processClientUpdates();
  };

  private applyServerUpdatesImmediately(updates: UpdateProtocol[]) {
    const blockUpdates: BlockUpdateWithSource[] = [];

    for (const update of updates) {
      const { vx, vy, vz, voxel } = update;

      if (vy < 0 || vy >= this.options.maxHeight) continue;

      const type = BlockUtils.extractID(voxel);
      const rotation = BlockUtils.extractRotation(voxel);
      const [rotationValue, yRotationValue] = BlockRotation.decode(rotation);
      const stage = BlockUtils.extractStage(voxel);

      const currentType = this.getVoxelAt(vx, vy, vz);
      const currentRotation = this.getVoxelRotationAt(vx, vy, vz);
      const currentStage = this.getVoxelStageAt(vx, vy, vz);

      const needsUpdate =
        currentType !== type ||
        currentRotation.value !== rotation.value ||
        currentRotation.yRotation !== rotation.yRotation ||
        currentStage !== stage;

      if (needsUpdate) {
        blockUpdates.push({
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
        });
      }
    }

    if (blockUpdates.length === 0) return;

    this.isTrackingChunks = true;

    let remaining = blockUpdates;
    while (remaining.length > 0) {
      remaining = this.processLightUpdates(remaining);
    }

    this.flushAccumulatedLightOps();
    this.isTrackingChunks = false;

    if (this.options.useLightWorkers) {
      if (this.lightJobQueue.length === 0 && this.activeLightBatch === null) {
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

    const isSunlight = color === "SUNLIGHT";

    const blockCache = new Map<string, Block>();
    const rotationCache = new Map<string, BlockRotation>();

    const getCachedBlock = (vx: number, vy: number, vz: number): Block => {
      const key = `${vx},${vy},${vz}`;
      let block = blockCache.get(key);
      if (!block) {
        block = this.getBlockAt(vx, vy, vz);
        blockCache.set(key, block);
      }
      return block;
    };

    const getCachedRotation = (
      vx: number,
      vy: number,
      vz: number
    ): BlockRotation => {
      const key = `${vx},${vy},${vz}`;
      let rotation = rotationCache.get(key);
      if (!rotation) {
        rotation = this.getVoxelRotationAt(vx, vy, vz);
        rotationCache.set(key, rotation);
      }
      return rotation;
    };

    let head = 0;
    while (head < queue.length) {
      const node = queue[head++];
      const { voxel, level } = node;

      if (level === 0) {
        continue;
      }

      const [vx, vy, vz] = voxel;
      const sourceBlock = getCachedBlock(vx, vy, vz);
      const sourceRotation = getCachedRotation(vx, vy, vz);
      const sourceTransparency =
        !isSunlight &&
        BlockUtils.getBlockTorchLightLevel(sourceBlock, color) > 0
          ? [true, true, true, true, true, true]
          : BlockUtils.getBlockRotatedTransparency(sourceBlock, sourceRotation);

      for (const [ox, oy, oz] of VOXEL_NEIGHBORS) {
        const nvy = vy + oy;

        if (nvy < 0 || nvy >= maxHeight) {
          continue;
        }

        const nvx = vx + ox;
        const nvz = vz + oz;

        const [ncx, ncz] = ChunkUtils.mapVoxelToChunk(
          [nvx, nvy, nvz],
          chunkSize
        );

        if (
          ncx < startCX ||
          ncx > endCX ||
          ncz < startCZ ||
          ncz > endCZ ||
          (min && (nvx < min[0] || nvz < min[2])) ||
          (max && (nvx >= max[0] || nvz >= max[2]))
        ) {
          continue;
        }

        const nextVoxel = [nvx, nvy, nvz] as Coords3;
        const nBlock = getCachedBlock(nvx, nvy, nvz);
        const nRotation = getCachedRotation(nvx, nvy, nvz);
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
            ? this.getSunlightAt(nvx, nvy, nvz)
            : this.getTorchLightAt(nvx, nvy, nvz, color)) >= nextLevel
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

    const fill: LightNode[] = [];
    const queue: LightNode[] = [];

    const isSunlight = color === "SUNLIGHT";
    const [vx, vy, vz] = voxel;

    queue.push({
      voxel,
      level: isSunlight
        ? this.getSunlightAt(vx, vy, vz)
        : this.getTorchLightAt(vx, vy, vz, color),
    });

    if (isSunlight) {
      this.setSunlightAt(vx, vy, vz, 0);
    } else {
      this.setTorchLightAt(vx, vy, vz, 0, color);
    }

    let iterationCount = 0;
    const startTime = performance.now();

    let head = 0;
    while (head < queue.length) {
      iterationCount++;
      const node = queue[head++];
      const { voxel, level } = node;

      const [vx, vy, vz] = voxel;

      for (const [ox, oy, oz] of VOXEL_NEIGHBORS) {
        const nvy = vy + oy;

        if (nvy < 0 || nvy >= maxHeight) {
          continue;
        }

        const nvx = vx + ox;
        const nvz = vz + oz;
        const [ncx, ncz] = ChunkUtils.mapVoxelToChunk(
          [nvx, nvy, nvz],
          chunkSize
        );

        if (
          ncx < minChunk[0] ||
          ncz < minChunk[1] ||
          ncx > maxChunk[0] ||
          ncz > maxChunk[1]
        ) {
          continue;
        }

        const nBlock = this.getBlockAt(nvx, nvy, nvz);
        const rotation = this.getVoxelRotationAt(nvx, nvy, nvz);
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
          ? this.getSunlightAt(nvx, nvy, nvz)
          : this.getTorchLightAt(nvx, nvy, nvz, color);

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

    const endTime = performance.now();
    console.log(
      `removeLight executed in ${
        endTime - startTime
      }ms with ${iterationCount} iterations, color: ${color}`
    );

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

    // Initialise the queue with all voxels to be cleared.
    voxels.forEach(([vx, vy, vz]) => {
      const level = isSunlight
        ? this.getSunlightAt(vx, vy, vz)
        : this.getTorchLightAt(vx, vy, vz, color);
      if (level === 0) return;

      // Push into queue and immediately clear the light so we don't visit twice.
      queue.push({ voxel: [vx, vy, vz], level });
      if (isSunlight) {
        this.setSunlightAt(vx, vy, vz, 0);
      } else {
        this.setTorchLightAt(vx, vy, vz, 0, color);
      }
    });

    let head = 0;
    while (head < queue.length) {
      const { voxel, level } = queue[head++];
      const [vx, vy, vz] = voxel;

      for (const [ox, oy, oz] of VOXEL_NEIGHBORS) {
        const nvy = vy + oy;
        if (nvy < 0 || nvy >= maxHeight) continue;

        const nvx = vx + ox;
        const nvz = vz + oz;

        const nBlock = this.getBlockAt(nvx, nvy, nvz);
        const rotation = this.getVoxelRotationAt(nvx, nvy, nvz);
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
          ? this.getSunlightAt(nvx, nvy, nvz)
          : this.getTorchLightAt(nvx, nvy, nvz, color);
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
   * @returns A 3D mesh (group) of the block model.
   */
  makeBlockMesh = (
    idOrName: number | string,
    options: Partial<{
      separateFaces: boolean;
      crumbs: boolean;
      material: "basic" | "standard";
      centered: boolean;
    }> = {}
  ) => {
    this.checkIsInitialized("make block mesh", false);

    if (!idOrName) {
      return null;
    }

    const block = this.getBlockOf(idOrName);
    if (!block) return null;

    const { separateFaces, crumbs, material, centered } = {
      separateFaces: false,
      crumbs: false,
      material: "basic",
      centered: false,
      ...options,
    };

    let { faces } = block;
    const { isSeeThrough, dynamicPatterns } = block;

    if (dynamicPatterns && dynamicPatterns.length > 0) {
      faces = this.getBlockFacesForDynamicPatterns(block.id, dynamicPatterns);
    }

    const geometries = new Map<
      string,
      {
        identifier: string;
        positions: number[];
        uvs: number[];
        indices: number[];
        material: MeshStandardMaterial | MeshBasicMaterial;
      }
    >();

    faces.forEach((face, index) => {
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
          identifier,
          positions: [],
          uvs: [],
          indices: [],
          material: mat,
        };
      }

      const { positions, uvs, indices } = geometry;

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

      corners.forEach(({ uv, pos }) => {
        const offset = centered ? 0.5 : 0;
        positions.push(...pos.map((p) => p * faceScale - offset));
        uvs.push(
          uv[0] * (endU - startU) + startU,
          uv[1] * (endV - startV) + startV
        );
      });

      indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);

      geometries.set(identifier, geometry);
    });

    const group = new Group();

    geometries.forEach(({ identifier, positions, uvs, indices, material }) => {
      const geometry = new BufferGeometry();
      geometry.setAttribute(
        "position",
        new Float32BufferAttribute(positions, 3)
      );
      geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      const mesh = new Mesh(geometry, material);
      mesh.name = identifier;
      group.add(mesh);
    });

    group.name = block.name;

    if (!centered) {
      group.position.x -= 0.5;
      group.position.y -= 0.5;
      group.position.z -= 0.5;
    }

    return group;
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

    const { blocks, options, stats } = this.initialData;

    this._time = stats.time;

    // Loading the registry
    Object.keys(blocks).forEach((name) => {
      const block = blocks[name];
      const { id, aabbs, isDynamic } = block;

      const lowerName = name.toLowerCase();

      block.independentFaces = new Set();
      block.isolatedFaces = new Set();

      block.faces.forEach((face) => {
        if (face.independent) {
          block.independentFaces.add(face.name);
        }
        if (face.isolated) {
          block.isolatedFaces.add(face.name);
        }
      });

      block.aabbs = aabbs.map(
        ({ minX, minY, minZ, maxX, maxY, maxZ }) =>
          new AABB(minX, minY, minZ, maxX, maxY, maxZ)
      );

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
    });

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
        shadowMapSize: 2048,
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
  update(
    position: Vector3 = new Vector3(),
    direction: Vector3 = new Vector3()
  ) {
    if (!this.isInitialized) {
      return;
    }

    const delta = this.clock.getDelta();

    const center = ChunkUtils.mapVoxelToChunk(
      position.toArray() as Coords3,
      this.options.chunkSize
    );
    if (this.options.doesTickTime) {
      this._time = (this.time + delta) % this.options.timePerDay;
    }

    const startOverall = performance.now();

    const startMaintainChunks = performance.now();
    this.maintainChunks(center);
    const maintainChunksDuration = performance.now() - startMaintainChunks;

    const startRequestChunks = performance.now();
    this.requestChunks(center, direction);
    const requestChunksDuration = performance.now() - startRequestChunks;

    const startProcessChunks = performance.now();
    this.processChunks(center);
    const processChunksDuration = performance.now() - startProcessChunks;

    const startUpdatePhysics = performance.now();
    this.updatePhysics(delta);
    const updatePhysicsDuration = performance.now() - startUpdatePhysics;

    const startUpdateUniforms = performance.now();
    this.updateUniforms();
    const updateUniformsDuration = performance.now() - startUpdateUniforms;

    const startUpdateSkyAndClouds = performance.now();
    this.updateSkyAndClouds(position);
    const updateSkyAndCloudsDuration =
      performance.now() - startUpdateSkyAndClouds;

    const startEmitServerUpdates = performance.now();
    this.emitServerUpdates();
    const emitServerUpdatesDuration =
      performance.now() - startEmitServerUpdates;

    const overallDuration = performance.now() - startOverall;
    if (overallDuration > 1000 / 60) {
      const isDebug = false;
      const log = isDebug ? console.log : () => {};
      log("maintainChunks took", maintainChunksDuration, "ms");
      log("requestChunks took", requestChunksDuration, "ms");
      log("processChunks took", processChunksDuration, "ms");
      log("updatePhysics took", updatePhysicsDuration, "ms");
      log("updateUniforms took", updateUniformsDuration, "ms");
      log("updateSkyAndClouds took", updateSkyAndCloudsDuration, "ms");
      log("emitServerUpdates took", emitServerUpdatesDuration, "ms");
    }
  }

  /**
   * The message interceptor.
   *
   * @hidden
   */
  onMessage(
    message: MessageProtocol<
      any,
      unknown,
      {
        voxel: Coords3;
        json: string;
      }
    >
  ) {
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
          this.handleEntities(entities);
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
        chunks.forEach((chunk) => {
          const { x, z } = chunk;
          this.chunkPipeline.markProcessing([x, z], "load", chunk);
        });

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

  private handleEntities = (entities: EntityProtocol<any>[]) => {
    entities.forEach((entity) => {
      const { id, type, metadata, operation } = entity;

      if (!type.startsWith("block::")) {
        return;
      }

      if (!metadata || !metadata.voxel) {
        console.log(
          "No metadata or voxel in block entity",
          id,
          type,
          operation,
          metadata
        );
        return;
      }

      const [px, py, pz] = metadata.voxel;
      const [vx, vy, vz] = [Math.floor(px), Math.floor(py), Math.floor(pz)];
      const voxelId = ChunkUtils.getVoxelName([vx, vy, vz]);

      const data: T | null = metadata.json ?? null;

      const originalData = this.blockEntitiesMap.get(voxelId) ?? [];
      this.blockEntityUpdateListeners.forEach((listener) => {
        const chunkCoords = ChunkUtils.mapVoxelToChunk(
          [vx, vy, vz],
          this.options.chunkSize
        );
        const chunkName = ChunkUtils.getChunkName(chunkCoords);
        const chunk = this.chunkPipeline.getLoadedChunk(chunkName);
        // very iffy if statement. the intention is to check if chunk is
        // mesh-initialized.
        if (!chunk || chunk.meshes.size === 0) {
          const unbind = this.addChunkInitListener(chunkCoords, () => {
            listener({
              id,
              voxel: [vx, vy, vz],
              oldValue: (originalData as any)?.data ?? null,
              newValue: data as T | null,
              operation,
              etype: type,
            });
            unbind();
          });

          return;
        }

        listener({
          id,
          voxel: [vx, vy, vz],
          oldValue: (originalData as any)?.data ?? null,
          newValue: data as T | null,
          operation,
          etype: type,
        });
      });

      switch (operation) {
        case "DELETE": {
          this.blockEntitiesMap.delete(voxelId);
          const block = this.getBlockByName(type.split("::")[1]);
          if (block) {
            for (const face of block.faces) {
              if (face.isolated) {
                const voxel = [vx, vy, vz] as Coords3;
                const material = this.getBlockFaceMaterial(
                  block.id,
                  face.name,
                  voxel
                );
                if (material) {
                  material.dispose();
                  material.map?.dispose();
                }
                this.chunkRenderer.materials.delete(
                  this.makeChunkMaterialKey(block.id, face.name, voxel)
                );
              }
            }
          }
          break;
        }

        case "CREATE":
        case "UPDATE": {
          this.blockEntitiesMap.set(voxelId, { id, data });
          break;
        }
      }
    });
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

  private requestChunks(center: Coords2, direction: Vector3) {
    const {
      renderRadius,
      options: {
        chunkRerequestInterval,
        chunkLoadExponent,
        maxChunkRequestsPerUpdate,
      },
    } = this;

    const total = this.chunkPipeline.totalCount;
    const loadedCount = this.chunkPipeline.loadedCount;

    const ratio = total === 0 ? 1 : loadedCount / total;
    const hasDirection = direction.length() > 0;

    const angleThreshold =
      ratio === 1
        ? (Math.PI * 3) / 8
        : Math.max(ratio ** chunkLoadExponent, 0.1);

    const [centerX, centerZ] = center;
    const toRequestSet = new Set<string>();

    // Pre-calculate squared renderRadius to use in distance checks
    const renderRadiusBounded = Math.floor(
      Math.max(Math.min(ratio * renderRadius, renderRadius), 1)
    );
    const renderRadiusSquared = renderRadiusBounded * renderRadiusBounded;

    // Surrounding the center, request all chunks that are not loaded.
    for (let ox = -renderRadiusBounded; ox <= renderRadiusBounded; ox++) {
      for (let oz = -renderRadiusBounded; oz <= renderRadiusBounded; oz++) {
        // Use squared distance to avoid unnecessary Math.sqrt() call
        if (ox * ox + oz * oz > renderRadiusSquared) continue;

        const cx = centerX + ox;
        const cz = centerZ + oz;

        if (!this.isWithinWorld(cx, cz)) {
          continue;
        }

        if (
          hasDirection &&
          !this.isChunkInView(center, [cx, cz], direction, angleThreshold)
        ) {
          continue;
        }

        const chunkName = ChunkUtils.getChunkName([cx, cz]);

        const stage = this.chunkPipeline.getStage(chunkName);

        if (stage === "loaded") {
          continue;
        }

        if (stage === "requested") {
          const retryCount = this.chunkPipeline.incrementRetry(chunkName);

          if (retryCount > chunkRerequestInterval) {
            this.chunkPipeline.remove(chunkName);
            toRequestSet.add(`${cx},${cz}`);
          }

          continue;
        }

        if (stage === "processing") {
          continue;
        }

        toRequestSet.add(`${cx},${cz}`);
      }
    }

    // i guess we still want to update the direction/center?
    // if (toRequestSet.size === 0) {
    //   return;
    // }

    const toRequestArray = Array.from(toRequestSet).map((coords) =>
      coords.split(",").map(Number)
    );

    // Sort the chunks by distance from the center, closest first.
    toRequestArray.sort((a, b) => {
      const ad = (a[0] - center[0]) ** 2 + (a[1] - center[1]) ** 2;
      const bd = (b[0] - center[0]) ** 2 + (b[1] - center[1]) ** 2;
      return ad - bd;
    });

    // LOD:
    // < 4 chunks: 0
    // > 4 < 6 chunks: 1
    // > 6 chunks: 2

    const toRequest = toRequestArray.slice(0, maxChunkRequestsPerUpdate);
    if (toRequest.length) {
      this.packets.push({
        type: "LOAD",
        json: {
          center,
          direction: new Vector2(direction.x, direction.z)
            .normalize()
            .toArray(),
          chunks: toRequest,
        },
      });

      toRequest.forEach((coords) => {
        this.chunkPipeline.markRequested(coords as Coords2);
      });
    }
  }

  private processChunks(center: Coords2) {
    const processingSet = this.chunkPipeline.getInStage("processing");
    if (processingSet.size === 0) return;

    const toProcessArray: Array<{
      name: string;
      source: "update" | "load";
      data: import("@voxelize/protocol").ChunkProtocol;
    }> = [];
    for (const name of processingSet) {
      const procData = this.chunkPipeline.getProcessingData(name);
      if (procData) {
        toProcessArray.push({ name, ...procData });
      }
    }

    toProcessArray.sort((a, b) => {
      const { x: ax, z: az } = a.data;
      const { x: bx, z: bz } = b.data;

      const ad = (ax - center[0]) ** 2 + (az - center[1]) ** 2;
      const bd = (bx - center[0]) ** 2 + (bz - center[1]) ** 2;

      return ad - bd;
    });

    const {
      maxProcessesPerUpdate,
      chunkSize,
      maxHeight,
      subChunks,
      maxLightLevel,
      clientOnlyMeshing,
    } = this.options;

    const triggerInitListener = (chunk: Chunk) => {
      const listeners = this.chunkInitializeListeners.get(chunk.name);

      if (Array.isArray(listeners)) {
        listeners.forEach((listener) => listener(chunk));
        this.chunkInitializeListeners.delete(chunk.name);
      }
    };

    const toProcess = toProcessArray.slice(0, maxProcessesPerUpdate);

    toProcess.forEach((item) => {
      const { x, z, id } = item.data;

      let chunk = this.getChunkByCoords(x, z);

      if (!chunk) {
        chunk = new Chunk(id, [x, z], {
          maxHeight,
          subChunks,
          size: chunkSize,
          maxLightLevel,
        });
      }

      chunk.setData(item.data);
      chunk.isDirty = false;

      this.chunkPipeline.markLoaded([x, z], chunk);

      this.emitChunkEvent("chunk-data-loaded", {
        chunk,
        coords: [x, z],
      });

      const buildMeshes = () => {
        if (clientOnlyMeshing) {
          this.markChunkAndNeighborsForMeshing(x, z);
        } else {
          for (const mesh of item.data.meshes) {
            this.buildChunkMesh(x, z, mesh);
            this.meshPipeline.markFreshFromServer(x, z, mesh.level);
          }
        }
      };
      if (chunk.isReady) {
        buildMeshes();
        triggerInitListener(chunk);
      } else {
        let disposer = () => {};
        disposer = this.addChunkInitListener([x, z], () => {
          buildMeshes();
          disposer();
        });
      }
    });
  }

  private maintainChunks(center: Coords2) {
    const { deleteRadius } = this;

    const [centerX, centerZ] = center;
    const deleted: Coords2[] = [];
    const toRemove: string[] = [];

    this.chunkPipeline.forEachLoaded((chunk, name) => {
      const [x, z] = chunk.coords;

      if ((x - centerX) ** 2 + (z - centerZ) ** 2 > deleteRadius ** 2) {
        chunk.meshes.forEach((meshes, level) => {
          for (const mesh of meshes) {
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
        });

        this.emitChunkEvent("chunk-unloaded", {
          chunk,
          coords: chunk.coords,
          allMeshes: new Map(chunk.meshes),
        });

        chunk.dispose();
        this.meshPipeline.remove(x, z);
        toRemove.push(name);
        deleted.push(chunk.coords);
      }
    });

    toRemove.forEach((name) => this.chunkPipeline.remove(name));

    this.chunkPipeline.forEach("requested", (name) => {
      const [x, z] = ChunkUtils.parseChunkName(name);

      if ((x - centerX) ** 2 + (z - centerZ) ** 2 > deleteRadius ** 2) {
        this.chunkPipeline.remove(name);
        deleted.push([x, z]);
      }
    });

    const processingToRemove: string[] = [];
    this.chunkPipeline.forEach("processing", (name) => {
      const procData = this.chunkPipeline.getProcessingData(name);
      if (procData) {
        const { x, z } = procData.data;
        if ((x - centerX) ** 2 + (z - centerZ) ** 2 > deleteRadius ** 2) {
          processingToRemove.push(name);
        }
      }
    });
    processingToRemove.forEach((name) => this.chunkPipeline.remove(name));

    deleted.forEach((coords) => {
      const name = ChunkUtils.getChunkName(coords);
      this.chunkInitializeListeners.delete(name);
    });

    if (deleted.length) {
      this.packets.push({
        type: "UNLOAD",
        json: {
          chunks: deleted,
        },
      });
    }
  }

  private triggerBlockUpdateListeners(
    vx: number,
    vy: number,
    vz: number,
    oldValue: number,
    newValue: number
  ) {
    this.blockUpdateListeners.forEach((listener) =>
      listener({
        voxel: [vx, vy, vz],
        oldValue,
        newValue,
      })
    );
  }

  private attemptBlockCache(
    vx: number,
    vy: number,
    vz: number,
    newVal: number
  ) {
    const chunk = this.getChunkByPosition(vx, vy, vz);
    if (!chunk) return;

    const oldVal = chunk.getRawValue(vx, vy, vz);

    if (oldVal !== newVal) {
      const name = ChunkUtils.getVoxelName([vx, vy, vz]);
      const arr = this.oldBlocks.get(name) || [];
      arr.push(oldVal);
      this.oldBlocks.set(name, arr);
      this.triggerBlockUpdateListeners(vx, vy, vz, oldVal, newVal);
    }
  }

  /**
   * Update the physics engine by ticking all inner AABBs.
   */
  private updatePhysics = (delta: number) => {
    if (!this.physics || !this.options.gravity) return;

    const noGravity =
      this.options.gravity[0] ** 2 +
        this.options.gravity[1] ** 2 +
        this.options.gravity[2] ** 2 <
      0.01;

    this.physics.bodies.forEach((body) => {
      const coords = ChunkUtils.mapVoxelToChunk(
        body.getPosition() as Coords3,
        this.options.chunkSize
      );
      const chunk = this.getChunkByPosition(...(body.getPosition() as Coords3));

      if ((!chunk || !chunk.isReady) && this.isWithinWorld(...coords)) {
        return;
      }

      this.physics.iterateBody(body, delta, noGravity);
    });
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

    this.chunkRenderer.uniforms.fogColor.value?.copy(
      this.sky.uMiddleColor.value
    );

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
    this.chunkRenderer.uniforms.time.value = performance.now();
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

    let lightX: number;
    let lightY: number;
    let shadowStrength: number;

    if (sunY > horizonThreshold) {
      lightX = sunX;
      lightY = sunY;
      shadowStrength = 1.0;
    } else if (sunY < -horizonThreshold) {
      lightX = moonX;
      lightY = Math.max(moonY, minElevation);
      shadowStrength = 0.6;
    } else {
      const t = (horizonThreshold - sunY) / (2 * horizonThreshold);
      const smoothT = t * t * (3 - 2 * t);

      lightX = sunX * (1 - smoothT) + moonX * smoothT;
      lightY = Math.max(minElevation, sunY * (1 - smoothT) + moonY * smoothT);
      shadowStrength = 1.0 * (1 - smoothT) + 0.6 * smoothT;
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
      this.chunkRenderer.shaderLightingUniforms.lightVolumeMin.value.copy(
        this.lightVolume.getVolumeMin()
      );
      this.chunkRenderer.shaderLightingUniforms.lightVolumeSize.value.copy(
        this.lightVolume.getVolumeSize()
      );
    }
  }

  renderShadowMaps(renderer: WebGLRenderer, entities?: Object3D[]) {
    if (!this.usesShaderLighting || !this.csmRenderer) return;

    if (entities && entities.length > 0) {
      this.csmRenderer.markCascadesForEntityRender();
    }

    this.csmRenderer.render(renderer, this, entities);
  }

  private buildChunkMesh(cx: number, cz: number, data: MeshProtocol) {
    const chunk = this.getChunkByCoords(cx, cz);
    if (!chunk) return;

    const { maxHeight, subChunks, chunkSize, mergeChunkGeometries } =
      this.options;
    const { level, geometries } = data;
    const heightPerSubChunk = Math.floor(maxHeight / subChunks);

    const oldMeshes = chunk.meshes.get(level);
    if (oldMeshes) {
      for (let i = 0; i < oldMeshes.length; i++) {
        const mesh = oldMeshes[i];
        if (mesh) {
          this.csmRenderer?.removeSkipShadowObject(mesh);
          mesh.geometry.dispose();
          chunk.group.remove(mesh);
        }
      }
    }

    chunk.meshes.delete(level);

    if (geometries.length === 0) return;

    let meshes: Mesh[];

    if (mergeChunkGeometries) {
      const materialToGeometries = new Map<
        string,
        {
          geometry: BufferGeometry;
          material: CustomChunkShaderMaterial;
          voxel: number;
        }[]
      >();

      for (const geo of geometries) {
        const { voxel, at, faceName, indices, lights, positions, uvs } = geo;
        const geometry = new BufferGeometry();

        geometry.setAttribute("position", new BufferAttribute(positions, 3));
        geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
        geometry.setAttribute("light", new BufferAttribute(lights, 1));
        geometry.setIndex(new BufferAttribute(indices, 1));
        geometry.computeVertexNormals();

        let material = this.getBlockFaceMaterial(
          voxel,
          faceName,
          at && at.length ? at : undefined
        );
        if (!material) {
          const block = this.getBlockById(voxel);
          const face = block.faces.find((face) => face.name === faceName);
          if (!face.isolated || !at) continue;
          try {
            material = this.getOrCreateIsolatedBlockMaterial(
              voxel,
              at,
              faceName
            );
          } catch {
            continue;
          }
        }

        const matKey = this.makeChunkMaterialKey(
          voxel,
          faceName,
          at && at.length ? at : undefined
        );
        if (!materialToGeometries.has(matKey)) {
          materialToGeometries.set(matKey, []);
        }
        materialToGeometries.get(matKey)!.push({ geometry, material, voxel });
      }

      meshes = [];
      for (const [, geoMats] of materialToGeometries) {
        if (geoMats.length === 0) continue;

        const material = geoMats[0].material;
        const voxel = geoMats[0].voxel;

        let finalGeometry: BufferGeometry;
        if (geoMats.length === 1) {
          finalGeometry = geoMats[0].geometry;
        } else {
          const geos: BufferGeometry[] = [];
          for (let i = 0; i < geoMats.length; i++) {
            geos.push(geoMats[i].geometry);
          }
          const merged = mergeGeometries(geos, false);
          if (!merged) {
            for (let i = 0; i < geos.length; i++) {
              geos[i].dispose();
            }
            continue;
          }
          for (let i = 0; i < geos.length; i++) {
            geos[i].dispose();
          }
          finalGeometry = merged;
        }

        finalGeometry.computeBoundingSphere();

        const mesh = new Mesh(finalGeometry, material);
        mesh.position.set(
          cx * chunkSize,
          level * heightPerSubChunk,
          cz * chunkSize
        );
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;
        mesh.userData = { isChunk: true, merged: true, voxel };
        if (material.transparent) {
          const block = this.getBlockByIdSafe(voxel);
          mesh.renderOrder = block?.isFluid
            ? TRANSPARENT_FLUID_RENDER_ORDER
            : TRANSPARENT_RENDER_ORDER;
          const sortData = prepareTransparentMesh(mesh);
          if (sortData) {
            mesh.userData.transparentSortData = sortData;
            mesh.onBeforeRender = (_renderer, _scene, camera) => {
              sortTransparentMesh(
                mesh,
                mesh.userData.transparentSortData as TransparentMeshData,
                camera
              );
            };
          }
          this.csmRenderer?.addSkipShadowObject(mesh);
        }

        chunk.group.add(mesh);
        meshes.push(mesh);
      }
    } else {
      meshes = [];
      for (let i = 0; i < geometries.length; i++) {
        const geo = geometries[i];
        const { voxel, at, faceName, indices, lights, positions, uvs } = geo;
        const geometry = new BufferGeometry();

        geometry.setAttribute("position", new BufferAttribute(positions, 3));
        geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
        geometry.setAttribute("light", new BufferAttribute(lights, 1));
        geometry.setIndex(new BufferAttribute(indices, 1));
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();

        let material = this.getBlockFaceMaterial(
          voxel,
          faceName,
          at && at.length ? at : undefined
        );
        if (!material) {
          const block = this.getBlockById(voxel);
          const face = block.faces.find((face) => face.name === faceName);

          if (!face.isolated || !at) {
            console.warn("Unlikely situation happened...");
            continue;
          }

          try {
            material = this.getOrCreateIsolatedBlockMaterial(
              voxel,
              at,
              faceName
            );
          } catch (e) {
            console.error(e);
            continue;
          }
        }

        const mesh = new Mesh(geometry, material);
        mesh.position.set(
          cx * chunkSize,
          level * heightPerSubChunk,
          cz * chunkSize
        );
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;
        mesh.userData = { isChunk: true, voxel };
        if (material.transparent) {
          const block = this.getBlockByIdSafe(voxel);
          mesh.renderOrder = block?.isFluid
            ? TRANSPARENT_FLUID_RENDER_ORDER
            : TRANSPARENT_RENDER_ORDER;
          const sortData = prepareTransparentMesh(mesh);
          if (sortData) {
            mesh.userData.transparentSortData = sortData;
            mesh.onBeforeRender = (_renderer, _scene, camera) => {
              sortTransparentMesh(
                mesh,
                mesh.userData.transparentSortData as TransparentMeshData,
                camera
              );
            };
          }
          this.csmRenderer?.addSkipShadowObject(mesh);
        }

        chunk.group.add(mesh);
        meshes.push(mesh);
      }
    }

    if (!this.children.includes(chunk.group)) {
      this.add(chunk.group);
    }

    if (!chunk.meshes.has(level)) {
      chunk.meshes.set(level, []);
    }

    chunk.meshes.get(level)?.push(...meshes);

    this.csmRenderer?.markAllCascadesForRender();

    this.emitChunkEvent("chunk-mesh-loaded", {
      chunk,
      coords: [cx, cz],
      level,
      meshes,
    });

    if (chunk.meshes.size === this.options.subChunks) {
      this.emitChunkEvent("chunk-loaded", {
        chunk,
        coords: [cx, cz],
        allMeshes: chunk.meshes,
      });
    }
  }

  private setupComponents() {
    const { skyOptions, cloudsOptions } = this.options;

    this.registry = new Registry();
    this.loader = new Loader();
    this.chunkPipeline = new ChunkPipeline();
    this.meshPipeline = new MeshPipeline();
    this.chunkRenderer = new ChunkRenderer();

    if (this.usesShaderLighting) {
      this.csmRenderer = new CSMRenderer({
        cascades: 3,
        shadowMapSize: 2048,
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
        const chunk = this.getChunkByPosition(vx, vy, vz);
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
          return aabbsWithFlags.map(({ aabb, worldSpace }) =>
            worldSpace
              ? aabb.translate([vx, vy, vz])
              : rotation.rotateAABB(aabb).translate([vx, vy, vz])
          );
        }

        if (isPassable || isFluid) return [];

        const rotation = chunk.getVoxelRotation(vx, vy, vz);
        return aabbs.map((aabb) =>
          rotation.rotateAABB(aabb).translate([vx, vy, vz])
        );
      },
      (vx: number, vy: number, vz: number) => {
        const chunk = this.getChunkByPosition(vx, vy, vz);
        if (!chunk) return false;

        const id = chunk.getVoxel(vx, vy, vz);
        const block = this.getBlockByIdSafe(id);

        return block?.isFluid ?? false;
      },
      (vx: number, vy: number, vz: number) => {
        const chunk = this.getChunkByPosition(vx, vy, vz);
        if (!chunk) return [];

        const id = chunk.getVoxel(vx, vy, vz);
        const block = this.getBlockByIdSafe(id);
        if (!block) return [];

        const { aabbs, isClimbable } = block;

        if (!isClimbable) return [];

        const rotation = chunk.getVoxelRotation(vx, vy, vz);
        return aabbs.map((aabb) =>
          rotation.rotateAABB(aabb).translate([vx, vy, vz])
        );
      },
      (vx: number, vy: number, vz: number) => {
        const chunk = this.getChunkByPosition(vx, vy, vz);
        return chunk?.getVoxelStage(vx, vy, vz) ?? 0;
      },
      (vx: number, vy: number, vz: number) => {
        const chunk = this.getChunkByPosition(vx, vy, vz);
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

    interface RemovedLightSource {
      voxel: Coords3;
      block: Block;
    }

    const removedLightSources: RemovedLightSource[] = [];
    const redRemoval: Coords3[] = [];
    const greenRemoval: Coords3[] = [];
    const blueRemoval: Coords3[] = [];
    const sunlightRemoval: Coords3[] = [];

    const redFlood: LightNode[] = [];
    const greenFlood: LightNode[] = [];
    const blueFlood: LightNode[] = [];
    const sunFlood: LightNode[] = [];

    for (const update of processedUpdates) {
      const { voxel, oldBlock, newBlock, newRotation, oldStage } = update;
      const [vx, vy, vz] = voxel;

      let currentEmitsLight = oldBlock.isLight;
      let currentRedLevel = oldBlock.redLightLevel;
      let currentGreenLevel = oldBlock.greenLightLevel;
      let currentBlueLevel = oldBlock.blueLightLevel;

      if (oldBlock.dynamicPatterns) {
        currentEmitsLight = false;
        currentRedLevel = 0;
        currentGreenLevel = 0;
        currentBlueLevel = 0;

        for (const pattern of oldBlock.dynamicPatterns) {
          for (const part of pattern.parts) {
            const ruleMatched = BlockUtils.evaluateBlockRule(
              part.rule,
              [vx, vy, vz],
              {
                getVoxelAt: (x: number, y: number, z: number) => {
                  if (x === vx && y === vy && z === vz) return update.oldId;
                  return this.getVoxelAt(x, y, z);
                },
                getVoxelRotationAt: (x: number, y: number, z: number) => {
                  if (x === vx && y === vy && z === vz)
                    return update.oldRotation;
                  return this.getVoxelRotationAt(x, y, z);
                },
                getVoxelStageAt: (x: number, y: number, z: number) => {
                  if (x === vx && y === vy && z === vz) return oldStage;
                  return this.getVoxelStageAt(x, y, z);
                },
              }
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
      if (newBlock.dynamicPatterns && update.stage !== undefined) {
        newEmitsLight = false;
        for (const pattern of newBlock.dynamicPatterns) {
          for (const part of pattern.parts) {
            const ruleMatched = BlockUtils.evaluateBlockRule(
              part.rule,
              [vx, vy, vz],
              {
                getVoxelAt: (x: number, y: number, z: number) => {
                  if (x === vx && y === vy && z === vz) return update.newId;
                  return this.getVoxelAt(x, y, z);
                },
                getVoxelRotationAt: (x: number, y: number, z: number) => {
                  if (x === vx && y === vy && z === vz) return newRotation;
                  return this.getVoxelRotationAt(x, y, z);
                },
                getVoxelStageAt: (x: number, y: number, z: number) => {
                  if (x === vx && y === vy && z === vz)
                    return update.stage || 0;
                  return this.getVoxelStageAt(x, y, z);
                },
              }
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
        }
      }

      if (currentEmitsLight && !newEmitsLight) {
        const blockWithLevels = { ...oldBlock };
        blockWithLevels.redLightLevel = currentRedLevel;
        blockWithLevels.greenLightLevel = currentGreenLevel;
        blockWithLevels.blueLightLevel = currentBlueLevel;

        removedLightSources.push({
          voxel: [vx, vy, vz],
          block: blockWithLevels,
        });
      }
    }

    removedLightSources.forEach(({ voxel, block }) => {
      const [vx, vy, vz] = voxel;

      if (this.getSunlightAt(vx, vy, vz) > 0) {
        sunlightRemoval.push(voxel);
      }

      if (block.redLightLevel > 0) redRemoval.push(voxel);
      if (block.greenLightLevel > 0) greenRemoval.push(voxel);
      if (block.blueLightLevel > 0) blueRemoval.push(voxel);
    });

    for (const update of processedUpdates) {
      const { voxel, oldBlock, newBlock, oldRotation, newRotation } = update;
      const [vx, vy, vz] = voxel;

      const isRemovedLightSource = removedLightSources.some(
        ({ voxel: v }) => v[0] === vx && v[1] === vy && v[2] === vz
      );

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

      if (newBlock.isOpaque || newBlock.lightReduce) {
        if (this.getSunlightAt(vx, vy, vz) > 0) {
          sunlightRemoval.push(voxel);
        }
        if (this.getTorchLightAt(vx, vy, vz, "RED") > 0) {
          redRemoval.push(voxel);
        }
        if (this.getTorchLightAt(vx, vy, vz, "GREEN") > 0) {
          greenRemoval.push(voxel);
        }
        if (this.getTorchLightAt(vx, vy, vz, "BLUE") > 0) {
          blueRemoval.push(voxel);
        }
      } else {
        let removeCount = 0;

        const lightData = [
          [SUNLIGHT, this.getSunlightAt(vx, vy, vz)],
          [RED_LIGHT, this.getTorchLightAt(vx, vy, vz, "RED")],
          [GREEN_LIGHT, this.getTorchLightAt(vx, vy, vz, "GREEN")],
          [BLUE_LIGHT, this.getTorchLightAt(vx, vy, vz, "BLUE")],
        ] as const;

        for (const [ox, oy, oz] of VOXEL_NEIGHBORS) {
          const nvy = vy + oy;
          if (nvy < 0 || nvy >= maxHeight) {
            continue;
          }

          const nvx = vx + ox;
          const nvz = vz + oz;

          const nBlock = this.getBlockAt(nvx, nvy, nvz);
          const nRotation = this.getVoxelRotationAt(nvx, nvy, nvz);
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

          for (const [color, sourceLevel] of lightData) {
            const isSunlight = color === SUNLIGHT;

            const nLevel = isSunlight
              ? this.getSunlightAt(nvx, nvy, nvz)
              : this.getTorchLightAt(nvx, nvy, nvz, color);

            if (
              nLevel < sourceLevel ||
              (oy === -1 &&
                isSunlight &&
                nLevel === maxLightLevel &&
                sourceLevel === maxLightLevel)
            ) {
              removeCount++;
              if (isSunlight) {
                sunlightRemoval.push([nvx, nvy, nvz]);
              } else if (color === RED_LIGHT) {
                redRemoval.push([nvx, nvy, nvz]);
              } else if (color === GREEN_LIGHT) {
                greenRemoval.push([nvx, nvy, nvz]);
              } else if (color === BLUE_LIGHT) {
                blueRemoval.push([nvx, nvy, nvz]);
              }
            }
          }
        }

        if (removeCount === 0) {
          if (this.getSunlightAt(vx, vy, vz) !== 0) {
            sunlightRemoval.push(voxel);
          }
          if (this.getTorchLightAt(vx, vy, vz, "RED") !== 0) {
            redRemoval.push(voxel);
          }
          if (this.getTorchLightAt(vx, vy, vz, "GREEN") !== 0) {
            greenRemoval.push(voxel);
          }
          if (this.getTorchLightAt(vx, vy, vz, "BLUE") !== 0) {
            blueRemoval.push(voxel);
          }
        }
      }

      if (
        newBlock.isLight ||
        (newBlock.dynamicPatterns && update.stage !== undefined)
      ) {
        let redLevel = newBlock.redLightLevel;
        let greenLevel = newBlock.greenLightLevel;
        let blueLevel = newBlock.blueLightLevel;

        if (newBlock.dynamicPatterns && update.stage !== undefined) {
          for (const pattern of newBlock.dynamicPatterns) {
            for (const part of pattern.parts) {
              const ruleMatched = BlockUtils.evaluateBlockRule(
                part.rule,
                [vx, vy, vz],
                {
                  getVoxelAt: (x: number, y: number, z: number) =>
                    this.getVoxelAt(x, y, z),
                  getVoxelRotationAt: (x: number, y: number, z: number) =>
                    this.getVoxelRotationAt(x, y, z),
                  getVoxelStageAt: (x: number, y: number, z: number) =>
                    this.getVoxelStageAt(x, y, z),
                }
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
          redFlood.push({
            voxel: voxel,
            level: redLevel,
          });
        }

        if (greenLevel > 0) {
          greenFlood.push({
            voxel: voxel,
            level: greenLevel,
          });
        }

        if (blueLevel > 0) {
          blueFlood.push({
            voxel: voxel,
            level: blueLevel,
          });
        }
      } else if (oldBlock.isOpaque && !newBlock.isOpaque) {
        for (const [ox, oy, oz] of VOXEL_NEIGHBORS) {
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
          const nRotation = this.getVoxelRotationAt(nvx, nvy, nvz);
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
              this.getSunlightAt(nvx, nvy, nvz) -
              (newBlock.lightReduce ? 1 : 0);
            if (level > 0) {
              sunFlood.push({
                voxel: [nvx, nvy, nvz],
                level: level,
              });
            }

            if (!isRemovedLightSource) {
              const redLevel =
                this.getTorchLightAt(nvx, nvy, nvz, "RED") -
                (newBlock.lightReduce ? 1 : 0);
              if (redLevel > 0) {
                redFlood.push({
                  voxel: [nvx, nvy, nvz],
                  level: redLevel,
                });
              }

              const greenLevel =
                this.getTorchLightAt(nvx, nvy, nvz, "GREEN") -
                (newBlock.lightReduce ? 1 : 0);
              if (greenLevel > 0) {
                greenFlood.push({
                  voxel: [nvx, nvy, nvz],
                  level: greenLevel,
                });
              }

              const blueLevel =
                this.getTorchLightAt(nvx, nvy, nvz, "BLUE") -
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

  private processLightUpdates = (updates: BlockUpdateWithSource[]) => {
    const startTime = performance.now();
    const startSequenceId = this.deltaSequenceCounter;

    const { maxHeight, maxLightsUpdateTime } = this.options;

    const processedUpdates: ProcessedUpdate[] = [];
    let processedCount = 0;

    for (const update of updates) {
      if (performance.now() - startTime > maxLightsUpdateTime) {
        if (Math.random() < 0.01) {
          console.warn(
            "Approaching maxLightsUpdateTime during light updates, continuing to ensure correctness"
          );
        }
        break;
      }

      const {
        update: { type, vx, vy, vz, rotation, yRotation, stage },
      } = update;

      if (vy < 0 || vy >= maxHeight) continue;

      const currentId = this.getVoxelAt(vx, vy, vz);
      const currentBlock = this.getBlockById(currentId);
      const newBlock = this.getBlockById(type);
      const currentRotation = this.getVoxelRotationAt(vx, vy, vz);
      const currentStage = this.getVoxelStageAt(vx, vy, vz);
      const newRotation = BlockRotation.encode(rotation, yRotation);

      const newValue = BlockUtils.insertAll(
        newBlock.id,
        newBlock.rotatable || newBlock.yRotatable ? newRotation : undefined,
        stage
      );
      this.attemptBlockCache(vx, vy, vz, newValue);

      this.setVoxelAt(vx, vy, vz, type);
      this.setVoxelStageAt(vx, vy, vz, stage);

      if (newBlock.rotatable || newBlock.yRotatable) {
        this.setVoxelRotationAt(vx, vy, vz, newRotation);
      }

      processedUpdates.push({
        voxel: [vx, vy, vz],
        oldId: currentId,
        newId: type,
        oldBlock: currentBlock,
        newBlock: newBlock,
        oldRotation: currentRotation,
        newRotation: this.getVoxelRotationAt(vx, vy, vz),
        oldStage: currentStage,
        stage: stage,
      });

      processedCount++;
    }
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

    return updates.slice(processedCount);
  };

  private processClientUpdates = () => {
    if (this.blockUpdatesQueue.length === 0 || this.isTrackingChunks) {
      return;
    }

    this.isTrackingChunks = true;

    const processUpdatesInIdleTime = () => {
      if (this.blockUpdatesQueue.length > 0) {
        const updates = this.blockUpdatesQueue.splice(
          0,
          this.options.maxUpdatesPerUpdate
        );

        const remainingUpdates = this.processLightUpdates(updates);

        this.blockUpdatesQueue.push(...remainingUpdates);

        this.blockUpdatesToEmit.push(
          ...updates
            .slice(
              0,
              this.options.maxUpdatesPerUpdate - remainingUpdates.length
            )
            .filter(({ source }) => source === "client")
            .map(({ update }) => update)
        );

        if (this.blockUpdatesQueue.length > 0) {
          requestAnimationFrame(processUpdatesInIdleTime);
          return;
        }
      }

      this.flushAccumulatedLightOps();
      this.isTrackingChunks = false;
      this.processDirtyChunks();
    };

    processUpdatesInIdleTime();
  };

  private processDirtyChunks = async () => {
    const dirtyKeys = this.meshPipeline.getDirtyKeys();
    if (dirtyKeys.length === 0) return;

    const maxConcurrentMeshJobs = this.options.maxMeshesPerUpdate || 4;
    const keysToProcess = dirtyKeys.slice(0, maxConcurrentMeshJobs);

    const meshPromises = keysToProcess.map(async (key) => {
      const { cx, cz, level } = MeshPipeline.parseKey(key);
      const generation = this.meshPipeline.startJob(key);

      try {
        await this.meshChunkLocally(cx, cz, level, generation);
      } finally {
        if (this.meshPipeline.needsRemesh(key)) {
          this.scheduleDirtyChunkProcessing();
        }
      }
    });

    await Promise.all(meshPromises);

    if (this.meshPipeline.hasDirtyChunks()) {
      this.scheduleDirtyChunkProcessing();
    }
  };

  private scheduleDirtyChunkProcessing = (() => {
    let scheduled = false;
    return () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        this.processDirtyChunks();
      });
    };
  })();

  private mergeLightOperations(
    existing: LightOperations,
    newOps: LightOperations
  ): LightOperations {
    return {
      removals: {
        sunlight: [...existing.removals.sunlight, ...newOps.removals.sunlight],
        red: [...existing.removals.red, ...newOps.removals.red],
        green: [...existing.removals.green, ...newOps.removals.green],
        blue: [...existing.removals.blue, ...newOps.removals.blue],
      },
      floods: {
        sunlight: [...existing.floods.sunlight, ...newOps.floods.sunlight],
        red: [...existing.floods.red, ...newOps.floods.red],
        green: [...existing.floods.green, ...newOps.floods.green],
        blue: [...existing.floods.blue, ...newOps.floods.blue],
      },
      hasOperations: true,
    };
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

    const colorData: {
      color: LightColor;
      removals: Coords3[];
      floods: LightNode[];
    }[] = [
      {
        color: "SUNLIGHT",
        removals: lightOps.removals.sunlight,
        floods: lightOps.floods.sunlight,
      },
      {
        color: "RED",
        removals: lightOps.removals.red,
        floods: lightOps.floods.red,
      },
      {
        color: "GREEN",
        removals: lightOps.removals.green,
        floods: lightOps.floods.green,
      },
      {
        color: "BLUE",
        removals: lightOps.removals.blue,
        floods: lightOps.floods.blue,
      },
    ];

    const batchId = this.lightBatchIdCounter++;
    const jobsForBatch: LightJob[] = [];

    colorData.forEach(({ color, removals, floods }) => {
      if (removals.length === 0 && floods.length === 0) return;

      const allVoxels = [...removals, ...floods.map((n) => n.voxel)];

      let minX = allVoxels[0][0];
      let minY = allVoxels[0][1];
      let minZ = allVoxels[0][2];
      let maxX = minX;
      let maxY = minY;
      let maxZ = minZ;

      for (const [x, y, z] of allVoxels) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        maxZ = Math.max(maxZ, z);
      }

      minX -= maxLightLevel;
      minZ -= maxLightLevel;
      maxX += maxLightLevel;
      maxZ += maxLightLevel;

      minX = Math.max(minX, minChunk[0] * chunkSize);
      minZ = Math.max(minZ, minChunk[1] * chunkSize);
      maxX = Math.min(maxX, (maxChunk[0] + 1) * chunkSize - 1);
      maxZ = Math.min(maxZ, (maxChunk[1] + 1) * chunkSize - 1);
      minY = Math.max(minY, 0);
      maxY = Math.min(maxY, maxHeight - 1);

      const boundingBox: BoundingBox = {
        min: [minX, minY, minZ],
        shape: [maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1],
      };

      const jobId = `light-${color}-${this.lightJobIdCounter++}`;
      jobsForBatch.push({
        jobId,
        color,
        lightOps: { removals, floods },
        boundingBox,
        startSequenceId,
        retryCount: 0,
        batchId,
      });
    });

    if (jobsForBatch.length === 0) return;

    this.lightJobQueue.push(...jobsForBatch);
    this.processNextLightBatch();
  }

  private processNextLightBatch() {
    if (this.lightJobQueue.length === 0) return;
    if (this.activeLightBatch !== null) return;

    const firstJob = this.lightJobQueue[0];
    const batchId = firstJob.batchId;

    const batchJobs: LightJob[] = [];
    while (
      this.lightJobQueue.length > 0 &&
      this.lightJobQueue[0].batchId === batchId
    ) {
      batchJobs.push(this.lightJobQueue.shift()!);
    }

    this.activeLightBatch = {
      batchId,
      startSequenceId: firstJob.startSequenceId,
      totalJobs: batchJobs.length,
      completedJobs: 0,
      results: [],
      jobs: batchJobs,
    };

    for (const job of batchJobs) {
      this.executeLightJob(job);
    }
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

    const chunksInSpace: string[] = [];
    for (let cx = minChunkX; cx <= maxChunkX; cx++) {
      for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
        chunksInSpace.push(ChunkUtils.getChunkName([cx, cz]));
      }
    }

    const relevantDeltas: Record<string, VoxelDelta[]> = {};
    chunksInSpace.forEach((chunkName) => {
      const allDeltas = this.voxelDeltas.get(chunkName) || [];
      const recentDeltas = allDeltas.filter(
        (d) => d.sequenceId > startSequenceId
      );

      if (recentDeltas.length > 0) {
        relevantDeltas[chunkName] = recentDeltas.map((delta) => ({
          ...delta,
          oldRotation: delta.oldRotation
            ? JSON.parse(JSON.stringify(delta.oldRotation))
            : undefined,
          newRotation: delta.newRotation
            ? JSON.parse(JSON.stringify(delta.newRotation))
            : undefined,
        }));
      }
    });

    const chunksData: (object | null)[] = [];
    const arrayBuffers: ArrayBuffer[] = [];

    for (let cx = minChunkX; cx <= maxChunkX; cx++) {
      for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
        const chunk = this.getChunkByCoords(cx, cz);

        if (chunk && chunk.isReady) {
          const [data, buffers] = chunk.serialize();
          chunksData.push(data);
          arrayBuffers.push(...buffers);
        } else {
          chunksData.push(null);
        }
      }
    }

    this.lightWorkerPool.addJob({
      message: {
        type: "batchOperations",
        jobId,
        color,
        boundingBox,
        chunksData,
        chunkGridDimensions: [
          maxChunkX - minChunkX + 1,
          maxChunkZ - minChunkZ + 1,
        ],
        chunkGridOffset: [minChunkX, minChunkZ],
        relevantDeltas,
        lightOps,
        options: this.options,
      },
      buffers: arrayBuffers,
      resolve: (result) => this.handleLightJobResult(job, result),
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
    batch.results.push({
      color: job.color,
      modifiedChunks: result.modifiedChunks,
      boundingBox: job.boundingBox,
    });
    batch.completedJobs++;

    if (batch.completedJobs < batch.totalJobs) {
      return;
    }

    this.applyBatchResults(batch);
    this.activeLightBatch = null;
    this.processNextLightBatch();

    if (this.lightJobQueue.length === 0 && this.activeLightBatch === null) {
      const resolvers = this.lightJobsCompleteResolvers.splice(0);
      resolvers.forEach((resolve) => resolve());
      this.processDirtyChunks();
    }
  }

  private applyBatchResults(batch: LightBatch) {
    const { maxHeight, subChunks, maxLightLevel } = this.options;
    const subChunkHeight = maxHeight / subChunks;

    const chunkResultsByColor = new Map<string, Map<LightColor, Uint32Array>>();
    const allChunkCoords = new Map<string, Coords2>();

    let globalMinY = maxHeight;
    let globalMaxY = 0;

    for (const result of batch.results) {
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

      for (const { coords, lights } of result.modifiedChunks) {
        const key = `${coords[0]},${coords[1]}`;
        allChunkCoords.set(key, coords);

        let colorMap = chunkResultsByColor.get(key);
        if (!colorMap) {
          colorMap = new Map();
          chunkResultsByColor.set(key, colorMap);
        }
        colorMap.set(result.color, lights);
      }
    }

    const minLevel = Math.floor(globalMinY / subChunkHeight);
    const maxLevel = Math.min(
      subChunks - 1,
      Math.floor(globalMaxY / subChunkHeight)
    );

    for (const [key, colorMap] of chunkResultsByColor) {
      const coords = allChunkCoords.get(key)!;
      const chunk = this.getChunkByCoords(coords[0], coords[1]);
      if (!chunk) continue;

      if (colorMap.size === 1) {
        const [color, lights] = colorMap.entries().next().value;
        this.mergeSingleColorResult(chunk, lights, color);
      } else {
        this.mergeMultiColorResults(chunk, colorMap);
      }

      chunk.isDirty = true;
      this.markChunkForRemeshLevels(coords, minLevel, maxLevel);
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
    colorMap: Map<LightColor, Uint32Array>
  ) {
    const currentLights = chunk.lights.data;
    const anyResult = colorMap.values().next().value;

    for (let i = 0; i < currentLights.length; i++) {
      let value = 0;

      const sunlightSource = colorMap.get("SUNLIGHT");
      if (sunlightSource) {
        value |= sunlightSource[i] & 0xf000;
      } else {
        value |= anyResult[i] & 0xf000;
      }

      const redSource = colorMap.get("RED");
      if (redSource) {
        value |= redSource[i] & 0x0f00;
      } else {
        value |= anyResult[i] & 0x0f00;
      }

      const greenSource = colorMap.get("GREEN");
      if (greenSource) {
        value |= greenSource[i] & 0x00f0;
      } else {
        value |= anyResult[i] & 0x00f0;
      }

      const blueSource = colorMap.get("BLUE");
      if (blueSource) {
        value |= blueSource[i] & 0x000f;
      } else {
        value |= anyResult[i] & 0x000f;
      }

      currentLights[i] = value;
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
    if (this.lightJobQueue.length === 0 && this.activeLightBatch === null) {
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

    const allVoxels = [
      ...lightOps.removals,
      ...lightOps.floods.map((n) => n.voxel),
    ];

    const affectedChunks = new Set<string>();
    allVoxels.forEach((voxel) => {
      const chunkCoords = ChunkUtils.mapVoxelToChunk(
        voxel,
        this.options.chunkSize
      );
      affectedChunks.add(ChunkUtils.getChunkName(chunkCoords));
    });

    affectedChunks.forEach((chunkName) => {
      const coords = ChunkUtils.parseChunkName(chunkName);
      this.markChunkForRemesh(coords as Coords2);
    });
  }

  private executeLightOperationsSyncAll(lightOps: LightOperations) {
    const colors: LightColor[] = ["SUNLIGHT", "RED", "GREEN", "BLUE"];
    colors.forEach((color) => {
      const key = color.toLowerCase() as "sunlight" | "red" | "green" | "blue";
      const removals = lightOps.removals[key];
      const floods = lightOps.floods[key];

      if (removals.length > 0 || floods.length > 0) {
        this.executeLightOperationsSync({ removals, floods }, color);
      }
    });
  }

  /**
   * Scaffold the server updates onto the network, including chunk requests and block updates.
   */
  private emitServerUpdates = () => {
    if (this.blockUpdatesToEmit.length === 0) {
      return;
    }

    const updates = this.blockUpdatesToEmit.splice(
      0,
      this.options.maxUpdatesPerUpdate
    );

    const processedUpdates = updates.map((update) => {
      const { type, rotation, yRotation, stage } = update;

      const block = this.getBlockById(type);

      let raw = 0;
      raw = BlockUtils.insertID(raw, type);

      if (
        (block.rotatable || block.yRotatable) &&
        (!isNaN(rotation) || !isNaN(yRotation))
      ) {
        raw = BlockUtils.insertRotation(
          raw,
          BlockRotation.encode(rotation, yRotation)
        );
      }

      if (stage !== undefined) {
        raw = BlockUtils.insertStage(raw, stage);
      }

      return {
        ...update,
        voxel: raw,
      };
    });

    this.packets.push({
      type: "UPDATE",
      bulkUpdate: {
        vx: processedUpdates.map((u) => u.vx),
        vy: processedUpdates.map((u) => u.vy),
        vz: processedUpdates.map((u) => u.vz),
        voxels: processedUpdates.map((u) => u.voxel),
        lights: processedUpdates.map(() => 0),
      },
    });
  };

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
      lightReduce: boolean
    ) => {
      const mat = this.makeShaderMaterial();

      mat.side = transparent ? DoubleSide : FrontSide;
      mat.transparent = transparent;
      if (transparent) {
        mat.depthWrite = isFluid ? false : true;
        mat.alphaTest = 0.1;
      }
      mat.map = map;
      mat.uniforms.map.value = map;
      mat.userData.skipShadow = isFluid || (transparent && !lightReduce);

      return mat;
    };

    const blocks = Array.from(this.registry.blocksById.values());

    const textureGroups = new Set<string>();
    let ungroupedFaces = 0;
    for (const block of blocks) {
      for (const face of block.faces) {
        if (face.independent || face.isolated) continue;
        if (face.textureGroup) {
          textureGroups.add(face.textureGroup);
        } else {
          ungroupedFaces++;
        }
      }
    }
    const totalSlots = textureGroups.size + ungroupedFaces;
    const countPerSide = perSide(totalSlots);
    const atlas = new AtlasTexture(countPerSide, textureUnitDimension);

    this.chunkRenderer.uniforms.atlasSize.value = countPerSide;

    blocks.forEach((block) => {
      const mat = make(
        block.isSeeThrough,
        atlas,
        block.isFluid,
        block.lightReduce
      );
      const key = this.makeChunkMaterialKey(block.id);
      this.chunkRenderer.materials.set(key, mat);

      block.faces.forEach((face) => {
        if (!face.independent || face.isolated) return;

        const independentMat = make(
          block.isSeeThrough,
          AtlasTexture.makeUnknownTexture(textureUnitDimension),
          block.isFluid,
          block.lightReduce
        );
        const independentKey = this.makeChunkMaterialKey(block.id, face.name);
        this.chunkRenderer.materials.set(independentKey, independentMat);
      });
    });
  }

  private makeChunkMaterialKey(id: number, faceName?: string, voxel?: Coords3) {
    return voxel
      ? `${id}-${faceName}-${voxel.join("-")}`
      : faceName
      ? `${id}-${faceName}`
      : `${id}`;
  }

  private trackChunkAt(vx: number, vy: number, vz: number) {
    if (!this.isTrackingChunks) return;
    const { chunkSize, maxHeight, subChunks } = this.options;

    const voxel = [vx | 0, vy | 0, vz | 0] as Coords3;
    const [cx, cz] = ChunkUtils.mapVoxelToChunk(voxel, chunkSize);
    const [lcx, , lcz] = ChunkUtils.mapVoxelToChunkLocal(voxel, chunkSize);

    const subChunkHeight = maxHeight / subChunks;
    const level = Math.floor(vy / subChunkHeight);

    const chunkCoordsList: Coords2[] = [];
    chunkCoordsList.push([cx, cz]);

    if (lcx === 0) chunkCoordsList.push([cx - 1, cz]);
    if (lcz === 0) chunkCoordsList.push([cx, cz - 1]);
    if (lcx === 0 && lcz === 0) chunkCoordsList.push([cx - 1, cz - 1]);
    if (lcx === chunkSize - 1) chunkCoordsList.push([cx + 1, cz]);
    if (lcz === chunkSize - 1) chunkCoordsList.push([cx, cz + 1]);
    if (lcx === chunkSize - 1 && lcz === chunkSize - 1)
      chunkCoordsList.push([cx + 1, cz + 1]);

    const levels: number[] = [];

    if (vy % subChunkHeight === 0 && level > 0) {
      levels.push(level - 1);
    } else if (
      vy % subChunkHeight === subChunkHeight - 1 &&
      level < subChunks
    ) {
      levels.push(level + 1);
    }
    levels.push(level);

    for (const [chunkX, chunkZ] of chunkCoordsList) {
      for (const lvl of levels) {
        this.meshPipeline.onVoxelChange(chunkX, chunkZ, lvl);
      }
    }
  }

  private recordVoxelDelta(
    px: number,
    py: number,
    pz: number,
    deltaData: Partial<Omit<VoxelDelta, "coords" | "timestamp" | "sequenceId">>
  ) {
    const chunkName = ChunkUtils.getChunkName(
      ChunkUtils.mapVoxelToChunk(
        [px | 0, py | 0, pz | 0],
        this.options.chunkSize
      )
    );

    const delta: VoxelDelta = {
      coords: [px | 0, py | 0, pz | 0],
      oldVoxel: deltaData.oldVoxel ?? 0,
      newVoxel: deltaData.newVoxel ?? 0,
      oldRotation: deltaData.oldRotation,
      newRotation: deltaData.newRotation,
      oldStage: deltaData.oldStage,
      newStage: deltaData.newStage,
      timestamp: performance.now(),
      sequenceId: this.deltaSequenceCounter++,
    };

    const deltas = this.voxelDeltas.get(chunkName) || [];
    deltas.push(delta);
    this.voxelDeltas.set(chunkName, deltas);
  }

  private markChunkForRemesh(coords: Coords2) {
    const { subChunks } = this.options;
    this.markChunkForRemeshLevels(coords, 0, subChunks - 1);
  }

  private markChunkForRemeshLevels(
    coords: Coords2,
    minLevel: number,
    maxLevel: number
  ) {
    for (let level = minLevel; level <= maxLevel; level++) {
      this.meshPipeline.onVoxelChange(coords[0], coords[1], level);
    }
  }

  private markChunkAndNeighborsForMeshing(cx: number, cz: number) {
    const { subChunks } = this.options;
    const neighborOffsets = [
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

    for (const [dx, dz] of neighborOffsets) {
      const nx = cx + dx;
      const nz = cz + dz;
      const neighborChunk = this.getChunkByCoords(nx, nz);

      if (!neighborChunk || !neighborChunk.isReady) {
        continue;
      }

      const allNeighborsReady = neighborOffsets.every(([ddx, ddz]) => {
        const nnx = nx + ddx;
        const nnz = nz + ddz;
        if (!this.isWithinWorld(nnx, nnz)) return true;
        const nn = this.getChunkByCoords(nnx, nnz);
        return nn && nn.isReady;
      });

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
