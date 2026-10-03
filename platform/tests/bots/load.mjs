// Load generation (spec §93): bots join, walk, dig, place and chat through
// the same validated intents as players.
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

const started = Date.now();
await Promise.all(TOKENS.map((t, i) => sleep(i * 100).then(() => run(t, i))));
console.log(JSON.stringify({ bots: TOKENS.length, ...stats, seconds: (Date.now() - started) / 1000 }));
process.exit(stats.failed > 0 ? 1 : 0);
