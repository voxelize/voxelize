#!/usr/bin/env node
/**
 * Local-light shadow proof driver (Engine PR B). Drives the demo client
 * headlessly through the `window.__bench__` hooks: builds the generic shadow
 * stage, spawns demo animals, positions the camera, and captures the
 * visual-proof screenshots and videos for the PR.
 *
 * Usage:
 *   node scripts/shadow-proof.mjs [--url http://localhost:3000/?world=flat]
 *     [--steps stage,tint,...] [--out /tmp/shadow-proof]
 *
 * The demo server + client must already be running (`pnpm demo`).
 */
import { globSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

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
const outDir = argValue("out", "/tmp/shadow-proof");
const steps = argValue("steps", "").split(",").filter(Boolean);
const shouldRun = (name) => steps.length === 0 || steps.includes(name);

// Stage anchor on the flat world's stone plain, away from spawn and the
// PR A bench area. `OY` is the first free block above the surface.
const OX = 500;
const OY = 51;
const OZ = 500;

// Stage furniture (must match buildShadowStage in examples/client/main.ts).
const EMBER = [OX + 0.5, OY + 2.5, OZ + 0.5];
const AZURE = [OX - 7.5, OY + 2.5, OZ - 3.5];
const TORCH = [OX + 4.5, OY + 0.62, OZ + 4.5];
const WALL_TORCH = [OX - 3.5, OY + 2.5, OZ + 6.38];
const PILLAR = [OX + 2, OY, OZ + 3];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await mkdir(outDir, { recursive: true });

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
page.on("pageerror", (err) => console.error("[page]", err.message));
await page.goto(url, { waitUntil: "networkidle2", timeout: 120000 });

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
  await page.mouse.click(480, 270);
  await sleep(2000);
};

const settle = async (maxMs = 90000) => {
  const start = Date.now();
  for (;;) {
    const pending = await bench("pendingWork");
    if (pending && pending.scans === 0 && pending.chunksRequested === 0) {
      return;
    }
    if (Date.now() - start > maxMs) {
      console.warn("[proof] settle timeout", pending);
      return;
    }
    await sleep(500);
  }
};

const shot = async (name) => {
  await sleep(800);
  const path = join(outDir, `${name}.png`);
  await page.screenshot({ path });
  console.log(`[proof] shot ${name}`);
};

const view = async (eye, target) => {
  await bench("teleport", ...eye);
  await sleep(1200);
  const position = (await bench("getPosition")) ?? [
    eye[0] + 0.5,
    eye[1] + 1.8,
    eye[2] + 0.5,
  ];
  await bench(
    "setDirection",
    target[0] - position[0],
    target[1] - position[1],
    target[2] - position[2],
  );
  await sleep(600);
};

const record = async (name, ms) => {
  const recorder = await page.screencast({
    path: join(outDir, `${name}.webm`),
  });
  await sleep(ms);
  await recorder.stop();
  console.log(`[proof] video ${name} (${(ms / 1000).toFixed(0)}s)`);
};

const stats = async () => (await bench("stats"))?.localLights ?? {};
const logStats = async (label) => {
  const s = await stats();
  console.log(
    `[proof] ${label}: reg ${s.registered} clu ${s.clustered} shadowed ${s.shadowed}` +
      ` inval ${s.shadowInvalidations} evict ${s.atlasEvictions}` +
      ` hit ${(s.shadowCacheHitRate * 100).toFixed(0)}%`,
  );
  return s;
};

// ── boot ────────────────────────────────────────────────────────────────────
await waitForWorld();
await bench("setTime", 20000); // fixed night
await sleep(800);
await view([OX + 10, OY + 5, OZ - 10], [OX, OY + 1, OZ]);
await settle();
await bench("clearPigs");

if (shouldRun("clear")) {
  await bench("clearShadowStage", OX, OY, OZ);
  await sleep(3000);
  await settle();
}

if (shouldRun("stage")) {
  await bench("buildShadowStage", OX, OY, OZ);
  await sleep(4000);
  await settle();
  await logStats("stage");
  await view([OX + 9, OY + 4, OZ - 7], [OX - 2, OY + 1, OZ + 5]);
  await shot("stage_overview_night");
}

