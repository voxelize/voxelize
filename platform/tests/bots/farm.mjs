// Farming and tall doors on a live server: a survival player tills soil,
// plants a carrot, ripens it with fertiliser and harvests several carrots;
// then places a plank door (both halves appear), opens and closes it from
// either half, and breaks it (both halves go, one door comes back).
// Standalone (records seeded in SAVE_DIR):
//
//   DEV_TICKET_SECRET=... SAVE_DIR=... node farm.mjs - http://127.0.0.1:4000

import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

import { Bot } from "./bot.mjs";

const GAME = process.argv[3] ?? "http://127.0.0.1:4000";
assert.ok(process.env.DEV_TICKET_SECRET && process.env.SAVE_DIR, "DEV_TICKET_SECRET and SAVE_DIR");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);
const content = await (await fetch(`${GAME}/platform/content`)).json();
const item = (key) => content.items.find((i) => i.key === key);
const block = (key) => content.blocks.find((b) => b.key === key);
const EYE = 1.425;
const b64 = (d) => Buffer.from(d).toString("base64url");
const ticket = (name, realm) => () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: "platform-api", aud: "game", sub: `pl_${name}`, name, world: "main", realm, roles: ["player"], iat: now, exp: now + 60, jti: randomUUID() };
  const signed = `v1.${b64(JSON.stringify(claims))}`;
  return `${signed}.${createHmac("sha256", process.env.DEV_TICKET_SECRET).update(signed).digest("base64url")}`;
};
const name = `farm_${Date.now().toString(36)}`;
const slots = Array(36).fill(null);
slots[0] = { item: item("wooden_hoe").id, count: 1, durability: item("wooden_hoe").durability };
slots[1] = { item: item("carrot").id, count: 1 };
slots[2] = { item: item("fertiliser").id, count: 6 };
slots[3] = { item: item("door").id, count: 1 };
mkdirSync(`${process.env.SAVE_DIR}/main/players`, { recursive: true });
writeFileSync(`${process.env.SAVE_DIR}/main/players/pl_${name}.json`, JSON.stringify({ version: 1, id: `pl_${name}`, inventory: { slots, selected: 0 }, position: null }));

const bot = new Bot({ api: "-", game: GAME, name, issueTicket: ticket(name, "survival") });
await bot.connect();
bot.requestChunks(1);
for (let i = 0; i < 100 && bot.chunks.size < 9; i++) await sleep(200);
const call = async (intent, payload) => {
  bot.call(`platform.${intent}`, payload);
  const r = await bot.result(intent);
  assert.equal(r.ok, true, `${intent}: ${JSON.stringify(r)}`);
  return r;
};
const until = async (test, what, ms = 3000) => {
  for (let i = 0; i < ms / 100 && !test(); i++) await sleep(100);
  assert.ok(test(), what);
};

// Two soil cells side by side with room above.
const def = (v) => content.blocks.find((b) => b.id === v);
const standable = (v) => v !== 0 && v !== null && (def(v)?.collision !== false || def(v)?.fluid != null);
const soil = (v) => ["turf", "dirt"].includes(def(v)?.key);
let spot = null;
for (let x = -14; x < 30 && !spot; x++) for (let z = -14; z < 30 && !spot; z++) {
  const top = bot.surface(x, z, standable);
  if (top === null || !soil(bot.voxel(x, top, z)) || bot.surface(x + 1, z, standable) !== top) continue;
  let free = true;
  for (let dx = 0; dx <= 2 && free; dx++) for (let dy = 1; dy <= 3 && free; dy++) free = bot.voxel(x + dx, top + dy, z) === 0;
  if (free && bot.surface(x + 2, z, standable) === top) spot = [x, top, z];
}
assert.ok(spot, "open soil");
const [x, ground, z] = spot;
await bot.moveTo([x + 2.5, ground + 1 + EYE, z + 2.5], 8);
await sleep(5500);

// Till, plant, fertilise, harvest.
await call("inventory.select", { slot: 0 });
await call("use", { voxel: [x, ground, z] });
await until(() => bot.voxel(x, ground, z) === block("farmland").id, "tilled");
await call("build.place", { voxel: [x, ground + 1, z], slot: 1 });
await until(() => bot.voxel(x, ground + 1, z) === block("carrot_crop").id, "planted");
await call("inventory.select", { slot: 2 });
let uses = 0;
while (bot.stage(x, ground + 1, z) < 3 && uses < 4) {
  const before = bot.stage(x, ground + 1, z);
  await call("use", { voxel: [x, ground + 1, z] });
  uses++;
  await until(() => bot.stage(x, ground + 1, z) > before, "the crop grew");
}
assert.equal(bot.stage(x, ground + 1, z), 3, "ripe");
bot.call("platform.use", { voxel: [x, ground + 1, z] });
assert.equal((await bot.result("use")).code, "cannot_use", "a ripe crop takes no more");
assert.equal(bot.count(item("fertiliser").id), 6 - uses);
await call("mine.start", { voxel: [x, ground + 1, z] });
const harvest = await call("mine.finish", { voxel: [x, ground + 1, z] });
assert.ok(harvest.drops[0][1] >= 2, JSON.stringify(harvest));
await until(() => bot.voxel(x, ground + 1, z) === 0, "the crop is gone");
await bot.moveTo([x + 0.5, ground + 1 + EYE, z + 0.5], 2); // walk over the drops
await until(() => bot.count(item("carrot").id) >= 2, "picked up the carrots");
await bot.moveTo([x + 2.5, ground + 1 + EYE, z + 2.5], 2);
step(`tilled, planted a carrot, ripened it with ${uses} fertiliser, harvested ${bot.count(item("carrot").id)} carrots`);

// A tall door.
const door = [x + 2, ground + 1, z];
const top = [x + 2, ground + 2, z];
await call("build.place", { voxel: door, slot: 3 });
await until(() => bot.voxel(...door) === block("door").id && bot.voxel(...top) === block("door_top").id, "both halves placed");
assert.equal(bot.count(item("door").id), 0);
await call("use", { voxel: top });
await until(() => bot.voxel(...door) === block("door_open").id && bot.voxel(...top) === block("door_top_open").id, "opened from the top");
await call("use", { voxel: door });
await until(() => bot.voxel(...door) === block("door").id && bot.voxel(...top) === block("door_top").id, "closed from the bottom");
await call("mine.start", { voxel: top });
await sleep(4600);
await call("mine.finish", { voxel: top });
await until(() => bot.voxel(...door) === 0 && bot.voxel(...top) === 0, "both halves broke");
await bot.moveTo([door[0] + 0.5, door[1] + EYE, door[2] + 0.5], 2);
await until(() => bot.count(item("door").id) === 1, "one door back");
step("a door placed both halves, opened and closed from either half, and broke whole into one door");

bot.close();
console.log("farm: all checks passed");
process.exit(0);
