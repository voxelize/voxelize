// The Ocean on a live server: a creative builder raises a tidestone frame
// and lights it into a Tide Gate; a survival player walks through it and
// arrives in a glass air dome on the seafloor, dry, with the sea standing
// all around and far above. Kelp, sea grass, coral and sand cover the
// floor; the traveller gets a first breath of water breathing, swims out,
// harvests kelp underwater without losing air, and walks back home.
//
//   DEV_TICKET_SECRET=<a game ticket secret> node ocean.mjs - http://127.0.0.1:4000
// Against a game server with GAME_ANTICHEAT=off (bots set their positions).

import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

import { Bot } from "./bot.mjs";

const GAME = process.argv[3] ?? "http://127.0.0.1:4000";
assert.ok(process.env.DEV_TICKET_SECRET, "DEV_TICKET_SECRET");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);
const content = await (await fetch(`${GAME}/platform/content`)).json();
const info = await (await fetch(`${GAME}/platform/info`)).json();
const OCEAN = info.dimensions?.ocean;
assert.ok(OCEAN, `the server hosts the Ocean: ${JSON.stringify(info.dimensions)}`);
const id = (key) => content.blocks.find((b) => b.key === key).id;
const item = (key) => content.items.find((i) => i.key === key).id;
const def = (v) => content.blocks.find((b) => b.id === v);
const EYE = 1.425;
const SURFACE = 120;
const WATERLOGGED = 1 << 28;
const tag = Date.now().toString(36).slice(-5);
const b64 = (d) => Buffer.from(d).toString("base64url");
const ticket = (name, realm) => () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: "platform-api", aud: "game", sub: `pl_${name}`, name, world: "main", realm, roles: ["player"], iat: now, exp: now + 60, jti: randomUUID() };
  const signed = `v1.${b64(JSON.stringify(claims))}`;
  return `${signed}.${createHmac("sha256", process.env.DEV_TICKET_SECRET).update(signed).digest("base64url")}`;
};
const join = async (name, realm) => {
  const bot = new Bot({ api: "-", game: GAME, name, issueTicket: ticket(name, realm) });
  bot.vitals = null;
  bot.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.vitals" && ((bot.vitals = m.payload), false), resolve() {} });
  await bot.connect();
  return bot;
};
const call = async (bot, intent, payload = {}) => {
  bot.call(`platform.${intent}`, payload);
  const r = await bot.result(intent);
  assert.equal(r.ok, true, `${intent}: ${JSON.stringify(r)}`);
  return r;
};
const until = async (test, what, tries = 100) => {
  for (let i = 0; i < tries && !test(); i++) await sleep(150);
  assert.ok(test(), what);
};
const loadAround = async (bot, [x, y, z]) => {
  await bot.moveTo([x + 0.5, y + EYE, z + 0.5], 8);
  bot.requestChunks(1);
  for (let i = 0; i < 100 && bot.voxel(x, y, z) === null; i++) await sleep(200);
};
const solid = (v) => v !== null && v !== 0 && def(v)?.collision !== false && def(v)?.fluid == null;

// 1. A creative builder raises and lights the gate in the overworld.
const builder = await join(`cr_${tag}`, "creative");
builder.requestChunks(2);
for (let i = 0; i < 100 && builder.chunks.size < 25; i++) await sleep(200);
let base = null;
search: for (let x = 2; x < 30; x++) {
  for (let z = 2; z < 30; z++) {
    const top = builder.surface(x, z, (v) => solid(v));
    if (top === null) continue;
    let ok = true;
    for (let dx = 0; dx < 4 && ok; dx++)
      for (let dz = -1; dz <= 1 && ok; dz++) {
        ok = solid(builder.voxel(x + dx, top, z + dz));
        for (let dy = 1; dy <= 6 && ok; dy++) ok = builder.voxel(x + dx, top + dy, z + dz) === 0;
      }
    if (ok) {
      base = [x, top + 1, z];
      break search;
    }
  }
}
assert.ok(base, "flat ground for the gate");
const [bx, by, bz] = base;
await builder.moveTo([bx + 1.5, by + EYE, bz + 3.5], 12);
await sleep(5500);
await call(builder, "inventory.creative", { slot: 0, item: "tidestone" });
await call(builder, "inventory.creative", { slot: 1, item: "fire_striker" });
for (let dx = 0; dx < 4; dx++)
  for (let dy = 0; dy < 5; dy++)
    if (dx === 0 || dx === 3 || dy === 0 || dy === 4) await call(builder, "build.place", { voxel: [bx + dx, by + dy, bz], slot: 0 });
await call(builder, "inventory.select", { slot: 1 });
const lit = await call(builder, "use", { voxel: [bx + 1, by, bz] });
assert.equal(lit.changed, 6, "six cells of the tide");
step("a tidestone frame lights into a Tide Gate");
builder.close();

