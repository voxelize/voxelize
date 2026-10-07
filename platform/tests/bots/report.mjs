// Player reports end to end: a player says something, another reports them
// with /report in game; the reporter is told it was sent, the report
// reaches the moderators with where both stood and the reported player's
// last lines; a moderator resolves it and the reporter sees the outcome.
// Needs the backend and ROLE_CMD (see moderation.mjs):
//
//   ROLE_CMD="php artisan user:role {player} {role}" node report.mjs <api base> <game base>

import assert from "node:assert/strict";
import { execSync } from "node:child_process";

import { api, Bot, registerPlayer } from "./bot.mjs";

const API = process.argv[2] ?? "http://127.0.0.1:8080";
const GAME = process.argv[3] ?? API;
assert.ok(process.env.ROLE_CMD, "ROLE_CMD");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`✓ ${text}`);
const until = async (test, what, tries = 60) => {
  for (let i = 0; i < tries && !test(); i++) await sleep(100);
  assert.ok(test(), what);
};

const tag = Date.now().toString(36).slice(-5);
const [modName, annName, bobName] = [`md_${tag}`, `an_${tag}`, `bo_${tag}`];
const [modToken, annToken, bobToken] = await Promise.all([modName, annName, bobName].map((n) => registerPlayer(API, n)));
execSync(process.env.ROLE_CMD.replaceAll("{player}", modName).replaceAll("{role}", "moderator"), { stdio: "inherit", shell: "/bin/sh" });

const join = async (name, token) => {
  const bot = new Bot({ api: API, game: GAME, token, name });
  bot.channel = [];
  bot.waiters.push({ match: (m) => m.type === "EVENT" && m.name === "platform.chat" && (bot.channel.push(m.payload), false), resolve() {} });
  await bot.connect();
  return bot;
};
const ann = await join(annName, annToken);
const bob = await join(bobName, bobToken);
await sleep(500);

bob.chat("your house is mine now");
await sleep(400);
ann.chat(`/report ${annName} myself`);
await until(() => ann.channel.some((c) => c.body === "You cannot report yourself."), "no reporting oneself");
ann.chat(`/report nobody_${tag} griefing x`);
await until(() => ann.channel.some((c) => c.body?.includes("is not here")), "an absent player is pointed to the website");
ann.chat(`/report ${bobName} griefing broke my wall by the lake`);
await until(() => ann.channel.some((c) => c.body?.startsWith("Report sent (griefing)")), `the reporter is told; got ${JSON.stringify(ann.channel)}`);
ann.chat(`/report ${bobName} griefing again`);
await until(() => ann.channel.some((c) => c.body === "Wait a little before sending another report."), "a second report right away waits");
step("/report files a report and tells the reporter; oneself, absent players and floods are refused");

const { reports, open } = await api(API, "/admin/reports", { token: modToken });
assert.ok(open >= 1);
const report = reports.find((r) => r.target.username === bobName);
assert.ok(report, "the moderators see it");
assert.equal(report.reporter.username, annName);
assert.equal(report.source, "game");
assert.equal(report.category, "griefing");
assert.equal(report.details, "broke my wall by the lake");
assert.deepEqual(report.context.target_lines, ["your house is mine now"]);
assert.equal(report.context.target_at.length, 3);
await assert.rejects(api(API, "/admin/reports", { token: annToken }), /forbidden/, "players do not see the queue");
step("the report reaches the moderators with positions and the reported player's last lines");

await api(API, `/admin/reports/${report.id}`, { token: modToken, method: "POST", body: { outcome: "resolved", note: "muted for an hour" } });
const mine = await api(API, "/reports", { token: annToken });
assert.equal(mine.reports[0].status, "resolved");
assert.equal(mine.reports[0].resolution, undefined, "moderators' notes stay private");
step("a moderator resolves it and the reporter sees the outcome");

ann.close();
bob.close();
console.log("report: all checks passed");
