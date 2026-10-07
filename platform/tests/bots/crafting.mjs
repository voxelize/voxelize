// End-to-end crafting progression against a running stack, through the
// same intents the browser uses:
//   chop logs by hand -> pick up the drops -> planks in the 2x2 grid ->
//   workbench (recipe book) -> place it -> sticks and a wooden pickaxe at
//   the workbench -> chest -> store items -> reopen -> break it and get
//   everything back.
//
//   node crafting.mjs [api base] [game base]

import assert from "node:assert/strict";

import { Bot, registerPlayer } from "./bot.mjs";

const API = process.argv[2] ?? "http://127.0.0.1:8080";
const GAME = process.argv[3] ?? API;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);

const content = await (await fetch(`${GAME}/platform/content`)).json();
const block = (key) => content.blocks.find((b) => b.key === key);
const item = (key) => content.items.find((i) => i.key === key);
const EYE = 1.425;

const name = `craft_${Date.now().toString(36)}`;
const bot = new Bot({ api: API, game: GAME, token: await registerPlayer(API, name), name });
await bot.connect();
bot.requestChunks(2);
for (let i = 0; i < 100 && bot.chunks.size < 25; i++) await sleep(200);
step(`joined as ${name} with ${bot.chunks.size} chunks`);

// Find the lowest log of a trunk near the spawn.
const LOG = block("oak_log").id;
let trunk = null;
search: for (let r = 0; r < 40; r++) {
  for (let x = -r; x <= r; x++) {
    for (let z = -r; z <= r; z++) {
      if (Math.max(Math.abs(x), Math.abs(z)) !== r) continue;
      for (let y = 60; y < 130; y++) {
        if (bot.voxel(x, y, z) === LOG && bot.voxel(x, y - 1, z) !== LOG && bot.voxel(x, y + 4, z) === LOG) {
          trunk = [x, y, z];
          break search;
        }
      }
    }
  }
}
assert.ok(trunk, "a tree near the spawn");
const [tx, ty, tz] = trunk;
await bot.moveTo([tx + 0.5, ty + EYE + 0.05, tz + 0.5], 12);
await sleep(5500); // join grace period, so moving around is not a fall
step(`standing in the trunk at ${trunk.join(",")}`);

// Chop five logs bottom-up while standing in the column; drops fall to our feet.
const logItem = item("oak_log").id;
const mine = async (voxel) => {
  bot.call("platform.mine.start", { voxel });
  const started = await bot.result("mine.start");
  assert.equal(started.ok, true, `mine.start ${started.code}`);
  const b = content.blocks.find((x) => x.id === bot.voxel(...voxel));
  await sleep(Math.round(b.hardness * 1.5 * 1000) + 150);
  bot.call("platform.mine.finish", { voxel });
  const done = await bot.result("mine.finish");
  assert.equal(done.ok, true, `mine.finish ${done.code}`);
};
for (let i = 0; i < 5; i++) {
  await mine([tx, ty + i, tz]);
  await bot.moveTo([tx + 0.5, ty + EYE + 0.05, tz + 0.5]);
  const want = i + 1;
  for (let t = 0; t < 40 && bot.count(logItem) < want; t++) await sleep(100);
  assert.equal(bot.count(logItem), want, `picked up log ${want}`);
}
step("chopped 5 logs by hand and picked them up");

// Inventory screen: logs into the 2x2 grid, shift-take all planks.
const planks = item("planks").id;
bot.call("platform.window.open", {});
let w = await bot.event("platform.window", (p) => p.kind === "player");
const inv = w.inventoryStart;
bot.call("platform.window.click", { slot: inv + bot.slotOf(logItem), click: { type: "left" } });
w = await bot.event("platform.window", (p) => p.cursor);
bot.call("platform.window.click", { slot: 1, click: { type: "left" } });
w = await bot.event("platform.window", (p) => p.slots[0]);
assert.equal(w.slots[0].item, planks, "the 2x2 grid shows planks");
bot.call("platform.window.click", { slot: 0, click: { type: "shift" } });
await bot.event("platform.window", (p) => !p.slots[1]);
await sleep(200);
assert.equal(bot.count(planks), 20);
step("crafted 20 planks in the inventory grid (shift-click)");

