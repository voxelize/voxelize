/**
 * `voxelize-viewer`: serve the viewer, shoot labelled captures and sheets,
 * query columns and drive a long session, all against one local server
 * that stays warm between calls (it is started on demand, detached, and
 * exits on its own after an idle spell).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseVec, type Preset, PRESETS } from "../pose";

import {
  type CaptureRequest,
  startViewerServer,
  type ViewerServerConfig,
} from "./server";

export type ViewerConfigModule = {
  /** Everything but the port, which the CLI chooses. */
  server: Omit<ViewerServerConfig, "port">;
  port?: number;
};

const USAGE = `usage: voxelize-viewer --config <file> <command> [options]

commands:
  serve                      run the server in the foreground (the page is at its URL)
    --port N --idle-ttl MIN  (0 keeps it up for good)
  shot                       one labelled capture; prints the file and a JSON line
    --source SPEC            a source spec the config resolves (default: its defaultSource)
    --b SPEC                 a second source: an A/B capture (--split side|swipe)
    --pos x,y,z --look x,y,z a share-link pose
    --bookmark ID            a configured place
    --top-around x,z[,r]     top-down over a square of half-size r (default 128)
    --iso-around x,z[,r]     isometric over the same
    --preset free|orbit|top|iso
    --fly-to x,y,z | x,z     after posing, fly to frame that point as a double-click does
    --time F --overlay a,b --toggle key=value (repeatable; water=off, fog=game, plants=off, ...)
    --size WxH --out FILE --label TEXT --timeout SEC
  sheet --title T [--columns N] [--out FILE] --view "<shot options>" [--view ...]
                             several captures in one numbered, captioned sheet
  page-shot --query "a=SPEC&bookmark=ID&overlays=..." [--size WxH] [--out FILE] [--label TEXT]
                             the whole page as a person sees it, toolbar included
  query --source SPEC x,z [x,z ...]   what the backend knows about columns
  call ACTION [JSON ARGS]    drive the server's headless page (state, setPose, setOptions,
                             applyOptions, goTo, setPreset, flyTo, shareLink, waitIdle)
  fly-to x,y,z | x,z [--duration SEC] [--keep-zoom]
                             fly the headless page's camera there, as a double-click does,
                             and print where it landed
  pin x,y,z | x,z [--label L]  drop a pin on the headless page; prints what the source knows there
  pins                       the headless page's pins
  pin-action PIN|x,y,z ACTION [--to PIN] [--open]
                             run a wheel action: spawn, fly, look, measure, bookmark, copy-link,
                             copy-coords, remove, pin (spawn prints the game link; --open opens it)
  sources SPEC               start (or reuse) a source and print where it came from
  bookmarks | state | stop

common: --port N (default from the config, else 4810)`;

class UsageError extends Error {}

type Parsed = { command: string; flags: Map<string, string[]>; rest: string[] };

function parse(argv: string[]): Parsed {
  const flags = new Map<string, string[]>();
  const rest: string[] = [];
  let command = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const isSwitch = ["json", "detach", "help", "keep-zoom", "open"].includes(
        key,
      );
      const value = isSwitch ? "true" : argv[++i];
      if (value === undefined) throw new UsageError(`${a} needs a value`);
      flags.set(key, [...(flags.get(key) ?? []), value]);
    } else if (!command) command = a;
    else rest.push(a);
  }
  return { command, flags, rest };
}

const one = (p: Parsed, key: string) => p.flags.get(key)?.at(-1);

/** `x,y,z`, or `x,z` for the ground there. */
function parseFlyPoint(
  text: string,
  what: string,
): [number, number | null, number] {
  const parts = text.split(",").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) {
    throw new UsageError(`${what} needs x,y,z or x,z`);
  }
  if (parts.length === 2) return [parts[0], null, parts[1]];
  if (parts.length === 3) return [parts[0], parts[1], parts[2]];
  throw new UsageError(`${what} needs x,y,z or x,z`);
}

const outPath = (p: Parsed) => {
  const out = one(p, "out");
  return out ? path.resolve(out) : undefined;
};

