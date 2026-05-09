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
  DiagnosticEntry,
  DiagnosticsSnapshot,
  EntitySnapshot,
  FaceInput,
  ParticleEffectSpec,
  PeerSnapshot,
  RaycastHit,
  RendererStatus,
  Snapshot,
  Vec3,
  ViewOptions,
  WalkDirection,
  WalkOptions,
  WalkToOptions,
  WorldStats,
  YawPitch,
} from "./bridge";

export type AgentLaunchOptions = {
  url: string;
  world: string;
  name?: string;
  isHeadless?: boolean;
  port?: number;
  agentSecret?: string;
  waitReadyTimeoutMs?: number;
};

const DIAGNOSTICS_BUFFER_LIMIT = 500;

export class Agent {
  private browser: Browser;
  private page: Page;
  private eventListeners: Map<AgentEventName, Set<(data: unknown) => void>> =
    new Map();
  private chatLog: ChatMsgIn[] = [];
  private diagnostics: DiagnosticEntry[] = [];
  private diagnosticCounter = 0;
  public readyPromise: Promise<void>;

  private constructor(
    browser: Browser,
    page: Page,
    readyPromise: Promise<void>,
  ) {
    this.browser = browser;
    this.page = page;
    this.readyPromise = readyPromise;
  }

  static async launch(options: AgentLaunchOptions): Promise<Agent> {
    const {
      url,
      world,
      name = "agent",
      isHeadless = true,
      waitReadyTimeoutMs = 60_000,
    } = options;

    const browser = await puppeteer.launch({
      headless: isHeadless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--enable-webgl",
        "--use-gl=swiftshader",
        "--enable-unsafe-swiftshader",
        "--ignore-gpu-blocklist",
      ],
      defaultViewport: { width: 1280, height: 720 },
    });

    const page = await browser.newPage();

    const agent = new Agent(browser, page, Promise.resolve());

    page.on("console", (msg) => {
      const type = msg.type();
      const text = msg.text();
      if (type === "error") {
        agent.recordDiagnostic({
          source: "console",
          severity: "error",
          message: text,
        });
        console.error(`[agent-page] error:`, text);
        return;
      }
      if (type === "warn") {
        agent.recordDiagnostic({
          source: "console",
          severity: "warning",
          message: text,
        });
        console.error(`[agent-page] warn:`, text);
        return;
      }
      if (text.startsWith("[agent") || text.includes("GAMETEST")) {
        console.log(`[agent-page]`, text);
      }
    });

    page.on("pageerror", (err) => {
      agent.recordDiagnostic({
        source: "pageerror",
        severity: "error",
        message: err.message,
      });
      console.error("[agent-page-error]", err.message);
    });

    page.on("requestfailed", (req) => {
      const failure = req.failure();
      const reason = failure?.errorText ?? "unknown";
      agent.recordDiagnostic({
        source: "requestfailed",
        severity: "error",
        message: `${req.method()} ${req.url()} ${reason}`,
        url: req.url(),
      });
    });

    page.on("response", (res) => {
      const status = res.status();
      if (status < 400) return;
      const url = res.url();
      if (url.startsWith("data:") || url.startsWith("blob:")) return;
      agent.recordDiagnostic({
        source: "response",
        severity: status >= 500 ? "error" : "warning",
        message: `${status} ${res.request().method()} ${url}`,
        url,
        status,
      });
    });
    await agent.installChatCapture();

    const target = new URL(`${url.replace(/\/$/, "")}/${world}`);
    target.searchParams.set("agent", "true");
    target.searchParams.set("agentName", name);

    await page.goto(target.toString(), { waitUntil: "domcontentloaded" });

    const ready = page
      .waitForFunction(() => Boolean(window.__agent__), {
        timeout: waitReadyTimeoutMs,
      })
      .then(() =>
        page.evaluate(() =>
          window
            .__agent__!.ready.then(() => undefined)
            .catch((e: unknown) => {
              throw e instanceof Error ? e : new Error(String(e));
            }),
        ),
      );

