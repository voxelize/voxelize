export type Vec3 = { x: number; y: number; z: number };

export type ChunkCoord = { cx: number; cz: number };

export type YawPitch = {
  yaw: number;
  pitch: number;
  /** Roll about the view axis in radians. Zero while alive; the
   *  first-person death tip-over rolls the view onto its right side (a
   *  negative roll) and rights it again on the wake. */
  roll: number;
};

export type ChunkState = "loaded" | "pending" | "unloaded";

export type BlockInfo = {
  id: number;
  name: string;
  isEmpty: boolean;
  isFluid: boolean;
  isPassable: boolean;
  /** Whether this voxel holds the waterlogging fluid alongside its block. */
  isWaterlogged: boolean;
  /** The voxel's stage bits (copper signal strength, door open state, crop
   * growth), the observable state of stage-driven blocks. */
  stage: number;
  /** Y-rotation segment (0-15) for y-rotatable blocks (gates, stairs). */
  yRotation: number;
  sunlight: number;
  torchLight: number;
  /** Replicated block-entity JSON for `is_entity` blocks (signs, scoreboards,
   * machines), null when the voxel carries none. Lets tests assert on
   * replicated state (e.g. a scoreboard's scores). */
  entityData?: Record<string, string | number | boolean | object | null> | null;
};

export type EntitySnapshot = {
  id: string;
  kind: string;
  position: Vec3;
  metadata: Record<string, unknown>;
  animDebug?: Record<string, number>;
  distance: number;
};

export type PeerSnapshot = {
  /** Replicated rope state, for multiplayer traversal checks. */
  grappleAnchor?: [number, number, number] | null;
  grappleLatched?: boolean;
  holdingObjectId?: number;
  /** Actual rendered hook socket, including the character's animated arm. */
  heldHookTip?: Vec3 | null;
  id: string;
  username: string;
  position: Vec3;
  direction: Vec3;
  yaw: number;
  pitch: number;
  bodyYaw: number;
  distance: number;
  isSelf: boolean;
  isSpectator: boolean;
  role: string;
  // False until this peer's role claim has replicated from its own client
  // through the server; the window where nametags render role-less.
  isRoleClaimed: boolean;
  /** Roll of the death tip-over on this body in radians (0 upright, π/2
   *  lying on its right side), or null while the body is alive. */
  deathTipAngle: number | null;
  /** Uniform render scale of the body: 1 standing, 0.4 as a spectator
   *  ghost, shrinking to 0 as a dead body vanishes. */
  renderScale: number;
};

export type RaycastHit = {
  block: BlockInfo | null;
  entity: EntitySnapshot | null;
  position: Vec3;
  distance: number;
  /**
   * Clickable regions painted on the targeted block's face (tabs, buttons):
   * which one the crosshair rests on, and where each one is in the world.
   * `null` when the block registers no face surface.
   */
  faceRegions?: {
    faceName: string;
    hovered: string | null;
    regions: { id: string; center: Vec3 }[];
    /**
     * The client's own hover pane, as it is right now: which region it is
     * laid over and where it sits. `hovered` above is the harness's math;
     * this is what the player would see, so the two can be compared.
     */
    highlight: {
      isVisible: boolean;
      regionId: string | null;
      center: Vec3;
      size: { width: number; height: number };
    } | null;
  } | null;
};

export type ChunkSnapshot = {
  coord: ChunkCoord;
  state: ChunkState;
};

export type Snapshot = {
  /** Local hotbar selection, zero-based; absent on clients without a hotbar. */
  activeSlot?: number;
  position: Vec3;
  facing: YawPitch;
  world: string;
  isReady: boolean;
  raycast: RaycastHit | null;
  nearbyEntities: EntitySnapshot[];
  chunks: {
    loaded: number;
    pending: number;
  };
};

export type ChatMsgIn = {
  type: string;
  sender: string;
  body: string;
  receivedAt: number;
};

export type CommandResult = {
  ok: boolean;
  message?: string;
};

