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
   * World Y under which distant chunks are left unmeshed, trading the terrain
   * below it for a much larger render radius. Only chunks farther away than
   * {@link nearDetailRadius} are culled; the ones around the player always mesh
   * to the ground, and a chunk fills in the rest as the player approaches.
   * `null` (the default) meshes everything everywhere.
   *
   * Culling leaves the underside of distant terrain open, so this is only
   * invisible when something opaque sits over the cut — a cloud deck whose
   * lowest surface is above the cut line. Set it above that and distant
   * mountains read as hollow shells.
   *
   * For the same reason the cull applies only while the player is above this
   * line. Underneath it the deck is no longer in the way, so the world meshes
   * in full and gives up the range until they climb back over it.
   *
   * Only applies under {@link clientOnlyMeshing}; server-meshed worlds render
   * what they are sent.
   */
  distantDetailCullBelowY: number | null;

  /**
   * Chunk radius within which every sub-chunk level is meshed regardless of
   * {@link distantDetailCullBelowY}. Defaults to `10` chunks.
   */
  nearDetailRadius: number;

  /**
   * How far above {@link distantDetailCullBelowY} the player must climb before
   * culling resumes, having dropped below it. Falling below the line always
   * suspends culling immediately — the gap only delays switching it back on,
   * so that standing at the line does not flip the two states frame by frame.
   * Defaults to `8` blocks.
   */
  distantDetailCullHysteresis: number;

  /**
   * How many chunks may have their culled levels queued for meshing per world
   * update. Refinement is spread over frames and ordered nearest-first so
   * walking into a region never lands as one burst of mesh jobs. Defaults to
   * `4` chunks.
   */
  maxDetailRefinementsPerUpdate: number;

  /**
   * Whether whole chunk subtrees are hidden while the camera cannot see them.
   *
   * three.js culls per mesh, but it pays to walk the scene graph first: every
   * node is visited by the matrix pass and the culling pass whether or not it
   * ends up drawn, and a wide render radius is tens of thousands of visits per
   * frame. Testing one box per chunk and hiding the ones that miss lets the
   * renderer skip those branches outright.
   *
   * Requires a camera to be passed to {@link World.update}; without one there
   * is nothing to cull against and every chunk stays visible.
   */
  isCullingChunksByFrustum: boolean;

  /**
   * Blocks within which chunks stay visible even when the camera is looking
   * away from them, because geometry behind the camera still casts shadows into
   * the view. Defaults to `160` blocks, comfortably past the shadow cascades'
   * 128-block reach; shorten it below that and near shadows start vanishing as
   * the player turns.
   *
   * In blocks rather than chunks so that a world choosing a coarser chunk size
   * does not silently pin hundreds of chunks visible.
   */
  chunkCullShadowSafeDistance: number;

  /**
   * Whether to hide chunk sections the camera provably cannot see through the
   * terrain, walking the mesher-reported face-connectivity graph outward from
   * the camera's own section (Sodium-style occlusion culling). An enclosed
   * interior stops drawing the world around it. Requires
   * {@link WorldClientOptions.isCullingChunksByFrustum}, since the walk also
   * carries the frustum test.
   */
  isCullingChunksByOcclusion: boolean;

  /**
   * Whether the occlusion walk also prunes sections past the fog's far edge,
   * where every fragment already resolves to pure fog color.
   */
  isCullingChunksByFog: boolean;

  /**
   * Blocks past the fog far edge a section may reach before fog culling hides
   * it, absorbing the difference between a section's center distance and the
   * nearest fragment the fog actually shades.
   */
  fogCullSlack: number;

  /**
   * Block distance out to which plant decoration (grass tufts, flowers — any
   * block the registry marks `isPlant`) is drawn. Beyond it those meshes are
   * hidden. `null` (the default) draws them everywhere.
   *
   * Plants cannot share a mesh with the terrain: each species is its own
   * double-sided alpha-tested material, so a chunk with grass and two flower
   * species costs three extra draw calls no matter how few blocks are in them.
   * Across a wide render disc that is most of the frame's draw calls spent on
   * geometry a metre wide, which past a couple of hundred blocks covers well
   * under a pixel.
   *
   * This hides whole meshes rather than fading them, so set it past the point
   * where a tuft is still resolvable or the boundary reads as a moving edge in
   * the ground cover.
   */
  plantDetailDistance: number | null;

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

  /**
   * Region buffer arenas for the shared-opaque chunk bucket. See
   * {@link ChunkRegionArenasOptions}. `null` disables batching and keeps
   * per-section meshes.
   */
  regionArenas: ChunkRegionArenasOptions | null;
};

/**
 * Tunables for the per-region `BatchedMesh` arenas that batch every
 * shared-opaque chunk section into one multi-draw call per region.
 */
export type ChunkRegionArenasOptions = {
  /**
   * The width and depth of a region, in chunk columns. Every section whose
   * chunk falls inside the same region shares one `BatchedMesh`.
   */
  regionSizeInChunks: number;

  /**
   * Vertex capacity a region arena is created with. Arenas grow geometrically
   * from here, so this is a floor, not a limit.
   */
  initialVertexCapacity: number;

  /**
   * Multiplier applied to a section's vertex/index count when reserving its
   * arena slot, so small remeshes update in place instead of reallocating.
   */
  slotSlack: number;

  /**
   * Factor a full arena's capacity is multiplied by when it grows. Growth
   * re-uploads the region's buffers, so it should be rare: geometric growth
   * bounds the number of growth events logarithmically.
   */
  growthFactor: number;

  /**
   * Index capacity per vertex of capacity. Quad geometry uses six indices for
   * every four vertices, hence the 1.5 default.
   */
  indexPerVertexRatio: number;
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
  isCullingChunksByFrustum: true,
  chunkCullShadowSafeDistance: 160,
  isCullingChunksByOcclusion: true,
  isCullingChunksByFog: true,
  fogCullSlack: 16,
  plantDetailDistance: null,
  distantDetailCullBelowY: null,
  nearDetailRadius: 10,
  distantDetailCullHysteresis: 8,
  maxDetailRefinementsPerUpdate: 4,
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
  regionArenas: {
    regionSizeInChunks: 8,
    initialVertexCapacity: 1 << 18,
    slotSlack: 1.1,
    growthFactor: 1.5,
    indexPerVertexRatio: 1.5,
  },
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
