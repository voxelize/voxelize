// A headless player speaking the real protocol: API login, game ticket,
// WebSocket join, chunk requests, peer updates and gameplay intents. Used by
// the end-to-end smoke test and by load generation (spec §93).

import { createRequire } from "node:module";

// The engine packages' CommonJS builds load cleanly in Node.
const require = createRequire(import.meta.url);
const { protocol } = require("@voxelize/protocol");
const { Transport } = require("@voxelize/transport");

export const CHUNK_SIZE = 16;
export const MAX_HEIGHT = 256;

export async function api(base, path, { token, body, method = body ? "POST" : "GET", headers = {} } = {}) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(json)}`);
  return json;
}

export async function registerPlayer(base, name) {
  const { token } = await api(base, "/auth/register", {
    body: { username: name, email: `${name}@bots.invalid`, password: "bot password 0123456789" },
  });
  return token;
}

export class Bot {
  /** `issueTicket` (optional) replaces the API call for a game ticket,
   * for tests against a standalone game server with a dev secret. */
  constructor({ api: apiBase, game, token, world = "main", name, issueTicket }) {
    Object.assign(this, { apiBase, game, token, world, name, issueTicket });
    this.chunks = new Map();
    this.inventory = null;
    this.waiters = [];
    this.results = [];
    this.position = [0.5, 120, 0.5];
  }

  async connect() {
    const { ticket } = this.issueTicket
      ? { ticket: await this.issueTicket() }
      : await api(this.apiBase, "/game/tickets", { token: this.token, body: { world: this.world } });
    const url = `${this.game.replace(/^http/, "ws")}/ws/?ticket=${encodeURIComponent(ticket)}`;
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error(`${this.name}: websocket refused`));
    });
    this.ws.onmessage = (event) => this.onMessage(new Uint8Array(event.data));
    this.send({
      type: "JOIN",
      json: JSON.stringify({ world: this.world, username: this.name, capabilities: [], preferences: {} }),
    });
    await this.waitFor((m) => m.type === "INIT", 20000, "INIT");
  }

  /** Join another world on the same connection (the server's
   * `platform.travel`); chunks of the old world are forgotten. */
  async switchWorld(world) {
    this.world = world;
    this.chunks = new Map();
    this.send({
      type: "JOIN",
      json: JSON.stringify({ world, username: this.name, capabilities: [], preferences: {} }),
    });
    await this.waitFor((m) => m.type === "INIT", 20000, "INIT");
  }

  send(message) {
    const type = protocol.Message.Type[message.type];
    this.ws.send(protocol.Message.encode(protocol.Message.create({ ...message, type })).finish());
  }

  onMessage(bytes) {
    const message = Transport.decodeSync(bytes);
    if (message.type === "LOAD" || message.type === "UPDATE") {
      for (const chunk of message.chunks ?? []) {
        if (chunk.voxels?.length) {
          const buf = chunk.voxels;
          this.chunks.set(`${chunk.x},${chunk.z}`, new Uint32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
        }
      }
      for (const u of message.updates ?? []) this.setLocal(u.vx, u.vy, u.vz, u.voxel);
    }
    if (message.type === "EVENT") {
      for (const event of message.events ?? []) {
        // The transport decoder already parses JSON payloads.
        const payload = typeof event.payload === "string" ? JSON.parse(event.payload || "null") : event.payload;
        if (event.name === "platform.inventory") this.inventory = payload;
        if (event.name === "platform.window") this.window = payload;
        if (event.name === "platform.drops") this.drops = payload.items;
        if (event.name === "platform.mobs") this.mobs = payload.mobs;
        if (event.name === "platform.result") this.results.push(payload);
        this.waiters = this.waiters.filter((w) => !w.match({ type: "EVENT", name: event.name, payload }) || (w.resolve(payload), false));
      }
    }
    this.waiters = this.waiters.filter((w) => !w.match(message) || (w.resolve(message), false));
  }

  waitFor(match, timeout = 10000, label = "message") {
    return new Promise((resolve, reject) => {
      const waiter = { match, resolve };
      this.waiters.push(waiter);
      setTimeout(() => {
        if (this.waiters.includes(waiter)) {
          this.waiters = this.waiters.filter((w) => w !== waiter);
          reject(new Error(`${this.name}: timed out waiting for ${label}`));
        }
      }, timeout);
    });
  }

  /** Next server event with this name (and matching `pred`). */
  event(name, pred = () => true, timeout = 10000) {
    return this.waitFor((m) => m.type === "EVENT" && m.name === name && pred(m.payload), timeout, name);
  }

  /** Inventory slot index holding `itemId`, or -1. */
  slotOf(itemId) {
    return (this.inventory?.slots ?? []).findIndex((s) => s && s.item === itemId);
  }

  count(itemId) {
    return (this.inventory?.slots ?? []).reduce((n, s) => n + (s && s.item === itemId ? s.count : 0), 0);
  }

  result(intent, timeout = 10000) {
    return this.waitFor((m) => m.type === "EVENT" && m.name === "platform.result" && m.payload.intent === intent, timeout, intent);
  }

  requestChunks(radius = 1) {
    const cx = Math.floor(this.position[0] / CHUNK_SIZE);
    const cz = Math.floor(this.position[2] / CHUNK_SIZE);
    const chunks = [];
    for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) chunks.push([cx + x, cz + z]);
    this.send({ type: "LOAD", json: JSON.stringify({ center: [cx, cz], direction: [0, 1], chunks }) });
  }

  index(vx, vy, vz) {
    const cx = Math.floor(vx / CHUNK_SIZE);
    const cz = Math.floor(vz / CHUNK_SIZE);
    const data = this.chunks.get(`${cx},${cz}`);
    if (!data) return null;
    const lx = vx - cx * CHUNK_SIZE;
    const lz = vz - cz * CHUNK_SIZE;
    return { data, i: (lx * MAX_HEIGHT + vy) * CHUNK_SIZE + lz };
  }

  voxel(vx, vy, vz) {
    const at = this.index(vx, vy, vz);
    return at ? at.data[at.i] & 0xffff : null;
  }

  /** The full voxel word (id, rotation, stage), or null when not loaded. */
  raw(vx, vy, vz) {
    const at = this.index(vx, vy, vz);
    return at ? at.data[at.i] : null;
  }

  /** Growth / circuit stage of a voxel (bits 24..27). */
  stage(vx, vy, vz) {
    const raw = this.raw(vx, vy, vz);
    return raw === null ? null : (raw >>> 24) & 0xf;
  }

  setLocal(vx, vy, vz, value) {
    const at = this.index(vx, vy, vz);
    if (at) at.data[at.i] = value;
  }

  /** Highest y in a column whose block id passes `solid`. */
  surface(vx, vz, solid) {
    for (let y = MAX_HEIGHT - 1; y > 0; y--) {
      const id = this.voxel(vx, y, vz);
      if (id !== null && id !== 0 && solid(id)) return y;
    }
    return null;
  }

  /** Report a position. The server moves a body at most 24 blocks per
   * update (anti-teleport clamp), so a long move is sent `repeat` times. */
  async moveTo(position, repeat = 1) {
    this.position = position;
    for (let i = 0; i < repeat; i++) {
      this.send({
        type: "PEER",
        peers: [{ id: "", username: this.name, metadata: JSON.stringify({ position, direction: [0, -1, 0] }) }],
      });
      if (repeat > 1) await new Promise((r) => setTimeout(r, 50));
    }
  }

  call(name, payload = {}) {
    this.send({ type: "METHOD", method: { name, payload: JSON.stringify(payload) } });
  }

  chat(body) {
    this.send({ type: "CHAT", chat: { type: "CHAT", sender: this.name, body, metadata: "" } });
  }

  close() {
    this.ws?.close();
  }
}
