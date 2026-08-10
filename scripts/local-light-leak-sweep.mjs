#!/usr/bin/env node
/**
 * Exact-camera leak sweep: proves shader-side local lighting adds NOTHING
 * outside sealed geometry across near-vertical pitch, altitude, aspect
 * ratio, and quality tiers — the regression class where mounted lights
 * poured giant colored patches across roofs under top-down cameras.
 *
 * Geometry note, stated plainly: this engine repo cannot load Town's
 * `shaoruu` world, so the harness builds a deterministic EQUIVALENT — a
 * fully sealed marble box (floor, four walls, roof) with ceiling-mounted
 * cyan and magenta shadow-requesting lamps inside — and reproduces the
 * reported camera RELATIVELY. The user repro was camera
 * (-0.654, 44.744, 1.867) looking at (-0.321, 28.751, 1.491): offset
 * (-0.333, +15.993, +0.376) from its focus, direction (0.021, -1, -0.024),
 * yaw -41.501°, pitch -88.2°. The harness anchors that exact offset and
 * direction at the box's interior focus. The Town companion MUST still run
 * the absolute camera against the real hub before rollout:
 * `pnpm agent view -0.654 44.744 1.867 -0.321 28.751 1.491` at Off vs each
 * tier, and require the same bounded deltas asserted here.
 *
 * For every sweep configuration the scene is captured at the tier under
 * test and at `off` with an identically pinned camera and clock, then a
 * central ROI (sealed roof / sealed exterior only — HUD-free) is compared.
 * A sealed box admits no flood and no analytic light out, so the tier
 * frame must match the off frame to quantization: mean |delta| <= 2/255,
 * p99 <= 6/255. The pre-#129 leak fails this by an order of magnitude.
 *
 * Usage: node scripts/local-light-leak-sweep.mjs [--url http://localhost:3000]
 *          [--shots /tmp/leak-sweep]
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
const shotsDir = argValue("shots", "/tmp/leak-sweep");
await mkdir(shotsDir, { recursive: true });

const cachedChrome = () => {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  return globSync(
    join(homedir(), ".cache/puppeteer/chrome/*/chrome-linux64/chrome"),
  ).sort().pop();
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── the user repro camera, expressed relatively ───────────────────────────
const USER_OFFSET = [-0.654 - -0.321, 44.744 - 28.751, 1.867 - 1.491];
const USER_DIRECTION = [0.021, -1, -0.024];
// Horizontal heading of the user direction (yaw -41.501°), used to hold the
// yaw fixed while sweeping pitch.
const headingLength = Math.hypot(USER_DIRECTION[0], USER_DIRECTION[2]);
const HEADING = [
  USER_DIRECTION[0] / headingLength,
  USER_DIRECTION[2] / headingLength,
];
const directionForPitch = (pitchDeg) => {
  const k = 1 / Math.tan((Math.abs(pitchDeg) * Math.PI) / 180);
  return [HEADING[0] * k, -1, HEADING[1] * k];
};

// ── sealed test box (must sit inside the flat world's chunk range) ────────
const HX = 620;
const HZ = 560;
const FLOOR_Y = 52;
const ROOF_Y = 58;
const HALF = 8;
// The interior focus the relative camera anchors to (the user lookAt).
const FOCUS = [HX, FLOOR_Y + 1, HZ];

