// Operator chat commands on a live server: in a creative world /gamemode
// changes your own mode (not another player's unless you moderate) and
// /weather turns the weather; survival players are refused both.
//
//   DEV_TICKET_SECRET=... node commands.mjs - http://127.0.0.1:4000

import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { Bot } from "./bot.mjs";
const GAME = process.argv[3] ?? "http://127.0.0.1:4000";
const b64 = (d) => Buffer.from(d).toString("base64url");
const join = async (name, realm) => {
  const t = () => { const now = Math.floor(Date.now() / 1000); const c = { iss: "platform-api", aud: "game", sub: `pl_${name}`, name, world: "main", realm, roles: ["player"], iat: now, exp: now + 60, jti: randomUUID() };
    const s = `v1.${b64(JSON.stringify(c))}`; return `${s}.${createHmac("sha256", process.env.DEV_TICKET_SECRET).update(s).digest("base64url")}`; };
  const bot = new Bot({ api: "-", game: GAME, name, issueTicket: t });
  bot.lines = [];
  bot.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.chat" && (bot.lines.push(m.payload.body), false), resolve() {} });
  await bot.connect();
  return bot;
};
const tag = Date.now().toString(36).slice(-4);
const c = await join(`cr_${tag}`, "creative");
const s = await join(`sv_${tag}`, "survival");
const wait = async (bot, re) => { for (let i = 0; i < 40 && !bot.lines.some((l) => re.test(l)); i++) await new Promise((r) => setTimeout(r, 100)); assert.ok(bot.lines.some((l) => re.test(l)), `${re}: ${JSON.stringify(bot.lines)}`); };
c.chat("/gamemode spectator"); await wait(c, /Your game mode is now spectator/);
c.chat("/gm normal"); await wait(c, /Your game mode is now normal/);
c.chat(`/gamemode adventure sv_${tag}`); await wait(c, /Only moderators/);
c.chat("/weather thunder"); await wait(c, /weather turns to thunder/);
c.chat("/weather clear"); await wait(c, /weather turns to clear/);
s.chat("/weather rain"); await wait(s, /Only creative players/);
s.chat("/gamemode spectator"); await wait(s, /Only moderators/);
console.log("commands: all checks passed");
process.exit(0);