// ── player tint beside warm / cool lamps (third person) ────────────────────
if (shouldRun("tint")) {
  await bench("setPerspective", "third");
  await sleep(300);
  // Beside the warm ember lamp.
  await view([OX + 1, OY, OZ - 1], [EMBER[0], EMBER[1] - 1, EMBER[2]]);
  await sleep(1500);
  await shot("tint_player_warm_lamp");
  // Beside the cool azure lamp.
  await view([AZURE[0] - 1.5, OY, AZURE[2] + 1], [AZURE[0], AZURE[1] - 1, AZURE[2]]);
  await sleep(1500);
  await shot("tint_player_cool_lamp");
  await bench("setPerspective", "first");
}

// ── pig + sheep tint ────────────────────────────────────────────────────────
if (shouldRun("animals")) {
  await bench("clearPigs");
  await sleep(500);
  // Parked animals: radius ~0 keeps them on their center point.
  await bench("spawnPigs", EMBER[0] + 2, OY, EMBER[2] + 1, 1, 0.01, 0.01, "pig");
  await bench("spawnPigs", AZURE[0] + 2, OY, AZURE[2] + 1, 1, 0.01, 0.01, "sheep");
  await sleep(1500);
  await view(
    [EMBER[0] + 4, OY + 1, EMBER[2] - 2],
    [EMBER[0] + 2, OY + 0.5, EMBER[2] + 1],
  );
  await shot("tint_pig_warm_lamp");
  await view(
    [AZURE[0] + 4, OY + 1, AZURE[2] - 2],
    [AZURE[0] + 2, OY + 0.5, AZURE[2] + 1],
  );
  await shot("tint_sheep_cool_lamp");
  await bench("clearPigs");
}

// ── the core proof: pig between lamp and wall ───────────────────────────────
// Open corridor west of the ember lamp (no pillar in the sightline): the pig
// stands between the lamp and the back wall, and its shadow falls onto the
// open floor/wall toward the south-west.
const PIG_SPOT = [EMBER[0] - 3, OY, EMBER[2] + 2.5];
if (shouldRun("pig-blocks")) {
  await bench("clearPigs");
  await sleep(800);

  // Before, three angles.
  await view([OX + 2, OY + 2, OZ - 2], [PIG_SPOT[0] - 1, OY + 0.5, PIG_SPOT[2] + 2]);
  await shot("pig_block_before_side");
  await view(
    [EMBER[0] + 1, EMBER[1] + 1, EMBER[2] - 4],
    [PIG_SPOT[0] - 1.5, OY, PIG_SPOT[2] + 2],
  );
  await shot("pig_block_before_lightaxis");
  await view([PIG_SPOT[0] - 6, OY + 3, PIG_SPOT[2] - 4], [PIG_SPOT[0], OY + 0.5, PIG_SPOT[2] + 1.5]);
  await shot("pig_block_before_west");

  // Parked pig between the ember lamp and the back wall.
  await bench("spawnPigs", PIG_SPOT[0], OY + 0.2, PIG_SPOT[2], 1, 0.01, 0.01, "pig");
  await sleep(2500);
  console.log(
    "[proof] pig-blocks entities:",
    JSON.stringify(await bench("listEntities")),
  );

  await view([OX + 2, OY + 2, OZ - 2], [PIG_SPOT[0] - 1, OY + 0.5, PIG_SPOT[2] + 2]);
  await shot("pig_block_after_side");
  await view(
    [EMBER[0] + 1, EMBER[1] + 1, EMBER[2] - 4],
    [PIG_SPOT[0] - 1.5, OY, PIG_SPOT[2] + 2],
  );
  await shot("pig_block_after_lightaxis");
  await view([PIG_SPOT[0] - 6, OY + 3, PIG_SPOT[2] - 4], [PIG_SPOT[0], OY + 0.5, PIG_SPOT[2] + 1.5]);
  await shot("pig_block_after_west");
  // Tight low closeup: pig center frame, shadow zone behind it.
  await view(
    [PIG_SPOT[0] - 2.7, OY + 1.4, PIG_SPOT[2] - 2.4],
    [PIG_SPOT[0] + 0.3, OY + 0.4, PIG_SPOT[2] + 0.6],
  );
  await shot("pig_block_after_closeup");
  await logStats("pig-blocks");
  await bench("clearPigs");
  await sleep(600);
  await view(
    [PIG_SPOT[0] - 2.7, OY + 1.4, PIG_SPOT[2] - 2.4],
    [PIG_SPOT[0] + 0.3, OY + 0.4, PIG_SPOT[2] + 0.6],
  );
  await shot("pig_block_before_closeup");
}

