// End-to-end smoke test against a running stack: a new player registers,
// joins with a ticket, mines a block by hand, gets the drop, places it back,
// and the server refuses a too-early break and a replayed ticket.
//
//   node smoke.mjs [api base] [game base]
//   defaults: http://127.0.0.1:8080  http://127.0.0.1:8080

import assert from "node:assert/strict";

import { api, Bot, registerPlayer } from "./bot.mjs";

const API = process.argv[2] ?? "http://127.0.0.1:8080";
const GAME = process.argv[3] ?? API;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);

const content = await (await fetch(`${GAME}/platform/content`)).json();
const blockById = new Map(content.blocks.map((b) => [b.id, b]));
const itemByKey = new Map(content.items.map((i) => [i.key, i]));

const name = `smoke_${Date.now().toString(36)}`;
const token = await registerPlayer(API, name);
step(`registered ${name}`);

// A ticket is single-use.
const { ticket } = await api(API, "/game/tickets", { token, body: { world: "main" } });
const first = new WebSocket(`${GAME.replace(/^http/, "ws")}/ws/?ticket=${encodeURIComponent(ticket)}`);
await new Promise((resolve, reject) => ((first.onopen = resolve), (first.onerror = reject)));
first.close();
const replay = new WebSocket(`${GAME.replace(/^http/, "ws")}/ws/?ticket=${encodeURIComponent(ticket)}`);
const replayed = await new Promise((resolve) => ((replay.onopen = () => resolve("opened")), (replay.onerror = () => resolve("refused"))));
assert.equal(replayed, "refused", "a replayed ticket must be refused");
step("replayed ticket refused");

const bot = new Bot({ api: API, game: GAME, token, name });
await bot.connect();
step("joined with a fresh ticket");

bot.requestChunks(1);
const deadline = Date.now() + 30000;
while (bot.chunks.size < 9 && Date.now() < deadline) await sleep(200);
assert.ok(bot.chunks.size >= 1, "chunks arrive");

// Find a hand-diggable surface block near the spawn column.
const diggable = (id) => {
  const b = blockById.get(id);
  return b && !b.fluid && b.hardness >= 0 && (!b.tool || b.tool.required === false) && b.drops.length > 0;
};
let target = null;
for (let r = 0; r < 12 && !target; r++) {
  for (let x = -r; x <= r && !target; x++) {
    for (let z = -r; z <= r && !target; z++) {
      const y = bot.surface(x, z, (id) => !blockById.get(id)?.fluid && blockById.get(id)?.collision !== false);
      if (y !== null && diggable(bot.voxel(x, y, z))) target = [x, y, z];
    }
  }
}
assert.ok(target, "found a diggable surface block");
const block = blockById.get(bot.voxel(...target));
await bot.moveTo([target[0] + 0.5, target[1] + 2.6, target[2] + 0.5], 12);
await sleep(300);
step(`standing on ${block.name} at ${target.join(",")}`);

bot.call("platform.inventory.get");
await bot.waitFor((m) => m.type === "EVENT" && m.name === "platform.inventory", 10000, "inventory");
assert.ok(bot.inventory.slots.every((s) => s === null), "a new player starts empty");

bot.call("platform.mine.start", { voxel: target });
const started = await bot.result("mine.start");
assert.equal(started.ok, true, `mine.start refused: ${started.code}`);
bot.call("platform.mine.finish", { voxel: target });
const early = await bot.result("mine.finish");
assert.equal(early.code, "too_fast", "an instant break is refused");
step("instant break refused (too_fast)");

const millis = Math.round(block.hardness * 1.5 * 1000);
await sleep(millis + 100);
bot.call("platform.mine.finish", { voxel: target });
const mined = await bot.result("mine.finish");
assert.equal(mined.ok, true, `mining failed: ${mined.code}`);
const drop = itemByKey.get(block.drops[0].item);
await sleep(200);
const slot = bot.inventory.slots.find((s) => s && s.item === drop.id);
assert.ok(slot, `inventory holds ${drop.name}`);
step(`mined ${block.name} in ${millis} ms and received ${drop.name}`);

if (drop.placesBlock) {
  // Placing into the cell the player stands over is refused; step aside.
  bot.call("platform.build.place", { voxel: target });
  assert.equal((await bot.result("build.place")).code, "collides_with_player");
  step("placing inside a player refused");
  await bot.moveTo([target[0] + 2.5, target[1] + 2.6, target[2] + 0.5], 2);
  await sleep(200);
  const index = bot.inventory.slots.findIndex((s) => s && s.item === drop.id);
  bot.call("platform.build.place", { voxel: target, slot: index });
  const placed = await bot.result("build.place");
  assert.equal(placed.ok, true, `placing failed: ${placed.code}`);
  step(`placed ${drop.name} back`);
}

bot.call("platform.build.place", { voxel: [target[0] + 40, target[1], target[2]] });
assert.equal((await bot.result("build.place")).code, "out_of_reach");
step("out-of-reach placement refused");

// Survival: a long fall hurts, a fatal one kills, and the dead respawn.
const vitals = [];
bot.waiters.push({ match: () => false, resolve() {} });
const onVitals = (m) => m.type === "EVENT" && m.name === "platform.vitals" && (vitals.push(m.payload), false);
bot.waiters.push({ match: onVitals, resolve() {} });
await sleep(5200); // the join grace period, during which falls do not count
const [gx, gy, gz] = [target[0] + 2, target[1], target[2]];
const eye = 1.425;
const fallFrom = async (height) => {
  for (let h = 0; h <= height; h += 20) await bot.moveTo([gx + 0.5, gy + 1 + eye + Math.min(h, height), gz + 0.5], 2);
  for (let h = height; h > 0; h -= 1) {
    await bot.moveTo([gx + 0.5, gy + 1 + eye + h, gz + 0.5]);
    await sleep(20);
  }
  await bot.moveTo([gx + 0.5, gy + 1 + eye, gz + 0.5], 3);
  await sleep(300);
};
await fallFrom(10);
const hurt = vitals.find((v) => v.cause === "fall");
assert.ok(hurt && hurt.health < 20, `a 10-block fall should hurt, got ${JSON.stringify(vitals.at(-1))}`);
step(`fell 10 blocks: health ${hurt.health}/20`);
await fallFrom(40);
assert.ok(vitals.some((v) => v.dead), "a 40-block fall should kill");
step("fatal fall killed the player");
bot.call("platform.mine.start", { voxel: target });
assert.equal((await bot.result("mine.start")).code, "dead");
step("the dead cannot act");
bot.call("platform.respawn");
assert.equal((await bot.result("respawn")).ok, true);
assert.equal(vitals.at(-1).health, 20);
step("respawned with full health");

bot.close();
console.log("smoke test passed");
process.exit(0);