const browser = await puppeteer.launch({
  executablePath: cachedChrome(),
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "--window-size=1920,1080",
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

await bench("toggleDebugPanel"); // HUD panel out of every capture
await bench("setTimeFrac", 0.85); // dark night: leaks are maximal
await bench("teleport", HX, FLOOR_Y + 1, HZ);
await sleep(1500);
await settle();

// Representative sealed mounted lights: pure cyan + magenta hero lamps.
await bench("setProfile", "Azure Lamp", {
  color: [0, 1, 1], intensity: 1.5, range: 14,
  analyticShare: 0.85, shadowPolicy: "shadowMap",
});
await bench("setProfile", "Ember Lamp", {
  color: [1, 0, 1], intensity: 1.5, range: 14,
  analyticShare: 0.85, shadowPolicy: "shadowMap",
});

// Build the sealed box: floor, roof, four walls, two ceiling-mounted lamps.
for (let x = -HALF; x <= HALF; x++) {
  for (let z = -HALF; z <= HALF; z++) {
    await bench("placeBlock", HX + x, FLOOR_Y, HZ + z, "Marble");
    await bench("placeBlock", HX + x, ROOF_Y, HZ + z, "Marble");
  }
}
for (let y = FLOOR_Y + 1; y < ROOF_Y; y++) {
  for (let i = -HALF; i <= HALF; i++) {
    await bench("placeBlock", HX + i, y, HZ - HALF, "Marble");
    await bench("placeBlock", HX + i, y, HZ + HALF, "Marble");
    await bench("placeBlock", HX - HALF, y, HZ + i, "Marble");
    await bench("placeBlock", HX + HALF, y, HZ + i, "Marble");
  }
}
// Mounted directly under the roof: the mount-skipped +Y face is the leak
// path this sweep guards.
await bench("placeBlock", HX - 3, ROOF_Y - 1, HZ, "Ember Lamp");
await bench("placeBlock", HX + 3, ROOF_Y - 1, HZ, "Azure Lamp");
await sleep(3000);
await settle();

// Warm-up: grant the shadow slots and let their static-face FIFO drain and
// the CSM cascades settle BEFORE the first measured pair. The first frames
// after a fresh tier grant defer far cascades behind the reserved dynamic
// units, and a capture inside that window sees a transient moon-shadow
// level shift on far terrain — noise, not leak.
await bench("setTier", "high");
await sleep(3500);
await settle();

const capture = async (name) => {
  await bench("setTimeFrac", 0.85); // re-pin the clock right before the shot
  await sleep(400);
  const base64 = await page.screenshot({ encoding: "base64" });
  await writeFile(join(shotsDir, `${name}.png`), Buffer.from(base64, "base64"));
  return base64;
};

// Decode + diff in the page itself (canvas), so the harness needs no
// image-decoding dependency. ROI: central 60% x 55% band — sealed roof or
// sealed exterior only, clear of the hotbar; the HUD panel is toggled off.
const roiDelta = (base64A, base64B) =>
  page.evaluate(async (a64, b64) => {
    const decode = (b64src) =>
      new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0);
          resolve(ctx.getImageData(0, 0, image.width, image.height));
        };
        image.src = `data:image/png;base64,${b64src}`;
      });
    const a = await decode(a64);
    const b = await decode(b64);
    const x0 = Math.floor(a.width * 0.2);
    const x1 = Math.floor(a.width * 0.8);
    const y0 = Math.floor(a.height * 0.2);
    const y1 = Math.floor(a.height * 0.75);
    const deltas = [];
    let sum = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * a.width + x) * 4;
        const d =
          (Math.abs(a.data[i] - b.data[i]) +
            Math.abs(a.data[i + 1] - b.data[i + 1]) +
            Math.abs(a.data[i + 2] - b.data[i + 2])) /
          3;
        deltas.push(d);
        sum += d;
      }
    }
    deltas.sort((lhs, rhs) => lhs - rhs);
    return {
      mean: sum / deltas.length,
      p99: deltas[Math.floor(deltas.length * 0.99)],
      max: deltas[deltas.length - 1],
    };
  }, base64A, base64B);

const MEAN_LIMIT = 2.0;
const P99_LIMIT = 6.0;
let failed = false;
const results = [];

