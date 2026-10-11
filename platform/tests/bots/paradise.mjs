// Paradise on a live server: a creative builder raises a halo-stone frame
// and lights it into a Gate of Light; two survival players walk through it
// into Paradise, find radiant meadows over pearlstone, never go hungry, meet
// angels that cannot be harmed, and earn virtue: breaking the world costs
// (Fallen at first), building it back earns, and gifts through the trade
// window earn more, until one rises to Seeker and everyone is told.
//
//   DEV_TICKET_SECRET=<a game ticket secret> node paradise.mjs - http://127.0.0.1:4000
// Against a game server with a backend (trades need it) and
// GAME_ANTICHEAT=off (bots set their positions).

import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

import { Bot } from "./bot.mjs";

const GAME = process.argv[3] ?? "http://127.0.0.1:4000";
assert.ok(process.env.DEV_TICKET_SECRET, "DEV_TICKET_SECRET");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);
const content = await (await fetch(`${GAME}/platform/content`)).json();
const info = await (await fetch(`${GAME}/platform/info`)).json();
const PARADISE = info.dimensions?.paradise;
assert.ok(PARADISE, `the server hosts Paradise: ${JSON.stringify(info.dimensions)}`);
const id = (key) => content.blocks.find((b) => b.key === key).id;
const item = (key) => content.items.find((i) => i.key === key).id;
const def = (v) => content.blocks.find((b) => b.id === v);
const EYE = 1.425;
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
  bot.lines = [];
  bot.virtue = null;
  bot.tags = new Map();
  bot.vitals = null;
  bot.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.chat" && (bot.lines.push(m.payload.body), false), resolve() {} });
  bot.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.vitals" && ((bot.vitals = m.payload), false), resolve() {} });
  bot.waiters.push({
    match: (m) => {
      if (m.type !== "EVENT" || m.name !== "platform.virtue") return false;
      if (m.payload.players) for (const t of m.payload.players) bot.tags.set(t.id, t);
      else if (m.payload.blessing) bot.blessing = m.payload.blessing;
      else bot.virtue = m.payload;
      return false;
    },
    resolve() {},
  });
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
const travel = async (bot) => {
  const { world } = await bot.event("platform.travel", () => true, 20000);
  const placed = bot.event("platform.teleport", () => true, 90000);
  await bot.switchWorld(world);
  const { feet } = await placed;
  await loadAround(bot, feet);
  return { world, feet };
};

// 1. A creative builder raises and lights the gate in the overworld.
const builder = await join(`cr_${tag}`, "creative");
builder.requestChunks(2);
for (let i = 0; i < 100 && builder.chunks.size < 25; i++) await sleep(200);
const solid = (v) => v !== null && v !== 0 && def(v)?.collision !== false && def(v)?.fluid == null;
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
await call(builder, "inventory.creative", { slot: 0, item: "halo_stone" });
await call(builder, "inventory.creative", { slot: 1, item: "fire_striker" });
for (let dx = 0; dx < 4; dx++)
  for (let dy = 0; dy < 5; dy++)
    if (dx === 0 || dx === 3 || dy === 0 || dy === 4) await call(builder, "build.place", { voxel: [bx + dx, by + dy, bz], slot: 0 });
await call(builder, "inventory.select", { slot: 1 });
const lit = await call(builder, "use", { voxel: [bx + 1, by, bz] });
assert.equal(lit.changed, 6, "six cells of light");
step("a halo-stone frame lights into a Gate of Light");
builder.close();

// 2. Two survival players walk through it into Paradise.
const enter = async (name) => {
  const bot = await join(name, "survival");
  bot.requestChunks(1);
  await sleep(5500); // join grace
  await bot.moveTo([bx + 1.5, by + EYE, bz + 0.5], 12);
  const arrived = await travel(bot);
  assert.equal(arrived.world, PARADISE);
  await sleep(1500);
  return [bot, arrived.feet];
};
const [ann, annFeet] = await enter(`an_${tag}`);
const [bob, bobFeet] = await enter(`bo_${tag}`);
assert.ok(annFeet[1] > 70 && bobFeet[1] > 70, `arrived on dry meadow, above the rivers: ${annFeet}`);
let radiant = 0;
let glowing = 0;
for (let dx = -12; dx <= 12; dx++)
  for (let dy = -6; dy <= 8; dy++)
    for (let dz = -12; dz <= 12; dz++) {
      const v = ann.voxel(annFeet[0] + dx, annFeet[1] + dy, annFeet[2] + dz);
      if ([id("radiant_turf"), id("golden_loam"), id("pearlstone")].includes(v)) radiant++;
      if (v && def(v)?.lightEmission >= 5) glowing++;
    }
assert.ok(radiant > 100, `radiant meadow around the arrival: ${radiant}`);
assert.ok(glowing > 50, `everything glows: ${glowing} luminous blocks`);
step(`both walked into Paradise at ${annFeet}: ${radiant} meadow blocks, ${glowing} glowing`);

await until(() => ann.virtue?.title === "Pilgrim", `ann starts as a Pilgrim: ${JSON.stringify(ann.virtue)}`);
step("every soul starts as a Pilgrim");

