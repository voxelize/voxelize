import puppeteer, { Browser, Page } from "puppeteer";

import type {
  AgentEventMap,
  AgentEventName,
  BlockInfo,
  ChatMsgIn,
  ChunkCoord,
  ChunkSnapshot,
  ChunkState,
  CommandResult,
  EntitySnapshot,
  FaceInput,
  FollowOptions,
  FollowStatus,
  FollowTarget,
  FrameRateMeasurement,
  FrameRateMeasurementOptions,
  MeshTransferBenchmarkRequest,
  MeshTransferBenchmarkResult,
  MeshTransferStatus,
  PeerSnapshot,
  RaycastHit,
  Snapshot,
  Vec3,
  ViewOptions,
  WalkDirection,
  WalkOptions,
  WalkToOptions,
  YawPitch,
} from "./bridge";
import {
  agentPidFile,
  clearAgentPidFile,
  reapStaleAgentBrowser,
  recordAgentBrowser,
} from "./browser-lifecycle";
import {
  CaptureViewport,
  expectedBackingSize,
  resolveCaptureViewport,
} from "./capture-viewport";
import { AgentHealth, AgentWorldHealth, evaluateAgentHealth } from "./health";
import {
  createAgentPerfTraceId,
  isAgentPerfLogging,
  logAgentPerf,
  writeClientPerfLine,
} from "./perf";

export type AgentLaunchOptions = {
  url: string;
  world: string;
  name?: string;
  isHeadless?: boolean;
  port?: number;
  agentSecret?: string;
  waitReadyTimeoutMs?: number;
  /**
   * Visited before joining the world so the response can set session
   * cookies (e.g. a dev-login endpoint), letting the agent run as an
   * authenticated user with admin-only commands available.
   */
  authUrl?: string;
};

export type ScreenshotOptions = {
  /**
   * When true, the client hides all HUD overlays (nametags, sprite texts,
   * health bars, block highlight), renders one frame, and returns only the
   * WebGL canvas instead of the full page.
   */
  isPure?: boolean;
  /**
   * Optional capture-only viewport width in CSS pixels. When any of width,
   * height, or deviceScaleFactor is set, the page is temporarily resized for
   * this one capture and restored afterwards. This keeps join/load running at
   * the lightweight default viewport: heavy worlds under software WebGL stall
   * (and can drop the websocket) when the whole session renders at 4K, so
   * high resolution is paid for only during the capture itself.
   */
  width?: number;
  /** Optional capture-only viewport height in CSS pixels. */
  height?: number;
  /**
   * Optional capture-only device scale factor. The canvas backing store ends
   * up at width*deviceScaleFactor x height*deviceScaleFactor, e.g.
   * 2560x1440 at 1.5 yields a 3840x2160 (4K) capture.
   */
  deviceScaleFactor?: number;
};

const DEFAULT_DAEMON_PORT = 4099;
const BROWSER_CLOSE_TIMEOUT_MS = 1500;
const ENTITY_ACCESS_TIMEOUT_MS = 5000;
const CAPTURE_RESIZE_PAINT_TIMEOUT_MS = 15_000;
const HEALTH_SNAPSHOT_TIMEOUT_MS = 3_000;

function positiveEnvNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export class Agent {
  private browser: Browser;
  private page: Page;
  private targetUrl = "";
  private readonly pidFile: string;
  private eventListeners: Map<AgentEventName, Set<(data: unknown) => void>> =
    new Map();
  private chatLog: ChatMsgIn[] = [];
  private isClosing = false;
  private isBridgeReady = false;
  private bridgeError: string | null = null;
  private unexpectedDisconnectReason: string | null = null;
  private disconnectListeners = new Set<(reason: string) => void>();
  public readyPromise: Promise<void>;

  private constructor(
    browser: Browser,
    page: Page,
    readyPromise: Promise<void>,
    pidFile: string,
    public readonly worldName: string,
  ) {
    this.browser = browser;
    this.page = page;
    this.readyPromise = readyPromise;
    this.pidFile = pidFile;
  }

  static async launch(options: AgentLaunchOptions): Promise<Agent> {
    const {
      url,
      world,
      name = "agent",
      isHeadless = true,
      waitReadyTimeoutMs = 60_000,
      port = DEFAULT_DAEMON_PORT,
      authUrl,
    } = options;

    const pidFile = agentPidFile(port);
    reapStaleAgentBrowser(pidFile);

    const browser = await puppeteer.launch({
      headless: isHeadless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
      ],
      defaultViewport: {
        width: positiveEnvNumber("AGENT_VIEWPORT_WIDTH", 1280),
        height: positiveEnvNumber("AGENT_VIEWPORT_HEIGHT", 720),
        deviceScaleFactor: positiveEnvNumber("AGENT_VIEWPORT_SCALE", 1),
      },
    });
    recordAgentBrowser(pidFile, browser.process()?.pid);

    const page = await browser.newPage();

    // Agent browsers run in ephemeral profiles, but a stale Chrome process can
    // still race a new daemon and reuse the same generated client ID. Seed a
    // deterministic per-daemon identity before any app script executes so two
    // agent ports can join the same world safely (monitor + marketing camera).
    await page.evaluateOnNewDocument((agentPort) => {
      localStorage.setItem("VOXELIZE-playerId", `agent-${agentPort}`);
    }, port);

    const agent = new Agent(browser, page, Promise.resolve(), pidFile, world);
    browser.on("disconnected", () => agent.handleBrowserDisconnected());
    agent.attachPageLogging(page);
    await agent.installChatCapture();

    // Registered on every navigation (dev-server reloads included), so the
    // control surface survives hot reloads without a daemon restart.
    await page.evaluateOnNewDocument(() => {
      window.__agentRequired__ = () => {
        const bridge = window.__agent__;
        if (!bridge) throw new Error("Agent bridge is not installed");
        return bridge;
      };
    });

    if (authUrl) {
      await page.goto(authUrl, { waitUntil: "domcontentloaded" });
      console.log(`[voxelize-agent] visited auth url: ${authUrl}`);
    }

    const target = new URL(`${url.replace(/\/$/, "")}/${world}`);
    target.searchParams.set("agent", "true");
    target.searchParams.set("agentName", name);
    if (process.env.AGENT_CAPTURE_MODE === "true") {
      target.searchParams.set("capture", "true");
    }
    // Visual tests of held items opt into rendering the first-person arm,
    // which agent screenshots otherwise omit (see client agent mode).
    if (process.env.AGENT_ARM_VISIBLE === "true") {
      target.searchParams.set("agentArm", "true");
    }
    agent.targetUrl = target.toString();

    await page.goto(target.toString(), { waitUntil: "domcontentloaded" });

    const ready = Agent.waitForBridge(page, waitReadyTimeoutMs);

    agent.trackReadyPromise(ready);
    return agent;
  }

  private trackReadyPromise(ready: Promise<void>): void {
    this.readyPromise = ready;
    this.isBridgeReady = false;
    this.bridgeError = null;
    ready.then(
      () => {
        if (this.readyPromise === ready) this.isBridgeReady = true;
      },
      (error: Error) => {
        if (this.readyPromise === ready) this.bridgeError = error.message;
      },
    );
  }

  private handleBrowserDisconnected(): void {
    // Expected during close()/killBrowserSync(); anything else means the
    // browser process died or the DevTools connection dropped underneath a
    // still-running daemon, which supervisors must be able to observe.
    if (this.isClosing) return;
    const reason =
      "browser disconnected unexpectedly (process died or connection lost)";
    this.unexpectedDisconnectReason = reason;
    console.error(`[voxelize-agent] ${reason}`);
    for (const cb of this.disconnectListeners) {
      try {
        cb(reason);
      } catch (e) {
        console.error("[voxelize-agent] disconnect listener error:", e);
      }
    }
  }

  onUnexpectedDisconnect(cb: (reason: string) => void): () => void {
    this.disconnectListeners.add(cb);
    return () => {
      this.disconnectListeners.delete(cb);
    };
  }

  private static async waitForBridge(
    page: Page,
    waitReadyTimeoutMs: number,
  ): Promise<void> {
    try {
      await page.waitForFunction(() => Boolean(window.__agent__), {
        timeout: waitReadyTimeoutMs,
      });
      await page.evaluate(() => {
        window.__agentRequired__ = () => {
          const agent = window.__agent__;
          if (!agent) throw new Error("Agent bridge is not installed");
          return agent;
        };
        return window
          .__agentRequired__()
          .ready.then(() => undefined)
          .catch((e: unknown) => {
            throw e instanceof Error ? e : new Error(String(e));
          });
      });
    } catch (error) {
      const snapshot = await page.evaluate(() => ({
        url: window.location.href,
        hasAgent: Boolean(window.__agent__),
        canvasCount: document.querySelectorAll("canvas").length,
        crossOriginIsolated:
          typeof crossOriginIsolated !== "undefined" && crossOriginIsolated,
      }));

      const hint =
        snapshot.url.includes("127.0.0.1") && !snapshot.hasAgent
          ? " In dev, use --url http://localhost:3000 (127.0.0.1 is blocked by CORS unless the server was restarted with 127.0.0.1 origins)."
          : "";

      throw new Error(
        `Timed out after ${waitReadyTimeoutMs}ms waiting for window.__agent__ ` +
          `(hasAgent=${snapshot.hasAgent}, canvasCount=${snapshot.canvasCount}, ` +
          `url=${snapshot.url}).${hint}`,
        { cause: error },
      );
    }
  }

  async ready(): Promise<void> {
    return this.readyPromise;
  }

  /**
   * Reload the page and wait for the bridge to reinstall. Recovers from
   * dropped websockets (server rebuilds) and wedged pages without cycling
   * the daemon process or its port. If the renderer itself died (detached
   * main frame), a brand-new page is opened at the same URL instead.
   */
  async reset(waitReadyTimeoutMs = 60_000): Promise<void> {
    try {
      await this.page.reload({ waitUntil: "domcontentloaded" });
    } catch (error) {
      console.error(
        "[voxelize-agent] reload failed, replacing page:",
        error instanceof Error ? error.message : error,
      );
      const stale = this.page;
      const page = await this.browser.newPage();
      this.attachPageLogging(page);
      this.page = page;
      await this.installChatCapture();
      await page.evaluateOnNewDocument(() => {
        window.__agentRequired__ = () => {
          const bridge = window.__agent__;
          if (!bridge) throw new Error("Agent bridge is not installed");
          return bridge;
        };
      });
      await page.goto(this.targetUrl, { waitUntil: "domcontentloaded" });
      try {
        await stale.close();
      } catch {
        // renderer already gone
      }
    }
    const ready = Agent.waitForBridge(this.page, waitReadyTimeoutMs);
    this.trackReadyPromise(ready);
    await ready;
  }

  private attachPageLogging(page: Page): void {
    page.on("console", (msg) => {
      const type = msg.type();
      let text = msg.text();
      if (text.startsWith("[PERF] ")) {
        writeClientPerfLine(text);
        console.log(text);
        return;
      }
      if (type === "error" || type === "warn") {
        // console.error args arrive as JSHandles whose text collapses to
        // "JSHandle@error"; the remote object description carries the real
        // message and stack, which is what makes page failures actionable.
        if (text.includes("JSHandle@")) {
          const descriptions = msg
            .args()
            .map((arg) => arg.remoteObject().description ?? "")
            .filter((description) => description.length > 0);
          if (descriptions.length > 0) {
            text = descriptions.join(" ");
          }
        }
        console.error(`[agent-page] ${type}:`, text);
        return;
      }
      if (
        text.startsWith("[agent") ||
        text.startsWith("[NETWORK]") ||
        text.includes("GAMETEST")
      ) {
        console.log(`[agent-page]`, text);
      }
    });
    page.on("pageerror", (err) => {
      console.error("[agent-page-error]", err.message);
    });
  }

  async close(): Promise<void> {
    this.isClosing = true;
    const proc = this.browser.process();
    try {
      await Promise.race([
        this.browser.close(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("browser close timed out")),
            BROWSER_CLOSE_TIMEOUT_MS,
          ),
        ),
      ]);
    } catch {
      try {
        proc?.kill("SIGKILL");
      } catch {
        // already gone
      }
    } finally {
      clearAgentPidFile(this.pidFile);
    }
  }

  browserPid(): number | undefined {
    return this.browser.process()?.pid ?? undefined;
  }

  killBrowserSync(): void {
    this.isClosing = true;
    try {
      this.browser.process()?.kill("SIGKILL");
    } catch {
      // already gone
    }
    clearAgentPidFile(this.pidFile);
  }

  async chat(text: string): Promise<CommandResult> {
    return this.page.evaluate((t) => window.__agentRequired__().chat(t), text);
  }

  async teleport(
    pos: Vec3,
    opts?: { isEnsuringChunks?: boolean },
  ): Promise<void> {
    await this.page.evaluate(
      (p, o) => window.__agentRequired__().teleport(p, o),
      pos,
      opts ?? {},
    );
  }

  async face(input: FaceInput): Promise<void> {
    await this.page.evaluate((i) => window.__agentRequired__().face(i), input);
  }

  async walk(direction: WalkDirection, opts?: WalkOptions): Promise<void> {
    await this.page.evaluate(
      (d, o) => window.__agentRequired__().walk(d, o),
      direction,
      opts ?? {},
    );
  }

  async walkTo(target: Vec3, opts?: WalkToOptions): Promise<void> {
    await this.page.evaluate(
      (t, o) => window.__agentRequired__().walkTo(t, o),
      target,
      opts ?? {},
    );
  }

  async view(opts: ViewOptions): Promise<void> {
    await this.page.evaluate((o) => window.__agentRequired__().view(o), opts);
  }

  async follow(
    target: FollowTarget,
    opts?: FollowOptions,
  ): Promise<FollowStatus> {
    return this.page.evaluate(
      (t, o) => window.__agentRequired__().follow(t, o),
      target,
      opts ?? {},
    );
  }

  async unfollow(): Promise<void> {
    await this.page.evaluate(() => window.__agentRequired__().unfollow());
  }

  async following(): Promise<FollowStatus | null> {
    return this.page.evaluate(() => window.__agentRequired__().following());
  }

  async setFlying(isFlying: boolean): Promise<void> {
    await this.page.evaluate(
      (f) => window.__agentRequired__().setFlying(f),
      isFlying,
    );
  }

  async setRenderRadius(radius: number): Promise<number> {
    return this.page.evaluate(
      (r) => window.__agentRequired__().setRenderRadius(r),
      radius,
    );
  }

  async call(method: string, payload: unknown): Promise<unknown> {
    return this.page.evaluate(
      (m, p) => window.__agentRequired__().call(m, p),
      method,
      payload,
    );
  }

  async breakVoxel(pos: Vec3): Promise<{
    beforeId: number;
    afterId: number;
    queued: boolean;
  }> {
    return this.page.evaluate(
      (p) => window.__agentRequired__().breakVoxel(p),
      pos,
    );
  }

  async meshTransferStatus(): Promise<MeshTransferStatus> {
    return this.page.evaluate(() =>
      window.__agentRequired__().meshTransferStatus(),
    );
  }

  async meshTransferConfigure(
    mode: "auto" | "transfer" | "shared",
  ): Promise<MeshTransferStatus> {
    return this.page.evaluate(
      (m) => window.__agentRequired__().meshTransferConfigure(m),
      mode,
    );
  }

  async meshTransferBenchmark(
    opts: MeshTransferBenchmarkRequest = {},
  ): Promise<MeshTransferBenchmarkResult> {
    return this.page.evaluate(
      (o) => window.__agentRequired__().meshTransferBenchmark(o),
      opts,
    );
  }

  async position(): Promise<Vec3> {
    return this.page.evaluate(() => window.__agentRequired__().position());
  }

  async facing(): Promise<YawPitch> {
    return this.page.evaluate(() => window.__agentRequired__().facing());
  }

  async raycast(): Promise<RaycastHit | null> {
    return this.page.evaluate(() => window.__agentRequired__().raycast());
  }

  async blockAt(pos: Vec3): Promise<BlockInfo | null> {
    return this.page.evaluate(
      (p) => window.__agentRequired__().blockAt(p),
      pos,
    );
  }

  async entitiesNear(
    radius: number,
    requestedTraceId?: string,
  ): Promise<EntitySnapshot[]> {
    const isLogging = isAgentPerfLogging();
    const traceId =
      requestedTraceId ?? (isLogging ? createAgentPerfTraceId() : "");
    if (isLogging) {
      logAgentPerf("entity_bridge_request", this.worldName, {
        traceId,
        radius,
      });
    }

    let timeout: NodeJS.Timeout | undefined;
    try {
      const entities = await Promise.race([
        this.page.evaluate(
          (r, t) => window.__agentRequired__().entitiesNear(r, t),
          radius,
          traceId,
        ),
        new Promise<EntitySnapshot[]>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error(
                  `Entity cache access timed out after ${ENTITY_ACCESS_TIMEOUT_MS}ms`,
                ),
              ),
            ENTITY_ACCESS_TIMEOUT_MS,
          );
        }),
      ]);
      if (isLogging) {
        logAgentPerf("entity_bridge_result", this.worldName, {
          traceId,
          itemCount: entities.length,
          byteSize: JSON.stringify(entities).length,
        });
      }
      return entities;
    } catch (error) {
      if (isLogging) {
        logAgentPerf("entity_bridge_error", this.worldName, {
          traceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async peers(): Promise<PeerSnapshot[]> {
    return this.page.evaluate(() => window.__agentRequired__().peers());
  }

  async snapshot(): Promise<Snapshot> {
    return this.page.evaluate(() => window.__agentRequired__().snapshot());
  }

  async health(): Promise<AgentHealth> {
    const proc = this.browser.process();
    const isBrowserProcessAlive =
      proc === null ? null : proc.exitCode === null && proc.signalCode === null;
    const isBrowserConnected = this.browser.connected;
    const isPageOpen = !this.page.isClosed();

    // Only query the page when the whole transport chain is alive; evaluating
    // against a dead browser would hang or throw instead of reporting.
    let world: AgentWorldHealth = {
      name: this.worldName,
      isReady: null,
      error: null,
    };
    if (
      isBrowserConnected &&
      isPageOpen &&
      this.isBridgeReady &&
      isBrowserProcessAlive !== false
    ) {
      let timeout: NodeJS.Timeout | undefined;
      try {
        const snapshot = await Promise.race([
          this.snapshot(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () =>
                reject(
                  new Error(
                    `snapshot timed out after ${HEALTH_SNAPSHOT_TIMEOUT_MS}ms`,
                  ),
                ),
              HEALTH_SNAPSHOT_TIMEOUT_MS,
            );
          }),
        ]);
        world = {
          name: snapshot.world || this.worldName,
          isReady: snapshot.isReady,
          error: null,
        };
      } catch (error) {
        world = {
          name: this.worldName,
          isReady: null,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }

    return evaluateAgentHealth({
      isBrowserConnected,
      isBrowserProcessAlive,
      browserPid: proc?.pid ?? null,
      isPageOpen,
      isBridgeReady: this.isBridgeReady,
      bridgeError: this.bridgeError,
      unexpectedDisconnectReason: this.unexpectedDisconnectReason,
      world,
    });
  }

  async chunkState(target: Vec3 | ChunkCoord): Promise<ChunkState> {
    return this.page.evaluate(
      (t) => window.__agentRequired__().chunks.state(t),
      target as Vec3 | ChunkCoord,
    );
  }

  async waitForChunks(
    pos: Vec3,
    radius = 2,
    timeoutMs = 10_000,
  ): Promise<void> {
    await this.page.evaluate(
      (p, r, t) => window.__agentRequired__().chunks.waitFor(p, r, t),
      pos,
      radius,
      timeoutMs,
    );
  }

  async loadedChunks(): Promise<ChunkCoord[]> {
    return this.page.evaluate(() => window.__agentRequired__().chunks.loaded());
  }

  async pendingChunks(): Promise<ChunkCoord[]> {
    return this.page.evaluate(() =>
      window.__agentRequired__().chunks.pending(),
    );
  }

  async chunkList(): Promise<ChunkSnapshot[]> {
    return this.page.evaluate(() => window.__agentRequired__().chunks.list());
  }

  async screenshot(opts: ScreenshotOptions = {}): Promise<Buffer> {
    const current = this.page.viewport();
    const currentViewport: CaptureViewport = {
      width: current?.width ?? 1280,
      height: current?.height ?? 720,
      deviceScaleFactor: current?.deviceScaleFactor || 1,
    };
    // Throws CaptureViewportError for out-of-range requests; the daemon maps
    // that to an HTTP 400 before the page is touched at all.
    const captureViewport = resolveCaptureViewport(opts, currentViewport);
    if (!captureViewport) {
      return this.captureBuffer(opts.isPure === true);
    }

    // Resize only for the duration of this capture. Joining/loading at 4K
    // under software WebGL makes every frame so expensive that heavy worlds
    // (e.g. large town hubs) starve the network/chunk pipeline and the agent
    // stalls or disconnects. Loading at the lightweight default viewport and
    // paying for high resolution only inside this window avoids that.
    await this.setViewportAndAwaitPaint(captureViewport);
    try {
      return await this.captureBuffer(opts.isPure === true);
    } finally {
      // Restore even when the capture throws, and wait for the restoration
      // paint too, so the session never keeps running at capture resolution.
      await this.setViewportAndAwaitPaint(currentViewport);
    }
  }

  private async captureBuffer(isPure: boolean): Promise<Buffer> {
    if (isPure) {
      const dataUrl = await this.page.evaluate(
        (o) => window.__agentRequired__().captureFrame(o),
        { isPure: true },
      );
      if (!dataUrl) {
        throw new Error(
          "pure screenshot failed: captureFrame returned null (renderer not ready)",
        );
      }
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      return Buffer.from(base64, "base64");
    }
    const result = await this.page.screenshot({
      type: "png",
      fullPage: false,
    });
    return Buffer.from(result);
  }

  private async setViewportAndAwaitPaint(
    viewport: CaptureViewport,
  ): Promise<void> {
    await this.page.setViewport(viewport);

    // Wait until the app has reacted to the resize and the WebGL canvas
    // backing store reaches the expected size. A 1px tolerance absorbs
    // floor/round differences between renderers. Timing out is downgraded to
    // a warning: a renderer that clamps its pixel ratio would otherwise make
    // captures fail forever, and a slightly-off frame beats no frame.
    const expected = expectedBackingSize(viewport);
    try {
      await this.page.waitForFunction(
        (w, h) => {
          const canvases = Array.from(document.querySelectorAll("canvas"));
          return canvases.some(
            (canvas) =>
              Math.abs(canvas.width - w) <= 1 &&
              Math.abs(canvas.height - h) <= 1,
          );
        },
        { timeout: CAPTURE_RESIZE_PAINT_TIMEOUT_MS, polling: "raf" },
        expected.width,
        expected.height,
      );
    } catch {
      console.warn(
        `[voxelize-agent] canvas did not reach ${expected.width}x${expected.height} ` +
          `within ${CAPTURE_RESIZE_PAINT_TIMEOUT_MS}ms after viewport resize; capturing anyway`,
      );
    }

    // Double requestAnimationFrame guarantees at least one full frame has
    // been rendered and presented at the new backing size before capture.
    await this.page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
  }

  async measureFrameRate(
    opts: FrameRateMeasurementOptions = {},
  ): Promise<FrameRateMeasurement> {
    const durationMs = opts.durationMs ?? 10_000;
    const warmupMs = opts.warmupMs ?? 1_000;

    return this.page.evaluate(
      ({ durationMs: measuredDurationMs, warmupMs: measuredWarmupMs }) =>
        new Promise<FrameRateMeasurement>((resolve) => {
          const frameTimes: number[] = [];
          let warmupStartedAt = 0;
          let measurementStartedAt = 0;
          let lastFrameAt = 0;

          const percentile = (sorted: number[], value: number): number => {
            if (sorted.length === 0) return 0;
            const index = Math.min(
              sorted.length - 1,
              Math.max(0, Math.floor((sorted.length - 1) * value)),
            );
            return sorted[index] ?? 0;
          };

          const tick = (now: number): void => {
            if (warmupStartedAt === 0) {
              warmupStartedAt = now;
              requestAnimationFrame(tick);
              return;
            }

            if (now - warmupStartedAt < measuredWarmupMs) {
              requestAnimationFrame(tick);
              return;
            }

            if (measurementStartedAt === 0) {
              measurementStartedAt = now;
              lastFrameAt = now;
              requestAnimationFrame(tick);
              return;
            }

            frameTimes.push(now - lastFrameAt);
            lastFrameAt = now;

            if (now - measurementStartedAt < measuredDurationMs) {
              requestAnimationFrame(tick);
              return;
            }

            const elapsedMs = lastFrameAt - measurementStartedAt;
            const frameCount = frameTimes.length;
            const totalFrameMs = frameTimes.reduce((sum, ms) => sum + ms, 0);
            const avgFrameMs = frameCount > 0 ? totalFrameMs / frameCount : 0;
            const sorted = [...frameTimes].sort((a, b) => a - b);
            const p50FrameMs = percentile(sorted, 0.5);
            const p95FrameMs = percentile(sorted, 0.95);
            const maxFrameMs = sorted[sorted.length - 1] ?? 0;

            resolve({
              durationMs: measuredDurationMs,
              warmupMs: measuredWarmupMs,
              elapsedMs,
              frameCount,
              avgFps: elapsedMs > 0 ? (frameCount * 1000) / elapsedMs : 0,
              p50Fps: p50FrameMs > 0 ? 1000 / p50FrameMs : 0,
              lowFps: p95FrameMs > 0 ? 1000 / p95FrameMs : 0,
              avgFrameMs,
              p50FrameMs,
              p95FrameMs,
              maxFrameMs,
            });
          };

          requestAnimationFrame(tick);
        }),
      { durationMs, warmupMs },
    );
  }

  on<E extends AgentEventName>(
    event: E,
    cb: (data: AgentEventMap[E]) => void,
  ): () => void {
    let listeners = this.eventListeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(event, listeners);
    }
    listeners.add(cb as (data: unknown) => void);
    return () => {
      listeners?.delete(cb as (data: unknown) => void);
    };
  }

  chatHistory(sinceMs?: number): ChatMsgIn[] {
    if (sinceMs === undefined) {
      return [...this.chatLog];
    }
    return this.chatLog.filter((m) => m.receivedAt >= sinceMs);
  }

  private async installChatCapture(): Promise<void> {
    await this.page.exposeFunction("__agentPushChat__", (msg: ChatMsgIn) => {
      this.chatLog.push(msg);
      if (this.chatLog.length > 2000) {
        this.chatLog.splice(0, this.chatLog.length - 2000);
      }
      this.dispatch("chat", msg);
      this.maybeEmitGametestFromChat(msg);
    });

    await this.page.exposeFunction(
      "__agentPushEvent__",
      (name: string, payload: unknown) => {
        this.dispatch(name as AgentEventName, payload);
      },
    );

    await this.page.evaluateOnNewDocument(() => {
      const waitForAgent = () =>
        new Promise<void>((resolve) => {
          const check = () => {
            if (window.__agent__) {
              resolve();
              return;
            }
            setTimeout(check, 50);
          };
          check();
        });

      waitForAgent().then(() => {
        const w = window as unknown as {
          __agent__: {
            on: (ev: string, cb: (d: unknown) => void) => void;
          };
          __agentPushChat__?: (m: unknown) => void;
          __agentPushEvent__?: (name: string, payload: unknown) => void;
        };

        const pushChat = w.__agentPushChat__;
        if (pushChat) {
          w.__agent__.on("chat", (msg) => pushChat(msg));
        }

        const forwardedEvents = [
          "chunk-loaded",
          "chunk-unloaded",
          "entity-spawned",
          "entity-despawned",
          "test-result",
          "test-start",
          "tick",
        ];
        const pushEvent = w.__agentPushEvent__;
        if (pushEvent) {
          for (const name of forwardedEvents) {
            w.__agent__.on(name, (data) => pushEvent(name, data));
          }
        }
      });
    });
  }

  private dispatch(event: AgentEventName, data: unknown): void {
    const listeners = this.eventListeners.get(event);
    if (!listeners) return;
    for (const cb of listeners) {
      try {
        cb(data);
      } catch (e) {
        console.error(`[agent] listener error for ${event}:`, e);
      }
    }
  }

  private maybeEmitGametestFromChat(msg: ChatMsgIn): void {
    const passRegex = /GAMETEST PASS (\S+) (\d+)ms/;
    const failRegex = /GAMETEST FAIL (\S+) (\d+)ms(?::\s*(.*))?/;
    const startRegex =
      /GAMETEST START (\S+) @ arena (\d+) \((-?\d+), (-?\d+), (-?\d+)\)/;

    const stripColors = (s: string) => s.replace(/\$#[0-9A-Fa-f]{6}\$/g, "");
    const body = stripColors(msg.body);

    const passMatch = body.match(passRegex);
    if (passMatch) {
      this.dispatch("test-result", {
        name: passMatch[1],
        status: "pass",
        elapsedMs: Number(passMatch[2]),
      });
      return;
    }

    const failMatch = body.match(failRegex);
    if (failMatch) {
      this.dispatch("test-result", {
        name: failMatch[1],
        status: "fail",
        elapsedMs: Number(failMatch[2]),
        error: failMatch[3],
      });
      return;
    }

    const startMatch = body.match(startRegex);
    if (startMatch) {
      this.dispatch("test-start", {
        name: startMatch[1],
        arenaIndex: Number(startMatch[2]),
        origin: {
          x: Number(startMatch[3]),
          y: Number(startMatch[4]),
          z: Number(startMatch[5]),
        },
      });
    }
  }
}
