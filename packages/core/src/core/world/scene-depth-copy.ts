import {
  DepthTexture,
  FloatType,
  NearestFilter,
  type Renderer,
  type RenderTarget,
  type Texture,
} from "three/webgpu";

import { ownDepthSampleCount } from "./depth-sample-count";

/** The inputs the copy writes for the chunk materials. */
export type SceneDepthUniforms = {
  sceneDepth: { value: Texture };
  sceneDepthReady: { value: number };
};

/**
 * Why a frame's depth could not be copied, or null when it can be: a copy
 * reads the depth attachment of the target the scene draws into, which the
 * canvas keeps to itself, a multisampled target keeps per sample, and
 * WebGPU copies only from a 32-bit float depth (never `depth24plus`).
 */
export function sceneDepthSkipReason(
  source: RenderTarget | null,
): "canvas" | "no-depth-texture" | "multisampled" | "not-copyable" | null {
  if (!source) return "canvas";
  if (!source.depthTexture) return "no-depth-texture";
  if (source.samples > 1) return "multisampled";
  if (source.depthTexture.type !== FloatType) return "not-copyable";
  return null;
}

/**
 * A copy of the scene's depth as the water starts to draw. A tank window fogs
 * the run of water between itself and the first thing behind it, and a
 * surface hazes by how far under it that thing lies; its depth is in this
 * copy.
 *
 * The water cannot read the scene target's own depth texture: while the
 * water draws, that texture is the depth attachment of the bound target
 * (the scene's, or with order-independent transparency the accumulation,
 * which shares it), and sampling it there is a feedback loop. So it is
 * copied once a frame: from inside the render when the copy is asked for
 * mid-pass (three ends the pass, copies, and resumes it), else texture to
 * texture, after what the passes so far submitted.
 */
export class SceneDepthCopy {
  private copy: DepthTexture | null = null;
  private copiedFrame = -1;

  constructor(private readonly uniforms: SceneDepthUniforms) {}

  /**
   * Copies the depth of `source`, the target bound right now, unless this
   * frame already copied it.
   */
  capture(renderer: Renderer, source: RenderTarget | null) {
    const frame = renderer.info.frame;
    if (frame === this.copiedFrame) return;
    this.copiedFrame = frame;
    this.uniforms.sceneDepthReady.value = 0;
    if (!source || sceneDepthSkipReason(source)) return;

    const copy = this.copyFor(source);
    // Between renders the renderer's "framebuffer" is whatever context it
    // last drew: only a pass drawing into `source` right now can be copied
    // from that way.
    const current = (
      renderer as unknown as {
        _currentRenderContext: { renderTarget: RenderTarget | null } | null;
      }
    )._currentRenderContext;
    if (current?.renderTarget === source) {
      // three copies a depth texture from the bound depth attachment; its
      // typing names only colour framebuffer textures.
      renderer.copyFramebufferToTexture(
        copy as unknown as Parameters<Renderer["copyFramebufferToTexture"]>[0],
      );
    } else {
      renderer.copyTextureToTexture(source.depthTexture as DepthTexture, copy);
    }
    this.uniforms.sceneDepth.value = copy;
    this.uniforms.sceneDepthReady.value = 1;
  }

  skip() {
    this.uniforms.sceneDepthReady.value = 0;
  }

  dispose() {
    this.copy?.dispose();
    this.copy = null;
  }

  private copyFor(source: RenderTarget): DepthTexture {
    const depth = source.depthTexture as DepthTexture;
    const current = this.copy;
    if (
      current &&
      current.image.width === source.width &&
      current.image.height === source.height &&
      current.type === depth.type &&
      current.format === depth.format
    ) {
      return current;
    }
    current?.dispose();
    const copy = new DepthTexture(source.width, source.height, depth.type);
    copy.format = depth.format;
    copy.minFilter = NearestFilter;
    copy.magFilter = NearestFilter;
    copy.name = "voxelize-scene-depth-copy";
    // As many samples as the target it copies (a multisampled one is
    // skipped), whatever target is bound when a graph that reads it builds.
    this.copy = ownDepthSampleCount(copy, source.samples);
    return copy;
  }
}
