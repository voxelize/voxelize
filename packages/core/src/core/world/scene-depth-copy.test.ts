import {
  DepthFormat,
  DepthStencilFormat,
  DepthTexture,
  UnsignedInt248Type,
  UnsignedIntType,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { describe, expect, it } from "vitest";

import {
  SceneDepthCopy,
  sceneDepthSkipReason,
  type SceneDepthUniforms,
} from "./scene-depth-copy";

const READ_FRAMEBUFFER = 0x8ca8;
const DRAW_FRAMEBUFFER = 0x8ca9;
const DEPTH_BUFFER_BIT = 0x100;
const NEAREST = 0x2600;

const uniforms = (): SceneDepthUniforms => ({
  sceneDepth: { value: null },
  sceneDepthReady: { value: 0 },
});

const sceneTarget = (options: { samples?: number; stencil?: boolean } = {}) => {
  const depthTexture = new DepthTexture(
    64,
    32,
    options.stencil ? UnsignedInt248Type : UnsignedIntType,
  );
  depthTexture.format = options.stencil ? DepthStencilFormat : DepthFormat;
  return new WebGLRenderTarget(64, 32, {
    depthBuffer: true,
    stencilBuffer: options.stencil ?? false,
    depthTexture,
    samples: options.samples ?? 0,
  });
};

/** Just what the copy asks of a renderer, recording its GL calls. */
const fakeRenderer = () => {
  const framebuffers = new WeakMap<object, { __webglFramebuffer: object }>();
  const calls: unknown[][] = [];
  const renderer = {
    calls,
    bound: null as WebGLRenderTarget | null,
    info: { render: { frame: 1 } },
    getContext: () => ({
      READ_FRAMEBUFFER,
      DRAW_FRAMEBUFFER,
      DEPTH_BUFFER_BIT,
      NEAREST,
      blitFramebuffer: (...args: unknown[]) => calls.push(["blit", ...args]),
    }),
    properties: {
      get: (object: object) => {
        let entry = framebuffers.get(object);
        if (!entry) {
          entry = { __webglFramebuffer: { of: object } };
          framebuffers.set(object, entry);
        }
        return entry;
      },
    },
    state: {
      bindFramebuffer: (target: number, framebuffer: unknown) =>
        calls.push(["bind", target, framebuffer]),
    },
    initRenderTarget: () => {},
    setRenderTarget: (target: WebGLRenderTarget | null) => {
      renderer.bound = target;
    },
  };
  return renderer;
};

describe("sceneDepthSkipReason", () => {
  it("copies only a single-sampled target with a depth texture", () => {
    expect(sceneDepthSkipReason(null)).toBe("canvas");
    expect(sceneDepthSkipReason(new WebGLRenderTarget(4, 4))).toBe(
      "no-depth-texture",
    );
    expect(sceneDepthSkipReason(sceneTarget({ samples: 4 }))).toBe(
      "multisampled",
    );
    expect(sceneDepthSkipReason(sceneTarget())).toBeNull();
  });
});

describe("SceneDepthCopy", () => {
  it("blits the scene's depth once a render and leaves the scene's target bound", () => {
    const state = uniforms();
    const copy = new SceneDepthCopy(state);
    const renderer = fakeRenderer();
    const source = sceneTarget();

    copy.capture(renderer as unknown as WebGLRenderer, source);
    const blits = renderer.calls.filter(([kind]) => kind === "blit");
    expect(blits).toEqual([
      ["blit", 0, 0, 64, 32, 0, 0, 64, 32, DEPTH_BUFFER_BIT, NEAREST],
    ]);
    expect(renderer.calls[0]).toEqual([
      "bind",
      READ_FRAMEBUFFER,
      renderer.properties.get(source).__webglFramebuffer,
    ]);
    expect(renderer.bound).toBe(source);
    expect(state.sceneDepthReady.value).toBe(1);
    const depth = state.sceneDepth.value as DepthTexture;
    expect(depth).not.toBe(source.depthTexture);
    expect(depth.type).toBe(UnsignedIntType);
    expect(depth.format).toBe(DepthFormat);

    // The split of the same render hands the scene over again: no copy.
    copy.capture(renderer as unknown as WebGLRenderer, source);
    expect(renderer.calls.filter(([kind]) => kind === "blit")).toHaveLength(1);
  });

  it("matches the source's depth format, stencil included", () => {
    const state = uniforms();
    const copy = new SceneDepthCopy(state);
    copy.capture(
      fakeRenderer() as unknown as WebGLRenderer,
      sceneTarget({ stencil: true }),
    );
    const depth = state.sceneDepth.value as DepthTexture;
    expect(depth.type).toBe(UnsignedInt248Type);
    expect(depth.format).toBe(DepthStencilFormat);
  });

  it("marks the copy missing on a target it cannot read, and on a skip", () => {
    const state = uniforms();
    const copy = new SceneDepthCopy(state);
    const renderer = fakeRenderer();
    copy.capture(renderer as unknown as WebGLRenderer, sceneTarget());
    expect(state.sceneDepthReady.value).toBe(1);

    renderer.info.render.frame++;
    copy.capture(renderer as unknown as WebGLRenderer, null);
    expect(state.sceneDepthReady.value).toBe(0);

    renderer.info.render.frame++;
    copy.capture(renderer as unknown as WebGLRenderer, sceneTarget());
    expect(state.sceneDepthReady.value).toBe(1);
    copy.skip();
    expect(state.sceneDepthReady.value).toBe(0);
  });
});
