// Achievements on a live server: joining lists what a player has earned;
// crafting a crafting table earns "Benchmark" with its experience; it
// survives a reconnect and is not earned twice. Standalone (records seeded in SAVE_DIR):
//
//   DEV_TICKET_SECRET=... SAVE_DIR=... node achievements.mjs - http://127.0.0.1:4000

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
const b64 = (d) => Buffer.from(d).toString("base64url");
const name = `ach_${Date.now().toString(36)}`;
const ticket = () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: "platform-api", aud: "game", sub: `pl_${name}`, name, world: "main", realm: "survival", roles: ["player"], iat: now, exp: now + 60, jti: randomUUID() };
  const signed = `v1.${b64(JSON.stringify(claims))}`;
  return `${signed}.${createHmac("sha256", process.env.DEV_TICKET_SECRET).update(signed).digest("base64url")}`;
};
assert.ok(content.achievements.some((a) => a.key === "benchmark"), "the content lists achievements");
const slots = Array(36).fill(null);
slots[0] = { item: item("planks").id, count: 8 };
slots[1] = { item: item("stick").id, count: 2 };
mkdirSync(`${process.env.SAVE_DIR}/main/players`, { recursive: true });
writeFileSync(`${process.env.SAVE_DIR}/main/players/pl_${name}.json`, JSON.stringify({ version: 1, id: `pl_${name}`, inventory: { slots, selected: 0 }, position: null }));

const join = async () => {
  const bot = new Bot({ api: "-", game: GAME, name, issueTicket: ticket });
  const first = new Promise((resolve) => bot.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.progress", resolve }));
  await bot.connect();
  return { bot, first: await first };
};
const call = async (bot, intent, payload) => {
  bot.call(`platform.${intent}`, payload);
  const r = await bot.result(intent);
  assert.equal(r.ok, true, `${intent}: ${JSON.stringify(r)}`);
  return r;
};

let { bot, first } = await join();
assert.deepEqual(first.done, [], "nothing earned yet");
step("joining lists no achievements for a new player");

const earned = [];
bot.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.progress" && (earned.push(...m.payload.unlocked), false), resolve() {} });
await call(bot, "craft", { grid: [["planks", "planks"], ["planks", "planks"]] });
for (let i = 0; i < 30 && earned.length < 1; i++) await sleep(100);
assert.ok(earned.some((a) => a.key === "benchmark"), JSON.stringify(earned));
step(`crafting a crafting table earned "${earned.find((a) => a.key === "benchmark").name}" (+${earned[0].xp} xp)`);

bot.close();
await sleep(500);
({ bot, first } = await join());
assert.ok(first.done.includes("benchmark"), `kept: ${JSON.stringify(first.done)}`);
const again = [];
bot.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.progress" && (again.push(...m.payload.unlocked), false), resolve() {} });
await call(bot, "craft", { grid: [["planks", "planks"], ["planks", "planks"]] });
await sleep(800);
assert.ok(!again.some((a) => a.key === "benchmark"), "earned once");
step("achievements survive a reconnect and are earned only once");

bot.close();
console.log("achievements: all checks passed");
process.exit(0);