export type ConnectionSnapshot = {
  isConnected: boolean;
  isJoined: boolean;
  /** A (re)join handshake is in flight; world reads are answered from a map
   * the server may no longer agree with. */
  isJoinPending: boolean;
  /** Terminal protocol rejection: only a fresh page load can reconnect. */
  isClientOutdated: boolean;
  /** Completed INIT handshakes; bumps on first join, every rejoin, and
   * every world switch. Monotonically increasing. */
  joinGeneration: number;
  pendingCommandCount: number;
  droppedCommandCount: number;
  serverUrl: string | null;
};

export type CommandQueueReason = "disconnected" | "rejoining" | "retrying";

/**
 * The honest fate of a one-shot command: either it was handed to an OPEN
 * socket (`isSent`), or it is queued client-side and goes out automatically
 * once the session is connected and joined again (`isQueued` plus a reason).
 * At most one is true; both false means there was nothing to send.
 */
export type CommandDispatch = {
  isSent: boolean;
  isQueued: boolean;
  queuedReason?: CommandQueueReason;
};

export type PaintSettleReport = {
  /** All pipeline queues drained and two consecutive quiet frames painted. */
  isSettled: boolean;
  elapsedMs: number;
  /** Which counters were still non-zero when the wait gave up. */
  blockedOn?: string;
};

export type CaptureFrameOptions = {
  isPure?: boolean;
  /** First-person viewmodel. Off unless a held-item shot asks for it. */
  isIncludingArm?: boolean;
};

export type VideoRecordingRequest = {
  /** Rate the canvas is sampled at; the page still paints as fast as it can. */
  fps?: number;
  bitsPerSecond?: number;
  /** The shutter closes itself after this long, so a lost caller cannot leak a take. */
  maxDurationMs?: number;
  /** Scene overlays and the voxel highlight off, as in a pure screenshot. */
  isPure?: boolean;
};

export type VideoRecordingStarted = {
  mimeType: string;
  fps: number;
  /** Canvas backing size the take is locked to; resizing mid-take breaks it. */
  width: number;
  height: number;
  isPure: boolean;
};

export type VideoRecordingResult = {
  mimeType: string;
  byteLength: number;
  durationMs: number;
  /** Frames the page actually painted while the shutter was open. */
  frameCount: number;
  /** The take closed on its own `maxDurationMs` rather than on a stop. */
  isAutoStopped: boolean;
};

/**
 * What the lens is pointed at during a shot. An entity aim is resolved every
 * frame, so a move can hold a swimming subject in the frame while the camera
 * flies its own path — the two are independent, which is the whole point.
 */
export type CameraAim =
  | { point: Vec3 }
  | ({ entityId: string } & SubjectAim)
  | ({ kind: string } & SubjectAim);

export type SubjectAim = {
  /** Added to the resolved point, after `aimY` if that is set too. */
  offset?: Vec3;
  /**
   * Hold the aim at this world height and take only the horizontal position
   * from the subject. A creature that walks the bottom of a pond otherwise
   * drags the lens down with it and the shot ends looking at gravel.
   */
  aimY?: number;
};

export type CameraKeyframe = {
  /** Milliseconds from the start of the shot. The first must be 0. */
  atMs: number;
  position: Vec3;
  aim: CameraAim;
  /** Vertical field of view in degrees. Animating it against a dolly is the
   * dolly zoom; leaving it off every keyframe leaves the lens alone. */
  fov?: number;
};

/**
 * Applied to the shot as a whole, not per segment: a move that starts and
 * stops abruptly reads as a teleport however smooth its middle was.
 *
 * `in`, `out` and `inOut` are cubic — the punchy curve interface animation
 * uses, which suits a short move. `sine` is the gentle one, and it is what a
 * long move wants: cubic `inOut` reaches three times the average speed at the
 * midpoint, so a seven-second reveal dwells, rushes, and dwells again, which
 * reads as the camera being shoved rather than flown. Sinusoidal peaks at
 * about 1.6x and holds a near-even pace through the body of the move.
 */
export type CameraEasing = "linear" | "in" | "out" | "inOut" | "sine";

export type CameraShot = {
  keyframes: CameraKeyframe[];
  easing?: CameraEasing;
  /**
   * Straight segments between keyframes instead of a curve through them.
   * A curve is what makes a multi-point move look flown rather than hinged,
   * so it is the default; straight is for a deliberate rail.
   */
  isLinear?: boolean;
};

