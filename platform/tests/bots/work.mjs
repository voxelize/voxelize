// Jobs and quests end to end: a player takes up the smith's job, forges an
// iron pickaxe at a workbench, and the game server has the backend pay the
// job's Crowns into their wallet (minted, within the daily cap); today's
// quests are listed. Needs the backend and SAVE_DIR (starting materials
// are written into the player's record):
//
//   SAVE_DIR=... node work.mjs <api base> <game base>

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

import { api, Bot, registerPlayer } from "./bot.mjs";

const API = process.argv[2] ?? "http://127.0.0.1:8080";
const GAME = process.argv[3] ?? API;
assert.ok(process.env.SAVE_DIR, "SAVE_DIR");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);
const content = await (await fetch(`${GAME}/platform/content`)).json();
const item = (key) => content.items.find((i) => i.key === key);
const EYE = 1.425;

const name = `sm_${Date.now().toString(36).slice(-6)}`;
const token = await registerPlayer(API, name);
const id = (await api(API, "/me", { token })).user.id;
const slots = Array(36).fill(null);
slots[0] = { item: item("crafting_table").id, count: 1 };
slots[1] = { item: item("iron_ingot").id, count: 3 };
slots[2] = { item: item("stick").id, count: 2 };
mkdirSync(`${process.env.SAVE_DIR}/main/players`, { recursive: true });
writeFileSync(`${process.env.SAVE_DIR}/main/players/${id}.json`, JSON.stringify({ version: 1, id, inventory: { slots, selected: 0 }, position: null }));

const bot = new Bot({ api: API, game: GAME, token, name });
const works = [];
bot.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.work" && (works.push(m.payload), false), resolve() {} });
await bot.connect();
bot.requestChunks(1);
for (let i = 0; i < 100 && bot.chunks.size < 9; i++) await sleep(200);
const call = async (intent, payload) => {
  bot.call(`platform.${intent}`, payload);
  const r = await bot.result(intent);
  assert.equal(r.ok, true, `${intent}: ${JSON.stringify(r)}`);
  return r;
};

const quests = await call("quests.get", {});
assert.equal(quests.quests.length, 3, "three quests a day");
step(`today's quests: ${quests.quests.map((q) => q.name).join(", ")}`);

const job = await call("job.set", { job: "smith" });
assert.equal(job.job, "smith");
step("took up the smith's job");

// A workbench beside the player, then the pickaxe.
const def = (v) => content.blocks.find((b) => b.id === v);
let spot = null;
for (let x = -14; x < 30 && !spot; x++) for (let z = -14; z < 30 && !spot; z++) {
  const top = bot.surface(x, z, (v) => v !== 0 && def(v)?.collision !== false && def(v)?.fluid == null);
  if (top !== null && bot.voxel(x, top + 1, z) === 0 && bot.voxel(x, top + 2, z) === 0 && bot.voxel(x + 2, top + 1, z) === 0) spot = [x, top, z];
}
assert.ok(spot, "ground");
await bot.moveTo([spot[0] + 2.5, spot[1] + 1 + EYE, spot[2] + 0.5], 6);
await sleep(5500);
await call("build.place", { voxel: [spot[0], spot[1] + 1, spot[2]], slot: 0 });
await sleep(500);
const paid = bot.event("platform.market", (n) => n.reward?.source === "job", 60000);
await call("craft", { grid: [["iron_ingot", "iron_ingot", "iron_ingot"], [null, "stick", null], [null, "stick", null]] });
assert.equal(bot.count(item("iron_pickaxe").id), 1, "forged");
const { reward } = await paid;
assert.equal(reward.paid, 2, `the smith is paid 2 Crowns for an iron pickaxe: ${JSON.stringify(reward)}`);
const wallet = (await api(API, "/wallets", { token })).wallets.find((w) => w.currency === "CRN");
assert.equal(wallet.balance, 2, "the Crowns are in the wallet");
step("forging an iron pickaxe paid the smith 2 Crowns into their wallet");

bot.close();
console.log("work: all checks passed");
process.exit(0);
