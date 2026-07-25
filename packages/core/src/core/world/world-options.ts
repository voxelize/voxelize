import { ChunkRenderer } from "./chunk-renderer";
import { CloudsOptions } from "./clouds";
import { MemoryPressureOptions } from "./memory-pressure";
import { SkyOptions } from "./sky";

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

  /**
   * Client batches larger than this skip the optimistic local apply (with
   * its per-frame relight) and stream straight to the server; the world
   * catches up from the server's tick-batched echo. Keeps bulk edits
   * (WorldEdit) from freezing the tab and guarantees the whole batch is on
   * the wire before any reload. Defaults to `4000` updates.
   */
  maxOptimisticClientUpdates: number;

  /**
   * Server update batches larger than this are drained through the
   * incremental per-frame update queue instead of being applied (and
   * relit) synchronously in one shot. Defaults to `500` updates.
   */
  maxImmediateServerUpdates: number;

  /**
   * Milliseconds a light worker job may run before its worker is presumed
   * dead (an OOMed worker dies without any error event) and replaced.
   * Defaults to `20000`.
   */
  lightJobTimeoutMs: number;

  /**
   * Milliseconds a mesh worker job may run before its worker is presumed
   * dead and replaced. Defaults to `30000`.
   */
  meshJobTimeoutMs: number;

  maxMeshesPerUpdate: number;

  /**
   * Dedicated mesh workers reserved for client-originated voxel edits.
   */
  maxUrgentMeshWorkers: number;

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
   * How long a requested chunk may go unanswered before the request is presumed
   * lost and reissued, in milliseconds. Defaults to `5000`ms.
   */
  chunkRerequestIntervalMs: number;

  /**
   * The default render radius of the world, in chunks. Change this through `world.renderRadius`. Defaults to `8` chunks.
   */
  defaultRenderRadius: number;

  /**
   * Fraction of render distance where horizon fog starts. Defaults to `0.45`.
   */
  fogNearRenderRatio: number;

  /**
   * Fraction of render distance where horizon fog fully hides terrain. Defaults to `0.78`.
   */
  fogFarRenderRatio: number;

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
   * Jobs allowed to wait for a free mesh or light worker before the oldest
   * are shed. Dispatch is already gated on free worker slots, so this is the
   * backstop that keeps a future caller from parking unbounded serialized
   * chunk payloads in a pool queue. Defaults to `8`.
   */
  maxQueuedWorkerJobs: number;

  /**
   * Distinct voxels tracked by {@link World.getPreviousValueAt}. The history
   * is a debugging convenience, not gameplay state, so it evicts oldest-first
   * instead of growing with every voxel a session ever edits. Defaults to
   * `4096`.
   */
  maxVoxelHistoryVoxels: number;

  /**
   * Previous values retained per voxel. Defaults to `4`.
   */
  maxVoxelHistoryPerVoxel: number;

  /**
   * Renderer heap watchdog thresholds. See {@link MemoryPressureOptions}.
   */
  memoryPressure: Partial<MemoryPressureOptions>;
};

export const defaultWorldClientOptions: WorldClientOptions = {
  maxChunkRequestsPerUpdate: 12,
  maxProcessesPerUpdate: 4,
  maxUpdatesPerUpdate: 1000,
  maxOptimisticClientUpdates: 4000,
  maxImmediateServerUpdates: 500,
  lightJobTimeoutMs: 20000,
  meshJobTimeoutMs: 30000,
  maxLightsUpdateTime: 5, // ms
  maxMeshesPerUpdate: 8,
  maxUrgentMeshWorkers: 4,
  clientOnlyMeshing: true,
  minLightLevel: 0.04,
  chunkRerequestIntervalMs: 5000,
  defaultRenderRadius: 6,
  fogNearRenderRatio: 0.45,
  fogFarRenderRatio: 0.78,
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
  maxQueuedWorkerJobs: 8,
  maxVoxelHistoryVoxels: 4096,
  maxVoxelHistoryPerVoxel: 4,
  memoryPressure: {},
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
   * The nominal water level of this world, in blocks.
   */
  waterLevel: number;
};

/**
 * The options to create a world. This consists of {@link WorldClientOptions} and {@link WorldServerOptions}.
 */
export type WorldOptions = WorldClientOptions & WorldServerOptions;
