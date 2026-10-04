// Land ownership end to end: a player pays for a claim through the API,
// the game server picks it up from the backend's internal feed and refuses
// a stranger's digging there until the owner makes them a builder.
//
//   FUND_CMD='php artisan economy:grant {player} {player} 500 --reason=land-test' \
//     node land.mjs <api base> <game base>
//
// FUND_CMD gives the new player currency ({player} is replaced; with
// docker: `docker compose exec -T api php artisan economy:grant …`).

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { api, Bot, registerPlayer } from "./bot.mjs";

const API = process.argv[2] ?? "http://127.0.0.1:8080";
const GAME = process.argv[3] ?? API;
assert.ok(process.env.FUND_CMD, "FUND_CMD funds the claiming player");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);
const EYE = 1.425;

const stamp = Date.now().toString(36).slice(-5);
const names = { alice: `al_${stamp}`, bob: `bo_${stamp}` };
const tokens = {
  alice: await registerPlayer(API, names.alice),
  bob: await registerPlayer(API, names.bob),
};
execSync(process.env.FUND_CMD.replaceAll("{player}", names.alice), { stdio: "inherit", shell: "/bin/sh" });

const connect = async (who) => {
  const bot = new Bot({ api: API, game: GAME, token: tokens[who], name: names[who] });
  await bot.connect();
  bot.requestChunks(1);
  for (let i = 0; i < 100 && bot.chunks.size < 9; i++) await sleep(200);
  return bot;
};
const alice = await connect("alice");
const bob = await connect("bob");

// A solid block near spawn, inside land chunk (2, 2): blocks 32..47.
const [x, z] = [40, 40];
let y = null;
for (let i = 0; i < 100 && y === null; i++) {
  alice.position = [x + 0.5, 100, z + 0.5];
  alice.requestChunks(1);
  bob.position = alice.position;
  bob.requestChunks(1);
  await sleep(200);
  y = alice.surface(x, z, (v) => v !== 0);
}
assert.ok(y !== null, "terrain at the claim");
for (const bot of [alice, bob]) await bot.moveTo([x + 0.5, y + 1 + EYE, z + 2.5], 4);
await sleep(5500); // join grace

const tryDig = async (bot) => {
  bot.call("platform.mine.start", { voxel: [x, y, z] });
  return bot.result("mine.start");
};
assert.equal((await tryDig(bob)).ok, true, "unclaimed land is open to everyone");
step("unclaimed ground is open to everyone");

// Alice claims the chunk; the price leaves her wallet.
const before = (await api(API, "/wallets", { token: tokens.alice })).wallets.find((w) => w.currency === "CRN")?.balance;
const { land } = await api(API, "/lands", {
  token: tokens.alice,
  headers: { "Idempotency-Key": randomUUID().replace(/-/g, "") },
  body: { world: "main", dimension: "overworld", min: [2, 2], max: [2, 2], name: "Test Acre" },
});
const after = (await api(API, "/wallets", { token: tokens.alice })).wallets.find((w) => w.currency === "CRN").balance;
assert.ok(after < before, `the claim was paid: ${before} -> ${after}`);
step(`claimed land chunk (2, 2) for ${before - after} CRN`);

// The game server enforces it once the feed refreshes.
let refused = null;
for (let i = 0; i < 40; i++) {
  const r = await tryDig(bob);
  if (!r.ok && r.code === "land_protected") {
    refused = r;
    break;
  }
  await sleep(500);
}
assert.ok(refused, "a stranger may not dig in claimed land");
assert.equal((await tryDig(alice)).ok, true, "the owner may");
step("the game server refuses a stranger and lets the owner dig");

// Entering the land is announced.
const notice = alice.event("platform.land", (p) => p.land?.id === land.id, 8000);
await alice.moveTo([x + 0.5 - 40, y + 1 + EYE, z + 0.5], 3);
await sleep(600);
await alice.moveTo([x + 0.5, y + 1 + EYE, z + 2.5], 3);
const seen = await notice;
assert.equal(seen.land.owner.name, names.alice);
assert.equal(seen.land.role, "owner");
step("walking in announces the land and its owner");

// Membership opens it to Bob.
await api(API, `/lands/${land.id}/members`, { token: tokens.alice, body: { player: names.bob, role: "builder" } });
let allowed = false;
for (let i = 0; i < 40 && !allowed; i++) {
  allowed = (await tryDig(bob)).ok;
  if (!allowed) await sleep(500);
}
assert.ok(allowed, "a builder may dig");
step("a builder added through the API may dig");

alice.close();
bob.close();
console.log("land: all checks passed");
process.exit(0);
