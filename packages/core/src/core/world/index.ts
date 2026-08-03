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
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Camera,
  CanvasTexture,
  Timer,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  Frustum,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  Sphere,
  Texture,
  MathUtils as ThreeMathUtils,
  Uniform,
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
  prepareTransparentMesh,
  sortTransparentMesh,
} from "../../core/transparent-sorter";
import { BoundedLruMap, WorkerPool } from "../../libs";
import {
  getMeshTransferStatus,
  MeshTransferBenchmarkOptions,
  runMeshTransferBenchmark,
} from "../../libs/mesh-transfer-benchmark";
import { setWorkerInterval } from "../../libs/setWorkerInterval";
import {
  MeshTransferBenchmarkResult,
  WorkerTransfer,
  WorkerTransferMode,
} from "../../libs/worker-transfer";
import { Coords2, Coords3 } from "../../types";
import {
  BlockUtils,
  ChunkUtils,
  LightColor,
  ThreeUtils,
  findSimilar,
  formatSuggestion,
} from "../../utils";

function computeNormalsFromBuffers(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
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
    new BufferAttribute(computeNormalsFromBuffers(pos, idx.array), 3),
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
import {
  CustomChunkShaderMaterial,
  SHARED_OPAQUE_MATERIAL_KEY,
  loadChunkMaterials,
  makeChunkMaterialKey,
  makeChunkShaderMaterial,
} from "./chunk-materials";
import { ChunkRegionArenas } from "./chunk-region-arenas";
import { ChunkRenderer, makeSceneColorTexture } from "./chunk-renderer";
import {
  ChunkRequestCandidate,
  compareChunkRequestPriority,
} from "./chunk-requests";
import { Clouds } from "./clouds";
import { CSMRenderer, ENTITY_SHADOW_DISTANCE } from "./csm-renderer";
import { DeferredBlockEntityUpdateController } from "./deferred-block-entity-updates";
import { ItemDef, ItemRegistry } from "./items";
import { LightCones } from "./light-cones";
import {
  LightBatch,
  LightJob,
  LightNode,
  LightOperations,
  LightWorkerResult,
  ProcessedUpdate,
  analyzeLightOperations,
  buildLightJobs,
  floodLight,
  mergeLightOperations,
  mergeSingleColorResult,
  removeLight,
  removeLightsBatch,
} from "./lighting";
import type { BoundingBox } from "./lighting";
import { Loader } from "./loader";
import { MemoryPressureMonitor, MemoryPressureStatus } from "./memory-pressure";
import { ChunkPipeline, MeshPipeline } from "./pipelines";
import { Registry } from "./registry";
import {
  CONNECTIVITY_FULL,
  SectionVisibilityGraph,
} from "./section-visibility";
import { SHADER_LIGHTING_CHUNK_SHADERS } from "./shaders";
import { Sky } from "./sky";
import { AtlasTexture } from "./textures";
import { UV } from "./uv";
import { WATER_OPTICS, WaterOptics } from "./water-optics";
import LightWorker from "./workers/light-worker.ts?worker";
import MeshWorker from "./workers/mesh-worker.ts?worker";
import { WorldOptions, defaultWorldClientOptions } from "./world-options";

export * from "./block";
export * from "./chunk";
export * from "./chunk-materials";
export * from "./chunk-region-arenas";
export * from "./chunk-renderer";
export * from "./chunk-requests";
export * from "./clouds";
export * from "./csm-renderer";
export * from "./entity-shadow-uniforms";
export * from "./items";
export * from "./light-cones";
export * from "./lighting";
export * from "./loader";
export * from "./memory-pressure";
export * from "./pipelines";
export * from "./registry";
export * from "./section-visibility";
export * from "./shaders";
export * from "./shadow-sampling";
export * from "./sky";
export * from "./sky-fog";
export * from "./textures";
export * from "./uv";
export * from "./water-optics";
export * from "./world-options";

const warnedUnknownBlockIds = new Set<number>();
const warnedUnloadedUpdateChunks = new Set<string>();

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

export type WorldFogRange = {
  near: number;
  far: number;
};

export type BlockUpdateListener = (args: {
  oldValue: number;
  newValue: number;
  voxel: Coords3;
  source: "client" | "server";
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
  args: BlockEntityUpdateData<T>,
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

/**
 * A snapshot of every queue and in-flight set in the voxel update ->
 * relight -> remesh pipeline. See {@link World.getMemoryCounters}.
 */
export type WorldMemoryCounters = {
  blockUpdatesQueue: number;
  blockUpdatesToEmit: number;
  lightJobQueue: number;
  activeLightBatchPendingJobs: number;
  activeLightBatchUndispatchedJobs: number;
  voxelHistoryVoxels: number;
  memoryPressure: MemoryPressureStatus;
  voxelDeltaChunks: number;
  voxelDeltaTotal: number;
  meshQueue: number;
  meshWorking: number;
  meshQueuedBytes: number;
  urgentMeshQueue: number;
  urgentMeshWorking: number;
  urgentMeshQueuedBytes: number;
  lightQueue: number;
  lightWorking: number;
  lightQueuedBytes: number;
  meshDirtyKeys: number;
  meshInFlightJobs: number;
  loadedChunks: number;
  lightJobHighWaterChunks: number;
};

/**
 * Cumulative cost of turning finished mesh results into live scene geometry
 * (`buildChunkMesh`), the main-thread half of every remesh. `bytes` counts the
 * geometry attribute payload applied, which is what the GPU upload scales
 * with. Cumulative since world init so a caller can difference two reads.
 */
export type MeshApplyStats = {
  count: number;
  totalMs: number;
  maxMs: number;
  bytes: number;
};

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
   * Configure and inspect mesh worker buffer transfer (transfer vs SharedArrayBuffer).
   */
  public readonly meshTransfer = {
    configure: (config: { mode?: WorkerTransferMode }) =>
      WorkerTransfer.configure(config),
    getMode: () => WorkerTransfer.getMode(),
    getStrategy: () => WorkerTransfer.getStrategy(),
    setStrategy: (strategy: "transfer" | "shared") =>
      WorkerTransfer.setStrategy(strategy),
    isSharedArrayBufferAvailable: () =>
      WorkerTransfer.isSharedArrayBufferAvailable(),
    getStatus: () => getMeshTransferStatus(),
    getStats: () => WorkerTransfer.getStats(),
    resetStats: () => WorkerTransfer.resetStats(),
    benchmark: (options: MeshTransferBenchmarkOptions) =>
      this.benchmarkMeshTransfer(options),
  };

  /**
   * Live sizes of every queue and in-flight set in the voxel update ->
   * relight -> remesh pipeline, plus the bytes of serialized chunk payloads
   * parked in worker queues. This is the memory-pressure dashboard for
   * debugging update-flood OOMs (mass terrain edits): sample it while
   * carving and watch which stage balloons.
   */
  getMemoryCounters(): WorldMemoryCounters {
    let voxelDeltaTotal = 0;
    this.voxelDeltas.forEach((deltas) => {
      voxelDeltaTotal += deltas.length;
    });

    return {
      blockUpdatesQueue: this.blockUpdatesQueue.length,
      blockUpdatesToEmit: this.blockUpdatesToEmit.length,
      lightJobQueue: this.lightJobQueue.length,
      activeLightBatchPendingJobs: this.activeLightBatch
        ? this.activeLightBatch.totalJobs - this.activeLightBatch.completedJobs
        : 0,
      activeLightBatchUndispatchedJobs:
        this.activeLightBatch?.pendingDispatch.length ?? 0,
      voxelHistoryVoxels: this.oldBlocks.size,
      memoryPressure: this.memoryPressureMonitor.getStatus(),
      voxelDeltaChunks: this.voxelDeltas.size,
      voxelDeltaTotal,
      meshQueue: this.meshWorkerPool.queue.length,
      meshWorking: this.meshWorkerPool.workingCount,
      meshQueuedBytes: this.meshWorkerPool.queuedBytes,
      urgentMeshQueue: this.urgentMeshWorkerPool.queue.length,
      urgentMeshWorking: this.urgentMeshWorkerPool.workingCount,
      urgentMeshQueuedBytes: this.urgentMeshWorkerPool.queuedBytes,
      lightQueue: this.lightWorkerPool.queue.length,
      lightWorking: this.lightWorkerPool.workingCount,
      lightQueuedBytes: this.lightWorkerPool.queuedBytes,
      meshDirtyKeys: this.meshPipeline.dirtyCount,
      meshInFlightJobs: this.meshPipeline.inFlightJobCount(),
      loadedChunks: this.chunkPipeline.loadedCount,
      lightJobHighWaterChunks: this.lightJobHighWaterChunks,
    };
  }

  /**
   * Chunk rendering state (materials, uniforms).
   */
  public chunkRenderer: ChunkRenderer;

  /**
   * Running cost of applying mesh results on the main thread; see
   * {@link MeshApplyStats}.
   */
  public meshApplyStats: MeshApplyStats = {
    count: 0,
    totalMs: 0,
    maxMs: 0,
    bytes: 0,
  };

  /**
   * Region buffer arenas batching the shared-opaque bucket, one
   * `BatchedMesh` per region; `null` until the first opaque section lands or
   * when {@link WorldClientOptions.regionArenas} disables batching.
   */
  public regionArenas: ChunkRegionArenas | null = null;

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
   * The camera-driven underwater optics state, updated via
   * {@link World.updateWaterOptics}.
   */
  public waterOptics = new WaterOptics();

  /**
   * Shared dynamic spot-cone lighting (flashlights, vehicle headlights).
   * The game rebuilds the cone list every frame; chunk materials bind these
   * uniforms at creation.
   */
  public lightCones = new LightCones();

  /**
   * The CSM (Cascaded Shadow Map) renderer for shader-based lighting.
   */
  public csmRenderer: CSMRenderer | null = null;

  private aabbOverrides = new Map<string, AABB[]>();
  private waterRefractionFrame = -1;
  private animatedAtlasTextures = new Set<AtlasTexture>();

  setAABBOverride = (voxel: Coords3, aabbs: AABB[]) => {
    this.aabbOverrides.set(ChunkUtils.getVoxelName(voxel), aabbs);
  };

  removeAABBOverride = (voxel: Coords3) => {
    this.aabbOverrides.delete(ChunkUtils.getVoxelName(voxel));
  };

  getAABBOverride = (voxel: Coords3): AABB[] | undefined => {
    return this.aabbOverrides.get(ChunkUtils.getVoxelName(voxel));
  };

  private syncSceneColorTexture(texture: Texture) {
    this.chunkRenderer.materials.forEach((material) => {
      const sceneColorUniform = material.uniforms.uSceneColor;
      if (sceneColorUniform) {
        sceneColorUniform.value = texture;
      }
    });

    this.chunkPipeline.forEachLoaded((chunk) => {
      chunk.group.traverse((object) => {
        if (!(object instanceof Mesh)) {
          return;
        }

        const material = object.material;
        if (
          material instanceof ShaderMaterial &&
          material.uniforms.uSceneColor
        ) {
          material.uniforms.uSceneColor.value = texture;
        }
      });
    });
  }

  private captureWaterRefraction(renderer: WebGLRenderer) {
    const {
      cameraSubmersion,
      sceneColor,
      sceneTextureSize,
      waterRefractionReady,
      waterRefractionStrength,
    } = this.chunkRenderer.uniforms;

    // Zero strength is a real kill switch: mark the capture stale so the
    // shader's refraction branch turns off, and skip the mid-frame
    // framebuffer copy (a full-pass stall on tile-based GPUs) entirely.
    if (waterRefractionStrength.value <= 0) {
      waterRefractionReady.value = 0;
      return;
    }

    // The refraction shader path is disabled while submerged, so skip the
    // framebuffer copy entirely; the threshold mirrors the shader's gate.
    if (cameraSubmersion.value >= 0.5) {
      return;
    }

    const renderTarget = renderer.getRenderTarget();
    const isSRGBSource =
      renderTarget !== null &&
      renderTarget.texture.colorSpace === SRGBColorSpace;

    let width: number;
    let height: number;
    if (renderTarget !== null) {
      width = Math.max(1, Math.floor(renderTarget.width));
      height = Math.max(1, Math.floor(renderTarget.height));
      sceneTextureSize.value.set(width, height);
    } else {
      const size = renderer.getDrawingBufferSize(sceneTextureSize.value);
      width = Math.max(1, Math.floor(size.x));
      height = Math.max(1, Math.floor(size.y));
    }

    // Past this many pixels the mid-pass copy's store + reload alone breaks
    // the frame budget (measured: fine at 7.5M, 33ms frames at 14.7M), so
    // high-density screens trade the subtle displacement for a stable 60fps.
    if (width * height > WATER_OPTICS.refractionMaxDrawingBufferPixels) {
      waterRefractionReady.value = 0;
      return;
    }

    const capture = sceneColor.value;
    const isCaptureSRGB = capture.colorSpace === SRGBColorSpace;

    if (
      capture.image.width !== width ||
      capture.image.height !== height ||
      isCaptureSRGB !== isSRGBSource
    ) {
      capture.dispose();
      const recreated = makeSceneColorTexture(width, height, isSRGBSource);
      sceneColor.value = recreated;
      sceneTextureSize.value.set(width, height);
      waterRefractionReady.value = 0;
      this.waterRefractionFrame = -1;
      this.syncSceneColorTexture(recreated);
      return;
    }

    const frame = renderer.info.render.frame;
    if (this.waterRefractionFrame === frame) {
      return;
    }

    renderer.copyFramebufferToTexture(sceneColor.value);
    waterRefractionReady.value = 1;
    this.waterRefractionFrame = frame;
  }

  private configureTransparentChunkMesh(
    mesh: Mesh,
    voxel: number,
    material: CustomChunkShaderMaterial,
  ) {
    const block = this.getBlockByIdSafe(voxel);
    const isFluid = block?.isFluid ?? false;
    const sortData = !material.depthWrite ? prepareTransparentMesh(mesh) : null;

    mesh.renderOrder = isFluid
      ? TRANSPARENT_FLUID_RENDER_ORDER
      : TRANSPARENT_RENDER_ORDER;

    if (sortData) {
      mesh.userData.transparentSortData = sortData;
    }

    if (sortData || isFluid) {
      mesh.onBeforeRender = (renderer, _scene, camera) => {
        if (sortData) {
          sortTransparentMesh(mesh, sortData, camera);
        }

        if (isFluid) {
          this.captureWaterRefraction(renderer);
        }
      };
    }

    this.csmRenderer?.addSkipShadowObject(mesh);
  }

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
  private oldBlocks: BoundedLruMap<string, number[]>;

  /**
   * Cache for block meshes created by makeBlockMesh with cached option.
   */
  private blockMeshCache = new Map<string, Group>();

  /**
   * The internal clock.
   */
  private timer = new Timer();

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
  private blockEntityUpdateListeners = new Set<BlockEntityUpdateListener<T>>();
  private deferredBlockEntityUpdates =
    new DeferredBlockEntityUpdateController();

  private blockUpdateListeners = new Set<BlockUpdateListener>();

  /**
   * The JSON data received from the world. Call `initialize` to initialize.
   */
  private initialData: any = null;
  private initialEntities: any = null;

  // Chunks with local data (processing or loaded) whose server-side interest
  // must be re-established after a rejoin, drained through the paced
  // chunk-request flow.
  private chunkRefreshQueue = new Set<string>();

  public extraInitData: Record<string, unknown> = {};

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

  /**
   * The chunk the player was in as of the last update, used to decide which
   * chunks are far enough away to skip their below-cutoff levels.
   */
  private centerChunk: Coords2 = [0, 0];

  /**
   * The altitude the player was at as of the last update. Culling depends on
   * it because the cut is only hidden while the deck lies between the eye and
   * it, which stops being true from underneath.
   */
  private centerY = 0;

  /**
   * Whether the cull is currently in effect. Held as state rather than derived
   * per call so it can lag the altitude that drives it; see
   * {@link updateDistantCullState}.
   */
  private distantCullHidden = false;

  /**
   * World Y each loaded chunk's meshes currently start at. A chunk first seen
   * from a distance sits at the cull altitude until the player comes close
   * enough to refine it down to `0`. Tracked here rather than read back off
   * `Chunk.meshes` because a level that meshes to nothing leaves no entry
   * there, and re-queueing those forever would be an invisible treadmill.
   */
  private chunkDetailFloor = new Map<string, number>();

  /**
   * The subset of {@link chunkDetailFloor} still holding terrain back, with the
   * coordinates needed to find it again. Kept apart so the refinement pass can
   * walk the chunks that actually owe geometry instead of sweeping the whole
   * loaded disc every frame looking for them.
   */
  private culledChunks = new Map<string, Coords2>();

  /** Scratch state for the per-chunk frustum cull; see {@link updateChunkVisibility}. */
  private chunkCullFrustum = new Frustum();
  private chunkCullMatrix = new Matrix4();
  private chunkCullBox = new Box3();
  private chunkCullCameraPosition = new Vector3();

  /**
   * Section traversal graph behind
   * {@link WorldClientOptions.isCullingChunksByOcclusion}; see
   * {@link SectionVisibilityGraph}.
   */
  private sectionVisibility: SectionVisibilityGraph | null = null;

  private meshWorkerPool!: WorkerPool;
  private urgentMeshWorkerPool!: WorkerPool;

  private lightWorkerPool!: WorkerPool;

  private textureLoaderLastMap: Record<string, Date> = {};

  private isTrackingChunks = false;
  private activeBlockUpdateSource: "client" | "server" | null = null;

  private blockUpdatesQueue: BlockUpdateWithSource[] = [];
  private blockUpdatesToEmit: BlockUpdate[] = [];

  private voxelDeltas = new Map<string, VoxelDelta[]>();

  /** Largest chunk count any single light job has serialized this session. */
  private lightJobHighWaterChunks = 0;
  private deltaSequenceCounter = 0;
  private cleanupDeltasInterval: number | null = null;
  private stopStatsSync: (() => void) | null = null;
  private isDisposed = false;

  private lightJobQueue: LightJob[] = [];
  private lightJobIdCounter = 0;
  private lightBatchIdCounter = 0;

  private static readonly warmColor = new Color(1.0, 0.95, 0.9);
  private static readonly coolColor = new Color(0.9, 0.95, 1.0);
  private static readonly nightColor = new Color(0.15, 0.18, 0.25);
  private static readonly MAX_SHADER_DELTA_SECONDS = 0.1;
  private static readonly WIND_DIRECTION_TIME_SCALE = 0.01;
  private static readonly WIND_DIRECTION_VARIATION_TIME_SCALE = 0.003;
  private static readonly WIND_DIRECTION_VARIATION_AMOUNT = 0.5;
  private static readonly WIND_OFFSET_UNITS_PER_SECOND = 0.05;

  private static readonly dayAmbient = new Color(0.42, 0.42, 0.43);
  private static readonly nightAmbient = new Color(0.12, 0.15, 0.22);
  private lightJobsCompleteResolvers: (() => void)[] = [];
  private activeLightBatch: LightBatch | null = null;
  private memoryPressureMonitor: MemoryPressureMonitor;

  private accumulatedLightOps: LightOperations | null = null;
  private accumulatedStartSequenceId = 0;
  private shaderTimeSeconds = 0;

  /**
   * Create a new Voxelize world.
   *
   * @param options The options to create the world.
   */
  constructor(options: Partial<WorldOptions> = {}) {
    super();

    // The world scene sits at the origin and never moves, and leaving its
    // matrix on auto is not free: `Object3D.updateMatrix` unconditionally
    // raises `matrixWorldNeedsUpdate`, so the root re-dirtied itself every
    // frame and forced a world-matrix recompute down every branch beneath it.
    // Static chunk meshes were paying for a transform they do not have,
    // thousands of times a frame. Anything that does move the root has to call
    // `updateMatrix()` itself, which is the trade this line makes.
    this.matrixAutoUpdate = false;

    // @ts-ignore
    const { statsSyncInterval } = (this.options = {
      ...defaultWorldClientOptions,
      ...options,
    });

    const maxMeshWorkers = Math.min(navigator.hardwareConcurrency ?? 4, 4);
    const { maxQueuedWorkerJobs } = this.options;

    this.oldBlocks = new BoundedLruMap(this.options.maxVoxelHistoryVoxels);

    this.meshWorkerPool = new WorkerPool(MeshWorker, {
      maxWorker: maxMeshWorkers,
      name: "mesh-worker",
      maxQueuedJobs: maxQueuedWorkerJobs,
    });

    this.urgentMeshWorkerPool = new WorkerPool(MeshWorker, {
      maxWorker: Math.max(
        1,
        Math.min(this.options.maxUrgentMeshWorkers, maxMeshWorkers),
      ),
      name: "mesh-worker-urgent",
      maxQueuedJobs: maxQueuedWorkerJobs,
    });

    this.lightWorkerPool = new WorkerPool(LightWorker, {
      maxWorker: this.options.maxLightWorkers,
      name: "light-worker",
      maxQueuedJobs: maxQueuedWorkerJobs,
    });

    this.memoryPressureMonitor = new MemoryPressureMonitor(
      this.options.memoryPressure,
    );
    this.memoryPressureMonitor.start((verdict, status) =>
      this.onMemoryPressureVerdict(verdict, status),
    );

    this.setupComponents();
    this.setupUniforms();
    this.startDeltaCleanup();

    // Fires at the start of every scene render (shadow cascades included),
    // which is the earliest point with a renderer in hand: animated atlas
    // frames queued since the last flush upload as small sub-rectangle
    // patches before any material binds the texture.
    this.onBeforeRender = (renderer) => {
      this.animatedAtlasTextures.forEach((texture) =>
        texture.flushAnimationPatches(renderer),
      );
    };

    this.stopStatsSync = setWorkerInterval(() => {
      this.packets.push({
        type: "METHOD",
        method: {
          name: "vox-builtin:get-stats",
          payload: {},
        },
      });
    }, statsSyncInterval);
  }

  dispose = () => {
    if (this.isDisposed) return;
    this.isDisposed = true;

    this.meshWorkerPool.terminate();
    this.urgentMeshWorkerPool.terminate();
    this.lightWorkerPool.terminate();
    this.memoryPressureMonitor.stop();
    this.clouds.dispose();
    this.csmRenderer?.dispose();

    if (this.cleanupDeltasInterval !== null) {
      clearInterval(this.cleanupDeltasInterval);
      this.cleanupDeltasInterval = null;
    }
    this.stopStatsSync?.();
    this.stopStatsSync = null;

    this.lightJobQueue = [];
    this.activeLightBatch = null;
    this.oldBlocks.clear();
    this.lightJobsCompleteResolvers.splice(0).forEach((resolve) => resolve());

    this.chunkPipeline.forEachLoaded((chunk) => chunk.dispose());
    this.regionArenas?.dispose();
    this.regionArenas = null;
    this.sectionVisibility?.clear();
    this.chunkRenderer.materials.forEach((material) => {
      material.map?.dispose();
      material.dispose();
    });
    this.chunkRenderer.materials.clear();
    this.animatedAtlasTextures.clear();
  };

  /**
   * The renderer's heap is shared with every web worker, and a worker that
   * runs out of V8 heap takes the whole tab down with it. When the watchdog
   * says the heap is close to its limit, drop every piece of pipeline state
   * that can be rebuilt: queued worker payloads (the largest single
   * allocations in the client), light work that has not been serialized yet,
   * and the voxel history cache. Everything shed here is either retried
   * automatically or is pure cache, so the world stays correct — it just
   * catches up more slowly.
   */
  private onMemoryPressureVerdict(
    verdict: "shed" | "relieved",
    status: MemoryPressureStatus,
  ) {
    const heapMb = Math.round(status.heapUsedBytes / 1024 / 1024);
    const limitMb = Math.round(status.heapLimitBytes / 1024 / 1024);

    if (verdict === "relieved") {
      console.warn(
        `[world] renderer memory pressure relieved at ${heapMb}MB / ${limitMb}MB`,
      );
      return;
    }

    const droppedMeshJobs = this.meshWorkerPool.drainQueue();
    const droppedLightJobs = this.lightWorkerPool.drainQueue();
    const droppedPendingLightJobs = this.lightJobQueue.length;
    const droppedVoxelHistory = this.oldBlocks.size;

    this.lightJobQueue = [];
    this.accumulatedLightOps = null;
    this.accumulatedStartSequenceId = 0;
    this.oldBlocks.clear();

    console.warn(
      `[world] renderer memory pressure at ${heapMb}MB / ${limitMb}MB ` +
        `(${(status.heapRatio * 100).toFixed(1)}%, shed #${status.shedCount}); ` +
        `dropped ${droppedMeshJobs} queued mesh jobs, ${droppedLightJobs} queued ` +
        `light jobs, ${droppedPendingLightJobs} pending light jobs, ` +
        `${droppedVoxelHistory} voxel history entries`,
    );

    // Dropped light jobs leave nothing to wait on when no batch is running;
    // without this the waiters would hang until the next voxel edit.
    this.settleLightJobWaitersIfIdle();
  }

  private settleLightJobWaitersIfIdle() {
    if (this.lightJobQueue.length > 0 || this.activeLightBatch !== null) {
      return;
    }
    this.lightJobsCompleteResolvers.splice(0).forEach((resolve) => resolve());
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

  private async dispatchMeshWorker(
    cx: number,
    cz: number,
    level: number,
    isPriority = false,
  ): Promise<{
    geometries: GeometryProtocol[];
    connectivity: number;
  } | null> {
    const result = await this.dispatchMeshWorkerMeasured(cx, cz, level, {
      isRecordingStats: true,
      isPriority,
    });
    if (!result) return null;
    return { geometries: result.geometries, connectivity: result.connectivity };
  }

  private async dispatchMeshWorkerMeasured(
    cx: number,
    cz: number,
    level: number,
    options: { isRecordingStats: boolean; isPriority?: boolean },
  ): Promise<{
    geometries: GeometryProtocol[];
    connectivity: number;
    serializeMs: number;
    workerMs: number;
    inputBytes: number;
    outputBytes: number;
  } | null> {
    const strategy = WorkerTransfer.getStrategy();
    const serializeStart = performance.now();

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
      this.getChunkByCoords(cx + dx, cz + dz),
    );

    const centerChunk = chunks[4];
    if (!centerChunk) {
      return null;
    }

    const { min, max } = centerChunk;
    const heightPerSubChunk = Math.floor(
      this.options.maxHeight / this.options.subChunks,
    );
    // Raised to the chunk's cull line while it is distant, so the level the
    // line runs through meshes only its upper part and the ones entirely under
    // it produce nothing at all.
    const floorY = this.chunkDetailFloor.get(ChunkUtils.getChunkName([cx, cz]));
    const subChunkMin = [
      min[0],
      Math.max(heightPerSubChunk * level, floorY ?? 0),
      min[2],
    ];
    const subChunkMax = [max[0], heightPerSubChunk * (level + 1), max[2]];

    if (subChunkMin[1] >= subChunkMax[1]) {
      return {
        geometries: [],
        connectivity: CONNECTIVITY_FULL,
        serializeMs: 0,
        workerMs: 0,
        inputBytes: 0,
        outputBytes: 0,
      };
    }

    const chunksData: unknown[] = [];
    const arrayBuffers: ArrayBuffer[] = [];
    let inputBytes = 0;

    for (const chunk of chunks) {
      if (!chunk || !chunk.isReady) {
        chunksData.push(null);
        continue;
      }

      const [chunkData, chunkArrayBuffers] = chunk.serialize();

      chunksData.push(chunkData);
      arrayBuffers.push(...chunkArrayBuffers);
      inputBytes += chunk.voxels.data.byteLength + chunk.lights.data.byteLength;
    }

    const serializeMs = performance.now() - serializeStart;

    const data = {
      chunksData,
      options: this.options,
      min: subChunkMin,
      max: subChunkMax,
    };

    const name = ChunkUtils.getChunkName([cx, cz]);
    if (this.chunkPipeline.isInStage(name, "processing")) {
      return null;
    }

    const workerStart = performance.now();
    const meshWorkerPool = options.isPriority
      ? this.urgentMeshWorkerPool
      : this.meshWorkerPool;
    const workerResult = await new Promise<{
      geometries: GeometryProtocol[] | null;
      connectivity?: number;
    } | null>((resolve) => {
      meshWorkerPool.addJob({
        message: data,
        buffers: arrayBuffers,
        timeoutMs: this.options.meshJobTimeoutMs,
        resolve,
      });
    });
    // A crashed or poisoned worker resolves without geometries; surface it
    // as a failed job so the pipeline retries on a healthy worker instead
    // of leaving the chunk permanently invisible.
    if (!workerResult || !workerResult.geometries) {
      return null;
    }
    const { geometries } = workerResult;
    const workerMs = performance.now() - workerStart;
    const outputBytes = this.estimateGeometryProtocolBytes(geometries);

    if (options.isRecordingStats) {
      WorkerTransfer.recordSample({
        strategy,
        serializeMs,
        workerMs,
        totalMs: serializeMs + workerMs,
        inputBytes,
        outputBytes,
        at: Date.now(),
      });
    }

    if (this.chunkPipeline.isInStage(name, "processing")) {
      return null;
    }

    return {
      geometries,
      connectivity: workerResult.connectivity ?? CONNECTIVITY_FULL,
      serializeMs,
      workerMs,
      inputBytes,
      outputBytes,
    };
  }

  private estimateGeometryProtocolBytes(
    geometries: GeometryProtocol[],
  ): number {
    let bytes = 0;
    for (const geometry of geometries) {
      const record = geometry as GeometryProtocol & {
        positions?: ArrayBufferView;
        indices?: ArrayBufferView;
        uvs?: ArrayBufferView;
        lights?: ArrayBufferView;
        normals?: ArrayBufferView;
      };
      for (const key of [
        "positions",
        "indices",
        "uvs",
        "lights",
        "normals",
      ] as const) {
        const view = record[key];
        if (view?.buffer) {
          bytes += view.byteLength;
        }
      }
    }
    return bytes;
  }

  async benchmarkMeshTransfer(
    options: MeshTransferBenchmarkOptions,
  ): Promise<MeshTransferBenchmarkResult> {
    return runMeshTransferBenchmark(
      (cx, cz, level) =>
        this.dispatchMeshWorkerMeasured(cx, cz, level, {
          isRecordingStats: false,
        }),
      (cx, cz) => this.getChunkByCoords(cx, cz),
      options,
    );
  }

  private applyMeshResult(
    cx: number,
    cz: number,
    level: number,
    geometries: GeometryProtocol[],
    connectivity: number,
    generation?: number,
  ) {
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
      connectivity,
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

  async meshChunkLocally(
    cx: number,
    cz: number,
    level: number,
    generation?: number,
    isPriority = false,
  ) {
    const result = await this.dispatchMeshWorker(cx, cz, level, isPriority);
    if (!result) return;
    this.applyMeshResult(
      cx,
      cz,
      level,
      result.geometries,
      result.connectivity,
      generation,
    );
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
    source: string | Color | HTMLImageElement | Texture,
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
          data,
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
          const canvas = mat.map.image as HTMLCanvasElement;
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
            `Cannot apply texture to face "${face.name}" on block "${block.name}" because the source is not an image or a color.`,
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
    defaultDimension?: number,
  ) {
    const block = this.getBlockAt(...voxel);
    const idOrName = block.id;
    return this.applyBlockTextureAt(
      idOrName,
      faceName,
      AtlasTexture.makeUnknownTexture(
        defaultDimension ?? this.options.textureUnitDimension,
      ),
      voxel,
    );
  }

  private getOrCreateIsolatedBlockMaterial(
    blockId: number,
    position: Coords3,
    faceName: string,
    defaultDimension?: number,
  ) {
    return this.applyBlockTextureAt(
      blockId,
      faceName,
      AtlasTexture.makeUnknownTexture(
        defaultDimension ?? this.options.textureUnitDimension,
      ),
      position,
    );
  }

  applyBlockTextureAt(
    idOrName: number | string,
    faceName: string,
    source: string | Color | HTMLImageElement | Texture,
    voxel: Coords3,
  ) {
    const block = this.getBlockOf(idOrName);
    const faces = this.getBlockFacesByFaceNames(block.id, faceName);

    if (!faces || faces.length !== 1) {
      throw new Error(
        `Face(s) "${faceName}" does not exist on block "${block.name}" or there are multiple faces with the same name.`,
      );
    }

    const [face] = faces;
    if (!face.isolated) {
      throw new Error(
        `Cannot apply isolated texture to face "${face.name}" on block "${block.name}" because it is not isolated.`,
      );
    }

    const mat = this.getBlockFaceMaterial(block.id, face.name, voxel);
    const isolatedMat = mat || makeChunkShaderMaterial(this);

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
      const key = makeChunkMaterialKey(this, block.id, face.name, voxel);
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
    }[],
  ) {
    return Promise.all(
      data.map(({ idOrName, faceNames, source }) =>
        this.applyBlockTexture(idOrName, faceNames, source),
      ),
    );
  }

  async applyTextureGroup(
    groupName: string,
    source: string | Color | HTMLImageElement | Texture,
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
      firstEntry.face.name,
    );

    if (!mat) {
      console.warn(
        `No material found for texture group "${groupName}" (block ${firstEntry.blockId}, face ${firstEntry.face.name})`,
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
    }[],
  ) {
    return Promise.all(
      data.map(({ groupName, source }) =>
        this.applyTextureGroup(groupName, source),
      ),
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
    fadeFrames = 0,
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
        `Face(s) "${faceNames}" does not exist on block "${block.name}"`,
      );
    }

    blockFaces.forEach((face) => {
      const mat = this.getBlockFaceMaterial(block.id, face.name);

      // If the block's material is not set up to an atlas texture, we need to set it up.
      if (!(mat.map instanceof AtlasTexture)) {
        const image = mat.map.image as HTMLCanvasElement | HTMLImageElement;

        if (image && image.width) {
          const atlas = new AtlasTexture(1, image.width);
          atlas.drawImageToRange(face.range, image);

          mat.map.dispose();
          mat.map = atlas;
          mat.uniforms.map = { value: atlas };
          mat.needsUpdate = true;
        } else {
          throw new Error(
            `Cannot animate face "${face.name}" on block "${block.name}" because it does not have a texture.`,
          );
        }
      }

      // Register the animation. This will start the animation.
      (mat.map as AtlasTexture).registerAnimation(
        face.range,
        realKeyframes,
        fadeFrames,
      );
      this.animatedAtlasTextures.add(mat.map as AtlasTexture);
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
    interval = 66.666667,
  ) {
    this.checkIsInitialized("apply GIF animation", false);

    if (!source.endsWith(".gif")) {
      console.warn(
        "There's a chance that this file isn't a GIF as it doesn't end with .gif",
      );
    }

    // Load the keyframes from this GIF.
    const images = await this.loader.loadGifImages(source);

    const keyframes = images.map(
      (image) => [interval, image] as [number, HTMLImageElement],
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
        },
  ) {
    this.checkIsInitialized("apply resolution", false);

    const block = this.getBlockOf(idOrName);

    faceNames = Array.isArray(faceNames) ? faceNames : [faceNames];

    const blockFaces = this.getBlockFacesByFaceNames(block.id, faceNames);
    if (!blockFaces) {
      throw new Error(
        `Face(s) "${faceNames.join(", ")}" does not exist on block "${
          block.name
        }"`,
      );
    }

    for (const face of blockFaces) {
      if (!face.independent) {
        throw new Error(
          `Cannot apply resolution to face "${face.name}" on block "${block.name}" because it is not independent.`,
        );
      }

      const mat = this.getBlockFaceMaterial(block.id, face.name);
      const canvas = (mat.map.image ?? mat.map.source.data) as
        | HTMLCanvasElement
        | HTMLImageElement;

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
          `Cannot apply resolution to face "${face.name}" on block "${block.name}" because it does not have or has not loaded a texture.`,
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
        newYResolution,
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
    warnUnknown = false,
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
            `[Voxelize] Face "${fn}" not found on block "${block.name}".${suggestionText}`,
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
      this.options.chunkSize,
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
      this.trackChunkAt(px, py, pz);
    }
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
    rotation: BlockRotation,
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
      this.trackChunkAt(px, py, pz);
    }
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
      this.trackChunkAt(px, py, pz);
    }
  }

  /**
   * Whether the voxel at a 3D world position holds the world's waterlogging
   * fluid alongside its block.
   *
   * @param px The x coordinate of the position.
   * @param py The y coordinate of the position.
   * @param pz The z coordinate of the position.
   */
  getVoxelWaterloggedAt(px: number, py: number, pz: number) {
    this.checkIsInitialized("get voxel waterlogged", false);
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return false;
    return chunk.getVoxelWaterlogged(px, py, pz);
  }

  setVoxelWaterloggedAt(
    px: number,
    py: number,
    pz: number,
    isWaterlogged: boolean,
  ) {
    this.checkIsInitialized("set voxel waterlogged", false);
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return;
    chunk.setVoxelWaterlogged(px, py, pz, isWaterlogged);
  }

  /**
   * The level of waterlogging fluid held by the voxel at a 3D world position.
   *
   * @param px The x coordinate of the position.
   * @param py The y coordinate of the position.
   * @param pz The z coordinate of the position.
   */
  getVoxelWaterlogLevelAt(px: number, py: number, pz: number) {
    this.checkIsInitialized("get voxel waterlog level", false);
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return 0;
    return chunk.getVoxelWaterlogLevel(px, py, pz);
  }

  setVoxelWaterlogLevelAt(px: number, py: number, pz: number, level: number) {
    this.checkIsInitialized("set voxel waterlog level", false);
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return;
    chunk.setVoxelWaterlogLevel(px, py, pz, level);
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
    color: LightColor,
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
      1,
    );

    const torchR = Math.pow(red / this.options.maxLightLevel, 2);
    const torchG = Math.pow(green / this.options.maxLightLevel, 2);
    const torchB = Math.pow(blue / this.options.maxLightLevel, 2);
    const torchAttenuation = 1.0 - s * 0.8;

    return new Color(
      s + torchR * torchAttenuation,
      s + torchG * torchAttenuation,
      s + torchB * torchAttenuation,
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

      if (block && !block.isEmpty) {
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

  /**
   * Remember the value a voxel held before this change, evicting the
   * least-recently-touched voxels once the cache is full. A session that
   * carves thousands of voxels would otherwise keep one string key and one
   * growing array per voxel it ever edited, forever.
   */
  private recordVoxelHistory(
    vx: number,
    vy: number,
    vz: number,
    oldValue: number,
  ) {
    const { maxVoxelHistoryPerVoxel } = this.options;
    if (maxVoxelHistoryPerVoxel <= 0) return;

    const name = ChunkUtils.getVoxelName([vx, vy, vz]);
    const history = this.oldBlocks.get(name) ?? [];

    history.push(oldValue);
    if (history.length > maxVoxelHistoryPerVoxel) {
      history.splice(0, history.length - maxVoxelHistoryPerVoxel);
    }

    this.oldBlocks.set(name, history);
  }

  getBlockOf(idOrName: number | string) {
    if (typeof idOrName === "number") {
      return this.getBlockById(idOrName);
    }

    return this.getBlockByName(idOrName.toLowerCase());
  }

  /**
   * Get the block type data by a block id. Unknown ids resolve to air
   * (logged once per id) so a server/client registry gap can never take
   * down meshing, lighting, or the agent bridge.
   *
   * @param id The block id.
   * @returns The block data for the given id, or air if it is unknown.
   */
  getBlockById(id: number) {
    const block = this.registry.blocksById.get(id);

    if (block) {
      return block;
    }

    if (!warnedUnknownBlockIds.has(id)) {
      warnedUnknownBlockIds.add(id);
      console.warn(
        `[world] Unknown block id ${id}; treating as air. The client registry is likely out of sync with the server.`,
      );
    }

    const air = this.registry.blocksById.get(0);
    if (!air) {
      throw new Error(
        "Block registry has no air block; world was never initialized.",
      );
    }

    return air;
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

  getBlockEntityIdAt(px: number, py: number, pz: number): string | null {
    this.checkIsInitialized("get block entity id", false);

    const vx = Math.floor(px);
    const vy = Math.floor(py);
    const vz = Math.floor(pz);
    const voxelName = ChunkUtils.getVoxelName([vx, vy, vz]);

    return this.blockEntitiesMap.get(voxelName)?.id || null;
  }

  setBlockEntityDataAt(
    px: number,
    py: number,
    pz: number,
    data: T,
    options?: { replace?: boolean },
  ) {
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
          ...(options?.replace ? {} : { isPartial: true }),
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
    cz: number,
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
    voxel?: Coords3,
  ) {
    this.checkIsInitialized("get material", false);

    const block = this.getBlockOf(idOrName);

    if (voxel && faceName && block.isolatedFaces.has(faceName)) {
      return this.chunkRenderer.materials.get(
        makeChunkMaterialKey(this, block.id, faceName, voxel),
      );
    }

    if (faceName && block.independentFaces.has(faceName)) {
      return this.chunkRenderer.materials.get(
        makeChunkMaterialKey(this, block.id, faceName),
      );
    }

    return this.chunkRenderer.materials.get(
      makeChunkMaterialKey(this, block.id),
    );
  }

  /**
   * The material bucket a geometry group lands in, mirroring
   * {@link getBlockFaceMaterial}'s resolution exactly. Geometry groups may
   * arrive keyed by face name without the face owning its own material — the
   * fluid mesher emits per-direction groups (`py`, `px`, ...) for water whose
   * registry faces are not independent, and they all resolve to the one fluid
   * material. Keying meshes by this bucket instead of the raw face name lets
   * those groups merge into a single mesh per chunk rather than five.
   */
  private getChunkMaterialBucket(
    voxel: number,
    faceName?: string,
    at?: Coords3,
  ) {
    const block = this.getBlockById(voxel);

    if (at && faceName && block.isolatedFaces.has(faceName)) {
      return makeChunkMaterialKey(this, voxel, faceName, at);
    }

    if (faceName && block.independentFaces.has(faceName)) {
      return makeChunkMaterialKey(this, voxel, faceName);
    }

    return makeChunkMaterialKey(this, voxel);
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

        const materialKey = makeChunkMaterialKey(
          this,
          id,
          isIndependent || isIsolated ? face.name : undefined,
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
    listener: (chunk: Chunk) => void,
  ) => {
    const name = ChunkUtils.getChunkName(coords);

    const listeners = this.chunkInitializeListeners.get(name) || [];
    listeners.push(listener);
    this.chunkInitializeListeners.set(name, listeners);

    return () => {
      const current = this.chunkInitializeListeners.get(name);
      if (!current) return;
      const idx = current.indexOf(listener);
      if (idx !== -1) current.splice(idx, 1);
      if (current.length === 0) this.chunkInitializeListeners.delete(name);
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
    listener: WorldChunkEvents[K],
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
    listener: WorldChunkEvents[K],
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
    listener: WorldChunkEvents[K],
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
    data: Parameters<WorldChunkEvents[K]>[0],
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
    threshold: number,
  ) {
    const [cx, cz] = center;
    const [tx, tz] = target;
    const dx = cx - tx;
    const dz = cz - tz;

    const safeRadius = Math.max(this.renderRadius - 2, 1);
    if (dx * dx + dz * dz < safeRadius * safeRadius) {
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
    } = {},
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
            `Block of ID ${id} is dynamic but has no dynamic function.`,
          );
        }

        if (
          (isFluid && ignoreFluids) ||
          (isPassable && ignorePassables) ||
          (isSeeThrough && ignoreSeeThrough)
        ) {
          return [];
        }

        const vx = Math.floor(wx);
        const vy = Math.floor(wy);
        const vz = Math.floor(wz);

        if (this.aabbOverrides.size > 0) {
          const key = ChunkUtils.getVoxelName([vx, vy, vz]);
          const override = this.aabbOverrides.get(key);
          if (override) {
            return override;
          }
        }

        const rotation = this.getVoxelRotationAt(wx, wy, wz);

        if (dynamicPatterns && dynamicPatterns.length > 0) {
          const aabbsWithFlags = this.getBlockAABBsForDynamicPatterns(
            wx,
            wy,
            wz,
            dynamicPatterns,
          );
          return aabbsWithFlags.map(({ aabb, worldSpace }) =>
            worldSpace
              ? aabb.translate([vx, vy, vz])
              : rotation.rotateAABB(aabb).translate([vx, vy, vz]),
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
      maxDistance,
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
        block.dynamicPatterns,
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
    dynamicPatterns: BlockDynamicPattern[],
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
          },
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
                    (aabb as AABB).maxZ,
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
    defaultPassable: boolean,
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
          },
        );

        if (patternsMatched && typeof part.isPassable === "boolean") {
          return part.isPassable;
        }
      }
    }

    return defaultPassable;
  };

  getBlockFacesForDynamicPatterns = (
    blockId: number,
    dynamicPatterns: BlockDynamicPattern[],
  ): Block["faces"] => {
    const vx = 0,
      vy = 0,
      vz = 0;

    const simulatedGetVoxelAt = (x: number, y: number, z: number) =>
      x === vx && y === vy && z === vz ? blockId : 0;

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
          },
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
    },
  ) => {
    const {
      rotation = PY_ROTATION,
      yRotation = 0,
      stage = 0,
      source = "client",
    } = options;
    this.updateVoxels(
      [{ vx, vy, vz, type, rotation, yRotation, stage }],
      source,
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
  /**
   * Mirror of the server's placement rule so the player who places a block
   * into water does not watch a block-shaped air pocket for a round trip.
   * The server's echo is authoritative and overwrites whatever this guessed.
   */
  private predictWaterlogging({ vx, vy, vz, type }: BlockUpdate) {
    const current = this.getBlockAt(vx, vy, vz);
    if (!current) return null;

    const holdsFluid =
      current.isFluid || this.getVoxelWaterloggedAt(vx, vy, vz);
    const canHold = this.getBlockByIdSafe(type)?.isWaterloggable ?? false;
    if (!holdsFluid || !canHold) return null;

    const chunk = this.getChunkByPosition(vx, vy, vz);
    const level = chunk
      ? BlockUtils.extractFluidLevel(chunk.getRawValue(vx, vy, vz))
      : 0;
    return { isWaterlogged: true, waterlogLevel: level };
  }

  updateVoxels = (
    updates: BlockUpdate[],
    source: "client" | "server" = "client",
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

        if (!this.getBlockByIdSafe(type)) {
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

        if (update.isWaterlogged === undefined) {
          const predicted = this.predictWaterlogging(update);
          update.isWaterlogged = predicted?.isWaterlogged ?? false;
          update.waterlogLevel = predicted?.waterlogLevel ?? 0;
        }

        return update;
      });

    if (
      source === "client" &&
      voxelUpdates.length > this.options.maxOptimisticClientUpdates
    ) {
      // Bulk edit: the optimistic local path would relight and remesh for
      // minutes (or OOM the tab), and its 1000-per-frame trickle to the
      // server means a mid-edit reload silently loses the rest. Ship the
      // whole batch to the server now; the tick-batched echo brings the
      // world up to date through the incremental queue.
      for (
        let start = 0;
        start < voxelUpdates.length;
        start += this.options.maxUpdatesPerUpdate
      ) {
        this.pushBulkUpdatePacket(
          voxelUpdates.slice(start, start + this.options.maxUpdatesPerUpdate),
        );
      }
      return;
    }

    this.blockUpdatesQueue.push(
      ...voxelUpdates.map((update) => ({ source, update })),
    );

    this.processClientUpdates();
  };

  private convertServerUpdates(
    updates: UpdateProtocol[],
  ): BlockUpdateWithSource[] {
    const blockUpdates: BlockUpdateWithSource[] = [];

    for (const update of updates) {
      const { vx, vy, vz, voxel } = update;

      if (vy < 0 || vy >= this.options.maxHeight) continue;

      // Server updates are broadcast world-wide, including for chunks this
      // client has not loaded. There is nothing to write into yet (the chunk
      // snapshot will arrive with the update baked in), and running light
      // analysis against missing chunks would dereference null blocks.
      if (this.getChunkByPosition(vx, vy, vz) === undefined) {
        const chunkName = ChunkUtils.getChunkName(
          ChunkUtils.mapVoxelToChunk([vx, vy, vz], this.options.chunkSize),
        );
        if (!warnedUnloadedUpdateChunks.has(chunkName)) {
          warnedUnloadedUpdateChunks.add(chunkName);
          console.warn(
            `[world] Skipping server block update at (${vx}, ${vy}, ${vz}): chunk ${chunkName} is not loaded.`,
          );
        }
        continue;
      }

      const type = BlockUtils.extractID(voxel);
      const rotation = BlockUtils.extractRotation(voxel);
      const [rotationValue, yRotationValue] = BlockRotation.decode(rotation);
      const stage = BlockUtils.extractStage(voxel);
      const isWaterlogged = BlockUtils.extractWaterlogged(voxel);
      const waterlogLevel = BlockUtils.extractWaterlogLevel(voxel);

      const currentType = this.getVoxelAt(vx, vy, vz);
      const currentRotation = this.getVoxelRotationAt(vx, vy, vz);
      const currentStage = this.getVoxelStageAt(vx, vy, vz);
      const isCurrentWaterlogged = this.getVoxelWaterloggedAt(vx, vy, vz);
      const currentWaterlogLevel = this.getVoxelWaterlogLevelAt(vx, vy, vz);

      const needsUpdate =
        currentType !== type ||
        currentRotation.value !== rotation.value ||
        currentRotation.yRotation !== rotation.yRotation ||
        currentStage !== stage ||
        isCurrentWaterlogged !== isWaterlogged ||
        currentWaterlogLevel !== waterlogLevel;

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
            isWaterlogged,
            waterlogLevel,
          },
        });
      }
    }

    return blockUpdates;
  }

  /** Bulk server echoes (agent fills and large direct edits) drain through the
   * per-frame update queue so a 50k-voxel tick batch cannot freeze the
   * main thread the way a synchronous relight would. */
  private queueServerUpdates(updates: UpdateProtocol[]) {
    const blockUpdates = this.convertServerUpdates(updates);
    if (blockUpdates.length === 0) return;

    this.blockUpdatesQueue.push(...blockUpdates);
    this.processClientUpdates();
  }

  private applyServerUpdatesImmediately(updates: UpdateProtocol[]) {
    const blockUpdates = this.convertServerUpdates(updates);
    if (blockUpdates.length === 0) return;

    this.isTrackingChunks = true;

    let remaining = blockUpdates;
    while (remaining.length > 0) {
      remaining = this.processLightUpdates(remaining);
    }

    this.flushAccumulatedLightOps();
    this.isTrackingChunks = false;

    // Remesh immediately from the applied voxel data. Waiting on light
    // workers left broken blocks as ghost meshes whenever a light job
    // stalled or was still in flight — the voxel was already air (drops
    // spawned) but the chunk mesh never updated. Light completion still
    // remeshes again with corrected lighting via applyBatchResults.
    this.processDirtyChunks();
  }

  /**
   * Propagate light nodes outward through the loaded chunks. The algorithm
   * itself lives in {@link "./lighting"} and senses the world through the
   * {@link VoxelLightVolume} slice this class satisfies.
   */
  floodLight(
    queue: LightNode[],
    color: LightColor,
    min?: Coords3,
    max?: Coords3,
  ) {
    floodLight(this, queue, color, min, max);
  }

  public removeLight(voxel: Coords3, color: LightColor) {
    removeLight(this, voxel, color);
  }

  /**
   * Batch remove light from multiple voxels that previously emitted the same light color.
   * This drastically improves performance when many contiguous light sources are removed at once.
   */
  public removeLightsBatch(voxels: Coords3[], color: LightColor) {
    removeLightsBatch(this, voxels, color);
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
    }> = {},
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
                this.options.textureUnitDimension,
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
          uv[1] * (endV - startV) + startV,
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
        new Float32BufferAttribute(positions, 3),
      );
      geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      computeFlatNormals(geometry);
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
              this.options.textureUnitDimension,
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
          v0 + uvAttr.getY(j) * (v1 - v0),
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
          posAttr.getZ(j) + (Math.random() - 0.5) * jitter,
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
      vertexShader: SHADER_LIGHTING_CHUNK_SHADERS.vertex,
      fragmentShader: SHADER_LIGHTING_CHUNK_SHADERS.fragment,
      uniforms: {},
    },
  ) => {
    this.checkIsInitialized("customize material shaders", false);

    const {
      vertexShader = SHADER_LIGHTING_CHUNK_SHADERS.vertex,
      fragmentShader = SHADER_LIGHTING_CHUNK_SHADERS.fragment,
      uniforms = {},
    } = data;

    const mat = this.getBlockFaceMaterial(idOrName, faceName);

    if (!mat) {
      throw new Error(
        `Could not find material for block ${idOrName} and face ${faceName}`,
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
    fn: Block["dynamicFn"],
  ) => {
    this.checkIsInitialized("customize block dynamic", false);

    const block = this.getBlockOf(idOrName);

    if (!block) {
      throw new Error(
        `Block with ID ${idOrName} does not exist, could not overwrite dynamic function.`,
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
        "World has not received any initialization data from the server.",
      );
    }

    const { blocks, items, options, stats, ...extra } = this.initialData;
    this.extraInitData = extra;

    this._time = stats.time;

    // Loading the items registry
    if (items && Array.isArray(items)) {
      this.items.initialize(items as ItemDef[]);
    }

    // Loading the block registry
    Object.keys(blocks).forEach((name) => {
      const block = blocks[name];
      const { id, aabbs, isDynamic } = block;

      const lowerName = name.toLowerCase();

      block.independentFaces = new Set();
      block.isolatedFaces = new Set();
      if (typeof block.lightAttenuation !== "number") {
        block.lightAttenuation = 0;
      }

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
          new AABB(minX, minY, minZ, maxX, maxY, maxZ),
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
    this.options = {
      ...this.options,
      ...options,
    };

    // Only now are the server's chunk dimensions known; a graph keyed with
    // the client defaults would never find the camera's own section.
    this.sectionVisibility = this.options.isCullingChunksByOcclusion
      ? new SectionVisibilityGraph({
          subChunks: this.options.subChunks,
          chunkSize: this.options.chunkSize,
          maxHeight: this.options.maxHeight,
        })
      : null;

    if (typeof this.options.waterLevel === "number") {
      this.chunkRenderer.shaderLightingUniforms.waterLevel.value =
        this.options.waterLevel;
    }

    this.physics.options = this.options;

    if (!this.csmRenderer) {
      // The near cascade only spans ~14 blocks, so 2048 still gives it an
      // order of magnitude more texels per block than the far cascades; at
      // 4096 the own-character shadow refresh (a full cascade re-render
      // every third frame) was the single largest steady-state GPU cost at
      // high display resolutions.
      this.csmRenderer = new CSMRenderer({
        cascades: 3,
        shadowMapSize: 2048,
        farShadowMapSize: 2048,
        maxShadowDistance: 128,
        shadowBias: 0.00018,
        shadowNormalBias: 0.0015,
        shadowSlopeBiasScale: 0.0012,
        shadowSlopeBiasMin: 0.00012,
        shadowTopFaceBiasScale: 1.0,
        shadowSideFaceBiasScale: 1.0,
        lightMargin: 32,
      });
    }

    await loadChunkMaterials(this);

    const registryData = this.registry.serialize();
    this.meshWorkerPool.postMessage({ type: "init", registryData });
    this.urgentMeshWorkerPool.postMessage({ type: "init", registryData });
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
    direction: Vector3 = new Vector3(),
    camera?: Camera,
  ) {
    if (!this.isInitialized) {
      return;
    }

    this.timer.update();
    const delta = this.timer.getDelta();

    const center = ChunkUtils.mapVoxelToChunk(
      position.toArray() as Coords3,
      this.options.chunkSize,
    );
    if (this.options.doesTickTime) {
      this._time = (this.time + delta) % this.options.timePerDay;
    }

    const startOverall = performance.now();

    this.centerChunk = center;
    this.centerY = position.y;
    this.updateDistantCullState();

    const startMaintainChunks = performance.now();
    this.maintainChunks(center);
    const maintainChunksDuration = performance.now() - startMaintainChunks;

    const startRequestChunks = performance.now();
    this.requestChunks(center, direction);
    const requestChunksDuration = performance.now() - startRequestChunks;

    const startProcessChunks = performance.now();
    this.processChunks(center);
    const processChunksDuration = performance.now() - startProcessChunks;

    this.refineNearbyChunkDetail();

    if (camera) {
      this.updateChunkVisibility(camera);
    }

    const startUpdatePhysics = performance.now();
    this.updatePhysics(delta);
    const updatePhysicsDuration = performance.now() - startUpdatePhysics;

    const startUpdateUniforms = performance.now();
    this.updateUniforms(delta);
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
    >,
  ) {
    const { type } = message;

    switch (type) {
      case "INIT": {
        const { json, entities } = message;

        this.initialData = json;

        if (entities) {
          this.initialEntities = entities;
        }

        // An INIT on an already-initialized world is a rejoin after a
        // reconnect. The server process behind it may be brand new, holding
        // none of the chunks this client renders, so resync every chunk
        // stage: loaded/processing chunks re-register interest (entities
        // inside resume simulating) and in-flight requests are reissued
        // immediately instead of idling until the rerequest interval.
        if (this.isInitialized) {
          this.resyncChunkStagesAfterRejoin();
        }

        break;
      }
      case "ENTITY": {
        const { entities } = message;

        if (entities && entities.length) {
          if (!this.isInitialized) {
            this.initialEntities = [
              ...(this.initialEntities ?? []),
              ...entities,
            ];
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
        chunks.forEach((chunk) => {
          const { x, z } = chunk;
          this.chunkPipeline.markProcessing([x, z], "load", chunk);
        });

        break;
      }
      case "UPDATE": {
        const { updates } = message;

        if (updates && updates.length > 0) {
          if (updates.length > this.options.maxImmediateServerUpdates) {
            this.queueServerUpdates(updates);
          } else {
            this.applyServerUpdatesImmediately(updates);
          }
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
          metadata,
        );
        return;
      }

      const [px, py, pz] = metadata.voxel;
      const [vx, vy, vz] = [Math.floor(px), Math.floor(py), Math.floor(pz)];
      const voxelId = ChunkUtils.getVoxelName([vx, vy, vz]);

      const data: T | null = metadata.json ?? null;

      const originalData = this.blockEntitiesMap.get(voxelId) ?? null;
      this.blockEntityUpdateListeners.forEach((listener) => {
        const chunkCoords = ChunkUtils.mapVoxelToChunk(
          [vx, vy, vz],
          this.options.chunkSize,
        );
        const chunkName = ChunkUtils.getChunkName(chunkCoords);
        const chunk = this.chunkPipeline.getLoadedChunk(chunkName);
        const isChunkReady = this.isChunkReadyForEntityUpdates(chunk);
        const updateData: BlockEntityUpdateData<T> = {
          id,
          voxel: [vx, vy, vz],
          oldValue: originalData?.data ?? null,
          newValue: data as T | null,
          operation,
          etype: type,
        };

        if (operation !== "DELETE" && !isChunkReady) {
          this.deferBlockEntityUpdateUntilChunkReady(
            listener,
            chunkCoords,
            updateData,
          );
          return;
        }

        listener(updateData);
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
                  voxel,
                );
                if (material) {
                  material.dispose();
                  material.map?.dispose();
                }
                this.chunkRenderer.materials.delete(
                  makeChunkMaterialKey(this, block.id, face.name, voxel),
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

    const fogRange = this.getBaseFogRange();

    this.chunkRenderer.uniforms.fogNear.value = fogRange.near;
    this.chunkRenderer.uniforms.fogFar.value = fogRange.far;
  }

  getBaseFogRange(): WorldFogRange {
    const { chunkSize, fogNearRenderRatio, fogFarRenderRatio } = this.options;
    const renderDistance = this._renderRadius * chunkSize;

    return {
      near: renderDistance * fogNearRenderRatio,
      far: renderDistance * fogFarRenderRatio,
    };
  }

  get deleteRadius() {
    return this._deleteRadius;
  }

  private resyncChunkStagesAfterRejoin() {
    this.chunkRefreshQueue.clear();
    for (const name of this.chunkPipeline.resyncForRejoin()) {
      this.chunkRefreshQueue.add(name);
    }
  }

  private requestChunks(center: Coords2, direction: Vector3) {
    const {
      renderRadius,
      options: {
        chunkRerequestIntervalMs,
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
    const candidates: ChunkRequestCandidate[] = [];

    const renderRadiusSquared = renderRadius * renderRadius;

    for (let ox = -renderRadius; ox <= renderRadius; ox++) {
      for (let oz = -renderRadius; oz <= renderRadius; oz++) {
        const distanceSquared = ox * ox + oz * oz;
        if (distanceSquared > renderRadiusSquared) continue;

        const cx = centerX + ox;
        const cz = centerZ + oz;

        if (!this.isWithinWorld(cx, cz)) {
          continue;
        }

        const chunkName = ChunkUtils.getChunkName([cx, cz]);

        const stage = this.chunkPipeline.getStage(chunkName);

        if (stage === "loaded" || stage === "processing") {
          continue;
        }

        if (stage === "requested") {
          if (
            !this.chunkPipeline.isRequestStale(
              chunkName,
              chunkRerequestIntervalMs,
            )
          ) {
            continue;
          }

          // The request is considered lost; drop the stage so the chunk is
          // reissued below.
          this.chunkPipeline.remove(chunkName);
        }

        // The view cone is a priority, not a filter: in-view chunks stream
        // first, but out-of-view chunks still consume any leftover budget.
        const isInView =
          !hasDirection ||
          this.isChunkInView(center, [cx, cz], direction, angleThreshold);

        candidates.push({ cx, cz, distanceSquared, isInView });
      }
    }

    candidates.sort(compareChunkRequestPriority);

    const toRequest = candidates
      .slice(0, maxChunkRequestsPerUpdate)
      .map(({ cx, cz }) => [cx, cz]);

    // Drain rejoin refreshes with the same per-update budget. These chunks
    // keep their local data; the request only re-registers server-side
    // interest and pulls fresh data for them.
    const refreshBatch: number[][] = [];
    let refreshBudget = maxChunkRequestsPerUpdate - toRequest.length;
    for (const name of this.chunkRefreshQueue) {
      if (refreshBudget <= 0) break;
      this.chunkRefreshQueue.delete(name);
      if (!this.chunkPipeline.getStage(name)) continue;
      refreshBatch.push(ChunkUtils.parseChunkName(name) as number[]);
      refreshBudget -= 1;
    }

    if (toRequest.length || refreshBatch.length) {
      this.packets.push({
        type: "LOAD",
        json: {
          center,
          direction: new Vector2(direction.x, direction.z)
            .normalize()
            .toArray(),
          chunks: [...toRequest, ...refreshBatch],
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
        this.chunkInitializeListeners.delete(chunk.name);
        listeners.slice().forEach((listener) => listener(chunk));
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
      this.sectionVisibility?.addChunk(x, z);

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

  private isChunkReadyForEntityUpdates(
    chunk: Chunk | undefined,
  ): chunk is Chunk {
    return !!chunk && chunk.meshes.size > 0;
  }

  private deferBlockEntityUpdateUntilChunkReady(
    listener: BlockEntityUpdateListener<T>,
    chunkCoords: Coords2,
    updateData: BlockEntityUpdateData<T>,
  ) {
    const chunkName = ChunkUtils.getChunkName(chunkCoords);

    this.deferredBlockEntityUpdates.defer({
      chunkName,
      timeoutMs: 3000,
      shouldApplyOnTimeout: () => {
        const chunk = this.chunkPipeline.getLoadedChunk(chunkName);
        return this.isChunkReadyForEntityUpdates(chunk);
      },
      onApply: () => listener(updateData),
      bindChunkInit: (onChunkReady) =>
        this.addChunkInitListener(chunkCoords, () => onChunkReady()),
    });
  }

  private pruneBlockEntitiesInChunk(chunkCoords: Coords2) {
    const { chunkSize } = this.options;

    for (const key of this.blockEntitiesMap.keys()) {
      const parts = key.split("|");
      const vx = parseInt(parts[0], 10);
      const vz = parseInt(parts[2], 10);
      const cx = Math.floor(vx / chunkSize);
      const cz = Math.floor(vz / chunkSize);

      if (cx === chunkCoords[0] && cz === chunkCoords[1]) {
        this.blockEntitiesMap.delete(key);
      }
    }
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

        this.pruneBlockEntitiesInChunk(chunk.coords);
        this.regionArenas?.clearChunk(x, z);
        this.sectionVisibility?.removeChunk(x, z);
        this.remove(chunk.group);
        chunk.dispose();
        this.meshPipeline.remove(x, z);
        this.chunkDetailFloor.delete(name);
        this.culledChunks.delete(name);
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
      this.deferredBlockEntityUpdates.cancelChunk(name);
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
    newValue: number,
    source: "client" | "server",
  ) {
    this.blockUpdateListeners.forEach((listener) =>
      listener({
        voxel: [vx, vy, vz],
        oldValue,
        newValue,
        source,
      }),
    );
  }

  private attemptBlockCache(
    vx: number,
    vy: number,
    vz: number,
    newVal: number,
    source: "client" | "server",
  ) {
    const chunk = this.getChunkByPosition(vx, vy, vz);
    if (!chunk) return;

    const oldVal = chunk.getRawValue(vx, vy, vz);

    if (oldVal !== newVal) {
      this.recordVoxelHistory(vx, vy, vz, oldVal);
      this.triggerBlockUpdateListeners(vx, vy, vz, oldVal, newVal, source);
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
        this.options.chunkSize,
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
              : 0.0,
    );

    this.chunkRenderer.uniforms.sunlightIntensity.value = sunlightIntensity;

    // Dim the clouds toward night. Scaled from the authored colour rather than
    // assigned from the sunlight directly: assigning drives lightness to a flat
    // 1.0 at midday, which forces every cloud to pure white whatever colour it
    // was given and saturates its shading away.
    const cloudColor = this.clouds.material.uniforms.uCloudColor.value;
    const cloudBase = this.clouds.baseColorHSL;
    cloudColor.setHSL(
      cloudBase.h,
      cloudBase.s,
      cloudBase.l * ThreeMathUtils.clamp(sunlightIntensity, 0, 1),
    );

    const fogColor = this.chunkRenderer.uniforms.fogColor.value;
    if (fogColor) {
      fogColor.copy(this.sky.uMiddleColor.value);
    }

    this.chunkRenderer.uniforms.skyFogTopColor.value.copy(
      this.sky.uTopColor.value,
    );
    this.chunkRenderer.uniforms.skyFogMiddleColor.value.copy(
      this.sky.uMiddleColor.value,
    );
    this.chunkRenderer.uniforms.skyFogBottomColor.value.copy(
      this.sky.uBottomColor.value,
    );
    this.chunkRenderer.uniforms.skyFogOffset.value = this.sky.uSkyOffset.value;
    this.chunkRenderer.uniforms.skyFogVoidOffset.value =
      this.sky.uVoidOffset.value;
    this.chunkRenderer.uniforms.skyFogDimension.value =
      this.sky.options.dimension;

    this.chunkRenderer.shaderLightingUniforms.skyTopColor.value.copy(
      this.sky.uTopColor.value,
    );
    this.chunkRenderer.shaderLightingUniforms.skyMiddleColor.value.copy(
      this.sky.uMiddleColor.value,
    );
  }

  /**
   * Update the uniform values.
   */
  private updateUniforms = (delta: number) => {
    const shaderDelta = Math.min(delta, World.MAX_SHADER_DELTA_SECONDS);
    this.shaderTimeSeconds += shaderDelta;

    const t = this.shaderTimeSeconds;
    this.chunkRenderer.uniforms.time.value = t * 1000;

    const windAngle =
      t * World.WIND_DIRECTION_TIME_SCALE +
      Math.sin(t * World.WIND_DIRECTION_VARIATION_TIME_SCALE) *
        World.WIND_DIRECTION_VARIATION_AMOUNT;
    this.chunkRenderer.uniforms.windDirection.value.set(
      Math.cos(windAngle),
      Math.sin(windAngle),
    );

    this.chunkRenderer.uniforms.windOffset.value.addScaledVector(
      this.chunkRenderer.uniforms.windDirection.value,
      this.chunkRenderer.uniforms.windSpeed.value *
        shaderDelta *
        World.WIND_OFFSET_UNITS_PER_SECOND,
    );
  };

  updateShaderLighting(camera: Camera, position: Vector3) {
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
        World.warmColor,
      );
      this.chunkRenderer.shaderLightingUniforms.ambientColor.value.lerpColors(
        World.dayAmbient,
        World.warmColor,
        (sunlightIntensity - 0.5) * 0.3,
      );
    } else if (sunlightIntensity > 0) {
      this.chunkRenderer.shaderLightingUniforms.sunColor.value.lerpColors(
        World.coolColor,
        World.warmColor,
        sunlightIntensity * 2,
      );
      this.chunkRenderer.shaderLightingUniforms.ambientColor.value.lerpColors(
        World.nightAmbient,
        World.dayAmbient,
        sunlightIntensity * 2,
      );
    } else {
      this.chunkRenderer.shaderLightingUniforms.sunColor.value.copy(
        World.nightColor,
      );
      this.chunkRenderer.shaderLightingUniforms.ambientColor.value.copy(
        World.nightAmbient,
      );
    }

    this.chunkRenderer.uniforms.sunlightIntensity.value = Math.max(
      0.05,
      sunlightIntensity,
    );
    this.chunkRenderer.shaderLightingUniforms.sunlightIntensity.value =
      sunlightIntensity;

    if (this.csmRenderer) {
      this.csmRenderer.update(
        camera,
        sunDirection.value,
        position,
        shadowStrength,
      );

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
        csmUniforms.uShadowMatrices[0],
      );
      this.chunkRenderer.shaderLightingUniforms.shadowMatrix1.value.copy(
        csmUniforms.uShadowMatrices[1],
      );
      this.chunkRenderer.shaderLightingUniforms.shadowMatrix2.value.copy(
        csmUniforms.uShadowMatrices[2],
      );

      this.chunkRenderer.shaderLightingUniforms.cascadeSplit0.value =
        csmUniforms.uCascadeSplits[0];
      this.chunkRenderer.shaderLightingUniforms.cascadeSplit1.value =
        csmUniforms.uCascadeSplits[1];
      this.chunkRenderer.shaderLightingUniforms.cascadeSplit2.value =
        csmUniforms.uCascadeSplits[2];
      this.chunkRenderer.shaderLightingUniforms.shadowBias.value =
        csmUniforms.uShadowBias;
      this.chunkRenderer.shaderLightingUniforms.shadowNormalBias.value =
        csmUniforms.uShadowNormalBias;
      this.chunkRenderer.shaderLightingUniforms.shadowSlopeBiasScale.value =
        csmUniforms.uShadowSlopeBiasScale;
      this.chunkRenderer.shaderLightingUniforms.shadowSlopeBiasMin.value =
        csmUniforms.uShadowSlopeBiasMin;
      this.chunkRenderer.shaderLightingUniforms.shadowTopFaceBiasScale.value =
        csmUniforms.uShadowTopFaceBiasScale;
      this.chunkRenderer.shaderLightingUniforms.shadowSideFaceBiasScale.value =
        csmUniforms.uShadowSideFaceBiasScale;

      this.chunkRenderer.shaderLightingUniforms.shadowStrength.value =
        shadowStrength;
    }
  }

  updateWaterOptics(cameraPosition: Vector3, deltaSeconds: number) {
    if (!this.isInitialized) return;

    this.waterOptics.update({
      isFluidAt: (vx, vy, vz) => {
        if (this.getVoxelWaterloggedAt(vx, vy, vz)) return true;
        const block = this.getBlockAt(vx, vy, vz);
        return !!block && block.isFluid;
      },
      cameraX: cameraPosition.x,
      cameraY: cameraPosition.y,
      cameraZ: cameraPosition.z,
      sunStrength: this.chunkRenderer.uniforms.sunlightIntensity.value,
      deltaSeconds,
    });

    const { uniforms } = this.chunkRenderer;
    uniforms.cameraSubmersion.value = this.waterOptics.submersion;
    uniforms.cameraWaterPlaneY.value = this.waterOptics.waterPlaneY;
    uniforms.underwaterAmbient.value.copy(this.waterOptics.ambientColor);

    this.sky.uUnderwaterAmbient.value.copy(this.waterOptics.ambientColor);
    this.sky.uUnderwaterFade.value = this.waterOptics.skyFade;
  }

  renderShadowMaps(
    renderer: WebGLRenderer,
    entities?: Object3D[],
    instancePools?: Group[],
  ) {
    if (!this.csmRenderer) return;

    if (
      (entities && entities.length > 0) ||
      (instancePools && instancePools.length > 0)
    ) {
      this.csmRenderer.markCascadesForEntityRender();
    }

    this.csmRenderer.render(
      renderer,
      this,
      entities,
      ENTITY_SHADOW_DISTANCE,
      instancePools,
    );

    // The cascade matrices move inside render(), atomically with the maps,
    // so the copies taken during update() are one write behind. Re-copy
    // after the maps land or the shader samples fresh frustums against
    // stale depths for a frame — a visible flash across the cascade band.
    const shadowMatrix0 = this.csmRenderer.getCascadeMatrix(0);
    if (shadowMatrix0) {
      this.chunkRenderer.shaderLightingUniforms.shadowMatrix0.value.copy(
        shadowMatrix0,
      );
    }
    const shadowMatrix1 = this.csmRenderer.getCascadeMatrix(1);
    if (shadowMatrix1) {
      this.chunkRenderer.shaderLightingUniforms.shadowMatrix1.value.copy(
        shadowMatrix1,
      );
    }
    const shadowMatrix2 = this.csmRenderer.getCascadeMatrix(2);
    if (shadowMatrix2) {
      this.chunkRenderer.shaderLightingUniforms.shadowMatrix2.value.copy(
        shadowMatrix2,
      );
    }
  }

  private buildChunkMesh(cx: number, cz: number, data: MeshProtocol) {
    const applyStart = performance.now();
    this.buildChunkMeshTimed(cx, cz, data);
    const applyMs = performance.now() - applyStart;
    this.meshApplyStats.count += 1;
    this.meshApplyStats.totalMs += applyMs;
    if (applyMs > this.meshApplyStats.maxMs) {
      this.meshApplyStats.maxMs = applyMs;
    }
    this.meshApplyStats.bytes += this.estimateGeometryProtocolBytes(
      data.geometries,
    );
  }

  private buildChunkMeshTimed(cx: number, cz: number, data: MeshProtocol) {
    const chunk = this.getChunkByCoords(cx, cz);
    if (!chunk) return;

    const { maxHeight, subChunks, chunkSize, mergeChunkGeometries } =
      this.options;
    const { level, geometries } = data;
    const heightPerSubChunk = Math.floor(maxHeight / subChunks);

    this.sectionVisibility?.setConnectivity(
      cx,
      cz,
      level,
      data.connectivity ?? CONNECTIVITY_FULL,
    );
    // Fresh meshes and arena slots default to visible; force the occlusion
    // walk to reapply this chunk's answer instead of trusting a stale mask.
    chunk.sectionVisibleMask = null;

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

    const isArenaBucketed = this.options.regionArenas !== null;
    const meshGeometries = isArenaBucketed
      ? geometries.filter((geo) => !this.isArenaGeometry(geo))
      : geometries;

    if (isArenaBucketed) {
      this.applyArenaSectionGeometry(
        cx,
        cz,
        level,
        geometries.filter((geo) => this.isArenaGeometry(geo)),
        heightPerSubChunk,
      );
    }

    if (geometries.length === 0) return;

    let meshes: Mesh[] = [];

    if (meshGeometries.length === 0) {
      // The arena owns everything in this section; fall through so the
      // section still counts as landed (group registration, load events,
      // cascade invalidation).
    } else if (mergeChunkGeometries) {
      const materialToGeometries = new Map<
        string,
        {
          geometry: BufferGeometry;
          material: CustomChunkShaderMaterial;
          voxel: number;
        }[]
      >();

      for (const geo of meshGeometries) {
        const { voxel, at, faceName, indices, lights, positions, uvs } = geo;
        const geometry = new BufferGeometry();

        geometry.setAttribute("position", new BufferAttribute(positions, 3));
        geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
        geometry.setAttribute("light", new BufferAttribute(lights, 1));
        geometry.setIndex(new BufferAttribute(indices, 1));
        if (geo.normals && geo.normals.length > 0) {
          geometry.setAttribute("normal", new BufferAttribute(geo.normals, 3));
        } else {
          computeFlatNormals(geometry);
        }

        let material = this.getBlockFaceMaterial(
          voxel,
          faceName,
          at && at.length ? at : undefined,
        );
        if (!material) {
          const block = this.getBlockById(voxel);
          const face = block.faces.find((face) => face.name === faceName);
          if (!face?.isolated || !at) continue;
          try {
            material = this.getOrCreateIsolatedBlockMaterial(
              voxel,
              at,
              faceName,
            );
          } catch {
            continue;
          }
        }
        const matKey = this.getChunkMaterialBucket(
          voxel,
          faceName,
          at && at.length ? at : undefined,
        );
        if (!materialToGeometries.has(matKey)) {
          materialToGeometries.set(matKey, []);
        }
        const arr = materialToGeometries.get(matKey);
        if (arr) arr.push({ geometry, material, voxel });
      }

      meshes = [];
      for (const [materialKey, geoMats] of materialToGeometries) {
        if (geoMats.length === 0) continue;

        const material = geoMats[0].material;
        const voxel = geoMats[0].voxel;
        const isSingleVoxelMesh = geoMats.every(
          ({ voxel: geometryVoxel }) => geometryVoxel === voxel,
        );

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
          cz * chunkSize,
        );
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;
        mesh.userData = {
          isChunk: true,
          merged: true,
          materialBucket: materialKey,
          voxel: isSingleVoxelMesh ? voxel : undefined,
          isPlant: isSingleVoxelMesh && this.isPlantVoxel(voxel),
        };
        if (material.transparent) {
          this.configureTransparentChunkMesh(mesh, voxel, material);
        }

        chunk.group.add(mesh);
        meshes.push(mesh);
      }
    } else {
      meshes = [];
      for (let i = 0; i < meshGeometries.length; i++) {
        const geo = meshGeometries[i];
        const { voxel, at, faceName, indices, lights, positions, uvs } = geo;
        const geometry = new BufferGeometry();

        geometry.setAttribute("position", new BufferAttribute(positions, 3));
        geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
        geometry.setAttribute("light", new BufferAttribute(lights, 1));
        geometry.setIndex(new BufferAttribute(indices, 1));
        if (geo.normals && geo.normals.length > 0) {
          geometry.setAttribute("normal", new BufferAttribute(geo.normals, 3));
        } else {
          computeFlatNormals(geometry);
        }
        if (geo.bsCenter && geo.bsRadius !== undefined) {
          geometry.boundingSphere = new Sphere(
            new Vector3(geo.bsCenter[0], geo.bsCenter[1], geo.bsCenter[2]),
            geo.bsRadius,
          );
        } else {
          geometry.computeBoundingSphere();
        }

        let material = this.getBlockFaceMaterial(
          voxel,
          faceName,
          at && at.length ? at : undefined,
        );
        if (!material) {
          const block = this.getBlockById(voxel);
          const face = block.faces.find((face) => face.name === faceName);

          if (!face?.isolated || !at) {
            console.warn("Unlikely situation happened...");
            continue;
          }

          try {
            material = this.getOrCreateIsolatedBlockMaterial(
              voxel,
              at,
              faceName,
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
          cz * chunkSize,
        );
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;
        mesh.userData = {
          isChunk: true,
          voxel,
          materialBucket: this.getChunkMaterialBucket(
            voxel,
            faceName,
            at && at.length ? at : undefined,
          ),
          isPlant: this.isPlantVoxel(voxel),
        };
        if (material.transparent) {
          this.configureTransparentChunkMesh(mesh, voxel, material);
        }

        chunk.group.add(mesh);
        meshes.push(mesh);
      }
    }

    if (!this.children.includes(chunk.group)) {
      this.add(chunk.group);
    }

    // The group holds its subtree's matrices back until told geometry landed,
    // and a mesh whose `matrixWorld` was never composed renders at the origin.
    chunk.group.updateMatrixWorld(true);

    // Fresh meshes default to visible, so a chunk beyond the plant radius has
    // to be re-asked rather than left believing it is already hidden.
    chunk.plantsShown = null;

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

  private isArenaGeometry(geo: MeshProtocol["geometries"][number]) {
    return (
      this.getChunkMaterialBucket(
        geo.voxel,
        geo.faceName,
        geo.at && geo.at.length ? geo.at : undefined,
      ) === SHARED_OPAQUE_MATERIAL_KEY
    );
  }

  private applyArenaSectionGeometry(
    cx: number,
    cz: number,
    level: number,
    geometries: MeshProtocol["geometries"],
    heightPerSubChunk: number,
  ) {
    const arenas = this.ensureRegionArenas();

    if (geometries.length === 0) {
      arenas.clearSection(cx, cz, level);
      return;
    }

    const parts: BufferGeometry[] = [];
    for (const geo of geometries) {
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(geo.positions, 3));
      geometry.setAttribute("uv", new BufferAttribute(geo.uvs, 2));
      geometry.setAttribute("light", new BufferAttribute(geo.lights, 1));
      geometry.setIndex(new BufferAttribute(geo.indices, 1));
      if (geo.normals && geo.normals.length > 0) {
        geometry.setAttribute("normal", new BufferAttribute(geo.normals, 3));
      } else {
        computeFlatNormals(geometry);
      }
      parts.push(geometry);
    }

    const merged =
      parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
    if (!merged) {
      console.error(
        `Chunk section ${cx},${cz} level ${level}: opaque geometries failed to merge; section dropped from the region arena.`,
      );
      for (const part of parts) part.dispose();
      arenas.clearSection(cx, cz, level);
      return;
    }

    const { chunkSize } = this.options;
    arenas.setSectionGeometry(
      cx,
      cz,
      level,
      merged,
      cx * chunkSize,
      level * heightPerSubChunk,
      cz * chunkSize,
    );

    merged.dispose();
    for (const part of parts) {
      if (part !== merged) part.dispose();
    }
  }

  get sectionVisibilityStats() {
    return this.sectionVisibility?.stats ?? null;
  }

  private ensureRegionArenas() {
    if (this.regionArenas) return this.regionArenas;

    const arenaOptions = this.options.regionArenas;
    if (!arenaOptions) {
      throw new Error(
        "Region arenas requested while WorldClientOptions.regionArenas is null.",
      );
    }

    const { subChunks } = this.options;
    this.regionArenas = new ChunkRegionArenas(
      arenaOptions,
      arenaOptions.regionSizeInChunks ** 2 * subChunks,
      () => {
        const material = this.chunkRenderer.materials.get(
          SHARED_OPAQUE_MATERIAL_KEY,
        );
        if (!material) {
          throw new Error(
            "Region arena created before chunk materials loaded.",
          );
        }
        return material;
      },
      this,
    );
    return this.regionArenas;
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

    this.csmRenderer = new CSMRenderer({
      cascades: 3,
      shadowMapSize: 4096,
      maxShadowDistance: 128,
      shadowBias: 0.00018,
      shadowNormalBias: 0.0015,
      shadowSlopeBiasScale: 0.0012,
      shadowSlopeBiasMin: 0.00012,
      shadowTopFaceBiasScale: 1.0,
      shadowSideFaceBiasScale: 1.0,
      lightMargin: 32,
    });

    const chunkUniforms = {
      ...this.chunkRenderer.uniforms,
      ...this.options.chunkUniformsOverwrite,
    };

    this.sky = new Sky(skyOptions);
    this.clouds = new Clouds({
      ...cloudsOptions,
      uFogColor: cloudsOptions.uFogColor ?? chunkUniforms.fogColor,
      uFogHeightOrigin:
        cloudsOptions.uFogHeightOrigin ?? chunkUniforms.fogHeightOrigin,
      uFogHeightDensity:
        cloudsOptions.uFogHeightDensity ?? chunkUniforms.fogHeightDensity,
      uSkyFogTopColor:
        cloudsOptions.uSkyFogTopColor ?? chunkUniforms.skyFogTopColor,
      uSkyFogMiddleColor:
        cloudsOptions.uSkyFogMiddleColor ?? chunkUniforms.skyFogMiddleColor,
      uSkyFogBottomColor:
        cloudsOptions.uSkyFogBottomColor ?? chunkUniforms.skyFogBottomColor,
      uSkyFogOffset: cloudsOptions.uSkyFogOffset ?? chunkUniforms.skyFogOffset,
      uSkyFogVoidOffset:
        cloudsOptions.uSkyFogVoidOffset ?? chunkUniforms.skyFogVoidOffset,
      uSkyFogExponent:
        cloudsOptions.uSkyFogExponent ?? chunkUniforms.skyFogExponent,
      uSkyFogExponent2:
        cloudsOptions.uSkyFogExponent2 ?? chunkUniforms.skyFogExponent2,
      uSkyFogDimension:
        cloudsOptions.uSkyFogDimension ?? chunkUniforms.skyFogDimension,
      uSkyFogStrength:
        cloudsOptions.uSkyFogStrength ?? chunkUniforms.skyFogStrength,
      uCloudEndFadeNear:
        cloudsOptions.uCloudEndFadeNear ?? chunkUniforms.fogNear,
      uCloudEndFadeFar: cloudsOptions.uCloudEndFadeFar ?? chunkUniforms.fogFar,
      uSunDirection:
        cloudsOptions.uSunDirection ??
        this.chunkRenderer.shaderLightingUniforms.sunDirection,
      uSunColor:
        cloudsOptions.uSunColor ??
        this.chunkRenderer.shaderLightingUniforms.sunColor,
      uSunlightIntensity:
        cloudsOptions.uSunlightIntensity ?? chunkUniforms.sunlightIntensity,
      uCameraSubmersion:
        cloudsOptions.uCameraSubmersion ?? chunkUniforms.cameraSubmersion,
      uCameraWaterPlaneY:
        cloudsOptions.uCameraWaterPlaneY ?? chunkUniforms.cameraWaterPlaneY,
      uUnderwaterAmbient:
        cloudsOptions.uUnderwaterAmbient ?? chunkUniforms.underwaterAmbient,
    });

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
            isPassable,
          );
          if (passable || isFluid) return [];

          const rotation = chunk.getVoxelRotation(vx, vy, vz);
          const aabbsWithFlags = this.getBlockAABBsForDynamicPatterns(
            vx,
            vy,
            vz,
            dynamicPatterns,
          );
          return aabbsWithFlags.map(({ aabb, worldSpace }) =>
            worldSpace
              ? aabb.translate([vx, vy, vz])
              : rotation.rotateAABB(aabb).translate([vx, vy, vz]),
          );
        }

        if (isPassable || isFluid) return [];

        const rotation = chunk.getVoxelRotation(vx, vy, vz);
        return aabbs.map((aabb) =>
          rotation.rotateAABB(aabb).translate([vx, vy, vz]),
        );
      },
      (vx: number, vy: number, vz: number) => {
        const chunk = this.getChunkByPosition(vx, vy, vz);
        if (!chunk) return false;

        if (chunk.getVoxelWaterlogged(vx, vy, vz)) return true;

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
          rotation.rotateAABB(aabb).translate([vx, vy, vz]),
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
      this.options,
    );
  }

  private setupUniforms() {
    const { minLightLevel } = this.options;

    this.chunkRenderer.uniforms.minLightLevel.value = minLightLevel;
  }

  setShowGreedyDebug(show: boolean) {
    this.chunkRenderer.uniforms.showGreedyDebug.value = show ? 1.0 : 0.0;
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
            "Approaching maxLightsUpdateTime during light updates, continuing to ensure correctness",
          );
        }
        break;
      }

      const {
        source,
        update: {
          type,
          vx,
          vy,
          vz,
          rotation,
          yRotation,
          stage,
          isWaterlogged,
          waterlogLevel,
        },
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
        stage,
        isWaterlogged,
        waterlogLevel,
      );
      this.attemptBlockCache(vx, vy, vz, newValue, source);

      this.activeBlockUpdateSource = source;
      try {
        this.setVoxelAt(vx, vy, vz, type);
        this.setVoxelStageAt(vx, vy, vz, stage);
        this.setVoxelWaterloggedAt(vx, vy, vz, isWaterlogged ?? false);
        this.setVoxelWaterlogLevelAt(vx, vy, vz, waterlogLevel ?? 0);

        if (newBlock.rotatable || newBlock.yRotatable) {
          this.setVoxelRotationAt(vx, vy, vz, newRotation);
        }
      } finally {
        this.activeBlockUpdateSource = null;
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
    const lightOps = analyzeLightOperations(this, processedUpdates);

    if (this.options.useLightWorkers && lightOps.hasOperations) {
      if (!this.accumulatedLightOps) {
        this.accumulatedLightOps = lightOps;
        this.accumulatedStartSequenceId = startSequenceId;
      } else {
        this.accumulatedLightOps = mergeLightOperations(
          this.accumulatedLightOps,
          lightOps,
        );
        this.accumulatedStartSequenceId = Math.min(
          this.accumulatedStartSequenceId,
          startSequenceId,
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
          this.options.maxUpdatesPerUpdate,
        );

        const remainingUpdates = this.processLightUpdates(updates);

        this.blockUpdatesQueue.push(...remainingUpdates);

        this.blockUpdatesToEmit.push(
          ...updates
            .slice(
              0,
              this.options.maxUpdatesPerUpdate - remainingUpdates.length,
            )
            .filter(({ source }) => source === "client")
            .map(({ update }) => update),
        );

        if (this.blockUpdatesQueue.length > 0) {
          requestAnimationFrame(processUpdatesInIdleTime);
          return;
        }
      }

      this.flushAccumulatedLightOps();
      this.isTrackingChunks = false;
      // Same as applyServerUpdatesImmediately: voxel apply must remesh even
      // while light workers are still running, otherwise optimistic breaks
      // (and any light-worker stall) leave a solid ghost mesh over air.
      this.processDirtyChunks();
    };

    processUpdatesInIdleTime();
  };

  private processDirtyChunks = async () => {
    const dirtyKeys = this.meshPipeline.getDirtyKeys();
    if (dirtyKeys.length === 0) return;

    const urgentKeys = dirtyKeys.filter((key) =>
      this.meshPipeline.isUrgent(key),
    );
    if (
      urgentKeys.length === 0 &&
      (this.urgentMeshWorkerPool.workingCount > 0 ||
        this.urgentMeshWorkerPool.queue.length > 0)
    ) {
      this.scheduleDirtyChunkProcessing();
      return;
    }

    const maxConcurrentMeshJobs = this.options.maxMeshesPerUpdate || 8;
    const candidateKeys = urgentKeys.length > 0 ? urgentKeys : dirtyKeys;
    // Dispatch only what the target pool can start right now. A dispatched
    // job eagerly serializes its 9-chunk stencil, and a saturated pool used
    // to park those multi-MB payloads in its queue — during update floods
    // that queue grew without bound and OOMed the renderer.
    const targetPool =
      urgentKeys.length > 0 ? this.urgentMeshWorkerPool : this.meshWorkerPool;
    const freeWorkerSlots = Math.max(
      0,
      targetPool.options.maxWorker -
        targetPool.workingCount -
        targetPool.queue.length,
    );
    const keysToProcess = candidateKeys.slice(
      0,
      Math.min(maxConcurrentMeshJobs, freeWorkerSlots),
    );
    if (keysToProcess.length === 0) {
      this.scheduleDirtyChunkProcessing();
      return;
    }

    const workerPromises = keysToProcess.map((key) => {
      const { cx, cz, level } = MeshPipeline.parseKey(key);
      const isPriority = this.meshPipeline.isUrgent(key);
      const generation = this.meshPipeline.startJob(key);

      return this.dispatchMeshWorker(cx, cz, level, isPriority).then(
        (result) =>
          ({
            cx,
            cz,
            level,
            generation,
            key,
            geometries: result?.geometries ?? null,
            connectivity: result?.connectivity ?? CONNECTIVITY_FULL,
          }) as const,
        (error) => {
          // A dispatch that throws (e.g. payload serialization failing an
          // array-buffer allocation under memory pressure) must still settle:
          // an unhandled rejection here escapes Promise.all, skips every
          // failJob in the batch, and leaves those generations in flight
          // forever — wedging the whole mesh pipeline on chunks that will
          // never be retried.
          console.error(`[world] mesh dispatch failed for ${key}`, error);
          return {
            cx,
            cz,
            level,
            generation,
            key,
            geometries: null,
            connectivity: CONNECTIVITY_FULL,
          } as const;
        },
      );
    });

    const results = await Promise.all(workerPromises);

    for (const result of results) {
      if (result.geometries) {
        this.applyMeshResult(
          result.cx,
          result.cz,
          result.level,
          result.geometries,
          result.connectivity,
          result.generation,
        );
      } else {
        // dispatchMeshWorker returns null when the chunk is mid-load/update
        // or neighbors are missing. startJob already reserved this generation
        // in inFlightGenerations; without releasing it, shouldStartJob stays
        // false forever and the client keeps the pre-break ghost mesh even
        // though getVoxelAt is already air (server echo is a no-op then).
        this.meshPipeline.failJob(result.key, result.generation);
      }

      if (this.meshPipeline.needsRemesh(result.key)) {
        this.scheduleDirtyChunkProcessing();
      }
    }

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
        requestAnimationFrame(() => {
          scheduled = false;
          this.processDirtyChunks();
        });
      });
    };
  })();

  private flushAccumulatedLightOps() {
    if (!this.accumulatedLightOps || !this.accumulatedLightOps.hasOperations) {
      return;
    }

    // At most one light batch is ever scheduled; while it runs, further ops
    // keep accumulating (they merge into fewer, better-clustered jobs).
    // Scheduling a batch per server packet used to pile up batches faster
    // than workers drained them during sustained update floods.
    if (this.activeLightBatch !== null || this.lightJobQueue.length > 0) {
      return;
    }

    this.scheduleLightJobs(
      this.accumulatedLightOps,
      this.accumulatedStartSequenceId,
    );

    this.accumulatedLightOps = null;
    this.accumulatedStartSequenceId = 0;
  }

  private scheduleLightJobs(
    lightOps: LightOperations,
    startSequenceId: number,
  ) {
    const batchId = this.lightBatchIdCounter++;

    const jobsForBatch = buildLightJobs(
      lightOps,
      startSequenceId,
      batchId,
      this.options,
      (color) => `light-${color}-${this.lightJobIdCounter++}`,
    );

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
      const job = this.lightJobQueue.shift();
      if (job) batchJobs.push(job);
    }

    this.activeLightBatch = {
      batchId,
      startSequenceId: firstJob.startSequenceId,
      totalJobs: batchJobs.length,
      completedJobs: 0,
      results: [],
      jobs: batchJobs,
      pendingDispatch: [...batchJobs],
    };

    this.dispatchPendingLightJobs();
  }

  /**
   * Hand pending light jobs to workers, but only as many as can start right
   * now. Dispatch serializes every chunk the job's bounding box covers, so
   * dispatching a whole batch at once used to park the batch's worth of
   * multi-megabyte copies in the pool queue — the same unbounded allocation
   * that mesh dispatch already guards against.
   */
  private dispatchPendingLightJobs() {
    const batch = this.activeLightBatch;
    if (!batch) return;

    while (
      batch.pendingDispatch.length > 0 &&
      this.lightWorkerPool.availableCount > 0
    ) {
      const job = batch.pendingDispatch.shift();
      if (!job) break;
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

    // Every chunk in the box is serialized (copied) below, so the box span
    // IS the job's memory footprint. Track the high-water mark and call out
    // oversized boxes: a batch merged from spatially-scattered updates
    // (random ticks across the whole render distance) can balloon into a
    // renderer-killing burst allocation.
    if (chunksInSpace.length > this.lightJobHighWaterChunks) {
      this.lightJobHighWaterChunks = chunksInSpace.length;
    }
    if (chunksInSpace.length >= 36) {
      console.warn(
        `[world] light job ${jobId} spans ${chunksInSpace.length} chunks ` +
          `(grid ${maxChunkX - minChunkX + 1}x${maxChunkZ - minChunkZ + 1}, ` +
          `${lightOps.removals.length} removals, ${lightOps.floods.length} floods); ` +
          `serializing this box is a large burst allocation`,
      );
    }

    const relevantDeltas: Record<string, VoxelDelta[]> = {};
    chunksInSpace.forEach((chunkName) => {
      const allDeltas = this.voxelDeltas.get(chunkName) || [];
      const recentDeltas = allDeltas.filter(
        (d) => d.sequenceId > startSequenceId,
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
      timeoutMs: this.options.lightJobTimeoutMs,
      resolve: (result) => this.handleLightJobResult(job, result),
    });
  }

  private handleLightJobResult(
    job: LightJob,
    result: LightWorkerResult | null,
  ) {
    if (
      !this.activeLightBatch ||
      this.activeLightBatch.batchId !== job.batchId
    ) {
      return;
    }

    const batch = this.activeLightBatch;
    // A null result means the worker failed; still advance the batch so
    // lighting never wedges, and keep remesh free via processDirtyChunks.
    if (result?.modifiedChunks) {
      batch.results.push({
        color: job.color,
        modifiedChunks: result.modifiedChunks,
        boundingBox: job.boundingBox,
      });
    }
    batch.completedJobs++;

    if (batch.completedJobs < batch.totalJobs) {
      // A worker slot just came free; serialize the next job into it.
      this.dispatchPendingLightJobs();
      return;
    }

    this.applyBatchResults(batch);
    this.activeLightBatch = null;
    this.processNextLightBatch();
    // Ops that accumulated while this batch ran get their turn immediately.
    this.flushAccumulatedLightOps();

    if (this.lightJobQueue.length === 0 && this.activeLightBatch === null) {
      this.settleLightJobWaitersIfIdle();
      this.processDirtyChunks();
    }
  }

  private applyBatchResults(batch: LightBatch) {
    const { maxHeight, subChunks } = this.options;
    const subChunkHeight = maxHeight / subChunks;

    const chunkResultsByColor = new Map<
      string,
      Map<LightColor, { lights: Uint32Array; boundingBox: BoundingBox }>
    >();
    const allChunkCoords = new Map<string, Coords2>();
    const modifiedYRanges = new Map<string, { minY: number; maxY: number }>();

    for (const result of batch.results) {
      for (const { coords, lights, minY, maxY } of result.modifiedChunks) {
        const key = `${coords[0]},${coords[1]}`;
        allChunkCoords.set(key, coords);

        let colorMap = chunkResultsByColor.get(key);
        if (!colorMap) {
          colorMap = new Map();
          chunkResultsByColor.set(key, colorMap);
        }
        colorMap.set(result.color, {
          lights,
          boundingBox: result.boundingBox,
        });

        const existing = modifiedYRanges.get(key);
        if (!existing) {
          modifiedYRanges.set(key, { minY, maxY });
        } else {
          existing.minY = Math.min(existing.minY, minY);
          existing.maxY = Math.max(existing.maxY, maxY);
        }
      }
    }

    for (const [key, colorMap] of chunkResultsByColor) {
      const coords = allChunkCoords.get(key);
      if (!coords) continue;
      const chunk = this.getChunkByCoords(coords[0], coords[1]);
      if (!chunk) continue;
      const modifiedYRange = modifiedYRanges.get(key);
      if (!modifiedYRange) continue;

      for (const [color, result] of colorMap) {
        mergeSingleColorResult(chunk, result.lights, color, result.boundingBox);
      }

      chunk.isDirty = true;
      const minLevel = Math.max(
        0,
        Math.floor(modifiedYRange.minY / subChunkHeight),
      );
      const maxLevel = Math.min(
        subChunks - 1,
        Math.floor(modifiedYRange.maxY / subChunkHeight),
      );
      this.markChunkForRemeshLevels(coords, minLevel, maxLevel);
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
    color: LightColor,
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
        this.options.chunkSize,
      );
      affectedChunks.add(ChunkUtils.getChunkName(chunkCoords));
    });

    affectedChunks.forEach((chunkName) => {
      const coords = ChunkUtils.parseChunkName(chunkName);
      this.markChunkForRemesh(coords as Coords2);
    });

    if (lightOps.removals.length > 0) {
      const { maxLightLevel, chunkSize, maxHeight, subChunks } = this.options;
      let minY = maxHeight;
      let maxY = 0;

      for (const [vx, vy, vz] of lightOps.removals) {
        minY = Math.min(minY, vy);
        maxY = Math.max(maxY, vy);

        for (let dx = -maxLightLevel; dx <= maxLightLevel; dx++) {
          for (let dz = -maxLightLevel; dz <= maxLightLevel; dz++) {
            const coords = ChunkUtils.mapVoxelToChunk(
              [vx + dx, vy, vz + dz],
              chunkSize,
            );
            affectedChunks.add(ChunkUtils.getChunkName(coords));
          }
        }
      }

      minY = Math.max(0, minY - maxLightLevel);
      maxY = Math.min(maxHeight - 1, maxY + maxLightLevel);
      const subChunkHeight = maxHeight / subChunks;
      const minLevel = Math.floor(minY / subChunkHeight);
      const maxLevel = Math.min(
        subChunks - 1,
        Math.floor(maxY / subChunkHeight),
      );

      affectedChunks.forEach((chunkName) => {
        const coords = ChunkUtils.parseChunkName(chunkName);
        this.markChunkForRemeshLevels(coords as Coords2, minLevel, maxLevel);
      });
    }
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
      this.options.maxUpdatesPerUpdate,
    );

    this.pushBulkUpdatePacket(updates);
  };

  private encodeBlockUpdateToRaw = (update: BlockUpdate): number => {
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
        BlockRotation.encode(rotation, yRotation),
      );
    }

    if (stage !== undefined) {
      raw = BlockUtils.insertStage(raw, stage);
    }

    return raw;
  };

  private pushBulkUpdatePacket = (updates: BlockUpdate[]) => {
    if (updates.length === 0) return;

    const processedUpdates = updates.map((update) => ({
      ...update,
      voxel: this.encodeBlockUpdateToRaw(update),
    }));

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

    // A client-sourced update is the player's own edit (a lever flip, a
    // block placed under the crosshair). Its remesh takes the urgent lane
    // unconditionally: making interaction feel instant is the entire point
    // of the optimistic path, and parking it behind the regular queue reads
    // as input lag whenever the surrounding chunks are remesh-heavy.
    const isUrgent = this.activeBlockUpdateSource === "client";

    for (const [chunkX, chunkZ] of chunkCoordsList) {
      for (const lvl of levels) {
        this.meshPipeline.onVoxelChange(chunkX, chunkZ, lvl, isUrgent);
      }
    }
  }

  private recordVoxelDelta(
    px: number,
    py: number,
    pz: number,
    deltaData: Partial<Omit<VoxelDelta, "coords" | "timestamp" | "sequenceId">>,
  ) {
    const chunkName = ChunkUtils.getChunkName(
      ChunkUtils.mapVoxelToChunk(
        [px | 0, py | 0, pz | 0],
        this.options.chunkSize,
      ),
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
    maxLevel: number,
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
        const floorY = this.detailFloorYFor(nx, nz);
        const heightPerSubChunk = Math.floor(
          this.options.maxHeight / subChunks,
        );
        const name = ChunkUtils.getChunkName([nx, nz]);
        // A chunk already meshed to the ground keeps that depth even once it
        // is distant again, so the levels queued below have to be chosen by
        // the depth the chunk actually holds and not by the one its distance
        // asks for. Filtering on the latter skips levels the chunk still owns,
        // leaving them stale with nothing left to queue them: the refinement
        // pass takes this floor as proof they are already up to date.
        const effectiveFloor = Math.min(
          this.chunkDetailFloor.get(name) ?? Infinity,
          floorY,
        );

        this.setDetailFloor(nx, nz, effectiveFloor);

        for (let level = 0; level < subChunks; level++) {
          if (heightPerSubChunk * (level + 1) <= effectiveFloor) continue;
          this.meshPipeline.onVoxelChange(nx, nz, level);
        }
      }
    }

    this.scheduleDirtyChunkProcessing();
  }

  /**
   * Hides the chunk subtrees the camera cannot see, so the renderer's matrix
   * and culling passes stop at one node per chunk instead of descending into
   * every mesh of every chunk in the loaded disc.
   *
   * Chunks inside {@link WorldClientOptions.chunkCullShadowSafeDistance} are
   * left alone whichever way the camera points: they are still inside the shadow
   * cascades, and hiding a shadow caster is visible from the front even when
   * the caster is not.
   */
  private isPlantVoxel(voxel: number) {
    try {
      return this.getBlockById(voxel)?.isPlant === true;
    } catch {
      return false;
    }
  }

  /**
   * Shows or hides a chunk's plant meshes for its current distance band. Cached
   * per chunk because the answer only changes when a chunk crosses the boundary
   * — walking the children of every loaded chunk every frame would cost more
   * than the draw calls it saves.
   */
  private updateChunkPlantDetail(chunk: Chunk, distanceSquared: number) {
    const { plantDetailDistance, chunkSize } = this.options;
    if (plantDetailDistance === null) return;

    const radius = plantDetailDistance / chunkSize;
    const wanted = distanceSquared <= radius * radius;
    if (chunk.plantsShown === wanted) return;
    chunk.plantsShown = wanted;

    for (const [level, meshes] of chunk.meshes) {
      const isLevelVisible =
        chunk.sectionVisibleMask === null ||
        ((chunk.sectionVisibleMask >> level) & 1) === 1;
      for (const mesh of meshes) {
        if (mesh.userData?.isPlant) mesh.visible = wanted && isLevelVisible;
      }
    }
  }

  /**
   * Writes one section-visibility answer onto a chunk's meshes and arena
   * slots, skipping chunks whose answer has not changed since the last walk.
   */
  private applySectionVisibility(chunk: Chunk, sectionMask: number) {
    if (chunk.sectionVisibleMask === sectionMask) return;
    chunk.sectionVisibleMask = sectionMask;

    const [cx, cz] = chunk.coords;
    const isPlantShown = chunk.plantsShown !== false;

    for (const [level, meshes] of chunk.meshes) {
      const isLevelVisible = ((sectionMask >> level) & 1) === 1;
      for (const mesh of meshes) {
        mesh.visible =
          isLevelVisible && (isPlantShown || mesh.userData?.isPlant !== true);
      }
      this.regionArenas?.setSectionVisible(cx, cz, level, isLevelVisible);
    }
  }

  private updateChunkVisibility(camera: Camera) {
    const {
      isCullingChunksByFrustum,
      isCullingChunksByOcclusion,
      isCullingChunksByFog,
      fogCullSlack,
      chunkCullShadowSafeDistance,
      chunkSize,
      subChunks,
    } = this.options;
    if (!isCullingChunksByFrustum) return;

    // The renderer only refreshes these during its own pass, which has not run
    // yet this frame; culling against last frame's camera lags the view by a
    // frame and shows up as chunks blinking in at the edge of a fast turn.
    camera.updateMatrixWorld();
    this.chunkCullMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this.chunkCullFrustum.setFromProjectionMatrix(this.chunkCullMatrix);

    let graph: SectionVisibilityGraph | null = null;
    if (isCullingChunksByOcclusion && this.sectionVisibility) {
      camera.getWorldPosition(this.chunkCullCameraPosition);
      const fogFar = isCullingChunksByFog
        ? this.chunkRenderer.uniforms.fogFar.value + fogCullSlack
        : Infinity;
      this.sectionVisibility.walk(
        this.chunkCullCameraPosition,
        this.chunkCullMatrix,
        fogFar,
      );
      // A walk that could not start (camera outside the loaded disc) proves
      // nothing; fall back to frustum-only culling rather than hide the world.
      if (this.sectionVisibility.isComplete) graph = this.sectionVisibility;
    }

    const [centerX, centerZ] = this.centerChunk;
    const shadowSafeSquared = (chunkCullShadowSafeDistance / chunkSize) ** 2;
    const { maxHeight } = this.options;
    const allVisibleMask = (1 << subChunks) - 1;

    this.chunkPipeline.forEachLoaded((chunk) => {
      const [cx, cz] = chunk.coords;
      const dx = cx - centerX;
      const dz = cz - centerZ;
      const distanceSquared = dx * dx + dz * dz;

      this.updateChunkPlantDetail(chunk, distanceSquared);

      // Chunks inside the shadow-safe ring are still inside the shadow
      // cascades, and hiding a caster is visible from the front even when the
      // caster is not — so there the reached set (an air path exists, however
      // the camera points) decides, not the frustum-tested visible set. A
      // section no air path reaches cannot cast onto anything the camera
      // sees, so a sealed interior collapses either way.
      const isShadowSafe = distanceSquared <= shadowSafeSquared;

      let sectionMask = allVisibleMask;
      if (graph) {
        sectionMask = 0;
        for (let level = 0; level < subChunks; level++) {
          const isSectionShown = isShadowSafe
            ? graph.isSectionReached(cx, cz, level)
            : graph.isSectionVisible(cx, cz, level);
          if (isSectionShown) {
            sectionMask |= 1 << level;
          }
        }
      }

      this.applySectionVisibility(chunk, sectionMask);

      if (isShadowSafe) {
        chunk.group.visible = graph ? sectionMask !== 0 : true;
        return;
      }

      // The walk already carried the frustum (and fog) test per section, so
      // its verdict subsumes the whole-column box test.
      if (graph) {
        chunk.group.visible = sectionMask !== 0;
        return;
      }

      // The whole column, not the meshed part of it: a chunk's geometry can
      // reach anywhere between the floor and the ceiling, and a box that
      // tracked the geometry would have to be rebuilt on every remesh.
      this.chunkCullBox.min.set(cx * chunkSize, 0, cz * chunkSize);
      this.chunkCullBox.max.set(
        (cx + 1) * chunkSize,
        maxHeight,
        (cz + 1) * chunkSize,
      );

      chunk.group.visible = this.chunkCullFrustum.intersectsBox(
        this.chunkCullBox,
      );
    });
  }

  /**
   * The world Y a chunk should mesh up from right now. Chunks near the player
   * always mesh from the ground; distant ones start at the cull line.
   *
   * An altitude rather than a level index because the mesher takes an arbitrary
   * Y range: the cut can land wherever the cloud deck covers, instead of the
   * world having to be re-cut into sub-chunks fine enough to have a boundary
   * near it.
   */
  private detailFloorYFor(cx: number, cz: number) {
    const { distantDetailCullBelowY, nearDetailRadius } = this.options;

    if (distantDetailCullBelowY === null) return 0;
    if (!this.isDistantCullHidden()) return 0;

    const dx = cx - this.centerChunk[0];
    const dz = cz - this.centerChunk[1];

    if (dx * dx + dz * dz <= nearDetailRadius * nearDetailRadius) return 0;

    return Math.max(0, distantDetailCullBelowY);
  }

  /**
   * Whether terrain hidden by the cull would in fact be out of sight.
   *
   * Only from above the cut, where the deck that motivated it lies in between.
   * Drop below and there is nothing left covering the seam: distant mountains
   * read as sliced off in mid-air with their trees hanging over open sky. The
   * scheme switches itself off there rather than show that, and the terrain it
   * skipped is queued back in by {@link refineNearbyChunkDetail}.
   */
  private isDistantCullHidden() {
    return this.distantCullHidden;
  }

  /**
   * Decides whether the cull may be in effect at the player's current altitude.
   *
   * Deliberately lopsided. Dropping below the line switches it off at once,
   * because the moment the deck is no longer overhead the seam is in plain
   * sight; climbing back only switches it on once clear of the line by
   * {@link WorldClientOptions.distantDetailCullHysteresis}. Without that gap a
   * player resting at the cull altitude flips the state every frame, and since
   * a chunk's floor only ever ratchets downward, each flip permanently refines
   * more of the disc until the range this buys has quietly drained away.
   */
  private updateDistantCullState() {
    const { distantDetailCullBelowY, distantDetailCullHysteresis } =
      this.options;

    if (distantDetailCullBelowY === null) {
      this.distantCullHidden = false;
      return;
    }

    if (this.centerY < distantDetailCullBelowY) {
      this.distantCullHidden = false;
    } else if (
      this.centerY >=
      distantDetailCullBelowY + distantDetailCullHysteresis
    ) {
      this.distantCullHidden = true;
    }
  }

  /**
   * Records how far up a chunk is meshed, keeping {@link culledChunks} in step
   * so the two can never disagree about which chunks still owe geometry.
   */
  private setDetailFloor(cx: number, cz: number, floorY: number) {
    const name = ChunkUtils.getChunkName([cx, cz]);

    this.chunkDetailFloor.set(name, floorY);

    if (floorY > 0) {
      this.culledChunks.set(name, [cx, cz]);
    } else {
      this.culledChunks.delete(name);
    }
  }

  /**
   * Queues the terrain that was culled away while a chunk was distant, now that
   * the player has come close enough to need it. Spread over frames and ordered
   * nearest-first: the whole point of culling is a bigger radius, and a bigger
   * radius means far more chunks can cross the near boundary at once.
   */
  private refineNearbyChunkDetail() {
    const {
      distantDetailCullBelowY,
      nearDetailRadius,
      subChunks,
      maxHeight,
      maxDetailRefinementsPerUpdate,
    } = this.options;

    if (distantDetailCullBelowY === null) return;
    if (this.culledChunks.size === 0) return;

    const [centerX, centerZ] = this.centerChunk;
    // Dropping below the deck suspends the cull everywhere at once, so the
    // whole loaded disc has terrain owed back to it, not just the near ring.
    const scanRadius = this.isDistantCullHidden()
      ? nearDetailRadius
      : this.renderRadius;
    const radiusSquared = scanRadius * scanRadius;
    const candidates: { cx: number; cz: number; distanceSquared: number }[] =
      [];

    // Walks the chunks still holding terrain back rather than the disc they
    // sit in. The disc is the same size every frame whether or not anything in
    // it owes geometry, and building a key per cell to ask made the answer
    // cost more than acting on it.
    for (const [cx, cz] of this.culledChunks.values()) {
      const dx = cx - centerX;
      const dz = cz - centerZ;
      const distanceSquared = dx * dx + dz * dz;

      if (distanceSquared > radiusSquared) continue;

      const chunk = this.getChunkByCoords(cx, cz);
      if (!chunk || !chunk.isReady) continue;

      candidates.push({ cx, cz, distanceSquared });
    }

    if (candidates.length === 0) return;

    candidates.sort((a, b) => a.distanceSquared - b.distanceSquared);

    const heightPerSubChunk = Math.floor(maxHeight / subChunks);

    for (const { cx, cz } of candidates.slice(
      0,
      maxDetailRefinementsPerUpdate,
    )) {
      const floorY =
        this.chunkDetailFloor.get(ChunkUtils.getChunkName([cx, cz])) ?? 0;

      this.setDetailFloor(cx, cz, 0);

      // Includes the level the cull line ran through, whose mesh is missing
      // everything under that line and has to be rebuilt whole.
      for (let level = 0; level < subChunks; level++) {
        if (heightPerSubChunk * level > floorY) break;
        this.meshPipeline.onVoxelChange(cx, cz, level);
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
        }`,
      );
    }
  }
}
