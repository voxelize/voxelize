// Trade stalls end to end: an owner places a stall, stocks and prices it;
// a buyer pays through the ledger and receives the goods; an unaffordable
// purchase is refused and the goods go back on sale; a stranger cannot
// break the stall.
//
// Standalone only: the owner's starting goods are written into their
// player record before they join (SAVE_DIR is the game server's
// GAME_SAVE_DIR).
//   SAVE_DIR=... FUND_CMD='php artisan economy:grant {player} {player} 50 --reason=t' \
//     node stall.mjs <api base> <game base>

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
const names = { owner: `ow_${stamp}`, buyer: `by_${stamp}` };
const tokens = { owner: await registerPlayer(API, names.owner), buyer: await registerPlayer(API, names.buyer) };
execSync(process.env.FUND_CMD.replaceAll("{player}", names.buyer), { stdio: "inherit", shell: "/bin/sh" });
const crowns = async (who) => (await api(API, "/wallets", { token: tokens[who] })).wallets.find((w) => w.currency === "CRN")?.balance ?? 0;

// Seed the owner: a stall, 5 iron ingots and 3 bread.
const ownerId = (await api(API, "/me", { token: tokens.owner })).user.id;
const slots = Array(36).fill(null);
slots[0] = { item: item("trade_stall").id, count: 1 };
slots[1] = { item: item("iron_ingot").id, count: 5 };
slots[2] = { item: item("bread").id, count: 3 };
mkdirSync(`${process.env.SAVE_DIR}/main/players`, { recursive: true });
writeFileSync(`${process.env.SAVE_DIR}/main/players/${ownerId}.json`, JSON.stringify({ version: 1, id: ownerId, inventory: { slots, selected: 0 }, position: null }));

const connect = async (who) => {
  const bot = new Bot({ api: API, game: GAME, token: tokens[who], name: names[who] });
  await bot.connect();
  bot.requestChunks(1);
  for (let i = 0; i < 100 && bot.chunks.size < 9; i++) await sleep(200);
  return bot;
};
const owner = await connect("owner");
const buyer = await connect("buyer");
assert.equal(owner.count(item("iron_ingot").id), 5, "seeded goods");

// A spot near spawn: ground with air above.
const [x, z] = [3, -6];
const y = owner.surface(x, z, (v) => block("water").id !== v && v !== 0) + 1;
await owner.moveTo([x + 2.5, y + EYE, z + 0.5], 4);
await buyer.moveTo([x - 1.5, y + EYE, z + 0.5], 4);
await sleep(5500);
const call = async (bot, intent, payload) => {
  bot.call(`platform.${intent}`, payload);
  const r = await bot.result(intent);
  assert.equal(r.ok, true, `${intent}: ${JSON.stringify(r)}`);
  return r;
};
const at = [x, y, z];
await call(owner, "build.place", { voxel: at, slot: 0 });
step("the owner placed a trade stall");

// Stock it through its window and price the iron.
const ownView = owner.event("platform.stall", (v) => v.mine, 8000);
owner.call("platform.window.open", { voxel: at });
const w = await owner.event("platform.window", (p) => p.kind === "chest", 8000);
await ownView;
// Clicks answer with the updated window.
const click = async (slot, until) => {
  const next = owner.event("platform.window", until, 8000);
  owner.call("platform.window.click", { slot, click: { type: "left" } });
  return next;
};
await click(w.inventoryStart + 1, (p) => p.cursor); // pick up the iron
await click(0, (p) => p.slots[0] && !p.cursor); // into the stall's first slot
await click(w.inventoryStart + 2, (p) => p.cursor); // the bread
await click(1, (p) => p.slots[1] && !p.cursor);
owner.call("platform.window.close", {});
await sleep(300);
await call(owner, "stall.price", { at, slot: 0, price: 9 });
await call(owner, "stall.price", { at, slot: 1, price: 100000 });
step("stocked 5 iron (9 CRN) and 3 bread (100000 CRN)");

// The buyer sees the offers and buys the iron.
const offers = buyer.event("platform.stall", (v) => !v.mine && v.offers.length === 2, 8000);
await call(buyer, "window.open", { voxel: at });
const view = await offers;
assert.equal(view.owner.name, names.owner);
const before = await crowns("buyer");
const bought = buyer.event("platform.market", (n) => n.bought, 20000);
const sold = owner.event("platform.market", (n) => n.sold, 20000);
await call(buyer, "stall.buy", { at, slot: 0 });
await bought;
await sold;
assert.equal(buyer.count(item("iron_ingot").id), 5);
assert.equal(await crowns("buyer"), before - 9);
assert.equal(await crowns("owner"), 9);
step("the buyer paid 9 CRN through the ledger and received the iron");

// Too dear: refused, and the bread goes back on sale.
const refused = buyer.event("platform.market", (n) => n.refused, 20000);
await call(buyer, "stall.buy", { at, slot: 1 });
const r = await refused;
assert.equal(r.refused.code, "insufficient_funds");
const after = buyer.event("platform.stall", (v) => v.offers.some((o) => o.item === "bread"), 8000);
await call(buyer, "window.open", { voxel: at });
await after;
assert.equal(buyer.count(item("bread").id), 0);
step("an unaffordable purchase was refused and the bread is back on sale");

buyer.call("platform.mine.start", { voxel: at });
assert.equal((await buyer.result("mine.start")).code, "not_owner");
step("a stranger cannot break the stall");

owner.close();
buyer.close();
console.log("stall: all checks passed");
process.exit(0);