/** Shot options as a capture request. */
export function captureRequest(p: Parsed): CaptureRequest {
  const options: string[] = [];
  const request: CaptureRequest = { options };
  const source = one(p, "source");
  if (source) request.source = source;
  const b = one(p, "b");
  if (b) request.b = b;
  const split = one(p, "split");
  if (split) {
    if (split !== "side" && split !== "swipe")
      throw new UsageError("--split takes side or swipe");
    request.split = split;
  }
  const pos = one(p, "pos");
  const look = one(p, "look");
  if (pos || look) {
    if (!pos || !look) throw new UsageError("--pos and --look go together");
    request.pose = { eye: parseVec(pos), look: parseVec(look) };
  }
  const preset = one(p, "preset");
  if (preset) {
    if (!(PRESETS as readonly string[]).includes(preset))
      throw new UsageError(`--preset takes ${PRESETS.join(" | ")}`);
    request.preset = preset as Preset;
  }
  for (const [flag, kind] of [
    ["top-around", "top"],
    ["iso-around", "iso"],
  ] as const) {
    const value = one(p, flag);
    if (!value) continue;
    const [x, z, r = 128] = value.split(",").map(Number);
    if (![x, z, r].every(Number.isFinite))
      throw new UsageError(`--${flag} needs x,z[,r]`);
    request.around = [x, z, r];
    request.preset = kind;
  }
  const bookmark = one(p, "bookmark");
  if (bookmark) request.bookmark = bookmark;
  const flyTo = one(p, "fly-to");
  if (flyTo) request.flyTo = parseFlyPoint(flyTo, "--fly-to");
  const time = one(p, "time");
  if (time) options.push(`time=${time}`);
  const overlay = one(p, "overlay");
  if (overlay) options.push(`overlays=${overlay}`);
  for (const t of p.flags.get("toggle") ?? []) options.push(t);
  const size = one(p, "size");
  if (size) {
    const [w, h] = size.toLowerCase().split("x").map(Number);
    if (!(w > 0 && h > 0)) throw new UsageError("--size needs WxH");
    request.size = [Math.round(w), Math.round(h)];
  }
  const out = one(p, "out");
  if (out) request.out = path.resolve(out);
  const label = one(p, "label");
  if (label) request.label = label;
  const timeout = one(p, "timeout");
  if (timeout) request.timeoutMs = Number(timeout) * 1000;
  return request;
}

async function loadConfig(file: string): Promise<ViewerConfigModule> {
  const module = (await import(pathToFileURL(path.resolve(file)).href)) as {
    default?: ViewerConfigModule | (() => Promise<ViewerConfigModule>);
  };
  const exported = module.default;
  if (!exported) throw new UsageError(`${file} has no default export`);
  return typeof exported === "function" ? await exported() : exported;
}

async function api<T>(base: string, route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${route}: ${response.status} ${text}`);
  return JSON.parse(text) as T;
}

async function isUp(base: string) {
  try {
    await api(base, "/api/ping", {});
    return true;
  } catch {
    return false;
  }
}

/** A running server on `port`, started detached when there is none. */
async function ensureServer(
  configFile: string,
  config: ViewerConfigModule,
  port: number,
) {
  const base = `http://127.0.0.1:${port}`;
  if (await isUp(base)) return base;
  const logDir = path.join(config.server.cacheDir, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const log = fs.openSync(path.join(logDir, "serve.out"), "a");
  const bin = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../bin/voxelize-viewer.ts",
  );
  const child = spawn(
    process.execPath,
    [
      ...process.execArgv,
      bin,
      "--config",
      configFile,
      "serve",
      "--port",
      String(port),
    ],
    { detached: true, stdio: ["ignore", log, log], env: process.env },
  );
  child.unref();
  process.stderr.write(
    `[viewer] started a server on ${base} (pid ${child.pid}; log ${path.join(logDir, "serve.out")})\n`,
  );
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await isUp(base)) return base;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `the viewer server did not come up on ${base}; see ${path.join(logDir, "serve.out")}`,
  );
}

