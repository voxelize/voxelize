#!/usr/bin/env node
// Character shadow attachment check: player parked by the azure lamp.
import { globSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import puppeteer from "puppeteer";

const chrome = () =>
  globSync(join(homedir(), ".cache/puppeteer/chrome/*/chrome-linux64/chrome"))
    .sort()
    .pop();

const browser = await puppeteer.launch({
  executablePath: chrome(),
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
  ],
  defaultViewport: { width: 960, height: 540 },
});
const page = await browser.newPage();
page.on("pageerror", (err) => console.error("[pageerror]", err.message));
await page.goto("http://localhost:3000/?world=flat", {
  waitUntil: "networkidle2",
  timeout: 120000,
});
await page.waitForFunction(() => window.__bench__?.worldReady(), {
  timeout: 120000,
  polling: 500,
});
await page.mouse.click(480, 270);
await new Promise((r) => setTimeout(r, 1500));
const bench = async (fn, ...rest) =>
  page.evaluate(
    (n, p) => (window.__bench__[n] ? window.__bench__[n](...p) : null),
    fn,
    rest,
  );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await bench("setTime", 20000);
await bench("clearPigs");
await sleep(1000);
await bench("setPerspective", "third");
await bench("teleport", 493, 51, 495);
await sleep(1500);
// Face the azure lamp; the third-person camera swings behind the player.
await bench("setDirection", -0.35, 0.25, 0.9);
await sleep(6000); // let the tint lerp settle at software-render fps
await page.screenshot({ path: "/tmp/shadow-proof/char_shadow_check.png" });
console.log("shot char_shadow_check");
await bench("setPerspective", "first");
await browser.close();