// Recipe book: a workbench.
bot.call("platform.window.fill", { recipe: "crafting_table", max: false });
w = await bot.event("platform.window", (p) => p.slots[0]?.item === item("crafting_table").id);
bot.call("platform.window.click", { slot: 0, click: { type: "left" } });
w = await bot.event("platform.window", (p) => p.cursor?.item === item("crafting_table").id);
// Put it into hotbar slot 0 explicitly.
bot.call("platform.window.click", { slot: inv + 8, click: { type: "left" } });
await bot.event("platform.window", (p) => !p.cursor);
bot.call("platform.window.close", {});
await bot.event("platform.window", (p) => p.kind === null);
await sleep(200);
assert.equal(bot.count(item("crafting_table").id), 1);
step("made a workbench from the recipe book");

// A free cell next to the trunk with solid ground under it.
const solidId = (id) => content.blocks.find((b) => b.id === id)?.collision && !content.blocks.find((b) => b.id === id)?.fluid;
const used = [];
const freeSpot = () => {
  for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2], [2, -2], [-2, 2], [3, 0], [0, 3], [-3, 0], [0, -3]]) {
    for (const dy of [0, 1, -1]) {
      const at = [tx + dx, ty + dy, tz + dz];
      const here = bot.voxel(...at);
      const free = here === 0 || content.blocks.find((b) => b.id === here)?.collision === false;
      if (free && solidId(bot.voxel(at[0], at[1] - 1, at[2])) && !used.some((u) => u.join() === at.join())) {
        used.push(at);
        return at;
      }
    }
  }
  throw new Error("no free spot near the tree");
};

// 3x3 recipes need a workbench.
const benchAt = freeSpot();
bot.call("platform.build.place", { voxel: benchAt, slot: 8 });
assert.equal((await bot.result("build.place")).ok, true);
bot.call("platform.window.open", { voxel: benchAt });
w = await bot.event("platform.window", (p) => p.kind === "workbench");
for (const recipe of ["stick", "wooden_pickaxe", "chest"]) {
  bot.call("platform.window.fill", { recipe, max: false });
  w = await bot.event("platform.window", (p) => p.slots[0]?.item === item(recipe).id);
  bot.call("platform.window.click", { slot: 0, click: { type: "shift" } });
  await bot.event("platform.window", (p) => !p.slots[0]);
}
bot.call("platform.window.close", {});
await bot.event("platform.window", (p) => p.kind === null);
await sleep(200);
assert.ok(bot.count(item("wooden_pickaxe").id) >= 1, "a wooden pickaxe");
assert.ok(bot.count(item("stick").id) >= 2, "spare sticks");
assert.equal(bot.count(item("chest").id), 1);
step(`at the workbench: sticks, a wooden pickaxe and a chest (planks left: ${bot.count(planks)})`);

// A chest keeps items, also across reopening.
const chestAt = freeSpot();
bot.call("platform.build.place", { voxel: chestAt, slot: bot.slotOf(item("chest").id) });
assert.equal((await bot.result("build.place")).ok, true);
bot.call("platform.window.open", { voxel: chestAt });
w = await bot.event("platform.window", (p) => p.kind === "chest");
const stickSlot = w.inventoryStart + bot.slotOf(item("stick").id);
bot.call("platform.window.click", { slot: stickSlot, click: { type: "shift" } });
w = await bot.event("platform.window", (p) => p.slots.slice(0, 27).some((s) => s?.item === item("stick").id));
bot.call("platform.window.close", {});
await bot.event("platform.window", (p) => p.kind === null);
bot.call("platform.window.open", { voxel: chestAt });
w = await bot.event("platform.window", (p) => p.kind === "chest");
const stored = w.slots.slice(0, 27).filter(Boolean).reduce((n, s) => n + s.count, 0);
assert.ok(stored >= 2, "the chest kept the sticks");
bot.call("platform.window.close", {});
await bot.event("platform.window", (p) => p.kind === null);
step(`stored ${stored} sticks in the chest and found them after reopening`);

// Breaking the chest spills its contents and drops the chest itself.
const sticksBefore = bot.count(item("stick").id);
await bot.moveTo([chestAt[0] + 0.5, chestAt[1] + 1 + EYE + 0.05, chestAt[2] + 0.5], 2);
await mine(chestAt);
await bot.moveTo([chestAt[0] + 0.5, chestAt[1] + EYE + 0.05, chestAt[2] + 0.5], 2);
for (let t = 0; t < 60 && !(bot.count(item("chest").id) === 1 && bot.count(item("stick").id) === sticksBefore + stored); t++) {
  await sleep(100);
  // walk around the spot to collect the scattered stacks
  const a = t * 0.7;
  await bot.moveTo([chestAt[0] + 0.5 + Math.cos(a) * 0.8, chestAt[1] + EYE + 0.05, chestAt[2] + 0.5 + Math.sin(a) * 0.8]);
}
assert.equal(bot.count(item("chest").id), 1, "the chest came back");
assert.equal(bot.count(item("stick").id), sticksBefore + stored, "and its contents too");
step("broke the chest: got the chest and its contents back");

