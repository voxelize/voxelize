import {
  DepthFormat,
  DepthStencilFormat,
  DepthTexture,
  FloatType,
  type Renderer,
  RenderTarget,
  type Texture,
  UnsignedInt248Type,
  UnsignedIntType,
} from "three/webgpu";
import { describe, expect, it } from "vitest";

import {
  SceneDepthCopy,
  sceneDepthSkipReason,
  type SceneDepthUniforms,
} from "./scene-depth-copy";

const uniforms = (): SceneDepthUniforms => ({
  sceneDepth: { value: null as unknown as Texture },
  sceneDepthReady: { value: 0 },
});

const sceneTarget = (
  options: { samples?: number; stencil?: boolean; float?: boolean } = {},
) => {
  const depthTexture = new DepthTexture(
    64,
    32,
    options.float === false
      ? options.stencil
        ? UnsignedInt248Type
        : UnsignedIntType
      : FloatType,
  );
  depthTexture.format = options.stencil ? DepthStencilFormat : DepthFormat;
  return new RenderTarget(64, 32, {
    depthBuffer: true,
    stencilBuffer: options.stencil ?? false,
    depthTexture,
    samples: options.samples ?? 0,
  });
};

/**
 * Just what the copy asks of a renderer, recording its copies: from the
 * bound attachment while a pass draws into `drawing`, else texture to
 * texture.
 */
const fakeRenderer = (drawing: RenderTarget | null = null) => {
  const copies: Texture[] = [];
  const framebufferCopies: Texture[] = [];
  const textureCopies: [Texture, Texture][] = [];
  const renderer = {
    copies,
    framebufferCopies,
    textureCopies,
    info: { frame: 1 },
    _currentRenderContext: { renderTarget: drawing },
    copyFramebufferToTexture: (texture: Texture) => {
      copies.push(texture);
      framebufferCopies.push(texture);
    },
    copyTextureToTexture: (from: Texture, to: Texture) => {
      copies.push(to);
      textureCopies.push([from, to]);
    },
  };
  return renderer;
};

const asRenderer = (renderer: ReturnType<typeof fakeRenderer>) =>
  renderer as unknown as Renderer;

describe("sceneDepthSkipReason", () => {
  it("copies only a single-sampled target with a float depth texture", () => {
    expect(sceneDepthSkipReason(null)).toBe("canvas");
    expect(sceneDepthSkipReason(new RenderTarget(4, 4))).toBe(
      "no-depth-texture",
    );
    expect(sceneDepthSkipReason(sceneTarget({ samples: 4 }))).toBe(
      "multisampled",
    );
    // WebGPU cannot copy out of depth24plus.
    expect(sceneDepthSkipReason(sceneTarget({ float: false }))).toBe(
      "not-copyable",
    );
    expect(sceneDepthSkipReason(sceneTarget())).toBeNull();
  });
});

describe("SceneDepthCopy", () => {
  it("copies the scene's depth once a render, from the pass drawing it", () => {
    const state = uniforms();
    const copy = new SceneDepthCopy(state);
    const source = sceneTarget();
    const renderer = fakeRenderer(source);

    copy.capture(asRenderer(renderer), source);
    expect(renderer.copies).toHaveLength(1);
    expect(state.sceneDepthReady.value).toBe(1);
    const depth = state.sceneDepth.value as DepthTexture;
    expect(renderer.copies[0]).toBe(depth);
    expect(depth).not.toBe(source.depthTexture);
    expect(depth.type).toBe(FloatType);
    expect(depth.format).toBe(DepthFormat);
    expect([depth.image.width, depth.image.height]).toEqual([64, 32]);

    // The split of the same render hands the scene over again: no copy.
    copy.capture(asRenderer(renderer), source);
    expect(renderer.copies).toHaveLength(1);

    // The next frame reuses the same copy texture.
    renderer.info.frame++;
    copy.capture(asRenderer(renderer), source);
    expect(renderer.copies).toEqual([depth, depth]);
    expect(renderer.textureCopies).toHaveLength(0);
  });

  it("copies texture to texture between passes", () => {
    const state = uniforms();
    const copy = new SceneDepthCopy(state);
    const source = sceneTarget();
    const renderer = fakeRenderer(sceneTarget());
    copy.capture(asRenderer(renderer), source);
    expect(renderer.framebufferCopies).toHaveLength(0);
    expect(renderer.textureCopies).toEqual([
      [source.depthTexture, state.sceneDepth.value],
    ]);
    expect(state.sceneDepthReady.value).toBe(1);
  });

  it("matches the source's depth format, stencil included", () => {
    const state = uniforms();
    const copy = new SceneDepthCopy(state);
    copy.capture(asRenderer(fakeRenderer()), sceneTarget({ stencil: true }));
    const depth = state.sceneDepth.value as DepthTexture;
    expect(depth.type).toBe(FloatType);
    expect(depth.format).toBe(DepthStencilFormat);
  });

  it("marks the copy missing on a target it cannot read, and on a skip", () => {
    const state = uniforms();
    const copy = new SceneDepthCopy(state);
    const renderer = fakeRenderer();
    copy.capture(asRenderer(renderer), sceneTarget());
    expect(state.sceneDepthReady.value).toBe(1);

    renderer.info.frame++;
    copy.capture(asRenderer(renderer), null);
    expect(state.sceneDepthReady.value).toBe(0);

    renderer.info.frame++;
    copy.capture(asRenderer(renderer), sceneTarget({ float: false }));
    expect(state.sceneDepthReady.value).toBe(0);
    expect(renderer.copies).toHaveLength(1);

    renderer.info.frame++;
    copy.capture(asRenderer(renderer), sceneTarget());
    expect(state.sceneDepthReady.value).toBe(1);
    copy.skip();
    expect(state.sceneDepthReady.value).toBe(0);
  });
});
