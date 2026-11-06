import {
  FramebufferTexture,
  HalfFloatType,
  RenderTarget,
  SRGBColorSpace,
  type Texture,
  type Vector2,
} from "three/webgpu";
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

import { World } from "./index";

/** The world's refraction internals, reached the way a debugger would. */
type RefractionInternals = {
  refractionCapture: FramebufferTexture;
  captureSceneDepth(): void;
  captureWaterRefraction(renderer: unknown): void;
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

/** A renderer that records what the water samples at each copy. */
function fakeRenderer(world: World) {
  const state = {
    target: null as RenderTarget | null,
    frame: 0,
    copies: [] as { into: Texture; bound: Texture | null }[],
  };
  const sceneColor = world.chunkRenderer.uniforms.sceneColor;
  const renderer = {
    getRenderTarget: () => state.target,
    getDrawingBufferSize: (out: Vector2) => out.set(8, 6),
    get info() {
      return { frame: state.frame };
    },
    copyFramebufferToTexture: (into: Texture) => {
      state.copies.push({ into, bound: sceneColor.value });
    },
  };
  return { renderer, state };
}

describe("World water refraction capture", () => {
  it("binds a capture only after a copy has made it, and remakes it when the source format changes", () => {
    const world = new World({});
    const internals = world as unknown as RefractionInternals;
    vi.spyOn(internals, "captureSceneDepth").mockImplementation(() => {});
    const sceneColor = world.chunkRenderer.uniforms.sceneColor;
    const { renderer, state } = fakeRenderer(world);

    // Before any copy the water samples a placeholder, never a capture:
    // three would create a bound capture in the canvas format.
    expect(sceneColor.value).not.toBeInstanceOf(FramebufferTexture);

    state.target = new RenderTarget(8, 6);
    state.target.texture.colorSpace = SRGBColorSpace;
    internals.captureWaterRefraction(renderer);
    const first = internals.refractionCapture;
    expect(state.copies).toHaveLength(1);
    expect(state.copies[0].into).toBe(first);
    expect(state.copies[0].bound).not.toBe(first);
    expect(sceneColor.value).toBe(first);

    // Same frame: one copy. Next frame, same source: the same capture.
    internals.captureWaterRefraction(renderer);
    state.frame = 1;
    internals.captureWaterRefraction(renderer);
    expect(state.copies).toHaveLength(2);
    expect(internals.refractionCapture).toBe(first);

    // A half-float scene target: a new capture, unbound until copied.
    const half = new RenderTarget(8, 6, { type: HalfFloatType });
    state.target = half;
    state.frame = 2;
    internals.captureWaterRefraction(renderer);
    const second = internals.refractionCapture;
    expect(second).not.toBe(first);
    expect(state.copies[2].into).toBe(second);
    expect(state.copies[2].bound).not.toBe(first);
    expect(state.copies[2].bound).not.toBe(second);
    expect(sceneColor.value).toBe(second);

    // A resize: likewise.
    state.target = new RenderTarget(16, 12, { type: HalfFloatType });
    state.frame = 3;
    internals.captureWaterRefraction(renderer);
    const third = internals.refractionCapture;
    expect(third).not.toBe(second);
    expect(third.image.width).toBe(16);
    expect(state.copies[3].bound).not.toBe(third);
    expect(sceneColor.value).toBe(third);
  });
});
