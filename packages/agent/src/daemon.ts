import Fastify, { FastifyInstance } from "fastify";
import { z } from "zod";

import { Agent } from "./agent";
import type { AgentEventMap } from "./bridge";

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
};

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
  }),
  z.object({ type: z.literal("face"), input: faceInputSchema }),
  z.object({
    type: z.literal("walk"),
    direction: walkDirectionSchema,
    durationMs: z.number().optional(),
    isSprinting: z.boolean().optional(),
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
  }),
  z.object({ type: z.literal("set-flying"), isFlying: z.boolean() }),
  z.object({
    type: z.literal("call"),
    method: z.string(),
    payload: z.unknown(),
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

  constructor(options: DaemonOptions) {
    this.agent = options.agent;
    this.server = Fastify({ logger: false });
    this.registerEventTaps();
    this.registerRoutes();
  }

  async start(port: number, host = "127.0.0.1"): Promise<void> {
    await this.server.listen({ port, host });
  }

  async stop(): Promise<void> {
    await this.server.close();
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
    this.server.get("/healthz", async () => ({ ok: true }));

    this.server.get("/me", async () => {
      const [position, facing] = await Promise.all([
        this.agent.position(),
        this.agent.facing(),
      ]);
      return { position, facing };
    });

    this.server.get("/snapshot", async () => this.agent.snapshot());

    this.server.get("/screenshot", async (_req, reply) => {
      const buffer = await this.agent.screenshot();
      reply.header("content-type", "image/png");
      return buffer;
    });

    this.server.get<{ Querystring: { x: string; y: string; z: string } }>(
      "/block",
      async (req) => {
        const { x, y, z } = req.query;
        const pos = { x: Number(x), y: Number(y), z: Number(z) };
        return { block: await this.agent.blockAt(pos), pos };
      },
    );

    this.server.get("/chunks", async () => {
      const [loaded, pending] = await Promise.all([
        this.agent.loadedChunks(),
        this.agent.pendingChunks(),
      ]);
      return { loaded, pending };
    });

    this.server.get<{ Querystring: { radius?: string } }>(
      "/entities",
      async (req) => {
        const radius = req.query.radius ? Number(req.query.radius) : 16;
        return { entities: await this.agent.entitiesNear(radius), radius };
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
        const lastId =
          this.events.length > 0 ? this.events[this.events.length - 1]!.id : 0;
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
        const message = e instanceof Error ? e.message : String(e);
        reply.code(500);
        return { ok: false, error: message };
      }
    });

    this.server.post("/reset", async () => {
      throw new Error("Reset not yet implemented");
    });
  }

  private async executeAction(
    action: z.infer<typeof actSchema>,
  ): Promise<unknown> {
    switch (action.type) {
      case "chat":
        return this.agent.chat(action.text);
      case "teleport":
        await this.agent.teleport(action.pos, {
          isEnsuringChunks: action.isEnsuringChunks,
        });
        return { teleported: true };
      case "face":
        await this.agent.face(action.input);
        return { faced: true };
      case "walk":
        await this.agent.walk(action.direction, {
          durationMs: action.durationMs,
          isSprinting: action.isSprinting,
        });
        return { walked: true };
      case "walk-to":
        await this.agent.walkTo(action.target, {
          tolerance: action.tolerance,
          timeoutMs: action.timeoutMs,
          isSprinting: action.isSprinting,
        });
        return { arrived: true };
      case "view":
        await this.agent.view({
          from: action.from,
          face: action.face,
          isEnsuringChunks: action.isEnsuringChunks,
        });
        return { viewed: true };
      case "set-flying":
        await this.agent.setFlying(action.isFlying);
        return { flying: action.isFlying };
      case "call":
        return this.agent.call(action.method, action.payload);
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
