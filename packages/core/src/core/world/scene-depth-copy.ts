import {
  DepthTexture,
  NearestFilter,
  type Texture,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";

/** The uniforms the copy writes for the chunk materials. */
export type SceneDepthUniforms = {
  sceneDepth: { value: Texture | null };
  sceneDepthReady: { value: number };
};

/**
 * Why a frame's depth could not be copied, or null when it can be: a copy
 * blits the depth attachment of the target the scene draws into, which the
 * canvas does not expose and a multisampled target keeps in a renderbuffer.
 */
export function sceneDepthSkipReason(
  source: WebGLRenderTarget | null,
): "canvas" | "no-depth-texture" | "multisampled" | null {
  if (!source) return "canvas";
  if (!source.depthTexture) return "no-depth-texture";
  if (source.samples > 0) return "multisampled";
  return null;
}

/**
 * A copy of the scene's depth as the water starts to draw, for the tank
 * windows: each one fogs the run of water between itself and the first
 * thing behind it, and that thing's depth is in this copy.
 *
 * The water cannot read the scene target's own depth texture: while the
 * water draws, that texture is the depth attachment of the bound target
 * (the scene's, or with order-independent transparency the accumulation,
 * which shares it), and sampling it there is a feedback loop. So it is
 * blitted once a frame into a texture of the same format, from inside the
 * render, with the scene's target bound, and the binding is restored.
 */
export class SceneDepthCopy {
  private target: WebGLRenderTarget | null = null;
  private copiedFrame = -1;

  constructor(private readonly uniforms: SceneDepthUniforms) {}

  /**
   * Copies the depth of `source`, the target bound right now, unless this
   * render already copied it. Leaves `source` bound.
   */
  capture(renderer: WebGLRenderer, source: WebGLRenderTarget | null) {
    const frame = renderer.info.render.frame;
    if (frame === this.copiedFrame) return;
    this.copiedFrame = frame;
    this.uniforms.sceneDepthReady.value = 0;
    if (!source || sceneDepthSkipReason(source)) return;
    const depth = source.depthTexture as DepthTexture;

    const target = this.targetFor(source, depth);
    renderer.initRenderTarget(target);
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const properties = renderer.properties as unknown as {
      get: (object: object) => { __webglFramebuffer?: WebGLFramebuffer };
    };
    const read = properties.get(source).__webglFramebuffer;
    const draw = properties.get(target).__webglFramebuffer;
    if (!read || !draw) return;

    const { width, height } = source;
    renderer.state.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
    renderer.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
    gl.blitFramebuffer(
      0,
      0,
      width,
      height,
      0,
      0,
      width,
      height,
      gl.DEPTH_BUFFER_BIT,
      gl.NEAREST,
    );
    renderer.state.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    renderer.setRenderTarget(source);

    this.uniforms.sceneDepth.value = target.depthTexture;
    this.uniforms.sceneDepthReady.value = 1;
  }

  /** Marks this frame's copy missing, without copying. */
  skip() {
    this.uniforms.sceneDepthReady.value = 0;
  }

  dispose() {
    this.target?.dispose();
    this.target = null;
  }

  /** A target whose depth matches `source`'s exactly, as a blit requires. */
  private targetFor(source: WebGLRenderTarget, depth: DepthTexture) {
    const current = this.target?.depthTexture;
    if (
      this.target &&
      current &&
      this.target.width === source.width &&
      this.target.height === source.height &&
      current.type === depth.type &&
      current.format === depth.format
    ) {
      return this.target;
    }
    this.target?.dispose();
    const copy = new DepthTexture(source.width, source.height, depth.type);
    copy.format = depth.format;
    copy.minFilter = NearestFilter;
    copy.magFilter = NearestFilter;
    this.target = new WebGLRenderTarget(source.width, source.height, {
      depthBuffer: true,
      stencilBuffer: source.stencilBuffer,
      depthTexture: copy,
      generateMipmaps: false,
    });
    return this.target;
  }
}
