import {
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
} from "postprocessing";
import { Color, FogExp2, Scene, WebGLRenderer } from "three";

import { Client } from "..";

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
  /**
   * Reference linking back to the Voxelize client instance.
   */
  public client: Client;

  /**
   * Parameters to initialize the Voxelize rendering pipeline.
   */
  public params: RenderingParams;

  /**
   * A ThreeJS `Scene` instance holding all ThreeJS-renderable objects.
   */
  public scene: Scene;

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
  constructor(client: Client, params: Partial<RenderingParams> = {}) {
    this.client = client;

    const { clearColor } = (this.params = {
      ...defaultParams,
      ...params,
    });

    // three.js scene
    this.scene = new Scene();
    this.scene.fog = new FogExp2("#000000");

    const canvas = this.client.container.canvas;
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

    client.on("initialized", () => {
      const camera = client.camera.threeCamera;

      this.composer.addPass(new RenderPass(this.scene, camera));
      this.composer.addPass(new EffectPass(camera, new SMAAEffect({})));

      this.adjustRenderer();
    });
  }

  /**
   * Adjust the Voxelize rendering pipeline to fit the game container's size, updating the
   * aspect ratio and renderer size.
   */
  adjustRenderer = () => {
    const { width, height } = this.renderSize;

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
  render = () => {
    if (this.composer.passes.length) {
      this.composer.render();
    }
  };

  /**
   * The size of the Voxelize containing DOM element (offsetWidth and offsetHeight).
   */
  get renderSize() {
    const { offsetWidth, offsetHeight } = this.client.container.domElement;
    return {
      /**
       * The offset width of the DOM container.
       */
      width: offsetWidth,

      /**
       * The offset height of the DOM container.
       */
      height: offsetHeight,
    };
  }

  /**
   * The aspect ratio of the renderer, based on the `renderSize`.
   */
  get aspectRatio() {
    const { width, height } = this.renderSize;
    return width / height;
  }
}

export type { RenderingParams };

export { Rendering };
