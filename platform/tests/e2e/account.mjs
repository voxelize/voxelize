// Account flows in a real browser: sign up, forget the password and reset
// it from the emailed link, change it in the account panel (other sessions
// end), download one's data, delete the account (signing in no longer
// works). The reset email is read from the backend's mail log
// (MAIL_MAILER=log), at MAIL_LOG.
//
//   MAIL_LOG=.../storage/logs/laravel.log node account.mjs <client base>

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.argv[2] ?? "http://127.0.0.1:3005";
assert.ok(process.env.MAIL_LOG, "MAIL_LOG");
const CHROME = process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const step = (text) => console.log(`✓ ${text}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: CHROME, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept(d.message().startsWith("Your account's email") ? email : undefined));

const name = "ac_" + Math.floor(Math.random() * 1e6);
const email = `${name}@example.com`;
const signIn = async (password) => {
  await page.fill("input[name=login]", name);
  await page.fill("input[name=password]", password);
  await page.click("#auth-submit");
};

await page.goto(BASE);
await page.click("#auth-toggle");
await page.fill("input[name=login]", name);
await page.fill("input[name=email]", email);
await page.fill("input[name=password]", "first password 1");
await page.click("#auth-submit");
await page.waitForSelector("#worlds .world-list li", { timeout: 30000 });
step("signed up");

// Forgotten: a fresh page, the link from the email, a new password.
await page.evaluate(() => sessionStorage.clear());
await page.goto(BASE);
await page.click("#auth-forgot");
await page.waitForFunction(() => document.getElementById("auth-error")?.textContent?.includes("reset link"), null, { timeout: 10000 });
let link = null;
for (let i = 0; i < 20 && !link; i++) {
  const log = readFileSync(process.env.MAIL_LOG, "utf8");
  const found = [...log.matchAll(/(https?:\/\/[^\s"<>]*\?reset=[^\s"<>]+)/g)].map((m) => m[1].replaceAll("&amp;", "&")).filter((l) => l.includes(encodeURIComponent(email)));
  link = found.at(-1) ?? null;
  if (!link) await sleep(500);
}
assert.ok(link, "the reset email was sent");
await page.goto(link);
await page.fill("#reset input[type=password]", "second password 2");
await page.click("#reset button[type=submit]");
await page.waitForFunction(() => document.getElementById("auth-error")?.textContent?.includes("Password changed"), null, { timeout: 10000 });
await signIn("second password 2");
await page.waitForSelector("#worlds .world-list li", { timeout: 30000 });
step("forgot the password, reset it from the emailed link and signed in with the new one");

await page.locator("#worlds .world-list li", { hasText: "Main" }).locator("button:has-text('Play')").click();
await page.waitForSelector("#hud:not([hidden])", { timeout: 120000 });
await page.click("#settings-button");
await page.click("#settings button:has-text('Account…')");
await page.waitForSelector("#account:not([hidden])");
await page.fill("#account input[placeholder='Current password']", "second password 2");
await page.fill("#account input[placeholder^='New password']", "third password 3");
await page.click("#account button:has-text('Change password')");
await page.waitForFunction(() => document.querySelector("#account .account-status")?.textContent?.startsWith("Password changed"), null, { timeout: 10000 });
step("changed the password in the account panel");

const [download] = await Promise.all([page.waitForEvent("download"), page.click("#account button:has-text('Download my data')")]);
const data = JSON.parse(readFileSync(await download.path(), "utf8"));
assert.equal(data.account.username, name);
assert.equal(data.account.email, email);
step("downloaded my data");

await page.fill("#account input[placeholder^='Your password']", "third password 3");
await page.click("#account button:has-text('Delete my account')");
await page.waitForSelector("#auth:not([hidden])", { timeout: 20000 });
await signIn("third password 3");
await page.waitForFunction(() => document.getElementById("auth-error")?.textContent?.length > 0, null, { timeout: 10000 });
assert.ok(!(await page.isVisible("#worlds")), "a deleted account cannot sign in");
step("deleted the account; it can no longer sign in");

assert.deepEqual(errors, []);
await browser.close();
console.log("account: all checks passed");
