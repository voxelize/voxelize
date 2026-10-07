// Status effects and weather on a live server: a survival player drinks
// strength and fire resistance (the bottles come back), stands in fire
// unharmed, fills a bottle at water; a creative player brings rain and a
// thunderstorm (lightning strikes near players) and clears the sky again.
// Standalone (records seeded in SAVE_DIR):
//
//   DEV_TICKET_SECRET=... SAVE_DIR=... node effects.mjs - http://127.0.0.1:4000

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
const stamp = Date.now().toString(36);
const name = `fx_${stamp}`;
const slots = Array(36).fill(null);
slots[0] = { item: item("potion_strength").id, count: 1 };
slots[1] = { item: item("potion_fire_resistance").id, count: 1 };
slots[2] = { item: item("fire_striker").id, count: 1, durability: 64 };
slots[3] = { item: item("glass_bottle").id, count: 1 };
mkdirSync(`${process.env.SAVE_DIR}/main/players`, { recursive: true });
writeFileSync(`${process.env.SAVE_DIR}/main/players/pl_${name}.json`, JSON.stringify({ version: 1, id: `pl_${name}`, inventory: { slots, selected: 0 }, position: null }));

const bot = new Bot({ api: "-", game: GAME, name, issueTicket: ticket(name, "survival") });
const vitals = [];
const weather = [];
bot.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.vitals" && (vitals.push(m.payload), false), resolve() {} });
bot.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.weather" && (weather.push(m.payload), false), resolve() {} });
await bot.connect();
bot.requestChunks(1);
for (let i = 0; i < 100 && bot.chunks.size < 9; i++) await sleep(200);
const call = async (b, intent, payload) => {
  b.call(`platform.${intent}`, payload);
  const r = await b.result(intent);
  assert.equal(r.ok, true, `${intent}: ${JSON.stringify(r)}`);
  return r;
};

// Water nearby, and dry open ground beside it.
const def = (v) => content.blocks.find((b) => b.id === v);
const solid = (v) => !!def(v) && def(v).collision !== false && def(v).fluid == null;
let spot = null;
for (let x = -14; x < 30 && !spot; x++) for (let z = -14; z < 30 && !spot; z++) {
  const top = bot.surface(x, z, (v) => v !== 0 && v !== null && (def(v)?.collision !== false || def(v)?.fluid != null));
  if (top === null || !solid(bot.voxel(x, top, z)) || bot.voxel(x, top + 1, z) !== 0 || bot.voxel(x, top + 2, z) !== 0) continue;
  let water = false;
  for (let dx = -3; dx <= 3 && !water; dx++) for (let dz = -3; dz <= 3 && !water; dz++) for (let dy = -2; dy <= 1 && !water; dy++) water = def(bot.voxel(x + dx, top + dy, z + dz))?.fluid === "water";
  let wood = false;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy <= 2; dy++) wood ||= !!def(bot.voxel(x + dx, top + dy, z + dz))?.flammable;
  if (water && !wood) spot = [x, top, z];
}
assert.ok(spot, "dry ground by water");
const [x, ground, z] = spot;
await bot.moveTo([x + 0.5, ground + 1 + EYE, z + 0.5], 8);
await sleep(5500);

// Potions.
await call(bot, "eat", { slot: 0 });
await call(bot, "eat", { slot: 1 });
await sleep(300);
const fx = vitals.at(-1).effects.map((e) => e.kind).sort();
assert.deepEqual(fx, ["fire_resistance", "strength"]);
assert.equal(bot.inventory.slots[0].item, item("glass_bottle").id, "the bottle came back");
step("drank strength and fire resistance; the bottles came back");

// Fire does not hurt now.
await call(bot, "inventory.select", { slot: 2 });
await bot.moveTo([x + 1.5, ground + 1 + EYE, z + 0.5], 3);
await call(bot, "use", { voxel: [x, ground, z] });
for (let i = 0; i < 20 && bot.voxel(x, ground + 1, z) !== block("fire").id; i++) await sleep(100);
await bot.moveTo([x + 0.5, ground + 1 + EYE, z + 0.5], 3);
await sleep(2500);
assert.equal(vitals.at(-1).health, 20, "unharmed in the flames");
await bot.moveTo([x + 1.5, ground + 1 + EYE, z + 0.5], 3);
step("stood in fire unharmed with fire resistance");

// A bottle from the water.
await call(bot, "inventory.select", { slot: 3 });
await call(bot, "bottle.fill", {});
await sleep(200);
assert.equal(bot.inventory.slots[3].item, item("water_bottle").id);
step("filled a bottle with water");

// Weather, set by a creative player.
const op = new Bot({ api: "-", game: GAME, name: `op_${stamp}`, issueTicket: ticket(`op_${stamp}`, "creative") });
await op.connect();
await call(op, "weather.set", { kind: "rain" });
for (let i = 0; i < 40 && weather.at(-1)?.kind !== "rain"; i++) await sleep(100);
assert.equal(weather.at(-1)?.kind, "rain");
step(`it rains (${weather.at(-1).precipitation} where the player stands)`);
const bolt = bot.event("platform.lightning", () => true, 25000);
await call(op, "weather.set", { kind: "thunder" });
const struck = await bolt;
assert.ok(Math.hypot(struck.at[0] - x, struck.at[2] - z) < 64, "lightning near a player");
step(`a thunderstorm: lightning struck at ${struck.at.map(Math.round)}`);
await call(op, "weather.set", { kind: "clear" });
for (let i = 0; i < 40 && weather.at(-1)?.kind !== "clear"; i++) await sleep(100);
assert.equal(weather.at(-1)?.kind, "clear");
bot.call("platform.weather.set", { kind: "rain" });
assert.equal((await bot.result("weather.set")).code, "creative_only");
step("the sky cleared; survival players may not change the weather");

bot.close();
op.close();
console.log("effects: all checks passed");
process.exit(0);
