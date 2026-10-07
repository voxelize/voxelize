// Guild buildings, ranks, war and sieges end to end: the leader gives a
// member a rank that lets them manage land, and that member places a town
// hall the leader uses as their respawn point; two vaults share one
// inventory; vaults stay out of the wilderness; players of guilds at peace
// cannot hurt each other; a war is declared, kills are scored, the leader
// respawns at the town hall; a siege banner held on the village (contested
// while a defender stands by) captures the land; the leaders make peace.
//
// Standalone only (starting goods are written into player records), with
// the war warm-up off (GUILD_WAR_WARMUP_MINUTES=0 for the API) and short
// sieges (GAME_SIEGE_SECONDS=8 for the game server):
//   SAVE_DIR=... FUND_CMD='php artisan economy:grant {player} {player} 2000 --reason=t' \
//     node diplomacy.mjs <api base> <game base>

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

import { api, Bot, registerPlayer } from "./bot.mjs";

const API = process.argv[2] ?? "http://127.0.0.1:8080";
const GAME = process.argv[3] ?? API;
assert.ok(process.env.FUND_CMD && process.env.SAVE_DIR, "FUND_CMD and SAVE_DIR");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);
const key = () => randomUUID().replace(/-/g, "");
const content = await (await fetch(`${GAME}/platform/content`)).json();
const item = (k) => content.items.find((i) => i.key === k);
const block = (k) => content.blocks.find((b) => b.key === k);
const EYE = 1.425;

const stamp = Date.now().toString(36).slice(-5);
const names = { ann: `da_${stamp}`, amy: `dm_${stamp}`, bob: `db_${stamp}` };
const tokens = {};
for (const [who, name] of Object.entries(names)) tokens[who] = await registerPlayer(API, name);
for (const who of ["ann", "bob"]) execSync(process.env.FUND_CMD.replaceAll("{player}", names[who]), { stdio: "inherit", shell: "/bin/sh" });
const as = (who) => (path, opts = {}) => api(API, path, { token: tokens[who], ...opts });
const ids = {};
for (const who of Object.keys(names)) ids[who] = (await as(who)("/me")).user.id;
const seed = (who, slots) => {
  const all = Array(36).fill(null);
  slots.forEach((s, i) => (all[i] = s));
  mkdirSync(`${process.env.SAVE_DIR}/main/players`, { recursive: true });
  writeFileSync(`${process.env.SAVE_DIR}/main/players/${ids[who]}.json`, JSON.stringify({ version: 1, id: ids[who], inventory: { slots: all, selected: 0 }, position: null }));
};
seed("amy", [{ item: item("iron_sword").id, count: 1, durability: 250 }, { item: item("guild_vault").id, count: 3 }, { item: item("bread").id, count: 5 }, { item: item("guild_hall").id, count: 1 }]);
seed("bob", [{ item: item("iron_sword").id, count: 1, durability: 250 }, { item: item("siege_banner").id, count: 1 }]);

// Two guilds; Alpha has a village near spawn.
const found = async (who, name, tag) => (await as(who)("/guilds", { headers: { "Idempotency-Key": key() }, body: { name, tag } })).guild;
const alpha = await found("ann", `Alpha ${stamp}`, `A${stamp.slice(0, 3)}`.toUpperCase());
const bravo = await found("bob", `Bravo ${stamp}`, `B${stamp.slice(0, 3)}`.toUpperCase());
await as("ann")(`/guilds/${alpha.id}/invites`, { body: { player: names.amy } });
await as("amy")(`/guilds/${alpha.id}/join`, { body: {} });
await as("ann")(`/guilds/${alpha.id}/deposit`, { headers: { "Idempotency-Key": key() }, body: { amount: 1200 } });

