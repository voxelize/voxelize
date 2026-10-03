// Block behaviours on a live server: fell a whole tree, then watch the
// leaves decay and drop saplings or sticks.
//
//   node nature.mjs [api base] [game base]

import assert from "node:assert/strict";

import { Bot, registerPlayer } from "./bot.mjs";

const API = process.argv[2] ?? "http://127.0.0.1:8080";
const GAME = process.argv[3] ?? API;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);
const content = await (await fetch(`${GAME}/platform/content`)).json();
const block = (key) => content.blocks.find((b) => b.key === key);
const EYE = 1.425;

const name = `nature_${Date.now().toString(36)}`;
const bot = new Bot({ api: API, game: GAME, token: await registerPlayer(API, name), name });
await bot.connect();
bot.requestChunks(2);
for (let i = 0; i < 100 && bot.chunks.size < 25; i++) await sleep(200);

const LOG = block("oak_log").id;
const LEAVES = block("oak_leaves").id;
let trunk = null;
search: for (let r = 6; r < 40; r++) {
  for (let x = -r; x <= r; x++) {
    for (let z = -r; z <= r; z++) {
      if (Math.max(Math.abs(x), Math.abs(z)) !== r) continue;
      for (let y = 60; y < 130; y++) {
        if (bot.voxel(x, y, z) === LOG && bot.voxel(x, y - 1, z) !== LOG) {
          // Only a lone tree: no other log within 5 blocks of the canopy.
          let lone = true;
          for (let dx = -6; dx <= 6 && lone; dx++)
            for (let dz = -6; dz <= 6 && lone; dz++)
              for (let dy = 0; dy < 10 && lone; dy++)
                if ((dx || dz) && bot.voxel(x + dx, y + dy, z + dz) === LOG) lone = false;
          if (lone) {
            trunk = [x, y, z];
            break search;
          }
        }
      }
    }
  }
}
assert.ok(trunk, "a lone tree");
const [tx, ty, tz] = trunk;
const leavesAround = () => {
  let n = 0;
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let dy = 0; dy < 12; dy++) if (bot.voxel(tx + dx, ty + dy, tz + dz) === LEAVES) n++;
  return n;
};
const before = leavesAround();
await bot.moveTo([tx + 0.5, ty + EYE + 0.05, tz + 0.5], 12);
await sleep(5500);
let height = 0;
while (bot.voxel(tx, ty + height, tz) === LOG) height++;
for (let i = 0; i < height; i++) {
  const voxel = [tx, ty + i, tz];
  bot.call("platform.mine.start", { voxel });
  await bot.result("mine.start");
  await sleep(3150);
  bot.call("platform.mine.finish", { voxel });
  assert.equal((await bot.result("mine.finish")).ok, true);
}
step(`felled a lone tree: ${height} logs, ${before} leaves`);

bot.moveTo([tx + 30.5, ty + 20, tz + 0.5], 3); // step away so we do not pick things up
let after = before;
const started = Date.now();
while (Date.now() - started < 150000 && after > before / 3) {
  await sleep(5000);
  bot.requestChunks(1);
  after = leavesAround();
}
assert.ok(after <= before / 3, `leaves decayed: ${before} -> ${after}`);
step(`leaves decayed: ${before} -> ${after} in ${Math.round((Date.now() - started) / 1000)} s`);
const loot = (bot.drops ?? []).filter((d) => Math.abs(d.p[0] - tx) < 6 && Math.abs(d.p[2] - tz) < 6);
const sapling = content.items.find((i) => i.key === "oak_sapling").id;
step(`drops under the tree: ${loot.map((d) => `${d.count}×${content.items.find((i) => i.id === d.item)?.key}`).join(", ") || "none"}`);
assert.ok(loot.length > 0 || before < 20, "decayed leaves dropped something");
console.log(loot.some((d) => d.item === sapling) ? "saplings dropped" : "no sapling this time (5% chance each)");
bot.close();
console.log("nature test passed");
process.exit(0);
