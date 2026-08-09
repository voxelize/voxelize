#!/usr/bin/env node
/**
 * Engine PR B shadow-cost benchmark. Complements `bench-local-lights.mjs`
 * (which measures the analytic layer and, run with `&shadows=off` on this
 * branch vs the PR A demo on its branch, gates the zero-shadow parity):
 * this driver measures what the *shadow* tier itself costs, on this branch,
 * against its own shadows-off baseline and across load shapes.
 *
 * Scenes:
 *   off        — stage lit, shadow pipeline disabled (`?shadows=off`)
 *   on-zero    — shadow pipeline on, zero local lights registered
 *   on-cached  — 3 shadowed statics, camera still (all faces cached)
 *   overlay    — + parked pig (entity overlay faces re-render per frame)
 *   moving     — + orbiting shadow-requesting light (full dynamic refresh)
 *   hitch      — first-light hitch: max frame around a lamp placement
 *   churn      — block edits inside a shadowed light's range (invalidation)
 *   soak       — moving pig + moving light for `--soak-seconds` (default 180)
 *
 * Usage: node scripts/bench-local-shadows.mjs [--url http://localhost:3000]
 *          [--out /tmp/bench-shadows.json] [--scenes ...] [--soak-seconds 180]
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
  return globSync(
    join(homedir(), ".cache/puppeteer/chrome/*/chrome-linux64/chrome"),
  )
    .sort()
    .pop();
};

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const baseUrl = argValue("url", "http://localhost:3000");
const outPath = argValue("out", "/tmp/bench-local-shadows.json");
const soakSeconds = Number(argValue("soak-seconds", "180"));
const sceneFilter = argValue("scenes", "").split(",").filter(Boolean);
const shouldRun = (name) =>
  sceneFilter.length === 0 || sceneFilter.includes(name);

const OX = 500;
const OY = 51;
const OZ = 500;
const EYE = [OX + 9, OY + 4, OZ - 7];
const AIM = [OX - 2, OY + 1, OZ + 5];

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

let page = null;
let bench = null;

const openPage = async (isShadowsOn) => {
  if (page) await page.close();
  page = await browser.newPage();
  page.on("pageerror", (err) => console.error("[page]", err.message));
  const url = `${baseUrl}/?world=flat${isShadowsOn ? "" : "&shadows=off"}`;
  await page.goto(url, { waitUntil: "networkidle2", timeout: 120000 });
  await page.waitForFunction(() => window.__bench__?.worldReady(), {
    timeout: 120000,
    polling: 500,
  });
  await page.mouse.click(480, 270);
  await sleep(1500);
  bench = async (fn, ...rest) =>
    page.evaluate(
      (name, params) =>
        window.__bench__[name] ? window.__bench__[name](...params) : null,
      fn,
      rest,
    );
  await bench("setTime", 20000);
  await bench("clearPigs");
  await bench("teleport", ...EYE);
  await sleep(1500);
  const position = (await bench("getPosition")) ?? EYE;
  await bench(
    "setDirection",
    AIM[0] - position[0],
    AIM[1] - position[1],
    AIM[2] - position[2],
  );
  await settle();
};

const settle = async (maxMs = 90000) => {
  const start = Date.now();
  for (;;) {
    const pending = await bench("pendingWork");
    if (pending && pending.scans === 0 && pending.chunksRequested === 0) {
      return;
    }
    if (Date.now() - start > maxMs) return;
    await sleep(500);
  }
};

const measure = async (name, seconds = 12) => {
  await bench("resetFrameStats");
  await sleep(seconds * 1000);
  const stats = await bench("stats");
  const ledger = await bench("ledgerStats");
  const lights = stats.localLights;
  const row = {
    p50: stats.frame.p50,
    p95: stats.frame.p95,
    p99: stats.frame.p99,
    drawCalls: stats.render.calls,
    triangles: stats.render.triangles,
    heapMB: stats.memory / 1048576,
    shadowed: lights.shadowed,
    facesStatic: lights.shadowFacesStatic,
    facesDynamic: lights.shadowFacesDynamic,
    scheduleMsPeak: lights.shadowScheduleMsPeak,
    dataUploads: lights.dataTextureUploads,
    invalidations: lights.shadowInvalidations,
    evictions: lights.atlasEvictions,
    cacheHitRate: lights.shadowCacheHitRate,
    atlasBytes: lights.atlasBytes,
    ledger,
  };
  console.log(
    `[bench] ${name}: p50 ${row.p50.toFixed(1)} p95 ${row.p95.toFixed(1)}ms | ` +
      `calls ${row.drawCalls} tris ${row.triangles} | shadowed ${row.shadowed} ` +
      `faces ${row.facesStatic}s+${row.facesDynamic}d | hit ${(row.cacheHitRate * 100).toFixed(0)}% | ` +
      `sched peak ${row.scheduleMsPeak.toFixed(2)}ms | heap ${row.heapMB.toFixed(0)}MB`,
  );
  return row;
};

const results = {
  startedAt: new Date().toISOString(),
  soakSeconds,
  scenes: {},
};