const connect = async (who) => {
  const bot = new Bot({ api: API, game: GAME, token: tokens[who], name: names[who] });
  await bot.connect();
  bot.requestChunks(1);
  for (let i = 0; i < 100 && bot.chunks.size < 9; i++) await sleep(200);
  return bot;
};
const bots = { ann: await connect("ann"), amy: await connect("amy"), bob: await connect("bob") };
const solid = (v) => { const d = content.blocks.find((b) => b.id === v); return !!d && d.collision !== false && d.fluid == null; };
const open = (bot, x, z) => {
  // Plants count as open space (placing replaces nothing there: skip them).
  const def = (v) => content.blocks.find((b) => b.id === v);
  const top = bot.surface(x, z, (v) => def(v)?.collision !== false || def(v)?.fluid != null);
  return top !== null && solid(bot.voxel(x, top, z)) && bot.voxel(x, top + 1, z) === 0 && bot.voxel(x, top + 2, z) === 0 ? top : null;
};
// Open ground cells (solid, two free above) in the loaded area around spawn.
const cells = [];
for (let cxz = -14; cxz < 30; cxz++) for (let czz = -14; czz < 30; czz++) {
  const top = open(bots.ann, cxz, czz);
  if (top !== null) cells.push([cxz, top + 1, czz]);
}
const near = (a, b, max) => Math.abs(a[0] - b[0]) <= max && Math.abs(a[2] - b[2]) <= max && Math.abs(a[1] - b[1]) <= 2 && (a[0] !== b[0] || a[2] !== b[2]);
const hallCell = cells.find((c) => cells.filter((o) => near(c, o, 3)).length >= 2);
assert.ok(hallCell, "open ground near spawn");
const [vault1, vault2] = cells.filter((o) => near(hallCell, o, 3));
const [x, y, z] = hallCell;
const [cx, cz] = [Math.floor(x / 16), Math.floor(z / 16)];
const claim = (min, max) => as("ann")("/lands", { headers: { "Idempotency-Key": key() }, body: { world: "main", dimension: "overworld", min, max, name: "Hall", guild: alpha.id } });
await claim([cx, cz], [cx, cz + 1]);
await claim([cx + 1, cz], [cx + 1, cz + 1]);
assert.equal((await as("ann")(`/guilds/${alpha.id}`)).guild.settlement_level, "village");
const village = bots.amy.event("platform.land", (e) => e.land?.settlement?.level === "village", 20000);
for (const [who, dx] of [["ann", 0], ["amy", 2], ["bob", -3]]) await bots[who].moveTo([x + dx + 0.5, y + EYE, z - 2.5], 4);
await village;
await sleep(5500);
step(`[${alpha.tag}] has a village; everyone stands in it`);

const call = async (bot, intent, payload) => {
  bot.call(`platform.${intent}`, payload);
  const r = await bot.result(intent);
  assert.equal(r.ok, true, `${intent}: ${JSON.stringify(r)}`);
  return r;
};
const refused = async (bot, intent, payload) => {
  bot.call(`platform.${intent}`, payload);
  const r = await bot.result(intent);
  assert.equal(r.ok, false, `${intent} should be refused`);
  return r.code;
};
const placed = async (bot, at, id) => {
  for (let i = 0; i < 50 && bots.ann.voxel(...at) !== id; i++) await sleep(100);
};

// A plain member may not raise a town hall.
const hallAt = [x, y, z];
assert.equal(await refused(bots.amy, "build.place", { voxel: hallAt, slot: 3 }), "not_owner");
// A rank: the leader makes the member a Steward, who may manage land.
const ranked = await as("ann")(`/guilds/${alpha.id}/ranks`, { body: { name: "Steward", permissions: ["land", "treasury"] } });
await as("ann")(`/guilds/${alpha.id}/members/${names.amy}/rank`, { method: "PUT", body: { rank: ranked.guild.ranks[0].id } });
// The land feed makes the Steward a manager within a second or two.
await sleep(2500);
await call(bots.amy, "build.place", { voxel: hallAt, slot: 3 });
step("a member ranked Steward placed the town hall (a plain member could not)");
await placed(bots.ann, hallAt, block("guild_hall").id);
const hallEvent = bots.ann.event("platform.guild.hall", (e) => e.home, 8000);
await call(bots.ann, "use", { voxel: hallAt });
const hall = await hallEvent;
assert.equal(hall.guild.tag, alpha.tag);
step("the leader made the town hall their respawn point");

// Vaults: two blocks, one inventory.
const v1 = vault1;
const v2 = vault2;
await call(bots.amy, "build.place", { voxel: v1, slot: 1 });
await call(bots.amy, "build.place", { voxel: v2, slot: 1 });
await placed(bots.amy, v2, block("guild_vault").id);
const openVault = async (bot, at) => {
  const w = bot.event("platform.window", (p) => p.kind === "chest", 8000);
  bot.call("platform.window.open", { voxel: at });
  return w;
};
let w = await openVault(bots.amy, v1);
const click = async (bot, slot, until) => {
  const next = bot.event("platform.window", until, 8000);
  bot.call("platform.window.click", { slot, click: { type: "left" } });
  return next;
};
await click(bots.amy, w.inventoryStart + 2, (p) => p.cursor);
await click(bots.amy, 0, (p) => p.slots[0] && !p.cursor);
bots.amy.call("platform.window.close", {});
await sleep(300);
w = await openVault(bots.ann, v2);
assert.equal(w.slots[0]?.item, item("bread").id, "the other vault holds the bread");
assert.equal(w.slots[0]?.count, 5);
bots.ann.call("platform.window.close", {});
assert.equal(await refused(bots.bob, "window.open", { voxel: v1 }), "land_protected");
step("two vaults share one inventory; strangers stay out");

