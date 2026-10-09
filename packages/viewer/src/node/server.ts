/**
 * The viewer server: starts one backend per source, serves the page and the
 * tiles, keeps a headless page for scripted captures, and answers the
 * control API. Local only (it binds the loopback interface), and it exits
 * after `idleTtlMs` without an outside request.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { encodeBundle } from "../formats";
import type { Bookmark, Pose, Preset, Vec3 } from "../pose";

import { BackendProcess, type SpawnSpec } from "./backend";
import { captionHtml, HeadlessBrowser, renderHtml, sheetHtml } from "./browser";
import { bundlePage, type PageBundle } from "./bundle";
import { pruneDirectory } from "./cache";

export type ResolvedSource = {
  /** Stable for the same world, tree, build and profile. */
  id: string;
  label: string;
  world: string;
  spawn(launchFile: string): SpawnSpec;
  /** The host's fields of the launch file, beside `backend`. */
  launch: Record<string, unknown>;
  /** Where the source came from, printed with every capture. */
  provenance: Record<string, unknown>;
  /** Mixed into mesh keys: what else the host knows meshes depend on. */
  meshSalt?: string;
};

export type ViewerServerConfig = {
  port: number;
  host?: string;
  cacheDir: string;
  page: {
    entry: string;
    alias?: Record<string, string>;
    define?: Record<string, string>;
    assetRoots: string[];
    /** Served at the root for absolute URLs the page's code fetches (`/textures/x.png`). */
    publicDir?: string;
    /** Builds (or returns) the page's stylesheet, served at `/page.css`. */
    stylesheet?: () => Promise<string>;
    /** Path prefixes whose edits reload the headless session (default: the entry's directory and this package). */
    watch?: string[];
    /** How `.svg` imports bundle (see `PageBundleOptions.svg`). */
    svg?: "url" | "react";
    /** How image imports bundle (see `PageBundleOptions.images`). */
    images?: "static" | "url";
    title?: string;
    head?: string;
  };
  resolveSource(spec: string): Promise<ResolvedSource>;
  defaultSource: string;
  bookmarks?: Bookmark[];
  /** Printed on every capture so it is never taken for an in-game image. */
  stamp: string;
  captureDir: () => string;
  threads?: number;
  idleTtlMs?: number;
  /** How long the headless browser may sit unused before it is closed (default 5 min; 0 keeps it). The next capture relaunches it, with a fresh session page. */
  browserIdleMs?: number;
  meshCacheBytes?: number;
};

export type CaptureRequest = {
  source?: string;
  b?: string;
  split?: "side" | "swipe";
  pose?: Pose;
  bookmark?: string;
  preset?: Preset;
  /** Centre (x, z) and half-size for a framed top or iso view. */
  around?: [number, number, number];
  /** After posing, fly to frame this point as a double-click does; a null y takes the ground. */
  flyTo?: [number, number | null, number];
  options?: string[];
  size?: [number, number];
  out?: string;
  label?: string;
  timeoutMs?: number;
};

type SourceEntry = {
  resolved: ResolvedSource;
  backend: BackendProcess;
  meta: Record<string, unknown>;
  outDir: string;
  startedAt: number;
  readyMs: number;
  lastUsed: number;
};

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const sha = (text: string) =>
  crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);

