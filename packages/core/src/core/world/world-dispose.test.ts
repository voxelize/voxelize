import {
  EventDispatcher,
  MeshBasicMaterial,
  Texture,
  WebGLRenderTarget,
} from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { CustomChunkShaderMaterial } from "./chunk-materials";
import { defaultOrderIndependentTransparencyOptions } from "./order-independent-transparency";
import { AtlasTexture } from "./textures";

import { World } from "./index";

/** The world's private passes, reached the way a debugger would. */
type WorldInternals = {
  refractionCapture: Texture;
  sceneDepthCopy: { target: WebGLRenderTarget | null; dispose(): void };
  waterDepth: {
    target: WebGLRenderTarget | null;
    exitTarget: WebGLRenderTarget | null;
    dispose(): void;
  };
};

type SkyInternals = {
  shading: { geometry: EventDispatcher; material: EventDispatcher } | null;
};

/** How many times `target` has announced its disposal. */
const disposals = (target: EventDispatcher) => {
  let count = 0;
  target.addEventListener("dispose" as never, () => {
    count += 1;
  });
  return () => count;
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
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("World.dispose", () => {
  it("frees every GPU resource the world made, exactly once", () => {
    const world = new World({
      orderIndependentTransparency: defaultOrderIndependentTransparencyOptions,
    });
    const internals = world as unknown as WorldInternals;
    const skyShading = (world.sky as unknown as SkyInternals).shading;
    const orderIndependentPass = world.orderIndependent;
    if (!skyShading || !orderIndependentPass) {
      throw new Error("the world was built without its sky dome or OIT pass");
    }

    // The depth passes allocate their targets on first use; stand some in.
    internals.sceneDepthCopy.target = new WebGLRenderTarget(4, 4);
    internals.waterDepth.target = new WebGLRenderTarget(4, 4);
    internals.waterDepth.exitTarget = new WebGLRenderTarget(4, 4);

    // A chunk material with its own atlas, and one still on the shared
    // unknown-texture checker.
    const ownAtlas = new Texture();
    const ownMaterial = new MeshBasicMaterial({ map: ownAtlas });
    const sharedUnknown = new Texture();
    (
      AtlasTexture as unknown as { sharedUnknownTexture: Texture | null }
    ).sharedUnknownTexture = sharedUnknown;
    const checkerMaterial = new MeshBasicMaterial({ map: sharedUnknown });
    world.chunkRenderer.materials.set(
      "own",
      ownMaterial as unknown as CustomChunkShaderMaterial,
    );
    world.chunkRenderer.materials.set(
      "checker",
      checkerMaterial as unknown as CustomChunkShaderMaterial,
    );

    const skyLayer = world.sky.boxLayers[0];
    const skyLayerMaterials = [...skyLayer.materials.values()];
    expect(skyLayerMaterials.length).toBeGreaterThan(0);

    const owned: [string, () => number][] = [
      ["refraction capture", disposals(internals.refractionCapture)],
      [
        "water normal map",
        disposals(world.chunkRenderer.uniforms.waterNormalMap.value),
      ],
      ["scene depth copy target", disposals(internals.sceneDepthCopy.target)],
      ["water depth target", disposals(internals.waterDepth.target)],
      ["water exit target", disposals(internals.waterDepth.exitTarget)],
      ["sky dome geometry", disposals(skyShading.geometry)],
      ["sky dome material", disposals(skyShading.material)],
      ["sky layer geometry", disposals(skyLayer.geometry)],
      ...skyLayerMaterials.flatMap((material, index) => {
        const entries: [string, () => number][] = [
          [`sky face material ${index}`, disposals(material)],
        ];
        if (material.map) {
          entries.push([`sky face texture ${index}`, disposals(material.map)]);
        }
        return entries;
      }),
      ["chunk material", disposals(ownMaterial)],
      ["chunk atlas", disposals(ownAtlas)],
      ["checker chunk material", disposals(checkerMaterial)],
    ];
    const sharedUnknownDisposals = disposals(sharedUnknown);

    const farTerrain = vi.spyOn(world.farTerrain, "dispose");
    const orderIndependent = vi.spyOn(orderIndependentPass, "dispose");

    world.dispose();
    world.dispose();

    for (const [name, count] of owned) {
      expect({ name, count: count() }).toEqual({ name, count: 1 });
    }
    expect(farTerrain).toHaveBeenCalledTimes(1);
    expect(orderIndependent).toHaveBeenCalledTimes(1);
    expect(sharedUnknownDisposals()).toBe(0);
    expect(world.chunkRenderer.materials.size).toBe(0);
  });

  it("disposes without an order-independent pass", () => {
    const world = new World({});
    expect(world.orderIndependent).toBeNull();
    const farTerrain = vi.spyOn(world.farTerrain, "dispose");

    expect(() => world.dispose()).not.toThrow();
    expect(farTerrain).toHaveBeenCalledTimes(1);
  });
});
