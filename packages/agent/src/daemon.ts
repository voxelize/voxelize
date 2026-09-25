import fs from "node:fs";
import path from "node:path";

import Fastify, {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { z } from "zod";

import { Agent, PageStallError, resolveReadyTimeoutMs } from "./agent";
import type { AgentEventMap, ConnectionSnapshot } from "./bridge";
import { DEFAULT_IDLE_TTL_MS } from "./browser-lifecycle";
import { ensureCaptureDir } from "./capture-dir";
import {
  CaptureViewportError,
  parseCaptureViewportQuery,
} from "./capture-viewport";
import type { ClientUpdateMode } from "./client-updates";
import { computeFramePose } from "./frame-pose";
import {
  createAgentPerfTraceId,
  isAgentPerfLogging,
  logAgentPerf,
} from "./perf";
import {
  EMPTY_POSE_INTENT,
  describePose,
  isNewJoin,
  mergePoseIntent,
  rememberPose,
  resolvePoseRestore,
  type JoinIdentity,
  type PoseIntent,
  type PoseRestoreRecord,
  type RememberedPose,
} from "./pose-memory";
import {
  SessionMetaError,
  applySessionMetaPatch,
  normalizeSessionMeta,
  type SessionMeta,
  type SessionOrigin,
} from "./session-meta";
import {
  describeLastSeen,
  filterWaitCandidates,
  matchesPredicate,
  resolvePath,
} from "./wait-until";

export type DaemonEvent = {
  id: number;
  name: string;
  payload: unknown;
  at: number;
};

export type DaemonOptions = {
  agent: Agent;
  port: number;
  host?: string;
  /** 0 disables idle expiry; see DEFAULT_IDLE_TTL_MS. */
  idleTtlMs?: number;
  /**
   * Worker-declared claim on this session, in minutes from daemon start.
   * Reported in /status; an expired lease is evidence for the reaper, an
   * active one defers idle retirement and protects against sweeps.
   */
  leaseMinutes?: number;
  /** Worker-declared notes (label, purpose, owner, ...); patchable via /meta. */
  meta?: SessionMeta;
  /** Launch provenance captured by whatever started this daemon; read-only. */
  origin?: SessionOrigin | null;
  /** How long the first page may take to mount; 0 disables. */
  mountTimeoutMs?: number;
  /** Called once when the first page never mounted in time. */
  onMountFailed?: (reason: string) => void;
};

export type DaemonLeaseStatus = {
  leaseMinutes: number;
  startedAt: number;
  expiresAt: number;
  isExpired: boolean;
  remainingMs: number;
};

export type DaemonStatus = {
  pid: number;
  port: number;
  world: string;
  /** In-game display name the agent joined with. */
  name: string;
  browserPid: number | null;
  watchdogPid: number | null;
  startedAt: number;
  lastActivityAt: number;
  idleMs: number;
  idleTtlMs: number;
  inflightCount: number;
  /** Stale = disconnected or mid-rejoin: reads would come from a map the
   * server may no longer agree with. Updated by the connection watcher. */
  isStale: boolean;
  staleForMs: number | null;
  staleReason: string | null;
  connection: ConnectionSnapshot | null;
  droppedCommandCount: number | null;
  stalledPageCalls: string[];
  /** Milliseconds a video take has been open, so a leaked one is visible in
   * the same place every other stuck resource is. */
  recordingForMs: number | null;
  /** True while the idle draw cap is on the page (lifted by any command). */
  isDrawThrottled: boolean;
  lease: DaemonLeaseStatus | null;
  meta: SessionMeta;
  origin: SessionOrigin | null;
  client: DaemonClientStatus;
  pose: DaemonPoseStatus;
};

/** Why a page document loaded: the daemon asked for it, or the page did. */
export type DocumentCause = "launch" | "reset" | "reload" | "page";

export type DaemonClientStatus = {
  /** `hold`: dev-server hot updates are held back; `live`: they apply. */
  updates: ClientUpdateMode;
  documentId: number | null;
  documentLoadedAt: number | null;
  title: string | null;
  /** Documents this session has loaded, by cause (launch counts once). */
  documentsByCause: Record<DocumentCause, number>;
  /** Hot updates held back from the loaded document; a reload picks them up. */
  updatesBehind: number;
  lastHeldUpdateAt: number | null;
  lastHeldUpdateTypes: string[];
  devServerRestarts: number;
  isHmrConnected: boolean | null;
};

export type DaemonPoseStatus = {
  isRestoreEnabled: boolean;
  remembered: RememberedPose | null;
  intent: PoseIntent;
  restoreCount: number;
  lastRestore: PoseRestoreRecord | null;
};

export type DaemonMetaResponse = {
  port: number;
  world: string;
  name: string;
  meta: SessionMeta;
  origin: SessionOrigin | null;
};

// Liveness probes must not count as activity, or anything that watches the
// fleet (session list, PM2 health checks, humans curling healthz) would reset
// every idle clock and no session could ever expire. Labeling is bookkeeping
// about the session, not work done through it, so it is passive too: an
// admin page renaming a forgotten session must not immortalize it.
const PASSIVE_ROUTES = new Set(["/healthz", "/status", "/meta"]);

const metaPatchSchema = z.object({
  set: z.record(z.string(), z.string()).optional(),
  unset: z.array(z.string()).optional(),
});

// A busy claim (in-flight command) defers idle expiry, but only for so long:
// if the in-flight counter ever leaked, an unbounded claim would immortalize
// the daemon and recreate exactly the orphan problem the TTL exists to kill.
const INFLIGHT_MAX_AGE_MS = 15 * 60_000;

// An idle session draws slowly. A headless tab rendering a full scene at
// 60fps costs about a core plus the GPU process whether or not anyone is
// looking (two idle sessions measured 45% and 42% CPU on their renderer and
// GPU processes alone), and five of them idling was most of a saturated box.
// After this long without a command the daemon caps the page's draw rate;
// the next command lifts the cap before it runs. `AGENT_IDLE_DRAW_AFTER_MS=0`
// disables it (frame-rate measurements start with a command, so they are
// never taken under the cap either way).
const DEFAULT_IDLE_DRAW_AFTER_MS = 20_000;
const IDLE_DRAW_INTERVAL_MS = 500;
const IDLE_DRAW_CHECK_INTERVAL_MS = 5_000;

function idleDrawAfterMs(): number {
  const raw = process.env.AGENT_IDLE_DRAW_AFTER_MS;
  if (raw === undefined || raw === "") return DEFAULT_IDLE_DRAW_AFTER_MS;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_IDLE_DRAW_AFTER_MS;
}

const CONNECTION_WATCH_INTERVAL_MS = 2_000;
// The page document and its held hot updates are read on their own timer,
// from launch on: a page that never installs a bridge still reloads.
const PAGE_WATCH_INTERVAL_MS = 2_000;
// A new document seen within this long of a daemon-requested navigation is
// that navigation; anything else the page did on its own.
const EXPECTED_NAVIGATION_WINDOW_MS = 10 * 60_000;
const POSE_CHANGING_ACTIONS = new Set([
  "teleport",
  "face",
  "walk",
  "walk-to",
  "view",
  "follow",
]);
// The in-page network layer retries on its own every ~3s; the daemon only
// intervenes after this grace so it never races a reconnect already landing.
const RECOVERY_GRACE_MS = 10_000;
const RECOVERY_BACKOFF_BASE_MS = 5_000;
const RECOVERY_BACKOFF_MAX_MS = 60_000;
// In-page reconnects are attempted this many times before escalating to a
// page reset (which also refreshes an outdated client build).
const IN_PAGE_RECONNECT_ATTEMPTS = 2;
const STALLED_PAGE_RESET_AFTER_MS = 180_000;

const WAIT_DEFAULT_TIMEOUT_MS = 30_000;
const WAIT_MAX_TIMEOUT_MS = 300_000;
const WAIT_DEFAULT_POLL_MS = 250;
const WAIT_MIN_POLL_MS = 50;
const WAIT_DEFAULT_RADIUS = 32;
const WAIT_LAST_SEEN_LIMIT = 5;

const FRAME_SEARCH_RADIUS = 128;
const FRAME_SETTLE_TIMEOUT_MS = 10_000;
// Freeze-during-shot auto-expires server-side so a dying daemon can never
// leave a permanently frozen entity behind.
const FRAME_FREEZE_SECONDS = 30;
const FRAME_OUTPUT_SUBDIR = "agent-frames";
/** Heap snapshots land beside the captures, in their own folder: each is a
 * few hundred megabytes and nobody wants one mixed into a contact sheet. */
const HEAP_SNAPSHOT_SUBDIR = "heap";

// A take is filmed at the size it will be published at, so the default is a
// social-media 1080p rather than the burst's thumbnail viewport. Motion is the
// subject here, and the page keeps painting at its own rate throughout.
const VIDEO_DEFAULT_WIDTH = 1920;
const VIDEO_DEFAULT_HEIGHT = 1080;
// Every take carries its own shutter close, so a caller that dies mid-shot
// cannot leave the page encoding into a growing buffer forever.
const VIDEO_DEFAULT_MAX_DURATION_MS = 60_000;
const VIDEO_MAX_DURATION_MS = 600_000;

const BURST_MAX_FRAMES = 120;
const BURST_MIN_INTERVAL_MS = 50;
const BURST_DEFAULT_INTERVAL_MS = 150;
const BURST_DEFAULT_COUNT = 10;
// Bursts default to a small viewport: many frames in quick succession under
// software WebGL at full size would starve the interval budget.
const BURST_DEFAULT_WIDTH = 800;
const BURST_DEFAULT_HEIGHT = 450;

const MAX_BATCH_ACTIONS = 200;

type FreshnessState = {
  isStale: boolean;
  reason: string | null;
  staleSinceAt: number | null;
  lastConnection: ConnectionSnapshot | null;
  lastCheckedAt: number | null;
};

function isLiveConnection(snapshot: ConnectionSnapshot): boolean {
  return snapshot.isConnected && snapshot.isJoined && !snapshot.isJoinPending;
}

function describeStaleConnection(snapshot: ConnectionSnapshot): string {
  if (!snapshot.isConnected) return "disconnected";
  if (snapshot.isJoinPending) return "rejoining";
  return "not joined";
}

function sanitizeFileLabel(label: string): string {
  return label.replace(/[^a-z0-9_-]/gi, "_");
}

const vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

const faceInputSchema = z.union([
  z.object({ target: vec3Schema }),
  z.object({ yaw: z.number(), pitch: z.number() }),
  z.object({ direction: vec3Schema }),
]);

const walkDirectionSchema = z.enum(["forward", "back", "left", "right"]);

const actSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("chat"), text: z.string() }),
  z.object({
    type: z.literal("teleport"),
    pos: vec3Schema,
    isEnsuringChunks: z.boolean().optional(),
    isSettling: z.boolean().optional(),
  }),
  z.object({ type: z.literal("face"), input: faceInputSchema }),
  z.object({
    type: z.literal("walk"),
    direction: walkDirectionSchema,
    durationMs: z.number().optional(),
    isSprinting: z.boolean().optional(),
    isJumping: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("walk-to"),
    target: vec3Schema,
    tolerance: z.number().optional(),
    timeoutMs: z.number().optional(),
    isSprinting: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("view"),
    from: vec3Schema.optional(),
    face: faceInputSchema.optional(),
    isEnsuringChunks: z.boolean().optional(),
    isSettling: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("follow"),
    target: z.union([
      z.object({ id: z.string() }),
      z.object({ kind: z.string() }),
    ]),
    distance: z.number().optional(),
    heightOffset: z.number().optional(),
    relativeBearing: z.number().optional(),
  }),
  z.object({ type: z.literal("unfollow") }),
  z.object({ type: z.literal("set-flying"), isFlying: z.boolean() }),
  z.object({ type: z.literal("set-render-radius"), radius: z.number() }),
  z.object({
    type: z.literal("call"),
    method: z.string(),
    payload: z.unknown(),
  }),
  z.object({
    type: z.literal("break-voxel"),
    pos: vec3Schema,
  }),
  z.object({
    type: z.literal("place-voxel"),
    pos: vec3Schema,
    block: z.union([z.string(), z.number()]),
  }),
  z.object({
    type: z.literal("select-hotbar"),
    slot: z.number().int().min(0).max(8),
  }),
  z.object({
    type: z.literal("interact"),
    button: z.enum(["left", "right"]).optional(),
    holdMs: z.number().min(0).max(15_000).optional(),
  }),
  z.object({ type: z.literal("wait"), ms: z.number() }),
  z.object({
    type: z.literal("wait-for-chunks"),
    pos: vec3Schema,
    radius: z.number().optional(),
    timeoutMs: z.number().optional(),
  }),
]);

