// Server plugins on a live server, with the shipped "welcome" plugin: a
// first visit is greeted, a second one welcomed back (the plugin's store
// kept the count), /stats is answered and /help lists it. Standalone:
//
//   DEV_TICKET_SECRET=... node plugins.mjs - http://127.0.0.1:4000


import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

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
const stamp = Date.now().toString(36).slice(-5);
const join = async (name) => {
  const bot = new Bot({ api: "-", game: GAME, name, issueTicket: ticket(name) });
  bot.channel = [];
  bot.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.chat" && (bot.channel.push(m.payload), false), resolve() {} });
  await bot.connect();
  return bot;
};
const until = async (bot, test, what) => {
  for (let i = 0; i < 60 && !bot.channel.some(test); i++) await sleep(100);
  const line = bot.channel.find(test);
  assert.ok(line, `${what}; got ${JSON.stringify(bot.channel)}`);
  return line;
};
const name = `pg_${stamp}`;
let bot = await join(name);
await until(bot, (c) => c.channel === "system" && c.body.startsWith(`[Welcome] Welcome, ${name}!`), "a first visit is greeted");
step("a first visit is greeted");
bot.close();
await sleep(1500);
bot = await join(name);
await until(bot, (c) => c.body === `[Welcome] Welcome back, ${name} (visit 2).`, "the second visit is counted");
step("the second visit is welcomed back (the plugin's store kept count)");
bot.chat("/stats");
await until(bot, (c) => c.body.startsWith(`[Welcome] ${name}: 0 blocks mined`) && c.body.includes("2 visits"), "/stats answers");
bot.chat("/help");
await until(bot, (c) => c.body.includes("/stats (Welcome)"), "/help lists plugin commands");
step("/stats is answered and /help lists it");
bot.close();
console.log("plugins: all checks passed");
process.exit(0);