// ── moving pig video ────────────────────────────────────────────────────────
if (shouldRun("pig-video")) {
  await bench("clearPigs");
  await sleep(600);
  // Orbit midway between the warm and cool lamps: the pig drags two
  // opposing colored shadows as it walks.
  await bench("spawnPigs", OX - 3.5, OY + 0.2, OZ + 1.5, 1, 1.6, 0.55, "pig");
  await sleep(2500);
  console.log(
    "[proof] pig-video entities:",
    JSON.stringify(await bench("listEntities")),
  );
  await view([OX - 6.5, OY + 3.5, OZ - 3], [OX - 3, OY + 0.4, OZ + 2.5]);
  await record("pig_moving_shadow", 18000);
  await bench("clearPigs");
}

// ── player walking through colored pools video ──────────────────────────────
// The tint is a lerp (LightShined lerpFactor 0.1/frame); at software-render
// frame rates it needs a few seconds of standing still to settle, so the
// walk pauses inside each pool.
if (shouldRun("pools-video")) {
  await bench("setPerspective", "third");
  // A lane that clears both lamp poles and stops on the open north side of
  // the ember lamp (out of the pillar's shadow pocket).
  await view([OX - 6, OY, OZ - 9], [OX + 3, OY + 0.5, OZ - 0.5]);
  await sleep(5000); // settle the cool tint before the take starts
  const recorder = await page.screencast({
    path: join(outDir, "player_walk_colored_pools.webm"),
  });
  await sleep(3500); // hold: cool tint at the azure side
  // Closed-loop walk: short bursts with position feedback, stopping on the
  // open north side of the ember lamp (out of the pillar's shadow pocket).
  const walkTarget = [OX + 1.5, OZ - 1.5];
  for (let burst = 0; burst < 10; burst++) {
    const position = await bench("getPosition");
    const dx = walkTarget[0] - position[0];
    const dz = walkTarget[1] - position[2];
    if (Math.hypot(dx, dz) < 2.2) break;
    await bench("setDirection", dx, -0.15, dz);
    await bench("walk", 550);
    await sleep(1400);
  }
  await sleep(8000); // hold: warm tint beside the ember lamp
  await recorder.stop();
  console.log("[proof] video player_walk_colored_pools");
  await bench("setPerspective", "first");
}

// ── torch: authored stick + hot tip proofs ──────────────────────────────────
if (shouldRun("torch")) {
  // Night closeup: only the tip glows; the stick shades normally.
  await view(
    [TORCH[0] + 1.2, OY + 0.8, TORCH[2] - 1.6],
    [TORCH[0], TORCH[1] - 0.15, TORCH[2]],
  );
  await shot("torch_stick_night_closeup");

  // The stick occludes its own tip light: a thin shadow column under it.
  await view([TORCH[0] + 1.5, OY + 3, TORCH[2] + 1.5], [TORCH[0], OY - 1, TORCH[2]]);
  await shot("torch_stick_self_occlusion_top");

  // Rotated wall torch: pool + shadow anchor lean with the tip.
  await view(
    [WALL_TORCH[0] + 0.5, WALL_TORCH[1] + 1, WALL_TORCH[2] - 4.5],
    [WALL_TORCH[0], WALL_TORCH[1] - 0.5, WALL_TORCH[2]],
  );
  await shot("torch_wall_rotated_anchor");

  // Day: the stick is just wood under the sun (CSM applies), tip readable.
  await bench("setTimeFrac", 0.5);
  await sleep(2500);
  await view([TORCH[0] + 2.5, OY + 1, TORCH[2] - 2.5], TORCH);
  await shot("torch_stick_noon");
  await bench("setTime", 20000);
  await sleep(2500);
}

// ── static voxel shadow + cache invalidation on edit ────────────────────────
if (shouldRun("edit")) {
  const before = await logStats("edit-before");
  await view([OX + 6, OY + 3, OZ - 2], [PILLAR[0], OY + 1, PILLAR[2] + 3]);
  await shot("static_pillar_shadow_before_edit");
  // Break the pillar: the cached maps must invalidate and re-render.
  await bench("placeBlock", PILLAR[0], OY + 0, PILLAR[2], "air");
  await bench("placeBlock", PILLAR[0], OY + 1, PILLAR[2], "air");
  await bench("placeBlock", PILLAR[0], OY + 2, PILLAR[2], "air");
  await sleep(3500);
  await shot("static_pillar_shadow_after_break");
  const after = await logStats("edit-after");
  console.log(
    `[proof] invalidations ${before.shadowInvalidations} -> ${after.shadowInvalidations}`,
  );
  // Rebuild for later steps.
  await bench("placeBlock", PILLAR[0], OY + 0, PILLAR[2], "Marble");
  await bench("placeBlock", PILLAR[0], OY + 1, PILLAR[2], "Marble");
  await bench("placeBlock", PILLAR[0], OY + 2, PILLAR[2], "Marble");
  await sleep(3000);
}