const runConfig = async ({ label, pitch, altitude, viewport, tier }) => {
  await page.setViewport(viewport);
  await sleep(400);
  const direction =
    pitch === "user" ? USER_DIRECTION : directionForPitch(pitch);
  const camera =
    altitude === "user"
      ? [FOCUS[0] + USER_OFFSET[0], FOCUS[1] + USER_OFFSET[1], FOCUS[2] + USER_OFFSET[2]]
      : [FOCUS[0], FOCUS[1] + altitude, FOCUS[2]];
  await bench("teleport", ...camera);
  await sleep(900);
  await settle();
  await bench("setDirection", ...direction);
  await sleep(400);

  // Retry-once semantics: a genuine leak is deterministic (the pre-#129
  // regression fails every attempt at 30+/255 on the sealed roof), while
  // one-off transients — the day-clock's sky/sun lerp still converging, a
  // cascade or upload landing between the pair's two captures — pass a
  // re-settled second attempt. Thresholds are never weakened.
  let stats;
  let pass = false;
  for (let attempt = 0; attempt < 2 && !pass; attempt++) {
    if (attempt > 0) {
      console.log(`[leak-sweep] ${label} (${tier}): transient, retrying`);
      await sleep(2500);
      await settle();
    }
    await bench("setTier", tier);
    await sleep(900);
    await bench("setDirection", ...direction);
    const tierShot = await capture(`${label}_${tier}`);
    await bench("setTier", "off");
    await sleep(900);
    await bench("setDirection", ...direction);
    const offShot = await capture(`${label}_off`);
    await bench("setTier", "high");
    stats = await roiDelta(tierShot, offShot);
    pass = stats.mean <= MEAN_LIMIT && stats.p99 <= P99_LIMIT;
  }
  if (!pass) failed = true;
  results.push({ label, tier, ...stats, pass });
  console.log(
    `[leak-sweep] ${label} (${tier}): mean ${stats.mean.toFixed(2)} ` +
      `p99 ${stats.p99.toFixed(1)} max ${stats.max.toFixed(0)} /255 — ${pass ? "PASS" : "FAIL"}`,
  );
};

const BASE_VIEW = { width: 960, height: 540 };

// Sacrificial stabilization pair: the world's sky/sunlight uniforms lerp
// toward the pinned clock over the first seconds after load, which reads
// as a uniform brightness offset on far moon-lit terrain — noise that has
// nothing to do with local lights. Capture and DISCARD one pair so every
// measured configuration starts converged.
{
  await bench("setTier", "high");
  await sleep(900);
  await capture("stabilize_high");
  await bench("setTier", "off");
  await sleep(900);
  await capture("stabilize_off");
  await bench("setTier", "high");
  await sleep(900);
}

// The exact user repro configuration first.
await runConfig({
  label: "user_exact",
  pitch: "user",
  altitude: "user",
  viewport: BASE_VIEW,
  tier: "high",
});
// Near-vertical pitch sweep (yaw held at the user heading).
for (const pitch of [-90, -80, -70]) {
  await runConfig({
    label: `pitch${pitch}`,
    pitch,
    altitude: "user",
    viewport: BASE_VIEW,
    tier: "high",
  });
}
// Altitude sweep.
for (const altitude of [32, 64]) {
  await runConfig({
    label: `alt${altitude}`,
    pitch: "user",
    altitude,
    viewport: BASE_VIEW,
    tier: "high",
  });
}
// Aspect-ratio sweep at the user pitch/altitude.
for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 512, height: 512 },
  { width: 600, height: 900 },
]) {
  await runConfig({
    label: `aspect${viewport.width}x${viewport.height}`,
    pitch: "user",
    altitude: "user",
    viewport,
    tier: "high",
  });
}
// Tier sweep at the exact user view.
for (const tier of ["ultra", "medium"]) {
  await runConfig({
    label: "user_exact",
    pitch: "user",
    altitude: "user",
    viewport: BASE_VIEW,
    tier,
  });
}

await writeFile(
  join(shotsDir, "report.json"),
  JSON.stringify(results, null, 2),
);
console.log(
  failed
    ? "[leak-sweep] FAIL: shader local lighting altered sealed surfaces"
    : "[leak-sweep] PASS: sealed geometry identical to off at every config",
);
await browser.close();
process.exit(failed ? 1 : 0);
