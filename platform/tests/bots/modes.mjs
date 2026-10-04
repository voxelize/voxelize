// Game modes on a live server: a moderator puts a survival player into
// adventure mode (no breaking or placing, the change announced to the
// world), then spectator mode (nothing touched, no damage), then back;
// a plain player may not change their own mode in survival.
// Standalone (records seeded in SAVE_DIR):
//
//   DEV_TICKET_SECRET=... SAVE_DIR=... node modes.mjs - http://127.0.0.1:4000

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
const b64 = (d) => Buffer.from(d).toString("base64url");
const ticket = (name, roles) => () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: "platform-api", aud: "game", sub: `pl_${name}`, name, world: "main", realm: "survival", roles, iat: now, exp: now + 60, jti: randomUUID() };
  const signed = `v1.${b64(JSON.stringify(claims))}`;
  return `${signed}.${createHmac("sha256", process.env.DEV_TICKET_SECRET).update(signed).digest("base64url")}`;
};
const stamp = Date.now().toString(36);
const modName = `mod_${stamp}`;
const name = `adv_${stamp}`;
mkdirSync(`${process.env.SAVE_DIR}/main/players`, { recursive: true });
const slots = Array(36).fill(null);
slots[0] = { item: item("planks").id, count: 8 };
writeFileSync(`${process.env.SAVE_DIR}/main/players/pl_${name}.json`, JSON.stringify({ version: 1, id: `pl_${name}`, inventory: { slots, selected: 0 }, position: null }));

const mod = new Bot({ api: "-", game: GAME, name: modName, issueTicket: ticket(modName, ["player", "moderator"]) });
const bot = new Bot({ api: "-", game: GAME, name, issueTicket: ticket(name, ["player"]) });
const modes = [];
mod.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.mode" && (modes.push(m.payload), false), resolve() {} });
await mod.connect();
await bot.connect();
bot.requestChunks(1);
for (let i = 0; i < 100 && bot.chunks.size < 9; i++) await sleep(200);
const call = async (b, intent, payload) => {
  b.call(`platform.${intent}`, payload);
  const r = await b.result(intent);
  assert.equal(r.ok, true, `${intent}: ${JSON.stringify(r)}`);
  return r;
};
const refused = async (b, intent, payload, code) => {
  b.call(`platform.${intent}`, payload);
  const r = await b.result(intent);
  assert.equal(r.code, code, `${intent}: ${JSON.stringify(r)}`);
};

// Solid ground with air above.
const def = (v) => content.blocks.find((b) => b.id === v);
const standable = (v) => v !== 0 && v !== null && def(v)?.collision !== false && def(v)?.fluid == null;
let spot = null;
for (let x = -10; x < 20 && !spot; x++) for (let z = -10; z < 20 && !spot; z++) {
  const top = bot.surface(x, z, (v) => v !== 0 && v !== null);
  if (top !== null && standable(bot.voxel(x, top, z)) && def(bot.voxel(x, top, z))?.hardness >= 0 && bot.voxel(x + 1, top + 1, z) === 0 && bot.voxel(x, top + 1, z) === 0) spot = [x, top, z];
}
assert.ok(spot, "ground");
const [x, ground, z] = spot;
await bot.moveTo([x + 0.5, ground + 1 + EYE, z + 2.5], 8);
await sleep(5500);

await refused(bot, "mode.set", { mode: "spectator" }, "game_mode");
step("a survival player may not change their own mode");

await call(mod, "mode.set", { player: `pl_${name}`, mode: "adventure" });
const vitals = await bot.event("platform.vitals", (v) => v.mode === "adventure", 3000);
assert.equal(vitals.mode, "adventure");
for (let i = 0; i < 20 && !modes.some((m) => m.player === `pl_${name}` && m.mode === "adventure"); i++) await sleep(100);
assert.ok(modes.some((m) => m.mode === "adventure"), "announced to the world");
await refused(bot, "mine.start", { voxel: [x, ground, z] }, "game_mode");
await refused(bot, "build.place", { voxel: [x, ground + 1, z], slot: 0 }, "game_mode");
step("in adventure mode the player can neither mine nor place, and everyone was told");

await call(mod, "mode.set", { player: `pl_${name}`, mode: "spectator" });
await bot.event("platform.vitals", (v) => v.mode === "spectator", 3000);
await refused(bot, "eat", {}, "game_mode");
await refused(bot, "use", { voxel: [x, ground, z] }, "game_mode");
step("a spectator touches nothing");

await call(mod, "mode.set", { player: `pl_${name}`, mode: "normal" });
await bot.event("platform.vitals", (v) => v.mode === "normal", 3000);
await call(bot, "build.place", { voxel: [x, ground + 1, z], slot: 0 });
step("back in normal mode the player builds again");

mod.close();
bot.close();
console.log("modes: all checks passed");
process.exit(0);
