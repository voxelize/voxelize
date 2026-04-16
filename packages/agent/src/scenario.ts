import fs from "node:fs";
import path from "node:path";

export type Vec3Tuple = [number, number, number];

export type EntitySnapshot = {
  id: string;
  kind?: string;
  position?: { x: number; y: number; z: number };
  metadata?: Record<string, unknown>;
  distance?: number;
};

export type BlockInfo = {
  id: number;
  name: string;
  isFluid: boolean;
  isEmpty: boolean;
  isPassable: boolean;
};

export type ArenaOptions = {
  agentUrl?: string;
  index?: number;
  size?: Vec3Tuple;
  scenarioId?: string;
};

const DEFAULT_AGENT_URL = "http://127.0.0.1:4099";
const DEFAULT_ARENA_SIZE: Vec3Tuple = [16, 8, 16];
const ARENA_FLOOR_Y = 64;
const ARENA_PADDING = 4;
const GRID_COLUMNS = 8;
const WIPE_PAD = 4;
const WIPE_Y_BELOW = 4;
const WIPE_Y_ABOVE = 12;
const MAX_ARENA_FOOTPRINT = 32;

function randomScenarioId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `scenario-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class EntityHandle {
  constructor(
    private readonly arena: Arena,
    public readonly kind: string,
    public readonly expectedSpawn: Vec3Tuple,
  ) {}

  async findNearestSnapshot(): Promise<EntitySnapshot | null> {
    const all = await this.arena.entitiesInArena();
    let best: EntitySnapshot | null = null;
    let bestDist = Infinity;
    const [ex, ey, ez] = this.arena.worldPos(this.expectedSpawn);
    for (const entity of all) {
      const p = entity.position;
      if (!p) continue;
      const d = (p.x - ex) ** 2 + (p.y - ey) ** 2 + (p.z - ez) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = entity;
      }
    }
    return best;
  }

  async position(): Promise<Vec3Tuple | null> {
    const snap = await this.findNearestSnapshot();
    if (!snap?.position) return null;
    return [snap.position.x, snap.position.y, snap.position.z];
  }
}

export class Arena {
  public readonly agentUrl: string;
  public readonly index: number;
  public readonly size: Vec3Tuple;
  public readonly scenarioId: string;

  constructor(opts: ArenaOptions = {}) {
    this.agentUrl = opts.agentUrl ?? DEFAULT_AGENT_URL;
    this.index = opts.index ?? 0;
    this.size = opts.size ?? DEFAULT_ARENA_SIZE;
    this.scenarioId = opts.scenarioId ?? randomScenarioId();
  }

  get origin(): Vec3Tuple {
    const col = this.index % GRID_COLUMNS;
    const row = Math.floor(this.index / GRID_COLUMNS);
    const strideX = MAX_ARENA_FOOTPRINT + ARENA_PADDING;
    const strideZ = MAX_ARENA_FOOTPRINT + ARENA_PADDING;
    return [col * strideX, ARENA_FLOOR_Y, row * strideZ];
  }

  worldPos(rel: Vec3Tuple): Vec3Tuple {
    const [ox, oy, oz] = this.origin;
    return [ox + rel[0], oy + rel[1], oz + rel[2]];
  }

  centerWorld(): Vec3Tuple {
    return this.worldPos([this.size[0] / 2, 0, this.size[2] / 2]);
  }

  observerWorld(): Vec3Tuple {
    const [cx, cy, cz] = this.centerWorld();
    return [cx, cy + this.size[1] + 6, cz];
  }

  async fill(min: Vec3Tuple, max: Vec3Tuple, block: string): Promise<void> {
    await this.call("test:fill", {
      min: this.worldPos(min),
      max: this.worldPos(max),
      block,
    });
  }

  async cage(block: string): Promise<void> {
    const [sx, sy, sz] = this.size;
    const mx = sx - 1;
    const my = sy - 1;
    const mz = sz - 1;
    await this.fill([0, 1, 0], [0, my, mz], block);
    await this.fill([mx, 1, 0], [mx, my, mz], block);
    await this.fill([1, 1, 0], [mx - 1, my, 0], block);
    await this.fill([1, 1, mz], [mx - 1, my, mz], block);
    await this.fill([1, my, 1], [mx - 1, my, mz - 1], block);
  }

  async wipe(): Promise<void> {
    const [ox, oy, oz] = this.origin;
    const max = MAX_ARENA_FOOTPRINT;
    await this.call("test:fill", {
      min: [ox - WIPE_PAD, oy - WIPE_Y_BELOW, oz - WIPE_PAD],
      max: [ox + max + WIPE_PAD, oy + WIPE_Y_ABOVE, oz + max + WIPE_PAD],
      block: "air",
    });
  }

  async spawn(kind: string, rel: Vec3Tuple): Promise<EntityHandle> {
    await this.call("test:spawn", {
      kind,
      position: this.worldPos(rel),
      scenarioId: this.scenarioId,
    });
    return new EntityHandle(this, kind, rel);
  }

  async despawn(): Promise<void> {
    await this.call("test:despawn", { scenarioId: this.scenarioId });
  }

  async announce(
    name: string,
    event: "start" | "pass" | "fail",
  ): Promise<void> {
    await this.call("test:announce", {
      name,
      arenaIndex: this.index,
      event,
    });
  }

  async blockAt(world: Vec3Tuple): Promise<BlockInfo | null> {
    const [x, y, z] = world;
    const res = await fetch(`${this.agentUrl}/block?x=${x}&y=${y}&z=${z}`);
    if (!res.ok) return null;
    const body = await res.json();
    return body.block ?? null;
  }

  async blockAtRel(rel: Vec3Tuple): Promise<BlockInfo | null> {
    return this.blockAt(this.worldPos(rel));
  }

  async waitForBlockAtRel(
    rel: Vec3Tuple,
    predicate: (block: BlockInfo | null) => boolean,
    opts: { timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const pollIntervalMs = opts.pollIntervalMs ?? 200;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const block = await this.blockAtRel(rel);
      if (predicate(block)) return;
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    throw new Error(
      `waitForBlockAtRel timed out after ${timeoutMs}ms at rel=${rel.join(",")}`,
    );
  }

  async entitiesInArena(): Promise<EntitySnapshot[]> {
    const radius = Math.max(this.size[0], this.size[1], this.size[2]) * 2;
    const res = await fetch(`${this.agentUrl}/entities?radius=${radius}`);
    if (!res.ok) return [];
    const body = await res.json();
    const entities = (body.entities ?? []) as EntitySnapshot[];
    const [ox, oy, oz] = this.origin;
    const [sx, sy, sz] = this.size;
    return entities.filter((e) => {
      const p = e.position;
      if (!p) return false;
      return (
        p.x >= ox - 1 &&
        p.x <= ox + sx + 1 &&
        p.y >= oy - 16 &&
        p.y <= oy + sy + 16 &&
        p.z >= oz - 1 &&
        p.z <= oz + sz + 1
      );
    });
  }

  async call(method: string, payload: unknown): Promise<void> {
    const res = await fetch(`${this.agentUrl}/act`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "call", method, payload }),
    });
    if (!res.ok) {
      throw new Error(
        `agent /act ${method} failed: ${res.status} ${await res.text()}`,
      );
    }
  }
}

export type AgentControls = {
  position(): Promise<Vec3Tuple>;
  teleport(
    pos: Vec3Tuple,
    opts?: { isEnsuringChunks?: boolean },
  ): Promise<void>;
  face(target: Vec3Tuple): Promise<void>;
  setFlying(isFlying: boolean): Promise<void>;
  chat(text: string): Promise<void>;
  entitiesNear(radius: number): Promise<EntitySnapshot[]>;
  screenshot(label: string): Promise<string>;
};

function createAgentControls(
  agentUrl: string,
  screenshotDir: string,
  log: (msg: string) => void,
): AgentControls {
  const post = async (body: unknown): Promise<unknown> => {
    const res = await fetch(`${agentUrl}/act`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`agent /act failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  };

  return {
    async position() {
      const res = await fetch(`${agentUrl}/me`);
      const body = await res.json();
      const p = body.position;
      return [p.x, p.y, p.z];
    },
    async teleport(pos, opts) {
      await post({
        type: "teleport",
        pos: { x: pos[0], y: pos[1], z: pos[2] },
        isEnsuringChunks: opts?.isEnsuringChunks,
      });
    },
    async face(target) {
      await post({
        type: "view",
        face: { target: { x: target[0], y: target[1], z: target[2] } },
      });
    },
    async setFlying(isFlying) {
      await post({ type: "set-flying", isFlying });
    },
    async chat(text) {
      await post({ type: "chat", text });
    },
    async entitiesNear(radius) {
      const res = await fetch(`${agentUrl}/entities?radius=${radius}`);
      const body = await res.json();
      return body.entities ?? [];
    },
    async screenshot(label) {
      const safe = label.replace(/[^a-z0-9_-]/gi, "_");
      const stamp = Date.now().toString();
      const filename = `${stamp}_${safe}.png`;
      const filePath = path.join(screenshotDir, filename);
      const res = await fetch(`${agentUrl}/screenshot`);
      if (!res.ok) {
        throw new Error(`screenshot failed: ${res.status}`);
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(screenshotDir, { recursive: true });
      fs.writeFileSync(filePath, buffer);
      log(`screenshot: ${filePath}`);
      return filePath;
    },
  };
}

