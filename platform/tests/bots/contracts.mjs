// Contracts end to end: a poster locks a reward for 4 iron ingots; a worker
// takes the contract and delivers the ingots in the game; the reward
// reaches the worker and the ingots reach the poster in the game.
//
// Standalone only (the worker's ingots are written into their record):
//   SAVE_DIR=... FUND_CMD='php artisan economy:grant {player} {player} 100 --reason=t' \
//     node contracts.mjs <api base> <game base>

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { api, Bot, registerPlayer } from "./bot.mjs";

const API = process.argv[2] ?? "http://127.0.0.1:8080";
const GAME = process.argv[3] ?? API;
assert.ok(process.env.FUND_CMD && process.env.SAVE_DIR, "FUND_CMD and SAVE_DIR");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);
const content = await (await fetch(`${GAME}/platform/content`)).json();
const iron = content.items.find((i) => i.key === "iron_ingot");

const stamp = Date.now().toString(36).slice(-5);
const names = { poster: `cp_${stamp}`, worker: `cw_${stamp}` };
const tokens = { poster: await registerPlayer(API, names.poster), worker: await registerPlayer(API, names.worker) };
execSync(process.env.FUND_CMD.replaceAll("{player}", names.poster), { stdio: "inherit", shell: "/bin/sh" });
const crowns = async (who) => (await api(API, "/wallets", { token: tokens[who] })).wallets.find((w) => w.currency === "CRN")?.balance ?? 0;
const workerId = (await api(API, "/me", { token: tokens.worker })).user.id;
const slots = Array(36).fill(null);
slots[0] = { item: iron.id, count: 4 };
mkdirSync(`${process.env.SAVE_DIR}/main/players`, { recursive: true });
writeFileSync(`${process.env.SAVE_DIR}/main/players/${workerId}.json`, JSON.stringify({ version: 1, id: workerId, inventory: { slots, selected: 0 }, position: null }));

const { contract } = await api(API, "/contracts", {
  token: tokens.poster,
  headers: { "Idempotency-Key": randomUUID().replace(/-/g, "") },
  body: { world: "main", title: "Iron for the forge", item: "iron_ingot", count: 4, reward: 30, hours: 2 },
});
assert.equal(await crowns("poster"), 70, "the reward is locked");
step("posted a contract for 4 iron ingots with 30 CRN locked");
await api(API, `/contracts/${contract.id}/accept`, { token: tokens.worker, body: {} });
step("the worker took it");

const connect = async (who) => {
  const bot = new Bot({ api: API, game: GAME, token: tokens[who], name: names[who] });
  await bot.connect();
  bot.requestChunks(1);
  for (let i = 0; i < 100 && bot.chunks.size < 9; i++) await sleep(200);
  return bot;
};
const poster = await connect("poster");
const worker = await connect("worker");
const received = poster.event("platform.market", (n) => n.received?.reason === "contract", 25000);
const fulfilled = worker.event("platform.market", (n) => n.fulfilled, 20000);
worker.call("platform.contract.deliver", { contract: contract.id, slot: 0, count: 4 });
const r = await worker.result("contract.deliver");
assert.equal(r.ok, true, JSON.stringify(r));
await fulfilled;
assert.equal(worker.count(iron.id), 0);
assert.equal(await crowns("worker"), 30);
step("the worker delivered the ingots in the game and was paid 30 CRN");
await received;
assert.equal(poster.count(iron.id), 4);
step("the ingots reached the poster in the game");

poster.close();
worker.close();
console.log("contracts: all checks passed");
process.exit(0);
