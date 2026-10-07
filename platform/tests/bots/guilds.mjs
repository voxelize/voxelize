// Guilds end to end: a leader founds a guild, a member joins, the treasury
// pays for touching guild land that becomes a village; the game server
// names the village on entry, lets the member build there and keeps a
// stranger out; the member's stall sells for the guild treasury; guild
// chat reaches the member; a guild contract is paid from the treasury and
// fulfilled in the game.
//
// Standalone only (starting goods are written into player records):
//   SAVE_DIR=... FUND_CMD='php artisan economy:grant {player} {player} 2000 --reason=t' \
//     node guilds.mjs <api base> <game base>

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

import { api, Bot, registerPlayer } from "./bot.mjs";

const API = process.argv[2] ?? "http://127.0.0.1:8080";
const GAME = process.argv[3] ?? API;
assert.ok(process.env.FUND_CMD && process.env.SAVE_DIR, "FUND_CMD and SAVE_DIR");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);
const key = () => randomUUID().replace(/-/g, "");
const content = await (await fetch(`${GAME}/platform/content`)).json();
const item = (k) => content.items.find((i) => i.key === k);
const block = (k) => content.blocks.find((b) => b.key === k);
const EYE = 1.425;

const stamp = Date.now().toString(36).slice(-5);
const names = { leader: `gl_${stamp}`, member: `gm_${stamp}`, stranger: `gs_${stamp}` };
const tokens = {};
for (const [who, name] of Object.entries(names)) tokens[who] = await registerPlayer(API, name);
for (const who of ["leader", "stranger"]) execSync(process.env.FUND_CMD.replaceAll("{player}", names[who]), { stdio: "inherit", shell: "/bin/sh" });
const as = (who) => (path, opts = {}) => api(API, path, { token: tokens[who], ...opts });
const crowns = async (who) => (await as(who)("/wallets")).wallets.find((w) => w.currency === "CRN")?.balance ?? 0;
const ids = {};
for (const who of Object.keys(names)) ids[who] = (await as(who)("/me")).user.id;

// Starting goods: the member brings a stall and bread, the stranger iron.
const seed = (who, slots) => {
  const all = Array(36).fill(null);
  slots.forEach((s, i) => (all[i] = s));
  mkdirSync(`${process.env.SAVE_DIR}/main/players`, { recursive: true });
  writeFileSync(`${process.env.SAVE_DIR}/main/players/${ids[who]}.json`, JSON.stringify({ version: 1, id: ids[who], inventory: { slots: all, selected: 0 }, position: null }));
};
seed("member", [{ item: item("trade_stall").id, count: 1 }, { item: item("bread").id, count: 3 }]);
seed("stranger", [{ item: item("iron_ingot").id, count: 4 }]);

// The guild.
const { guild } = await as("leader")("/guilds", { headers: { "Idempotency-Key": key() }, body: { name: `Wardens ${stamp}`, tag: stamp.slice(0, 4).toUpperCase() } });
await as("leader")(`/guilds/${guild.id}/invites`, { body: { player: names.member } });
await as("member")(`/guilds/${guild.id}/join`, { body: {} });
await as("leader")(`/guilds/${guild.id}/deposit`, { headers: { "Idempotency-Key": key() }, body: { amount: 1000 } });
const treasury = async () => (await as("leader")(`/guilds/${guild.id}`)).guild.treasury;
assert.equal(await treasury(), 1000);
step(`founded [${guild.tag}], the member joined, 1000 CRN in the treasury`);

// Bots, and a spot near spawn.
const connect = async (who) => {
  const bot = new Bot({ api: API, game: GAME, token: tokens[who], name: names[who] });
  await bot.connect();
  bot.requestChunks(1);
  for (let i = 0; i < 100 && bot.chunks.size < 9; i++) await sleep(200);
  return bot;
};
const member = await connect("member");
const stranger = await connect("stranger");
// Solid ground with two free cells above, near spawn, away from the chunk edge.
const solid = (v) => { const d = content.blocks.find((b) => b.id === v); return !!d && d.collision !== false && d.fluid == null; };
let spot = null;
for (let x = 3; x < 12 && !spot; x++)
  for (let z = -10; z < -3 && !spot; z++) {
    const top = member.surface(x, z, (v) => v !== 0 && v !== null);
    if (top !== null && solid(member.voxel(x, top, z)) && solid(member.voxel(x, top, z + 1)) && member.voxel(x, top + 1, z) === 0 && member.voxel(x, top + 2, z) === 0) spot = [x, top, z];
  }
assert.ok(spot, "open ground near spawn");
const [x, ground, z] = spot;
const y = ground + 1;
const [cx, cz] = [Math.floor(x / 16), Math.floor(z / 16)];

// Two touching 2x1 plots around it: one 4-chunk village, paid by the treasury.
const claim = (min, max) =>
  as("leader")("/lands", { headers: { "Idempotency-Key": key() }, body: { world: "main", dimension: "overworld", min, max, name: "Hall", guild: guild.id } });
