// Load generation (spec §93): bots join, walk, dig, place and chat through
// the same validated intents as players; a share of them (TRADE_SHARE, 0.2
// by default) play in pairs that meet and trade what they carry through the
// trade window, and every bot browses the market API now and then. While they play, the game server's
// own metrics (/platform/metrics) are sampled every 2 s: the result says how
// long the overworld's ticks took (p50, p95, max), how many ticks it ran a
// second and how intents were answered. MAX_TICK_SECONDS fails the run when
// the slowest tick took longer; METRICS_TOKEN is sent if the endpoint wants
// one. Run the game server with GAME_ANTICHEAT=off (bots set positions).
//
//   docker compose exec -T api php artisan bots:provision 50 > tokens.json
//   node load.mjs tokens.json [seconds=60] [api base] [game base]

import { readFileSync } from "node:fs";

import { api, Bot } from "./bot.mjs";

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

const stats = { joined: 0, failed: 0, mined: 0, placed: 0, chats: 0, trades: 0, trades_failed: 0, market_reads: 0, market_failed: 0, refused: {} };
const TRADE_SHARE = Number(process.env.TRADE_SHARE ?? 0.2);
// Bots 0..TRADERS-1 trade in pairs (0 with 1, 2 with 3, …).
const TRADERS = Math.floor((TOKENS.length * TRADE_SHARE) / 2) * 2;
const browse = async (token) => {
  try {
    await api(API, "/market/listings?world=main", { token });
    stats.market_reads++;
  } catch {
    stats.market_failed++;
  }
};
const EYE = 1.425;
const trader = new Map();
const call = async (bot, intent, payload = {}) => {
  bot.call(`platform.${intent}`, payload);
  const r = await bot.result(intent, 8000).catch(() => null);
  if (!r?.ok) throw new Error(`${intent}: ${r?.code ?? "no answer"}`);
  return r;
};

/** One trade between two bots standing next to each other. */
async function tradeOnce(a, b, spot) {
  const keep = setInterval(() => {
    a.moveTo([spot[0] + 0.5, spot[1], spot[2] + 0.5]);
    b.moveTo([spot[0] + 2.5, spot[1], spot[2] + 0.5]);
  }, 400);
  try {
    await a.moveTo([spot[0] + 0.5, spot[1], spot[2] + 0.5], 4);
    await b.moveTo([spot[0] + 2.5, spot[1], spot[2] + 0.5], 4);
    await sleep(600);
    const invited = b.event("platform.trade", (e) => e.invite, 8000);
    await call(a, "trade.request", { player: a.peerId });
    await invited;
    const opened = a.event("platform.trade", (e) => e.trade, 8000);
    await call(b, "trade.accept", { player: b.peerId });
    await opened;
    for (const bot of [a, b]) {
      const slot = (bot.inventory?.slots ?? []).findIndex((s) => s && s.count > 0);
      await call(bot, "trade.offer", { items: slot >= 0 ? [{ slot, count: 1 }] : [], crowns: 0 });
    }
    const done = [a, b].map((bot) => bot.event("platform.trade", (e) => e.ended, 15000));
    await call(a, "trade.confirm");
    await call(b, "trade.confirm");
    const ended = await Promise.all(done);
    if (ended.every((e) => e.ended === "done")) stats.trades++;
    else stats.trades_failed++;
  } catch (e) {
    stats.trades_failed++;
    stats.refused[e.message] = (stats.refused[e.message] ?? 0) + 1;
    a.call("platform.trade.cancel", {});
  } finally {
    clearInterval(keep);
  }
}

async function tradePair(a, b, index) {
  const end = Date.now() + SECONDS * 1000;
  const spot = [index * 6 - 120, 100 + EYE, 200];
  while (Date.now() < end) {
    await tradeOnce(a, b, spot);
    void browse(a.token);
    await sleep(1000 + Math.random() * 1000);
  }
}

async function run({ username, token }, index) {
  try {
    const bot = new Bot({ api: API, game: GAME, token, name: username });
    await bot.connect();
    stats.joined++;
    if (index < TRADERS) {
      bot.token = token;
      bot.me = (await api(API, "/me", { token })).user.id;
      trader.set(index, bot);
      // The second of a pair runs the pair once both are in.
      if (index % 2 === 1) {
        for (let i = 0; i < 100 && !trader.has(index - 1); i++) await sleep(200);
        const a = trader.get(index - 1);
        if (!a) throw new Error("trade partner never joined");
        a.peerId = bot.me;
        bot.peerId = a.me;
        await tradePair(a, bot, index);
        a.close();
        bot.close();
      }
      return;
    }
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
      if (Math.random() < 0.1) void browse(token);
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
