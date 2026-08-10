#!/usr/bin/env node
/**
 * Deterministic renderer diff harness: proves the off/potato tiers render
 * BYTE-IDENTICAL frames to a true "local lights never existed" program.
 *
 * For each scene the demo's `renderOffParityDiff` bench hook renders the
 * loaded world twice inside one synchronous JS turn — once with the shipped
 * chunk programs, once with programs whose fragments went through
 * `stripLocalLightsFromFragment` — through the same renderer, camera, and
 * shared uniform objects, then byte-compares the two readbacks. Nothing
 * (world updates, clocks, particles, animation, jitter) can advance between
 * the two renders, so every pixel input is frozen by construction; a
 * nonzero diff can only come from the local-lights code failing to be
 * bit-inert at zero lights.
 *
 * Scenes: noon cleared ground, noon torch grid, night torch grid (dark
 * local-light scene) — at the `off` tier, plus `potato` on the night scene.
 * Exit code 1 if any comparison is not exactly zero.
 *
 * Usage: node scripts/render-off-parity.mjs [--url http://localhost:3000]
 *          [--shots /tmp/off-parity]
 * The demo server + client must already be running (`pnpm demo`).
 */
import { globSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

import puppeteer from "puppeteer";

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const baseUrl = argValue("url", "http://localhost:3000");
const shotsDir = argValue("shots", "/tmp/off-parity");
await mkdir(shotsDir, { recursive: true });

const cachedChrome = () => {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const candidates = globSync(
    join(homedir(), ".cache/puppeteer/chrome/*/chrome-linux64/chrome"),
  );
  return candidates.sort().pop();
};

const ORIGIN = [604, 51, 700];
const EYE = [ORIGIN[0] + 7, ORIGIN[1] + 5, ORIGIN[2] - 9];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({
  executablePath: cachedChrome(),
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "--window-size=960,540",
  ],
  defaultViewport: { width: 960, height: 540 },
});
const page = await browser.newPage();
page.on("pageerror", (error) => console.error("[page]", error.message));
await page.goto(`${baseUrl}/?world=flat`, {
  waitUntil: "networkidle2",
  timeout: 120000,
});
await page.waitForFunction(() => window.__bench__?.worldReady(), {
  timeout: 120000,
  polling: 500,
});
await page.mouse.click(480, 270);
await sleep(1200);
const bench = (fn, ...rest) =>
  page.evaluate(
    (name, params) =>
      window.__bench__[name] ? window.__bench__[name](...params) : null,
    fn,
    rest,
  );

const settle = async (maxMs = 90000) => {
  const start = Date.now();
  for (;;) {
    const pending = await bench("pendingWork");
    if (
      pending &&
      pending.scans === 0 &&
      pending.chunksProcessing === 0 &&
      pending.chunksRequested === 0
    ) {
      return;
    }
    if (Date.now() - start > maxMs) return;
    await sleep(800);
  }
};

const savePair = async (name, result) => {
  const write = async (suffix, dataUrl) => {
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    await writeFile(
      join(shotsDir, `${name}_${suffix}.png`),
      Buffer.from(base64, "base64"),
    );
  };
  await write("shipped", result.shippedPng);
  await write("legacy", result.legacyPng);
};

await bench("teleport", ...EYE);
await sleep(1200);
await bench(
  "setDirection",
  ORIGIN[0] - EYE[0],
  ORIGIN[1] - EYE[1],
  ORIGIN[2] - EYE[2],
);
await sleep(500);
await settle();
await bench("runScene", "clear", "Torch", ORIGIN, 25);
await sleep(2500);
await settle();

const results = {};
let failed = false;
const runCase = async (name, tier, time) => {
  await bench("setTier", tier);
  await sleep(1200);
  await bench("setTime", time);
  await sleep(1500);
  const result = await bench("renderOffParityDiff");
  const { shippedPng, legacyPng, ...stats } = result;
  results[name] = stats;
  await savePair(name, result);
  const verdict = stats.diffPixels === 0 ? "BYTE-IDENTICAL" : "DIFFERS";
  if (stats.diffPixels !== 0 || stats.controlDiffPixels !== 0) failed = true;
  console.log(
    `[off-parity] ${name}: ${verdict} — ${stats.diffPixels}/${stats.totalPixels} px, ` +
      `maxΔ ${stats.maxDelta}, control ${stats.controlDiffPixels} px (maxΔ ${stats.controlMaxDelta}), tier ${tier}`,
  );
};

// Noon, cleared ground.
await runCase("noon_clear_off", "off", 6000);

// Noon + night with a torch grid (dark local-light scene).
await bench("runScene", "grid", "Torch", ORIGIN, 9);
await sleep(2500);
await settle();
await runCase("noon_torches_off", "off", 6000);
await runCase("night_torches_off", "off", 20000);
await runCase("night_torches_potato", "potato", 20000);

await bench("setTier", "high");
await writeFile(
  join(shotsDir, "report.json"),
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results, null, 2));
await browser.close();
process.exit(failed ? 1 : 0);
