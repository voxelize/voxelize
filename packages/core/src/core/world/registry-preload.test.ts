import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { SilentWorker } = vi.hoisted(() => {
  /** Takes every job and never answers: these tests run no worker. */
  class SilentWorker extends EventTarget {
    static posted: unknown[] = [];

    onmessage: unknown = null;

    postMessage(message: unknown): void {
      SilentWorker.posted.push(message);
    }

    terminate(): void {}
  }
  return { SilentWorker };
});

vi.mock("./workers/light-worker.ts?worker", () => ({ default: SilentWorker }));
vi.mock("./workers/mesh-worker.ts?worker", () => ({ default: SilentWorker }));
vi.mock("./workers/clouds-worker.ts?worker&inline", () => ({
  default: SilentWorker,
}));
vi.mock("./workers/far-terrain-worker.ts?worker&inline", () => ({
  default: SilentWorker,
}));
vi.mock("../../libs/workers/cull-worker.ts?worker&inline", () => ({
  default: SilentWorker,
}));
vi.mock("../../libs/workers/timeout-worker?worker&inline", () => ({
  default: SilentWorker,
}));
vi.mock("../../libs/workers/interval-worker?worker&inline", () => ({
  default: SilentWorker,
}));

import { SHARED_OPAQUE_MATERIAL_KEY } from "./chunk-materials";
import { positionUnitsPerBlock } from "./vertex-quantization";

import { World } from "./index";

const DIGEST = "0123456789abcdef0123456789abcdef-1";

const face = (name: string) => ({
  name,
  independent: false,
  isolated: false,
  textureGroup: null,
  dir: [0, 1, 0],
  corners: [],
  range: { startU: 0, endU: 1, startV: 0, endV: 1 },
});

const block = (id: number, name: string, extra: Record<string, unknown>) => ({
  id,
  name,
  faces: [face("py")],
  aabbs: [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }],
  isDynamic: false,
  isFluid: false,
  isSeeThrough: false,
  transparentStandalone: false,
  isOpaque: true,
  isTransparent: [false, false, false, false, false, false],
  ...extra,
});

/** A registry as the network hands it over: freshly parsed objects. */
const registry = () => ({
  Air: block(0, "Air", { isEmpty: true, aabbs: [], faces: [] }),
  Stone: block(1, "Stone", {}),
  Glass: block(2, "Glass", { isSeeThrough: true, lightAttenuation: 1 }),
});

const TALL = { chunkSize: 16, maxHeight: 512, subChunks: 16 };
const SHORT = { chunkSize: 16, maxHeight: 256, subChunks: 4 };

/** The INIT the world sees, minus everything these tests do not read. */
const init = (
  blocks: Record<string, unknown>,
  options: Record<string, unknown>,
  registryDigest = DIGEST,
) => ({
  type: "INIT" as const,
  json: { blocks, items: [], options, stats: { time: 0 }, registryDigest },
});

const definesOf = (world: World) =>
  [...world.chunkRenderer.materials.values()]
    .map((material) => material.defines?.POSITION_UNITS_PER_BLOCK)
    .filter((value) => value !== undefined);

