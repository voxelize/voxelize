// Creatures on a live server: wait for animals to spawn, walk up to one,
// fight it with server-validated attacks and collect what it drops.
//
//   node combat.mjs [api base] [game base]

import assert from "node:assert/strict";

import { Bot, registerPlayer } from "./bot.mjs";

const API = process.argv[2] ?? "http://127.0.0.1:8080";
const GAME = process.argv[3] ?? API;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);
const content = await (await fetch(`${GAME}/platform/content`)).json();
const EYE = 1.425;

const name = `hunter_${Date.now().toString(36)}`;
const bot = new Bot({ api: API, game: GAME, token: await registerPlayer(API, name), name });
await bot.connect();
bot.requestChunks(3);
for (let i = 0; i < 100 && bot.chunks.size < 40; i++) await sleep(200);
const solid = (id) => content.blocks.find((b) => b.id === id)?.collision;
const surface = (x, z) => bot.surface(x, z, solid);
const y0 = surface(0, 0);
await bot.moveTo([0.5, y0 + 1 + EYE, 0.5], 12);
step(`joined at the surface (y ${y0 + 1})`);

const passive = new Set(content.mobs.filter((m) => m.kind === "passive").map((m) => m.key));
let prey = null;
for (let t = 0; t < 120 && !prey; t++) {
  await sleep(1000);
  prey = (bot.mobs ?? []).find((m) => passive.has(m.key) && !m.baby);
}
assert.ok(prey, "an animal spawned within two minutes");
const def = content.mobs.find((m) => m.key === prey.key);
step(`found a ${def.name} (${prey.health} health) at ${prey.p.map(Math.round).join(",")}`);

const before = new Map(def.drops.map((d) => [d.item, bot.count(content.items.find((i) => i.key === d.item).id)]));
let hits = 0;
for (let t = 0; t < 120; t++) {
  const mob = (bot.mobs ?? []).find((m) => m.id === prey.id);
  if (!mob) break;
  // Walk next to it, in steps the server accepts.
  const [mx, my, mz] = mob.p;
  await bot.moveTo([mx - 1.2, my + EYE, mz], 2);
  bot.call("platform.attack", { mob: prey.id });
  const r = await bot.result("attack");
  if (r.ok) hits++;
  else assert.ok(["too_fast", "out_of_reach"].includes(r.code), `attack refused: ${r.code}`);
  await sleep(550);
}
assert.ok(!(bot.mobs ?? []).some((m) => m.id === prey.id), "the animal died");
step(`killed it in ${hits} hits by hand`);

// Walk over the drops.
for (let t = 0; t < 40; t++) {
  const near = (bot.drops ?? []).filter((d) => Math.hypot(d.p[0] - bot.position[0], d.p[2] - bot.position[2]) < 6);
  if (!near.length) break;
  const d = near[0];
  await bot.moveTo([d.p[0], d.p[1] + EYE, d.p[2]], 2);
  await sleep(300);
}
const gained = def.drops
  .map((d) => {
    const item = content.items.find((i) => i.key === d.item);
    return [item.name, bot.count(item.id) - before.get(d.item)];
  })
  .filter(([, n]) => n > 0);
step(`collected: ${gained.map(([n, c]) => `${c}× ${n}`).join(", ") || "nothing (drops can be zero)"}`);
bot.close();
console.log("combat test passed");
process.exit(0);
