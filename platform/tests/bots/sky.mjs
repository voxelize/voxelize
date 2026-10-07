// The sky dimension on a live server: build a skystone frame, light it,
// travel to the floating islands, find cloudrock and open void around the
// arrival, and come back through the portal built there. Builds in
// creative.
//
//   DEV_TICKET_SECRET=... node sky.mjs - http://127.0.0.1:4000
//   node sky.mjs <api base> <game base> <creative api token>

import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

import { Bot } from "./bot.mjs";

const API = process.argv[2] ?? "http://127.0.0.1:8080";
const GAME = process.argv[3] ?? API;
const TOKEN = process.argv[4];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);
const content = await (await fetch(`${GAME}/platform/content`)).json();
const info = await (await fetch(`${GAME}/platform/info`)).json();
const id = (key) => content.blocks.find((b) => b.key === key).id;
const def = (v) => content.blocks.find((b) => b.id === v);
const EYE = 1.425;
const SKY = info.dimensions?.sky;
assert.ok(SKY, "the server hosts a sky");

const name = `sky_${Date.now().toString(36)}`;
const b64 = (data) => Buffer.from(data).toString("base64url");
const devTicket = () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: "platform-api", aud: "game", sub: `pl_${name}`, name, world: "main", realm: "creative", roles: ["player"], iat: now, exp: now + 60, jti: randomUUID() };
  const signed = `v1.${b64(JSON.stringify(claims))}`;
  return `${signed}.${createHmac("sha256", process.env.DEV_TICKET_SECRET).update(signed).digest("base64url")}`;
};
assert.ok(TOKEN || process.env.DEV_TICKET_SECRET, "an API token or DEV_TICKET_SECRET");
const newBot = () => new Bot({ api: API, game: GAME, token: TOKEN, name, issueTicket: TOKEN ? undefined : devTicket });

const call = async (bot, intent, payload) => {
  bot.call(`platform.${intent}`, payload);
  const r = await bot.result(intent);
  assert.equal(r.ok, true, `${intent}: ${JSON.stringify(r)}`);
  return r;
};
const loadAround = async (bot, [x, y, z]) => {
  // A new body starts at the origin; each update moves it at most 24 blocks.
  await bot.moveTo([x + 0.5, y + EYE, z + 0.5], 8);
  bot.requestChunks(1);
  for (let i = 0; i < 100 && bot.voxel(x, y, z) === null; i++) await sleep(200);
};
const travel = async (bot) => {
  const { world } = await bot.event("platform.travel", () => true, 15000);
  const placed = bot.event("platform.teleport", () => true, 90000);
  await bot.switchWorld(world);
  const { feet } = await placed;
  await loadAround(bot, feet);
  return { world, feet };
};

let bot = newBot();
await bot.connect();
bot.requestChunks(2);
for (let i = 0; i < 100 && bot.chunks.size < 25; i++) await sleep(200);

// A flat 4-wide strip with room above for a 5-tall frame.
const solid = (v) => v !== null && v !== 0 && def(v)?.collision !== false && def(v)?.fluid == null;
let base = null;
search: for (let x = 2; x < 30; x++) {
  for (let z = 2; z < 30; z++) {
    const top = bot.surface(x, z, (v) => solid(v));
    if (top === null) continue;
    let ok = true;
    for (let dx = 0; dx < 4 && ok; dx++)
      for (let dz = -1; dz <= 1 && ok; dz++) {
        ok = solid(bot.voxel(x + dx, top, z + dz));
        for (let dy = 1; dy <= 6 && ok; dy++) ok = bot.voxel(x + dx, top + dy, z + dz) === 0;
      }
    if (ok) {
      base = [x, top + 1, z];
      break search;
    }
  }
}
assert.ok(base, "flat ground for a portal");
const [bx, by, bz] = base;
await bot.moveTo([bx + 1.5, by + EYE, bz + 3.5], 12);
await sleep(5500);

await call(bot, "inventory.creative", { slot: 0, item: "skystone" });
await call(bot, "inventory.creative", { slot: 1, item: "fire_striker" });
for (let dx = 0; dx < 4; dx++)
  for (let dy = 0; dy < 5; dy++)
    if (dx === 0 || dx === 3 || dy === 0 || dy === 4) await call(bot, "build.place", { voxel: [bx + dx, by + dy, bz], slot: 0 });
await call(bot, "inventory.select", { slot: 1 });
const lit = await call(bot, "use", { voxel: [bx + 1, by, bz] });
assert.equal(lit.changed, 6, "six rift cells");
await sleep(300);
assert.equal(bot.voxel(bx + 1, by + 1, bz), id("sky_rift"));
step("a skystone frame lights into a sky rift");

// Into the portal: up to the sky.
await bot.moveTo([bx + 1.5, by + EYE, bz + 0.5], 3);
const up = await travel(bot);
assert.equal(up.world, SKY);
await sleep(1000);
assert.equal(bot.voxel(...up.feet), id("sky_rift"), `arrived standing in a sky portal: ${bot.voxel(...up.feet)}`);
assert.ok(Math.abs(up.feet[0] - bx) < 40 && Math.abs(up.feet[2] - bz) < 40, `unscaled coordinates: ${up.feet}`);
let rock = 0;
for (let dx = -16; dx <= 16; dx++) for (let dy = -30; dy <= 8; dy++) for (let dz = -16; dz <= 16; dz++) {
  const v = bot.voxel(up.feet[0] + dx, up.feet[1] + dy, up.feet[2] + dz);
  if (v === id("cloudrock") || v === id("turf")) rock++;
}
let void_ = 0;
for (let dx = -16; dx <= 16; dx += 4) for (let dz = -16; dz <= 16; dz += 4) {
  let empty = true;
  for (let y = 0; y < 40 && empty; y++) empty = bot.voxel(up.feet[0] + dx, y, up.feet[2] + dz) === 0;
  if (empty) void_++;
}
assert.ok(void_ > 0, "open void below the islands");
assert.ok(rock > 20, `landed on an island: ${rock} island blocks near ${up.feet}`);
step(`travelled to the sky, arrived at ${up.feet}: ${rock} island blocks near, void below`);

// A riftstone frame does not light up here.
await call(bot, "inventory.creative", { slot: 2, item: "riftstone" });
// Beside the arrival ledge, facing the portal.
const [sx, sy, sz] = [up.feet[0] - 1, up.feet[1], up.feet[2] + 2];
for (let dx = 0; dx < 4; dx++)
  for (let dy = 0; dy < 5; dy++)
    if (dx === 0 || dx === 3 || dy === 0 || dy === 4) await call(bot, "build.place", { voxel: [sx + dx, sy + dy, sz], slot: 2 });
bot.call("platform.use", { voxel: [sx + 1, sy, sz] });
const refused = await bot.result("use");
assert.equal(refused.ok, false, "an underworld frame stays dark in the sky");
step("an underworld frame does not light in the sky");

// Step out and back in: home through the first portal.
await bot.moveTo([up.feet[0] + 0.5, up.feet[1] + EYE, up.feet[2] + 1.5], 3);
await sleep(4000);
await bot.moveTo([up.feet[0] + 0.5, up.feet[1] + EYE, up.feet[2] + 0.5], 3);
const home = await travel(bot);
assert.equal(home.world, "main");
assert.ok(Math.abs(home.feet[0] - (bx + 1)) <= 2 && Math.abs(home.feet[2] - bz) <= 2, `home through the first portal: ${home.feet}`);
step("travelled back and arrived in the original portal");

bot.close();
console.log("sky: all checks passed");
process.exit(0);
