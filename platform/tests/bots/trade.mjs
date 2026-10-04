// The trade window end to end: two players next to each other trade iron
// for bread plus Crowns (moved through the ledger, no fee); a second trade
// is cancelled and the offered items come back.
//
// Standalone only (starting goods are written into the players' records):
//   SAVE_DIR=... FUND_CMD='php artisan economy:grant {player} {player} 100 --reason=t' \
//     node trade.mjs <api base> <game base>

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
const EYE = 1.425;

const stamp = Date.now().toString(36).slice(-5);
const names = { a: `ta_${stamp}`, b: `tb_${stamp}` };
const tokens = { a: await registerPlayer(API, names.a), b: await registerPlayer(API, names.b) };
execSync(process.env.FUND_CMD.replaceAll("{player}", names.b), { stdio: "inherit", shell: "/bin/sh" });
const crowns = async (who) => (await api(API, "/wallets", { token: tokens[who] })).wallets.find((w) => w.currency === "CRN")?.balance ?? 0;
const ids = {};
for (const [who, key, count] of [["a", "iron_ingot", 10], ["b", "bread", 4]]) {
  ids[who] = (await api(API, "/me", { token: tokens[who] })).user.id;
  const slots = Array(36).fill(null);
  slots[0] = { item: item(key).id, count };
  mkdirSync(`${process.env.SAVE_DIR}/main/players`, { recursive: true });
  writeFileSync(`${process.env.SAVE_DIR}/main/players/${ids[who]}.json`, JSON.stringify({ version: 1, id: ids[who], inventory: { slots, selected: 0 }, position: null }));
}
const connect = async (who) => {
  const bot = new Bot({ api: API, game: GAME, token: tokens[who], name: names[who] });
  await bot.connect();
  bot.requestChunks(1);
  for (let i = 0; i < 100 && bot.chunks.size < 9; i++) await sleep(200);
  return bot;
};
const a = await connect("a");
const b = await connect("b");
await a.moveTo([2.5, 90 + EYE, 2.5], 4);
await b.moveTo([4.5, 90 + EYE, 2.5], 4);
await sleep(1500);
const call = async (bot, intent, payload = {}) => {
  bot.call(`platform.${intent}`, payload);
  const r = await bot.result(intent);
  assert.equal(r.ok, true, `${intent}: ${JSON.stringify(r)}`);
  return r;
};
const keepClose = setInterval(() => {
  a.moveTo([2.5, 90 + EYE, 2.5]);
  b.moveTo([4.5, 90 + EYE, 2.5]);
}, 500);

const invited = b.event("platform.trade", (e) => e.invite, 8000);
await call(a, "trade.request", { player: ids.b });
assert.equal((await invited).invite.from, ids.a);
const opened = a.event("platform.trade", (e) => e.trade, 8000);
await call(b, "trade.accept", { player: ids.a });
await opened;
step("a trade window opened between two nearby players");

await call(a, "trade.offer", { items: [{ slot: 0, count: 6 }], crowns: 0 });
await sleep(200);
assert.equal(a.count(item("iron_ingot").id), 4, "offered items leave the inventory");
const seen = a.event("platform.trade", (e) => e.trade?.theirs.crowns === 25, 8000);
await call(b, "trade.offer", { items: [{ slot: 0, count: 4 }], crowns: 25 });
await seen;
const doneA = a.event("platform.trade", (e) => e.ended === "done", 20000);
const doneB = b.event("platform.trade", (e) => e.ended === "done", 20000);
await call(a, "trade.confirm");
await call(b, "trade.confirm");
await doneA;
await doneB;
for (let i = 0; i < 40 && (a.count(item("bread").id) < 4 || b.count(item("iron_ingot").id) < 6); i++) await sleep(250);
assert.equal(a.count(item("bread").id), 4);
assert.equal(b.count(item("iron_ingot").id), 6);
assert.equal(await crowns("a"), 25, "no fee on trades");
assert.equal(await crowns("b"), 75);
step("6 iron for 4 bread + 25 CRN: goods swapped, Crowns moved without fee");

const invited2 = b.event("platform.trade", (e) => e.invite, 8000);
await call(a, "trade.request", { player: ids.b });
await invited2;
const opened2 = a.event("platform.trade", (e) => e.trade, 8000);
await call(b, "trade.accept", { player: ids.a });
await opened2;
await call(a, "trade.offer", { items: [{ slot: a.slotOf(item("iron_ingot").id), count: 3 }] });
await sleep(200);
assert.equal(a.count(item("iron_ingot").id), 1);
await call(b, "trade.cancel");
for (let i = 0; i < 40 && a.count(item("iron_ingot").id) < 4; i++) await sleep(250);
assert.equal(a.count(item("iron_ingot").id), 4, "the offer came back");
step("a cancelled trade gave the offered iron back");

clearInterval(keepClose);
a.close();
b.close();
console.log("trade: all checks passed");
process.exit(0);
