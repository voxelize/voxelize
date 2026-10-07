// Armor and experience on a live server: a survival player puts on a
// chestplate (shift-click goes to its slot, the HUD learns the armor
// points), places an anvil and repairs a worn pickaxe there for levels.
// Standalone (the player's record is seeded in SAVE_DIR):
//
//   DEV_TICKET_SECRET=... SAVE_DIR=... node armor.mjs - http://127.0.0.1:4000

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
const EYE = 1.425;

const name = `armor_${Date.now().toString(36)}`;
const id = `pl_${name}`;
const b64 = (d) => Buffer.from(d).toString("base64url");
const devTicket = () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: "platform-api", aud: "game", sub: id, name, world: "main", realm: "survival", roles: ["player"], iat: now, exp: now + 60, jti: randomUUID() };
  const signed = `v1.${b64(JSON.stringify(claims))}`;
  return `${signed}.${createHmac("sha256", process.env.DEV_TICKET_SECRET).update(signed).digest("base64url")}`;
};

// Level 5 (55 points), a chestplate, an anvil and a half-worn pickaxe.
const pick = item("iron_pickaxe");
const slots = Array(36).fill(null);
slots[0] = { item: item("iron_chestplate").id, count: 1, durability: item("iron_chestplate").durability };
slots[1] = { item: item("anvil").id, count: 1 };
slots[2] = { item: pick.id, count: 1, durability: pick.durability - Math.floor(pick.durability / 2) };
mkdirSync(`${process.env.SAVE_DIR}/main/players`, { recursive: true });
writeFileSync(`${process.env.SAVE_DIR}/main/players/${id}.json`, JSON.stringify({ version: 1, id, inventory: { slots, selected: 0 }, position: null, xp: 55 }));

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

// Put the chestplate on: shift-click from the inventory screen.
bot.call("platform.window.open", {});
const w = await bot.event("platform.window", (p) => p.kind === "player");
const worn = bot.event("platform.inventory", (p) => p.armor === 6, 8000);
bot.call("platform.window.click", { slot: w.inventoryStart, click: { type: "shift" } });
const after = await bot.event("platform.window", (p) => p.slots[6]?.item === item("iron_chestplate").id, 8000);
assert.equal(after.slots[6].item, item("iron_chestplate").id, "worn in the chest slot");
await worn;
bot.call("platform.window.close", {});
step("shift-clicking the chestplate put it on: 6 armor points");

// Place an anvil and repair the pickaxe for two levels.
const solid = (v) => { const d = content.blocks.find((b) => b.id === v); return !!d && d.collision !== false && d.fluid == null; };
let spot = null;
for (let x = -10; x < 20 && !spot; x++) for (let z = -10; z < 20 && !spot; z++) {
  const top = bot.surface(x, z, (v) => v !== 0 && v !== null);
  if (top !== null && solid(bot.voxel(x, top, z)) && bot.voxel(x, top + 1, z) === 0 && bot.voxel(x, top + 2, z) === 0) spot = [x, top + 1, z];
}
assert.ok(spot, "open ground");
await bot.moveTo([spot[0] + 2.5, spot[1] + EYE, spot[2] + 0.5], 6);
await sleep(5500);
await call("build.place", { voxel: spot, slot: 1 });
for (let i = 0; i < 30 && bot.voxel(...spot) !== content.blocks.find((b) => b.key === "anvil").id; i++) await sleep(100);
await call("inventory.select", { slot: 2 });
const r = await call("use", { voxel: spot });
assert.equal(r.levels, 2);
await sleep(300);
assert.equal(bot.inventory.slots[2].durability, pick.durability, "repaired");
assert.equal(vitals.at(-1).level, 3, "two levels spent");
bot.call("platform.use", { voxel: spot });
assert.equal((await bot.result("use")).code, "cannot_use", "nothing left to repair");
step("an anvil repaired the pickaxe for 2 of 5 levels");

bot.close();
console.log("armor: all checks passed");
process.exit(0);
