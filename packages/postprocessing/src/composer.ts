import {
  DepthTexture,
  FloatType,
  HalfFloatType,
  LinearSRGBColorSpace,
  NoColorSpace,
  NodeMaterial,
  NoToneMapping,
  QuadMesh,
  type Renderer,
  RenderTarget,
  SRGBColorSpace,
  UnsignedByteType,
} from "three/webgpu";
import { screenUV, vec4 } from "three/tsl";

import { linearToSrgb } from "./encoding";
import { textureInput, type Vec4Node } from "./nodes";
import { Pass, type PassContext } from "./pass";

export type FrameBufferType = typeof UnsignedByteType | typeof HalfFloatType;

export type EffectComposerOptions = {
  /**
   * The frame buffers' colour storage. 8-bit (the default) stores sRGB, so
   * the frame is clamped to what the screen shows before any effect reads
   * it, at a quarter of half float's bandwidth; half float keeps HDR.
   */
  frameBufferType: FrameBufferType;
};

/**
 * Draws the scene into the frame with depth: the composer's first pass.
 * `draw` renders into `target` (bound, with a float depth texture) however
 * the host draws its world (several passes, its own sort).
 */
export class ScenePass extends Pass {
  readonly isScenePass = true;

  constructor(
    private readonly draw: (renderer: Renderer, target: RenderTarget) => void,
  ) {
    super("ScenePass");
  }

  render(renderer: Renderer, _input: RenderTarget, output: RenderTarget | null) {
    if (!output) throw new Error("[postprocessing] a scene pass draws into a target");
    renderer.setRenderTarget(output);
    this.draw(renderer, output);
  }
}

/**
 * A chain of passes over one frame: the scene pass draws into a target with
 * depth, then each enabled pass reads what the one before drew, through a
 * pair of frame buffers it swaps, and the last enabled pass draws to the
 * screen (encoding sRGB itself, so the renderer adds no conversion pass).
 */
export class EffectComposer {
  readonly passes: Pass[] = [];

  /** Where the scene pass draws: colour and a float depth texture. */
  readonly sceneTarget: RenderTarget;

  private readonly buffers: [RenderTarget, RenderTarget];
  private readonly copy: { quad: QuadMesh; input: ReturnType<typeof textureInput> };
  private width = 1;
  private height = 1;

  constructor(
    private readonly renderer: Renderer,
    options: Partial<EffectComposerOptions> = {},
  ) {
    const type = options.frameBufferType ?? UnsignedByteType;
    const colorSpace = type === UnsignedByteType ? SRGBColorSpace : NoColorSpace;
    const depthTexture = new DepthTexture(1, 1);
    depthTexture.type = FloatType;
    depthTexture.name = "EffectComposer.depth";
    this.sceneTarget = new RenderTarget(1, 1, {
      type,
      colorSpace,
      depthBuffer: true,
      depthTexture,
      generateMipmaps: false,
    });
    this.sceneTarget.texture.name = "EffectComposer.scene";
    const buffer = (name: string) => {
      const target = new RenderTarget(1, 1, {
        type,
        colorSpace,
        depthBuffer: false,
        generateMipmaps: false,
      });
      target.texture.name = name;
      return target;
    };
    this.buffers = [buffer("EffectComposer.buffer0"), buffer("EffectComposer.buffer1")];

    const input = textureInput();
    const material = new NodeMaterial();
    material.name = "EffectComposer.copy";
    const sampled = input.sample(screenUV) as unknown as Vec4Node;
    material.fragmentNode = vec4(linearToSrgb(sampled.rgb), sampled.a);
    material.depthTest = false;
    material.depthWrite = false;
    this.copy = { quad: new QuadMesh(material), input };
  }

  addPass(pass: Pass) {
    this.passes.push(pass);
    pass.setSize(this.width, this.height);
    return pass;
  }

  removePass(pass: Pass) {
    const index = this.passes.indexOf(pass);
    if (index >= 0) this.passes.splice(index, 1);
  }

  /** The frame's drawing size, in pixels. */
  setSize(width: number, height: number) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.sceneTarget.setSize(this.width, this.height);
    for (const buffer of this.buffers) buffer.setSize(this.width, this.height);
    for (const pass of this.passes) pass.setSize(this.width, this.height);
  }

  getSize() {
    return { width: this.width, height: this.height };
  }

  render(delta = 0) {
    const renderer = this.renderer;
    const enabled = this.passes.filter((pass) => pass.enabled);
    if (enabled.length === 0) return;
    const context: PassContext = {
      depth: (this.sceneTarget.depthTexture as DepthTexture) ?? null,
      delta,
    };
    const autoClear = renderer.autoClear;
    const outputColorSpace = renderer.outputColorSpace;
    const toneMapping = renderer.toneMapping;
    let input: RenderTarget = this.sceneTarget;
    let next = 0;
    try {
      for (let i = 0; i < enabled.length; i++) {
        const pass = enabled[i];
        const isLast = i === enabled.length - 1;
        if ((pass as ScenePass).isScenePass) {
          renderer.autoClear = autoClear;
          pass.render(renderer, input, this.sceneTarget, context);
          input = this.sceneTarget;
          if (isLast) this.present(input);
          continue;
        }
        renderer.autoClear = false;
        let output: RenderTarget | null = null;
        if (!isLast) {
          output = this.buffers[next];
        } else {
          // The last pass encodes the output itself.
          renderer.outputColorSpace = LinearSRGBColorSpace;
          renderer.toneMapping = NoToneMapping;
        }
        pass.render(renderer, input, output, context);
        if (output && pass.needsSwap) {
          input = output;
          next = 1 - next;
        }
      }
    } finally {
      renderer.autoClear = autoClear;
      renderer.outputColorSpace = outputColorSpace;
      renderer.toneMapping = toneMapping;
      renderer.setRenderTarget(null);
    }
  }

  /** The scene as the last pass: copied to the screen, encoded. */
  private present(input: RenderTarget) {
    const renderer = this.renderer;
    const outputColorSpace = renderer.outputColorSpace;
    renderer.outputColorSpace = LinearSRGBColorSpace;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    this.copy.input.value = input.texture;
    this.copy.quad.render(renderer);
    renderer.outputColorSpace = outputColorSpace;
  }

  dispose() {
    for (const pass of this.passes) pass.dispose();
    this.sceneTarget.depthTexture?.dispose();
    this.sceneTarget.dispose();
    for (const buffer of this.buffers) buffer.dispose();
    (this.copy.quad.material as NodeMaterial).dispose();
  }
}
