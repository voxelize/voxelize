// Runs the shading probe in headless Chrome (WebGPU on the host GPU) and
// prints what the GPU reported; writes each kind's WGSL next to this file.
//   node scripts/shading-probe/run.mjs
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(here, "../../../agent/package.json"));
const puppeteer = require("puppeteer");

const server = await createServer({ configFile: path.join(here, "vite.config.mjs") });
await server.listen();
const url = `http://localhost:${server.config.server.port}/`;
const browser = await puppeteer.launch({ headless: true, args: ["--enable-unsafe-webgpu"] });
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error("[page]", error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      console.error(`[console.${message.type()}]`, message.text().slice(0, 2000));
    }
  });
  await page.goto(url);
  const started = Date.now();
  let report = null;
  while (Date.now() - started < 180000) {
    report = await page.evaluate(() => window.__probe ?? null);
    if (report?.done) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const out = path.join(here, "out");
  fs.mkdirSync(out, { recursive: true });
  for (const [kind, shader] of Object.entries(report?.shaders ?? {})) {
    fs.writeFileSync(path.join(out, `${kind}.vert.wgsl`), shader.vertex);
    fs.writeFileSync(path.join(out, `${kind}.frag.wgsl`), shader.fragment);
  }
  console.log(JSON.stringify({ ok: report?.ok, kinds: Object.keys(report?.shaders ?? {}), errors: report?.errors?.map((e) => e.slice(0, 3000)) }, null, 1));
} finally {
  await browser.close();
  await server.close();
}
