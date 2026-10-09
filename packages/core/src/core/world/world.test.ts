import { EntityProtocol, MessageProtocol } from "@voxelize/protocol";
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

import { Block } from "./block";

import { BlockEntityUpdateData, World } from "./index";

type WorldInternals = {
  maintainChunks: (center: Coords2) => void;
};

const internals = (world: World) => world as unknown as WorldInternals;

let now = 0;

/** A world past its handshake, without the server data `initialize` needs. */
const joinedWorld = () => {
  const world = new World({});
  world.isInitialized = true;
  world.renderRadius = 6;
  return world;
};

const unloaded = (world: World) =>
  world.packets
    .filter((packet: MessageProtocol) => packet.type === "UNLOAD")
    .flatMap((packet) => (packet.json as { chunks: Coords2[] }).chunks);

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
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("World requests past the render radius", () => {
  // Render radius 6, so the delete radius is 6.6: (6, 1) lies 6.08 chunks
  // out, between the two.
  const between: Coords2 = [6, 1];

  it("releases a request lost between the render and delete radii", () => {
    const world = joinedWorld();
    world.chunkPipeline.markRequested(between);

    now = 6000;
    internals(world).maintainChunks([0, 0]);

    expect(
      world.chunkPipeline.getStage(ChunkUtils.getChunkName(between)),
    ).toBeNull();
    expect(unloaded(world)).toContainEqual(between);
  });

  it("keeps a request there that may still be answered", () => {
    const world = joinedWorld();
    world.chunkPipeline.markRequested(between);

    now = 1000;
    internals(world).maintainChunks([0, 0]);

    expect(world.chunkPipeline.getStage(ChunkUtils.getChunkName(between))).toBe(
      "requested",
    );
    expect(unloaded(world)).toEqual([]);
  });

  it("leaves a lost request inside the render radius to be asked again", () => {
    const world = joinedWorld();
    world.chunkPipeline.markRequested([2, 1]);

    now = 6000;
    internals(world).maintainChunks([0, 0]);

    expect(world.chunkPipeline.getStage(ChunkUtils.getChunkName([2, 1]))).toBe(
      "requested",
    );
  });
});

describe("World rejoin INIT", () => {
  type Sign = { text: string };

  const handshake = (entities: EntityProtocol<unknown>[]): MessageProtocol =>
    ({
      type: "INIT",
      json: {
        id: "client",
        blocks: {},
        items: [],
        options: { chunkSize: 16, maxHeight: 256, subChunks: 8 },
      },
      entities,
    }) as unknown as MessageProtocol;

  const sign = (
    id: string,
    voxel: [number, number, number],
    text: string,
  ): EntityProtocol<unknown> => ({
    id,
    type: "block::sign",
    operation: "UPDATE",
    metadata: { voxel, json: { text } },
  });

  /** A world that joined once and has since been told of two signs. */
  const worldWithSigns = () => {
    const world = new World<Sign>({});
    world.onMessage(handshake([]));
    world.isInitialized = true;
    world.registry.blocksByName.set("sign", { faces: [] } as unknown as Block);
    world.onMessage({
      type: "ENTITY",
      entities: [
        sign("a", [1, 2, 3], "before the drop"),
        sign("b", [4, 5, 6], "removed while away"),
      ],
    } as unknown as MessageProtocol);
    return world;
  };

  it("applies the block entities it carries and drops the ones it no longer has", () => {
    const world = worldWithSigns();
    const updates: BlockEntityUpdateData<Sign>[] = [];
    world.addBlockEntityUpdateListener((update) => updates.push(update));

    world.onMessage(handshake([sign("a", [1, 2, 3], "changed while away")]));

    expect(world.getBlockEntityDataAt(1, 2, 3)).toEqual({
      text: "changed while away",
    });
    expect(world.getBlockEntityDataAt(4, 5, 6)).toBeNull();
    expect(updates).toContainEqual(
      expect.objectContaining({ operation: "DELETE", voxel: [4, 5, 6] }),
    );
  });

  it("still leaves a first join's block entities to initialize", () => {
    const world = new World<Sign>({});

    world.onMessage(handshake([sign("a", [1, 2, 3], "at the join")]));

    world.isInitialized = true;
    expect(world.getBlockEntityDataAt(1, 2, 3)).toBeNull();
  });
});