export class AgentDaemon {
  private events: DaemonEvent[] = [];
  private eventCounter = 0;
  private server: FastifyInstance;
  private agent: Agent;
  private readonly port: number;
  private readonly idleTtlMs: number;
  private readonly leaseMinutes: number;
  private meta: SessionMeta;
  private readonly origin: SessionOrigin | null;
  private readonly startedAt = Date.now();
  private lastActivityAt = Date.now();
  private inflightCount = 0;
  private settledRequests = new WeakSet<FastifyRequest>();

  // Session freshness starts stale ("booting") and flips fresh on the first
  // completed join the connection watcher observes.
  private freshness: FreshnessState = {
    isStale: true,
    reason: "booting",
    staleSinceAt: Date.now(),
    lastConnection: null,
    lastCheckedAt: null,
  };
  private connectionWatchTimer: NodeJS.Timeout | null = null;
  private recoveryAttemptCount = 0;
  private lastRecoveryAt = 0;
  private isRecoveryInFlight = false;
  private idleDrawTimer: NodeJS.Timeout | null = null;
  private isDrawThrottled = false;
  private drawThrottleChange: Promise<void> | null = null;

  private pageWatchTimer: NodeJS.Timeout | null = null;
  private expectedNavigation: { cause: DocumentCause; at: number } | null =
    null;
  private clientStatus: DaemonClientStatus = {
    updates: "hold",
    documentId: null,
    documentLoadedAt: null,
    title: null,
    documentsByCause: { launch: 0, reset: 0, reload: 0, page: 0 },
    updatesBehind: 0,
    lastHeldUpdateAt: null,
    lastHeldUpdateTypes: [],
    devServerRestarts: 0,
    isHmrConnected: null,
  };
  private readonly isPoseRestoreEnabled = resolvePoseRestore();
  private pose: RememberedPose | null = null;
  private poseIntent: PoseIntent = EMPTY_POSE_INTENT;
  private poseRestoreCount = 0;
  private lastPoseRestore: PoseRestoreRecord | null = null;
  private poseSync: Promise<void> | null = null;
  private lastPoseCommandAt = 0;
  private isNextRestoreSkipped = false;
  private pageStalledSinceAt: number | null = null;
  private isStallNoted = false;
  private readonly mountTimeoutMs: number;
  private readonly onMountFailed: ((reason: string) => void) | null;
  private hasMounted = false;
  private isMountFailureReported = false;

  constructor(options: DaemonOptions) {
    this.agent = options.agent;
    this.port = options.port;
    this.idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    this.leaseMinutes = options.leaseMinutes ?? 0;
    this.meta = normalizeSessionMeta(options.meta ?? {});
    this.origin = options.origin ?? null;
    this.mountTimeoutMs = options.mountTimeoutMs ?? 0;
    this.onMountFailed = options.onMountFailed ?? null;
    this.server = Fastify({ logger: false });
    this.registerActivityTracking();
    this.registerEventTaps();
    this.registerErrorMapping();
    this.registerRoutes();
    this.clientStatus.updates = this.agent.clientUpdateMode;
    this.startPageWatch();
    // The watcher only makes sense once the bridge exists; a rejected ready
    // promise means the process is exiting anyway.
    void this.agent
      .ready()
      .then(() => {
        this.startConnectionWatch();
        this.startIdleDrawWatch();
      })
      .catch(() => undefined);
  }

  async start(port: number, host = "127.0.0.1"): Promise<void> {
    await this.server.listen({ port, host });
  }

  async stop(): Promise<void> {
    if (this.connectionWatchTimer) {
      clearInterval(this.connectionWatchTimer);
      this.connectionWatchTimer = null;
    }
    if (this.idleDrawTimer) {
      clearInterval(this.idleDrawTimer);
      this.idleDrawTimer = null;
    }
    if (this.pageWatchTimer) {
      clearInterval(this.pageWatchTimer);
      this.pageWatchTimer = null;
    }
    await this.server.close();
  }

  private startIdleDrawWatch(): void {
    if (this.idleDrawTimer || idleDrawAfterMs() === 0) return;
    this.idleDrawTimer = setInterval(() => {
      void this.idleDrawTick();
    }, IDLE_DRAW_CHECK_INTERVAL_MS);
    this.idleDrawTimer.unref();
  }

  private async idleDrawTick(): Promise<void> {
    if (
      this.isDrawThrottled ||
      this.drawThrottleChange ||
      this.freshness.isStale ||
      this.inflightCount > 0 ||
      // A take records whatever the loop draws; capping it mid-clip would
      // turn a 30s shot into a 2fps flipbook.
      this.agent.recordingForMs() !== null ||
      this.idleMs() < idleDrawAfterMs()
    ) {
      return;
    }
    await this.changeDrawThrottle(IDLE_DRAW_INTERVAL_MS);
  }

