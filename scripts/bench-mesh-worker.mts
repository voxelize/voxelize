/**
 * What one remesh costs inside the mesh worker, scene by scene: the worker's
 * own `onmessage` run exactly as a page runs it (registry hand-off, the wasm
 * mesher, packing the result into the typed arrays the main thread uploads),
 * with a hash of what it posted back.
 *
 *   # the scenes come from the mesher's stress example
 *   cargo run --release -p voxelize-mesher --example stress -- --dump /tmp/scenes
 *   pnpm bench:mesh-worker --scenes /tmp/scenes [--fixture <dir>]...
 *     [--save out.json] [--compare saved.json] [--seconds 1.5] [--only name]
 *     [--tree <another voxelize checkout>]
 *
 * `--tree` runs another checkout's worker and wasm build (a worktree of the
 * commit before a change) on the same scenes, so a before/after is the same
 * script, the same node and the same inputs. `--fixture` adds a scene dumped
 * from a running game (see the stress example).
 *
 * The hash covers every buffer the worker posts, geometries sorted by key:
 * two runs that agree on it hand the main thread the same bytes.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type Posted = {
  geometries: Record<string, unknown>[] | null;
  connectivity?: number;
  timings?: Record<string, number>;
};

type Result = {
  medianMs: number;
  minMs: number;
  rounds: number;
  hash: string;
  quads: number;
  bytes: number;
  geometries: number;
  timings?: Record<string, number>;
};

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function flags(name: string): string[] {
  return process.argv.flatMap((arg, i) =>
    arg === `--${name}` && process.argv[i + 1] ? [process.argv[i + 1]] : [],
  );
}

const here = path.dirname(fileURLToPath(import.meta.url));
const tree = path.resolve(flag("tree") ?? path.join(here, ".."));
const seconds = Number(flag("seconds") ?? "1.5");
const only = flag("only");

const wasmBytes = readFileSync(
  path.join(tree, "crates/wasm-mesher/pkg/voxelize_wasm_mesher_bg.wasm"),
);
// The worker's `init()` fetches the wasm beside its glue; node's fetch does
// not read files, so hand it the bytes.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, ...rest: unknown[]) =>
  String(input).endsWith(".wasm")
    ? new Response(wasmBytes, {
        headers: { "content-type": "application/wasm" },
      })
    : (realFetch as (...args: unknown[]) => Promise<Response>)(
        input,
        ...rest,
      )) as typeof fetch;

let posted: Posted | null = null;
(globalThis as { postMessage?: unknown }).postMessage = (payload: Posted) => {
  posted = payload;
};
// The worker module assigns the worker global `onmessage` on load.
(globalThis as { onmessage?: unknown }).onmessage = null;
await import(
  pathToFileURL(
    path.join(tree, "packages/core/src/core/world/workers/mesh-worker.ts"),
  ).href
);
const handler = (globalThis as { onmessage?: unknown }).onmessage as (event: {
  data: unknown;
}) => Promise<void>;

function shared(file: string): SharedArrayBuffer | null {
  if (!existsSync(file)) return null;
  const bytes = readFileSync(file);
  const buffer = new SharedArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

const FNV_PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

function fnvBytes(hash: bigint, bytes: Uint8Array): bigint {
  // Eight bytes a step keeps a 20 MB scene to a moment instead of a minute
  // of BigInt arithmetic per byte.
  const whole = bytes.length - (bytes.length % 8);
  const words = new BigUint64Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + whole),
  );
  for (let i = 0; i < words.length; i++) {
    hash = ((hash ^ words[i]) * FNV_PRIME) & MASK;
  }
  for (let i = whole; i < bytes.length; i++) {
    hash = ((hash ^ BigInt(bytes[i])) * FNV_PRIME) & MASK;
  }
  return hash;
}

function summarize(payload: Posted) {
  const geometries = [...(payload.geometries ?? [])].sort((a, b) =>
    geometryKey(a).localeCompare(geometryKey(b)),
  );
  let hash = 0xcbf29ce484222325n;
  let bytes = 0;
  let quads = 0;
  const encoder = new TextEncoder();
  hash = fnvBytes(hash, encoder.encode(String(payload.connectivity)));
  for (const geometry of geometries) {
    hash = fnvBytes(hash, encoder.encode(geometryKey(geometry)));
    for (const name of Object.keys(geometry).sort()) {
      const value = geometry[name];
      if (ArrayBuffer.isView(value)) {
        const view = value as ArrayBufferView;
        hash = fnvBytes(
          hash,
          encoder.encode(`${name}:${view.constructor.name}:${view.byteLength}`),
        );
        hash = fnvBytes(
          hash,
          new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
        );
        bytes += view.byteLength;
      } else if (name !== "voxel" && name !== "faceName" && name !== "at") {
        hash = fnvBytes(
          hash,
          encoder.encode(`${name}:${JSON.stringify(value)}`),
        );
      }
    }
    quads += (geometry.indices as ArrayLike<number>).length / 6;
  }
  return {
    hash: hash.toString(16).padStart(16, "0"),
    bytes,
    quads,
    geometries: geometries.length,
  };
}

function geometryKey(geometry: Record<string, unknown>): string {
  return `${String(geometry.voxel).padStart(8, "0")}|${String(geometry.faceName ?? "")}|${JSON.stringify(geometry.at ?? null)}`;
}

async function runScene(dir: string): Promise<Result | null> {
  const options = JSON.parse(
    readFileSync(path.join(dir, "options.json"), "utf8"),
  );
  const { chunkSize, maxHeight, subChunks, cx, cz } = options;
  const level: number = options.level ?? 0;

  await handler({
    data: {
      type: "init",
      registryData: readFileSync(path.join(dir, "registry.json"), "utf8"),
    },
  });

  const chunksData: unknown[] = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const [x, z] = [cx + dx, cz + dz];
      const voxels = shared(path.join(dir, `chunk_${x}_${z}.voxels.bin`));
      const lights = shared(path.join(dir, `chunk_${x}_${z}.lights.bin`));
      chunksData.push(
        voxels && lights
          ? { x, z, voxels, lights, options: { size: chunkSize, maxHeight } }
          : null,
      );
    }
  }
  const sectionHeight = Math.floor(maxHeight / subChunks);
  const message = {
    chunksData,
    // The quantization scale reads these; the defaults a world ships with.
    options: { chunkSize, maxHeight, subChunks, ...options.world },
    min: [cx * chunkSize, sectionHeight * level, cz * chunkSize],
    max: [
      (cx + 1) * chunkSize,
      sectionHeight * (level + 1),
      (cz + 1) * chunkSize,
    ],
  };

  const run = async () => {
    posted = null;
    const at = performance.now();
    await handler({ data: message });
    const ms = performance.now() - at;
    if (!posted || !(posted as Posted).geometries) {
      throw new Error(`worker posted no geometries for ${dir}`);
    }
    return { ms, payload: posted as Posted };
  };

  const first = await run();
  const summary = summarize(first.payload);
  // Wasm tiers up over the first calls; give it a few before timing.
  for (let i = 0; i < 4; i++) await run();

  const times: number[] = [];
  const stageTotals: Record<string, number> = {};
  const started = performance.now();
  while (
    times.length < 5 ||
    (performance.now() - started < seconds * 1000 && times.length < 400)
  ) {
    const { ms, payload } = await run();
    times.push(ms);
    for (const [stage, value] of Object.entries(payload.timings ?? {})) {
      stageTotals[stage] = (stageTotals[stage] ?? 0) + value;
    }
  }
  times.sort((a, b) => a - b);
  const timings = Object.fromEntries(
    Object.entries(stageTotals).map(([stage, total]) => [
      stage,
      Number((total / times.length).toFixed(3)),
    ]),
  );
  return {
    medianMs: times[Math.floor(times.length / 2)],
    minMs: times[0],
    rounds: times.length,
    ...summary,
    ...(Object.keys(timings).length > 0 ? { timings } : {}),
  };
}

const sceneDirs: [string, string][] = [];
const scenesRoot = flag("scenes");
if (scenesRoot) {
  for (const name of readdirSync(scenesRoot).sort()) {
    const dir = path.join(scenesRoot, name);
    if (existsSync(path.join(dir, "options.json"))) sceneDirs.push([name, dir]);
  }
}
for (const fixture of flags("fixture")) {
  sceneDirs.push([`fixture:${path.basename(fixture)}`, path.resolve(fixture)]);
}
if (sceneDirs.length === 0) {
  console.error("no scenes: pass --scenes <dir> and/or --fixture <dir>");
  process.exit(1);
}

const saved: Record<string, Result> | null = flag("compare")
  ? JSON.parse(readFileSync(flag("compare") as string, "utf8"))
  : null;

const results: Record<string, Result> = {};
console.log(
  `${"scene".padEnd(26)} ${"median ms".padStart(9)} ${"min ms".padStart(8)} ${"quads".padStart(8)} ${"MB".padStart(7)}  ${saved ? "vs saved" : "hash"}`,
);
for (const [name, dir] of sceneDirs) {
  if (only && !name.includes(only)) continue;
  const result = await runScene(dir);
  if (!result) continue;
  results[name] = result;
  const before = saved?.[name];
  const tail = before
    ? `${before.medianMs.toFixed(2).padStart(8)} ms -> ${(before.medianMs / result.medianMs).toFixed(1).padStart(5)}x   ${
        before.hash === result.hash ? "same bytes" : "BYTES DIFFER"
      }`
    : result.hash;
  console.log(
    `${name.padEnd(26)} ${result.medianMs.toFixed(2).padStart(9)} ${result.minMs.toFixed(2).padStart(8)} ${String(result.quads).padStart(8)} ${(result.bytes / 1e6).toFixed(2).padStart(7)}  ${tail}`,
  );
  if (result.timings) {
    console.log(
      `${"".padEnd(26)} ${Object.entries(result.timings)
        .map(([stage, ms]) => `${stage} ${ms.toFixed(2)}`)
        .join("  ")}`,
    );
  }
}

const savePath = flag("save");
if (savePath) {
  writeFileSync(savePath, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`saved ${savePath}`);
}
