// The admin panel's report queue in a real browser: a player reports
// another (API), a moderator sees it under "Reports (1)" with the reported
// player's name linked, resolves it with a note, and it moves to the
// resolved list. Needs the backend and ROLE_CMD (see tests/bots/moderation.mjs):
//
//   ROLE_CMD="php artisan user:role {player} {role}" node reports.mjs <client base> <api base>

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { chromium } from "playwright-core";

const BASE = process.argv[2] ?? "http://127.0.0.1:3005";
const API = `${process.argv[3] ?? "http://127.0.0.1:8000"}/api/v1`;
assert.ok(process.env.ROLE_CMD, "ROLE_CMD");
const CHROME = process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const step = (text) => console.log(`✓ ${text}`);
const PASSWORD = "a long password 123";
const call = async (path, { token, method = "GET", body } = {}) => {
  const r = await fetch(API + path, { method, headers: { "content-type": "application/json", accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
  const json = await r.json();
  assert.ok(r.ok, `${path}: ${JSON.stringify(json)}`);
  return json;
};
const register = async (n) => (await call("/auth/register", { method: "POST", body: { username: n, email: `${n}@example.com`, password: PASSWORD } })).token;

const tag = Date.now().toString(36).slice(-5);
const [mod, ann, bob] = [`md_${tag}`, `an_${tag}`, `bo_${tag}`];
await register(mod);
const annToken = await register(ann);
await register(bob);
execSync(process.env.ROLE_CMD.replaceAll("{player}", mod).replaceAll("{role}", "moderator"), { shell: "/bin/sh" });
await call("/reports", { token: annToken, method: "POST", body: { player: bob, category: "scam", details: "took my diamonds and ran" } });

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept("refunded and warned"));
await page.goto(`${BASE}/admin.html`);
await page.fill("input[name=login]", mod);
await page.fill("input[name=password]", PASSWORD);
await page.click("button[type=submit]");
await page.waitForSelector(".admin-tabs button[data-tab=reports]", { timeout: 20000 });
await page.click(".admin-tabs button[data-tab=reports]");
const item = page.locator(".admin-reports li", { hasText: bob });
await item.waitFor({ timeout: 10000 });
assert.match(await item.textContent(), new RegExp(`scam · by ${ann} on the web`));
assert.match(await item.textContent(), /took my diamonds and ran/);
assert.match(await page.locator(".admin-tabs button[data-tab=reports]").textContent(), /Reports \(\d+\)/);
step("the moderator sees the report in the queue");

await item.locator("button", { hasText: "Resolve" }).click();
await page.locator(".admin-reports li", { hasText: bob }).waitFor({ state: "detached", timeout: 10000 });
await page.selectOption(".admin-body select", "resolved");
const done = page.locator(".admin-reports li", { hasText: bob });
await done.waitFor({ timeout: 10000 });
assert.match(await done.textContent(), new RegExp(`resolved by ${mod}: refunded and warned`));
step("resolving it with a note moves it to the resolved list");

await done.locator("button", { hasText: bob }).click();
await page.waitForSelector("text=Reported 1 time(s), 0 open");
step("the player's page counts the reports about them");
assert.deepEqual(errors, []);
await browser.close();
console.log("reports: all checks passed");