  /**
   * Serialized so a lift racing a cap cannot leave the page throttled while
   * a command runs. Failures are logged and leave the flag honest: a page
   * that never took the cap is not marked as throttled.
   */
  private changeDrawThrottle(intervalMs: number | null): Promise<void> {
    if (this.drawThrottleChange) return this.drawThrottleChange;
    const change = (async () => {
      try {
        const status = await this.agent.setDrawThrottle(intervalMs);
        if (!status.isSupported) {
          // No point re-trying every tick against a client that lacks it.
          if (this.idleDrawTimer) {
            clearInterval(this.idleDrawTimer);
            this.idleDrawTimer = null;
          }
          return;
        }
        this.isDrawThrottled = status.intervalMs !== null;
        console.log(
          this.isDrawThrottled
            ? `[agent-daemon] idle for ${Math.round(this.idleMs() / 1000)}s: drawing every ${status.intervalMs}ms until the next command`
            : "[agent-daemon] command received: drawing every frame again",
        );
        this.appendEvent("draw-throttle", { intervalMs: status.intervalMs });
      } catch (error) {
        console.warn(
          `[agent-daemon] draw throttle change failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        this.drawThrottleChange = null;
      }
    })();
    this.drawThrottleChange = change;
    return change;
  }

  /** Lift the idle draw cap before a command touches the page. */
  private async wakeForCommand(): Promise<void> {
    if (this.drawThrottleChange) await this.drawThrottleChange;
    if (!this.isDrawThrottled) return;
    await this.changeDrawThrottle(null);
  }

  noteActivity(): void {
    this.lastActivityAt = Date.now();
  }

  idleMs(): number {
    return Date.now() - this.lastActivityAt;
  }

  isBusy(): boolean {
    return this.inflightCount > 0 && this.idleMs() < INFLIGHT_MAX_AGE_MS;
  }

  isLeaseActive(): boolean {
    const lease = this.leaseStatus();
    return lease !== null && !lease.isExpired;
  }

  leaseStatus(): DaemonLeaseStatus | null {
    if (this.leaseMinutes <= 0) return null;
    const expiresAt = this.startedAt + this.leaseMinutes * 60_000;
    return {
      leaseMinutes: this.leaseMinutes,
      startedAt: this.startedAt,
      expiresAt,
      isExpired: Date.now() >= expiresAt,
      remainingMs: Math.max(0, expiresAt - Date.now()),
    };
  }

  sessionMeta(): SessionMeta {
    return { ...this.meta };
  }

  patchSessionMeta(patch: {
    set?: Record<string, string>;
    unset?: string[];
  }): SessionMeta {
    this.meta = applySessionMetaPatch(this.meta, patch);
    return this.sessionMeta();
  }

  metaResponse(): DaemonMetaResponse {
    return {
      port: this.port,
      world: this.agent.worldName,
      name: this.agent.name,
      meta: this.sessionMeta(),
      origin: this.origin,
    };
  }

  status(): DaemonStatus {
    return {
      pid: process.pid,
      port: this.port,
      world: this.agent.worldName,
      name: this.agent.name,
      browserPid: this.agent.browserPid() ?? null,
      watchdogPid: this.agent.watchdogPid() ?? null,
      startedAt: this.startedAt,
      lastActivityAt: this.lastActivityAt,
      idleMs: this.idleMs(),
      idleTtlMs: this.idleTtlMs,
      inflightCount: this.inflightCount,
      isStale: this.freshness.isStale,
      staleForMs:
        this.freshness.isStale && this.freshness.staleSinceAt !== null
          ? Date.now() - this.freshness.staleSinceAt
          : null,
      staleReason: this.freshness.isStale ? this.freshness.reason : null,
      connection: this.freshness.lastConnection,
      droppedCommandCount:
        this.freshness.lastConnection?.droppedCommandCount ?? null,
      stalledPageCalls: this.agent.stalledPageCallLabels(),
      recordingForMs: this.agent.recordingForMs(),
      isDrawThrottled: this.isDrawThrottled,
      lease: this.leaseStatus(),
      meta: this.sessionMeta(),
      origin: this.origin,
      client: {
        ...this.clientStatus,
        documentsByCause: { ...this.clientStatus.documentsByCause },
      },
      pose: this.poseStatus(),
    };
  }

  private poseStatus(): DaemonPoseStatus {
    return {
      isRestoreEnabled: this.isPoseRestoreEnabled,
      remembered: this.pose,
      intent: this.poseIntent,
      restoreCount: this.poseRestoreCount,
      lastRestore: this.lastPoseRestore,
    };
  }

  private startPageWatch(): void {
    if (this.pageWatchTimer) return;
    void this.pageWatchTick();
    this.pageWatchTimer = setInterval(() => {
      void this.pageWatchTick();
    }, PAGE_WATCH_INTERVAL_MS);
    this.pageWatchTimer.unref();
  }

  /**
   * Every page reset or reload the daemon itself asks for goes through here.
   * Recovery holds off while it runs, and the new page gets the full grace
   * to join before recovery may touch it.
   */
  private async resetPage(cause: "reset" | "reload"): Promise<void> {
    this.expectedNavigation = { cause, at: Date.now() };
    const wasRecoveryInFlight = this.isRecoveryInFlight;
    this.isRecoveryInFlight = true;
    try {
      await this.agent.reset();
    } finally {
      if (!wasRecoveryInFlight) this.isRecoveryInFlight = false;
      this.pageStalledSinceAt = null;
      if (this.freshness.isStale) this.freshness.staleSinceAt = Date.now();
    }
  }

  /** A first page that never mounts ends the session instead of holding it. */
  private checkMountDeadline(isMounted: boolean): void {
    if (this.hasMounted || this.isMountFailureReported) return;
    if (isMounted) {
      this.hasMounted = true;
      return;
    }
    const waitedMs = Date.now() - this.startedAt;
    if (this.mountTimeoutMs <= 0 || waitedMs < this.mountTimeoutMs) return;
    this.isMountFailureReported = true;
    const reason = `page never mounted: no client after ${Math.round(waitedMs / 1000)}s (limit ${Math.round(this.mountTimeoutMs / 1000)}s)`;
    console.error(
      `[agent-daemon] ${new Date().toISOString()} ${reason}; ending the session so it stops holding a browser`,
    );
    this.appendEvent("mount-failed", { waitedMs });
    this.onMountFailed?.(reason);
  }

  private async pageWatchTick(): Promise<void> {
    let page: Awaited<ReturnType<Agent["pageDocument"]>>;
    try {
      page = await this.agent.pageDocument();
    } catch {
      // Mid-navigation or wedged: the connection watcher owns that story,
      // but a page that never answers still counts against its mount time.
      this.checkMountDeadline(false);
      return;
    }
    this.checkMountDeadline(page.isMounted);
    const status = this.clientStatus;
    status.title = page.title;
    if (page.documentId !== status.documentId) {
      const isFirst = status.documentId === null;
      const expected = this.expectedNavigation;
      const cause: DocumentCause = isFirst
        ? "launch"
        : expected && Date.now() - expected.at < EXPECTED_NAVIGATION_WINDOW_MS
          ? expected.cause
          : "page";
      if (!isFirst) this.expectedNavigation = null;
      const heldBefore = status.updatesBehind;
      status.documentId = page.documentId;
      status.documentLoadedAt = Date.now();
      status.documentsByCause[cause] += 1;
      status.updatesBehind = 0;
      status.lastHeldUpdateAt = null;
      status.lastHeldUpdateTypes = [];
      status.devServerRestarts = 0;
      if (!isFirst) {
        const loads = Object.values(status.documentsByCause).reduce(
          (sum, count) => sum + count,
          0,
        );
        const message =
          cause === "page"
            ? "the page reloaded itself (not requested by the daemon)"
            : `page ${cause} loaded a new document`;
        console.log(
          `[agent-daemon] ${new Date().toISOString()} ${message}; now running current client code` +
            `${heldBefore > 0 ? ` (${heldBefore} held update(s) picked up)` : ""}; ${loads} document(s) since launch, ${status.documentsByCause.page} self-initiated`,
        );
        this.appendEvent("page-document", {
          cause,
          documents: loads,
          pickedUpUpdates: heldBefore,
        });
      }
    }
    const held = page.clientUpdates;
    status.isHmrConnected = held ? held.isConnected : null;
    if (held && held.updates > status.updatesBehind) {
      console.log(
        `[agent-daemon] ${new Date().toISOString()} held client update #${held.updates} (${held.lastUpdateTypes.join(", ") || "update"}): ` +
          "this page keeps the client code it loaded; `reload` picks it up",
      );
      this.appendEvent("client-update-held", {
        updatesBehind: held.updates,
        types: held.lastUpdateTypes,
      });
    }
    if (held && held.serverRestarts > status.devServerRestarts) {
      console.log(
        `[agent-daemon] ${new Date().toISOString()} dev server restarted under this page; the page keeps its code (held, not reloaded)`,
      );
    }
    if (held) {
      status.updatesBehind = held.updates;
      status.lastHeldUpdateAt = held.lastUpdateAt;
      status.lastHeldUpdateTypes = held.lastUpdateTypes;
      status.devServerRestarts = held.serverRestarts;
    }
  }

  private currentJoin(snapshot: ConnectionSnapshot | null): JoinIdentity {
    return {
      documentId: this.clientStatus.documentId,
      joinGeneration: snapshot?.joinGeneration ?? null,
    };
  }

  /**
   * Remember the live pose; on the first fresh tick of a new join, put the
   * remembered one back first. Serialized: the timer, /healthz and /reload
   * all reach it.
   */
  private syncPose(snapshot: ConnectionSnapshot): Promise<void> {
    if (this.poseSync) return this.poseSync;
    this.poseSync = (async () => {
      let sample;
      try {
        sample = await this.agent.poseSample();
      } catch {
        return;
      }
      const join: JoinIdentity = {
        documentId: sample.documentId,
        joinGeneration: snapshot.joinGeneration ?? null,
      };
      if (this.pose && isNewJoin(this.pose, join)) {
        const detectedAt = Date.now();
        const previous = this.pose;
        if (!this.isPoseRestoreEnabled || this.isNextRestoreSkipped) {
          console.log(
            `[agent-daemon] ${new Date().toISOString()} rejoined; not restoring the pose (${
              this.isNextRestoreSkipped
                ? "reload asked not to"
                : "AGENT_RESTORE_POSE=0"
            })`,
          );
          this.isNextRestoreSkipped = false;
        } else {
          await this.restorePose(previous, join, detectedAt);
        }
        try {
          sample = await this.agent.poseSample();
        } catch {
          return;
        }
      }
      this.pose = rememberPose(
        sample,
        { documentId: sample.documentId, joinGeneration: join.joinGeneration },
        this.poseIntent,
        Date.now(),
      );
    })().finally(() => {
      this.poseSync = null;
    });
    return this.poseSync;
  }

  private async restorePose(
    pose: RememberedPose,
    to: JoinIdentity,
    detectedAt: number,
  ): Promise<void> {
    const record: PoseRestoreRecord = {
      at: detectedAt,
      pose,
      from: pose.join,
      to,
      error: null,
    };
    const isOverridden = () => this.lastPoseCommandAt > detectedAt;
    try {
      // Flying first, so a pose staged in mid-air does not start to fall.
      if (pose.isFlying !== null) await this.agent.setFlying(pose.isFlying);
      if (!isOverridden()) await this.agent.teleport(pose.position);
      if (!isOverridden()) await this.agent.face({ ...pose.facing });
      if (pose.renderRadius !== null) {
        await this.agent.setRenderRadius(pose.renderRadius);
      }
      if (isOverridden()) {
        record.error = "a command moved the agent first; left where it put it";
      }
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error);
    }
    this.lastPoseRestore = record;
    if (record.error === null) this.poseRestoreCount += 1;
    const age = Math.round((detectedAt - pose.sampledAt) / 1000);
    console.log(
      `[agent-daemon] ${new Date().toISOString()} ${
        record.error === null ? "restored pose" : "pose restore incomplete"
      } after rejoin (join generation ${pose.join.joinGeneration} -> ${to.joinGeneration}${
        pose.join.documentId !== to.documentId ? ", new page document" : ""
      }): ${describePose(pose)}, remembered ${age}s before${
        record.error ? ` — ${record.error}` : ""
      }`,
    );
    this.appendEvent("pose-restored", {
      isRestored: record.error === null,
      error: record.error,
      position: pose.position,
      facing: pose.facing,
      isFlying: pose.isFlying,
      renderRadius: pose.renderRadius,
    });
  }

  /** A command that moves the agent: remember where it ended up at once. */
  private async notePoseCommand(): Promise<void> {
    this.lastPoseCommandAt = Date.now();
    const snapshot = this.freshness.lastConnection;
    if (this.freshness.isStale || !snapshot || !this.pose) return;
    try {
      const sample = await this.agent.poseSample();
      this.pose = rememberPose(
        sample,
        this.pose.join.documentId === sample.documentId
          ? this.pose.join
          : this.currentJoin(snapshot),
        this.poseIntent,
        Date.now(),
      );
    } catch {
      // the next watch tick samples it
    }
  }

  private startConnectionWatch(): void {
    if (this.connectionWatchTimer) return;
    // First tick immediately: /status must report the just-joined session
    // fresh as soon as ready resolves, not one interval later.
    void this.watchConnectionTick();
    this.connectionWatchTimer = setInterval(() => {
      void this.watchConnectionTick();
    }, CONNECTION_WATCH_INTERVAL_MS);
    this.connectionWatchTimer.unref();
  }

  private async watchConnectionTick(): Promise<void> {
    let snapshot: ConnectionSnapshot | null = null;
    let failureMessage: string | null = null;
    try {
      snapshot = await this.agent.connection();
      this.pageStalledSinceAt = null;
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error);
      if (error instanceof PageStallError) {
        this.pageStalledSinceAt ??= Date.now();
      } else {
        this.pageStalledSinceAt = null;
      }
    }
    this.updateFreshness(snapshot, failureMessage);
    if (this.freshness.isStale) {
      await this.maybeRecoverConnection(snapshot);
    } else if (snapshot) {
      await this.syncPose(snapshot);
    }
  }

