import {
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
} from "postprocessing";
import { Color, Scene, WebGLRenderer } from "three";

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
   * The GLSL uniform for the color of the fog, in other words the color objects fade into when afar.
   */
  public uFogColor: {
    /**
     * A ThreeJS `Color` instance, GLSL-compatible.
     */
    value: Color;
  };

  /**
   * The GLSL uniform for the near distance that the fog starts fogging up.
   */
  public uFogNear: {
    /**
     * The actual fog near distance, in world units.
     */
    value: number;
  };

  /**
   * The GLSL uniform for the near distance that the fog fogs up fully.
   */
  public uFogFar: {
    /**
     * The actual fog far distance, in world units.
     */
    value: number;
  };

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

      this.uFogColor = client.world.sky.uMiddleColor;
      this.uFogNear = { value: 0 };
      this.uFogFar = { value: 0 };

      this.adjustRenderer();
    });

    client.on("ready", () => {
      const renderRadius = client.settings.getRenderRadius();
      this.setFogDistance(renderRadius);
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
   * Set the farthest distance for the fog. Fog starts fogging up 50% from the farthest.
   *
   * @param distance - The maximum distance that the fog fully fogs up.
   */
  setFogDistance = (distance: number) => {
    const { chunkSize } = this.client.world.params;

    this.uFogNear.value = distance * 0.5 * chunkSize;
    this.uFogFar.value = distance * chunkSize;
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
