// Circuits on a live server: a lever lights a lamp through conduits, a
// pressure plate lights a lamp while the bot stands on it, a gate opens by
// hand. Builds in creative.
//
// Against a full stack, a creative player's API token:
//   node circuits.mjs <api base> <game base> <api token>
// Against a standalone game server sharing a development ticket secret:
//   DEV_TICKET_SECRET=... node circuits.mjs - http://127.0.0.1:4000

import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

import { Bot } from "./bot.mjs";

const API = process.argv[2] ?? "http://127.0.0.1:8080";
const GAME = process.argv[3] ?? API;
const TOKEN = process.argv[4];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);
const content = await (await fetch(`${GAME}/platform/content`)).json();
const id = (key) => content.blocks.find((b) => b.key === key).id;
const EYE = 1.425;

const name = `circuits_${Date.now().toString(36)}`;
const b64 = (data) => Buffer.from(data).toString("base64url");
const devTicket = () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: "platform-api", aud: "game", sub: `pl_${name}`, name, world: "main", realm: "creative", roles: ["player"], iat: now, exp: now + 60, jti: randomUUID() };
  const signed = `v1.${b64(JSON.stringify(claims))}`;
  return `${signed}.${createHmac("sha256", process.env.DEV_TICKET_SECRET).update(signed).digest("base64url")}`;
};
assert.ok(TOKEN || process.env.DEV_TICKET_SECRET, "an API token or DEV_TICKET_SECRET");
const bot = new Bot({ api: API, game: GAME, token: TOKEN, name, issueTicket: TOKEN ? undefined : devTicket });
await bot.connect();
bot.requestChunks(2);
for (let i = 0; i < 100 && bot.chunks.size < 25; i++) await sleep(200);

const solid = (v) => v !== null && v !== 0 && content.blocks.find((b) => b.id === v)?.fluid == null;
// A flat strip of 7 solid blocks along x with two air blocks above.
let base = null;
search: for (let x = 2; x < 30; x++) {
  for (let z = 2; z < 30; z++) {
    const y = bot.surface(x, z, (v) => content.blocks.find((b) => b.id === v)?.collision !== false);
    if (y === null) continue;
    let ok = true;
    for (let dx = 0; dx < 7 && ok; dx++)
      ok = solid(bot.voxel(x + dx, y, z)) && bot.voxel(x + dx, y + 1, z) === 0 && bot.voxel(x + dx, y + 2, z) === 0 &&
        bot.voxel(x + dx, y + 1, z + 2) === 0 && solid(bot.voxel(x + dx, y, z + 2));
    if (ok) {
      base = [x, y + 1, z];
      break search;
    }
  }
}
assert.ok(base, "a flat strip to build on");
const [bx, by, bz] = base;
await bot.moveTo([bx + 3.5, by + EYE, bz + 1.5], 12);
await sleep(5500); // join grace

const place = async (voxel, block, extra = {}) => {
  bot.call("platform.build.place", { voxel, block, ...extra });
  const r = await bot.result("build.place");
  assert.equal(r.ok, true, `place ${block}: ${JSON.stringify(r)}`);
};
const use = async (voxel) => {
  bot.call("platform.use", { voxel });
  const r = await bot.result("use");
  assert.equal(r.ok, true, `use: ${JSON.stringify(r)}`);
};
const until = async (pred, label, ms = 8000) => {
  const start = Date.now();
  while (!pred()) {
    assert.ok(Date.now() - start < ms, `timed out: ${label}`);
    await sleep(100);
  }
};

// Lever → three conduits → lamp.
await place([bx, by, bz], "lever");
for (let i = 1; i <= 3; i++) await place([bx + i, by, bz], "conduit");
await place([bx + 4, by, bz], "volt_lamp");
await sleep(500);
assert.equal(bot.voxel(bx + 4, by, bz), id("volt_lamp"), "lamp starts dark");
await use([bx, by, bz]);
await until(() => bot.voxel(bx + 4, by, bz) === id("volt_lamp_lit"), "lamp lights");
step("a lever lights a lamp through three conduits");
await use([bx, by, bz]);
await until(() => bot.voxel(bx + 4, by, bz) === id("volt_lamp"), "lamp goes dark");
step("switching the lever off darkens it");

// Pressure plate next to a lamp, on the second row.
const pz = bz + 2;
await place([bx + 1, by, pz], "pressure_plate");
await place([bx + 2, by, pz], "volt_lamp");
await bot.moveTo([bx + 1.5, by + EYE, pz + 0.5], 3);
await until(() => bot.voxel(bx + 2, by, pz) === id("volt_lamp_lit"), "plate lights the lamp");
step("standing on a pressure plate lights a lamp");
await bot.moveTo([bx + 5.5, by + EYE, pz + 0.5], 3);
await until(() => bot.voxel(bx + 2, by, pz) === id("volt_lamp"), "plate released");
step("stepping off releases it");

// A gate opens and closes by hand.
await place([bx + 5, by, bz], "gate", { yRotation: 4 });
await use([bx + 5, by, bz]);
await until(() => bot.voxel(bx + 5, by, bz) === id("gate_open"), "gate opens");
await sleep(500);
assert.equal(bot.voxel(bx + 5, by, bz), id("gate_open"), "a hand-opened gate stays open");
await use([bx + 5, by, bz]);
await until(() => bot.voxel(bx + 5, by, bz) === id("gate"), "gate closes");
step("a gate opens and closes by hand");

bot.close();
console.log("circuits: all checks passed");
process.exit(0);
