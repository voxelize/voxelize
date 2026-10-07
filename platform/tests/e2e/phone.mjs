// The game on a phone, portrait and landscape, in a real browser with touch
// emulation: no page scrolls sideways; sign-in, the world browser and the
// game are usable by touch; tapping a hotbar slot selects it; the touch
// menu opens every panel (and the controls step aside while one is open);
// the buttons do not cover the vitals or hotbar; the inventory fits.
//
//   node phone.mjs <client base, e.g. http://127.0.0.1:3005>
//
// Needs playwright-core and a Chromium (CHROME, default /opt/pw-browsers/…),
// and a built client served with the API and game server behind it.

import assert from "node:assert/strict";
import { chromium, devices } from "playwright-core";

const BASE = process.argv[2] ?? "http://127.0.0.1:3005";
const CHROME = process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const step = (text) => console.log(`✓ ${text}`);
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const overlap = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

for (const [label, viewport] of [["portrait", { width: 390, height: 844 }], ["landscape", { width: 844, height: 390 }]]) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"], viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const fits = async (where) => {
    const s = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, vw: innerWidth }));
    assert.ok(s.w <= s.vw, `${label} ${where}: the page scrolls sideways (${s.w} > ${s.vw})`);
  };
  const rect = (sel) => page.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e || e.getClientRects().length === 0) return null;
    const r = e.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }, sel);

  await page.goto(BASE);
  await fits("sign-in");
  await page.tap("#auth-toggle");
  const name = "ph_" + Math.floor(Math.random() * 1e6);
  await page.fill("input[name=login]", name);
  await page.fill("input[name=email]", `${name}@example.com`);
  await page.fill("input[name=password]", "a long password 123");
  await page.tap("#auth-submit");
  await page.waitForSelector("#worlds .world-list li", { timeout: 30000 });
  await fits("world browser");
  await page.locator("#worlds .world-list li", { hasText: "Main" }).locator("button:has-text('Play')").tap();
  await page.waitForSelector("#hud:not([hidden])", { timeout: 120000 });
  await page.waitForSelector("#hotbar .slot", { timeout: 60000 });
  await page.waitForTimeout(3000);
  await fits("game");
  assert.ok(await page.evaluate(() => document.body.classList.contains("touch")), "touch controls are on");
  step(`${label}: sign-in, world browser and game fit the screen`);

  // Controls clear of the vitals and the hotbar.
  for (const hud of ["#vitals", "#hotbar"]) {
    for (const ctl of ["#touch .buttons", "#touch .joystick"]) {
      assert.ok(!overlap(await rect(hud), await rect(ctl)), `${label}: ${ctl} covers ${hud}`);
    }
  }
  step(`${label}: the controls leave the vitals and hotbar clear`);

  await page.locator("#hotbar .slot").nth(3).tap();
  await page.waitForFunction(() => document.querySelectorAll("#hotbar .slot")[3]?.classList.contains("selected"), null, { timeout: 5000 });
  step(`${label}: tapping a hotbar slot selects it`);

  for (const [entry, panel] of [["Friends", "#friends"], ["Quests & jobs", "#work"], ["Wardrobe", "#wardrobe"], ["Market", "#market"]]) {
    await page.locator("#touch button[data-b=menu]").dispatchEvent("touchstart");
    await page.locator("#touch .touch-menu button", { hasText: entry }).click();
    await page.waitForSelector(`${panel}:not([hidden])`, { timeout: 5000 });
    assert.equal(await rect("#touch .buttons"), null, `${label}: the controls step aside while ${panel} is open`);
    const r = await rect(panel);
    assert.ok(r.top >= 0 && r.bottom <= viewport.height + 1, `${label}: ${panel} fits the screen (${JSON.stringify(r)})`);
    await page.locator(`${panel} button`, { hasText: /^Done$/ }).last().click();
    await page.waitForSelector(`${panel}[hidden]`, { state: "attached", timeout: 5000 });
    assert.ok(await rect("#touch .buttons"), `${label}: the controls come back after ${panel}`);
  }
  step(`${label}: the menu opens friends, quests, wardrobe and market, and they close again`);

  await page.locator("#touch button[data-b=inventory]").dispatchEvent("touchstart");
  await page.waitForSelector("#window:not([hidden])", { timeout: 5000 });
  const w = await page.evaluate(() => {
    const e = document.getElementById("window");
    const r = e.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, scrolls: e.scrollHeight > e.clientHeight };
  });
  assert.ok(w.top >= 0 && w.bottom <= viewport.height + 1, `${label}: the inventory fits the screen`);
  step(`${label}: the inventory fits the screen${w.scrolls ? " (scrolls inside)" : ""}`);
  await page.screenshot({ path: `phone-${label}.png` });

  assert.deepEqual(errors, [], `${label}: page errors`);
  await ctx.close();
}
await browser.close();
console.log("phone: all checks passed");
