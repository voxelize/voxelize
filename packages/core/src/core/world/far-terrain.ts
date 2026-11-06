import { MessageProtocol } from "@voxelize/protocol";
import {
  Color,
  DataArrayTexture,
  DataTexture,
  DoubleSide,
  FloatType,
  Group,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  type NodeMaterial,
  NearestFilter,
  PlaneGeometry,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
} from "three/webgpu";

import { WorkerPool } from "../../libs/worker-pool";

import { type Block, facesAt } from "./block";
import { FarBatch, type FarBatchSlot } from "./far-terrain-batch";
import {
  DEFAULT_FAR_LOD,
  FarLodOptions,
  FarLodPlan,
  planFarLod,
} from "./far-terrain-lod";
import {
  buildFarMaterialTable,
  FAR_LAYER_SIZE,
  FAR_MATERIAL_TEXELS,
  FAR_TINTED_LAYER,
  farFaceKey,
  farMaterialFaces,
  FarMaterialTable,
  farPaletteTable,
} from "./far-terrain-materials";
import {
  FAR_FACE_KIND,
  FarMeshCounts,
  FarMeshData,
  FarMeshInput,
} from "./far-terrain-mesh";
import { farSeamScale } from "./far-terrain-seam";
import { FAR_SHADOW_NONE, type FarShadowInput } from "./far-terrain-shadow";
import {
  buildCoverageMask,
  decodeFarTerrainReply,
  FarFaceLook,
  FarFaceSide,
  FarTerrainDescriptor,
  FarTileData,
  farTileId,
  FarTileKey,
  farTileSpan,
  meanLinearRgb,
  pendingChunksWithin,
} from "./far-terrain-tiles";
import {
  createFarLandMaterial,
  createFarSeabedMaterial,
  createFarTerrainUniforms,
  createFarWaterMaterial,
  type FarTerrainSharedUniforms,
  type FarTerrainUniforms,
} from "./shading/far-terrain";
import { AtlasTexture } from "./textures";
import FarTerrainWorker from "./workers/far-terrain-worker.ts?worker&inline";

/** The method a client calls for far-terrain tiles, and its reply's name. */
export const FAR_TERRAIN_METHOD = "vox-builtin:far-terrain";

/** Texels per side of the chunk-coverage mask (chunk columns). */
const COVERAGE_SIZE = 128;

/**
 * While columns are still on their way the mask is rebuilt on this cadence
 * as well as on every change, so a column that outlives its grace
 * (`CHUNK_PENDING_GRACE_MS`) uncovers without waiting for another chunk to
 * load.
 */
const PENDING_RECHECK_MS = 500;

/**
 * The sea-depth map the far water reads: texels per side, blocks per texel
 * (2048 blocks across, past any reach), the depth one byte spans, and how
 * far the viewer may drift from its centre before it is laid out again.
 */
const DEPTH_TEXELS = 256;
const DEPTH_BLOCKS_PER_TEXEL = 8;
const DEPTH_RANGE = 32;
const DEPTH_RECENTER = 256;

/**
 * The far sun shadows: blocks a shadow may reach along the ground, and how
 * far the sun turns (as a unit vector) or how long passes before the lines
 * are cast again. Their softening is the shading's (shading/far-terrain.ts).
 */
const FAR_SHADOW_REACH = 512;
const FAR_SHADOW_SUN_TURN = 0.004;
const FAR_SHADOW_MIN_INTERVAL_MS = 400;

/** How far the viewer moves, or how long passes, before the plan is redone. */
const PLAN_MOVE_BLOCKS = 4;
const PLAN_MAX_AGE_MS = 500;

export type { FarTerrainSharedUniforms };
export {
  CHUNK_DAYLIGHT,
  CHUNK_WATER_FRESNEL,
  CHUNK_WATER_TINT,
} from "./shading/far-terrain";

/** A tile's meshes, built off the main thread. */
export type FarBuiltTile = {
  land: FarMeshData | null;
  sky: FarMeshData | null;
  buildMs: number;
};

export type FarTerrainOptions = {
  /**
   * How far past the viewer the layer reaches, in blocks; 0 turns it off.
   */
  distance: number;
  /**
   * Linear RGB per class, flattened, for a server whose descriptor names no
   * `materials`. A class past the end takes the last entry; an empty
   * palette draws grey.
   */
  palette: ArrayLike<number>;
  /**
   * What a block face looks like from afar, texels included (the world
   * reads them off the atlas), or null while its texture is not painted
   * yet. Used to paint the descriptor's `materials`.
   */
  faceLook:
    | ((block: number, side: FarFaceSide, stage: number) => FarFaceLook | null)
    | null;
  /**
   * How long a face may stay unreadable before the layer paints it grey and
   * says so, rather than never drawing.
   */
  faceLookTimeoutMs: number;
  /** The far water plane's colour. */
  waterColor: Color | string | number;
  /**
   * Colour of floating land's top and of its underside and walls, when the
   * descriptor names no `skyMaterial`.
   */
  skyTopColor: Color | string | number;
  skySideColor: Color | string | number;
  /**
   * The outer share of the reach across which the layer thins into the
   * haze, reaching it at the reach, so its edge never cuts against the sky.
   */
  edgeBand: number;
  /** How the layer chooses each tile's level of detail. */
  lod: FarLodOptions;
  /** How long a tile takes to dissolve in or out when the detail changes. */
  fadeMs: number;
  /** Tiles kept resident at most; the least recently drawn leave first. */
  maxResidentTiles: number;
  /**
   * A tile no plan has drawn for this long leaves even under the cap: long
   * enough that a trip away and back (a teleport home) finds the tiles it
   * left still resident.
   */
  evictAfterMs: number;
  /**
   * Chunk columns nearer the viewer's than this, in chunks, show sky and
   * fog while still on their way, whatever tile could stand in: right by
   * the viewer, a coarse tile shows through the walls of a canyon. Further
   * out any drawn tile stands in. 0 lets one stand in everywhere. The
   * default 1 guards only the viewer's own column: a wider guard opened
   * holes of fog right ahead of anyone flying faster than chunks load.
   */
  pendingGuardRadius: number;
  /** Tile builds in flight at once. */
  maxBuildsInFlight: number;
  /**
   * Builds a tile's meshes; the default hands it to a worker. A test, or a
   * host without workers, passes its own.
   */
  buildMesh: ((input: FarMeshInput) => Promise<FarBuiltTile | null>) | null;
  /**
   * Casts the sun shadow lines (far-terrain-shadow), as half floats; the
   * default hands it to the mesh workers. A host that builds its own meshes
   * gets no shadows unless it passes this too.
   */
  castShadow:
    | ((
        input: FarShadowInput,
      ) => Promise<{ lines: Uint16Array; buildMs: number } | null>)
    | null;
  /** Tiles one request may name; the server caps it too. */
  maxTilesPerRequest: number;
  /** Least time between two requests. */
  requestIntervalMs: number;
  /** A requested tile that has not arrived in this long is asked again. */
  retryAfterMs: number;
  /**
   * Tiles of the server's budget (`descriptor.budget`) never spent, so a
   * request that arrives sooner after the last than it was sent is not
   * refused for the difference.
   */
  budgetHeadroom: number;
  /** Main-thread time one update may spend reading faces. */
  buildBudgetMs: number;
  /**
   * Blocks of the loaded area's outer edge that hand over to the far layer
   * across a dithered band, up to half a chunk; 0 (the default) keeps the
   * edge hard (see `WorldOptions.farTerrainSeamBand`).
   */
  seamBand: number;
};

const DEFAULT_OPTIONS: FarTerrainOptions = {
  distance: 0,
  palette: [],
  faceLook: null,
  faceLookTimeoutMs: 10000,
  waterColor: "#2d6a9a",
  skyTopColor: "#6f9d4e",
  skySideColor: "#6e665c",
  edgeBand: 0.1,
  lod: DEFAULT_FAR_LOD,
  fadeMs: 450,
  maxResidentTiles: 640,
  evictAfterMs: 60_000,
  pendingGuardRadius: 1,
  maxBuildsInFlight: 4,
  buildMesh: null,
  castShadow: null,
  maxTilesPerRequest: 16,
  requestIntervalMs: 120,
  retryAfterMs: 6000,
  budgetHeadroom: 1,
  buildBudgetMs: 0.6,
  seamBand: 0,
};

