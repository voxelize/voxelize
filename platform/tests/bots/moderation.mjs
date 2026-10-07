// Moderation end to end: a moderator mutes a player in the admin API and
// the game server refuses their chat; then suspends them and the game
// server takes them out of play at once (every intent refused, the client
// told), and new tickets are refused. Needs the backend and ROLE_CMD, which
// gives a user a role ({player} and {role} are replaced):
//
//   ROLE_CMD="php artisan user:role {player} {role}" node moderation.mjs <api base> <game base>

import assert from "node:assert/strict";
import { execSync } from "node:child_process";

import { api, Bot, registerPlayer } from "./bot.mjs";

const API = process.argv[2] ?? "http://127.0.0.1:8080";
const GAME = process.argv[3] ?? API;
assert.ok(process.env.ROLE_CMD, "ROLE_CMD");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);

const tag = Date.now().toString(36).slice(-5);
const [modName, name] = [`md_${tag}`, `rw_${tag}`];
const [modToken, token] = [await registerPlayer(API, modName), await registerPlayer(API, name)];
execSync(process.env.ROLE_CMD.replaceAll("{player}", modName).replaceAll("{role}", "moderator"), { stdio: "inherit", shell: "/bin/sh" });
await assert.rejects(api(API, "/admin/players", { token }), /forbidden/, "players are not let in");

const bot = new Bot({ api: API, game: GAME, token, name });
bot.channel = [];
bot.kicked = null;
bot.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.chat" && (bot.channel.push(m.payload), false), resolve() {} });
bot.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.kicked" && ((bot.kicked = m.payload), false), resolve() {} });
await bot.connect();
const until = async (test, what, tries = 60) => {
  for (let i = 0; i < tries && !test(); i++) await sleep(100);
  assert.ok(test(), what);
};

const { players } = await api(API, `/admin/players?q=${name}`, { token: modToken });
assert.equal(players[0]?.username, name);
await api(API, `/admin/players/${players[0].id}/mute`, { token: modToken, method: "PUT", body: { minutes: 10, reason: "shouting" } });
// The game server picks the change up from the sanctions feed.
for (let i = 0; i < 40 && !bot.channel.some((c) => c.body?.startsWith("You are muted")); i++) {
  bot.chat("HELLO EVERYONE");
  await sleep(250);
}
assert.ok(bot.channel.some((c) => c.body === "You are muted for 10 more minute(s): shouting"), `muted; got ${JSON.stringify(bot.channel)}`);
step("a muted player's chat is refused in game, with the reason");

await api(API, `/admin/players/${players[0].id}/status`, { token: modToken, method: "PUT", body: { status: "suspended", reason: "griefing spawn" } });
await until(() => bot.kicked, "the game server takes them out of play", 100);
assert.deepEqual(bot.kicked, { status: "suspended", reason: "griefing spawn" });
bot.call("platform.eat", {});
assert.equal((await bot.result("eat")).code, "not_joined", "every intent is refused");
await assert.rejects(api(API, "/me", { token }), /401/, "signed out");
step("a suspended player is out of play at once and signed out");

const detail = await api(API, `/admin/players/${players[0].id}`, { token: modToken });
assert.deepEqual(detail.audit.map((a) => a.action).slice(0, 2), ["admin.status", "admin.mute"]);
step("both actions are in the player's history");
bot.close();
console.log("moderation: all checks passed");
process.exit(0);