// 3. Breaking the world costs: ann digs 40 blocks of meadow.
const loam = item("golden_loam");
const dig = [];
ann.requestChunks(2);
await sleep(2000);
for (let r = 3; dig.length < 40 && r < 20; r++)
  for (let dx = -r; dx <= r && dig.length < 40; dx++)
    for (const dz of [-r, r]) {
      const [x, z] = [annFeet[0] + dx, annFeet[2] + dz];
      if (dig.some(([a, , c]) => a === x && c === z)) continue;
      const top = ann.surface(x, z, (v) => solid(v));
      if (top !== null && [id("radiant_turf"), id("golden_loam")].includes(ann.voxel(x, top, z)) && dig.length < 40) dig.push([x, top, z]);
    }
assert.ok(dig.length >= 40, `meadow to dig: ${dig.length}`);
for (const [x, y, z] of dig) {
  await ann.moveTo([x + 0.5, y + 1 + EYE, z + 0.5], 6);
  ann.call("platform.mine.start", { voxel: [x, y, z] });
  assert.equal((await ann.result("mine.start")).ok, true);
  await sleep(Math.round(def(ann.voxel(x, y, z)).hardness * 1.5 * 1000) + 150);
  ann.call("platform.mine.finish", { voxel: [x, y, z] });
  const done = await ann.result("mine.finish");
  assert.equal(done.ok, true, `mine.finish ${done.code}`);
  const before = ann.count(loam);
  for (let t = 0; t < 30 && ann.count(loam) <= before; t++) {
    await ann.moveTo([x + 0.5, y + EYE, z + 0.5]);
    await sleep(100);
  }
}
await until(() => ann.count(loam) >= 40, `picked up the loam: ${ann.count(loam)}`);
await until(() => ann.virtue?.points === -40, `breaking costs: ${JSON.stringify(ann.virtue)}`);
assert.equal(ann.virtue.title, "Fallen");
await until(() => ann.lines.some((l) => l.includes("falls to Fallen")), "the fall is announced");
step("digging 40 blocks of Paradise cost 40 virtue: Fallen");

// 4. Building earns: ann puts 20 back.
const slot = () => ann.slotOf(loam);
for (const [x, y, z] of dig.slice(0, 20)) {
  await ann.moveTo([x + 2.5, y + 1 + EYE, z + 0.5], 4);
  await call(ann, "build.place", { voxel: [x, y, z], slot: slot() });
}
await until(() => ann.virtue?.points === 0, `building earns: ${JSON.stringify(ann.virtue)}`);
assert.equal(ann.virtue.title, "Pilgrim");
step("building 20 blocks back earned 40 virtue: a Pilgrim again");

// 5. Gifts earn more: two gifts of ten loam to bob, nothing taken.
const annId = `pl_${ann.name}`;
const bobId = `pl_${bob.name}`;
const keepClose = setInterval(() => {
  ann.moveTo([annFeet[0] + 0.5, annFeet[1] + EYE, annFeet[2] + 0.5]);
  bob.moveTo([annFeet[0] + 2.5, annFeet[1] + EYE, annFeet[2] + 0.5]);
}, 400);
await sleep(800);
for (let gift = 0; gift < 2; gift++) {
  const invited = bob.event("platform.trade", (e) => e.invite, 8000);
  await call(ann, "trade.request", { player: bobId });
  await invited;
  const opened = ann.event("platform.trade", (e) => e.trade, 8000);
  await call(bob, "trade.accept", { player: annId });
  await opened;
  await call(ann, "trade.offer", { items: [{ slot: slot(), count: 10 }], crowns: 0 });
  const done = [ann, bob].map((b) => b.event("platform.trade", (e) => e.ended === "done", 15000));
  await call(ann, "trade.confirm");
  await call(bob, "trade.confirm");
  await Promise.all(done);
}
clearInterval(keepClose);
await until(() => ann.virtue?.points === 60, `gifts earn: ${JSON.stringify(ann.virtue)}`);
assert.equal(ann.virtue.title, "Seeker");
await until(() => bob.lines.some((l) => l.includes(`${ann.name} rises to Seeker`)), `everyone hears of it: ${JSON.stringify(bob.lines)}`);
await until(() => bob.tags.get(annId)?.title === "Seeker", "bob sees ann's new title");
step("two gifts of ten earned 60: ann rises to Seeker and everyone is told");
await until(() => ann.blessing?.title === "Seeker", `a blessing for the new Seeker: ${JSON.stringify(ann.blessing)}`);
await until(() => ann.count(item("golden_fruit")) >= 4 && ann.count(item("honey_bottle")) >= 2, "the gifts are in the inventory");
step(`blessed as a Seeker: ${ann.blessing.gifts.map((g) => `${g.count} ${g.name}`).join(", ")}`);

// 6. No hunger in Paradise, and angels that cannot be harmed.
assert.equal(bob.vitals?.food ?? 20, 20, "never hungry here");
await until(() => (ann.mobs ?? []).some((m) => m.key === "angel"), "angels appear", 400);
const angel = ann.mobs.find((m) => m.key === "angel");
const health = angel.health;
ann.call("platform.attack", { mob: angel.id });
await ann.result("attack");
await sleep(600);
const after = (ann.mobs ?? []).find((m) => m.id === angel.id);
assert.ok(after, "the angel is still here");
if (typeof health === "number") assert.equal(after.health, health, "and unhurt");
step("angels fly here, and nothing can harm them");

ann.close();
bob.close();
console.log("paradise: all checks passed");
process.exit(0);
