#!/usr/bin/env node
// Raw two-client lifecycle acceptance gate. Two protocol-level clients (no
// rendering, no worker pools — just the wire protocol) join the `flat`
// world: an ACTOR that performs authoritative interactions and a passive
// OBSERVER. Under a 150-mover fauna load, it measures exact wall times for:
//
//   - break -> voxel UPDATE echo at both clients
//   - break -> drop entity CREATE at both clients
//   - place -> voxel UPDATE echo at the observer
//   - pickup -> drop entity DELETE at both clients (causal ordering checked)
//
// Gate: every CREATE/echo <= 2000ms, no lifecycle observed before its cause,
// no ghost drops left after DELETE.
//
// Usage: node scripts/e2e-lifecycle-gate.mjs [ws://localhost:4000] [rounds]

import { createRequire } from "node:module";

const require = createRequire(
  new URL("../packages/core/package.json", import.meta.url),
);
const lz4 = require("lz4js");
const requireProtocol = createRequire(
  new URL("../packages/protocol/package.json", import.meta.url),
);
const protobuf = requireProtocol("protobufjs");

const root = await protobuf.load(
  new URL("../messages.proto", import.meta.url).pathname,
);
const Message = root.lookupType("protocol.Message");
const MessageTypeEnum = root.lookupEnum("protocol.Message.Type");
const EntityOperationEnum = root.lookupEnum("protocol.Entity.Operation");

const SERVER = process.argv[2] ?? "ws://localhost:4000";
const ROUNDS = Number(process.argv[3] ?? 15);
const SECRET = "test";
const WORLD = "flat";
const FAUNA_COUNT = 150;
const GATE_MS = 2000;
const GROUND_Y = 49;

function decodePayload(buffer) {
  let bytes = new Uint8Array(buffer);
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x04 &&
    bytes[1] === 0x22 &&
    bytes[2] === 0x4d &&
    bytes[3] === 0x18
  ) {
    bytes = lz4.decompress(bytes);
  }
  return Message.toObject(Message.decode(bytes), {
    defaults: true,
    longs: Number,
  });
}

class RawClient {
  constructor(name, capabilities) {
    this.name = name;
    this.capabilities = capabilities;
    this.listeners = new Set();
    this.entityLog = [];
    this.updateLog = [];
  }

  async connect() {
    const url = `${SERVER}/ws/?secret=${SECRET}&client_id=raw-${this.name}-${Date.now()}`;
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (event) => this.onMessage(event.data);

    const initReceived = this.waitFor((message) => message.type === "INIT");
    this.send({
      type: "JOIN",
      json: JSON.stringify({
        world: WORLD,
        username: this.name,
        capabilities: this.capabilities,
      }),
    });
    const init = await initReceived;
    const initJson = JSON.parse(init.message.json);
    this.id = initJson.id;
    this.blocks = initJson.blocks;

    // Register chunk interest around the origin so voxel UPDATE echoes for
    // the test area route to this client.
    this.send({
      type: "LOAD",
      json: JSON.stringify({
        center: [0, 0],
        direction: [0, 0],
        chunks: [
          [0, 0],
          [0, -1],
          [-1, 0],
          [-1, -1],
        ],
      }),
    });
    return this;
  }

  onMessage(data) {
    let message;
    try {
      message = decodePayload(data);
    } catch {
      return;
    }
    message.type = MessageTypeEnum.valuesById[message.type];
    const atMs = Date.now();

    if (Array.isArray(message.entities)) {
      for (const entity of message.entities) {
        entity.operation = EntityOperationEnum.valuesById[entity.operation];
        this.entityLog.push({
          atMs,
          operation: entity.operation,
          id: entity.id,
          type: entity.type,
        });
      }
    }
    if (Array.isArray(message.updates)) {
      for (const update of message.updates) {
        this.updateLog.push({
          atMs,
          vx: update.vx,
          vy: update.vy,
          vz: update.vz,
          voxel: update.voxel,
        });
      }
    }
    for (const listener of [...this.listeners]) {
      listener(message, atMs);
    }
  }

