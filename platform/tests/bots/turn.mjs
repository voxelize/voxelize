// The voice relay end to end: a player turning voice on gets a TURN server
// with credentials of their own (`<expiry>:<player id>`), and the TURN
// server (coturn with use-auth-secret) accepts exactly those — an
// allocation succeeds — while a tampered password is refused. Needs
// coturn's turnutils_uclient and a game server started with GAME_TURN_URLS
// and GAME_TURN_SECRET matching the TURN server's static-auth-secret:
//
//   DEV_TICKET_SECRET=... node turn.mjs - http://127.0.0.1:4000

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";

import { Bot } from "./bot.mjs";

const GAME = process.argv[3] ?? "http://127.0.0.1:4000";
assert.ok(process.env.DEV_TICKET_SECRET, "DEV_TICKET_SECRET");
const step = (text) => console.log(`✓ ${text}`);
const b64 = (d) => Buffer.from(d).toString("base64url");
const name = `turn_${Date.now().toString(36).slice(-5)}`;
const ticket = () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: "platform-api", aud: "game", sub: `pl_${name}`, name, world: "main", realm: "survival", roles: ["player"], iat: now, exp: now + 60, jti: randomUUID() };
  const signed = `v1.${b64(JSON.stringify(claims))}`;
  return `${signed}.${createHmac("sha256", process.env.DEV_TICKET_SECRET).update(signed).digest("base64url")}`;
};

const bot = new Bot({ api: "-", game: GAME, name, issueTicket: ticket });
await bot.connect();
bot.call("platform.voice.join", {});
const joined = await bot.result("voice.join");
assert.equal(joined.ok, true, JSON.stringify(joined));
const relay = joined.ice_servers.find((s) => [s.urls].flat().some((u) => u.startsWith("turn:")));
assert.ok(relay, `a TURN server is offered: ${JSON.stringify(joined)}`);
const [expiry, player] = relay.username.split(":");
assert.equal(player, `pl_${name}`, "the credentials name the player");
assert.ok(Number(expiry) > Date.now() / 1000 + 3600, "and last a while");
step("voice brings a TURN server with the player's own credentials");

const url = new URL([relay.urls].flat()[0].replace(/^turn:/, "turn://"));
const allocate = (password) => {
  try {
    const out = execFileSync("turnutils_uclient", ["-y", "-n", "2", "-m", "1", "-u", relay.username, "-w", password, "-p", url.port || "3478", url.hostname], { encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "pipe"] });
    return /tot_recv_msgs=[1-9]/.test(out) && !/Cannot complete Allocation/.test(out);
  } catch {
    return false;
  }
};
assert.ok(allocate(relay.credential), "the TURN server relays with them");
const tampered = relay.credential.slice(0, -2) + (relay.credential.at(-2) === "A" ? "B=" : "A=");
assert.ok(!allocate(tampered), "and refuses a tampered password");
step("the TURN server relays with those credentials and refuses tampered ones");

bot.close();
console.log("turn: all checks passed");
process.exit(0);
