// Blueprints end to end: a creator builds and captures a small structure,
// publishes it; a buyer buys a licence through the API and builds it in
// the game from their own planks; building again without materials is
// refused; the creator is paid minus the fee.
//
// Standalone only (starting planks are written into the players' records):
//   SAVE_DIR=... FUND_CMD='php artisan economy:grant {player} {player} 100 --reason=t' \
//     node blueprints.mjs <api base> <game base>

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

import { api, Bot, registerPlayer } from "./bot.mjs";

const API = process.argv[2] ?? "http://127.0.0.1:8080";
const GAME = process.argv[3] ?? API;
assert.ok(process.env.FUND_CMD && process.env.SAVE_DIR, "FUND_CMD and SAVE_DIR");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);
const content = await (await fetch(`${GAME}/platform/content`)).json();
const item = (key) => content.items.find((i) => i.key === key);
const block = (key) => content.blocks.find((b) => b.key === key);
const EYE = 1.425;

const stamp = Date.now().toString(36).slice(-5);
const names = { maker: `mk_${stamp}`, buyer: `bb_${stamp}` };
const tokens = { maker: await registerPlayer(API, names.maker), buyer: await registerPlayer(API, names.buyer) };
execSync(process.env.FUND_CMD.replaceAll("{player}", names.buyer), { stdio: "inherit", shell: "/bin/sh" });
const crowns = async (who) => (await api(API, "/wallets", { token: tokens[who] })).wallets.find((w) => w.currency === "CRN")?.balance ?? 0;

const seed = async (who, planks) => {
  const id = (await api(API, "/me", { token: tokens[who] })).user.id;
  const slots = Array(36).fill(null);
  slots[0] = { item: item("planks").id, count: planks };
  mkdirSync(`${process.env.SAVE_DIR}/main/players`, { recursive: true });
  writeFileSync(`${process.env.SAVE_DIR}/main/players/${id}.json`, JSON.stringify({ version: 1, id, inventory: { slots, selected: 0 }, position: null }));
};
await seed("maker", 3);
await seed("buyer", 3);

const connect = async (who) => {
  const bot = new Bot({ api: API, game: GAME, token: tokens[who], name: names[who] });
  await bot.connect();
  bot.requestChunks(1);
  for (let i = 0; i < 100 && bot.chunks.size < 9; i++) await sleep(200);
  return bot;
};
const maker = await connect("maker");
const buyer = await connect("buyer");
const call = async (bot, intent, payload) => {
  bot.call(`platform.${intent}`, payload);
  const r = await bot.result(intent);
  assert.equal(r.ok, true, `${intent}: ${JSON.stringify(r)}`);
  return r;
};
const ground = (bot, x, z) => bot.surface(x, z, (v) => v !== 0 && v !== block("water").id) + 1;

// The maker builds an L of three planks and captures it.
const [mx, mz] = [-4, 6];
const my = ground(maker, mx, mz);
await maker.moveTo([mx + 3.5, my + EYE, mz + 3.5], 4);
await buyer.moveTo([mx - 8.5, my + EYE, mz + 3.5], 4);
await sleep(5500);
for (const p of [[mx, my, mz], [mx + 1, my, mz], [mx, my + 1, mz]]) await call(maker, "build.place", { voxel: p, slot: 0 });
const stored = maker.event("platform.market", (n) => n.blueprint?.stored, 15000);
const cap = await call(maker, "blueprint.capture", { min: [mx, my, mz], max: [mx + 1, my + 1, mz], name: "Tiny L" });
assert.equal(cap.blocks, 3);
const { blueprint } = await stored;
step(`captured a 2×2×1 blueprint of 3 planks (${blueprint.stored})`);

await api(API, `/blueprints/${blueprint.stored}`, { token: tokens.maker, method: "PATCH", body: { price: 20, published: true } });
const before = await crowns("buyer");
await api(API, `/blueprints/${blueprint.stored}/buy`, { token: tokens.buyer, body: {} });
assert.equal(await crowns("buyer"), before - 20);
assert.equal(await crowns("maker"), 19, "20 minus the 1 Crown fee");
step("published at 20 CRN; the buyer bought a licence, the maker got 19");

// The buyer builds it beside them from their own planks.
const [bx, bz] = [mx - 9, mz + 6];
const by = ground(buyer, bx, bz);
const built = buyer.event("platform.market", (n) => n.blueprint?.built || n.blueprint?.refused, 20000);
await call(buyer, "blueprint.build", { id: blueprint.stored, at: [bx, by, bz] });
const result = await built;
assert.equal(result.blueprint.built, blueprint.stored, `built: ${JSON.stringify(result)}`);
await sleep(500);
assert.equal(buyer.voxel(bx, by, bz), block("planks").id);
assert.equal(buyer.voxel(bx + 1, by, bz), block("planks").id);
assert.equal(buyer.voxel(bx, by + 1, bz), block("planks").id);
assert.equal(buyer.count(item("planks").id), 0, "the materials were used");
step("the buyer built it from 3 of their own planks");

const again = buyer.event("platform.market", (n) => n.blueprint?.refused, 20000);
await call(buyer, "blueprint.build", { id: blueprint.stored, at: [bx + 4, by, bz] });
assert.equal((await again).blueprint.refused, "missing_ingredients");
step("building again without materials is refused");

maker.close();
buyer.close();
console.log("blueprints: all checks passed");
process.exit(0);
