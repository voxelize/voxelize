// Movement checks on a live server with GAME_ANTICHEAT on: walking is left
// alone; running far faster than any sprint, or hanging in the air, sends
// the player back where they last stood fairly; doing it again and again is
// reported to moderators (the audit log). Needs the backend and ROLE_CMD
// (gives a user a role; {player} and {role} are replaced):
//
//   ROLE_CMD=... node anticheat.mjs <api base> <game base>

import assert from "node:assert/strict";
import { execSync } from "node:child_process";

import { api, Bot, registerPlayer } from "./bot.mjs";

const API = process.argv[2] ?? "http://127.0.0.1:8080";
const GAME = process.argv[3] ?? API;
assert.ok(process.env.ROLE_CMD, "ROLE_CMD");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);
const EYE = 1.425;

const tag = Date.now().toString(36).slice(-5);
const [name, modName] = [`ac_${tag}`, `am_${tag}`];
const [token, modToken] = [await registerPlayer(API, name), await registerPlayer(API, modName)];
execSync(process.env.ROLE_CMD.replaceAll("{player}", modName).replaceAll("{role}", "moderator"), { stdio: "inherit", shell: "/bin/sh" });
const id = (await api(API, "/me", { token })).user.id;

const content = await (await fetch(`${GAME}/platform/content`)).json();
const def = (v) => content.blocks.find((b) => b.id === v);
const bot = new Bot({ api: API, game: GAME, token, name });
bot.teleports = [];
bot.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.teleport" && (bot.teleports.push(m.payload.feet), false), resolve() {} });
await bot.connect();
const joined = Date.now();
bot.requestChunks(2);
for (let i = 0; i < 150 && bot.chunks.size < 25; i++) await sleep(200);
const solid = (v) => v !== 0 && def(v)?.collision !== false && def(v)?.fluid == null;
// A row of dry ground along +x with headroom (the heights may vary: the
// player is placed on top of each column).
let row = null;
for (const x0 of [0, 8, 16, -16, -28]) {
  for (let z = -16; z <= 16 && !row; z++) {
    const heights = [];
    for (let x = x0; x <= x0 + 28; x++) {
      const top = bot.surface(x, z, solid);
      // Dry land (air above), so nobody drowns during the test.
      if (top === null || bot.voxel(x, top + 1, z) !== 0 || bot.voxel(x, top + 2, z) !== 0) break;
      heights.push(top);
    }
    if (heights.length === 29) row = { x0, z, heights };
  }
  if (row) break;
}
assert.ok(row, "a walkable row of ground near spawn");
const start = [row.x0, row.heights[0] + 1, row.z];
const feetAt = (x) => row.heights[Math.max(0, Math.min(28, Math.round(x - row.x0)))] + 1;
const eye = (x, feetY, z) => [x + 0.5, feetY + EYE, z + 0.5];
// Steps of `dx` blocks every 250 ms (dx 1 = 4 blocks a second), on the ground.
const walk = async (from, to, dx) => {
  for (let x = from; dx > 0 ? x <= to : x >= to; x += dx) {
    await bot.moveTo(eye(x, feetAt(x), start[2]));
    await sleep(250);
  }
};
await bot.moveTo(eye(row.x0, feetAt(row.x0), start[2]), 3);
await sleep(Math.max(2500, 11000 - (Date.now() - joined))); // past the join grace
bot.teleports.length = 0;

await walk(row.x0, row.x0 + 6, 1);
await walk(row.x0 + 6, row.x0, -1);
await sleep(600);
assert.deepEqual(bot.teleports, [], "walking is left alone");
step("walking back and forth is left alone");

await walk(row.x0, row.x0 + 28, 7);
for (let i = 0; i < 20 && !bot.teleports.length; i++) await sleep(100);
assert.ok(bot.teleports.length, "running at 28 blocks a second is caught");
assert.ok(Math.abs(bot.teleports[0][0] - row.x0) <= 13, `sent back to fair ground: ${bot.teleports[0]}`);
step(`running at 28 blocks a second sends the player back (to x=${bot.teleports[0][0]})`);

await bot.moveTo(eye(row.x0, feetAt(row.x0), start[2]), 3);
await sleep(2500);
bot.teleports.length = 0;
for (let i = 0; i < 16; i++) {
  await bot.moveTo(eye(row.x0, feetAt(row.x0) + 12, start[2]));
  await sleep(250);
}
assert.ok(bot.teleports.length, "hanging in the air is caught");
assert.ok(bot.teleports[0][1] <= feetAt(row.x0) + 1, `sent back down: ${bot.teleports[0]}`);
step("hanging in the air sends the player back down");

// Again and again: reported to moderators.
for (let round = 0; round < 12; round++) {
  await bot.moveTo(eye(row.x0, feetAt(row.x0), start[2]), 3);
  await sleep(1200);
  await walk(row.x0, row.x0 + 28, 7);
}
let flagged = [];
for (let i = 0; i < 30 && !flagged.length; i++) {
  flagged = (await api(API, "/admin/audit?action=anticheat", { token: modToken })).entries.filter((e) => e.subject_id === id);
  if (!flagged.length) await sleep(500);
}
assert.ok(flagged.length >= 1, "reported");
assert.match(flagged[0].action, /^anticheat\.(speed|hover)$/);
step(`repeated cheating is reported to moderators (${flagged.map((f) => f.action).join(", ")})`);
bot.close();
console.log("anticheat: all checks passed");
process.exit(0);
