import {
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
} from "postprocessing";
import { Color, WebGLRenderer } from "three";

import { Camera } from "./camera";
import { Container } from "./container";
import { World } from "./world";

/**
 * Parameters to initialize the rendering pipeline.
 */
type RenderingParams = {
  /**
   * The color behind the sky, the default color clients see. Defaults to `#000`.
   */
  clearColor: string;
};

const defaultParams: RenderingParams = {
  clearColor: "#000",
};

/**
 * A **built-in** rendering pipeline for Voxelize, based on ThreeJS's `WebGLRenderer`.
 *
 * @category Core
 */
class Rendering {
  public container: Container;

  /**
   * Parameters to initialize the Voxelize rendering pipeline.
   */
  public params: RenderingParams;

  /**
   * The ThreeJS `WebGLRenderer` used to render Voxelize.
   */
  public renderer: WebGLRenderer;

  /**
   * A postprocessing effect composer to add post-processing to Voxelize.
   */
  public composer: EffectComposer;

  /**
   * COnstruct a rendering pipeline for Voxelize.
   *
   * @hidden
   */
  constructor(container: Container, params: Partial<RenderingParams> = {}) {
    const { clearColor } = (this.params = {
      ...defaultParams,
      ...params,
    });

    this.container = container;

    const canvas = this.container.canvas;
    let context: WebGL2RenderingContext | WebGLRenderingContext;
    try {
      if (window.WebGL2RenderingContext) {
        context = canvas.getContext("webgl2");
      }
    } catch (e) {
      context = canvas.getContext("webgl");
    }

    this.renderer = new WebGLRenderer({
      powerPreference: "high-performance",
      antialias: true,
      depth: false,
      context: context || undefined,
      canvas,
    });
    this.renderer.setClearColor(new Color(clearColor));

    // composer
    this.composer = new EffectComposer(this.renderer);
  }

  /**
   * Adjust the Voxelize rendering pipeline to fit the game container's size, updating the
   * aspect ratio and renderer size.
   */
  adjustRenderer = () => {
    const { width, height } = this.container.renderSize;

    if (width === 0 || height === 0) return;

    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  };

  /**
   * Render Voxelize once.
   *
   * @internal
   * @hidden
   */
  render = (world: World, camera: Camera) => {
    if (!this.composer.passes.length) {
      this.composer.addPass(new RenderPass(world, camera));
      this.composer.addPass(new EffectPass(camera, new SMAAEffect({})));

      this.adjustRenderer();
    }

    this.composer.render();
  };
}

export type { RenderingParams };

export { Rendering };