await claim([cx - 1, cz], [cx, cz]);
await claim([cx - 1, cz + 1], [cx, cz + 1]);
const detail = (await as("leader")(`/guilds/${guild.id}`)).guild;
assert.equal(detail.settlement_level, "village");
assert.equal(detail.treasury, 1000 - 4 * 50);
assert.equal(await crowns("leader"), 2000 - 100 - 1000, "the leader paid only the fee and the deposit");
step("two touching guild plots, paid from the treasury, make a village");

// Walking in: the game server names the village (the land feed polls every second).
const notice = member.event("platform.land", (e) => e.land?.settlement?.level === "village", 20000);
await member.moveTo([x + 2.5, y + EYE, z + 0.5], 4);
const { land } = await notice;
assert.equal(land.guild.tag, guild.tag);
assert.equal(land.role, "builder");
await stranger.moveTo([x - 1.5, y + EYE, z + 0.5], 4);
await sleep(5500);
step(`entering: "the village of ${land.settlement.name}", the member builds there`);

const call = async (bot, intent, payload) => {
  bot.call(`platform.${intent}`, payload);
  const r = await bot.result(intent);
  assert.equal(r.ok, true, `${intent}: ${JSON.stringify(r)}`);
  return r;
};
stranger.call("platform.mine.start", { voxel: [x, ground, z + 1] });
assert.equal((await stranger.result("mine.start")).code, "land_protected");
step("a stranger cannot dig in the village");

// The member's stall sells for the guild.
const at = [x, y, z];
await call(member, "build.place", { voxel: at, slot: 0 });
for (let i = 0; i < 50 && member.voxel(...at) !== block("trade_stall").id; i++) await sleep(100);
const ownView = member.event("platform.stall", (v) => v.mine, 8000);
member.call("platform.window.open", { voxel: at });
const w = await member.event("platform.window", (p) => p.kind === "chest", 8000);
await ownView;
const click = async (slot, until) => {
  const next = member.event("platform.window", until, 8000);
  member.call("platform.window.click", { slot, click: { type: "left" } });
  return next;
};
await click(w.inventoryStart + 1, (p) => p.cursor);
await click(0, (p) => p.slots[0] && !p.cursor);
member.call("platform.window.close", {});
await sleep(300);
await call(member, "stall.price", { at, slot: 0, price: 40 });
const guildView = member.event("platform.stall", (v) => v.mine && v.guild === true, 8000);
await call(member, "stall.guild", { at, guild: true });
await guildView;
step("the member stocked bread at 40 CRN and set the stall to sell for the guild");

const before = { treasury: await treasury(), member: await crowns("member"), stranger: await crowns("stranger") };
const bought = stranger.event("platform.market", (n) => n.bought, 20000);
await call(stranger, "window.open", { voxel: at });
await call(stranger, "stall.buy", { at, slot: 0 });
await bought;
assert.equal(stranger.count(item("bread").id), 3);
assert.equal(await crowns("stranger"), before.stranger - 40);
assert.equal(await crowns("member"), before.member, "the seller keeps nothing");
const gained = (await treasury()) - before.treasury;
assert.ok(gained > 35 && gained <= 40, `the treasury gained the price less the fee: ${gained}`);
step(`a stranger bought the bread: ${gained} CRN reached the treasury`);

// Guild chat.
await as("leader")(`/guilds/${guild.id}/messages`, { body: { body: "Bring iron to the hall" } });
const chat = (await as("member")(`/guilds/${guild.id}/messages`)).messages;
assert.equal(chat.at(-1).body, "Bring iron to the hall");
assert.equal(chat.at(-1).from.name, names.leader);
await assert.rejects(as("stranger")(`/guilds/${guild.id}/messages`));
step("guild chat reaches members and only members");

// A guild contract paid from the treasury, fulfilled in the game.
const t0 = await treasury();
const { contract } = await as("leader")("/contracts", {
  headers: { "Idempotency-Key": key() },
  body: { world: "main", title: "Iron for the hall", item: "iron_ingot", count: 4, reward: 60, hours: 2, guild: guild.id },
});
assert.equal(await treasury(), t0 - 60);
await as("stranger")(`/contracts/${contract.id}/accept`, { body: {} });
const s0 = await crowns("stranger");
const fulfilled = stranger.event("platform.market", (n) => n.fulfilled, 20000);
await call(stranger, "contract.deliver", { contract: contract.id, slot: 0, count: 4 });
await fulfilled;
assert.equal(await crowns("stranger"), s0 + 60);
assert.equal(await treasury(), t0 - 60);
step("a guild contract locked 60 CRN from the treasury and paid the stranger for the iron");

member.close();
stranger.close();
console.log("guilds: all checks passed");
process.exit(0);