// 2. A survival player walks through into the Ocean, into a dome.
const sea = await join(`se_${tag}`, "survival");
sea.requestChunks(1);
await sleep(5500); // join grace
await sea.moveTo([bx + 1.5, by + EYE, bz + 0.5], 12);
const { world } = await sea.event("platform.travel", () => true, 20000);
assert.equal(world, OCEAN);
const placed = sea.event("platform.teleport", () => true, 90000);
const breath = sea.event("platform.vitals", (v) => v.effects?.some((e) => e.kind === "water_breathing"), 90000);
await sea.switchWorld(world);
const { feet } = await placed;
await loadAround(sea, feet);
sea.requestChunks(2);
await sleep(2500);
const [fx, fy, fz] = feet;
assert.ok(fy < SURFACE - 8, `arrived deep below the surface: ${feet}`);
// Standing in the gate's light, in dry air.
assert.equal(sea.voxel(fx, fy, fz), id("tide_rift"), "arrived in the Tide Gate");
for (let dz = -1; dz <= 1; dz += 2) for (let dy = 1; dy < 4; dy++) assert.equal(sea.voxel(fx, fy + dy, fz + dz), 0, "dry air around the gate");
let glass = 0;
for (let dx = -9; dx <= 9; dx++) for (let dy = 0; dy <= 9; dy++) for (let dz = -9; dz <= 9; dz++) glass += sea.voxel(fx + dx, fy + dy, fz + dz) === id("glass");
assert.ok(glass > 200, `a glass dome around the arrival: ${glass}`);
let waterAbove = 0;
for (let y = fy + 10; y <= SURFACE; y++) waterAbove += sea.voxel(fx, y, fz) === id("water");
assert.ok(waterAbove >= SURFACE - fy - 12, `the sea stands above the dome: ${waterAbove}`);
step(`arrived dry in an air dome at ${feet}, ${waterAbove} blocks of sea overhead`);

// 3. Everything lies under the sea: floor and life all around.
const counts = {};
for (let dx = -28; dx <= 28; dx++)
  for (let dz = -28; dz <= 28; dz++) {
    for (let y = 1; y <= SURFACE + 4; y++) {
      const raw = sea.raw(fx + dx, y, fz + dz);
      if (raw === null) continue;
      const key = def(raw & 0xffff)?.key;
      if (!key) continue;
      counts[key] = (counts[key] ?? 0) + 1;
      if (key === "kelp" || key === "sea_grass") assert.ok(raw & WATERLOGGED, `${key} stands in water`);
      if (y > SURFACE) assert.fail(`nothing above the sea: ${key} at ${y}`);
    }
  }
const life = ["kelp", "sea_grass", "coral_red", "coral_blue", "coral_gold", "glow_anemone", "giant_clam", "bubble_vent"].reduce((n, k) => n + (counts[k] ?? 0), 0);
assert.ok((counts.water ?? 0) > 50000, `a sea: ${counts.water}`);
assert.ok(life > 50, `sea life on the floor: ${JSON.stringify(counts)}`);
step(`a sea of ${counts.water} water blocks over ${life} kelp, grass, coral, anemones and clams`);

// 4. A first breath: water breathing, then harvesting kelp underwater.
await breath;
step("the arrival is given water breathing");
const kelpAt = [];
for (let dx = -40; dx <= 40; dx++)
  for (let dz = -40; dz <= 40; dz++)
    for (let y = 1; y < SURFACE; y++)
      if (Math.max(Math.abs(dx), Math.abs(dz)) > 9 && sea.voxel(fx + dx, y, fz + dz) === id("kelp") && sea.voxel(fx + dx, y - 1, fz + dz) !== id("kelp"))
        kelpAt.push([fx + dx, y, fz + dz]);
kelpAt.sort((a, b) => Math.hypot(a[0] - fx, a[2] - fz) - Math.hypot(b[0] - fx, b[2] - fz));
assert.ok(kelpAt.length, `kelp to harvest: ${counts.kelp}`);
const [kx, ky, kz] = kelpAt[0];
// Swim over, past the dome: up, across, and down beside the kelp.
for (const p of [[fx, fy + 12, fz], [kx, fy + 12, kz], [kx + 0.5, ky + 1, kz + 1.5]]) await sea.moveTo([p[0] + 0.5, p[1] + EYE, p[2] + 0.5], 4);
await sleep(1500);
sea.call("platform.mine.start", { voxel: [kx, ky, kz] });
assert.equal((await sea.result("mine.start")).ok, true);
await sleep(300);
sea.call("platform.mine.finish", { voxel: [kx, ky, kz] });
const done = await sea.result("mine.finish");
assert.equal(done.ok, true, `mine.finish ${done.code}`);
for (let t = 0; t < 40 && sea.count(item("kelp")) === 0; t++) {
  await sea.moveTo([kx + 0.5, ky + EYE, kz + 0.5]);
  await sleep(150);
}
assert.ok(sea.count(item("kelp")) > 0, "picked up the kelp");
await sleep(4000);
assert.equal(sea.vitals.air, sea.vitals.maxAir, `breath held underwater: ${JSON.stringify(sea.vitals)}`);
step("harvested kelp underwater and kept breathing");

sea.close();
console.log("ocean: all checks passed");
process.exit(0);
