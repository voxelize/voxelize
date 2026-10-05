// Processing stations on a live server: a crusher turns one raw ore into
// two crushed ores and a smelter melts them into ingots twice as fast as a
// furnace; both burn fuel and name themselves in their window. Builds in
// creative.
//
// Against a full stack, a creative player's API token:
//   node stations.mjs <api base> <game base> <api token>
// Against a standalone game server sharing a development ticket secret:
//   DEV_TICKET_SECRET=... node stations.mjs - http://127.0.0.1:4000

import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

import { Bot } from "./bot.mjs";

const API = process.argv[2] ?? "http://127.0.0.1:8080";
const GAME = process.argv[3] ?? API;
const TOKEN = process.argv[4];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);
const content = await (await fetch(`${GAME}/platform/content`)).json();
const id = (key) => content.blocks.find((b) => b.key === key).id;
const EYE = 1.425;

const name = `stations_${Date.now().toString(36)}`;
const b64 = (data) => Buffer.from(data).toString("base64url");
const devTicket = () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: "platform-api", aud: "game", sub: `pl_${name}`, name, world: "main", realm: "creative", roles: ["player"], iat: now, exp: now + 60, jti: randomUUID() };
  const signed = `v1.${b64(JSON.stringify(claims))}`;
  return `${signed}.${createHmac("sha256", process.env.DEV_TICKET_SECRET).update(signed).digest("base64url")}`;
};
assert.ok(TOKEN || process.env.DEV_TICKET_SECRET, "an API token or DEV_TICKET_SECRET");
const bot = new Bot({ api: API, game: GAME, token: TOKEN, name, issueTicket: TOKEN ? undefined : devTicket });
await bot.connect();
bot.requestChunks(2);
for (let i = 0; i < 100 && bot.chunks.size < 25; i++) await sleep(200);

const solid = (v) => v !== null && v !== 0 && content.blocks.find((b) => b.id === v)?.fluid == null;
// A flat strip of 7 solid blocks along x with two air blocks above.
let base = null;
search: for (let x = 2; x < 30; x++) {
  for (let z = 2; z < 30; z++) {
    const y = bot.surface(x, z, (v) => content.blocks.find((b) => b.id === v)?.collision !== false);
    if (y === null) continue;
    let ok = true;
    for (let dx = 0; dx < 7 && ok; dx++)
      ok = solid(bot.voxel(x + dx, y, z)) && bot.voxel(x + dx, y + 1, z) === 0 && bot.voxel(x + dx, y + 2, z) === 0 &&
        bot.voxel(x + dx, y + 1, z + 2) === 0 && solid(bot.voxel(x + dx, y, z + 2));
    if (ok) {
      base = [x, y + 1, z];
      break search;
    }
  }
}
assert.ok(base, "a flat strip to build on");
const [bx, by, bz] = base;
await bot.moveTo([bx + 3.5, by + EYE, bz + 1.5], 12);
await sleep(5500); // join grace

const place = async (voxel, block, extra = {}) => {
  bot.call("platform.build.place", { voxel, block, ...extra });
  const r = await bot.result("build.place");
  assert.equal(r.ok, true, `place ${block}: ${JSON.stringify(r)}`);
};
const use = async (voxel) => {
  bot.call("platform.use", { voxel });
  const r = await bot.result("use");
  assert.equal(r.ok, true, `use: ${JSON.stringify(r)}`);
};
const until = async (pred, label, ms = 8000) => {
  const start = Date.now();
  while (!pred()) {
    assert.ok(Date.now() - start < ms, `timed out: ${label}`);
    await sleep(100);
  }
};

const item = (key) => content.items.find((i) => i.key === key);
const give = async (slot, key) => {
  bot.call("platform.inventory.creative", { slot, item: key });
  await bot.event("platform.inventory", (p) => p.slots[slot]?.item === item(key).id);
};
// Run one station: raw input and coal in, wait for `output`, take it.
const run = async (at, station, name, input, output, count) => {
  bot.call("platform.window.open", { voxel: at });
  let w = await bot.event("platform.window", (p) => p.kind === "furnace" && p.furnace?.station === station);
  assert.equal(w.furnace.name, name, "the window names its station");
  bot.call("platform.window.click", { slot: w.inventoryStart + bot.slotOf(item(input).id), click: { type: "shift" } });
  w = await bot.event("platform.window", (p) => p.slots[0]?.item === item(input).id);
  bot.call("platform.window.click", { slot: w.inventoryStart + bot.slotOf(item("coal").id), click: { type: "shift" } });
  const done = await bot.event("platform.window", (p) => p.slots[2]?.item === item(output).id && p.slots[2].count >= count, 30000);
  assert.ok(done.furnace.burnTotal > 0, "it burned fuel");
  bot.call("platform.window.click", { slot: 2, click: { type: "shift" } });
  await bot.event("platform.window", (p) => !p.slots[2] || p.slots[2].item !== item(output).id || p.slots[2].count < count);
  bot.call("platform.window.close", {});
  await bot.event("platform.window", (p) => p.kind === null);
  await sleep(200);
  return done;
};

await place([bx, by, bz], "crusher");
await place([bx + 2, by, bz], "smelter");
step("placed a crusher and a smelter");

await give(0, "raw_iron");
await give(1, "coal");
// One raw ore crushes into two.
const crushed = await run([bx, by, bz], "crusher", "Crusher", "raw_iron", "crushed_iron", 2);
assert.equal(crushed.slots[2].count % 2, 0, "two per ore");
assert.ok(bot.count(item("crushed_iron").id) >= 2);
step("the crusher turned raw iron into twice as much crushed iron");

// Leftover raw iron goes back to the inventory first.
bot.call("platform.window.open", { voxel: [bx, by, bz] });
let w = await bot.event("platform.window", (p) => p.kind === "furnace");
for (const slot of [0, 1]) if (w.slots[slot]) {
  bot.call("platform.window.click", { slot, click: { type: "shift" } });
  w = await bot.event("platform.window", (p) => !p.slots[slot]);
}
bot.call("platform.window.close", {});
await bot.event("platform.window", (p) => p.kind === null);

const smelted = await run([bx + 2, by, bz], "smelter", "Smelter", "crushed_iron", "iron_ingot", 1);
assert.ok(smelted.furnace.progressTotal <= 100, `the smelter is quick (${smelted.furnace.progressTotal} ticks)`);
assert.ok(bot.count(item("iron_ingot").id) >= 1);
step("the smelter turned crushed iron into ingots, twice as fast as a furnace");

bot.close();
console.log("stations: all checks passed");
process.exit(0);