export type ExpectHelpers = {
  waitFor(
    predicate: () => Promise<boolean> | boolean,
    opts?: { timeoutMs?: number; pollIntervalMs?: number; label?: string },
  ): Promise<void>;
};

function createExpect(
  log: (msg: string) => void,
  elapsed: () => number,
): ExpectHelpers {
  return {
    async waitFor(predicate, opts = {}) {
      const timeoutMs = opts.timeoutMs ?? 30_000;
      const pollIntervalMs = opts.pollIntervalMs ?? 500;
      const label = opts.label ?? "predicate";
      const deadline = Date.now() + timeoutMs;
      log(`waitFor[${label}] timeout=${timeoutMs}ms`);
      while (Date.now() < deadline) {
        const ok = await predicate();
        if (ok) {
          log(`waitFor[${label}] satisfied at t=${elapsed()}ms`);
          return;
        }
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }
      throw new Error(`waitFor[${label}] timed out after ${timeoutMs}ms`);
    },
  };
}

export type MonitorHandle = () => void;

export type Monitor = {
  start<T>(
    opts: { intervalMs?: number; label: string },
    sampler: () => Promise<T> | T,
  ): MonitorHandle;
};

function createMonitor(log: (msg: string) => void): Monitor {
  return {
    start(opts, sampler) {
      const intervalMs = opts.intervalMs ?? 1000;
      let stopped = false;
      const tick = async (): Promise<void> => {
        if (stopped) return;
        try {
          const value = await sampler();
          log(`monitor[${opts.label}] ${formatSample(value)}`);
        } catch (e) {
          log(`monitor[${opts.label}] error: ${formatError(e)}`);
        }
        if (!stopped) setTimeout(tick, intervalMs);
      };
      setTimeout(tick, intervalMs);
      return () => {
        stopped = true;
      };
    },
  };
}

