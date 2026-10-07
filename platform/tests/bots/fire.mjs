// Fire, explosions and bows on a live server (survival): a fire striker
// sets the ground alight and the fire dies out on bare earth; standing in it
// sets the player on fire; a blast charge, lit and left, blows a crater; a
// fully drawn bow shoots an arrow that lands and can be picked up.
// Standalone (the player's record is seeded in SAVE_DIR):
//
//   DEV_TICKET_SECRET=... SAVE_DIR=... node fire.mjs - http://127.0.0.1:4000

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

const name = `fire_${Date.now().toString(36)}`;
const id = `pl_${name}`;
const b64 = (d) => Buffer.from(d).toString("base64url");
const devTicket = () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: "platform-api", aud: "game", sub: id, name, world: "main", realm: "survival", roles: ["player"], iat: now, exp: now + 60, jti: randomUUID() };
  const signed = `v1.${b64(JSON.stringify(claims))}`;
  return `${signed}.${createHmac("sha256", process.env.DEV_TICKET_SECRET).update(signed).digest("base64url")}`;
};
const slots = Array(36).fill(null);
slots[0] = { item: item("fire_striker").id, count: 1, durability: 64 };
slots[1] = { item: item("blast_charge").id, count: 1 };
slots[2] = { item: item("bow").id, count: 1, durability: 384 };
slots[3] = { item: item("arrow").id, count: 3 };
mkdirSync(`${process.env.SAVE_DIR}/main/players`, { recursive: true });
writeFileSync(`${process.env.SAVE_DIR}/main/players/${id}.json`, JSON.stringify({ version: 1, id, inventory: { slots, selected: 0 }, position: null }));

const bot = new Bot({ api: "-", game: GAME, name, issueTicket: devTicket });
const vitals = [];
bot.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.vitals" && (vitals.push(m.payload), false), resolve() {} });
await bot.connect();
bot.requestChunks(1);
for (let i = 0; i < 100 && bot.chunks.size < 9; i++) await sleep(200);
const call = async (intent, payload) => {
  bot.call(`platform.${intent}`, payload);
  const r = await bot.result(intent);
  assert.equal(r.ok, true, `${intent}: ${JSON.stringify(r)}`);
  return r;
};
const solid = (v) => { const d = content.blocks.find((b) => b.id === v); return !!d && d.collision !== false && d.fluid == null; };
const flammable = (v) => content.blocks.find((b) => b.id === v)?.flammable;
// Open, bare cells (solid ground, air above, nothing flammable around).
const def = (v) => content.blocks.find((b) => b.id === v);
const standable = (v) => v !== 0 && v !== null && (def(v)?.collision !== false || def(v)?.fluid != null);
const cells = [];
for (let cx = -12; cx < 28; cx++) for (let cz = -12; cz < 28; cz++) {
  const top = bot.surface(cx, cz, standable);
  if (top === null || !solid(bot.voxel(cx, top, cz)) || bot.voxel(cx, top + 1, cz) !== 0 || bot.voxel(cx, top + 2, cz) !== 0) continue;
  let bare = true;
  for (let dx = -1; dx <= 1 && bare; dx++) for (let dy = -1; dy <= 2 && bare; dy++) for (let dz = -1; dz <= 1 && bare; dz++) bare = !flammable(bot.voxel(cx + dx, top + dy, cz + dz));
  if (bare) cells.push([cx, top, cz]);
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const spot = cells.find((c) => cells.some((o) => dist(c, o) >= 3 && dist(c, o) <= 5 && Math.abs(o[1] - c[1]) <= 2) && cells.some((o) => dist(c, o) >= 13));
assert.ok(spot, "open, bare ground");
const chargeCell = cells.find((o) => dist(spot, o) >= 3 && dist(spot, o) <= 5 && Math.abs(o[1] - spot[1]) <= 2);
const away = cells.find((o) => dist(spot, o) >= 13 && dist(chargeCell, o) >= 10);
assert.ok(away, "somewhere to hide");
const [x, ground, z] = spot;
await bot.moveTo([x + 2.5, ground + 1 + EYE, z + 0.5], 6);
await sleep(5500);

// Fire on bare earth burns out.
await call("use", { voxel: [x, ground, z] });
for (let i = 0; i < 20 && bot.voxel(x, ground + 1, z) !== block("fire").id; i++) await sleep(100);
assert.equal(bot.voxel(x, ground + 1, z), block("fire").id, "the striker set the ground alight");
await bot.moveTo([x + 0.5, ground + 1 + EYE, z + 0.5], 3);
const burnt = await bot.event("platform.vitals", (v) => v.burning && v.cause === "fire", 6000);
assert.ok(burnt.health < 20);
await bot.moveTo([x + 2.5, ground + 1 + EYE, z + 0.5], 3);
step(`a fire striker lit the ground; standing in it burned (health ${burnt.health})`);
for (let i = 0; i < 150 && bot.voxel(x, ground + 1, z) === block("fire").id; i++) await sleep(100);
assert.equal(bot.voxel(x, ground + 1, z), 0, "the fire died out on bare earth");
step("the fire died out on bare earth");

// A blast charge.
const charge = [chargeCell[0], chargeCell[1] + 1, chargeCell[2]];
await bot.moveTo([charge[0] + 1.5, charge[1] + EYE, charge[2] + 0.5], 4);
await call("build.place", { voxel: charge, slot: 1 });
for (let i = 0; i < 20 && bot.voxel(...charge) !== block("blast_charge").id; i++) await sleep(100);
const boom = bot.event("platform.explosion", () => true, 10000);
await call("inventory.select", { slot: 0 });
await call("use", { voxel: charge });
const lit = await bot.event("platform.combat", (c) => c.fuses?.length === 1, 3000);
assert.ok(lit.fuses[0].fuse <= 4);
await bot.moveTo([away[0] + 0.5, away[1] + 1 + EYE, away[2] + 0.5], 4);
await boom;
await sleep(500);
let gone = 0;
for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (bot.voxel(charge[0] + dx, chargeCell[1], charge[2] + dz) === 0) gone++;
assert.ok(gone >= 3, `a crater: ${gone} of 9 ground cells gone`);
assert.ok(!vitals.some((v) => v.cause === "explosion"), "far enough away to be unhurt");
step(`a lit blast charge blew a crater (${gone}/9 cells under it gone); the player far away was unhurt`);

// The bow: a full draw, then the arrow lands and can be picked up.
await call("inventory.select", { slot: 2 });
await call("bow.draw", {});
await sleep(1100);
const shot = await call("bow.shoot", { direction: [-1, -0.3, 0] });
assert.ok(shot.charge > 0.99, "a full draw");
assert.equal(bot.count(item("arrow").id), 2, "one arrow used");
await bot.event("platform.combat", (c) => c.arrows?.length === 1, 3000);
const landed = await bot.event("platform.drops", (d) => d.items.some((i) => i.item === item("arrow").id), 10000);
const dropped = landed.items.find((i) => i.item === item("arrow").id);
await bot.moveTo([dropped.p[0], dropped.p[1] + EYE, dropped.p[2]], 6);
for (let i = 0; i < 40 && bot.count(item("arrow").id) < 3; i++) await sleep(100);
assert.equal(bot.count(item("arrow").id), 3, "picked the arrow up again");
step("a fully drawn bow shot an arrow that landed and was picked up again");

bot.close();
console.log("fire: all checks passed");
process.exit(0);