export type CameraShotStatus = {
  isRunning: boolean;
  elapsedMs: number;
  durationMs: number;
  progress: number;
  /** Frames the shot actually drove. A move that ran at 12fps is a bad move,
   * and this is the only place that fact is visible. */
  frameCount: number;
  /** Why the last shot ended, when it was not by reaching the end. */
  endedReason: string | null;
};

export type VideoRecordingStatus = {
  isRecording: boolean;
  mimeType: string | null;
  elapsedMs: number | null;
  frameCount: number | null;
  /** Bytes of a finished take still waiting to be read out of the page. */
  pendingByteLength: number | null;
};

export type FaceInput =
  | { target: Vec3 }
  | { yaw: number; pitch: number }
  | { direction: Vec3 };

export type WalkDirection = "forward" | "back" | "left" | "right";

export type WalkOptions = {
  /** Hold jump/swim-up through ordinary movement physics. */
  isJumping?: boolean;
  durationMs?: number;
  isSprinting?: boolean;
};

export type WalkToOptions = {
  tolerance?: number;
  timeoutMs?: number;
  isSprinting?: boolean;
};

export type ViewOptions = {
  from?: Vec3;
  face?: FaceInput;
  isEnsuringChunks?: boolean;
};

export type FollowTarget = { id: string } | { kind: string };

export type FollowOptions = {
  distance?: number;
  heightOffset?: number;
  relativeBearing?: number;
};

export type FollowStatus = {
  entityId: string;
  kind: string;
  startedAt: number;
};

export type MeshTransferBenchmarkIteration = {
  serializeMs: number;
  workerMs: number;
  totalMs: number;
  inputBytes: number;
  outputBytes: number;
};

export type MeshTransferBenchmarkModeResult = {
  strategy: "transfer" | "shared";
  isSharedArrayBufferAvailable: boolean;
  warmupIterations: number;
  measuredIterations: number;
  avgSerializeMs: number;
  avgWorkerMs: number;
  avgTotalMs: number;
  p50TotalMs: number;
  p95TotalMs: number;
  totalInputBytes: number;
  totalOutputBytes: number;
};

export type MeshTransferBenchmarkResult = {
  cx: number;
  cz: number;
  level: number;
  transfer: MeshTransferBenchmarkModeResult;
  shared: MeshTransferBenchmarkModeResult;
  speedup: number;
  serializeSpeedup: number;
};

export type MeshTransferBenchmarkRequest = {
  cx?: number;
  cz?: number;
  level?: number;
  warmupIterations?: number;
  measuredIterations?: number;
};

export type MeshTransferStatus = {
  mode: string;
  strategy: string;
  isSharedArrayBufferAvailable: boolean;
  isCrossOriginIsolated: boolean;
  pool: {
    isActive: boolean;
    maxSlots: number;
    usedSlots: number;
    bytesAllocated: number;
  };
};

export type FrameRateMeasurementOptions = {
  durationMs?: number;
  warmupMs?: number;
};

export type FrameRateMeasurement = {
  durationMs: number;
  warmupMs: number;
  elapsedMs: number;
  frameCount: number;
  avgFps: number;
  p50Fps: number;
  lowFps: number;
  /**
   * 1000 / mean of the worst 1% of frame times — the community-standard
   * "1% low" stutter metric. Falls back to the single worst frame when the
   * sample has fewer than 100 frames.
   */
  onePercentLowFps: number;
  avgFrameMs: number;
  p50FrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  maxFrameMs: number;
};

export type AgentEventMap = {
  chat: ChatMsgIn;
  "chunk-loaded": ChunkCoord;
  "chunk-unloaded": ChunkCoord;
  "entity-spawned": EntitySnapshot;
  "entity-despawned": { id: string };
  "test-result": {
    name: string;
    status: "pass" | "fail";
    elapsedMs: number;
    error?: string;
  };
  "test-start": {
    name: string;
    arenaIndex: number;
    origin: Vec3;
  };
  tick: { time: number };
};

export type AgentEventName = keyof AgentEventMap;

export type Unsubscribe = () => void;

