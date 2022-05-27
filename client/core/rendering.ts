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
};

const defaultParams: RenderingParams = {
  clearColor: "#123",
};

class Rendering {
  public params: RenderingParams;

  public scene: Scene;
  public renderer: WebGLRenderer;
  public composer: EffectComposer;

  constructor(public client: Client, params: Partial<RenderingParams> = {}) {
    const { clearColor } = (this.params = {
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

      this.adjustRenderer();
    });
  }

  adjustRenderer = () => {
    const { width, height } = this.renderSize;

    if (width === 0 || height === 0) return;

    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
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