assert.equal(await refused(bots.amy, "build.place", { voxel: [x - 40, y, z], slot: 1 }), "not_in_settlement");
step("vaults and halls go only into settlements");

// Peace: no fighting.
await sleep(600);
assert.equal(await refused(bots.amy, "attack.player", { player: ids.bob }), "not_at_war");
step("players of guilds at peace cannot hurt each other");

// War (no warm-up here); the feed reaches the game server within a second.
await as("ann")(`/guilds/${alpha.id}/wars`, { body: { guild: bravo.tag } });
await sleep(2500);
// A siege: Bravo raises a banner on the village; a defender nearby holds it off.
const claimOf = (c) => [Math.floor(c[0] / 16), Math.floor(c[2] / 16)];
const inVillage = (c) => { const [a, b] = claimOf(c); return a >= cx && a <= cx + 1 && b >= cz && b <= cz + 1; };
const used = (c) => [hallAt, v1, v2].some((u) => u[0] === c[0] && u[2] === c[2]);
const bannerAt = cells.find((c) => inVillage(c) && !used(c) && near(hallCell, c, 6)) ?? cells.find((c) => inVillage(c) && !used(c));
assert.ok(bannerAt, "room for a banner in the village");
for (const who of ["ann", "amy"]) await bots[who].moveTo([bannerAt[0] + 20.5, bannerAt[1] + 4 + EYE, bannerAt[2] + 0.5], 4);
await bots.bob.moveTo([bannerAt[0] + 2.5, bannerAt[1] + EYE, bannerAt[2] + 0.5], 8);
await sleep(600);
await call(bots.bob, "build.place", { voxel: bannerAt, slot: 1 });
await bots.amy.moveTo([bannerAt[0] - 2.5, bannerAt[1] + EYE, bannerAt[2] + 0.5], 8);
await bots.bob.event("platform.siege", (e) => e.contested === true, 10000);
step("Bravo raised a siege banner on the village; a defender contests it");
const captured = bots.bob.event("platform.siege", (e) => e.captured, 30000);
await bots.amy.moveTo([bannerAt[0] - 20.5, bannerAt[1] + 4 + EYE, bannerAt[2] + 0.5], 8);
const won = await captured;
const lands = (await as("bob")("/lands?world=main&dimension=overworld")).lands;
assert.equal(lands.find((l) => l.id === won.captured)?.guild?.tag, bravo.tag, "the land is Bravo's");
for (let i = 0; i < 30 && bots.bob.voxel(...bannerAt) !== 0; i++) await sleep(100);
assert.equal(bots.bob.voxel(...bannerAt), 0, "the banner is spent");
step("the banner held: the land passed to Bravo");

const strike = async (attacker, victim) => {
  const died = bots[victim].event("platform.vitals", (v) => v.dead && v.cause === "player", 30000);
  for (let i = 0; i < 40; i++) {
    attacker.call("platform.attack.player", { player: ids[victim] });
    const r = await attacker.result("attack.player");
    if (r.killed) break;
    assert.ok(r.ok || r.code === "too_fast", `attack: ${JSON.stringify(r)}`);
    await sleep(550);
  }
  await died;
};
for (const [who, dx] of [["ann", 0], ["amy", 1], ["bob", 2]]) await bots[who].moveTo([x + dx + 0.5, y + EYE, z - 2.5], 8);
await sleep(500);
await strike(bots.amy, "bob");
step("at war: a member of Alpha defeated Bravo's leader");
await call(bots.bob, "respawn", {});
await sleep(5500);

await bots.bob.moveTo([x + 0.5, y + EYE, z - 3.5], 8);
await strike(bots.bob, "ann");
const respawned = bots.ann.event("platform.respawn", () => true, 10000);
await call(bots.ann, "respawn", {});
const spawn = await respawned;
assert.deepEqual(spawn.feet, [hallAt[0], hallAt[1] + 1, hallAt[2]], "respawned at the town hall");
step("the leader fell and respawned at the town hall");


await sleep(1000);
const war = (await as("ann")(`/guilds/${alpha.id}/relations`)).relations[0];
assert.deepEqual(war.score, { us: 1, them: 4 }, "a kill each, and 3 for the capture");
await as("ann")(`/guilds/${alpha.id}/wars/${bravo.tag}/peace`, { body: {} });
const peace = await as("bob")(`/guilds/${bravo.id}/wars/${alpha.tag}/peace`, { body: {} });
assert.equal(peace.peace, true);
step("the war stood 1:4 when both leaders made peace");

for (const b of Object.values(bots)) b.close();
console.log("diplomacy: all checks passed");
process.exit(0);