    agent.readyPromise = ready;
    return agent;
  }

  async ready(): Promise<void> {
    return this.readyPromise;
  }

  async close(): Promise<void> {
    await this.browser.close();
  }

  async chat(text: string): Promise<CommandResult> {
    return this.page.evaluate((t) => window.__agent__!.chat(t), text);
  }

  async teleport(
    pos: Vec3,
    opts?: { isEnsuringChunks?: boolean },
  ): Promise<void> {
    await this.page.evaluate(
      (p, o) => window.__agent__!.teleport(p, o),
      pos,
      opts ?? {},
    );
  }

  async face(input: FaceInput): Promise<void> {
    await this.page.evaluate((i) => window.__agent__!.face(i), input);
  }

  async walk(direction: WalkDirection, opts?: WalkOptions): Promise<void> {
    await this.page.evaluate(
      (d, o) => window.__agent__!.walk(d, o),
      direction,
      opts ?? {},
    );
  }

  async walkTo(target: Vec3, opts?: WalkToOptions): Promise<void> {
    await this.page.evaluate(
      (t, o) => window.__agent__!.walkTo(t, o),
      target,
      opts ?? {},
    );
  }

  async view(opts: ViewOptions): Promise<void> {
    await this.page.evaluate((o) => window.__agent__!.view(o), opts);
  }

  async setFlying(isFlying: boolean): Promise<void> {
    await this.page.evaluate((f) => window.__agent__!.setFlying(f), isFlying);
  }

  async triggerParticles(spec: ParticleEffectSpec): Promise<void> {
    await this.page.evaluate(
      (s) => window.__agent__!.triggerParticles(s),
      spec,
    );
  }

  async call(method: string, payload: unknown): Promise<unknown> {
    return this.page.evaluate(
      (m, p) => window.__agent__!.call(m, p),
      method,
      payload,
    );
  }

  async position(): Promise<Vec3> {
    return this.page.evaluate(() => window.__agent__!.position());
  }

  async facing(): Promise<YawPitch> {
    return this.page.evaluate(() => window.__agent__!.facing());
  }

  async raycast(): Promise<RaycastHit | null> {
    return this.page.evaluate(() => window.__agent__!.raycast());
  }

  async blockAt(pos: Vec3): Promise<BlockInfo | null> {
    return this.page.evaluate((p) => window.__agent__!.blockAt(p), pos);
  }

  async entitiesNear(radius: number): Promise<EntitySnapshot[]> {
    return this.page.evaluate((r) => window.__agent__!.entitiesNear(r), radius);
  }

  async peers(): Promise<PeerSnapshot[]> {
    return this.page.evaluate(() => window.__agent__!.peers());
  }

  async snapshot(): Promise<Snapshot> {
    return this.page.evaluate(() => window.__agent__!.snapshot());
  }

  async rendererStatus(): Promise<RendererStatus> {
    return this.page.evaluate(() => window.__agent__!.renderer());
  }

  async worldStats(): Promise<WorldStats> {
    return this.page.evaluate(() => window.__agent__!.worldStats());
  }

  async chunkState(target: Vec3 | ChunkCoord): Promise<ChunkState> {
    return this.page.evaluate(
      (t) => window.__agent__!.chunks.state(t),
      target as Vec3 | ChunkCoord,
    );
  }

  async waitForChunks(
    pos: Vec3,
    radius = 2,
    timeoutMs = 10_000,
  ): Promise<void> {
    await this.page.evaluate(
      (p, r, t) => window.__agent__!.chunks.waitFor(p, r, t),
      pos,
      radius,
      timeoutMs,
    );
  }

  async loadedChunks(): Promise<ChunkCoord[]> {
    return this.page.evaluate(() => window.__agent__!.chunks.loaded());
  }

  async pendingChunks(): Promise<ChunkCoord[]> {
    return this.page.evaluate(() => window.__agent__!.chunks.pending());
  }

  async chunkList(): Promise<ChunkSnapshot[]> {
    return this.page.evaluate(() => window.__agent__!.chunks.list());
  }

  async screenshot(): Promise<Buffer> {
    const result = await this.page.screenshot({
      type: "png",
      fullPage: false,
    });
    return Buffer.from(result);
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

  recordDiagnostic(entry: Omit<DiagnosticEntry, "id" | "at">): void {
    this.diagnosticCounter += 1;
    this.diagnostics.push({
      ...entry,
      id: this.diagnosticCounter,
      at: Date.now(),
    });
    if (this.diagnostics.length > DIAGNOSTICS_BUFFER_LIMIT) {
      this.diagnostics.splice(
        0,
        this.diagnostics.length - DIAGNOSTICS_BUFFER_LIMIT,
      );
    }
  }

  diagnosticsSnapshot(
    filter: {
      sinceMs?: number;
      sinceId?: number;
    } = {},
  ): DiagnosticsSnapshot {
    const sinceMs = filter.sinceMs ?? 0;
    const sinceId = filter.sinceId ?? 0;
    const entries = this.diagnostics.filter(
      (e) => e.at >= sinceMs && e.id > sinceId,
    );
    let errorCount = 0;
    let warningCount = 0;
    for (const e of entries) {
      if (e.severity === "error") errorCount += 1;
      else warningCount += 1;
    }
    return { entries, errorCount, warningCount };
  }

  clearDiagnostics(): void {
    this.diagnostics = [];
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

        if (w.__agentPushChat__) {
          w.__agent__.on("chat", (msg) => w.__agentPushChat__!(msg));
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
        if (w.__agentPushEvent__) {
          for (const name of forwardedEvents) {
            w.__agent__.on(name, (data) => w.__agentPushEvent__!(name, data));
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
