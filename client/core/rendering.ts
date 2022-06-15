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

  public fogColor: Color;
  public fogUniforms: { [key: string]: { value: number | Color } };

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

    client.on("ready", () => {
      const camera = client.camera.threeCamera;

      this.composer.addPass(new RenderPass(this.scene, camera));
      this.composer.addPass(new EffectPass(camera, new SMAAEffect({})));

      const { chunkSize, dimension } = client.world.params;
      const renderRadius = client.settings.getRenderRadius();
      this.fogColor = new Color(fogColor);
      this.fogUniforms = {
        uFogColor: { value: this.fogColor },
        uFogNear: { value: renderRadius * 0.5 * chunkSize * dimension },
        uFogFar: { value: renderRadius * 0.7 * chunkSize * dimension },
      };

      this.adjustRenderer();
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

    this.fogUniforms.uFogNear.value = radius * 0.5 * chunkSize * dimension;
    this.fogUniforms.uFogFar.value = radius * chunkSize * dimension;
  };

  render = () => {
    this.composer.render();
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