/**
 * What a block's upward (`top`) or sideways (`side`) face looks like from
 * far away, for `FarTerrainOptions.faceLook`: the texels the chunks paint
 * it with (read off the atlas its chunk material samples), their mean in
 * linear RGB, and whether it takes the regional tint. Null while its
 * texture is not painted yet. A block the registry lacks, or a face whose
 * material is not an atlas, answers grey and says so: the far layer still
 * draws. A game's world and the world viewer both read faces through it.
 */
export function readFarFaceLook(
  block: Block | undefined,
  blockId: number,
  side: FarFaceSide,
  stage: number,
  materialOf: (block: Block, faceName: string) => { map?: unknown } | undefined,
): FarFaceLook | null {
  const grey: FarFaceLook = { color: [0.5, 0.5, 0.5], isTinted: false };
  if (!block || block.faces.length === 0) {
    console.warn(
      `[far-terrain] block ${blockId} has no faces; its far colour is grey`,
    );
    return grey;
  }
  const wanted: [number, number, number] =
    side === "top" ? [0, 1, 0] : [1, 0, 0];
  const faces = facesAt(block, stage);
  const face =
    faces.find(
      ({ dir }) =>
        dir[0] === wanted[0] && dir[1] === wanted[1] && dir[2] === wanted[2],
    ) ?? faces[0];
  const atlas = materialOf(block, face.name)?.map;
  if (!(atlas instanceof AtlasTexture)) {
    console.warn(
      `[far-terrain] ${block.name}'s ${face.name} face has no atlas; its far colour is grey`,
    );
    return grey;
  }
  const pixels = atlas.readRangePixels(face.range);
  if (!pixels) return null;
  const color = meanLinearRgb(pixels);
  if (!color) return null;
  return {
    color,
    isTinted: (face.stageTintMask ?? 0) !== 0,
    pixels,
    size: Math.round(Math.sqrt(pixels.length / 4)),
  };
}

/** Counters a harness can read to prove the budget. */
export type FarTerrainStats = {
  isActive: boolean;
  distance: number;
  /** Detail levels drawn this frame. */
  rings: number;
  tilesRequested: number;
  tilesReceived: number;
  tilesRejected: number;
  bytesReceived: number;
  tilesBuilt: number;
  tilesResident: number;
  /** Tiles drawn this frame, and those the detail rules want. */
  tilesDrawn: number;
  tilesWanted: number;
  /** Tiles drawn this frame at each level, finest first. */
  levelCounts: number[];
  /** Tile meshes (land + sky) shown. */
  meshes: number;
  /** Pages of the batch the tile meshes are drawn from, one draw call each. */
  batchPages: number;
  /** Main-thread ms the last update spent (planning, requests, mask). */
  lastUpdateMs: number;
  /** Highest `lastUpdateMs` since the counters were last read. */
  peakUpdateMs: number;
  /** Main-thread ms spent across every update, and how many there were. */
  totalUpdateMs: number;
  updates: number;
  /** Mask rebuilds. */
  maskRebuilds: number;
  /** Chunk columns inside the render radius the last mask covered because
   * they were still on their way (not loaded yet), inside the guard radius
   * or under no drawn tile: 0 once everything inside has landed. */
  pendingCovered: number;
  /** Loaded chunks hidden while the far layer stands in for their unfinished meshes. */
  chunksHeld: number;
  /**
   * Chunk columns still on their way the last mask left to the far layer,
   * under drawn tiles: the strip a flight brings inside the render radius,
   * or the ground around a teleport's end, keeps the terrain it showed.
   */
  pendingStoodIn: number;
  /** Triangles across every built tile mesh in the scene. */
  triangles: number;
  /** Worker ms the last tile build took, and the highest since the peaks were reset. */
  lastBuildMs: number;
  peakBuildMs: number;
  /** Builds handed to the worker and not back yet. */
  buildsInFlight: number;
  /** Main-thread ms the last built tile took to become a mesh, and the highest. */
  lastUploadMs: number;
  peakUploadMs: number;
  /** Worker ms the last cast of the far sun shadows took. */
  lastShadowMs: number;
  /** Bytes of vertex and index data across resident meshes. */
  meshBytes: number;
  /** Quads of the drawn land by what they are. */
  quads: FarMeshCounts;
  /**
   * Block faces read for the descriptor's materials, those still waiting
   * for their texture, those painted grey because they never became
   * readable, and the main-thread ms the reads took.
   */
  facesResolved: number;
  facesPending: number;
  facesMissing: number;
  faceLookMs: number;
};

/** Blocks under the far water plane the seabed behind it lies. */
const FAR_SEABED_DROP = DEPTH_RANGE;

type ResidentTile = {
  data: FarTileData;
  land: FarBatchSlot | null;
  sky: FarBatchSlot | null;
  isBuilt: boolean;
  isBuilding: boolean;
  /** 0 hidden, 1 fully drawn; eases toward 1 while drawn, 0 when not. */
  opacity: number;
  isDrawn: boolean;
  lastDrawnAt: number;
  bytes: number;
  /** Builds that failed; past MAX_BUILD_ATTEMPTS the tile is not tried again. */
  failedBuilds: number;
  counts: FarMeshCounts | null;
};

let sharedPool: WorkerPool | null = null;

const workerBuild = (input: FarMeshInput): Promise<FarBuiltTile | null> => {
  const pool = poolOf();
  return new Promise((resolve) => {
    pool.addJob({
      message: { input },
      resolve: (data: FarBuiltTile | null) => resolve(data),
      timeoutMs: 20000,
    });
  });
};

const poolOf = () => {
  if (!sharedPool) {
    sharedPool = new WorkerPool(FarTerrainWorker, {
      maxWorker: 2,
      name: "far-terrain-worker",
    });
  }
  return sharedPool;
};

const workerShadow = (
  shadow: FarShadowInput,
): Promise<{ lines: Uint16Array; buildMs: number } | null> => {
  const pool = poolOf();
  return new Promise((resolve) => {
    pool.addJob({
      message: { shadow },
      buffers: [shadow.heights.buffer as ArrayBuffer],
      resolve,
      timeoutMs: 20000,
    });
  });
};

const reliefOf = (tile: FarTileData) => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let at = 0; at < tile.heights.length; at++) {
    const h = tile.heights[at];
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  return Number.isFinite(lo) ? hi - lo : 0;
};

/**
 * Coarse terrain past the loaded chunks: a quadtree of stepped-column tiles
 * the server samples from its generator, finer near the viewer and on tall
 * relief, painted from the textures of the blocks each surface is made of
 * and lit and fogged as the chunks are, hidden wherever a chunk draws real
 * terrain, with a flat water plane at sea level. Tiles are meshed off the
 * main thread and dissolve in and out as the detail changes. The `World`
 * owns one, feeds it the server's descriptor from the INIT options, drives
 * `update` once a frame, hands it method replies and sends the requests it
 * queues.
 */
export class FarTerrain extends Group {
  public options: FarTerrainOptions;

  public descriptor: FarTerrainDescriptor | null = null;

  public stats: FarTerrainStats = {
    isActive: false,
    distance: 0,
    rings: 0,
    tilesRequested: 0,
    tilesReceived: 0,
    tilesRejected: 0,
    bytesReceived: 0,
    tilesBuilt: 0,
    tilesResident: 0,
    tilesDrawn: 0,
    tilesWanted: 0,
    levelCounts: [],
    meshes: 0,
    batchPages: 0,
    lastUpdateMs: 0,
    peakUpdateMs: 0,
    totalUpdateMs: 0,
    updates: 0,
    maskRebuilds: 0,
    pendingCovered: 0,
    chunksHeld: 0,
    pendingStoodIn: 0,
    triangles: 0,
    lastBuildMs: 0,
    peakBuildMs: 0,
    buildsInFlight: 0,
    lastUploadMs: 0,
    peakUploadMs: 0,
    lastShadowMs: 0,
    meshBytes: 0,
    quads: { tops: 0, risers: 0, skirts: 0, crowns: 0 },
    facesResolved: 0,
    facesPending: 0,
    facesMissing: 0,
    faceLookMs: 0,
  };

  private resident = new Map<string, ResidentTile>();

  /**
   * Every tile's relief once seen, kept past its mesh: a tile split for its
   * relief is never drawn, so it leaves, and without its relief the plan
   * would stop splitting and fetch it again.
   */
  private reliefs = new Map<string, number>();

  private pending = new Map<string, number>();

  private queuedRequests: MessageProtocol[] = [];

  private lastRequestAt = -Infinity;

