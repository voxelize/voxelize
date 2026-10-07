// Friends end to end: one player asks another by name, the other accepts,
// and once the first joins the game the second sees them online in the
// world (the game server reports who is playing). Needs the backend:
//
//   node friends.mjs <api base> <game base>

import assert from "node:assert/strict";

import { api, Bot, registerPlayer } from "./bot.mjs";

const API = process.argv[2] ?? "http://127.0.0.1:8080";
const GAME = process.argv[3] ?? API;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);

const tag = Date.now().toString(36).slice(-5);
const [ana, bo] = [`fa_${tag}`, `fb_${tag}`];
const [anaToken, boToken] = [await registerPlayer(API, ana), await registerPlayer(API, bo)];
const friends = (token) => api(API, "/friends", { token });

const asked = await api(API, "/friends", { token: anaToken, body: { player: bo } });
assert.equal(asked.status, "pending");
assert.deepEqual((await friends(boToken)).incoming.map((c) => c.username), [ana]);
step("a request reaches the other player");

const accepted = await api(API, `/friends/${ana}/accept`, { token: boToken, method: "POST" });
assert.equal(accepted.status, "accepted");
let list = await friends(boToken);
assert.equal(list.friends[0]?.username, ana);
assert.equal(list.friends[0].online, false, "not playing yet");
step("accepted: both are friends, offline");

const bot = new Bot({ api: API, game: GAME, token: anaToken, name: ana });
await bot.connect();
for (let i = 0; i < 50 && !(list = await friends(boToken)).friends[0].online; i++) await sleep(200);
assert.equal(list.friends[0].online, true, "joining the game shows them online");
assert.equal(list.friends[0].world, "main");
step("joining the game shows the friend online in main");
bot.close();

await api(API, `/friends/${ana}`, { token: boToken, method: "DELETE" });
assert.equal((await friends(anaToken)).friends.length, 0);
step("either side can end it");
console.log("friends: all checks passed");
process.exit(0);
