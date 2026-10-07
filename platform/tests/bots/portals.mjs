// Dimensions on a live server: build a riftstone frame, light it, travel
// to the underworld, come back through the portal built there, and find
// the server sending a reconnecting player back to the dimension they left.
// Builds in creative.
//
//   DEV_TICKET_SECRET=... node portals.mjs - http://127.0.0.1:4000
//   node portals.mjs <api base> <game base> <creative api token>

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
const UNDER = info.dimensions?.underworld;
assert.ok(UNDER, "the server hosts an underworld");

const name = `portals_${Date.now().toString(36)}`;
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

await call(bot, "inventory.creative", { slot: 0, item: "riftstone" });
await call(bot, "inventory.creative", { slot: 1, item: "fire_striker" });
for (let dx = 0; dx < 4; dx++)
  for (let dy = 0; dy < 5; dy++)
    if (dx === 0 || dx === 3 || dy === 0 || dy === 4) await call(bot, "build.place", { voxel: [bx + dx, by + dy, bz], slot: 0 });
await call(bot, "inventory.select", { slot: 1 });
const lit = await call(bot, "use", { voxel: [bx + 1, by, bz] });
assert.equal(lit.changed, 6, "six rift cells");
await sleep(300);
assert.equal(bot.voxel(bx + 1, by + 1, bz), id("rift"));
step("a riftstone frame lights with a fire striker");

// Into the portal: off to the underworld.
await bot.moveTo([bx + 1.5, by + EYE, bz + 0.5], 3);
const down = await travel(bot);
assert.equal(down.world, UNDER);
await sleep(1000);
assert.equal(bot.voxel(...down.feet), id("rift"), `arrived standing in a portal: ${bot.voxel(...down.feet)} at ${down.feet}`);
let cinder = 0;
for (let dx = -8; dx <= 8; dx++) for (let dy = -8; dy <= 8; dy++) for (let dz = -8; dz <= 8; dz++) if (bot.voxel(down.feet[0] + dx, down.feet[1] + dy, down.feet[2] + dz) === id("cinderstone")) cinder++;
assert.ok(cinder > 50, `cinderstone around the arrival: ${cinder}`);
assert.ok(Math.abs(down.feet[0] - bx / 8) < 20 && Math.abs(down.feet[2] - bz / 8) < 20, `scaled coordinates: ${down.feet}`);
step(`travelled to the underworld, arrived in a portal at ${down.feet}`);

// Reconnecting puts the player back in the underworld.
await sleep(1500);
bot.close();
await sleep(1500);
bot = newBot();
const redirected = bot.event("platform.travel", () => true, 25000);
await bot.connect(); // joins "main"
const { world: back } = await redirected;
assert.equal(back, UNDER, "the server sends a reconnecting player to their dimension");
const placed = bot.event("platform.teleport", () => true, 15000);
await bot.switchWorld(back);
const { feet: resumed } = await placed;
assert.ok(Math.abs(resumed[0] - down.feet[0]) <= 2 && Math.abs(resumed[2] - down.feet[2]) <= 2, `resumed at ${resumed}`);
step("reconnecting resumes in the underworld where the player was");

// Step out of the portal and back in: home through the same portal.
await loadAround(bot, resumed);
// (an arrival portal has a riftstone ledge on both sides)
// Joining or arriving in a portal needs a step out (after a 3 s settle)
// before it takes you anywhere.
await bot.moveTo([resumed[0] + 0.5, resumed[1] + EYE, resumed[2] + 1.5], 3);
await sleep(4000);
await bot.moveTo([resumed[0] + 0.5, resumed[1] + EYE, resumed[2] + 0.5], 3);
const up = await travel(bot);
assert.equal(up.world, "main");
assert.ok(Math.abs(up.feet[0] - (bx + 1)) <= 2 && Math.abs(up.feet[2] - bz) <= 2 && Math.abs(up.feet[1] - (by + 1)) <= 2, `home through the first portal: ${up.feet} vs ${[bx + 1, by + 1, bz]}`);
step("travelled back and arrived in the original portal");

bot.close();
console.log("portals: all checks passed");
process.exit(0);
