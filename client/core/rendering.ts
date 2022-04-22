import {
  Color,
  DepthFormat,
  DepthTexture,
  FloatType,
  LinearFilter,
  RGBAFormat,
  Scene,
  UnsignedIntType,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";

import { Client } from "..";

type RenderingParams = {
  fogColor: string;
  fogNearColor: string;
  clearColor: string;
};

const defaultParams: RenderingParams = {
  fogColor: "#222",
  fogNearColor: "#333",
  clearColor: "#123",
};

class Rendering {
  public params: RenderingParams;

  public scene: Scene;
  public renderer: WebGLRenderer;
  public composer: EffectComposer;
  public renderTarget: WebGLRenderTarget;

  public fogNearColor: Color;
  public fogFarColor: Color;
  public fogUniforms: { [key: string]: { value: number | Color } };

  constructor(public client: Client, params: Partial<RenderingParams> = {}) {
    const { fogColor, fogNearColor, clearColor } = (this.params = {
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
      stencil: false,
      depth: true,
      context: context || undefined,
      canvas,
    });
    this.renderer.setClearColor(new Color(clearColor));
    this.renderer.extensions.get("EXT_color_buffer_float");
    this.renderer.extensions.get("EXT_float_blend");

    // composer
    const { width, height } = this.renderSize;
    this.renderTarget = new WebGLRenderTarget(width, height, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      format: RGBAFormat,
      type: FloatType,
    });
    this.renderTarget.stencilBuffer = false;
    this.renderTarget.depthTexture = new DepthTexture(width, height);
    this.renderTarget.depthTexture.format = DepthFormat;
    this.renderTarget.depthTexture.type = UnsignedIntType;

    this.composer = new EffectComposer(this.renderer, this.renderTarget);

    client.on("ready", () => {
      // fog
      const { world, settings } = this.client;
      const { chunkSize, dimension } = world.params;
      const { renderRadius } = settings;

      this.fogNearColor = new Color(fogNearColor);
      this.fogFarColor = new Color(fogColor);
      this.fogUniforms = {
        uFogColor: { value: this.fogNearColor },
        uFogNearColor: { value: this.fogFarColor },
        // uFogNear: { value: renderRadius * 0.4 * chunkSize * dimension },
        // uFogFar: { value: renderRadius * 0.8 * chunkSize * dimension },
        uFogNear: { value: Infinity },
        uFogFar: { value: Infinity },
      };

      this.composer.addPass(
        new RenderPass(this.scene, client.camera.threeCamera)
      );

      this.adjustRenderer();
    });
  }

  adjustRenderer = () => {
    const { width, height } = this.renderSize;
    const pixelRatio = Math.min(window.devicePixelRatio, 2);

    if (width === 0 || height === 0) return;

    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(pixelRatio);

    this.composer.setSize(width, height);
    this.composer.setPixelRatio(pixelRatio);
  };

  render = () => {
    this.composer.render();
  };

  get renderSize() {
    const { offsetWidth, offsetHeight } = this.client.container.canvas;
    return { width: offsetWidth, height: offsetHeight };
  }

  get aspectRatio() {
    const { width, height } = this.renderSize;
    return width / height;
  }
}

export type { RenderingParams };

export { Rendering };