// ── off: stage lit, shadow pipeline disabled ───────────────────────────────
if (shouldRun("off")) {
  await openPage(false);
  results.scenes.off = await measure("stage, shadows off");
}

// ── on-zero: pipeline on, zero registered lights ───────────────────────────
if (shouldRun("on-zero")) {
  await openPage(true);
  await bench("clearShadowStage", OX, OY, OZ);
  await sleep(3000);
  await settle();
  results.scenes.onZero = await measure("shadows on, zero lights");
  await bench("buildShadowStage", OX, OY, OZ);
  await sleep(4000);
  await settle();
}

// ── on-cached: 3 shadowed statics, camera still ────────────────────────────
if (shouldRun("on-cached")) {
  if (!page) await openPage(true);
  await openPage(true);
  await bench("buildShadowStage", OX, OY, OZ);
  await sleep(4000);
  await settle();
  await sleep(3000); // let the static FIFO drain fully
  results.scenes.onCached = await measure("3 shadowed statics, cached");
}

// ── overlay: parked pig inside every light's range ─────────────────────────
if (shouldRun("overlay")) {
  await bench("spawnPigs", OX + 0.5, OY, OZ + 4, 1, 0.01, 0.01, "pig");
  await sleep(2000);
  results.scenes.overlay = await measure("cached + pig overlay faces");
  await bench("clearPigs");
}

// ── moving: orbiting shadow-requesting light ───────────────────────────────
if (shouldRun("moving")) {
  await bench("toggleOrbitShadowed");
  await sleep(1500);
  results.scenes.moving = await measure("orbiting shadowed light");
  await bench("toggleOrbitShadowed");
  await sleep(500);
}

// ── hitch: first-light frame spike ─────────────────────────────────────────
if (shouldRun("hitch")) {
  await bench("placeBlock", OX - 3, OY, OZ - 6, "air");
  await sleep(2500);
  await bench("resetFrameStats");
  await sleep(1500);
  const before = (await bench("stats")).frame;
  await bench("resetFrameStats");
  await bench("placeBlock", OX - 3, OY, OZ - 6, "Ember Lamp");
  await sleep(2500);
  const after = (await bench("stats")).frame;
  results.scenes.hitch = {
    baselineP50: before.p50,
    baselineP95: before.p95,
    placementP95: after.p95,
    placementP99: after.p99,
  };
  console.log(
    `[bench] first-light hitch: baseline p50 ${before.p50.toFixed(1)} p95 ${before.p95.toFixed(1)} -> ` +
      `placement window p95 ${after.p95.toFixed(1)} p99 ${after.p99.toFixed(1)}ms`,
  );
  await bench("placeBlock", OX - 3, OY, OZ - 6, "air");
  await sleep(1500);
}

// ── churn: edits inside a shadowed range ───────────────────────────────────
if (shouldRun("churn")) {
  const statsBefore = (await bench("stats")).localLights;
  await bench("resetFrameStats");
  const churnStart = Date.now();
  let flips = 0;
  while (Date.now() - churnStart < 15000) {
    await bench("placeBlock", OX + 3, OY, OZ - 2, "Marble");
    await sleep(400);
    await bench("placeBlock", OX + 3, OY, OZ - 2, "air");
    await sleep(400);
    flips++;
  }
  const churn = await measure("churn aftermath", 6);
  churn.flips = flips;
  churn.invalidationsDelta =
    churn.invalidations - statsBefore.shadowInvalidations;
  console.log(
    `[bench] churn: ${flips} flips -> ${churn.invalidationsDelta} invalidations`,
  );
  results.scenes.churn = churn;
}

// ── soak: moving pig + moving light ────────────────────────────────────────
if (shouldRun("soak")) {
  await bench("spawnPigs", OX + 0.5, OY, OZ + 3, 1, 2.0, 0.6, "pig");
  await bench("toggleOrbitShadowed");
  await sleep(1500);
  const samples = [];
  const soakStart = Date.now();
  await bench("resetFrameStats");
  while (Date.now() - soakStart < soakSeconds * 1000) {
    await sleep(15000);
    const stats = await bench("stats");
    samples.push({
      t: Math.round((Date.now() - soakStart) / 1000),
      p50: stats.frame.p50,
      p95: stats.frame.p95,
      heapMB: stats.memory / 1048576,
      evictions: stats.localLights.atlasEvictions,
      invalidations: stats.localLights.shadowInvalidations,
      facesDynamic: stats.localLights.shadowFacesDynamic,
    });
    console.log(
      `[bench] soak +${samples.at(-1).t}s: p50 ${samples.at(-1).p50.toFixed(1)} ` +
        `p95 ${samples.at(-1).p95.toFixed(1)} heap ${samples.at(-1).heapMB.toFixed(0)}MB ` +
        `evict ${samples.at(-1).evictions}`,
    );
  }
  await bench("toggleOrbitShadowed");
  await bench("clearPigs");
  results.scenes.soak = { samples };
}

results.finishedAt = new Date().toISOString();
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(results, null, 2));
console.log(`[bench] wrote ${outPath}`);
await browser.close();
