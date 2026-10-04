// Cosmetics end to end: a player buys a crown and an outfit with Crowns and
// wears them; another player in the world sees the look when they join,
// and again when they change it in play with a fresh ticket. Needs the
// backend and FUND_CMD (grants at least 400 Crowns; {player} is replaced):
//
//   FUND_CMD="..." node cosmetics.mjs <api base> <game base>

import assert from "node:assert/strict";
import { execSync } from "node:child_process";

import { api, Bot, registerPlayer } from "./bot.mjs";

const API = process.argv[2] ?? "http://127.0.0.1:8080";
const GAME = process.argv[3] ?? API;
assert.ok(process.env.FUND_CMD, "FUND_CMD");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);

const tag = Date.now().toString(36).slice(-5);
const [ana, bo] = [`ca_${tag}`, `cb_${tag}`];
const [anaToken, boToken] = [await registerPlayer(API, ana), await registerPlayer(API, bo)];
const anaId = (await api(API, "/me", { token: anaToken })).user.id;
execSync(process.env.FUND_CMD.replaceAll("{player}", ana), { stdio: "inherit", shell: "/bin/sh" });

await assert.rejects(api(API, "/cosmetics/hat_crown/buy", { token: boToken, method: "POST" }), /insufficient_funds/);
let w = await api(API, "/cosmetics/hat_crown/buy", { token: anaToken, method: "POST" });
w = await api(API, "/cosmetics/outfit_royal/buy", { token: anaToken, method: "POST" });
assert.deepEqual(w.owned.sort(), ["hat_crown", "outfit_royal"]);
const balance = w.balance;
await api(API, "/cosmetics/equipped", { token: anaToken, method: "PUT", body: { slot: "hat", cosmetic: "hat_crown" } });
w = await api(API, "/cosmetics/equipped", { token: anaToken, method: "PUT", body: { slot: "outfit", cosmetic: "outfit_royal" } });
assert.equal(w.look.hat.art, "crown");
step(`bought and wore a crown and a royal robe (${balance} Crowns left)`);

const looks = [];
const watcher = new Bot({ api: API, game: GAME, token: boToken, name: bo });
watcher.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.look" && (looks.push(m.payload), false), resolve() {} });
await watcher.connect();
const wearer = new Bot({ api: API, game: GAME, token: anaToken, name: ana });
await wearer.connect();
const seen = async (check) => {
  for (let i = 0; i < 50; i++) {
    const last = looks.filter((l) => l.player === anaId).at(-1);
    if (last && check(last.look)) return last.look;
    await sleep(100);
  }
  assert.fail(`no matching look; saw ${JSON.stringify(looks)}`);
};
let look = await seen((l) => l?.hat?.art === "crown");
assert.equal(look.outfit.body, "#5a2a82");
step("another player sees the crown and robe when the wearer joins");

const stolen = (await api(API, "/game/tickets", { token: boToken, body: { world: "main" } })).ticket;
wearer.call("platform.look.set", { ticket: stolen });
assert.equal((await wearer.result("look.set")).code, "bad_ticket", "someone else's ticket is refused");
await api(API, "/cosmetics/equipped", { token: anaToken, method: "PUT", body: { slot: "hat", cosmetic: null } });
const fresh = (await api(API, "/game/tickets", { token: anaToken, body: { world: "main" } })).ticket;
wearer.call("platform.look.set", { ticket: fresh });
assert.equal((await wearer.result("look.set")).ok, true);
look = await seen((l) => l && !l.hat);
assert.equal(look.outfit.body, "#5a2a82");
step("taking the crown off in play shows at once (someone else's ticket is refused)");

wearer.close();
watcher.close();
console.log("cosmetics: all checks passed");
process.exit(0);
