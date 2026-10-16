import { ChunkProtocol, MessageProtocol } from "@voxelize/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Coords2 } from "../../types";
import { ChunkUtils } from "../../utils";

const { SilentWorker } = vi.hoisted(() => {
  /** Takes every job and never answers: these tests run no worker. */
  class SilentWorker extends EventTarget {
    onmessage: unknown = null;

    postMessage(): void {}

    terminate(): void {}
  }
  return { SilentWorker };
});

vi.mock("./workers/light-worker.ts?worker", () => ({ default: SilentWorker }));
vi.mock("./workers/mesh-worker.ts?worker", () => ({ default: SilentWorker }));
vi.mock("./workers/clouds-worker.ts?worker&inline", () => ({
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

import { World } from "./index";

/** A world past its handshake (its bounds are the server's), standing in chunk (0, 0). */
const joiningWorld = () => {
  const world = new World({
    chunkSize: 2,
    maxHeight: 2,
    subChunks: 1,
    minChunk: [-100, -100],
    maxChunk: [100, 100],
  });
  world.isInitialized = true;
  world.renderRadius = 4;
  return world;
};

const cells = 2 * 2 * 2;

const chunk = (x: number, z: number): ChunkProtocol => ({
  id: `${x},${z}`,
  x,
  z,
  meshes: [],
  voxels: new Uint32Array(cells).fill(1),
  lights: new Uint32Array(cells).fill(1),
});

const load = (...coords: Coords2[]): MessageProtocol =>
  ({
    type: "LOAD",
    chunks: coords.map(([x, z]) => chunk(x, z)),
  }) as MessageProtocol;

/** The 3x3 a join waits on, as far as the render radius reaches. */
const spawnWindow = (renderRadius = 4): Coords2[] => {
  const coords: Coords2[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx * dx + dz * dz <= renderRadius * renderRadius) {
        coords.push([dx, dz]);
      }
    }
  }
  return coords;
};

beforeEach(() => {
  const context = new Proxy(
    {},
    { get: (_target, key) => (key === "canvas" ? undefined : () => ({})) },
  );
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => context,
      style: {},
    }),
  });
  vi.stubGlobal("window", {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    navigator: { hardwareConcurrency: 4 },
    devicePixelRatio: 1,
  });
  // Meshing is scheduled for the next frame; these tests draw none.
  vi.stubGlobal("requestAnimationFrame", () => 0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a joining world's spawn window", () => {
  it("applies window chunks as their LOAD lands, without waiting for an update", () => {
    const world = joiningWorld();
    expect(world.wantsMessagesOnArrival()).toBe(true);

    world.onMessage(load([0, 0], [1, 0], [-1, 1], [5, 5]));
    for (const [x, z] of [
      [0, 0],
      [1, 0],
      [-1, 1],
    ] as Coords2[]) {
      expect(world.getChunkByCoords(x, z)?.isReady).toBe(true);
    }
    expect(world.wantsMessagesOnArrival()).toBe(true);

    world.onMessage(
      load(
        ...spawnWindow().filter(
          ([x, z]) => !world.getChunkByCoords(x, z)?.isReady,
        ),
      ),
    );
    for (const [x, z] of spawnWindow()) {
      expect(world.getChunkByCoords(x, z)?.isReady).toBe(true);
    }
    expect(world.wantsMessagesOnArrival()).toBe(false);
  });

  it("waits only on the window chunks this world asks for at its render radius", () => {
    const world = joiningWorld();
    world.renderRadius = 1;
    world.onMessage(load(...spawnWindow(1)));
    expect(world.wantsMessagesOnArrival()).toBe(false);
  });

  it("goes back to the frame budget once the window has loaded", () => {
    const world = joiningWorld();
    world.onMessage(load(...spawnWindow()));
    expect(world.wantsMessagesOnArrival()).toBe(false);

    // Later LOADs wait for the next update, a few a frame, as before.
    world.onMessage(load([2, 0], [2, 1]));
    expect(world.getChunkByCoords(2, 0)).toBeUndefined();
    expect(world.chunkPipeline.processingCount).toBe(2);
  });

  it("does not wait on chunks outside the world", () => {
    const world = new World({
      chunkSize: 2,
      maxHeight: 2,
      subChunks: 1,
      minChunk: [0, 0],
      maxChunk: [4, 4],
    });
    world.isInitialized = true;
    world.renderRadius = 4;
    world.onMessage(load([0, 0], [1, 0]));
    expect(world.wantsMessagesOnArrival()).toBe(true);
    world.onMessage(load([0, 1], [1, 1]));
    expect(world.wantsMessagesOnArrival()).toBe(false);
  });

  it("stops waiting on a window chunk that never comes", () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const world = joiningWorld();
    world.onMessage(load([0, 0]));
    expect(world.wantsMessagesOnArrival()).toBe(true);
    now += 15_001;
    expect(world.wantsMessagesOnArrival()).toBe(false);
    world.onMessage(load(...spawnWindow()));
    expect(world.wantsMessagesOnArrival()).toBe(false);
  });

  it("waits for nothing before it is initialized", () => {
    const world = new World({ chunkSize: 2, maxHeight: 2, subChunks: 1 });
    expect(world.wantsMessagesOnArrival()).toBe(false);
  });
});
