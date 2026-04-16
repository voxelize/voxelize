export type Vec3Tuple = [number, number, number];

export type EntitySnapshot = {
  id: string;
  type?: string;
  entType?: string;
  position?: { x: number; y: number; z: number };
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

export type ScenarioContext<Roles extends Record<string, EntityHandle>> = {
  arena: Arena;
  roles: Roles;
  elapsedMs: number;
};

export type ScenarioOptions<Roles extends Record<string, EntityHandle>> = {
  name: string;
  arena?: ArenaOptions;
  timeoutMs?: number;
  pollIntervalMs?: number;
  setup: (arena: Arena) => Promise<void> | void;
  spawn?: (arena: Arena) => Promise<Roles> | Roles;
  check: (ctx: ScenarioContext<Roles>) => Promise<boolean> | boolean;
  observe?: (ctx: ScenarioContext<Roles>) => Promise<void> | void;
};

export type ScenarioResult = {
  name: string;
  passed: boolean;
  elapsedMs: number;
  reason?: string;
};

const DEFAULT_AGENT_URL = "http://127.0.0.1:4099";
const DEFAULT_ARENA_SIZE: Vec3Tuple = [24, 8, 24];
const ARENA_FLOOR_Y = 64;
const ARENA_PADDING = 4;
const GRID_COLUMNS = 8;

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

function randomScenarioId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `scenario-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
    const strideX = this.size[0] + ARENA_PADDING;
    const strideZ = this.size[2] + ARENA_PADDING;
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

  async clear(): Promise<void> {
    const [sx, sy, sz] = this.size;
    await this.fill([0, 0, 0], [sx - 1, sy - 1, sz - 1], "air");
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

  async teleportObserver(): Promise<void> {
    const pos = this.observerWorld();
    await fetch(`${this.agentUrl}/act`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "teleport",
        pos: { x: pos[0], y: pos[1], z: pos[2] },
        isEnsuringChunks: true,
      }),
    });
  }

  async setFlying(isFlying: boolean): Promise<void> {
    await fetch(`${this.agentUrl}/act`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "set-flying", isFlying }),
    });
  }

  async lookAtCenter(): Promise<void> {
    const pos = this.observerWorld();
    const center = this.centerWorld();
    await fetch(`${this.agentUrl}/act`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "view",
        from: { x: pos[0], y: pos[1], z: pos[2] },
        face: { target: { x: center[0], y: center[1], z: center[2] } },
      }),
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

  async waitMs(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }
}

export async function runScenario<
  Roles extends Record<string, EntityHandle> = Record<string, EntityHandle>,
>(opts: ScenarioOptions<Roles>): Promise<ScenarioResult> {
  const arena = new Arena(opts.arena);
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 500;
  const startedAt = Date.now();
  const elapsed = (): number => Date.now() - startedAt;

  const log = (msg: string): void => {
    console.log(`[${opts.name}] ${msg}`);
  };

  const teardown = async (): Promise<void> => {
    await arena.despawn();
    await arena.clear();
  };

  log(
    `setup (arena index=${arena.index} size=${arena.size.join("x")} scenarioId=${arena.scenarioId})`,
  );
  await teardown();
  await arena.setFlying(true);
  await arena.teleportObserver();
  await opts.setup(arena);
  await arena.waitMs(300);

  let roles: Roles = {} as Roles;
  if (opts.spawn) {
    log("spawn");
    roles = await opts.spawn(arena);
  }

  await arena.lookAtCenter();

  log(`running, timeout=${timeoutMs}ms`);
  try {
    while (elapsed() < timeoutMs) {
      const ctx: ScenarioContext<Roles> = {
        arena,
        roles,
        elapsedMs: elapsed(),
      };
      if (opts.observe) await opts.observe(ctx);
      const passed = await opts.check(ctx);
      if (passed) {
        const ms = elapsed();
        log(`PASS in ${ms}ms`);
        return { name: opts.name, passed: true, elapsedMs: ms };
      }
      await arena.waitMs(pollIntervalMs);
    }

    const ms = elapsed();
    log(`FAIL timeout after ${ms}ms`);
    return {
      name: opts.name,
      passed: false,
      elapsedMs: ms,
      reason: `timeout after ${timeoutMs}ms`,
    };
  } finally {
    await teardown();
  }
}
