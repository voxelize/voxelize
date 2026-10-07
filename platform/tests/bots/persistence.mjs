// Stopping the server loses nothing: a player drops a stack and walks off,
// the server is stopped (SIGTERM) and started again, and the stack still
// lies where it fell and the player comes back where they stood. Standalone,
// with STOP_CMD and START_CMD that stop and start the server on the same
// save directory:
//
//   DEV_TICKET_SECRET=... SAVE_DIR=... STOP_CMD=... START_CMD=... node persistence.mjs - http://127.0.0.1:4000

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

import { Bot } from "./bot.mjs";

const GAME = process.argv[3] ?? "http://127.0.0.1:4000";
assert.ok(process.env.DEV_TICKET_SECRET, "DEV_TICKET_SECRET");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);
const b64 = (d) => Buffer.from(d).toString("base64url");
const ticket = (name) => () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: "platform-api", aud: "game", sub: `pl_${name}`, name, world: "main", realm: "survival", roles: ["player"], iat: now, exp: now + 60, jti: randomUUID() };
  const signed = `v1.${b64(JSON.stringify(claims))}`;
  return `${signed}.${createHmac("sha256", process.env.DEV_TICKET_SECRET).update(signed).digest("base64url")}`;
};

for (const v of ["SAVE_DIR", "STOP_CMD", "START_CMD"]) assert.ok(process.env[v], v);
const content = await (await fetch(`${GAME}/platform/content`)).json();
const stick = content.items.find((i) => i.key === "stick");
const name = `ps_${Date.now().toString(36).slice(-5)}`;
const id = `pl_${name}`;
const slots = Array(36).fill(null);
slots[0] = { item: stick.id, count: 9 };
mkdirSync(`${process.env.SAVE_DIR}/main/players`, { recursive: true });
writeFileSync(`${process.env.SAVE_DIR}/main/players/${id}.json`, JSON.stringify({ version: 1, id, inventory: { slots, selected: 0 }, position: null }));

const join = async () => {
  const bot = new Bot({ api: "-", game: GAME, name, issueTicket: ticket(name) });
  bot.drops = [];
  bot.teleport = null;
  bot.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.drops" && ((bot.drops = m.payload.items), false), resolve() {} });
  bot.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.teleport" && ((bot.teleport = m.payload.feet), false), resolve() {} });
  // A server that just started takes a moment to admit players.
  for (let i = 0; ; i++) {
    try {
      await bot.connect();
      return bot;
    } catch (e) {
      if (i >= 30) throw e;
      await sleep(1000);
    }
  }
};

// A spot of our own, so items from other runs are not in the way.
const sx = 40 + Math.floor(Math.random() * 400);
let bot = await join();
await bot.moveTo([sx + 0.5, 120, 4.5], 14);
await sleep(1500);
bot.call("platform.inventory.drop", { all: true });
for (let i = 0; i < 50 && !bot.drops.some((d) => d.item === stick.id && d.count === 9); i++) await sleep(100);
const dropped = bot.drops.find((d) => d.item === stick.id && d.count === 9);
assert.ok(dropped, `the stack lies in the world; drops ${JSON.stringify(bot.drops)} inventory ${JSON.stringify(bot.inventory?.slots?.[0])}`);
await bot.moveTo([sx + 26.5, 120, 4.5], 14);
await sleep(1500);
step("dropped nine sticks and walked off");

execSync(process.env.STOP_CMD, { stdio: "inherit", shell: "/bin/sh" });
step("the server stopped (SIGTERM)");
execSync(process.env.START_CMD, { stdio: "inherit", shell: "/bin/sh" });
bot = await join();
for (let i = 0; i < 50 && !bot.teleport; i++) await sleep(100);
assert.ok(bot.teleport && Math.abs(bot.teleport[0] - (sx + 26)) <= 1, `back where they stood: ${bot.teleport}`);
await bot.moveTo([bot.teleport[0] + 0.5, bot.teleport[1] + 1, bot.teleport[2] + 0.5], 14);
for (let i = 0; i < 50 && !bot.drops.some((d) => d.item === stick.id); i++) await sleep(100);
const again = bot.drops.find((d) => d.item === stick.id);
assert.ok(again, "the sticks are still there");
assert.equal(again.count, 9);
assert.ok(Math.abs(again.p[0] - dropped.p[0]) < 1.5 && Math.abs(again.p[2] - dropped.p[2]) < 1.5, `where they fell: ${again.p} vs ${dropped.p}`);
step("after the restart the sticks lie where they fell and the player is back where they stood");
bot.close();
console.log("persistence: all checks passed");
process.exit(0);
