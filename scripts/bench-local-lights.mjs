#!/usr/bin/env node
/**
 * Local-lights benchmark driver. Launches headless Chromium against the demo
 * client (flat world), runs the deterministic scenes the demo server exposes
 * through the `bench-lights` method, and reports frame percentiles, light CPU
 * costs, renderer counters, and heap per scene as JSON.
 *
 * Usage:
 *   node scripts/bench-local-lights.mjs [--url http://localhost:3000] \
 *     [--scenes parity,scaling,tunnel,field,moving,churn,streaming,tiers,context] \
 *     [--label main|branch] [--out /tmp/bench.json] [--shots /tmp/shots]
 *
 * The demo server + client must already be running (`pnpm demo`).
 */
import { globSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";

import puppeteer from "puppeteer";

const cachedChrome = () => {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const candidates = globSync(
    join(homedir(), ".cache/puppeteer/chrome/*/chrome-linux64/chrome"),
  );
  return candidates.sort().pop();
};

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const url = argValue("url", "http://localhost:3000/?world=flat");
const label = argValue("label", "run");
const outPath = argValue("out", `/tmp/bench-local-lights-${label}.json`);
const shotsDir = argValue("shots", "");
const sceneFilter = argValue("scenes", "").split(",").filter(Boolean);

const BLOCK = "Obsidian";
// Inside the flat world's chunk bounds (±800 blocks), one block above its
// stone plain (y = 50), and away from the spawn plaza.
const ORIGIN = [440, 51, 440];
const EYE = [ORIGIN[0] + 24, ORIGIN[1] + 14, ORIGIN[2] + 24];
const TUNNEL_ORIGIN = [440, 51, 560];
const FAR_AWAY = [-700, 90, -700];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({
  executablePath: cachedChrome(),
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "--window-size=1280,720",
  ],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on("pageerror", (err) => console.error("[page]", err.message));
await page.goto(url, { waitUntil: "networkidle2", timeout: 120000 });

// Hooks missing on the compared revision (main has no local lights) no-op.
const bench = async (fn, ...rest) =>
  page.evaluate(
    (name, params) =>
      window.__bench__[name] ? window.__bench__[name](...params) : null,
    fn,
    rest,
  );

const waitForWorld = async () => {
  await page.waitForFunction(() => window.__bench__?.worldReady(), {
    timeout: 120000,
    polling: 500,
  });
  // Pointer-lock click to enter the world so controls settle.
  await page.mouse.click(640, 360);
  await sleep(2000);
};

const settle = async (maxMs = 60000) => {
  const start = Date.now();
  for (;;) {
    const pending = await bench("pendingWork");
    if (pending.scans === 0 && pending.chunksRequested === 0) return;
    if (Date.now() - start > maxMs) {
      console.warn("[bench] settle timeout", pending);
      return;
    }
    await sleep(500);
  }
};

const measure = async (name, seconds = 12) => {
  await bench("resetFrameStats");
  await sleep(seconds * 1000);
  const stats = await bench("stats");
  console.log(
    `[bench] ${name}: p50 ${stats.frame.p50.toFixed(1)}ms p95 ${stats.frame.p95.toFixed(1)}ms ` +
      `| lights ${stats.localLights.clustered}/${stats.localLights.candidates}/${stats.localLights.registered} ` +
      `| select+pack peak ${(stats.localLights.selectMsPeak + stats.localLights.packMsPeak).toFixed(3)}ms ` +
      `| scan peak ${stats.localLights.scanMsPeak.toFixed(3)}ms ` +
      `| calls ${stats.render.calls} | heap ${(stats.memory / 1048576).toFixed(1)}MB`,
  );
  return stats;
};

const screenshot = async (name) => {
  if (!shotsDir) return;
  await mkdir(shotsDir, { recursive: true });
  await page.screenshot({ path: join(shotsDir, `${name}.png`) });
};

const teleportAndLook = async (eye, target) => {
  await bench("teleport", ...eye);
  await sleep(1200);
  await bench("lookAt", ...target);
  await sleep(300);
};

const results = { label, url, startedAt: new Date().toISOString(), scenes: {} };
const shouldRun = (name) =>
  sceneFilter.length === 0 || sceneFilter.includes(name);

await waitForWorld();
// Fixed night (time_per_day is 24000 in the flat world) so every emissive
// and analytic contribution is visible and identical across runs.
await bench("setTime", 20000);
await sleep(1000);
// The flat world persists edits; start every run from a clean slate.
await teleportAndLook(EYE, ORIGIN);
await settle(90000);
await bench("runScene", "clear", BLOCK, ORIGIN, 140);
await bench("runScene", "clear-tunnel", BLOCK, TUNNEL_ORIGIN, 64);
await sleep(4000);
await settle(60000);

// ── parity: zero emitters ────────────────────────────────────────────────
if (shouldRun("parity")) {
  await teleportAndLook(EYE, ORIGIN);
  await settle();
  results.scenes.parity = await measure("parity (0 emitters)");
  await screenshot("s1_parity_no_lights");
}

// ── scaling: 1 / 16 / 128 / 1000 / 10000 registered ─────────────────────
if (shouldRun("scaling")) {
  results.scenes.scaling = {};
  // Individual registration for the scaling series: aggregation off proves
  // the registry and selection at true record counts.
  await bench("setAggregation", BLOCK, "none");
  for (const count of [1, 16, 128, 1000]) {
    await bench("runScene", "clear", BLOCK, ORIGIN, 140);
    await sleep(2000);
    await bench("runScene", "grid", BLOCK, ORIGIN, count);
    await sleep(2000);
    await settle();
    await teleportAndLook(EYE, ORIGIN);
    results.scenes.scaling[count] = await measure(`grid ${count}`);
    await screenshot(`s_scaling_${count}`);
  }
  // 10k registered: a packed field; grids at this count would outrun the
  // world bounds, so density carries the count.
  await bench("runScene", "clear", BLOCK, ORIGIN, 140);
  await sleep(2000);
  await bench("runScene", "field", BLOCK, ORIGIN, 10000);
  await sleep(6000);
  await settle(120000);
  await teleportAndLook(EYE, ORIGIN);
  results.scenes.scaling[10000] = await measure("field 10000 (no aggregation)");
  await screenshot("s_scaling_10000_field");

  // The same field with the lava rule on: thousands of voxels, few records.
  await bench("setAggregation", BLOCK, "cluster");
  await sleep(3000);
  await settle(120000);
  results.scenes.lavaField = await measure("field 10000 (aggregated)");
  await screenshot("s_lava_field_aggregated");

  await bench("clearProfile", BLOCK);
  await bench("runScene", "clear", BLOCK, ORIGIN, 140);
  await sleep(4000);
  await settle(60000);
}

// ── torch tunnel ─────────────────────────────────────────────────────────
if (shouldRun("tunnel")) {
  const tunnelOrigin = TUNNEL_ORIGIN;
  await bench("runScene", "clear-tunnel", BLOCK, tunnelOrigin, 64);
  await sleep(2000);
  await bench("runScene", "tunnel", BLOCK, tunnelOrigin, 64);
  await sleep(3000);
  await settle();
  await teleportAndLook(
    [tunnelOrigin[0] + 4, tunnelOrigin[1] + 2, tunnelOrigin[2]],
    [tunnelOrigin[0] + 60, tunnelOrigin[1] + 2, tunnelOrigin[2]],
  );
  results.scenes.tunnel = await measure("tunnel 64 torches");
  await screenshot("s_tunnel");
}

// ── moving dynamic light ─────────────────────────────────────────────────
if (shouldRun("moving")) {
  await teleportAndLook(EYE, ORIGIN);
  await settle();
  await bench("toggleOrbit");
  await sleep(1000);
  results.scenes.moving = await measure("orbiting dynamic light");
  await screenshot("s_moving_orbit");
  await bench("toggleOrbit");
}

// ── rapid place/break churn ──────────────────────────────────────────────
if (shouldRun("churn")) {
  await teleportAndLook(EYE, ORIGIN);
  await bench("resetFrameStats");
  const churnStart = Date.now();
  let flips = 0;
  while (Date.now() - churnStart < 20000) {
    await bench("runScene", "grid", BLOCK, ORIGIN, 10);
    await sleep(500);
    await bench("runScene", "clear", BLOCK, ORIGIN, 16);
    await sleep(500);
    flips++;
  }
  results.scenes.churn = await measure("churn aftermath", 6);
  results.scenes.churn.flips = flips;
}

// ── streaming: fly away and back, registrations must return to baseline ──
if (shouldRun("streaming")) {
  await bench("runScene", "grid", BLOCK, ORIGIN, 64);
  await sleep(2000);
  await settle();
  await teleportAndLook(EYE, ORIGIN);
  const before = await bench("stats");
  await teleportAndLook(FAR_AWAY, [FAR_AWAY[0] + 10, 80, FAR_AWAY[2] + 10]);
  await settle(90000);
  const away = await bench("stats");
  await teleportAndLook(EYE, ORIGIN);
  await settle(90000);
  const back = await bench("stats");
  results.scenes.streaming = {
    beforeRegistered: before.localLights.registered,
    awayRegistered: away.localLights.registered,
    backRegistered: back.localLights.registered,
  };
  console.log("[bench] streaming registered:", results.scenes.streaming);
  await bench("runScene", "clear", BLOCK, ORIGIN, 140);
  await sleep(2000);
}

// ── quality tiers ────────────────────────────────────────────────────────
if (shouldRun("tiers")) {
  await bench("runScene", "grid", BLOCK, ORIGIN, 128);
  await sleep(2000);
  await settle();
  await teleportAndLook(EYE, ORIGIN);
  results.scenes.tiers = {};
  for (const tier of ["ultra", "high", "medium", "low", "potato"]) {
    await bench("setTier", tier);
    await sleep(500);
    results.scenes.tiers[tier] = await measure(`tier ${tier}`, 8);
    await screenshot(`s_tier_${tier}`);
  }
  await bench("setTier", "high");
}

// ── context loss/restore ─────────────────────────────────────────────────
if (shouldRun("context")) {
  await teleportAndLook(EYE, ORIGIN);
  await settle();
  await bench("loseContext");
  await sleep(4000);
  results.scenes.context = await measure("after context restore", 6);
  await screenshot("s_context_restored");
}

results.finishedAt = new Date().toISOString();
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(results, null, 2));
console.log(`[bench] wrote ${outPath}`);
await browser.close();