function formatSample(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export type ScenarioContext = {
  arena: Arena;
  agent: AgentControls;
  expect: ExpectHelpers;
  monitor: Monitor;
  log: (msg: string) => void;
  sleep: (ms: number) => Promise<void>;
  elapsedMs: () => number;
  screenshotDir: string;
};

export type ScenarioOptions = {
  name: string;
  arena?: ArenaOptions;
  timeoutMs?: number;
  body: (ctx: ScenarioContext) => Promise<void>;
};

export type ScenarioResult = {
  name: string;
  passed: boolean;
  elapsedMs: number;
  reason?: string;
  screenshotDir: string;
};

export async function runScenario(
  opts: ScenarioOptions,
): Promise<ScenarioResult> {
  const arena = new Arena(opts.arena);
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const startedAt = Date.now();
  const elapsed = (): number => Date.now() - startedAt;
  const screenshotDir = path.join("/tmp", `scenario-${opts.name}-${startedAt}`);

  const log = (msg: string): void => {
    const seconds = (elapsed() / 1000).toFixed(2).padStart(7, " ");
    console.log(`[${opts.name} t=${seconds}s] ${msg}`);
  };

  const agent = createAgentControls(arena.agentUrl, screenshotDir, log);
  const expect = createExpect(log, elapsed);
  const monitor = createMonitor(log);

  const ctx: ScenarioContext = {
    arena,
    agent,
    expect,
    monitor,
    log,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    elapsedMs: elapsed,
    screenshotDir,
  };

  const teardown = async (): Promise<void> => {
    try {
      await arena.despawn();
      await arena.wipe();
    } catch (e) {
      log(`teardown error: ${formatError(e)}`);
    }
  };

  log(
    `start scenarioId=${arena.scenarioId} arena=${arena.index} size=${arena.size.join("x")}`,
  );
  await teardown();
  await agent.setFlying(true);
  await agent.teleport(arena.observerWorld(), { isEnsuringChunks: true });

  const bodyPromise = (async () => {
    await arena.announce(opts.name, "start");
    await opts.body(ctx);
  })();

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`scenario timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  try {
    await Promise.race([bodyPromise, timeoutPromise]);
    const ms = elapsed();
    log(`PASS in ${ms}ms`);
    await arena.announce(opts.name, "pass");
    return {
      name: opts.name,
      passed: true,
      elapsedMs: ms,
      screenshotDir,
    };
  } catch (e) {
    const ms = elapsed();
    const reason = formatError(e);
    log(`FAIL in ${ms}ms: ${reason}`);
    try {
      await arena.announce(opts.name, "fail");
    } catch {
      /* no-op */
    }
    return {
      name: opts.name,
      passed: false,
      elapsedMs: ms,
      reason,
      screenshotDir,
    };
  } finally {
    await teardown();
  }
}
