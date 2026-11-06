import {
  type Camera,
  Color,
  HalfFloatType,
  type Object3D,
  type Renderer,
  RenderTarget,
} from "three/webgpu";
import { vec4 } from "three/tsl";

import { Effect, type EffectInputs } from "../effect";
import { textureInput, type Vec4Node } from "../nodes";

const scratchClear = new Color();

/**
 * A second scene drawn over the finished frame, with a depth buffer of its
 * own (a first-person arm and held item, drawn after every other effect so
 * none of them touches it). It renders into its own target each frame,
 * cleared to nothing, and lands on the frame by its coverage
 * (premultiplied, as normal blending leaves it over a clear target).
 */
export class SceneOverlayEffect extends Effect {
  /** Skips the draw (and the overlay) while false. */
  isVisible = true;

  private readonly target: RenderTarget;
  private readonly overlay = textureInput();

  /** The scene drawn over the frame and the camera it is drawn from; null draws nothing. */
  constructor(
    public scene: Object3D | null = null,
    public camera: Camera | null = null,
  ) {
    super("scene-overlay", "src");
    this.target = new RenderTarget(1, 1, {
      type: HalfFloatType,
      depthBuffer: true,
      generateMipmaps: false,
    });
    this.target.texture.name = "SceneOverlay";
  }

  /**
   * Where the overlay's scene draws, for a warmup that builds its pipelines
   * before the first frame shows it (they are keyed by the target's formats).
   */
  get compileTarget(): RenderTarget {
    return this.target;
  }

  fragment({ color, uv }: EffectInputs): Vec4Node {
    const over = this.overlay.sample(uv) as unknown as Vec4Node;
    return vec4(color.rgb.mul(over.a.oneMinus()).add(over.rgb), color.a);
  }

  update(renderer: Renderer) {
    const clearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(scratchClear);
    const autoClear = renderer.autoClear;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    if (this.isVisible && this.scene && this.camera) {
      renderer.autoClear = false;
      renderer.render(this.scene, this.camera);
    }
    renderer.autoClear = autoClear;
    renderer.setClearColor(scratchClear, clearAlpha);
    this.overlay.value = this.target.texture;
  }

  setSize(width: number, height: number) {
    this.target.setSize(width, height);
  }

  dispose() {
    this.target.dispose();
  }
}