  waitFor(predicate, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(
          new Error(`[${this.name}] timed out after ${timeoutMs}ms waiting`),
        );
      }, timeoutMs);
      const listener = (message, atMs) => {
        const result = predicate(message, atMs);
        if (result) {
          clearTimeout(timer);
          this.listeners.delete(listener);
          resolve({ message, atMs, result });
        }
      };
      this.listeners.add(listener);
    });
  }

  waitForEntity(predicate, timeoutMs = 30000) {
    return this.waitFor(
      (message, atMs) =>
        Array.isArray(message.entities) &&
        message.entities.some((entity) => predicate(entity, atMs)),
      timeoutMs,
    );
  }

  waitForVoxel(vx, vy, vz, timeoutMs = 30000) {
    return this.waitFor(
      (message) =>
        Array.isArray(message.updates) &&
        message.updates.some(
          (update) => update.vx === vx && update.vy === vy && update.vz === vz,
        ),
      timeoutMs,
    );
  }

  send(fields) {
    if (typeof fields.type === "string") {
      fields = { ...fields, type: MessageTypeEnum.values[fields.type] };
    }
    this.ws.send(Message.encode(Message.create(fields)).finish());
  }

  callMethod(name, payload) {
    this.send({
      type: "METHOD",
      method: { name, payload: JSON.stringify(payload) },
    });
  }

  close() {
    this.ws.close();
  }
}