beforeEach(() => {
  SilentWorker.posted = [];
  // A canvas whose 2D context answers every call; the atlas only needs its
  // own canvas back and pixels to read.
  const makeCanvas = () => {
    const canvas: Record<string, unknown> = { width: 0, height: 0, style: {} };
    const context = new Proxy({} as Record<string | symbol, unknown>, {
      get: (target, key) =>
        key === "canvas"
          ? canvas
          : key in target
            ? target[key]
            : () => ({ data: new Uint8ClampedArray(4) }),
    });
    canvas.getContext = () => context;
    return canvas;
  };
  vi.stubGlobal("document", { createElement: makeCanvas });
  vi.stubGlobal("window", {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    navigator: { hardwareConcurrency: 4 },
    devicePixelRatio: 1,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("World.preloadRegistry", () => {
  it("loads the registry before the INIT, and the INIT keeps all of it", async () => {
    const world = new World({});
    const blocks = registry();
    await world.preloadRegistry(blocks, DIGEST, TALL);

    expect(world.isRegistryLoaded).toBe(true);
    expect(world.isInitialized).toBe(false);
    expect(world.getBlockByName("stone")?.id).toBe(1);
    const opaque = world.chunkRenderer.materials.get(
      SHARED_OPAQUE_MATERIAL_KEY,
    );
    expect(opaque).toBeDefined();
    // The workers have the registry before any chunk is asked for.
    const inits = SilentWorker.posted.filter(
      (message) => (message as { type?: string }).type === "init",
    );
    expect(inits.length).toBeGreaterThan(0);
    // Texture and material work no longer waits for the INIT.
    expect(() => world.getTextureInfo()).not.toThrow();

    world.onMessage(init(blocks, TALL) as never);
    await world.initialize();

    expect(world.isInitialized).toBe(true);
    // The same materials: nothing was rebuilt, and the workers were not
    // handed the registry a second time.
    expect(world.chunkRenderer.materials.get(SHARED_OPAQUE_MATERIAL_KEY)).toBe(
      opaque,
    );
    expect(
      SilentWorker.posted.filter(
        (message) => (message as { type?: string }).type === "init",
      ),
    ).toHaveLength(inits.length);
    expect(definesOf(world)).toContain(positionUnitsPerBlock(TALL).toFixed(1));
  });

  it("keeps the registry when the INIT names it by digest with its own copy", async () => {
    const world = new World({});
    await world.preloadRegistry(registry(), DIGEST, TALL);
    const stone = world.getBlockByName("stone");

    world.onMessage(init(registry(), TALL) as never);
    await world.initialize();
    expect(world.getBlockByName("stone")).toBe(stone);
  });

  it("re-quantizes the materials when the INIT's chunk shape differs from the guess", async () => {
    const world = new World({});
    await world.preloadRegistry(registry(), DIGEST, SHORT);
    const short = positionUnitsPerBlock(SHORT).toFixed(1);
    const tall = positionUnitsPerBlock(TALL).toFixed(1);
    expect(short).not.toBe(tall);
    expect(definesOf(world).every((value) => value === short)).toBe(true);

    world.onMessage(init(registry(), TALL) as never);
    await world.initialize();
    const defines = definesOf(world);
    expect(defines.length).toBeGreaterThan(0);
    expect(defines.every((value) => value === tall)).toBe(true);
  });

  it("refuses an INIT naming another registry: a definition change", async () => {
    const world = new World({});
    await world.preloadRegistry(registry(), DIGEST, TALL);
    const changes: unknown[] = [];
    world.on("world-definition-changed", (change) => changes.push(change));

    world.onMessage(init(registry(), TALL, "ffffffff-2") as never);
    await expect(world.initialize()).rejects.toThrow(/ffffffff-2/);
    expect(changes).toHaveLength(1);
    expect(world.isInitialized).toBe(false);
  });

  it("initializes from the INIT as before when nothing was preloaded", async () => {
    const world = new World({});
    expect(() => world.getTextureInfo()).toThrow();
    world.onMessage(init(registry(), TALL) as never);
    await world.initialize();
    expect(world.isRegistryLoaded).toBe(true);
    expect(world.getBlockByName("glass")?.id).toBe(2);
  });

  it("cannot preload twice, or after the INIT", async () => {
    const world = new World({});
    const first = world.preloadRegistry(registry(), DIGEST, TALL);
    expect(() => world.preloadRegistry(registry(), DIGEST, TALL)).toThrow();
    await first;

    const late = new World({});
    late.onMessage(init(registry(), TALL) as never);
    await late.initialize();
    expect(() => late.preloadRegistry(registry(), DIGEST)).toThrow();
  });
});