  /**
   * The server's budget for this client mirrored as its token bucket: the
   * tiles still to ask for, and when it last refilled. Null until the first
   * request under a descriptor that names a budget.
   */
  private budgetTokens: number | null = null;

  private budgetRefilledAt = 0;

  private lastUpdateAt = -Infinity;

  /**
   * The detail plan, kept while nothing it reads has changed: the viewer
   * within PLAN_MOVE_BLOCKS of where it was made, no tile arrived, built or
   * dropped (`planVersion`), and no older than PLAN_MAX_AGE_MS. Planning
   * walks every tile in reach, which every frame cost more than drawing.
   */
  private plan: FarLodPlan | null = null;
  private planVersion = 0;
  private plannedVersion = -1;
  private plannedAt = new Vector2(Infinity, Infinity);
  private plannedTime = -Infinity;

  private palette: Float32Array;

  /** The materials as GPU data, once every face they need has been read. */
  private materialTable: FarMaterialTable | null = null;

  /** Faces read so far, by `block:side`. */
  private faceLooks = new Map<string, FarFaceLook>();

  /** When each still unreadable face was first asked for. */
  private faceWaitingSince = new Map<string, number>();

  private layersTexture: DataArrayTexture;

  private materialsTexture: DataTexture;

  /** The layer's own uniforms: its textures, windows, ring and colours. */
  private uniforms: FarTerrainUniforms;

  private landMaterial: NodeMaterial;

  private waterMaterial: NodeMaterial;

  private water: Mesh;

  private seabedMaterial: NodeMaterial;

  private seabed: Mesh;

  private waterSpan = 0;

  private coverage: Uint8Array;

  private coverageTexture: DataTexture;

  private coverageGeneration = -1;

  private coverageCenter: [number, number] | null = null;

  private coverageRadius = -1;

  private coverageBuiltAt = 0;

  /**
   * Tiles drawn and fully dissolved in, at whatever detail, and those still
   * dissolving out under their replacement: the ones that stand in for a
   * chunk column still on its way outside the guard radius
   * (`pendingGuardRadius`).
   */
  private standIns = new Set<string>();

  /** The set the next frame's stand-ins are gathered in, swapped on change. */
  private nextStandIns = new Set<string>();

  /** The plan `drawnIds` and `keepIds` were taken from (`takePlanIds`). */
  private idsPlan: FarLodPlan | null = null;
  private readonly drawnIds = new Set<string>();
  private readonly keepIds = new Set<string>();

  /** Resident tiles hidden and faded out, gathered each frame. */
  private readonly idleTiles: [string, ResidentTile][] = [];

  /** Bumped whenever `standIns` changes, so the mask follows it. */
  private standInGeneration = 0;

  private coverageStandIns = -1;

  /** Loaded chunks the far layer still stands in for (`isHeld`), and those that have settled once. */
  private heldColumns = new Set<string>();
  private settledColumns = new Set<string>();

  /**
   * The chunks the world hid this frame (`hidesChunk`), which the mask
   * then holds; null on a frame the world asked about none, when the mask
   * holds none either. Whether one changed hands since the mask was built.
   */
  private hiddenChunks: Set<string> | null = null;
  private readonly hiddenChunksScratch = new Set<string>();
  private isHoldChanged = false;

  /** Sea depth per texel (0 dry, 255 at DEPTH_RANGE or deeper), around the viewer. */
  private depth = new Uint8Array(DEPTH_TEXELS * DEPTH_TEXELS).fill(255);

  /** The level of the tile each depth texel came from (255 none), so a coarser one never overwrites a finer. */
  private depthLevel = new Uint8Array(DEPTH_TEXELS * DEPTH_TEXELS).fill(255);

  private depthTexture: DataTexture;

  /**
   * The highest surface per depth-map texel, ground or canopy, from the
   * finest tile over it (the tallest sample of that tile): what casts the
   * far layer's sun shadows. `heightLevel` keeps finer over coarser.
   */
  private heights = new Float32Array(DEPTH_TEXELS * DEPTH_TEXELS).fill(
    FAR_SHADOW_NONE,
  );
  private heightLevel = new Uint8Array(DEPTH_TEXELS * DEPTH_TEXELS).fill(255);
  private heightsVersion = 0;

  /** Shadow lines per texel as half floats, from the worker. */
  private shadowTexture: DataTexture;

  /** `(originX, originZ, blocks per texel, texels)` the shadow lines cover; w 0 while there are none. */
  private get shadowWindow() {
    return this.uniforms.shadowWindow;
  }

  /** The heights and sun the last shadow job ran on, and whether one is out. */
  private shadowedVersion = -1;
  private shadowedSun = new Vector3(0, -1, 0);
  private shadowedAt = -Infinity;
  private isShadowing = false;

  /** `(originX, originZ, blocks per texel, texels)` of the depth map. */
  private get depthWindow() {
    return this.uniforms.depthWindow;
  }

  private depthCenter: [number, number] | null = null;

  private get seabedColor() {
    return this.uniforms.seabedColor;
  }

  private get waterColor() {
    return this.uniforms.waterColor;
  }

  private skyTop: [number, number, number];

  private skySide: [number, number, number];

  private chunkSize = 16;

  /** Horizontal centre the reach is measured from, shared by every material. */
  private get ringCenter() {
    return this.uniforms.ringCenter;
  }

  /** `(start, end)` of the band across which the layer thins into haze. */
  private get farEdge() {
    return this.uniforms.farEdge;
  }

  /** `(start, end)` of the far water's depth ramp past the loaded edge. */

  /** The fade of the mesh about to draw, written per draw. */
  /** Every tile's land and floating-land meshes, drawn as one. */
  public readonly batch: FarBatch;

  /** Bumped by configure and clearTiles, so a build in flight that was asked for an older layer is dropped. */
  private epoch = 0;

  private shared: FarTerrainSharedUniforms;

  constructor(
    shared: FarTerrainSharedUniforms,
    options: Partial<FarTerrainOptions> = {},
  ) {
    super();
    this.name = "far-terrain";
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.shared = shared;
    this.palette = Float32Array.from(this.options.palette);
    this.skyTop = colorTriple(this.options.skyTopColor);
    this.skySide = colorTriple(this.options.skySideColor);

    this.coverage = new Uint8Array(COVERAGE_SIZE * COVERAGE_SIZE);
    this.coverageTexture = new DataTexture(
      this.coverage,
      COVERAGE_SIZE,
      COVERAGE_SIZE,
      RedFormat,
      UnsignedByteType,
    );
    // Linear so the mask reads as a ramp across the loaded edge for the
    // seam band; the per-chunk answer samples texel centres.
    this.coverageTexture.magFilter = LinearFilter;
    this.coverageTexture.minFilter = LinearFilter;
    this.coverageTexture.needsUpdate = true;
    shared.farCoverMask.value = this.coverageTexture;
    shared.farCover.value.set(0, 0, this.chunkSize, COVERAGE_SIZE);
    shared.farSeam.value = 0;

    this.depthTexture = new DataTexture(
      this.depth,
      DEPTH_TEXELS,
      DEPTH_TEXELS,
      RedFormat,
      UnsignedByteType,
    );
    this.depthTexture.magFilter = LinearFilter;
    this.depthTexture.minFilter = LinearFilter;
    this.depthTexture.needsUpdate = true;

    this.shadowTexture = new DataTexture(
      new Uint16Array(DEPTH_TEXELS * DEPTH_TEXELS),
      DEPTH_TEXELS,
      DEPTH_TEXELS,
      RedFormat,
      HalfFloatType,
    );
    this.shadowTexture.magFilter = LinearFilter;
    this.shadowTexture.minFilter = LinearFilter;
    this.shadowTexture.needsUpdate = true;

    this.layersTexture = new DataArrayTexture(
      new Uint8Array(FAR_LAYER_SIZE * FAR_LAYER_SIZE * 4).fill(128),
      FAR_LAYER_SIZE,
      FAR_LAYER_SIZE,
      1,
    );
    this.materialsTexture = new DataTexture(
      new Float32Array(FAR_MATERIAL_TEXELS * 4),
      FAR_MATERIAL_TEXELS,
      1,
      RGBAFormat,
      FloatType,
    );

    this.uniforms = createFarTerrainUniforms({
      layers: this.layersTexture,
      materials: this.materialsTexture,
      shadow: this.shadowTexture,
      depth: this.depthTexture,
    });
    this.uniforms.shadowWindow.value.set(0, 0, DEPTH_BLOCKS_PER_TEXEL, 0);
    this.uniforms.depthWindow.value.set(
      0,
      0,
      DEPTH_BLOCKS_PER_TEXEL,
      DEPTH_TEXELS,
    );
    this.seabedColor.value.set(this.options.waterColor);
    this.waterColor.value.set(this.options.waterColor);

    this.landMaterial = createFarLandMaterial(shared, this.uniforms);
    this.batch = new FarBatch(this.landMaterial);
    this.add(this.batch.root);
    this.waterMaterial = createFarWaterMaterial(
      shared,
      this.uniforms,
      DEPTH_RANGE,
    );
    this.water = new Mesh(new PlaneGeometry(1, 1), this.waterMaterial);
    this.water.name = "far-terrain-water";
    this.water.rotation.x = -Math.PI / 2;
    this.water.castShadow = false;
    this.water.receiveShadow = false;
    this.water.frustumCulled = false;
    this.water.visible = false;
    this.add(this.water);
    this.seabedMaterial = createFarSeabedMaterial(shared, this.uniforms);
    // Rides the water plane, `FAR_SEABED_DROP` below it (the plane's local
    // z is world up).
    this.seabed = new Mesh(this.water.geometry, this.seabedMaterial);
    this.seabed.name = "far-terrain-seabed";
    this.seabed.position.z = -FAR_SEABED_DROP;
    this.seabed.castShadow = false;
    this.seabed.receiveShadow = false;
    this.seabed.frustumCulled = false;
    this.water.add(this.seabed);
  }