// ── multiple lights, debug views, atlas ─────────────────────────────────────
if (shouldRun("debug")) {
  await view([OX + 10, OY + 5, OZ - 8], [OX - 2, OY + 1, OZ + 4]);
  await shot("multi_light_overview");
  for (const [mode, name] of [
    [1, "debug_cell_occupancy"],
    [3, "debug_flood_mask"],
    [4, "debug_shadow_slots"],
    [5, "debug_shadow_visibility"],
  ]) {
    await bench("setDebugMode", mode);
    await sleep(700);
    await shot(name);
  }
  await bench("setDebugMode", 0);

  // Atlas viewer quad hovering beside the stage.
  await bench("toggleAtlasViewer", OX + 7, OY + 4, OZ - 3, 6);
  await view([OX + 7, OY + 4, OZ - 9], [OX + 7, OY + 4, OZ - 3]);
  await shot("debug_atlas_viewer");
  await bench("toggleAtlasViewer", 0, 0, 0, 0);

  // Ledger / shadow budget HUD (bottom-left stats panel) over the stage,
  // with a moving hero light spending dynamic units.
  await view([OX + 9, OY + 4, OZ - 7], [OX - 2, OY + 1, OZ + 5]);
  await bench("toggleOrbitShadowed");
  await bench("toggleDebugPanel");
  await sleep(2500);
  await shot("debug_ledger_hud");
  await bench("toggleDebugPanel");
  await bench("toggleOrbitShadowed");
  console.log("[proof] ledger:", JSON.stringify(await bench("ledgerStats")));
  console.log(
    "[proof] invalidation log:",
    JSON.stringify(await bench("invalidationLog")),
  );
}

// ── quality tiers ───────────────────────────────────────────────────────────
if (shouldRun("tiers")) {
  await view([OX + 9, OY + 4, OZ - 7], [OX - 2, OY + 1, OZ + 5]);
  for (const tier of ["ultra", "high", "medium", "low", "potato"]) {
    await bench("setTier", tier);
    await sleep(3000);
    await shot(`tier_${tier}`);
    await logStats(`tier ${tier}`);
  }
  await bench("setTier", "high");
  await sleep(2000);
}

// ── day / dusk / night continuity ───────────────────────────────────────────
if (shouldRun("daynight")) {
  await view([OX + 9, OY + 4, OZ - 7], [OX - 2, OY + 1, OZ + 5]);
  for (const [frac, name] of [
    [0.5, "daynight_noon"],
    [0.71, "daynight_dusk"],
    [0.83, "daynight_night"],
  ]) {
    await bench("setTimeFrac", frac);
    await sleep(3500);
    await shot(name);
  }
  await bench("setTime", 20000);
  await sleep(2000);
}

// ── failure / fallback behavior ─────────────────────────────────────────────
if (shouldRun("fallback")) {
  // More shadow-requesting lights than slots: the extras must fall back to
  // the flood mask, not leak or flicker.
  await bench("placeBlock", OX - 4, OY, OZ - 8, "Ember Lamp");
  await bench("placeBlock", OX + 6, OY, OZ - 6, "Azure Lamp");
  await bench("placeBlock", OX + 8, OY, OZ + 2, "Ember Lamp");
  await sleep(3000);
  await settle();
  const s = await logStats("fallback-overcap");
  console.log(
    `[proof] over-cap: ${s.clustered} clustered lights, ${s.shadowed} shadow slots`,
  );
  await view([OX + 11, OY + 6, OZ - 9], [OX, OY + 1, OZ + 2]);
  await shot("fallback_more_lights_than_slots");

  // Context loss: full recovery, caches rebuilt lazily.
  await bench("loseContext");
  await sleep(5000);
  await shot("fallback_context_restored");
  await logStats("context-restored");

  await bench("placeBlock", OX - 4, OY, OZ - 8, "air");
  await bench("placeBlock", OX + 6, OY, OZ - 6, "air");
  await bench("placeBlock", OX + 8, OY, OZ + 2, "air");
  await sleep(1500);
}

const report = { url, finishedAt: new Date().toISOString() };
await writeFile(join(outDir, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log("[proof] done");