export interface ChunkBridge {
  state(target: Vec3 | ChunkCoord): ChunkState;
  waitFor(pos: Vec3, radius?: number, timeoutMs?: number): Promise<void>;
  loaded(): ChunkCoord[];
  pending(): ChunkCoord[];
  list(): ChunkSnapshot[];
  /**
   * Wait until the world is paint-ready: update/light/mesh pipeline queues
   * drained, then two consecutive animation frames with no new work. Bounded
   * by `timeoutMs`; a timeout reports `isSettled: false` (with what was
   * still pending) instead of throwing, because a slightly-unsettled capture
   * beats no capture.
   */
  waitForPaint(opts?: { timeoutMs?: number }): Promise<PaintSettleReport>;
}

/**
 * Mirror of `WorldMemoryCounters` from `@voxelize/core`: queue and
 * in-flight sizes across the update -> relight -> remesh pipeline, used to
 * diagnose memory pressure during mass terrain edits.
 */
export type MemoryPressureStatus = {
  isHeapReadable: boolean;
  isUnderPressure: boolean;
  heapRatio: number;
  heapUsedBytes: number;
  heapLimitBytes: number;
  shedCount: number;
};

/**
 * What the debug bar's `mem` segment shows, read from the same sampler:
 * the JS heap, its post-collection floor, and the rate that floor is rising
 * by (a Theil-Sen slope over the floors of the last few minutes; null until
 * enough buckets have completed). `null` as a whole where the client has no
 * debug UI installed or the browser exposes no heap counters.
 */
export type MemoryTrend = {
  usedBytes: number;
  totalBytes: number;
  limitBytes: number;
  /** used / limit, 0..1. */
  pressure: number;
  floorBytes: number;
  growthBytesPerMinute: number | null;
  trendSpanMs: number;
  bucketMs: number;
  /** Per-bucket floors, oldest first: the bars the debug bar draws. */
  floorHistory: number[];
  /** The browser's own page total incl. workers, when it offers one. */
  detailed: { totalBytes: number; workerBytes: number; workers: number } | null;
};

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
  /** Cumulative since world init; difference two reads for a window. */
  blockUpdatesApplied: number;
  lightSeedsAnalyzed: number;
  lightJobsScheduled: number;
};

/**
 * What the renderer is being asked to do for one frame, which is the thing a
 * frame-rate number cannot tell you on its own: a scene can be slow because it
 * draws too much or because it merely *walks* too much. `sceneObjects` counts
 * every node the per-frame matrix and culling traversals visit, and
 * `visibleChunkGroups` how many of the chunk subtrees survive culling.
 */
/**
 * One block surface not wearing its own art. `unknown` is the
 * magenta-and-black checker; `default` an isolated face on its face's blank
 * default while it waits for the voxel's paint; `fallback` a stand-in colour
 * put there by `fillUnpaintedSurfaces`.
 */
export type UnpaintedSurface = {
  kind: "atlas-slot" | "own-face" | "isolated-face";
  state: "unknown" | "default" | "fallback";
  blockId: number;
  blockName: string;
  faceName: string;
  textureGroup: string | null;
  voxel?: [number, number, number];
  ageMs?: number;
};

export type SurfaceTally = {
  total: number;
  painted: number;
  default: number;
  fallback: number;
  unknown: number;
};

export type TextureCensus = {
  atlasSlots: SurfaceTally;
  ownFaces: SurfaceTally;
  isolatedFaces: SurfaceTally;
  /** Worst first: checker, then fallbacks, then defaults still waiting. */
  unpainted: UnpaintedSurface[];
};

export type TextureFillResult = {
  color: string;
  filled: { atlasSlots: number; ownFaces: number; isolatedFaces: number };
};

/**
 * What `world.blockAnimations` knows: the block names with a declared
 * motion, and every tracked animated voxel with the pose it is showing.
 * `angle` is radians about the block's hinge from its stage-0 pose;
 * `progress` is 1 at rest. Mirrors `BlockAnimationsSnapshot` in core.
 */
export type BlockAnimationsSnapshot = {
  registered: string[];
  trackedCount: number;
  activeCount: number;
  voxels: {
    voxel: Vec3;
    block: string;
    stage: number;
    angle: number;
    restAngle: number;
    progress: number;
    isMoving: boolean;
  }[];
};

export type DrawThrottleStatus = {
  /** Minimum ms between drawn frames; null when drawing every frame. */
  intervalMs: number | null;
  /** False on a client whose frame loop predates the throttle. */
  isSupported: boolean;
};