// Furnace: dig for stone with the pickaxe, craft a furnace, smelt.
bot.call("platform.window.open", {});
w = await bot.event("platform.window", (p) => p.kind === "player");
bot.call("platform.window.click", {
  slot: w.inventoryStart + bot.slotOf(item("wooden_pickaxe").id),
  click: { type: "hotbar", key: 0 },
});
await bot.event("platform.window", (p) => p.slots[p.inventoryStart]?.item === item("wooden_pickaxe").id);
bot.call("platform.window.close", {});
await bot.event("platform.window", (p) => p.kind === null);
bot.call("platform.inventory.select", { slot: 0 });
await bot.result("inventory.select");

const rubble = item("rubble").id;
let depth = ty - 1;
while (bot.count(rubble) < 10 && depth > ty - 40) {
  const id = bot.voxel(tx, depth, tz);
  if (id !== 0 && content.blocks.find((b) => b.id === id)?.hardness >= 0) {
    await bot.moveTo([tx + 0.5, depth + 1 + EYE + 0.05, tz + 0.5]);
    await mine([tx, depth, tz]);
  }
  await bot.moveTo([tx + 0.5, depth + EYE + 0.05, tz + 0.5]);
  await sleep(700);
  depth -= 1;
}
assert.ok(bot.count(rubble) >= 9, `rubble: ${bot.count(rubble)}`);
step(`dug down ${ty - 1 - depth} blocks with the pickaxe: ${bot.count(rubble)} rubble`);

for (let y = depth + 1; y <= ty + 1; y += 4) await bot.moveTo([tx + 0.5, y + EYE, tz + 0.5]);
await bot.moveTo([benchAt[0] + 0.5, benchAt[1] + 1 + EYE + 0.05, benchAt[2] + 0.5], 3);
await sleep(300);
bot.call("platform.window.open", { voxel: benchAt });
await bot.event("platform.window", (p) => p.kind === "workbench");
bot.call("platform.window.fill", { recipe: "furnace", max: false });
await bot.event("platform.window", (p) => p.slots[0]?.item === item("furnace").id);
bot.call("platform.window.click", { slot: 0, click: { type: "shift" } });
await bot.event("platform.window", (p) => !p.slots[0]);
bot.call("platform.window.close", {});
await bot.event("platform.window", (p) => p.kind === null);
await sleep(200);
assert.equal(bot.count(item("furnace").id), 1);
step("crafted a furnace from 8 rubble");

const furnaceAt = freeSpot();
bot.call("platform.build.place", { voxel: furnaceAt, slot: bot.slotOf(item("furnace").id) });
assert.equal((await bot.result("build.place")).ok, true);
bot.call("platform.window.open", { voxel: furnaceAt });
w = await bot.event("platform.window", (p) => p.kind === "furnace");
bot.call("platform.window.click", { slot: w.inventoryStart + bot.slotOf(rubble), click: { type: "shift" } });
w = await bot.event("platform.window", (p) => p.slots[0]?.item === rubble);
bot.call("platform.window.click", { slot: w.inventoryStart + bot.slotOf(planks), click: { type: "shift" } });
w = await bot.event("platform.window", (p) => p.slots[1]?.item === planks || p.furnace?.burnLeft > 0);
const smelted = await bot.event("platform.window", (p) => p.kind === "furnace" && p.slots[2]?.item === item("stone").id, 20000);
assert.ok(smelted.furnace.burnTotal > 0, "the furnace burned fuel");
bot.call("platform.window.click", { slot: 2, click: { type: "shift" } });
await bot.event("platform.window", (p) => !p.slots[2]);
bot.call("platform.window.close", {});
await bot.event("platform.window", (p) => p.kind === null);
await sleep(200);
assert.ok(bot.count(item("stone").id) >= 1);
step("smelted rubble into stone with planks as fuel");

bot.close();
console.log("crafting test passed");
process.exit(0);