export async function main(argv: string[]) {
  let p: Parsed;
  try {
    p = parse(argv);
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (!p.command || p.flags.has("help")) {
    console.log(USAGE);
    return;
  }
  const configFile = one(p, "config");
  if (!configFile) {
    console.error(`--config is required\n\n${USAGE}`);
    process.exit(2);
  }
  const config = await loadConfig(configFile);
  const port = Number(one(p, "port") ?? config.port ?? 4810);
  try {
    switch (p.command) {
      case "serve": {
        const ttl = one(p, "idle-ttl");
        const server = await startViewerServer({
          ...config.server,
          port,
          idleTtlMs:
            ttl === undefined ? config.server.idleTtlMs : Number(ttl) * 60_000,
        });
        console.log(server.url);
        const stop = (signal: string) =>
          void server.close(signal).then(() => process.exit(0));
        process.on("SIGINT", () => stop("SIGINT"));
        process.on("SIGTERM", () => stop("SIGTERM"));
        return;
      }
      case "shot":
      case "ab": {
        const base = await ensureServer(configFile, config, port);
        const request = captureRequest(p);
        if (p.command === "ab") {
          request.source ??= one(p, "a");
          if (!request.b) throw new UsageError("ab needs --b SPEC");
        }
        const result = await api<{ out: string }>(
          base,
          "/api/capture",
          request,
        );
        console.log(result.out);
        console.log(JSON.stringify(result));
        return;
      }
      case "sheet": {
        const base = await ensureServer(configFile, config, port);
        const views = p.flags.get("view") ?? [];
        if (!views.length)
          throw new UsageError("sheet needs at least one --view");
        const shared = captureRequest({
          ...p,
          flags: new Map(
            [...p.flags].filter(
              ([k]) =>
                !["view", "out", "label", "title", "columns"].includes(k),
            ),
          ),
        });
        const shots = views.map((view) => {
          const tokens =
            view
              .match(/(?:[^\s"]+|"[^"]*")+/g)
              ?.map((t) => t.replace(/^"|"$/g, "")) ?? [];
          const own = captureRequest(parse(["shot", ...tokens]));
          return {
            ...shared,
            ...own,
            options: [...(shared.options ?? []), ...(own.options ?? [])],
          };
        });
        const result = await api<{ out: string }>(base, "/api/sheet", {
          title: one(p, "title") ?? "views",
          columns: one(p, "columns") ? Number(one(p, "columns")) : undefined,
          out: outPath(p),
          shots,
        });
        console.log(result.out);
        console.log(JSON.stringify(result));
        return;
      }
      case "page-shot": {
        const base = await ensureServer(configFile, config, port);
        const size = one(p, "size")?.toLowerCase().split("x").map(Number);
        const result = await api<{ out: string }>(base, "/api/page-shot", {
          query: one(p, "query") ?? "",
          size,
          out: outPath(p),
          label: one(p, "label"),
        });
        console.log(result.out);
        console.log(JSON.stringify(result));
        return;
      }
      case "query": {
        const base = await ensureServer(configFile, config, port);
        const points = p.rest.map(
          (t) => t.split(",").map(Number) as [number, number],
        );
        if (
          !points.length ||
          points.some(
            (pt) => pt.length !== 2 || pt.some((n) => !Number.isFinite(n)),
          )
        ) {
          throw new UsageError("query needs x,z points");
        }
        console.log(
          JSON.stringify(
            await api(base, "/api/query", { source: one(p, "source"), points }),
            null,
            2,
          ),
        );
        return;
      }
      case "sources": {
        const base = await ensureServer(configFile, config, port);
        console.log(
          JSON.stringify(
            await api(base, "/api/sources", {
              spec: p.rest[0] ?? one(p, "source"),
            }),
            null,
            2,
          ),
        );
        return;
      }
      case "call": {
        const base = await ensureServer(configFile, config, port);
        const [action, args] = p.rest;
        if (!action) throw new UsageError("call needs an action");
        const parsedArgs = args ? JSON.parse(args) : [];
        console.log(
          JSON.stringify(
            await api(base, "/api/session", {
              action,
              args: Array.isArray(parsedArgs) ? parsedArgs : [parsedArgs],
            }),
            null,
            2,
          ),
        );
        return;
      }
      case "fly-to": {
        const base = await ensureServer(configFile, config, port);
        const [x, y, z] = parseFlyPoint(p.rest[0] ?? "", "fly-to");
        const duration = one(p, "duration");
        const result = await api(base, "/api/session", {
          action: "flyTo",
          args: [
            x,
            y,
            z,
            {
              ...(duration ? { duration: Number(duration) } : {}),
              ...(p.flags.has("keep-zoom") ? { keepZoom: true } : {}),
            },
          ],
        });
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      case "pin":
      case "pins":
      case "pin-action": {
        const base = await ensureServer(configFile, config, port);
        let action: string;
        let args: unknown[];
        if (p.command === "pin") {
          const [x, y, z] = parseFlyPoint(p.rest[0] ?? "", "pin");
          action = "dropPin";
          args = [x, y, z, { label: one(p, "label") }];
        } else if (p.command === "pins") {
          action = "pins";
          args = [];
        } else {
          const [targetText, name] = p.rest;
          if (!targetText || !name)
            throw new UsageError(
              "pin-action needs a pin (or x,y,z) and an action",
            );
          const target = /^-?[\d.]+,/.test(targetText)
            ? parseFlyPoint(targetText, "pin-action")
            : targetText;
          action = "pinAction";
          args = [
            target,
            name,
            {
              ...(one(p, "to") ? { to: one(p, "to") } : {}),
              ...(p.flags.has("open") ? { open: true } : {}),
            },
          ];
        }
        console.log(
          JSON.stringify(
            await api(base, "/api/session", { action, args }),
            null,
            2,
          ),
        );
        return;
      }
      case "bookmarks":
      case "state": {
        const base = await ensureServer(configFile, config, port);
        console.log(
          JSON.stringify(
            await api(
              base,
              p.command === "state" ? "/api/state" : "/api/bookmarks",
            ),
            null,
            2,
          ),
        );
        return;
      }
      case "stop": {
        const base = `http://127.0.0.1:${port}`;
        if (await isUp(base)) {
          await api(base, "/api/shutdown", {});
          const deadline = Date.now() + 15_000;
          while ((await isUp(base)) && Date.now() < deadline)
            await new Promise((r) => setTimeout(r, 200));
        }
        console.log("stopped");
        return;
      }
      default:
        throw new UsageError(`unknown command ${p.command}`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n\n${USAGE}`);
      process.exit(2);
    }
    console.error(`[viewer] ${(error as Error).message}`);
    process.exit(1);
  }
}