  private updateFreshness(
    snapshot: ConnectionSnapshot | null,
    failureMessage: string | null,
  ): void {
    const wasStale = this.freshness.isStale;
    const isFresh = snapshot !== null && isLiveConnection(snapshot);
    const reason = isFresh
      ? null
      : snapshot === null
        ? `bridge unreachable: ${failureMessage ?? "unknown"}`
        : describeStaleConnection(snapshot);

    if (isFresh && wasStale) {
      const staleForMs =
        this.freshness.staleSinceAt !== null
          ? Date.now() - this.freshness.staleSinceAt
          : 0;
      console.log(
        `[agent-daemon] world fresh again after ${Math.round(
          staleForMs / 1000,
        )}s ` +
          `(join generation ${snapshot?.joinGeneration}, ${this.recoveryAttemptCount} recovery attempt(s))`,
      );
      this.appendEvent("connection-fresh", {
        staleForMs,
        joinGeneration: snapshot?.joinGeneration,
        recoveryAttemptCount: this.recoveryAttemptCount,
      });
      this.recoveryAttemptCount = 0;
      this.lastRecoveryAt = 0;
    } else if (!isFresh && !wasStale) {
      console.warn(`[agent-daemon] world went stale: ${reason}`);
      this.appendEvent("connection-stale", { reason });
    }

    this.freshness = {
      isStale: !isFresh,
      reason,
      staleSinceAt: isFresh ? null : this.freshness.staleSinceAt ?? Date.now(),
      lastConnection: snapshot ?? this.freshness.lastConnection,
      lastCheckedAt: Date.now(),
    };
  }

  private async maybeRecoverConnection(
    snapshot: ConnectionSnapshot | null,
  ): Promise<void> {
    if (this.isRecoveryInFlight) return;
    const staleSinceAt = this.freshness.staleSinceAt;
    if (staleSinceAt === null) return;
    const staleForMs = Date.now() - staleSinceAt;
    if (staleForMs < RECOVERY_GRACE_MS) return;
    const backoffMs = Math.min(
      RECOVERY_BACKOFF_MAX_MS,
      RECOVERY_BACKOFF_BASE_MS * 2 ** this.recoveryAttemptCount,
    );
    if (
      this.lastRecoveryAt !== 0 &&
      Date.now() - this.lastRecoveryAt < backoffMs
    ) {
      return;
    }

    // A page whose calls time out is busy (a bulk remesh on a loaded box),
    // not gone: resetting it throws away its join and makes the next one
    // just as slow. Only a stall that outlasts this is treated as wedged.
    if (
      snapshot === null &&
      this.pageStalledSinceAt !== null &&
      Date.now() - this.pageStalledSinceAt < STALLED_PAGE_RESET_AFTER_MS
    ) {
      if (!this.isStallNoted) {
        console.log(
          `[agent-daemon] ${new Date().toISOString()} page is busy (its calls time out); waiting up to ${Math.round(
            STALLED_PAGE_RESET_AFTER_MS / 1000,
          )}s before treating it as wedged`,
        );
        this.isStallNoted = true;
      }
      return;
    }
    this.isStallNoted = false;
    this.isRecoveryInFlight = true;
    this.recoveryAttemptCount += 1;
    this.lastRecoveryAt = Date.now();
    const attempt = this.recoveryAttemptCount;
    // Escalate to a page reset when the bridge cannot be reached, the client
    // build was terminally rejected (only a reload gets a new build), or
    // in-page reconnects have had their chances. Never a new browser: the
    // page is reused, per the session lifecycle rule.
    const isResetting =
      snapshot === null ||
      snapshot.isClientOutdated ||
      attempt > IN_PAGE_RECONNECT_ATTEMPTS;
    const strategy = isResetting ? "page reset" : "in-page reconnect";
    console.log(
      `[agent-daemon] recovery attempt ${attempt} (${strategy}): stale ${Math.round(
        staleForMs / 1000,
      )}s, ` + `reason: ${this.freshness.reason}`,
    );
    this.appendEvent("reconnect-attempt", {
      attempt,
      strategy,
      staleForMs,
      reason: this.freshness.reason,
    });
    try {
      if (isResetting) {
        await this.resetPage("reset");
        console.log(
          `[agent-daemon] recovery attempt ${attempt}: page reset completed, awaiting rejoin`,
        );
      } else {
        const isTriggered = await this.agent.reconnectInPage();
        console.log(
          `[agent-daemon] recovery attempt ${attempt}: in-page reconnect ${
            isTriggered ? "triggered" : "reported nothing to do"
          }`,
        );
      }
    } catch (error) {
      console.error(
        `[agent-daemon] recovery attempt ${attempt} (${strategy}) failed:`,
        error instanceof Error ? error.message : error,
      );
    } finally {
      this.isRecoveryInFlight = false;
    }
  }

  /**
   * Live staleness gate for read routes: reads answered from a
   * disconnected or rejoining client describe a world that may no longer
   * exist. Checked against the page directly (not the watcher cache) so a
   * read racing a disconnect cannot slip through; `allowStale=true` opts
   * out explicitly.
   */
  private async assertReadableWorld(
    query: { allowStale?: string },
    reply: FastifyReply,
  ): Promise<boolean> {
    if (query.allowStale === "true" || query.allowStale === "1") {
      return true;
    }
    let reason: string;
    try {
      const snapshot = await this.agent.connection();
      this.freshness.lastConnection = snapshot;
      if (isLiveConnection(snapshot)) {
        return true;
      }
      reason = describeStaleConnection(snapshot);
    } catch (error) {
      // A wedged page is a stall (503, retry the same world); a page that is
      // mid-reload or lost its bridge is a world we cannot vouch for (409).
      if (error instanceof PageStallError) {
        throw error;
      }
      reason = `bridge unreachable (${
        error instanceof Error ? error.message : String(error)
      })`;
    }
    reply.code(409);
    void reply.send({
      ok: false,
      error:
        `world stale: ${reason} — reads would come from a map the server ` +
        `may no longer agree with; pass allowStale=true to read anyway`,
      isStale: true,
      staleForMs:
        this.freshness.staleSinceAt !== null
          ? Date.now() - this.freshness.staleSinceAt
          : null,
      retryAfterMs: CONNECTION_WATCH_INTERVAL_MS,
    });
    return false;
  }

