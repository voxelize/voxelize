// Creatures on a live server: a survival player places cinderstone and
// uses an ember sigil on it, summoning the Ember Warden boss (one at a time);
// the boss shoots arrows from a distance that hurt and knock the player
// back, and up close its blows hurt, knock back and slow. Standalone
// (records seeded in SAVE_DIR):
//
//   DEV_TICKET_SECRET=... SAVE_DIR=... node creatures.mjs - http://127.0.0.1:4000

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
const name = `mob_${Date.now().toString(36)}`;
const slots = Array(36).fill(null);
slots[0] = { item: item("cinderstone").id, count: 2 };
slots[1] = { item: item("ember_sigil").id, count: 1 };
slots[2] = { item: item("ember_sigil").id, count: 1 };
mkdirSync(`${process.env.SAVE_DIR}/main/players`, { recursive: true });
writeFileSync(`${process.env.SAVE_DIR}/main/players/pl_${name}.json`, JSON.stringify({ version: 1, id: `pl_${name}`, inventory: { slots, selected: 0 }, position: null }));

const bot = new Bot({ api: "-", game: GAME, name, issueTicket: ticket(name, "survival") });
const vitals = [];
const pushes = [];
bot.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.vitals" && (vitals.push(m.payload), false), resolve() {} });
bot.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.push" && (pushes.push(m.payload), false), resolve() {} });
await bot.connect();
bot.requestChunks(2);
for (let i = 0; i < 150 && bot.chunks.size < 25; i++) await sleep(200);
const call = async (intent, payload) => {
  bot.call(`platform.${intent}`, payload);
  const r = await bot.result(intent);
  assert.equal(r.ok, true, `${intent}: ${JSON.stringify(r)}`);
  return r;
};

// Flat, dry, open ground: an altar spot with room for a three-block-tall boss.
const def = (v) => content.blocks.find((b) => b.id === v);
const solid = (v) => !!def(v) && def(v).collision !== false && def(v).fluid == null;
const standable = (v) => v !== 0 && v !== null && (def(v)?.collision !== false || def(v)?.fluid != null);
let spot = null;
const air = (cx, cy, cz) => bot.voxel(cx, cy, cz) === 0;
for (let x = -14; x < 30 && !spot; x++) for (let z = -14; z < 30 && !spot; z++) {
  const top = bot.surface(x, z, standable);
  if (top === null || !solid(bot.voxel(x, top, z))) continue;
  let ok = true;
  // Room for the boss over the altar, and a clear line to the player.
  for (let dx = -1; dx <= 1 && ok; dx++) for (let dz = -1; dz <= 1 && ok; dz++) for (let dy = 2; dy <= 5 && ok; dy++) ok = air(x + dx, top + dy, z + dz);
  for (let dx = 1; dx <= 5 && ok; dx++) {
    const t = bot.surface(x + dx, z, standable);
    ok = t !== null && Math.abs(t - top) <= 1 && solid(bot.voxel(x + dx, t, z));
    for (let dy = 1; dy <= 4 && ok; dy++) ok = air(x + dx, top + dy + (dx === 1 ? 1 : 0), z) && air(x + dx, t + dy, z);
  }
  if (ok) spot = [x, top, z];
}
assert.ok(spot, "flat open ground");
const [x, ground, z] = spot;
const standY = bot.surface(x + 5, z, standable);
await bot.moveTo([x + 5.5, standY + 1 + EYE, z + 0.5], 8);
await sleep(5500);

// The altar and the summoning.
const altar = [x, ground + 1, z];
await call("build.place", { voxel: altar, slot: 0 });
for (let i = 0; i < 20 && bot.voxel(...altar) !== block("cinderstone").id; i++) await sleep(100);
await call("inventory.select", { slot: 1 });
const summoned = await call("use", { voxel: altar });
assert.equal(summoned.summoned, "ember_warden");
assert.equal(bot.inventory.slots[1], null, "the sigil was used up");
const appeared = await bot.event("platform.mobs", (m) => m.mobs.some((b) => b.id === summoned.mob), 3000);
const boss = appeared.mobs.find((b) => b.id === summoned.mob);
assert.equal(boss.health, content.mobs.find((m) => m.key === "ember_warden").health);
await call("inventory.select", { slot: 2 });
bot.call("platform.use", { voxel: altar });
assert.equal((await bot.result("use")).code, "cannot_use", "one warden at a time");
assert.ok(bot.inventory.slots[2], "the second sigil was kept");
step(`an ember sigil on cinderstone summoned the Ember Warden (${boss.health} health); a second one was refused`);

// From a distance it shoots.
await bot.event("platform.combat", (c) => c.arrows?.length > 0, 8000);
for (let i = 0; i < 80 && !vitals.some((v) => v.cause === "arrow"); i++) await sleep(100);
const shotHit = vitals.find((v) => v.cause === "arrow");
assert.ok(shotHit, `an arrow hit: ${JSON.stringify(vitals.map((v) => [v.cause, v.health]))}`);
await sleep(200);
assert.ok(pushes.length >= 1, "the arrow knocked the player back");
step(`it shot an arrow that hit (health ${shotHit.health}) and knocked the player back`);

// Up close it strikes, knocks back and slows.
const pushed = pushes.length;
const mobAt = bot.mobs.find((m) => m.id === summoned.mob).p;
await bot.moveTo([mobAt[0] + 1.6, mobAt[1] + EYE, mobAt[2]], 2);
const before = vitals.length;
for (let i = 0; i < 60 && !vitals.slice(before).some((v) => v.cause === "mob"); i++) await sleep(100);
const blow = vitals.slice(before).find((v) => v.cause === "mob");
assert.ok(blow, `a blow: ${JSON.stringify(vitals.map((v) => [v.cause, v.health]))} boss at ${JSON.stringify(bot.mobs.find((m) => m.id === summoned.mob))} me ${JSON.stringify(bot.position)}`);
assert.ok(blow.effects.some((e) => e.kind === "slowness"), JSON.stringify(blow.effects));
await sleep(200);
assert.ok(pushes.length > pushed, "the blow knocked the player back");
assert.ok(pushes.at(-1).velocity[0] > 0, `pushed away from the boss: ${JSON.stringify(pushes.at(-1))}`);
step(`its blow hurt (health ${blow.health}), slowed and knocked the player back`);

bot.close();
console.log("creatures: all checks passed");
process.exit(0);
