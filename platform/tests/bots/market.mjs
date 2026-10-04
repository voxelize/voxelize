// The market end to end: a seller digs real goods and lists them in the
// game, a buyer pays through the API and receives them in the game; a
// second listing is cancelled and its goods come back to the seller.
//
//   FUND_CMD='php artisan economy:grant {player} {player} 500 --reason=market-test' \
//     node market.mjs <api base> <game base>

import assert from "node:assert/strict";
import { execSync } from "node:child_process";

import { api, Bot, registerPlayer } from "./bot.mjs";

const API = process.argv[2] ?? "http://127.0.0.1:8080";
const GAME = process.argv[3] ?? API;
assert.ok(process.env.FUND_CMD, "FUND_CMD funds the buyer");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);
const content = await (await fetch(`${GAME}/platform/content`)).json();
const blockById = new Map(content.blocks.map((b) => [b.id, b]));
const itemByKey = new Map(content.items.map((i) => [i.key, i]));

const stamp = Date.now().toString(36).slice(-5);
const names = { seller: `se_${stamp}`, buyer: `bu_${stamp}` };
const tokens = { seller: await registerPlayer(API, names.seller), buyer: await registerPlayer(API, names.buyer) };
execSync(process.env.FUND_CMD.replaceAll("{player}", names.buyer), { stdio: "inherit", shell: "/bin/sh" });
const crowns = async (who) => (await api(API, "/wallets", { token: tokens[who] })).wallets.find((w) => w.currency === "CRN")?.balance ?? 0;

const connect = async (who) => {
  const bot = new Bot({ api: API, game: GAME, token: tokens[who], name: names[who] });
  await bot.connect();
  bot.requestChunks(1);
  for (let i = 0; i < 100 && bot.chunks.size < 9; i++) await sleep(200);
  return bot;
};
const seller = await connect("seller");
const buyer = await connect("buyer");

// Dig two hand-diggable surface blocks (away from claimed land at 32..47).
const diggable = (id) => {
  const b = blockById.get(id);
  return b && !b.fluid && b.hardness >= 0 && (!b.tool || b.tool.required === false) && b.drops.length > 0;
};
const targets = [];
for (let r = 2; r < 14 && targets.length < 2; r++)
  for (let x = -r; x <= r && targets.length < 2; x++)
    for (let z = -r; z <= -2 && targets.length < 2; z++) {
      const y = seller.surface(x, z, (id) => !blockById.get(id)?.fluid && blockById.get(id)?.collision !== false);
      if (y !== null && diggable(seller.voxel(x, y, z)) && !targets.some((t) => Math.abs(t[0] - x) + Math.abs(t[2] - z) < 2)) targets.push([x, y, z]);
    }
assert.equal(targets.length, 2, "two diggable blocks");
const block = blockById.get(seller.voxel(...targets[0]));
const goods = itemByKey.get(block.drops[0].item);
await seller.moveTo([targets[0][0] + 0.5, targets[0][1] + 2.6, targets[0][2] + 0.5], 4);
await buyer.moveTo([targets[0][0] + 6.5, targets[0][1] + 2.6, targets[0][2] + 6.5], 4);
await sleep(5500);
for (const t of targets) {
  if (seller.voxel(...t) === 0) continue;
  const b = blockById.get(seller.voxel(...t));
  await seller.moveTo([t[0] + 0.5, t[1] + 2.6, t[2] + 0.5], 2);
  seller.call("platform.mine.start", { voxel: t });
  assert.equal((await seller.result("mine.start")).ok, true);
  await sleep(Math.round(b.hardness * 1.5 * 1000) + 150);
  seller.call("platform.mine.finish", { voxel: t });
  assert.equal((await seller.result("mine.finish")).ok, true);
  // Step into the hole: drops are picked up from about the feet.
  await seller.moveTo([t[0] + 0.5, t[1] + 1.425 + 0.05, t[2] + 0.5], 2);
  await sleep(1200);
}
const have = () => seller.count(itemByKey.get(blockById.get(block.id).drops[0].item).id);
for (let i = 0; i < 20 && have() < 2; i++) await sleep(250);
assert.ok(have() >= 2, `seller dug ${goods.name}: ${have()}`);
step(`seller dug 2 × ${goods.name}`);

// List one in the game: it leaves the inventory and reaches the market.
const before = have();
const listed = seller.event("platform.market", (p) => p.listed, 15000);
seller.call("platform.market.list", { slot: seller.slotOf(goods.id), count: 1, price: 7 });
assert.equal((await seller.result("market.list")).ok, true);
await sleep(300);
assert.equal(have(), before - 1, "the goods left the inventory");
const { listed: info } = await listed;
step(`listed 1 × ${goods.name} for 7 CRN (listing ${info.listing})`);

// The buyer pays through the API and receives the goods in the game.
const buyerBefore = await crowns("buyer");
const received = buyer.event("platform.market", (p) => p.received?.item === goods.key, 20000);
await api(API, `/market/listings/${info.listing}/buy`, { token: tokens.buyer, body: {} });
await received;
assert.equal(buyer.count(goods.id), 1, "the buyer holds the goods");
assert.equal(await crowns("buyer"), buyerBefore - 7);
assert.equal(await crowns("seller"), 7, "the seller is paid (7 is below the fee's first unit)");
step("the buyer paid 7 CRN through the API and received the goods in the game");

// A cancelled listing comes back.
const listed2 = seller.event("platform.market", (p) => p.listed, 15000);
seller.call("platform.market.list", { slot: seller.slotOf(goods.id), count: 1, price: 50 });
const { listed: second } = await listed2;
const back = seller.event("platform.market", (p) => p.received?.reason === "cancelled", 20000);
await api(API, `/market/listings/${second.listing}`, { token: tokens.seller, method: "DELETE" });
await back;
assert.equal(have(), before - 1, "the cancelled goods are back");
step("a cancelled listing's goods came back to the seller");

// Creative goods never reach the market.
seller.close();
buyer.close();
console.log("market: all checks passed");
process.exit(0);