  private registerErrorMapping(): void {
    this.server.setErrorHandler((error, _req, reply) => {
      if (error instanceof PageStallError) {
        void reply.code(503).send({
          ok: false,
          error: error.message,
          call: error.call,
          retryAfterMs: error.retryAfterMs,
        });
        return;
      }
      if (error instanceof CaptureViewportError) {
        void reply.code(400).send({ ok: false, error: error.message });
        return;
      }
      if (error instanceof z.ZodError) {
        void reply.code(400).send({ ok: false, error: error.flatten() });
        return;
      }
      void reply.code(500).send({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private isActivityRequest(req: FastifyRequest): boolean {
    const pathname = req.url.split("?")[0];
    return !PASSIVE_ROUTES.has(pathname);
  }

  private settleRequest(req: FastifyRequest): void {
    if (!this.isActivityRequest(req) || this.settledRequests.has(req)) {
      return;
    }
    this.settledRequests.add(req);
    this.inflightCount = Math.max(0, this.inflightCount - 1);
    this.noteActivity();
  }

  private registerActivityTracking(): void {
    this.server.addHook("onRequest", (req, _reply, done) => {
      if (this.isActivityRequest(req)) {
        this.inflightCount += 1;
        this.noteActivity();
        // A command against a throttled page waits for the cap to lift and
        // one frame to draw, so what it reads or captures is current.
        if (this.isDrawThrottled || this.drawThrottleChange) {
          void this.wakeForCommand().finally(() => done());
          return;
        }
      }
      done();
    });
    this.server.addHook("onResponse", (req, _reply, done) => {
      this.settleRequest(req);
      done();
    });
    this.server.addHook("onRequestAbort", (req, done) => {
      this.settleRequest(req);
      done();
    });
  }

  private registerEventTaps(): void {
    const events: (keyof AgentEventMap)[] = [
      "chat",
      "chunk-loaded",
      "chunk-unloaded",
      "entity-spawned",
      "entity-despawned",
      "test-result",
      "test-start",
      "tick",
    ];
    for (const name of events) {
      this.agent.on(name, (payload: unknown) =>
        this.appendEvent(name, payload),
      );
    }
  }

  private appendEvent(name: string, payload: unknown): void {
    this.eventCounter += 1;
    this.events.push({
      id: this.eventCounter,
      name,
      payload,
      at: Date.now(),
    });
    if (this.events.length > 5000) {
      this.events.splice(0, this.events.length - 5000);
    }
  }

  private registerRoutes(): void {
    // Liveness must reflect the real browser/page/bridge chain: a killed
    // browser under a still-listening daemon previously kept returning
    // {ok:true} forever, so PM2 never restarted the wrapper even though the
    // agent was disconnected from the world.
    this.server.get("/healthz", async (_req, reply) => {
      const health = await this.agent.health();
      // A ready world observed while the freshness cache still says stale
      // means the cache is lagging the page (boot or a fast rejoin); sync it
      // now so /status never contradicts a healthz a caller just saw.
      if (health.world.isReady === true && this.freshness.isStale) {
        await this.watchConnectionTick();
      }
      if (!health.isHealthy) {
        reply.code(503);
      }
      return { ok: health.isHealthy, ...health };
    });

    // Lifecycle facts only, never the page: this must answer even when the
    // browser is wedged or dead, so reap/session-list can read the fleet.
    this.server.get("/status", async () => this.status());

    // Who this session is for and what it is doing, editable by anyone who
    // can reach the daemon (the CLI, a scenario, the local admin page). Like
    // /status it never touches the page, so a wedged browser still answers.
    this.server.get("/meta", async () => this.metaResponse());
    this.server.patch("/meta", async (req, reply) => {
      const parsed = metaPatchSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        reply.code(400);
        return {
          error: "meta patch must be { set?: {key: value}, unset?: [key] }",
          issues: parsed.error.issues,
        };
      }
      try {
        this.patchSessionMeta(parsed.data);
      } catch (error) {
        if (error instanceof SessionMetaError) {
          reply.code(400);
          return { error: error.message };
        }
        throw error;
      }
      return this.metaResponse();
    });

    this.server.get<{ Querystring: { allowStale?: string } }>(
      "/me",
      async (req, reply) => {
        if (!(await this.assertReadableWorld(req.query, reply))) return reply;
        const [position, facing] = await Promise.all([
          this.agent.position(),
          this.agent.facing(),
        ]);
        return { position, facing };
      },
    );

    this.server.get<{ Querystring: { allowStale?: string } }>(
      "/snapshot",
      async (req, reply) => {
        if (!(await this.assertReadableWorld(req.query, reply))) return reply;
        return this.agent.snapshot();
      },
    );

    // Optional width/height (CSS px) and scale (device scale factor) resize
    // the page for this one capture only and restore it afterwards. Example:
    // /screenshot?pure=true&width=2560&height=1440&scale=1.5 renders a
    // 3840x2160 (4K) backing canvas without the session ever loading at 4K.
    this.registerScreenshotRoute("/screenshot", false);
    // The in-game "/sc" command over HTTP: always the bare WebGL canvas with
    // HUD overlays hidden, so in-world captures never include page UI (pause
    // menu, badges, chat). Same width/height/scale options as /screenshot.
    this.registerScreenshotRoute("/sc", true);

    // Same optional width/height/scale override as /screenshot: the page is
    // resized for the measurement only, so FPS can be sampled at a real
    // display resolution (e.g. ?width=1512&height=982&scale=2 for a Retina
    // laptop) without the session running at it permanently.
    this.server.get<{
      Querystring: {
        durationMs?: string;
        warmupMs?: string;
        width?: string;
        height?: string;
        scale?: string;
      };
    }>("/frame-rate", async (req, reply) => {
      try {
        const requested = parseCaptureViewportQuery(req.query);
        return await this.agent.measureFrameRate({
          durationMs:
            req.query.durationMs !== undefined
              ? Number(req.query.durationMs)
              : undefined,
          warmupMs:
            req.query.warmupMs !== undefined
              ? Number(req.query.warmupMs)
              : undefined,
          ...requested,
        });
      } catch (e) {
        if (e instanceof CaptureViewportError) {
          reply.code(400);
          return { ok: false, error: e.message };
        }
        throw e;
      }
    });

    this.server.get<{
      Querystring: { x: string; y: string; z: string; allowStale?: string };
    }>("/block", async (req, reply) => {
      if (!(await this.assertReadableWorld(req.query, reply))) return reply;
      const { x, y, z } = req.query;
      const pos = { x: Number(x), y: Number(y), z: Number(z) };
      return { block: await this.agent.blockAt(pos), pos };
    });

    this.server.get<{
      Querystring: { x: string; y: string; z: string; allowStale?: string };
    }>("/light", async (req, reply) => {
      if (!(await this.assertReadableWorld(req.query, reply))) return reply;
      const { x, y, z } = req.query;
      const pos = { x: Number(x), y: Number(y), z: Number(z) };
      return { light: await this.agent.lightAt(pos), pos };
    });

    this.server.get("/chunks", async () => {
      const [loaded, pending] = await Promise.all([
        this.agent.loadedChunks(),
        this.agent.pendingChunks(),
      ]);
      return { loaded, pending };
    });

    this.server.get<{ Querystring: { radius?: string; allowStale?: string } }>(
      "/entities",
      async (req, reply) => {
        if (!(await this.assertReadableWorld(req.query, reply))) return reply;
        const radius = req.query.radius ? Number(req.query.radius) : 16;
        const isLogging = isAgentPerfLogging();
        const traceId = isLogging ? createAgentPerfTraceId() : "";
        if (isLogging) {
          logAgentPerf("entity_http_request", this.agent.worldName, {
            traceId,
            radius,
          });
        }
        try {
          const entities = await this.agent.entitiesNear(radius, traceId);
          if (isLogging) {
            logAgentPerf("entity_http_result", this.agent.worldName, {
              traceId,
              itemCount: entities.length,
              byteSize: JSON.stringify(entities).length,
            });
          }
          return { entities, radius };
        } catch (error) {
          if (isLogging) {
            logAgentPerf("entity_http_error", this.agent.worldName, {
              traceId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          throw error;
        }
      },
    );

    this.server.get("/players", async () => ({
      players: await this.agent.peers(),
    }));

    this.server.get<{ Querystring: { sinceId?: string; sinceMs?: string } }>(
      "/events",
      async (req) => {
        const sinceId = req.query.sinceId ? Number(req.query.sinceId) : 0;
        const sinceMs = req.query.sinceMs ? Number(req.query.sinceMs) : 0;
        const filtered = this.events.filter(
          (e) => e.id > sinceId && e.at >= sinceMs,
        );
        const lastEvent = this.events[this.events.length - 1];
        const lastId = lastEvent ? lastEvent.id : 0;
        return { events: filtered, lastId };
      },
    );

    this.server.post("/act", async (req, reply) => {
      const parsed = actSchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return { ok: false, error: parsed.error.flatten() };
      }
      const body = parsed.data;
      try {
        const result = await this.executeAction(body);
        return { ok: true, result };
      } catch (e) {
        if (e instanceof PageStallError) {
          reply.code(503);
          return {
            ok: false,
            error: e.message,
            call: e.call,
            retryAfterMs: e.retryAfterMs,
          };
        }
        const message = e instanceof Error ? e.message : String(e);
        reply.code(500);
        return { ok: false, error: message };
      }
    });

    this.registerBatchRoute();
    this.registerWaitRoute();
    this.registerFrameRoute();
    this.registerBurstRoute();
    this.registerVideoRoutes();
    this.registerCameraRoutes();
    this.registerReconnectRoute();

    this.server.get("/memory", async () => this.agent.memoryStatus());

    // Main-thread time per function per frame (and, with alloc=1, the
    // garbage each function minted) over a sampling window. The measurement
    // behind any "this costs X ms a frame" claim; `watch` is a regex over
    // the function labels so a gate can name the functions it is about.
    this.server.get<{
      Querystring: {
        durationMs?: string;
        alloc?: string;
        watch?: string;
        top?: string;
      };
    }>("/profile", async (req, reply) => {
      const durationMs =
        req.query.durationMs !== undefined
          ? Number(req.query.durationMs)
          : undefined;
      if (durationMs !== undefined && !(durationMs > 0)) {
        reply.code(400);
        return { ok: false, error: "durationMs must be a positive number" };
      }
      const top =
        req.query.top !== undefined ? Number(req.query.top) : undefined;
      try {
        if (req.query.watch) new RegExp(req.query.watch, "i");
      } catch (error) {
        reply.code(400);
        return {
          ok: false,
          error: `watch is not a valid regex: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
      return this.agent.profile({
        durationMs,
        isSamplingAllocations:
          req.query.alloc === "1" || req.query.alloc === "true",
        watch: req.query.watch ?? null,
        top,
      });
    });

    // A V8 heap snapshot written under the capture dir (heap/), for the
    // leak hunt the memory trend starts: two of these a few minutes apart,
    // diffed by class, name what accumulates; the retaining path names who
    // holds it. Several hundred megabytes and a 10-20 s main-thread hold,
    // so it is a command, never a poll.
    this.server.get<{ Querystring: { label?: string } }>(
      "/heap-snapshot",
      async (req, reply) => {
        const label = sanitizeFileLabel(req.query.label ?? "heap");
        const dir = ensureCaptureDir([HEAP_SNAPSHOT_SUBDIR]);
        const filePath = path.join(
          dir,
          `agent-${Date.now()}_${label}.heapsnapshot`,
        );
        try {
          return await this.agent.heapSnapshot(filePath);
        } catch (error) {
          reply.code(500);
          return {
            error: `heap snapshot failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }
      },
    );

    this.server.get("/render-stats", async () => this.agent.renderStats());

    this.server.get<{ Querystring: { allowStale?: string } }>(
      "/block-animations",
      async (req, reply) => {
        if (!(await this.assertReadableWorld(req.query, reply))) return reply;
        return this.agent.blockAnimations();
      },
    );

    this.server.get("/textures", async () => this.agent.textureCensus());

    this.server.post<{ Body: { color?: string } }>(
      "/textures/fill",
      async (req) =>
        this.agent.fillUnpaintedSurfaces(
          req.body?.color ? { color: req.body.color } : undefined,
        ),
    );

    this.server.get("/mesh-transfer/status", async () =>
      this.agent.meshTransferStatus(),
    );

    this.server.post<{ Body: { mode?: "auto" | "transfer" | "shared" } }>(
      "/mesh-transfer/configure",
      async (req) => {
        const mode = req.body?.mode ?? "auto";
        return this.agent.meshTransferConfigure(mode);
      },
    );

    this.server.get<{
      Querystring: {
        cx?: string;
        cz?: string;
        level?: string;
        warmup?: string;
        iterations?: string;
      };
    }>("/mesh-transfer/benchmark", async (req) => {
      const { cx, cz, level, warmup, iterations } = req.query;
      return this.agent.meshTransferBenchmark({
        cx: cx !== undefined ? Number(cx) : undefined,
        cz: cz !== undefined ? Number(cz) : undefined,
        level: level !== undefined ? Number(level) : undefined,
        warmupIterations: warmup !== undefined ? Number(warmup) : undefined,
        measuredIterations:
          iterations !== undefined ? Number(iterations) : undefined,
      });
    });

    this.server.post("/reset", async () => {
      await this.resetPage("reset");
      return { ok: true };
    });

    // Fresh client code on request: the page reloads (picking up every held
    // hot update), rejoins, and is put back where it stood unless asked not
    // to. Answers once the world is fresh and the pose is back, or when the
    // bridge wait runs out.
    const reloadBodySchema = z
      .object({ isRestoringPose: z.boolean().optional() })
      .nullish();
    this.server.post("/reload", async (req, reply) => {
      const parsed = reloadBodySchema.safeParse(req.body ?? null);
      if (!parsed.success) {
        reply.code(400);
        return { ok: false, error: parsed.error.flatten() };
      }
      const isRestoringPose = parsed.data?.isRestoringPose !== false;
      const pickedUp = this.clientStatus.updatesBehind;
      const before = this.clientStatus.documentId;
      console.log(
        `[agent-daemon] ${new Date().toISOString()} reload requested: picking up ${pickedUp} held client update(s)${
          isRestoringPose ? "" : "; the pose will not be restored"
        }`,
      );
      if (!isRestoringPose) this.isNextRestoreSkipped = true;
      // A page that never installed a bridge gets a plain reload: waiting
      // for a bridge would hang, and its connection is not ours to recover.
      const isBridgeSession = this.connectionWatchTimer !== null;
      if (isBridgeSession) {
        await this.resetPage("reload");
      } else {
        this.expectedNavigation = { cause: "reload", at: Date.now() };
        await this.agent.reloadDocument();
      }
      const deadline = Date.now() + resolveReadyTimeoutMs().timeoutMs;
      let isFresh = false;
      while (Date.now() < deadline) {
        await this.pageWatchTick();
        if (isBridgeSession) await this.watchConnectionTick();
        const isNewDocument = this.clientStatus.documentId !== before;
        if (isNewDocument && (!isBridgeSession || !this.freshness.isStale)) {
          if (this.poseSync) await this.poseSync;
          isFresh = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return {
        ok: isFresh,
        pickedUpUpdates: pickedUp,
        isFresh,
        client: this.status().client,
        pose: this.poseStatus(),
        ...(isFresh
          ? {}
          : {
              error:
                "reloaded, but the world did not rejoin before the bridge wait ran out",
            }),
      };
    });

    const freezeBodySchema = z.object({
      entityId: z.string(),
      durationSecs: z.number().optional(),
    });

    const thawBodySchema = z.object({
      entityId: z.string().optional(),
      all: z.boolean().optional(),
    });

    this.server.post("/freeze", async (req, reply) => {
      const body = freezeBodySchema.parse(req.body);
      await this.agent.call("freeze-entity", {
        entityId: body.entityId,
        durationSecs: body.durationSecs,
      });
      const entity = await this.waitForFrozenMetadata(body.entityId, true);
      if (!entity) {
        reply.code(502);
        return {
          ok: false,
          error: `entity ${body.entityId} metadata.frozen did not flip true`,
        };
      }
      return { ok: true, entity };
    });

    this.server.post("/thaw", async (req, reply) => {
      const body = thawBodySchema.parse(req.body);
      if (body.all) {
        const before = await this.agent.entitiesNear(128);
        const frozenBefore = before.filter(
          (e) => this.metadataFrozenFlag(e.metadata) === true,
        );
        await this.agent.call("thaw-all", {});
        const after = await this.agent.entitiesNear(128);
        const thawed = frozenBefore.map((prev) => {
          const now = after.find((e) => e.id === prev.id) ?? prev;
          return { ...now, metadata: { ...now.metadata, frozen: false } };
        });
        const stillFrozen = after.filter(
          (e) => this.metadataFrozenFlag(e.metadata) === true,
        );
        if (stillFrozen.length > 0) {
          reply.code(502);
          return {
            ok: false,
            error: `${stillFrozen.length} entities still report metadata.frozen after thaw-all`,
            thawed,
          };
        }
        return { ok: true, thawed };
      }

      const entityId = body.entityId;
      if (!entityId) {
        reply.code(400);
        return { ok: false, error: "entityId or all:true required" };
      }
      await this.agent.call("thaw-entity", { entityId });
      const entity = await this.waitForFrozenMetadata(entityId, false);
      if (!entity) {
        reply.code(502);
        const entities = await this.agent.entitiesNear(128);
        const hit = entities.find((e) => e.id === entityId);
        if (!hit) {
          return {
            ok: false,
            error: `entity ${entityId} not found near agent (despawned or out of radius)`,
          };
        }
        return {
          ok: false,
          error: `entity ${entityId} metadata.frozen did not flip false (still ${String(
            hit.metadata?.frozen,
          )})`,
        };
      }
      return { ok: true, entity };
    });
  }

  private metadataFrozenFlag(
    metadata: Record<string, unknown> | undefined,
  ): boolean | undefined {
    const value = metadata?.frozen;
    if (value === true) {
      return true;
    }
    if (value === false) {
      return false;
    }
    return undefined;
  }

  private async waitForFrozenMetadata(
    entityId: string,
    expectFrozen: boolean,
    timeoutMs = 8000,
  ): Promise<import("./bridge").EntitySnapshot | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const entities = await this.agent.entitiesNear(128);
      const hit = entities.find((e) => e.id === entityId);
      if (!hit) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }
      const flag = this.metadataFrozenFlag(hit.metadata);
      if (expectFrozen) {
        if (flag === true) {
          return hit;
        }
      } else if (flag === false) {
        return hit;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return null;
  }

  private registerBatchRoute(): void {
    const batchBodySchema = z.object({
      actions: z.array(actSchema).min(1).max(MAX_BATCH_ACTIONS),
      isStoppingOnError: z.boolean().optional(),
    });

    this.server.post("/batch", async (req, reply) => {
      const parsed = batchBodySchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return { ok: false, error: parsed.error.flatten() };
      }
      const { actions, isStoppingOnError } = parsed.data;
      const results: Array<
        | { ok: true; result: unknown }
        | { ok: false; error: string; retryAfterMs?: number }
      > = [];
      for (const action of actions) {
        try {
          results.push({ ok: true, result: await this.executeAction(action) });
        } catch (e) {
          results.push({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            ...(e instanceof PageStallError
              ? { retryAfterMs: e.retryAfterMs }
              : {}),
          });
          if (isStoppingOnError) break;
        }
      }
      const isAllOk = results.every((entry) => entry.ok);
      return {
        ok: isAllOk,
        executedCount: results.length,
        requestedCount: actions.length,
        results,
      };
    });
  }

  private registerWaitRoute(): void {
    const waitOpSchema = z.enum(["eq", "ne", "gt", "lt", "contains"]);
    const waitValueSchema = z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
    ]);
    const waitBodySchema = z
      .object({
        until: z
          .object({
            kind: z.string().optional(),
            entityId: z.string().optional(),
            radius: z.number().positive().optional(),
            path: z.string().min(1),
            op: waitOpSchema,
            value: waitValueSchema,
          })
          .optional(),
        block: z
          .object({
            x: z.number(),
            y: z.number(),
            z: z.number(),
            predicate: z.object({
              path: z.string().min(1).default("name"),
              op: waitOpSchema.default("eq"),
              value: waitValueSchema,
            }),
          })
          .optional(),
        timeoutMs: z.number().positive().max(WAIT_MAX_TIMEOUT_MS).optional(),
        pollMs: z.number().positive().optional(),
      })
      .refine(
        (body) => (body.until !== undefined) !== (body.block !== undefined),
        {
          message: "provide exactly one of `until` (entity) or `block`",
        },
      );

    this.server.post("/wait", async (req, reply) => {
      const parsed = waitBodySchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return { ok: false, error: parsed.error.flatten() };
      }
      const body = parsed.data;
      const timeoutMs = body.timeoutMs ?? WAIT_DEFAULT_TIMEOUT_MS;
      const pollMs = Math.max(
        WAIT_MIN_POLL_MS,
        body.pollMs ?? WAIT_DEFAULT_POLL_MS,
      );
      const startedAt = Date.now();
      let pollCount = 0;
      // Polls are skipped (not matched) while the world is stale: a
      // predicate satisfied by a ghost map would be a false positive.
      let staleSkipCount = 0;
      let lastSeen: unknown = null;
      let lastError: string | null = null;

      while (Date.now() - startedAt < timeoutMs) {
        pollCount += 1;
        try {
          const connection = await this.agent.connection();
          if (!isLiveConnection(connection)) {
            staleSkipCount += 1;
            lastError = `world stale: ${describeStaleConnection(connection)}`;
          } else if (body.until !== undefined) {
            const until = body.until;
            const radius = until.radius ?? WAIT_DEFAULT_RADIUS;
            const entities = await this.agent.entitiesNear(radius);
            const candidates = filterWaitCandidates(entities, until);
            lastSeen = describeLastSeen(
              candidates,
              until.path,
              WAIT_LAST_SEEN_LIMIT,
            );
            const predicate = {
              path: until.path,
              op: until.op,
              value: until.value,
            };
            const hit = candidates.find((entity) =>
              matchesPredicate(resolvePath(entity, until.path), predicate),
            );
            if (hit) {
              return {
                ok: true,
                elapsedMs: Date.now() - startedAt,
                pollCount,
                staleSkipCount,
                matched: {
                  id: hit.id,
                  kind: hit.kind,
                  position: hit.position,
                  distance: hit.distance,
                },
                value: resolvePath(hit, until.path),
              };
            }
            lastError = null;
          } else if (body.block !== undefined) {
            const blockSpec = body.block;
            const block = await this.agent.blockAt({
              x: blockSpec.x,
              y: blockSpec.y,
              z: blockSpec.z,
            });
            lastSeen = block;
            const resolved = resolvePath(block, blockSpec.predicate.path);
            if (matchesPredicate(resolved, blockSpec.predicate)) {
              return {
                ok: true,
                elapsedMs: Date.now() - startedAt,
                pollCount,
                staleSkipCount,
                matched: {
                  block,
                  pos: [blockSpec.x, blockSpec.y, blockSpec.z],
                },
                value: resolved,
              };
            }
            lastError = null;
          }
        } catch (e) {
          // A stalled page mid-wait is not fatal to the wait itself: keep
          // polling until the deadline and report the last failure.
          lastError = e instanceof Error ? e.message : String(e);
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }

      reply.code(408);
      return {
        ok: false,
        error: `wait timed out after ${timeoutMs}ms`,
        elapsedMs: Date.now() - startedAt,
        pollCount,
        staleSkipCount,
        lastSeen,
        lastError,
      };
    });
  }

  private registerFrameRoute(): void {
    const frameBodySchema = z
      .object({
        entityId: z.string().optional(),
        kind: z.string().optional(),
        preset: z
          .enum(["portrait", "side", "three-quarter", "top"])
          .default("side"),
        distanceMultiplier: z.number().positive().optional(),
        distance: z.number().positive().optional(),
        azimuthDeg: z.number().optional(),
        isFreezing: z.boolean().optional(),
        label: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        scale: z.number().optional(),
        settleTimeoutMs: z.number().positive().optional(),
        allowStale: z.boolean().optional(),
      })
      .refine(
        (body) => body.entityId !== undefined || body.kind !== undefined,
        {
          message: "provide entityId or kind",
        },
      );

    this.server.post("/frame", async (req, reply) => {
      const parsed = frameBodySchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return { ok: false, error: parsed.error.flatten() };
      }
      const body = parsed.data;
      const guardQuery = { allowStale: body.allowStale ? "true" : undefined };
      if (!(await this.assertReadableWorld(guardQuery, reply))) return reply;

      const entities = await this.agent.entitiesNear(FRAME_SEARCH_RADIUS);
      const target = body.entityId
        ? entities.find((entity) => entity.id === body.entityId)
        : entities.find((entity) =>
            entity.kind
              .toLowerCase()
              .includes((body.kind as string).toLowerCase()),
          );
      if (!target) {
        reply.code(404);
        return {
          ok: false,
          error: body.entityId
            ? `no entity with id ${body.entityId} within ${FRAME_SEARCH_RADIUS} blocks`
            : `no entity matching kind ~= "${body.kind}" within ${FRAME_SEARCH_RADIUS} blocks ` +
              `(have: ${
                [...new Set(entities.map((entity) => entity.kind))].join(
                  ", ",
                ) || "none"
              })`,
        };
      }

      const isFreezing = body.isFreezing === true;
      if (isFreezing) {
        await this.agent.call("freeze-entity", {
          entityId: target.id,
          durationSecs: FRAME_FREEZE_SECONDS,
        });
        await this.waitForFrozenMetadata(target.id, true);
      }
      try {
        const pose = computeFramePose({
          position: target.position,
          metadata: target.metadata,
          preset: body.preset,
          distanceMultiplier: body.distanceMultiplier,
          distance: body.distance,
          azimuthDeg: body.azimuthDeg,
        });
        await this.agent.view({
          from: pose.from,
          face: { target: pose.lookAt },
          isEnsuringChunks: true,
        });
        const settle = await this.agent.settle(
          body.settleTimeoutMs ?? FRAME_SETTLE_TIMEOUT_MS,
        );
        const buffer = await this.agent.screenshot({
          isPure: true,
          width: body.width,
          height: body.height,
          deviceScaleFactor: body.scale,
        });
        const outputDir = ensureCaptureDir([FRAME_OUTPUT_SUBDIR]);
        const label = sanitizeFileLabel(
          body.label ?? `${target.kind}-${body.preset}`,
        );
        const filePath = path.join(outputDir, `${Date.now()}_${label}.png`);
        fs.writeFileSync(filePath, buffer);
        return {
          ok: true,
          path: filePath,
          entity: {
            id: target.id,
            kind: target.kind,
            position: target.position,
            distance: target.distance,
          },
          pose,
          settle,
          isFrozenDuringShot: isFreezing,
        };
      } finally {
        if (isFreezing) {
          try {
            await this.agent.call("thaw-entity", { entityId: target.id });
          } catch (e) {
            // The freeze self-expires server-side; a failed thaw only delays
            // the entity, but say so instead of hiding it.
            console.error(
              `[agent-daemon] /frame failed to thaw ${target.id}; freeze expires in <=${FRAME_FREEZE_SECONDS}s:`,
              e instanceof Error ? e.message : e,
            );
          }
        }
      }
    });
  }

  private registerBurstRoute(): void {
    const burstBodySchema = z.object({
      label: z.string().optional(),
      count: z
        .number()
        .int()
        .min(1)
        .max(BURST_MAX_FRAMES)
        .default(BURST_DEFAULT_COUNT),
      intervalMs: z
        .number()
        .min(BURST_MIN_INTERVAL_MS)
        .default(BURST_DEFAULT_INTERVAL_MS),
      width: z.number().optional(),
      height: z.number().optional(),
      scale: z.number().optional(),
      allowStale: z.boolean().optional(),
    });

    this.server.post("/sc-burst", async (req, reply) => {
      const parsed = burstBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        reply.code(400);
        return { ok: false, error: parsed.error.flatten() };
      }
      const body = parsed.data;
      const guardQuery = { allowStale: body.allowStale ? "true" : undefined };
      if (!(await this.assertReadableWorld(guardQuery, reply))) return reply;

      const burst = await this.agent.captureBurst({
        count: body.count,
        intervalMs: body.intervalMs,
        width: body.width ?? BURST_DEFAULT_WIDTH,
        height: body.height ?? BURST_DEFAULT_HEIGHT,
        deviceScaleFactor: body.scale,
      });
      const label = sanitizeFileLabel(body.label ?? "burst");
      const dir = path.join(
        ensureCaptureDir(),
        `agent-burst-${label}-${Date.now()}`,
      );
      fs.mkdirSync(dir, { recursive: true });
      const digits = String(burst.frames.length - 1).length;
      const frames = burst.frames.map((frame, index) => {
        const filePath = path.join(
          dir,
          `frame-${String(index).padStart(digits, "0")}.png`,
        );
        fs.writeFileSync(filePath, frame);
        return filePath;
      });
      return {
        ok: true,
        dir,
        frames,
        count: frames.length,
        intervalMs: body.intervalMs,
        capturedAtMs: burst.capturedAtMs,
        overrunFrameCount: burst.overrunFrameCount,
      };
    });
  }

  private registerVideoRoutes(): void {
    const startBodySchema = z.object({
      fps: z.number().min(1).max(120).optional(),
      bitsPerSecond: z.number().int().min(100_000).optional(),
      maxDurationMs: z
        .number()
        .int()
        .min(200)
        .max(VIDEO_MAX_DURATION_MS)
        .default(VIDEO_DEFAULT_MAX_DURATION_MS),
      isPure: z.boolean().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      scale: z.number().optional(),
      allowStale: z.boolean().optional(),
    });

    this.server.post("/video/start", async (req, reply) => {
      const parsed = startBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        reply.code(400);
        return { ok: false, error: parsed.error.flatten() };
      }
      const body = parsed.data;
      const guardQuery = { allowStale: body.allowStale ? "true" : undefined };
      if (!(await this.assertReadableWorld(guardQuery, reply))) return reply;

      try {
        const started = await this.agent.startVideoRecording({
          fps: body.fps,
          bitsPerSecond: body.bitsPerSecond,
          maxDurationMs: body.maxDurationMs,
          isPure: body.isPure,
          width: body.width ?? VIDEO_DEFAULT_WIDTH,
          height: body.height ?? VIDEO_DEFAULT_HEIGHT,
          deviceScaleFactor: body.scale,
        });
        return { ok: true, ...started };
      } catch (e) {
        if (e instanceof CaptureViewportError) {
          reply.code(400);
          return { ok: false, error: e.message };
        }
        // A take already running is a conflict the caller can act on, not a
        // daemon fault: say so with the running take's age.
        reply.code(409);
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    });

    this.server.post<{ Body: { label?: string } }>(
      "/video/stop",
      async (req, reply) => {
        const label = sanitizeFileLabel(req.body?.label ?? "clip");
        try {
          const recording = await this.agent.stopVideoRecording(
            ensureCaptureDir(),
            `agent-video-${label}-${Date.now()}`,
          );
          return { ok: true, ...recording };
        } catch (e) {
          if (this.agent.recordingForMs() === null) {
            reply.code(409);
            return {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            };
          }
          throw e;
        }
      },
    );

    this.server.get("/video/status", async () => this.agent.videoStatus());
  }

  private registerCameraRoutes(): void {
    const subjectAim = {
      offset: vec3Schema.optional(),
      aimY: z.number().optional(),
    };
    const aimSchema = z.union([
      z.object({ point: vec3Schema }),
      z.object({ entityId: z.string(), ...subjectAim }),
      z.object({ kind: z.string(), ...subjectAim }),
    ]);
    const shotSchema = z.object({
      keyframes: z
        .array(
          z.object({
            atMs: z.number().min(0),
            position: vec3Schema,
            aim: aimSchema,
            fov: z.number().min(30).max(150).optional(),
          }),
        )
        .min(2),
      easing: z.enum(["linear", "in", "out", "inOut", "sine"]).optional(),
      isLinear: z.boolean().optional(),
    });

    this.server.post("/camera/shot", async (req, reply) => {
      const parsed = shotSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        reply.code(400);
        return { ok: false, error: parsed.error.flatten() };
      }
      if (!(await this.assertReadableWorld({}, reply))) return reply;

      try {
        return { ok: true, ...(await this.agent.startCameraShot(parsed.data)) };
      } catch (e) {
        // A malformed shot (keyframes out of order, first not at zero) is the
        // caller's mistake, not a page fault: say which, with the reason.
        reply.code(400);
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    });

    this.server.post("/camera/stop", async () => ({
      ok: true,
      ...(await this.agent.stopCameraShot()),
    }));

    this.server.get("/camera/status", async () =>
      this.agent.cameraShotStatus(),
    );
  }

  private registerReconnectRoute(): void {
    const reconnectBodySchema = z
      .object({
        isResetting: z.boolean().optional(),
      })
      .nullish();

    this.server.post("/reconnect", async (req, reply) => {
      const parsed = reconnectBodySchema.safeParse(req.body ?? null);
      if (!parsed.success) {
        reply.code(400);
        return { ok: false, error: parsed.error.flatten() };
      }
      if (parsed.data?.isResetting) {
        console.log("[agent-daemon] manual /reconnect with reset requested");
        await this.resetPage("reset");
        return { ok: true, action: "reset" };
      }
      let connection: ConnectionSnapshot | null = null;
      try {
        connection = await this.agent.connection();
      } catch (e) {
        console.log(
          "[agent-daemon] manual /reconnect: bridge unreachable, resetting page:",
          e instanceof Error ? e.message : e,
        );
        await this.resetPage("reset");
        return { ok: true, action: "reset", reason: "bridge unreachable" };
      }
      if (isLiveConnection(connection)) {
        return { ok: true, action: "none", connection };
      }
      if (connection.isClientOutdated) {
        console.log(
          "[agent-daemon] manual /reconnect: client build outdated, resetting page",
        );
        await this.resetPage("reset");
        return { ok: true, action: "reset", reason: "client outdated" };
      }
      const isTriggered = await this.agent.reconnectInPage();
      console.log(
        `[agent-daemon] manual /reconnect: in-page reconnect ${
          isTriggered ? "triggered" : "reported nothing to do"
        }`,
      );
      return {
        ok: true,
        action: isTriggered ? "reconnect-requested" : "none",
        connection,
      };
    });
  }

  private registerScreenshotRoute(
    routePath: string,
    isAlwaysPure: boolean,
  ): void {
    this.server.get<{
      Querystring: {
        pure?: string;
        hand?: string;
        width?: string;
        height?: string;
        scale?: string;
        allowStale?: string;
      };
    }>(routePath, async (req, reply) => {
      if (!(await this.assertReadableWorld(req.query, reply))) return reply;
      const isPure =
        isAlwaysPure || req.query.pure === "true" || req.query.pure === "1";
      const isIncludingArm =
        req.query.hand === "true" || req.query.hand === "1";
      try {
        const requested = parseCaptureViewportQuery(req.query);
        const buffer = await this.agent.screenshot({
          isPure,
          isIncludingArm,
          ...requested,
        });
        reply.header("content-type", "image/png");
        return buffer;
      } catch (e) {
        if (e instanceof CaptureViewportError) {
          reply.code(400);
          return { ok: false, error: e.message };
        }
        throw e;
      }
    });
  }

  private async executeAction(
    action: z.infer<typeof actSchema>,
  ): Promise<unknown> {
    const result = await this.runAction(action);
    // Flying and the view radius cannot be read back from the page, so the
    // commands that set them are what a restore replays.
    if (action.type === "set-flying" || action.type === "set-render-radius") {
      this.poseIntent = mergePoseIntent(
        this.poseIntent,
        action.type === "set-flying"
          ? { isFlying: action.isFlying }
          : { renderRadius: (result as { renderRadius: number }).renderRadius },
      );
      if (this.pose) this.pose = { ...this.pose, ...this.poseIntent };
    } else if (POSE_CHANGING_ACTIONS.has(action.type)) {
      await this.notePoseCommand();
    }
    return result;
  }

  private async runAction(action: z.infer<typeof actSchema>): Promise<unknown> {
    switch (action.type) {
      case "chat":
        return this.agent.chat(action.text);
      case "teleport": {
        await this.agent.teleport(action.pos, {
          isEnsuringChunks: action.isEnsuringChunks,
        });
        if (action.isSettling) {
          return { teleported: true, settle: await this.agent.settle() };
        }
        return { teleported: true };
      }
      case "face":
        await this.agent.face(action.input);
        return { faced: true };
      case "walk":
        await this.agent.walk(action.direction, {
          durationMs: action.durationMs,
          isSprinting: action.isSprinting,
          isJumping: action.isJumping,
        });
        return { walked: true };
      case "walk-to":
        await this.agent.walkTo(action.target, {
          tolerance: action.tolerance,
          timeoutMs: action.timeoutMs,
          isSprinting: action.isSprinting,
        });
        return { arrived: true };
      case "view": {
        await this.agent.view({
          from: action.from,
          face: action.face,
          isEnsuringChunks: action.isEnsuringChunks,
        });
        if (action.isSettling) {
          return { viewed: true, settle: await this.agent.settle() };
        }
        return { viewed: true };
      }
      case "follow":
        return this.agent.follow(action.target, {
          distance: action.distance,
          heightOffset: action.heightOffset,
          relativeBearing: action.relativeBearing,
        });
      case "unfollow":
        await this.agent.unfollow();
        return { unfollowed: true };
      case "set-flying":
        await this.agent.setFlying(action.isFlying);
        return { flying: action.isFlying };
      case "set-render-radius":
        return {
          renderRadius: await this.agent.setRenderRadius(action.radius),
        };
      case "call":
        return this.agent.call(action.method, action.payload);
      case "break-voxel":
        return this.agent.breakVoxel(action.pos);
      case "place-voxel":
        return this.agent.placeVoxel(action.pos, action.block);
      case "select-hotbar":
        await this.agent.selectHotbar(action.slot);
        return { selectedSlot: action.slot };
      case "interact":
        return this.agent.interact(action.button ?? "right", action.holdMs);
      case "wait":
        await new Promise((r) => setTimeout(r, action.ms));
        return { waited: action.ms };
      case "wait-for-chunks":
        await this.agent.waitForChunks(
          action.pos,
          action.radius ?? 2,
          action.timeoutMs ?? 10_000,
        );
        return { loaded: true };
    }
  }
}
