/**
 * The headless browser a viewer server captures with: launched on demand,
 * kept for the server's life, and never allowed to outlive it (a detached
 * watchdog kills it if the server dies without cleaning up). Captions and
 * sheets are laid out as HTML and rendered by the same browser, so no image
 * library is needed.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

type Puppeteer = typeof import("puppeteer");
type Browser = import("puppeteer").Browser;
type Page = import("puppeteer").Page;

async function loadPuppeteer(): Promise<Puppeteer> {
  try {
    return (await import("puppeteer")).default as unknown as Puppeteer;
  } catch {
    const require = createRequire(import.meta.url);
    const agent = require.resolve("@voxelize/agent/package.json");
    return createRequire(agent)("puppeteer") as Puppeteer;
  }
}

/** Kills `browserPid` once `ownerPid` is gone, for owners that die hard. */
function startWatchdog(ownerPid: number, browserPid: number, logFile: string) {
  const script = `
    const fs = require("fs");
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    const timer = setInterval(() => {
      if (!alive(${browserPid})) { clearInterval(timer); process.exit(0); }
      if (!alive(${ownerPid})) {
        try { process.kill(${browserPid}, "SIGKILL"); } catch {}
        fs.appendFileSync(${JSON.stringify(logFile)}, "[watchdog] viewer server ${ownerPid} died; killed its browser ${browserPid}\\n");
        process.exit(0);
      }
    }, 2000);
  `;
  const child = spawn(process.execPath, ["-e", script], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export class HeadlessBrowser {
  private browser: Browser | null = null;

  private launching: Promise<Browser> | null = null;

  constructor(private readonly logFile: string) {}

  get isOpen() {
    return this.browser?.connected ?? false;
  }

  async get(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    this.launching ??= (async () => {
      const puppeteer = await loadPuppeteer();
      fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
      const browser = await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--enable-webgl",
          "--ignore-gpu-blocklist",
          "--enable-gpu-rasterization",
          "--mute-audio",
          "--log-level=2",
        ],
        defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
        protocolTimeout: 600_000,
      });
      const pid = browser.process()?.pid;
      if (pid) startWatchdog(process.pid, pid, this.logFile);
      fs.appendFileSync(
        this.logFile,
        `[${new Date().toISOString()}] browser ${pid} launched\n`,
      );
      this.browser = browser;
      this.launching = null;
      return browser;
    })();
    return this.launching;
  }

  async newPage(): Promise<Page> {
    const page = await (await this.get()).newPage();
    page.on("console", (message) => {
      const type = message.type();
      if (type === "error" || type === "warn") {
        fs.appendFileSync(this.logFile, `[page ${type}] ${message.text()}\n`);
      }
    });
    page.on("pageerror", (error) => {
      fs.appendFileSync(
        this.logFile,
        `[page error] ${(error as Error).message}\n`,
      );
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        fs.appendFileSync(
          this.logFile,
          `[page fetch ${response.status()}] ${response.url()}\n`,
        );
      }
    });
    return page;
  }

  async close(reason: string) {
    const browser = this.browser;
    this.browser = null;
    if (!browser) return;
    fs.appendFileSync(
      this.logFile,
      `[${new Date().toISOString()}] closing browser: ${reason}\n`,
    );
    await browser.close().catch(() => browser.process()?.kill("SIGKILL"));
  }
}

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ENTITIES[c] ?? c);

const STYLE = `
  * { box-sizing: border-box; margin: 0; }
  body { background: #101216; color: #d8dde6; font: 15px/1.45 Arial, Helvetica, sans-serif; }
  .frame { position: relative; }
  .frame img { display: block; width: 100%; }
  .stamp { position: absolute; left: 10px; top: 10px; background: rgba(16,18,22,.8); color: #ffd24a;
           font-weight: bold; font-size: 14px; padding: 3px 8px; letter-spacing: .04em; }
  .caption { padding: 10px 14px 12px; }
  .title { color: #ffd24a; font-weight: bold; font-size: 16px; margin-bottom: 3px; }
  .grid { display: grid; gap: 14px; padding: 14px; }
  .cell .caption { padding: 6px 2px 0; font-size: 14px; }
  .number { color: #ffd24a; font-weight: bold; margin-right: 6px; }
  h1 { font-size: 22px; color: #f0e6c8; padding: 16px 14px 0; }
`;

/** One labelled capture: the frame, its stamp and a caption bar. */
export function captionHtml(
  image: string,
  title: string,
  lines: string[],
  stamp: string,
) {
  return `<!doctype html><style>${STYLE}</style>
  <div class="frame"><img src="${image}"><div class="stamp">${escape(stamp)}</div></div>
  <div class="caption"><div class="title">${escape(title)}</div>${lines
    .map((l) => `<div>${escape(l)}</div>`)
    .join("")}</div>`;
}

/** A numbered sheet of captures. */
export function sheetHtml(
  title: string,
  cells: { image: string; caption: string }[],
  columns: number,
  stamp: string,
  footer: string[],
) {
  return `<!doctype html><style>${STYLE}</style>
  <h1>${escape(title)}</h1>
  <div class="grid" style="grid-template-columns: repeat(${columns}, 1fr)">
  ${cells
    .map(
      (
        c,
        i,
      ) => `<div class="cell"><div class="frame"><img src="${c.image}"><div class="stamp">${escape(stamp)}</div></div>
      <div class="caption"><span class="number">${i + 1}.</span>${escape(c.caption)}</div></div>`,
    )
    .join("")}
  </div>
  <div class="caption">${footer.map((l) => `<div>${escape(l)}</div>`).join("")}</div>`;
}

/** Renders `html` at `width` CSS pixels to a PNG file. */
export async function renderHtml(
  browser: HeadlessBrowser,
  html: string,
  out: string,
  width: number,
) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width, height: 600, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out as `${string}.png`, fullPage: true });
  } finally {
    await page.close();
  }
}
