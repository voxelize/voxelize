import {
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
} from "postprocessing";
import { Color, Scene, WebGLRenderer } from "three";

import { Client } from "..";

type RenderingParams = {
  clearColor: string;
  fogColor: string;
};

const defaultParams: RenderingParams = {
  clearColor: "#123",
  fogColor: "#B1CCFD",
};

class Rendering {
  public params: RenderingParams;

  public scene: Scene;
  public renderer: WebGLRenderer;
  public composer: EffectComposer;

  public uFogColor: { value: Color };
  public uFogNear: { value: number };
  public uFogFar: { value: number };

  constructor(public client: Client, params: Partial<RenderingParams> = {}) {
    const { clearColor, fogColor } = (this.params = {
      ...defaultParams,
      ...params,
    });

    // three.js scene
    this.scene = new Scene();

    const canvas = this.client.container.canvas;
    let context;
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
      this.matchRenderRadius(renderRadius);
    });
  }

  adjustRenderer = () => {
    const { width, height } = this.renderSize;

    if (width === 0 || height === 0) return;

    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  };

  matchRenderRadius = (radius: number) => {
    const { chunkSize, dimension } = this.client.world.params;

    this.uFogNear.value = radius * 0.5 * chunkSize * dimension;
    this.uFogFar.value = radius * chunkSize * dimension;
  };

  render = () => {
    if (this.composer.passes.length) {
      this.composer.render();
    }
  };

  get renderSize() {
    const { offsetWidth, offsetHeight } = this.client.container.domElement;
    return { width: offsetWidth, height: offsetHeight };
  }

  get aspectRatio() {
    const { width, height } = this.renderSize;
    return width / height;
  }
}

export type { RenderingParams };

export { Rendering };