function summarize(label, samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  const max = sorted[sorted.length - 1];
  const verdict = max <= GATE_MS ? "PASS" : "FAIL";
  console.log(
    `  ${label}: n=${sorted.length} p50=${at(0.5)}ms p95=${at(0.95)}ms max=${max}ms  [gate <=${GATE_MS}ms: ${verdict}]`,
  );
  return max <= GATE_MS;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log(`lifecycle gate against ${SERVER}, ${ROUNDS} rounds`);

  // The actor negotiates the compact motion path; the observer stays on the
  // legacy JSON path, so both wire shapes are exercised under load.
  const actor = await new RawClient("actor", ["motion.v1"]).connect();
  const observer = await new RawClient("observer", []).connect();
  console.log(`joined: actor=${actor.id} observer=${observer.id}`);

  const stoneId = Object.entries(actor.blocks).find(
    ([name]) => name.toLowerCase() === "stone",
  )?.[1]?.id;
  if (stoneId === undefined) {
    throw new Error("stone block not found in registry");
  }

  // Idempotent start: clear any fauna/drops left by a previous aborted run.
  actor.callMethod("clear-fauna", {});
  await sleep(500);

  // Load: 150 fauna moving every tick at both clients.
  const faunaSeen = observer.waitForEntity(
    (entity) => entity.type === "fauna" && entity.operation === "CREATE",
  );
  actor.callMethod("spawn-fauna", {
    position: [0, GROUND_Y + 2, 0],
    count: FAUNA_COUNT,
  });
  await faunaSeen;
  await sleep(2000);
  const faunaTracked = new Set(
    observer.entityLog
      .filter((e) => e.type === "fauna" && e.operation === "CREATE")
      .map((e) => e.id),
  ).size;
  console.log(`fauna load active: observer tracked ${faunaTracked} movers\n`);

  // Raw per-entity motion freshness at the observer: wall-clock gaps between
  // consecutive UPDATE arrivals per fauna over a 15s window. Works against
  // any server version (it measures arrivals, not protocol internals), so it
  // is the honest before/after comparison metric.
  console.log("sampling per-entity motion update gaps for 15s...");
  const lastArrivalMs = new Map();
  const motionGaps = [];
  const gapListener = (message, atMs) => {
    if (!Array.isArray(message.entities)) return;
    for (const entity of message.entities) {
      if (entity.type !== "fauna" || entity.operation !== "UPDATE") continue;
      if (!entity.metadata && !(entity.motion && entity.motion.length))
        continue;
      const previous = lastArrivalMs.get(entity.id);
      lastArrivalMs.set(entity.id, atMs);
      if (previous !== undefined) motionGaps.push(atMs - previous);
    }
  };
  observer.listeners.add(gapListener);
  await sleep(15000);
  observer.listeners.delete(gapListener);
  {
    const sorted = [...motionGaps].sort((a, b) => a - b);
    const at = (q) =>
      sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
    console.log(
      `observer fauna motion gaps: n=${sorted.length} p50=${at(0.5)}ms p95=${at(0.95)}ms p99=${at(0.99)}ms max=${sorted[sorted.length - 1]}ms\n`,
    );
  }

  const breakEchoActor = [];
  const breakEchoObserver = [];
  const dropCreateActor = [];
  const dropCreateObserver = [];
  const placeEchoObserver = [];
  const pickupDeleteActor = [];
  const pickupDeleteObserver = [];
  let isCausalityClean = true;
  const roundDropIds = new Set();

  // Fresh voxel cells per run (the flat world persists edits), spread over
  // the 14x14 interior of chunk [0,0].
  const cellSalt = Math.floor(Math.random() * 196);

  for (let round = 0; round < ROUNDS; round++) {
    const cell = (cellSalt + round) % 196;
    const vx = 1 + (cell % 14);
    const vz = 1 + Math.floor(cell / 14);

    // --- break -> voxel echo + drop CREATE --------------------------------
    const dropIsNew = (entity) =>
      entity.type === "drop" && entity.operation === "CREATE";
    const actorSawDropBefore = actor.entityLog.some(
      (e) => e.type === "drop" && e.operation === "CREATE",
    );

    const actorEcho = actor.waitForVoxel(vx, GROUND_Y, vz);
    const observerEcho = observer.waitForVoxel(vx, GROUND_Y, vz);
    const actorCreate = actor.waitForEntity(dropIsNew);
    const observerCreate = observer.waitForEntity(dropIsNew);

    const breakAtMs = Date.now();
    actor.callMethod("break-with-drop", { voxel: [vx, GROUND_Y, vz] });

    const [aEcho, oEcho, aCreate, oCreate] = await Promise.all([
      actorEcho,
      observerEcho,
      actorCreate,
      observerCreate,
    ]);
    breakEchoActor.push(aEcho.atMs - breakAtMs);
    breakEchoObserver.push(oEcho.atMs - breakAtMs);
    dropCreateActor.push(aCreate.atMs - breakAtMs);
    dropCreateObserver.push(oCreate.atMs - breakAtMs);

    const dropId = aCreate.message.entities.find(
      (entity) => entity.type === "drop" && entity.operation === "CREATE",
    ).id;
    roundDropIds.add(dropId);
    if (aCreate.atMs < breakAtMs && !actorSawDropBefore) {
      isCausalityClean = false;
      console.error("  CAUSALITY VIOLATION: CREATE observed before break");
    }

    // --- place -> voxel echo ---------------------------------------------
    const placeTarget = [vx, GROUND_Y + 1, vz];
    const observerPlaceEcho = observer.waitForVoxel(...placeTarget);
    const placeAtMs = Date.now();
    actor.send({
      type: "UPDATE",
      bulkUpdate: {
        vx: [placeTarget[0]],
        vy: [placeTarget[1]],
        vz: [placeTarget[2]],
        voxels: [stoneId],
        lights: [0],
      },
    });
    const oPlace = await observerPlaceEcho;
    placeEchoObserver.push(oPlace.atMs - placeAtMs);

    // --- pickup -> DELETE --------------------------------------------------
    const dropDeleted = (entity) =>
      entity.id === dropId && entity.operation === "DELETE";
    const actorDelete = actor.waitForEntity(dropDeleted);
    const observerDelete = observer.waitForEntity(dropDeleted);
    const pickupAtMs = Date.now();
    actor.callMethod("pickup-drop", { id: dropId });
    const [aDelete, oDelete] = await Promise.all([actorDelete, observerDelete]);
    pickupDeleteActor.push(aDelete.atMs - pickupAtMs);
    pickupDeleteObserver.push(oDelete.atMs - pickupAtMs);

    if (aDelete.atMs < pickupAtMs) {
      isCausalityClean = false;
      console.error("  CAUSALITY VIOLATION: DELETE observed before pickup");
    }

    await sleep(400);
  }

  // Ghost check: every drop this run created must be deleted at the
  // observer; none may linger.
  await sleep(1000);
  const deletedDrops = new Set(
    observer.entityLog
      .filter((e) => e.type === "drop" && e.operation === "DELETE")
      .map((e) => e.id),
  );
  const ghosts = [...roundDropIds].filter((id) => !deletedDrops.has(id));

  console.log(`results over ${ROUNDS} rounds with ${FAUNA_COUNT} movers:`);
  const gates = [
    summarize("break -> voxel echo (actor)   ", breakEchoActor),
    summarize("break -> voxel echo (observer)", breakEchoObserver),
    summarize("break -> drop CREATE (actor)   ", dropCreateActor),
    summarize("break -> drop CREATE (observer)", dropCreateObserver),
    summarize("place -> voxel echo (observer) ", placeEchoObserver),
    summarize("pickup -> DELETE (actor)       ", pickupDeleteActor),
    summarize("pickup -> DELETE (observer)    ", pickupDeleteObserver),
  ];
  console.log(
    `  causality: ${isCausalityClean ? "clean" : "VIOLATED"}; ghost drops: ${ghosts.length}`,
  );

  actor.callMethod("clear-fauna", {});
  await sleep(300);
  actor.close();
  observer.close();

  const isPass = gates.every(Boolean) && isCausalityClean && ghosts.length === 0;
  console.log(`\nLIFECYCLE GATE: ${isPass ? "PASS" : "FAIL"}`);
  process.exit(isPass ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
