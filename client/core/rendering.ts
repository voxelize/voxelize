import {
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
} from "postprocessing";
import { Color, Fog, Scene, WebGLRenderer } from "three";

import { Client } from "..";

type RenderingParams = {
  clearColor: string;
  fogNearColor: string;
  fogFarColor: string;
};

const defaultParams: RenderingParams = {
  clearColor: "#123",
  fogNearColor: "#B1CCFD",
  fogFarColor: "#B1CCFD",
};

class Rendering {
  public params: RenderingParams;

  public scene: Scene;
  public renderer: WebGLRenderer;
  public composer: EffectComposer;

  public fogNearColor: Color;
  public fogFarColor: Color;
  public fogUniforms: { [key: string]: { value: number | Color } };

  constructor(public client: Client, params: Partial<RenderingParams> = {}) {
    const { clearColor, fogNearColor, fogFarColor } = (this.params = {
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
      const { renderRadius } = client.settings;
      this.fogNearColor = new Color(fogNearColor);
      this.fogFarColor = new Color(fogFarColor);
      this.fogUniforms = {
        uFogColor: { value: this.fogNearColor },
        uFogNearColor: { value: this.fogFarColor },
        uFogNear: { value: renderRadius * 0.3 * chunkSize * dimension },
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