const localDate = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export class ViewerServer {
  readonly url: string;

  private server: http.Server;

  private sourcesBySpec = new Map<string, Promise<SourceEntry>>();

  private sourcesById = new Map<string, SourceEntry>();

  private bundle: PageBundle | null = null;

  private bundling: Promise<PageBundle> | null = null;

  private bundleInputs: { file: string; mtime: number }[] = [];

  private browser: HeadlessBrowser;

  private session: Promise<import("puppeteer").Page> | null = null;

  private lastActivity = Date.now();

  private closed = false;

  private timers: NodeJS.Timeout[] = [];

  private captureQueue: Promise<unknown> = Promise.resolve();

  private browserBusy = 0;

  private lastBrowserUse = Date.now();

  constructor(private readonly config: ViewerServerConfig) {
    const host = config.host ?? "127.0.0.1";
    this.url = `http://${host}:${config.port}`;
    this.browser = new HeadlessBrowser(
      path.join(config.cacheDir, "logs", "browser.log"),
    );
    this.server = http.createServer((req, res) => {
      this.route(req, res).catch((error: Error) => {
        if (!res.headersSent)
          res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
      });
    });
  }

  async listen() {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(
        this.config.port,
        this.config.host ?? "127.0.0.1",
        () => resolve(),
      );
    });
    const ttl = this.config.idleTtlMs ?? 30 * 60_000;
    if (ttl > 0) {
      this.timers.push(
        setInterval(() => {
          if (Date.now() - this.lastActivity > ttl) {
            this.log(
              `idle for ${Math.round(ttl / 60_000)} min with no outside request; exiting`,
            );
            void this.close("idle ttl").then(() => process.exit(0));
          }
        }, 30_000),
      );
    }
    const browserIdle = this.config.browserIdleMs ?? 5 * 60_000;
    if (browserIdle > 0) {
      this.timers.push(
        setInterval(() => {
          if (
            !this.browser.isOpen ||
            this.browserBusy > 0 ||
            Date.now() - this.lastBrowserUse < browserIdle
          ) {
            return;
          }
          this.log(
            `headless browser unused for ${Math.round(browserIdle / 60_000)} min; closing it (the next capture relaunches it with a fresh session page)`,
          );
          this.session = null;
          void this.browser.close("unused");
        }, 30_000),
      );
    }
    const prune = () => {
      const cap = this.config.meshCacheBytes ?? 8 * 1024 ** 3;
      const { evicted, bytes } = pruneDirectory(
        path.join(this.config.cacheDir, "meshes"),
        cap,
        30 * 60_000,
      );
      if (evicted)
        this.log(
          `mesh cache: evicted ${evicted} least recently used files (${(bytes / 1024 ** 3).toFixed(2)} GiB kept)`,
        );
    };
    prune();
    this.timers.push(setInterval(prune, 10 * 60_000));
    for (const t of this.timers) t.unref();
    this.log(`listening on ${this.url}`);
  }

  log(message: string) {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    fs.mkdirSync(path.join(this.config.cacheDir, "logs"), { recursive: true });
    fs.appendFileSync(
      path.join(this.config.cacheDir, "logs", "server.log"),
      line,
    );
    process.stderr.write(`[viewer] ${message}\n`);
  }

  async close(reason: string) {
    if (this.closed) return;
    this.closed = true;
    this.log(`closing: ${reason}`);
    for (const t of this.timers) clearInterval(t);
    for (const entry of this.sourcesById.values()) entry.backend.stop();
    await this.browser.close(reason);
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** Resolves `spec` (a host source spec, or the id of one already up). */
  async source(spec: string): Promise<SourceEntry> {
    const byId = this.sourcesById.get(spec);
    if (byId?.backend.alive) {
      byId.lastUsed = Date.now();
      return byId;
    }
    const resolved = await this.config.resolveSource(spec);
    const existing = this.sourcesById.get(resolved.id);
    if (existing?.backend.alive) {
      existing.lastUsed = Date.now();
      return existing;
    }
    const key = resolved.id;
    let pending = this.sourcesBySpec.get(key);
    if (!pending) {
      pending = this.start(resolved);
      this.sourcesBySpec.set(key, pending);
      pending.catch(() => this.sourcesBySpec.delete(key));
    }
    return pending;
  }

  private async start(resolved: ResolvedSource): Promise<SourceEntry> {
    const outDir = path.join(this.config.cacheDir, "runs", resolved.id);
    fs.mkdirSync(outDir, { recursive: true });
    const launchFile = path.join(outDir, "launch.json");
    fs.writeFileSync(
      launchFile,
      JSON.stringify(
        {
          ...resolved.launch,
          backend: {
            out: path.join(outDir, "backend"),
            meshDir: path.join(this.config.cacheDir, "meshes"),
            meshSalt: resolved.meshSalt ?? "",
            threads: this.config.threads ?? 0,
          },
        },
        null,
        2,
      ),
    );
    const startedAt = Date.now();
    this.log(`starting source ${resolved.id} (${resolved.label})`);
    const backend = new BackendProcess(
      resolved.id,
      resolved.spawn(launchFile),
      path.join(this.config.cacheDir, "logs", `${resolved.id}.log`),
    );
    const { metaPath, ms } = await backend.ready;
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as Record<
      string,
      unknown
    >;
    const entry: SourceEntry = {
      resolved,
      backend,
      meta,
      outDir,
      startedAt,
      readyMs: ms,
      lastUsed: Date.now(),
    };
    this.sourcesById.set(resolved.id, entry);
    this.log(`source ${resolved.id} ready in ${ms} ms`);
    return entry;
  }

  private describe(entry: SourceEntry) {
    return {
      id: entry.resolved.id,
      label: entry.resolved.label,
      world: entry.resolved.world,
      provenance: entry.resolved.provenance,
      readyMs: entry.readyMs,
      alive: entry.backend.alive,
    };
  }

  private async pageBundle(): Promise<PageBundle> {
    const stale =
      !this.bundle ||
      this.bundleInputs.some(({ file, mtime }) => {
        try {
          return fs.statSync(file).mtimeMs > mtime;
        } catch {
          return true;
        }
      });
    if (!stale && this.bundle) return this.bundle;
    this.bundling ??= (async () => {
      const page = this.config.page;
      const result = await bundlePage({
        entry: page.entry,
        outDir: path.join(this.config.cacheDir, "page"),
        alias: page.alias,
        define: page.define,
        assetRoots: page.assetRoots,
        svg: page.svg,
        images: page.images,
      });
      this.bundle = result;
      this.bundleInputs = await this.collectInputs();
      this.bundling = null;
      this.log(`page bundled in ${result.ms} ms (${result.assets} assets)`);
      return result;
    })();
    return this.bundling;
  }

  /** The bundle's sources, from the inline source map, to rebuild when any changes. */
  private async collectInputs() {
    const out: { file: string; mtime: number }[] = [];
    if (!this.bundle) return out;
    const text = fs.readFileSync(this.bundle.app, "utf8");
    const match = text.match(
      /sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)\s*$/,
    );
    if (!match) return out;
    const map = JSON.parse(
      Buffer.from(match[1], "base64").toString("utf8"),
    ) as { sources: string[] };
    const dir = path.dirname(this.bundle.app);
    const now = Date.now();
    for (const source of map.sources) {
      const file = path.resolve(dir, source);
      if (file.includes(`${path.sep}node_modules${path.sep}`)) continue;
      out.push({ file, mtime: now });
    }
    return out;
  }

  private html() {
    const page = this.config.page;
    const css = page.stylesheet
      ? `<link rel="stylesheet" href="/page.css?v=${Date.now()}">`
      : "";
    return `<!doctype html><html><head><meta charset="utf-8"><title>${page.title ?? "World viewer"}</title>${css}
<style>html,body{margin:0;height:100%;background:#0b0d10;overflow:hidden}#viewer{position:absolute;inset:0}</style>${page.head ?? ""}</head>
<body><div id="viewer"></div><script type="module" src="/app.js?v=${Date.now()}"></script></body></html>`;
  }

  private json(res: http.ServerResponse, value: unknown, status = 200) {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(value));
  }

  private async route(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? "/", this.url);
    const isSession =
      url.searchParams.get("session") === "1" ||
      req.headers["x-viewer-session"] === "1";
    if (!isSession && !url.pathname.startsWith("/api/source/"))
      this.lastActivity = Date.now();
    const parts = url.pathname.split("/").filter(Boolean);

    if (req.method === "GET" && url.pathname === "/") {
      await this.pageBundle();
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(this.html());
      return;
    }
    if (
      req.method === "GET" &&
      (url.pathname === "/app.js" || url.pathname === "/viewer-worker.js")
    ) {
      const bundle = await this.pageBundle();
      const file = url.pathname === "/app.js" ? bundle.app : bundle.worker;
      res.writeHead(200, {
        "content-type": "text/javascript",
        "cache-control": "no-store",
      });
      fs.createReadStream(file).pipe(res);
      return;
    }
    if (req.method === "GET" && parts[0] === "asset") {
      const root = this.config.page.assetRoots[Number(parts[1])];
      const file =
        root && path.resolve(root, ...parts.slice(2).map(decodeURIComponent));
      if (
        !root ||
        !file ||
        !file.startsWith(path.resolve(root) + path.sep) ||
        !fs.existsSync(file)
      ) {
        res.writeHead(404);
        res.end();
        return;
      }
      const ext = path.extname(file).toLowerCase();
      const type =
        {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".gif": "image/gif",
          ".webp": "image/webp",
          ".svg": "image/svg+xml",
        }[ext] ?? "application/octet-stream";
      res.writeHead(200, {
        "content-type": type,
        "cache-control": "max-age=3600",
      });
      fs.createReadStream(file).pipe(res);
      return;
    }
    if (
      req.method === "GET" &&
      url.pathname === "/page.css" &&
      this.config.page.stylesheet
    ) {
      const file = await this.config.page.stylesheet();
      res.writeHead(200, {
        "content-type": "text/css",
        "cache-control": "no-store",
      });
      fs.createReadStream(file).pipe(res);
      return;
    }
    if (parts[0] !== "api") {
      const publicDir = this.config.page.publicDir;
      const file =
        publicDir && path.resolve(publicDir, ...parts.map(decodeURIComponent));
      if (
        req.method === "GET" &&
        file &&
        file.startsWith(path.resolve(publicDir) + path.sep) &&
        fs.existsSync(file) &&
        fs.statSync(file).isFile()
      ) {
        res.writeHead(200, { "cache-control": "max-age=3600" });
        fs.createReadStream(file).pipe(res);
        return;
      }
      res.writeHead(404);
      res.end();
      return;
    }
    const body = req.method === "POST" ? await readBody(req) : "";
    const input = body ? (JSON.parse(body) as Record<string, unknown>) : {};

    switch (parts[1]) {
      case "ping":
        return this.json(res, { ok: true });
      case "state":
        return this.json(res, {
          url: this.url,
          pid: process.pid,
          defaultSource: this.config.defaultSource,
          sources: [...this.sourcesById.values()].map((e) => this.describe(e)),
          // The headless page `call` drives; its sources and pose: `call state`.
          session: this.session
            ? { loadedAt: new Date(this.sessionLoadedAt).toISOString() }
            : null,
          bookmarks: this.config.bookmarks ?? [],
        });
      case "bookmarks":
        return this.json(res, this.config.bookmarks ?? []);
      case "sources": {
        const spec = String(
          input.spec ??
            url.searchParams.get("spec") ??
            this.config.defaultSource,
        );
        const entry = await this.source(spec);
        return this.json(res, this.describe(entry));
      }
      case "query": {
        const spec = String(
          input.source ??
            url.searchParams.get("source") ??
            this.config.defaultSource,
        );
        const points = (input.points as [number, number][] | undefined) ?? [
          [
            Number(url.searchParams.get("x")),
            Number(url.searchParams.get("z")),
          ],
        ];
        const entry = await this.source(spec);
        const reply = await entry.backend.request("query", { points });
        return this.json(res, {
          source: this.describe(entry),
          points: reply.points,
        });
      }
      case "source":
        return this.routeSource(parts[2], parts[3], input, res);
      case "capture": {
        const result = await this.enqueue(() =>
          this.capture(input as CaptureRequest),
        );
        return this.json(res, result);
      }
      case "sheet": {
        const result = await this.enqueue(() => this.sheet(input));
        return this.json(res, result);
      }
      case "page-shot": {
        const result = await this.enqueue(() => this.pageShot(input));
        return this.json(res, result);
      }
      case "session": {
        const result = await this.enqueue(() => this.sessionCall(input));
        return this.json(res, result);
      }
      case "shutdown":
        this.json(res, { ok: true });
        void this.close("shutdown requested").then(() => process.exit(0));
        return;
      default:
        return this.json(res, { error: `unknown api ${url.pathname}` }, 404);
    }
  }

  private async routeSource(
    id: string,
    action: string,
    input: Record<string, unknown>,
    res: http.ServerResponse,
  ) {
    const entry = this.sourcesById.get(decodeURIComponent(id));
    if (!entry)
      return this.json(
        res,
        { error: `no source ${id} (start it with POST /api/sources)` },
        404,
      );
    entry.lastUsed = Date.now();
    switch (action) {
      case "meta":
        return this.json(res, {
          ...entry.meta,
          label: entry.resolved.label,
          provenance: entry.resolved.provenance,
        });
      case "blocks":
        res.writeHead(200, { "content-type": "application/json" });
        fs.createReadStream(String(entry.meta.blocks)).pipe(res);
        return;
      case "chunks": {
        const reply = await entry.backend.request<{
          chunks: Record<string, unknown>[];
        }>("chunks", {
          chunks: input.chunks,
        });
        const now = new Date();
        const files = reply.chunks.map((row) => {
          if (!row.file)
            return {
              header: { cx: row.cx, cz: row.cz, key: null, empty: true },
              file: null,
            };
          const file = String(row.file);
          // Served files count as used, so the size cap evicts the cold ones.
          fs.utimes(file, now, now, () => {});
          return {
            header: {
              cx: row.cx,
              cz: row.cz,
              key: row.key ?? null,
              empty: false,
            },
            file: fs.readFileSync(file),
          };
        });
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.end(Buffer.from(encodeBundle(files)));
        return;
      }
      case "far": {
        const reply = await entry.backend.request<{
          tiles: Record<string, unknown>[];
        }>("far", {
          tiles: input.tiles,
        });
        const files = reply.tiles.map((row) =>
          row.error
            ? { header: { error: row.error }, file: null }
            : {
                header: { spec: row.spec },
                file: fs.readFileSync(String(row.file)),
              },
        );
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.end(Buffer.from(encodeBundle(files)));
        return;
      }
      case "query":
        return this.json(
          res,
          await entry.backend.request("query", { points: input.points }),
        );
      case "annotations":
        return this.json(
          res,
          await entry.backend.request("annotations", {
            min: input.min,
            max: input.max,
          }),
        );
      case "stats":
        return this.json(res, await entry.backend.request("stats", {}));
      default:
        return this.json(
          res,
          { error: `unknown source action ${action}` },
          404,
        );
    }
  }

  /** Runs browser work one job at a time, and keeps the browser open while any waits. */
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    this.browserBusy += 1;
    const run = async () => {
      this.lastBrowserUse = Date.now();
      try {
        return await work();
      } finally {
        this.lastBrowserUse = Date.now();
        this.browserBusy -= 1;
      }
    };
    const next = this.captureQueue.then(run, run);
    this.captureQueue = next.catch(() => undefined);
    return next;
  }

  private sessionLoadedAt = 0;

  /**
   * Whether the viewer's own code (the page entry's directory, this package)
   * changed since the headless page loaded. Edits elsewhere in a host's
   * client land at the next reload instead: a busy tree would otherwise
   * reset a scripted session between every two calls.
   */
  private viewerCodeChanged() {
    const watch = this.config.page.watch ?? [
      path.dirname(this.config.page.entry),
      path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."),
    ];
    return this.bundleInputs.some(({ file }) => {
      if (!watch.some((prefix) => file.startsWith(prefix))) return false;
      try {
        return fs.statSync(file).mtimeMs > this.sessionLoadedAt;
      } catch {
        return true;
      }
    });
  }

  /** The headless page, reloaded when the viewer's code changed since it loaded. */
  private async sessionPage(reload = false) {
    if (this.session && (reload || this.viewerCodeChanged())) {
      const stale = await this.session.catch(() => null);
      this.session = null;
      await stale?.close().catch(() => undefined);
      this.log(
        reload
          ? "reloading the headless session"
          : "viewer code changed; reloading the headless session",
      );
    }
    if (!this.session) await this.pageBundle();
    this.session ??= (async () => {
      const page = await this.browser.newPage();
      await page.setExtraHTTPHeaders({ "x-viewer-session": "1" });
      await page.goto(`${this.url}/?session=1&hud=off`, {
        waitUntil: "load",
        timeout: 120_000,
      });
      await page.waitForFunction(() => !!window.__voxelizeViewer, {
        timeout: 120_000,
      });
      this.sessionLoadedAt = Date.now();
      return page;
    })();
    try {
      return await this.session;
    } catch (error) {
      this.session = null;
      throw error;
    }
  }

  private async sessionCall(input: Record<string, unknown>) {
    const action = String(input.action);
    const page = await this.sessionPage(action === "reload");
    if (action === "reload")
      return { ok: true, reloadedAt: this.sessionLoadedAt };
    const args = (input.args as unknown[]) ?? [];
    return page.evaluate(
      async (name, list) => {
        const control = window.__voxelizeViewer as unknown as Record<
          string,
          (...a: unknown[]) => unknown
        >;
        if (typeof control[name] !== "function")
          throw new Error(`no control ${name}`);
        return await control[name](...list);
      },
      action,
      args,
    );
  }

  /** One labelled capture; returns the file and what it shows. */
  async capture(request: CaptureRequest) {
    const started = Date.now();
    const a = await this.source(request.source ?? this.config.defaultSource);
    const b = request.b ? await this.source(request.b) : null;
    const resolvedAt = Date.now();
    const page = await this.sessionPage();
    const [width, height] = request.size ?? [1600, 1000];
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    let aroundPose: Pose | null = null;
    if (request.around && !request.pose) {
      const [x, z, r] = request.around;
      const reply = await a.backend.request<{
        points: {
          ground?: { y: number } | null;
          source?: { surface?: number };
        }[];
      }>("query", { points: [[x, z]] });
      const p = reply.points[0];
      const ground = p?.ground?.y ?? p?.source?.surface;
      if (ground === undefined) {
        throw new Error(
          `${a.resolved.label} has no ground at ${x},${z} to frame on; pass --pos and --look instead`,
        );
      }
      aroundPose = { eye: [x, ground + r, z + r], look: [x, ground, z] };
    }
    if (request.flyTo && request.flyTo[1] === null) {
      const [x, , z] = request.flyTo;
      const reply = await a.backend.request<{
        points: {
          ground?: { y: number } | null;
          source?: { surface?: number };
        }[];
      }>("query", { points: [[x, z]] });
      const p = reply.points[0];
      const ground = p?.ground?.y ?? p?.source?.surface;
      if (ground === undefined) {
        throw new Error(
          `${a.resolved.label} has no ground at ${x},${z} to fly to; pass its height`,
        );
      }
      request.flyTo = [x, ground, z];
    }
    const state = await page.evaluate(
      async (req, refs, around) => {
        const control = window.__voxelizeViewer;
        if (!control)
          throw new Error("the viewer page has no control installed");
        await control.setSources(refs.a, refs.b);
        control.resetOptions();
        control.applyOptions([
          ...(req.options ?? []),
          "hud=off",
          ...(refs.b ? [`split=${req.split ?? "side"}`] : []),
        ]);
        if (req.bookmark) control.goTo(req.bookmark);
        if (req.pose) control.setPose(req.pose, req.preset ?? "orbit");
        else if (req.around && around) {
          control.setPose(around, "orbit");
          control.setPreset(req.preset ?? "top", req.around[2] * 2);
        } else if (req.preset) control.setPreset(req.preset);
        if (req.flyTo) {
          const [x, y, z] = req.flyTo;
          await control.flyTo(x, y, z);
        }
        return control.state();
      },
      request,
      {
        a: { id: a.resolved.id, label: a.resolved.label },
        b: b ? { id: b.resolved.id, label: b.resolved.label } : null,
      },
      aroundPose,
    );
    const setAt = Date.now();
    const idle = await page.evaluate((timeoutMs) => {
      const control = window.__voxelizeViewer;
      if (!control) throw new Error("the viewer page has no control installed");
      return control.waitIdle({ timeoutMs, settleFrames: 10 });
    }, request.timeoutMs ?? 180_000);
    const idleAt = Date.now();
    const element = await page.$("#viewer");
    if (!element) throw new Error("the viewer page has no #viewer element");
    const shot = (await element.screenshot({ type: "png" })) as Uint8Array;
    const final = await page.evaluate(() => {
      const control = window.__voxelizeViewer;
      if (!control) throw new Error("the viewer page has no control installed");
      return control.state();
    });
    const out =
      request.out ??
      path.join(
        this.config.captureDir(),
        `${(request.label ?? `${final.preset}-${final.pose.look.map(Math.round).join("_")}`).replace(/[^a-z0-9._-]+/gi, "-").slice(0, 80)}.png`,
      );
    const describeSource = (entry: SourceEntry) =>
      `${entry.resolved.label}${entry.resolved.provenance.status ? ` (${String(entry.resolved.provenance.status)})` : ""}`;
    const f = (v: Vec3) => v.map((n) => Math.round(n)).join(",");
    const lines = [
      `${final.preset} · eye ${f(final.pose.eye)} → look ${f(final.pose.look)} · time ${final.options.time}` +
        ` · fog ${final.options.fog} · overlays ${final.options.overlays.join(",") || "none"}` +
        `${final.options.water ? "" : " · water hidden"}${final.options.plants ? "" : " · plants hidden"}`,
      b
        ? `A ${describeSource(a)}  |  B ${describeSource(b)} (${final.options.split})`
        : `source ${describeSource(a)}`,
      `${idle.idle ? "settled" : "NOT SETTLED (timed out)"} after ${Math.round(idle.waitedMs)} ms · ${idle.views
        .map(
          (v) =>
            `${v.label}: ${v.chunks.resident} chunks, ${v.far.tilesResident} far tiles`,
        )
        .join(" · ")}`,
    ];
    const title = `${this.config.stamp}${request.label ? ` · ${request.label}` : ""}`;
    const image = `data:image/png;base64,${Buffer.from(shot).toString("base64")}`;
    await renderHtml(
      this.browser,
      captionHtml(image, title, lines, this.config.stamp.split(" — ")[0]),
      out,
      width,
    );
    const json = {
      out,
      label: request.label ?? null,
      world: a.resolved.world,
      source: {
        id: a.resolved.id,
        label: a.resolved.label,
        ...a.resolved.provenance,
      },
      b: b
        ? {
            id: b.resolved.id,
            label: b.resolved.label,
            ...b.resolved.provenance,
          }
        : null,
      preset: final.preset,
      pose: final.pose,
      options: final.options,
      shareLink: final.shareLink,
      settled: idle.idle,
      views: idle.views,
      timings: {
        resolveMs: resolvedAt - started,
        setupMs: setAt - resolvedAt,
        idleMs: idleAt - setAt,
        captureMs: Date.now() - idleAt,
        totalMs: Date.now() - started,
      },
      requestedPose: state.pose,
    };
    return json;
  }

  /** The whole page as a person sees it (the host's toolbar included). */
  async pageShot(input: Record<string, unknown>) {
    const started = Date.now();
    const [width, height] = (input.size as [number, number] | undefined) ?? [
      1600, 1000,
    ];
    const page = await this.browser.newPage();
    try {
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      const query = String(input.query ?? "");
      await page.goto(`${this.url}/?${query}`, {
        waitUntil: "load",
        timeout: 180_000,
      });
      await page.waitForFunction(
        () =>
          !!window.__voxelizeViewer &&
          window.__voxelizeViewer.state().views.length > 0,
        {
          timeout: 180_000,
        },
      );
      const idle = await page.evaluate(
        (t) => {
          const control = window.__voxelizeViewer;
          if (!control)
            throw new Error("the viewer page has no control installed");
          return control.waitIdle({ timeoutMs: t, settleFrames: 10 });
        },
        Number(input.timeoutMs ?? 180_000),
      );
      await new Promise((r) => setTimeout(r, Number(input.waitMs ?? 500)));
      const shot = (await page.screenshot({ type: "png" })) as Uint8Array;
      const state = await page.evaluate(() => {
        const control = window.__voxelizeViewer;
        if (!control)
          throw new Error("the viewer page has no control installed");
        return control.state();
      });
      const out =
        (input.out as string | undefined) ??
        path.join(
          this.config.captureDir(),
          `${String(input.label ?? "page").replace(/[^a-z0-9._-]+/gi, "-")}.png`,
        );
      const image = `data:image/png;base64,${Buffer.from(shot).toString("base64")}`;
      await renderHtml(
        this.browser,
        captionHtml(
          image,
          `${this.config.stamp} · ${String(input.label ?? "the viewer page")}`,
          [
            `page ${this.url}/?${query}`,
            `${idle.idle ? "settled" : "NOT SETTLED"} after ${Math.round(idle.waitedMs)} ms · ${state.views.map((v) => `${v.label}: ${v.chunks.resident} chunks`).join(" · ")}`,
          ],
          this.config.stamp.split(" — ")[0],
        ),
        out,
        width,
      );
      return { out, settled: idle.idle, state, totalMs: Date.now() - started };
    } finally {
      await page.close();
    }
  }

  async sheet(input: Record<string, unknown>) {
    const shots = (input.shots as CaptureRequest[]) ?? [];
    const results = [];
    for (const shot of shots)
      results.push(
        await this.capture({
          ...shot,
          out: path.join(
            this.config.cacheDir,
            "sheet-parts",
            `${sha(JSON.stringify(shot))}.png`,
          ),
        }),
      );
    const title = `${this.config.stamp} · ${String(input.title ?? "sheet")}`;
    const columns = Number(input.columns ?? Math.min(3, results.length));
    const cells = results.map((r, i) => ({
      image: `data:image/png;base64,${fs.readFileSync(r.out).toString("base64")}`,
      caption:
        shots[i].label ??
        r.label ??
        `${r.preset} ${r.pose.look.map(Math.round).join(",")}`,
    }));
    const out =
      (input.out as string | undefined) ??
      path.join(
        this.config.captureDir(),
        `sheet-${String(input.title ?? "views").replace(/[^a-z0-9._-]+/gi, "-")}.png`,
      );
    const width = Number(input.width ?? Math.min(3200, columns * 900));
    await renderHtml(
      this.browser,
      sheetHtml(title, cells, columns, this.config.stamp.split(" — ")[0], [
        `${results.length} views · ${localDate()} · every panel: ${this.config.stamp}`,
      ]),
      out,
      width,
    );
    return { out, shots: results };
  }
}

export async function startViewerServer(config: ViewerServerConfig) {
  const server = new ViewerServer(config);
  await server.listen();
  return server;
}