export type RenderStats = {
  drawCalls: number;
  /** The part of `drawCalls` spent filling the shadow cascades. */
  shadowDrawCalls: number;
  triangles: number;
  programs: number;
  geometries: number;
  textures: number;
  sceneObjects: number;
  chunkGroups: number;
  /** Loaded columns that have produced terrain geometry, including arenas.
   * Missing columns may be truly empty; useful alongside drained mesh queues
   * to diagnose terrain that was loaded but never scheduled for meshing. */
  chunkGeometry?: {
    columns: number;
    missingCount: number;
    /** At most 32 coordinates, regardless of missingCount. */
    missing: ChunkCoord[];
  };
  visibleChunkGroups: number;
  chunkMeshes: number;
  visibleChunkMeshes: number;
  /**
   * Snapshot of `world.localLights.stats` — registered/candidate/clustered
   * counts, per-frame select/pack/scan milliseconds, overflow and churn
   * counters. Absent on hosts built before the local-lights system.
   */
  localLights?: {
    registered: number;
    candidates: number;
    clustered: number;
    cellsOverflowed: number;
    selectMs: number;
    packMs: number;
    scanMs: number;
    sectionsPendingScan: number;
    selectionChurn: number;
    /** Lights currently holding a shadow slot. */
    shadowed: number;
    /** Atlas faces rendered this frame, split by tier below. */
    shadowFacesRendered: number;
    shadowFacesStatic: number;
    shadowFacesDynamic: number;
    shadowScheduleMs: number;
    shadowCacheHitRate: number;
    atlasEvictions: number;
    shadowInvalidations: number;
  };
  /** The twelve biggest material buckets among chunk meshes, largest first. */
  meshBuckets: { bucket: string; total: number; visible: number }[];
  /**
   * Everything past those twelve, summed, so the long tail of one-mesh
   * buckets (a per-voxel isolated face is one bucket each) is not invisible
   * in the report just because no single bucket is large.
   */
  meshBucketTail: {
    buckets: number;
    total: number;
    visible: number;
    /** Buckets keyed per voxel: one material and one draw per placed face. */
    isolatedFaces: number;
  };
  /**
   * Subtree node counts for every top-level scene child that was given a
   * name, unconditionally: a named system (an effects group, a manager) can
   * always be checked here even when it is too small for the list above.
   */
  namedSceneNodes: Record<string, number>;
  /** Non-terrain scene subtrees, worst visible-mesh count first. */
  otherSceneNodes: {
    label: string;
    total: number;
    visibleMeshes: number;
    /** Direct children by label, most numerous first, e.g. `ChestMesh x12`. */
    children: string;
  }[];
  loadedChunks: number;
  renderRadius: number;
  /**
   * The ratio the renderer is actually drawing at, against the display's
   * own. When the two disagree the frame is being upscaled by the browser,
   * which is what "the game looks soft" reduces to.
   */
  renderPixelRatio: number;
  devicePixelRatio: number;
  drawingBufferWidth: number;
  drawingBufferHeight: number;
  /**
   * Rolling window (recent frames) of frame cost, read from the client's
   * own frame loop: the interval between frames and the main-thread time
   * each frame's JS took. `renderScale` is the adaptive multiplier the
   * client is applying on top of the display's pixel ratio (1 = native).
   * The interval is capped by the tab's refresh rate, so on a 60Hz display
   * it reads ~16.7ms for a cheap frame too; main-thread time is the number
   * that still says what the frame cost. Null when the client does not
   * report it.
   */
  frameCost: {
    samples: number;
    frameIntervalAvgMs: number;
    mainThreadAvgMs: number;
    mainThreadP95Ms: number;
    mainThreadMaxMs: number;
    renderScale: number;
  } | null;
  /**
   * Cumulative main-thread cost of applying finished mesh results
   * (`World.buildChunkMesh`): call count, total/max milliseconds, and the
   * geometry attribute bytes applied. Difference two reads for a window.
   */
  meshApply: {
    count: number;
    totalMs: number;
    maxMs: number;
    bytes: number;
  };
  /**
   * Cumulative main-thread cost of per-face translucency sorting: sort count,
   * total/max milliseconds, and faces sorted. Difference two reads for a
   * window; camera strafes are what drive it.
   */
  transparentSort: {
    count: number;
    totalMs: number;
    maxMs: number;
    faces: number;
  };
  /**
   * Region-arena batching state for the shared-opaque bucket: live
   * `BatchedMesh` regions and the chunk sections slotted into them. Both
   * zero when batching is disabled or nothing opaque is loaded.
   */
  regionArenas: {
    regions: number;
    sections: number;
  };
  /**
   * Occlusion-walk state: graph size, sections reporting real (non-full)
   * connectivity, sections the last walk reached and marked visible, and
   * whether the walk started from a loaded section at all. `constrained: 0`
   * means no connectivity data has arrived and the walk can prune nothing.
   */
  occlusion: {
    sections: number;
    constrained: number;
    reached: number;
    visible: number;
    isComplete: boolean;
  };
  /** Cascaded-shadow scheduler internals; null when the world has no CSM. */
  csm: {
    isCameraStill: boolean;
    cascadeDirty: boolean[];
    cascadeNeedsRender: boolean[];
    currentShadowStrength: number;
    lastFrameLightSwing: number;
  } | null;
};

