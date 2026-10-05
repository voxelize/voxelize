// Load generation (spec §93): bots join, walk, dig, place and chat through
// the same validated intents as players. While they play, the game server's
// own metrics (/platform/metrics) are sampled every 2 s: the result says how
// long the overworld's ticks took (p50, p95, max), how many ticks it ran a
// second and how intents were answered. MAX_TICK_SECONDS fails the run when
// the slowest tick took longer; METRICS_TOKEN is sent if the endpoint wants
// one. Run the game server with GAME_ANTICHEAT=off (bots set positions).
//
//   docker compose exec -T api php artisan bots:provision 50 > tokens.json
//   node load.mjs tokens.json [seconds=60] [api base] [game base]

import { readFileSync } from "node:fs";

import { Bot } from "./bot.mjs";

const TOKENS = JSON.parse(readFileSync(process.argv[2] ?? "tokens.json", "utf8"));
const SECONDS = Number(process.argv[3] ?? 60);
const API = process.argv[4] ?? "http://127.0.0.1:8080";
const GAME = process.argv[5] ?? API;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const content = await (await fetch(`${GAME}/platform/content`)).json();
const blocks = new Map(content.blocks.map((b) => [b.id, b]));
const diggable = (id) => {
  const b = blocks.get(id);
  return b && !b.fluid && b.hardness > 0 && (!b.tool || b.tool.required === false) && b.drops.length > 0;
};

const stats = { joined: 0, failed: 0, mined: 0, placed: 0, chats: 0, refused: {} };

async function run({ username, token }, index) {
  try {
    const bot = new Bot({ api: API, game: GAME, token, name: username });
    await bot.connect();
    stats.joined++;
    const end = Date.now() + SECONDS * 1000;
    while (Date.now() < end) {
      const x = Math.floor((Math.random() - 0.5) * 48);
      const z = Math.floor((Math.random() - 0.5) * 48);
      bot.position = [x + 0.5, 120, z + 0.5];
      bot.requestChunks(0);
      await sleep(400);
      const y = bot.surface(x, z, (id) => blocks.get(id)?.collision !== false && !blocks.get(id)?.fluid);
      if (y === null || !diggable(bot.voxel(x, y, z))) continue;
      await bot.moveTo([x + 2.5, y + 2.6, z + 0.5], 8);
      const voxel = [x, y, z];
      // Another bot may have changed the block meanwhile.
      const block = blocks.get(bot.voxel(x, y, z));
      if (!block) continue;
      bot.call("platform.mine.start", { voxel });
      await sleep(Math.round(block.hardness * 1.5 * 1000) + 100);
      bot.call("platform.mine.finish", { voxel });
      const mined = await bot.result("mine.finish").catch(() => null);
      if (mined?.ok) {
        stats.mined++;
        bot.call("platform.build.place", { voxel });
        const placed = await bot.result("build.place").catch(() => null);
        if (placed?.ok) stats.placed++;
        else if (placed) stats.refused[placed.code] = (stats.refused[placed.code] ?? 0) + 1;
      } else if (mined) {
        stats.refused[mined.code] = (stats.refused[mined.code] ?? 0) + 1;
      }
      if (Math.random() < 0.2) {
        bot.chat(`bot ${index} checking in`);
        stats.chats++;
      }
    }
    bot.close();
  } catch (e) {
    stats.failed++;
    console.error(e.message);
  }
}

// Samples of the server's metrics while the bots play.
const samples = { tick: [], rate: [], players: 0 };
const metric = (text, name, world = "main") =>
  Number(text.split("\n").find((l) => l.startsWith(`${name}{world="${world}"}`))?.split(" ").at(-1) ?? NaN);
const intents = (text) => {
  const out = {};
  for (const l of text.split("\n").filter((l) => l.startsWith("platform_intents_total{"))) {
    const result = l.match(/result="([^"]*)"/)?.[1] ?? "?";
    out[result] = (out[result] ?? 0) + Number(l.split(" ").at(-1));
  }
  return out;
};
const scrape = async () => {
  const headers = process.env.METRICS_TOKEN ? { authorization: `Bearer ${process.env.METRICS_TOKEN}` } : {};
  return (await fetch(`${GAME}/platform/metrics`, { headers }).catch(() => null))?.text?.() ?? "";
};
const before = intents(await scrape());
let sampling = true;
const sampler = (async () => {
  while (sampling) {
    await sleep(2000);
    const text = await scrape();
    const tick = metric(text, "platform_tick_seconds");
    if (Number.isFinite(tick)) samples.tick.push(tick);
    const rate = metric(text, "platform_tick_rate");
    if (Number.isFinite(rate)) samples.rate.push(rate);
    samples.players = Math.max(samples.players, metric(text, "platform_players") || 0);
  }
})();
const pct = (list, p) => {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted.length ? Number(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))].toFixed(3)) : null;
};

const started = Date.now();
await Promise.all(TOKENS.map((t, i) => sleep(i * 100).then(() => run(t, i))));
sampling = false;
await sampler;
const after = intents(await scrape());
const answered = Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v - (before[k] ?? 0)]).filter(([, v]) => v > 0));
const server = {
  peak_players: samples.players,
  tick_seconds: { p50: pct(samples.tick, 50), p95: pct(samples.tick, 95), max: pct(samples.tick, 100) },
  ticks_per_second: { min: pct(samples.rate, 0), p50: pct(samples.rate, 50) },
  intents: answered,
};
console.log(JSON.stringify({ bots: TOKENS.length, ...stats, seconds: (Date.now() - started) / 1000, server }));
const budget = Number(process.env.MAX_TICK_SECONDS ?? NaN);
const tooSlow = Number.isFinite(budget) && server.tick_seconds.max !== null && server.tick_seconds.max > budget;
if (tooSlow) console.error(`slowest tick ${server.tick_seconds.max} s is over the budget of ${budget} s`);
process.exit(stats.failed > 0 || tooSlow ? 1 : 0);
