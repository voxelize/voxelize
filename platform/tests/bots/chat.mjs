// Chat on a live server: public lines carry the speaker's real name (a
// forged sender is replaced), whispers reach only their target and can be
// answered with /r, local chat reaches players nearby, guild chat needs a
// guild, and flooding is refused. Standalone:
//
//   DEV_TICKET_SECRET=... node chat.mjs - http://127.0.0.1:4000

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
  bot.lines = [];
  bot.channel = [];
  bot.waiters.push({ match: (m) => m.type === "CHAT" && (bot.lines.push(m.chat), false), resolve() {} });
  bot.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.chat" && (bot.channel.push(m.payload), false), resolve() {} });
  await bot.connect();
  return bot;
};
const ann = await join(`ann_${stamp}`);
const bob = await join(`bob_${stamp}`);
const cid = await join(`cid_${stamp}`);
const until = async (test, what) => {
  for (let i = 0; i < 40 && !test(); i++) await sleep(100);
  assert.ok(test(), what);
};
await ann.moveTo([0.5, 120, 0.5]);
await bob.moveTo([3.5, 120, 0.5]);
await cid.moveTo([300.5, 120, 0.5], 14);
await sleep(800);

// Public: under the real name, whatever the client claims.
ann.send({ type: "CHAT", chat: { type: "CHAT", sender: "admin", body: "hello all", metadata: "" } });
await until(() => bob.lines.some((l) => l.body === "hello all"), "bob hears ann");
assert.equal(bob.lines.find((l) => l.body === "hello all").sender, ann.name, "the forged sender is replaced");
step("public chat carries the speaker's real name");

// Whisper and reply.
ann.chat(`/w ${bob.name} secret plan`);
await until(() => bob.channel.some((c) => c.channel === "whisper" && c.body === "secret plan"), "bob gets the whisper");
await sleep(300);
assert.ok(!cid.channel.some((c) => c.body === "secret plan"), "cid does not");
assert.ok(!bob.lines.some((l) => l.body.includes("secret")), "never public");
bob.chat("/r got it");
await until(() => ann.channel.some((c) => c.channel === "whisper" && c.body === "got it" && c.from.name === bob.name), "ann gets the reply");
step("a whisper reaches only its target and /r answers it");

// Local chat reaches the nearby player only.
ann.chat("/l anyone near?");
await until(() => bob.channel.some((c) => c.channel === "local" && c.body === "anyone near?"), "bob is near");
await sleep(300);
assert.ok(!cid.channel.some((c) => c.body === "anyone near?"), "cid is 300 blocks away");
step("local chat reaches players nearby only");

cid.chat("/g anyone?");
await until(() => cid.channel.some((c) => c.channel === "system" && /no guild/i.test(c.body)), "guild chat needs a guild");
cid.chat("/dance");
await until(() => cid.channel.some((c) => c.channel === "system" && /Unknown command/.test(c.body)), "unknown commands are named");
step("guild chat needs a guild; unknown commands are explained");

for (let i = 0; i < 10; i++) cid.chat(`spam ${i}`);
await until(() => cid.channel.some((c) => c.channel === "system" && /too fast/.test(c.body)), "flooding is refused");
await sleep(300);
assert.ok(ann.lines.filter((l) => l.body.startsWith("spam")).length <= 6, "at most six got through");
step("flooding the chat is refused");

for (const b of [ann, bob, cid]) b.close();
console.log("chat: all checks passed");
process.exit(0);
