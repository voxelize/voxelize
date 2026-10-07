// Private worlds end to end: a player creates a private world, which a game
// server of its own hosts; the owner plays in it and the browser shows it
// online with them in it; a stranger neither sees it nor gets in until the
// owner makes it public. Needs the backend (WORLDS_URL_TEMPLATE pointing at
// the world's server) and HOST_CMD, which starts a game server for a world
// ({world} is replaced) and returns once it listens:
//
//   HOST_CMD="..." node worlds.mjs <api base> <world server base>

import assert from "node:assert/strict";
import { execSync } from "node:child_process";

import { api, Bot, registerPlayer } from "./bot.mjs";

const API = process.argv[2] ?? "http://127.0.0.1:8080";
const SERVER = process.argv[3] ?? "http://127.0.0.1:4001";
assert.ok(process.env.HOST_CMD, "HOST_CMD");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);

const tag = Date.now().toString(36).slice(-5);
const [owner, stranger] = [`wo_${tag}`, `ws_${tag}`];
const [ownerToken, strangerToken] = [await registerPlayer(API, owner), await registerPlayer(API, stranger)];

const { world } = await api(API, "/worlds", { token: ownerToken, body: { name: `Hideout ${tag}`, visibility: "private", realm: "creative" } });
assert.match(world.key, /^w_[a-z0-9]{10}$/);
assert.equal(world.online, false);
step(`created the private world ${world.key}`);

execSync(process.env.HOST_CMD.replaceAll("{world}", world.key), { stdio: "inherit", shell: "/bin/sh" });
const ownerBot = new Bot({ api: API, game: SERVER, token: ownerToken, name: owner, world: world.key });
await ownerBot.connect();
const browse = async (token) => (await api(API, "/worlds", { token })).worlds.find((w) => w.key === world.key);
let seen;
for (let i = 0; i < 50 && !((seen = await browse(ownerToken))?.players >= 1); i++) await sleep(200);
assert.equal(seen.online, true, "its server reports it");
assert.equal(seen.players, 1, "with the owner in it");
step("the owner plays in it on its own server; the browser shows it online with 1 player");

assert.equal(await browse(strangerToken), undefined, "strangers do not see a private world");
await assert.rejects(api(API, "/game/tickets", { token: strangerToken, body: { world: world.key } }), /world_closed/);
step("a stranger neither sees it nor gets a ticket");

await api(API, `/worlds/${world.key}`, { token: ownerToken, method: "PATCH", body: { visibility: "public" } });
assert.equal((await browse(strangerToken))?.name, `Hideout ${tag}`);
const visitor = new Bot({ api: API, game: SERVER, token: strangerToken, name: stranger, world: world.key });
await visitor.connect();
for (let i = 0; i < 50 && (seen = await browse(ownerToken)).players < 2; i++) await sleep(200);
assert.equal(seen.players, 2);
step("made public, the stranger finds it and joins");

ownerBot.close();
visitor.close();
console.log("worlds: all checks passed");
process.exit(0);