  /** The server's description of its far terrain, or null for none. */
  configure(descriptor: FarTerrainDescriptor | null) {
    const valid =
      descriptor &&
      Number.isFinite(descriptor.baseStep) &&
      descriptor.baseStep >= 1 &&
      Number.isFinite(descriptor.tileSamples) &&
      descriptor.tileSamples >= 2 &&
      Number.isFinite(descriptor.levels) &&
      descriptor.levels >= 1
        ? descriptor
        : null;
    if (JSON.stringify(valid) === JSON.stringify(this.descriptor)) return;
    this.descriptor = valid;
    this.budgetTokens = null;
    this.clearTiles();
    this.materialTable = null;
  }

  /**
   * Replaces the colour of every class (linear RGB, flattened) for a server
   * whose descriptor names no materials; tiles built from here on use it. A
   * source whose classes are discovered as tiles arrive (block ids, say)
   * grows its palette before handing each tile in.
   */
  setPalette(palette: ArrayLike<number>) {
    this.palette = Float32Array.from(palette);
    if (!this.descriptor?.materials?.length) this.materialTable = null;
  }

  /**
   * Read every face the descriptor's materials name now, a slice at a time,
   * for a load phase to await once the block textures are painted: each
   * atlas read waits on the GPU, a stall that belongs behind a loading
   * screen, not in the frame a player switches the layer on. Settles once
   * the materials are ready (a face that never becomes readable is greyed
   * after `faceLookTimeoutMs`), at once for a world without materials.
   */
  async warmLooks() {
    while (!this.resolveMaterials(performance.now())) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  /** The reach in blocks; 0 switches the layer off and frees its tiles. */
  get distance() {
    return this.options.distance;
  }

  set distance(distance: number) {
    const next = Math.max(0, Math.floor(distance));
    if (next === this.options.distance) return;
    this.options.distance = next;
    this.planVersion += 1;
    if (next === 0) this.clearTiles();
  }

  /** The far reach when the layer is drawing, else 0 (for the fog range). */
  get reach() {
    return this.descriptor && this.options.distance > 0
      ? this.options.distance
      : 0;
  }

  get isActive() {
    return this.reach > 0;
  }

  /**
   * One frame: plan which tiles to draw, ask for the missing ones, ease the
   * detail changes, drop what is no longer wanted, refresh the chunk-coverage
   * mask when chunks changed, and hand new tiles to the mesher.
   *
   * `isChunkPending` says whether a chunk column inside the render radius
   * still owes its terrain (not loaded, or loaded with its mesh still being
   * built at some level; a loaded, meshed chunk with nothing to draw is not
   * pending): the mask covers those within `pendingGuardRadius` of the
   * viewer, so a coarse tile never shows through the walls around it.
   * Further out, a drawn tile over such a column keeps drawing until the
   * chunk lands instead of opening a hole of sky. A chunk that has landed
   * there is held for exactly as long as the world hides it, which it
   * asks `hidesChunk` before this runs each frame.
   */
  update(
    position: Vector3,
    world: {
      renderRadius: number;
      chunkSize: number;
      loadedGeneration: number;
      forEachMeshedChunk: (callback: (cx: number, cz: number) => void) => void;
      isChunkPending: (cx: number, cz: number) => boolean;
    },
  ) {
    const started = performance.now();
    const elapsed = Number.isFinite(this.lastUpdateAt)
      ? Math.min(250, started - this.lastUpdateAt)
      : 0;
    this.lastUpdateAt = started;
    const descriptor = this.descriptor;
    this.chunkSize = world.chunkSize;
    if (!descriptor || this.options.distance <= 0) {
      this.visible = false;
      this.hiddenChunks = null;
      this.stats.isActive = false;
      this.stats.rings = 0;
      this.stats.distance = 0;
      this.shared.farSeam.value = 0;
      return;
    }
    this.visible = true;
    this.stats.isActive = true;
    this.stats.distance = this.options.distance;
    this.ringCenter.value.set(position.x, position.z);
    this.shared.farSeam.value = farSeamScale(
      world.chunkSize,
      this.options.seamBand,
    );
    this.uniforms.ringOuter.value = this.options.distance;

    let plan = this.plan;
    if (
      !plan ||
      this.plannedVersion !== this.planVersion ||
      started - this.plannedTime > PLAN_MAX_AGE_MS ||
      Math.hypot(
        position.x - this.plannedAt.x,
        position.z - this.plannedAt.y,
      ) >= PLAN_MOVE_BLOCKS
    ) {
      plan = planFarLod(
        descriptor,
        position.x,
        position.z,
        this.options.distance,
        this.options.lod,
        (key) => this.resident.get(farTileId(key))?.isBuilt === true,
        (key) => this.reliefs.get(farTileId(key)) ?? null,
      );
      this.plan = plan;
      this.plannedVersion = this.planVersion;
      this.plannedAt.set(position.x, position.z);
      this.plannedTime = started;
    }
    this.stats.tilesWanted = plan.wanted.length;
    this.requestTiles(plan, started);
    this.applyDrawn(plan, started, elapsed);
    this.updateCoverage(position, world);
    this.updateDepth(position);
    this.updateShadow(started);
    this.updateWater(position, descriptor);
    this.farEdge.value.set(
      this.options.distance * (1 - this.options.edgeBand),
      this.options.distance,
    );
    if (this.resolveMaterials(started)) this.dispatchBuilds();

    this.stats.tilesResident = this.resident.size;
    this.stats.lastUpdateMs = performance.now() - started;
    this.stats.totalUpdateMs += this.stats.lastUpdateMs;
    this.stats.updates += 1;
    this.stats.peakUpdateMs = Math.max(
      this.stats.peakUpdateMs,
      this.stats.lastUpdateMs,
    );
  }

  /** The batch slots the resident tiles hold, land and floating land. */
  tileSlots(): FarBatchSlot[] {
    const slots: FarBatchSlot[] = [];
    for (const tile of this.resident.values()) {
      if (tile.land) slots.push(tile.land);
      if (tile.sky) slots.push(tile.sky);
    }
    return slots;
  }

  /** A method reply to hand over; ignored unless it is a far-terrain tile. */
  onMethodReply(name: string, payload: unknown) {
    if (name !== FAR_TERRAIN_METHOD) return;
    const tile = decodeFarTerrainReply(payload);
    if (!tile) {
      this.stats.tilesRejected += 1;
      return;
    }
    const id = farTileId(tile.key);
    this.pending.delete(id);
    this.stats.tilesReceived += 1;
    this.stats.bytesReceived += tile.bytes;
    if (!this.descriptor) return;
    const existing = this.resident.get(id);
    if (existing) this.disposeTile(existing);
    if (this.depthCenter) this.writeDepth(tile);
    this.reliefs.set(id, reliefOf(tile));
    this.planVersion += 1;
    this.resident.set(id, {
      data: tile,
      land: null,
      sky: null,
      isBuilt: false,
      isBuilding: false,
      opacity: 0,
      isDrawn: false,
      lastDrawnAt: performance.now(),
      bytes: 0,
      failedBuilds: 0,
      counts: null,
    });
  }

  /** Requests queued since the last call, for the world to send. */
  takePackets(): MessageProtocol[] {
    if (this.queuedRequests.length === 0) return [];
    const packets = this.queuedRequests;
    this.queuedRequests = [];
    return packets;
  }

  /** Reset the peak and the running mean so a measurement window starts clean. */
  resetPeaks() {
    this.stats.peakUpdateMs = 0;
    this.stats.totalUpdateMs = 0;
    this.stats.updates = 0;
    this.stats.peakBuildMs = 0;
    this.stats.peakUploadMs = 0;
  }

  /** Drop every tile and forget what was asked for. */
  clearTiles() {
    for (const tile of this.resident.values()) this.disposeTile(tile);
    this.resident.clear();
    this.reliefs.clear();
    this.planVersion += 1;
    this.pending.clear();
    this.queuedRequests = [];
    this.epoch += 1;
    this.stats.tilesResident = 0;
    this.stats.tilesDrawn = 0;
    this.stats.meshes = 0;
    this.stats.triangles = 0;
    this.stats.meshBytes = 0;
    this.stats.buildsInFlight = 0;
    this.water.visible = false;
  }

  dispose() {
    this.clearTiles();
    this.batch.dispose();
    this.landMaterial.dispose();
    this.waterMaterial.dispose();
    this.seabedMaterial.dispose();
    this.water.geometry.dispose();
    this.coverageTexture.dispose();
    this.layersTexture.dispose();
    this.materialsTexture.dispose();
    this.depthTexture.dispose();
    this.shadowTexture.dispose();
  }

  /** Asks for the plan's missing tiles, its fallbacks first. */
  private requestTiles(plan: FarLodPlan, now: number) {
    if (plan.fallback.length + plan.wanted.length === 0) return;
    if (now - this.lastRequestAt < this.options.requestIntervalMs) return;
    const cap = Math.min(
      this.options.maxTilesPerRequest,
      this.budgetAllowance(now),
    );
    if (cap < 1) return;
    const tiles: [number, number, number][] = [];
    for (const keys of [plan.fallback, plan.wanted]) {
      for (const key of keys) {
        if (tiles.length >= cap) break;
        const id = farTileId(key);
        if (this.resident.has(id)) continue;
        const askedAt = this.pending.get(id);
        if (askedAt !== undefined && now - askedAt < this.options.retryAfterMs)
          continue;
        tiles.push([key.level, key.tx, key.tz]);
        this.pending.set(id, now);
      }
    }
    if (tiles.length === 0) return;
    if (this.budgetTokens !== null) this.budgetTokens -= tiles.length;
    this.lastRequestAt = now;
    this.stats.tilesRequested += tiles.length;
    this.queuedRequests.push({
      type: "METHOD",
      method: {
        name: FAR_TERRAIN_METHOD,
        payload: JSON.stringify({ tiles }),
      },
    } as MessageProtocol);
  }

  /**
   * How many tiles a request may name now under the server's budget,
   * refilled by wall time as the server refills its own and kept
   * `budgetHeadroom` short of it; unlimited when the descriptor names none.
   */
  private budgetAllowance(now: number) {
    const budget = this.descriptor?.budget;
    if (!budget || !(budget.tilesPerSecond > 0) || !(budget.burst > 0))
      return Infinity;
    const capacity = Math.max(1, budget.burst - this.options.budgetHeadroom);
    const tokens =
      this.budgetTokens === null
        ? capacity
        : this.budgetTokens +
          ((now - this.budgetRefilledAt) / 1000) * budget.tilesPerSecond;
    this.budgetTokens = Math.min(capacity, tokens);
    this.budgetRefilledAt = now;
    return Math.min(budget.maxTilesPerRequest, Math.floor(this.budgetTokens));
  }

  /**
   * Ease every resident tile toward drawn or hidden, and drop the ones no
   * plan wants that have faded out: least recently drawn first once there
   * are more than `maxResidentTiles`, and any no plan has wanted for a few
   * seconds. Pending asks no plan wants any more are forgotten too.
   */
  private applyDrawn(plan: FarLodPlan, now: number, elapsed: number) {
    // The ids a plan draws and keeps only change with the plan: taken once
    // per plan, not once per frame.
    if (this.idsPlan !== plan) {
      this.idsPlan = plan;
      this.takePlanIds(plan);
      for (const id of this.pending.keys()) {
        if (!this.keepIds.has(id)) this.pending.delete(id);
      }
    }
    const { drawnIds, keepIds } = this;
    const step = this.options.fadeMs > 0 ? elapsed / this.options.fadeMs : 1;
    const levels = this.stats.levelCounts;
    levels.length = this.descriptor?.levels ?? 0;
    levels.fill(0);
    let meshes = 0;
    let triangles = 0;
    let bytes = 0;
    const quads = this.stats.quads;
    quads.tops = 0;
    quads.risers = 0;
    quads.skirts = 0;
    quads.crowns = 0;
    const idle = this.idleTiles;
    idle.length = 0;
    const standIns = this.nextStandIns;
    standIns.clear();
    for (const [id, tile] of this.resident) {
      const isDrawn = drawnIds.has(id);
      if (isDrawn) {
        tile.lastDrawnAt = now;
        levels[tile.data.key.level] = (levels[tile.data.key.level] ?? 0) + 1;
        if (tile.counts) {
          quads.tops += tile.counts.tops;
          quads.risers += tile.counts.risers;
          quads.skirts += tile.counts.skirts;
          quads.crowns += tile.counts.crowns;
        }
      }
      tile.isDrawn = isDrawn;
      // With nothing of its ground on screen there is nothing to dissolve
      // over (a teleport's end, a tile kept from an earlier visit): it shows
      // whole at once instead of rising out of the sky.
      if (isDrawn && tile.opacity === 0 && !this.isGroundShown(tile.data.key)) {
        tile.opacity = 1;
      }
      tile.opacity = Math.min(
        1,
        Math.max(0, tile.opacity + (isDrawn ? step : -step)),
      );
      // A stand-in keeps standing in while it dissolves out under what
      // replaces it: together the two draw every pixel of their ground.
      if (
        isDrawn ? tile.opacity >= 1 : tile.opacity > 0 && this.standIns.has(id)
      ) {
        standIns.add(id);
      }
      for (const slot of [tile.land, tile.sky]) {
        if (!slot) continue;
        this.batch.setFade(slot, tile.opacity, tile.isDrawn);
        if (slot.visible) {
          meshes += 1;
          triangles += slot.vertexCount / 3;
        }
      }
      bytes += tile.bytes;
      if (!isDrawn && tile.opacity === 0 && !keepIds.has(id)) {
        idle.push([id, tile]);
      }
    }
    // Idle tiles leave after a short stay, so turning back is free; the
    // oldest leave at once past the cap.
    idle.sort((a, b) => a[1].lastDrawnAt - b[1].lastDrawnAt);
    let excess = this.resident.size - this.options.maxResidentTiles;
    for (const [id, tile] of idle) {
      if (excess <= 0 && now - tile.lastDrawnAt < this.options.evictAfterMs)
        continue;
      this.disposeTile(tile);
      this.resident.delete(id);
      this.planVersion += 1;
      excess -= 1;
    }
    let isStandInChanged = standIns.size !== this.standIns.size;
    if (!isStandInChanged) {
      for (const id of standIns) {
        if (this.standIns.has(id)) continue;
        isStandInChanged = true;
        break;
      }
    }
    if (isStandInChanged) {
      this.nextStandIns = this.standIns;
      this.standIns = standIns;
      this.standInGeneration += 1;
    }
    this.stats.tilesDrawn = drawnIds.size;
    this.stats.meshes = meshes;
    this.stats.batchPages = this.batch.pages.length;
    this.stats.triangles = triangles;
    this.stats.meshBytes = bytes;
    let rings = 0;
    for (const count of levels) if (count > 0) rings += 1;
    this.stats.rings = rings;
  }

  /**
   * The ids `plan` draws, and those it keeps resident: what it draws or
   * wants, its fallbacks, and every coarser tile over what it draws or
   * wants (the stand-in it falls back to when the viewer outruns the finer
   * tiles; without it the layer opens a hole until a refetch lands).
   */
  private takePlanIds(plan: FarLodPlan) {
    const { drawnIds, keepIds } = this;
    drawnIds.clear();
    keepIds.clear();
    for (const key of plan.drawn) drawnIds.add(farTileId(key));
    for (const key of plan.wanted) keepIds.add(farTileId(key));
    for (const key of plan.fallback) keepIds.add(farTileId(key));
    const top = (this.descriptor?.levels ?? 1) - 1;
    const ancestors = new Set<string>();
    for (const keys of [plan.drawn, plan.wanted]) {
      for (const key of keys) {
        let { level, tx, tz } = key;
        while (level < top) {
          level += 1;
          tx = Math.floor(tx / 2);
          tz = Math.floor(tz / 2);
          const id = farTileId({ level, tx, tz });
          if (ancestors.has(id)) break;
          ancestors.add(id);
          keepIds.add(id);
        }
      }
    }
  }

  /**
   * Whether the materials are on the GPU, reading the faces the
   * descriptor's materials name off the atlas, as many a frame as the build
   * budget allows (at least one). Tiles wait for it: a tile built before
   * would wear placeholder colours. A face still unreadable after
   * `faceLookTimeoutMs` is painted grey, and the layer says which.
   */
  private resolveMaterials(started: number): boolean {
    if (this.materialTable) return true;
    const materials = this.descriptor?.materials;
    const faceLook = this.options.faceLook;
    if (!materials?.length || !faceLook) {
      const table = farPaletteTable(this.palette, this.skyTop, this.skySide);
      this.installMaterials(table, table.classes - 1);
      return true;
    }
    let pending = 0;
    let read = 0;
    const trees = this.descriptor?.trees ?? [];
    for (const [block, side, stage] of farMaterialFaces(materials, trees)) {
      const key = farFaceKey(block, side, stage);
      if (this.faceLooks.has(key)) continue;
      if (
        read > 0 &&
        performance.now() - started > this.options.buildBudgetMs
      ) {
        pending += 1;
        continue;
      }
      const readAt = performance.now();
      const look = faceLook(block, side, stage);
      read += 1;
      this.stats.faceLookMs += performance.now() - readAt;
      if (look) {
        this.faceLooks.set(key, look);
        this.faceWaitingSince.delete(key);
        continue;
      }
      const since = this.faceWaitingSince.get(key) ?? started;
      this.faceWaitingSince.set(key, since);
      if (started - since < this.options.faceLookTimeoutMs) {
        pending += 1;
        continue;
      }
      console.warn(
        `[far-terrain] block ${block}'s ${side} face never became readable in ${this.options.faceLookTimeoutMs} ms; the far layer paints it grey`,
      );
      this.faceLooks.set(key, GREY_LOOK);
      this.stats.facesMissing += 1;
    }
    this.stats.facesResolved = this.faceLooks.size;
    this.stats.facesPending = pending;
    if (pending > 0) return false;
    const table = buildFarMaterialTable(
      materials,
      (block, side, stage) =>
        this.faceLooks.get(farFaceKey(block, side, stage)) ?? GREY_LOOK,
      trees,
    );
    const seabed = this.descriptor?.seabedMaterial;
    if (seabed !== undefined && materials[seabed]) {
      const look = this.faceLooks.get(`${materials[seabed].top}:top`);
      if (look) this.seabedColor.value.setRGB(...look.color);
    }
    const sky = this.descriptor?.skyMaterial;
    this.installMaterials(
      table,
      sky !== undefined && sky >= 0 && sky < table.classes ? sky : null,
    );
    return true;
  }

  private skyClass = 0;

  private installMaterials(table: FarMaterialTable, skyClass: number | null) {
    const previous = this.materialTable;
    const sameClasses =
      previous !== null &&
      previous.treeClass === table.treeClass &&
      this.skyClass === (skyClass ?? 0);
    this.materialTable = table;
    this.layersTexture.dispose();
    const layers = new DataArrayTexture(
      table.layers,
      FAR_LAYER_SIZE,
      FAR_LAYER_SIZE,
      table.layerCount,
    );
    layers.format = RGBAFormat;
    layers.type = UnsignedByteType;
    layers.colorSpace = SRGBColorSpace;
    layers.wrapS = RepeatWrapping;
    layers.wrapT = RepeatWrapping;
    layers.magFilter = NearestFilter;
    layers.minFilter = LinearMipmapLinearFilter;
    layers.generateMipmaps = true;
    layers.anisotropy = 8;
    layers.needsUpdate = true;
    this.layersTexture = layers;
    this.uniforms.layers.value = layers;

    this.materialsTexture.dispose();
    const rows = new DataTexture(
      table.table,
      FAR_MATERIAL_TEXELS,
      table.classes,
      RGBAFormat,
      FloatType,
    );
    rows.magFilter = NearestFilter;
    rows.minFilter = NearestFilter;
    rows.needsUpdate = true;
    this.materialsTexture = rows;
    this.uniforms.materials.value = rows;

    this.skyClass = skyClass ?? 0;
    // Faces paint from the table at draw time; tiles bake only class
    // indices, so they rebuild only when those move.
    if (sameClasses) return;
    for (const tile of this.resident.values()) {
      tile.isBuilt = false;
      this.planVersion += 1;
      this.planVersion += 1;
      tile.isBuilding = false;
    }
  }

  /** Hand unbuilt tiles to the mesher, nearest drawn-or-wanted first. */
  private dispatchBuilds() {
    const table = this.materialTable;
    if (!table) return;
    const build = this.options.buildMesh ?? workerBuild;
    const center = this.ringCenter.value;
    const queue = Array.from(this.resident.values())
      .filter(
        (tile) =>
          !tile.isBuilt &&
          !tile.isBuilding &&
          tile.failedBuilds < MAX_BUILD_ATTEMPTS,
      )
      .sort(
        (a, b) => this.tileDistance(a, center) - this.tileDistance(b, center),
      );
    for (const tile of queue) {
      if (this.stats.buildsInFlight >= this.options.maxBuildsInFlight) break;
      const { data } = tile;
      const span = (data.size - 1) * data.step;
      const input: FarMeshInput = {
        originX: data.key.tx * span,
        originZ: data.key.tz * span,
        step: data.step,
        size: data.size,
        heights: data.heights,
        classes: data.colors,
        tints: data.tints,
        sky: data.sky,
        canopy: data.canopy,
        classCount: table.treeClass,
        treeClass: table.treeClass,
        skyClass: this.skyClass,
        waterSurface: this.descriptor?.waterSurface ?? null,
      };
      tile.isBuilding = true;
      this.stats.buildsInFlight += 1;
      const epoch = this.epoch;
      build(input).then((built) => {
        if (epoch !== this.epoch) return;
        this.stats.buildsInFlight = Math.max(0, this.stats.buildsInFlight - 1);
        const id = farTileId(data.key);
        if (this.resident.get(id) !== tile) return;
        tile.isBuilding = false;
        if (!built) {
          tile.failedBuilds += 1;
          if (tile.failedBuilds >= MAX_BUILD_ATTEMPTS) {
            console.error(
              `[far-terrain] tile ${id} failed to build ${tile.failedBuilds} times; its coarser tile stands in for it`,
            );
          } else {
            console.warn(
              `[far-terrain] tile ${id} failed to build; trying again`,
            );
          }
          return;
        }
        this.installTile(tile, built, input.originX, input.originZ, span);
      });
    }
  }

  private tileDistance(tile: ResidentTile, center: Vector2) {
    const { key, size, step } = tile.data;
    const span = (size - 1) * step;
    const cx = key.tx * span + span / 2;
    const cz = key.tz * span + span / 2;
    return Math.hypot(cx - center.x, cz - center.y);
  }

  private installTile(
    tile: ResidentTile,
    built: FarBuiltTile,
    originX: number,
    originZ: number,
    span: number,
  ) {
    const started = performance.now();
    for (const slot of [tile.land, tile.sky]) {
      if (slot) this.batch.remove(slot);
    }
    tile.bytes = 0;
    const name = farTileId(tile.data.key);
    tile.land = built.land
      ? this.slotFor(
          built.land,
          originX,
          originZ,
          span,
          tile,
          `far-terrain-${name}`,
        )
      : null;
    tile.sky = built.sky
      ? this.slotFor(
          built.sky,
          originX,
          originZ,
          span,
          tile,
          `far-terrain-sky-${name}`,
        )
      : null;
    tile.counts = built.land?.counts ?? null;
    tile.isBuilt = true;
    this.planVersion += 1;
    this.stats.tilesBuilt += 1;
    this.stats.lastBuildMs = built.buildMs;
    this.stats.peakBuildMs = Math.max(this.stats.peakBuildMs, built.buildMs);
    this.stats.lastUploadMs = performance.now() - started;
    this.stats.peakUploadMs = Math.max(
      this.stats.peakUploadMs,
      this.stats.lastUploadMs,
    );
  }

  private slotFor(
    data: FarMeshData,
    originX: number,
    originZ: number,
    span: number,
    tile: ResidentTile,
    name: string,
  ) {
    tile.bytes +=
      data.position.byteLength +
      data.column.byteLength +
      data.material.byteLength +
      data.tint.byteLength;
    return this.batch.add(data, originX, originZ, span, name);
  }

  private updateCoverage(
    position: Vector3,
    world: {
      renderRadius: number;
      chunkSize: number;
      loadedGeneration: number;
      forEachMeshedChunk: (callback: (cx: number, cz: number) => void) => void;
      isChunkPending: (cx: number, cz: number) => boolean;
    },
  ) {
    const cx = Math.floor(position.x / world.chunkSize);
    const cz = Math.floor(position.z / world.chunkSize);
    const originCx = cx - COVERAGE_SIZE / 2;
    const originCz = cz - COVERAGE_SIZE / 2;
    const centerMoved =
      !this.coverageCenter ||
      this.coverageCenter[0] !== cx ||
      this.coverageCenter[1] !== cz;
    // Pending columns change when a chunk loads (the generation), when
    // the radius they are counted within does, and, while any are still
    // counted, as their grace runs out or the tiles fit to stand in for
    // them change.
    const now = performance.now();
    const isRecheckDue =
      this.stats.pendingCovered + this.heldColumns.size > 0 &&
      now - this.coverageBuiltAt >= PENDING_RECHECK_MS;
    const isStandInStale =
      this.coverageStandIns !== this.standInGeneration &&
      this.stats.pendingCovered + this.stats.pendingStoodIn > 0;
    // The chunks the world hid this frame are the ones held: taken now, so
    // a frame the world asks about none starts from none.
    const hidden = this.hiddenChunks;
    this.hiddenChunks = null;
    const isHoldChanged =
      this.isHoldChanged || (hidden?.size ?? 0) !== this.heldColumns.size;
    this.isHoldChanged = false;
    if (
      !centerMoved &&
      this.coverageGeneration === world.loadedGeneration &&
      this.coverageRadius === world.renderRadius &&
      !isRecheckDue &&
      !isStandInStale &&
      !isHoldChanged
    )
      return;
    this.coverageBuiltAt = now;
    this.coverageCenter = [cx, cz];
    this.coverageGeneration = world.loadedGeneration;
    this.coverageRadius = world.renderRadius;
    this.coverageStandIns = this.standInGeneration;
    const covered: [number, number][] = [];
    let stoodIn = 0;
    for (const column of pendingChunksWithin(
      cx,
      cz,
      world.renderRadius,
      world.isChunkPending,
    )) {
      if (
        !this.isGuarded(column[0], column[1]) &&
        this.isStoodIn(column[0], column[1], world.chunkSize)
      )
        stoodIn += 1;
      else covered.push(column);
    }
    this.stats.pendingCovered = covered.length;
    this.stats.pendingStoodIn = stoodIn;
    // A chunk landing where the far layer draws keeps the far layer until
    // every section of it has meshed: the world hides it meanwhile
    // (`hidesChunk`), and both change hands in one frame instead of the
    // column opening onto the sky section by section. The world's answer
    // this frame is the hold, so the two never both draw a column, nor
    // neither. Only a first landing is held; a chunk that has settled once
    // keeps drawing through a remesh.
    const held = new Set<string>();
    const settled = new Set<string>();
    world.forEachMeshedChunk((x, z) => {
      const key = `${x},${z}`;
      if (hidden?.has(key)) {
        held.add(key);
        return;
      }
      if (this.settledColumns.has(key) || !world.isChunkPending(x, z)) {
        settled.add(key);
      }
      covered.push([x, z]);
    });
    this.heldColumns = held;
    this.settledColumns = settled;
    this.stats.chunksHeld = held.size;
    buildCoverageMask(
      covered,
      originCx,
      originCz,
      COVERAGE_SIZE,
      this.coverage,
    );
    this.shared.farCover.value.set(
      originCx,
      originCz,
      world.chunkSize,
      COVERAGE_SIZE,
    );
    this.coverageTexture.needsUpdate = true;
    this.stats.maskRebuilds += 1;
  }

  /**
   * Whether a loaded chunk is still being held back for the far layer:
   * landed where the far layer draws and not every section meshed yet, as
   * of the last `update`.
   */
  isHeld(cx: number, cz: number) {
    return this.visible && this.heldColumns.has(`${cx},${cz}`);
  }

  /**
   * Whether the world hides a loaded chunk this frame, asked once per chunk
   * ahead of `update`, which then holds exactly the chunks hidden here: a
   * chunk still owing meshes (`isPending`, asked only when it matters)
   * that landed where the layer draws its column hides until it has
   * meshed whole. Deciding both in one place is what keeps a column from
   * being drawn twice: a chunk shown the frame it landed, before the next
   * update held it, flashed through the stand-in, and one that finished
   * without a mesh landing (its grace out, a stranded job swept) drew over
   * the stand-in until the mask's next recheck.
   */
  hidesChunk(cx: number, cz: number, isPending: () => boolean): boolean {
    if (!this.visible) return false;
    if (!this.hiddenChunks) {
      this.hiddenChunks = this.hiddenChunksScratch;
      this.hiddenChunks.clear();
    }
    const key = `${cx},${cz}`;
    const hides =
      !this.settledColumns.has(key) && this.drawsColumn(cx, cz) && isPending();
    if (hides) this.hiddenChunks.add(key);
    if (hides !== this.heldColumns.has(key)) this.isHoldChanged = true;
    return hides;
  }

  /**
   * Whether the layer draws the whole of a chunk column, as it does over a
   * column still on its way outside the guard radius. A chunk landing
   * there replaces terrain already on screen, so a host can land it as
   * itself rather than reveal it out of the fog, which would flash over
   * that terrain.
   */
  drawsColumn(cx: number, cz: number) {
    return (
      this.visible &&
      !this.isGuarded(cx, cz) &&
      this.isStoodIn(cx, cz, this.chunkSize)
    );
  }

  /** Whether a coarser or finer tile over the same ground is on screen. */
  private isGroundShown(key: FarTileKey) {
    const isShown = (level: number, tx: number, tz: number) =>
      (this.resident.get(farTileId({ level, tx, tz }))?.opacity ?? 0) > 0;
    const top = (this.descriptor?.levels ?? 1) - 1;
    let { tx, tz } = key;
    for (let level = key.level + 1; level <= top; level++) {
      tx = Math.floor(tx / 2);
      tz = Math.floor(tz / 2);
      if (isShown(level, tx, tz)) return true;
    }
    let span = 1;
    for (let level = key.level - 1; level >= 0; level--) {
      span *= 2;
      for (let i = 0; i < span; i++) {
        for (let j = 0; j < span; j++) {
          if (isShown(level, key.tx * span + i, key.tz * span + j)) return true;
        }
      }
    }
    return false;
  }

  /** Whether a column lies within `pendingGuardRadius` of the viewer's. */
  private isGuarded(cx: number, cz: number) {
    const center = this.coverageCenter;
    if (!center) return true;
    const dx = cx - center[0];
    const dz = cz - center[1];
    const radius = this.options.pendingGuardRadius;
    return dx * dx + dz * dz < radius * radius;
  }

  /**
   * Whether tiles in `standIns` draw the whole of a chunk column: asked at
   * both edges of the column and at every finest tile between, since the
   * drawn tiles cover each square once but need not line up with chunks.
   */
  private isStoodIn(cx: number, cz: number, chunkSize: number) {
    const descriptor = this.descriptor;
    if (!descriptor || this.standIns.size === 0) return false;
    const step = Math.min(chunkSize, farTileSpan(descriptor, 0));
    const offsets: number[] = [];
    for (let offset = 0.5; offset < chunkSize - 0.5; offset += step) {
      offsets.push(offset);
    }
    offsets.push(chunkSize - 0.5);
    for (const ox of offsets) {
      for (const oz of offsets) {
        const x = cx * chunkSize + ox;
        const z = cz * chunkSize + oz;
        let isDrawn = false;
        for (let level = 0; level < descriptor.levels && !isDrawn; level++) {
          const span = farTileSpan(descriptor, level);
          isDrawn = this.standIns.has(
            farTileId({
              level,
              tx: Math.floor(x / span),
              tz: Math.floor(z / span),
            }),
          );
        }
        if (!isDrawn) return false;
      }
    }
    return true;
  }

  /**
   * Lay the sea-depth map out around the viewer again once it has drifted
   * far enough from its centre, from every resident tile, coarse first so
   * the finer ones land on top.
   */
  private updateDepth(position: Vector3) {
    const center = this.depthCenter;
    if (
      center &&
      Math.abs(position.x - center[0]) < DEPTH_RECENTER &&
      Math.abs(position.z - center[1]) < DEPTH_RECENTER
    )
      return;
    const half = (DEPTH_TEXELS * DEPTH_BLOCKS_PER_TEXEL) / 2;
    const originX =
      Math.floor((position.x - half) / DEPTH_BLOCKS_PER_TEXEL) *
      DEPTH_BLOCKS_PER_TEXEL;
    const originZ =
      Math.floor((position.z - half) / DEPTH_BLOCKS_PER_TEXEL) *
      DEPTH_BLOCKS_PER_TEXEL;
    this.depthCenter = [position.x, position.z];
    this.depthWindow.value.set(
      originX,
      originZ,
      DEPTH_BLOCKS_PER_TEXEL,
      DEPTH_TEXELS,
    );
    this.depth.fill(255);
    this.depthLevel.fill(255);
    this.heights.fill(FAR_SHADOW_NONE);
    this.heightLevel.fill(255);
    this.heightsVersion += 1;
    for (const tile of this.resident.values()) this.writeDepth(tile.data);
  }

  /**
   * Cast the far sun shadows again in a worker once the sun has turned a
   * little or the heights have changed, one job at a time; the lines go
   * up with the window they were cast over, so a relayout in between
   * never puts them in the wrong place.
   */
  private updateShadow(now: number) {
    const cast =
      this.options.castShadow ?? (this.options.buildMesh ? null : workerShadow);
    const sun = this.shared.sunDirection.value;
    if (
      !cast ||
      this.isShadowing ||
      !this.depthCenter ||
      now - this.shadowedAt < FAR_SHADOW_MIN_INTERVAL_MS ||
      (this.shadowedVersion === this.heightsVersion &&
        sun.distanceTo(this.shadowedSun) < FAR_SHADOW_SUN_TURN)
    )
      return;
    this.isShadowing = true;
    this.shadowedAt = now;
    this.shadowedVersion = this.heightsVersion;
    this.shadowedSun.copy(sun);
    const window = this.depthWindow.value.clone();
    const epoch = this.epoch;
    cast({
      heights: this.heights.slice(),
      size: DEPTH_TEXELS,
      texelBlocks: DEPTH_BLOCKS_PER_TEXEL,
      sun: [sun.x, sun.y, sun.z],
      maxDistance: FAR_SHADOW_REACH,
    }).then((result) => {
      this.isShadowing = false;
      if (!result || epoch !== this.epoch) return;
      (this.shadowTexture.image.data as Uint16Array).set(result.lines);
      this.shadowTexture.needsUpdate = true;
      this.shadowWindow.value.copy(window);
      this.stats.lastShadowMs = result.buildMs;
    });
  }

  /** A tile's sea depths and heights into the maps, over each sample's own cell. */
  private writeDepth(tile: FarTileData) {
    this.writeHeights(tile);
    const surface = this.descriptor?.waterSurface;
    if (surface === undefined) return;
    const { x: originX, y: originZ } = this.depthWindow.value;
    const span = (tile.size - 1) * tile.step;
    const tileX = tile.key.tx * span;
    const tileZ = tile.key.tz * span;
    const per = DEPTH_BLOCKS_PER_TEXEL;
    let touched = false;
    for (let j = 0; j < tile.size - 1; j++) {
      const z = tileZ + j * tile.step;
      const tz0 = Math.max(0, Math.floor((z - originZ) / per));
      const tz1 = Math.min(
        DEPTH_TEXELS,
        Math.ceil((z + tile.step - originZ) / per),
      );
      if (tz0 >= tz1) continue;
      for (let i = 0; i < tile.size - 1; i++) {
        const x = tileX + i * tile.step;
        const tx0 = Math.max(0, Math.floor((x - originX) / per));
        const tx1 = Math.min(
          DEPTH_TEXELS,
          Math.ceil((x + tile.step - originX) / per),
        );
        if (tx0 >= tx1) continue;
        const height = tile.heights[j * tile.size + i];
        const value = Math.round(
          Math.min(1, Math.max(0, (surface - height) / DEPTH_RANGE)) * 255,
        );
        for (let tz = tz0; tz < tz1; tz++) {
          for (let tx = tx0; tx < tx1; tx++) {
            const at = tz * DEPTH_TEXELS + tx;
            if (this.depthLevel[at] < tile.key.level) continue;
            this.depth[at] = value;
            this.depthLevel[at] = tile.key.level;
            touched = true;
          }
        }
      }
    }
    if (touched) this.depthTexture.needsUpdate = true;
  }

  /**
   * A tile's highest surface per texel, its canopy over the ground where
   * crowns cover most of a sample; a finer tile replaces a coarser one's.
   */
  private writeHeights(tile: FarTileData) {
    const { x: originX, y: originZ } = this.depthWindow.value;
    const span = (tile.size - 1) * tile.step;
    const tileX = tile.key.tx * span;
    const tileZ = tile.key.tz * span;
    const per = DEPTH_BLOCKS_PER_TEXEL;
    const level = tile.key.level;
    let touched = false;
    for (let j = 0; j < tile.size - 1; j++) {
      const z = tileZ + j * tile.step;
      const tz0 = Math.max(0, Math.floor((z - originZ) / per));
      const tz1 = Math.min(
        DEPTH_TEXELS,
        Math.ceil((z + tile.step - originZ) / per),
      );
      if (tz0 >= tz1) continue;
      for (let i = 0; i < tile.size - 1; i++) {
        const x = tileX + i * tile.step;
        const tx0 = Math.max(0, Math.floor((x - originX) / per));
        const tx1 = Math.min(
          DEPTH_TEXELS,
          Math.ceil((x + tile.step - originX) / per),
        );
        if (tx0 >= tx1) continue;
        const sample = j * tile.size + i;
        let height = tile.heights[sample];
        const canopy = tile.canopy;
        if (canopy && canopy[sample * 4] > 0 && canopy[sample * 4 + 2] >= 128) {
          height += canopy[sample * 4];
        }
        for (let tz = tz0; tz < tz1; tz++) {
          for (let tx = tx0; tx < tx1; tx++) {
            const at = tz * DEPTH_TEXELS + tx;
            const was = this.heightLevel[at];
            if (was < level) continue;
            if (was > level) {
              this.heights[at] = height;
              this.heightLevel[at] = level;
            } else if (height > this.heights[at]) {
              this.heights[at] = height;
            }
            touched = true;
          }
        }
      }
    }
    if (touched) this.heightsVersion += 1;
  }

  private updateWater(position: Vector3, descriptor: FarTerrainDescriptor) {
    const span =
      (this.options.distance + farTileSpan(descriptor, descriptor.levels - 1)) *
      2;
    if (span !== this.waterSpan) {
      this.water.geometry.dispose();
      this.water.geometry = new PlaneGeometry(span, span);
      this.seabed.geometry = this.water.geometry;
      this.waterSpan = span;
    }
    this.water.position.set(position.x, descriptor.waterSurface, position.z);
    this.water.visible = true;
  }

  private disposeTile(tile: ResidentTile) {
    for (const slot of [tile.land, tile.sky]) {
      if (slot) this.batch.remove(slot);
    }
    tile.land = null;
    tile.sky = null;
    tile.isBuilt = false;
    this.planVersion += 1;
    tile.isBuilding = false;
    tile.bytes = 0;
  }
}

const GREY_LOOK: FarFaceLook = { color: [0.5, 0.5, 0.5], isTinted: false };

/** How often one tile's build may fail before it is given up on. */
const MAX_BUILD_ATTEMPTS = 3;

function colorTriple(color: Color | string | number): [number, number, number] {
  const c = new Color(color);
  return [c.r, c.g, c.b];
}
