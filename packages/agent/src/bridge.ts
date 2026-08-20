export type Vec3 = { x: number; y: number; z: number };

export type ChunkCoord = { cx: number; cz: number };

export type YawPitch = { yaw: number; pitch: number };

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
  /** Replicated block-entity JSON for `is_entity` blocks (signs, baskets,
   * wave makers), null when the voxel carries none. Lets tests assert on
   * replicated state (e.g. a basketball basket's scores). */
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
};

export type RaycastHit = {
  block: BlockInfo | null;
  entity: EntitySnapshot | null;
  position: Vec3;
  distance: number;
};

export type ChunkSnapshot = {
  coord: ChunkCoord;
  state: ChunkState;
};

export type Snapshot = {
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
 * What the renderer is being asked to do for one frame, which is the thing a
 * frame-rate number cannot tell you on its own: a scene can be slow because it
 * draws too much or because it merely *walks* too much. `sceneObjects` counts
 * every node the per-frame matrix and culling traversals visit, and
 * `visibleChunkGroups` how many of the chunk subtrees survive culling.
 */
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
  /** Non-terrain scene subtrees, worst visible-mesh count first. */
  otherSceneNodes: { label: string; total: number; visibleMeshes: number }[];
  loadedChunks: number;
  renderRadius: number;
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
  /** Per-frame renderer and scene-graph load; see {@link RenderStats}. */
  renderStats(): RenderStats;

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