export interface AgentBridge {
  readonly ready: Promise<void>;

  chat(text: string): Promise<CommandResult>;
  teleport(pos: Vec3, opts?: { isEnsuringChunks?: boolean }): Promise<void>;
  face(input: FaceInput): Promise<void>;
  walk(direction: WalkDirection, opts?: WalkOptions): Promise<void>;
  walkTo(target: Vec3, opts?: WalkToOptions): Promise<void>;
  view(opts: ViewOptions): Promise<void>;
  follow(target: FollowTarget, opts?: FollowOptions): Promise<FollowStatus>;
  unfollow(): Promise<void>;
  following(): FollowStatus | null;
  setFlying(isFlying: boolean): Promise<void>;
  setRenderRadius(radius: number): Promise<number>;
  call(method: string, payload: unknown): Promise<unknown>;
  /**
   * Local break prediction plus one transactional `break-block` command.
   * Used by regression smoke tests to assert mesh/raycast catch up with inventory.
   */
  breakVoxel(pos: Vec3): Promise<
    {
      beforeId: number;
      afterId: number;
    } & CommandDispatch
  >;
  /**
   * The player's own placement path: an optimistic client-sourced
   * `updateVoxels` (local relight + remesh, then the UPDATE packet the
   * server echoes back), exactly what a right-click in creative does. A
   * server-side fill method never exercises this path, so this is the one
   * that reproduces prediction-side light and mesh bugs. `block` is a name
   * or id.
   */
  placeVoxel(
    pos: Vec3,
    block: string | number,
  ): Promise<{ beforeId: number; afterId: number; blockId: number }>;
  /**
   * The player's own click on whatever the crosshair targets: a mouse press
   * dispatched where the client's input layer listens, so every bound
   * handler runs as it would for a person — placement, block-entity menus,
   * clickable regions painted on a face. Reports the targeted voxel and
   * block so a test can assert it aimed where it meant to.
   * `holdMs` (0..15000, default 0) exercises sustained input such as mining.
   * Always releases the mouse button before resolving.
   */
  /** Select hotbar slot 0..8 through the normal local focus/change path. */
  selectHotbar(slot: number): void;
  interact(
    button?: "left" | "right",
    holdMs?: number,
  ): Promise<{
    button: "left" | "right";
    target: Vec3 | null;
    block: string | null;
  }>;
  /**
   * Raw per-voxel light channels as the client currently holds them —
   * sunlight plus the three torch colors, with the voxel id for context.
   * The honest probe for "why is this block tinted": rendered color is
   * derived state, these are the values it is derived from.
   */
  lightAt(pos: Vec3): {
    sunlight: number;
    red: number;
    green: number;
    blue: number;
    voxelId: number;
    worldTime: number;
    sunlightIntensity: number;
    clusteredLights: number;
  };
  captureFrame(opts?: CaptureFrameOptions): Promise<string | null>;

