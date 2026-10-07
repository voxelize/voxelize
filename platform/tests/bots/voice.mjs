// Proximity voice on a live server: players with voice on are paired with
// others nearby (and told so), connection setup is relayed between paired
// players only, and walking away ends the pairing. The audio itself goes
// browser to browser (checked in a browser, not here). Standalone:
//
//   DEV_TICKET_SECRET=... node voice.mjs - http://127.0.0.1:4000

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
  bot.peers = null;
  bot.signals = [];
  bot.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.voice.peers" && ((bot.peers = m.payload.peers.map((p) => p.id)), false), resolve() {} });
  bot.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.voice.signal" && (bot.signals.push(m.payload), false), resolve() {} });
  await bot.connect();
  return bot;
};
const ann = await join(`ann_${stamp}`);
const bob = await join(`bob_${stamp}`);
const cid = await join(`cid_${stamp}`);
const until = async (test, what) => {
  for (let i = 0; i < 50 && !test(); i++) await sleep(100);
  assert.ok(test(), what);
};
await ann.moveTo([0.5, 120, 0.5]);
await bob.moveTo([6.5, 120, 0.5]);
await cid.moveTo([300.5, 120, 0.5], 14);
await sleep(500);
const call = async (bot, intent, payload) => {
  bot.call(`platform.${intent}`, payload);
  return bot.result(intent);
};
const [a, b, c] = [ann, bob, cid].map((x) => `pl_${x.name}`);

// Not in voice: nothing to relay.
assert.equal((await call(ann, "voice.signal", { to: b, kind: "offer", data: { sdp: "x" } })).code, "out_of_reach");
for (const bot of [ann, bob, cid]) assert.equal((await call(bot, "voice.join", {})).ok, true);
await until(() => ann.peers?.includes(b) && bob.peers?.includes(a), "ann and bob are paired");
await sleep(1200);
assert.ok(!(cid.peers ?? []).length, "cid is too far to pair");
step("players near each other are paired; one far away is not");

ann.call("platform.voice.signal", { to: b, kind: "offer", data: { type: "offer", sdp: "v=0" } });
await until(() => bob.signals.some((s) => s.from === a && s.kind === "offer" && s.data.sdp === "v=0"), "bob gets ann's offer");
assert.equal((await call(ann, "voice.signal", { to: c, kind: "offer", data: {} })).code, "out_of_reach", "not to cid");
assert.equal((await call(ann, "voice.signal", { to: b, kind: "shout", data: {} })).code, "nothing_there", "only setup kinds");
assert.ok(!cid.signals.length, "cid hears nothing");
step("connection setup is relayed between paired players only");

await bob.moveTo([90.5, 120, 0.5], 14);
await until(() => ann.peers && !ann.peers.includes(b), "walking away ends the pair");
assert.equal((await call(bob, "voice.signal", { to: a, kind: "ice", data: {} })).code, "out_of_reach");
step("walking away ends the pairing");

await call(ann, "voice.leave", {});
for (const bot of [ann, bob, cid]) bot.close();
console.log("voice: all checks passed");
process.exit(0);