  /**
   * Film the canvas rather than photograph it. The take is encoded in the page
   * by `MediaRecorder`, so it carries real motion at the rate the client
   * actually paints; `readVideoChunk` walks the finished bytes out in slices
   * because a whole clip in one evaluate result is a payload nobody can bound.
   */
  startVideo(request?: VideoRecordingRequest): Promise<VideoRecordingStarted>;
  stopVideo(): Promise<VideoRecordingResult>;
  readVideoChunk(offset: number, length: number): Promise<string>;
  videoStatus(): VideoRecordingStatus;

  /**
   * Fly a keyframed camera move, driven per rendered frame in the page. It
   * has to run here rather than as a stream of `view` calls: a move stepped
   * over HTTP arrives at whatever rate the network felt like, and judder is
   * the one thing a camera move cannot survive. Returns as soon as the shot
   * is armed; poll `cameraShotStatus` for the end.
   */
  startCameraShot(shot: CameraShot): Promise<CameraShotStatus>;
  stopCameraShot(): Promise<CameraShotStatus>;
  cameraShotStatus(): CameraShotStatus;

  meshTransferStatus(): Promise<MeshTransferStatus>;
  meshTransferConfigure(
    mode: "auto" | "transfer" | "shared",
  ): Promise<MeshTransferStatus>;
  meshTransferBenchmark(
    opts?: MeshTransferBenchmarkRequest,
  ): Promise<MeshTransferBenchmarkResult>;
  /** Pipeline queue/in-flight sizes from `World.getMemoryCounters`. */
  memoryCounters(): WorldMemoryCounters;
  /** The debug bar's heap reading and leak trend; see {@link MemoryTrend}. */
  memoryTrend(): MemoryTrend | null;
  /** Per-frame renderer and scene-graph load; see {@link RenderStats}. */
  renderStats(): RenderStats;
  /**
   * Cap how often the frame loop draws (shadows, composer, arm) while the
   * world keeps updating every frame. `null` lifts the cap. The daemon
   * applies it to a session nobody has spoken to for a while: an idle
   * headless tab drawing at 60fps costs about a core plus the GPU process,
   * and five of them was most of the box. Any command lifts it first, and
   * the returned promise resolves after the next drawn frame so a capture
   * issued right after waking never reads a frame from the throttled era.
   */
  setDrawThrottle(intervalMs: number | null): Promise<DrawThrottleStatus>;
  drawThrottle(): DrawThrottleStatus;
  /**
   * Every animated voxel the world is tracking and the pose it shows right
   * now; see {@link BlockAnimationsSnapshot}. A door that should be
   * swinging and is not shows up here as `isMoving: false` at its new rest
   * angle (the swing never started) or as a voxel missing altogether (the
   * mesher did not split it out).
   */
  blockAnimations(): BlockAnimationsSnapshot;
  /**
   * What every block surface is wearing: atlas slots, own-texture face
   * defaults, and each voxel's isolated face, with everything not yet in its
   * own art listed worst first. `unpainted` empty of `unknown` entries is
   * the "no magenta anywhere" assertion.
   */
  textureCensus(): TextureCensus;
  /**
   * Dress every surface still on the unknown checker — an isolated face in
   * its default where that exists, everything else in the world's fallback
   * colour — so a stage is presentable while its real textures are on the
   * way. The census keeps reporting them as `fallback`.
   */
  fillUnpaintedSurfaces(options?: { color?: string }): TextureFillResult;

  position(): Vec3;
  facing(): YawPitch;
  raycast(): RaycastHit | null;
  blockAt(pos: Vec3): BlockInfo | null;
  entitiesNear(radius: number, traceId?: string): EntitySnapshot[];
  peers(): PeerSnapshot[];
  chunks: ChunkBridge;
  snapshot(): Snapshot;
  /** Live connection/join state straight from the network layer. */
  connection(): ConnectionSnapshot;
  /**
   * Ask the network to reconnect immediately (bypassing its periodic
   * backoff). Returns false when there is nothing to do: already connected,
   * never connected, or the client build was terminally rejected.
   */
  reconnectNow(): boolean;

  on<E extends AgentEventName>(
    event: E,
    cb: (data: AgentEventMap[E]) => void,
  ): Unsubscribe;
}

declare global {
  interface Window {
    __agent__?: AgentBridge;
    __agentRequired__: () => AgentBridge;
  }
}
