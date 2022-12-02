import {
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  sRGBEncoding,
  WebGLRenderer,
} from "three";

import { World } from "../core/world/index";

export type BlockPortraitParams = {
  zoom: number;
  cameraType: "perspective" | "orthographic";
  width: number;
  height: number;
};

const defaultParams: BlockPortraitParams = {
  zoom: 1,
  cameraType: "perspective",
  width: 100,
  height: 100,
};

export class BlockPortraits {
  public renderer: WebGLRenderer;

  public orthoCamera: OrthographicCamera;

  public perspectiveCamera: PerspectiveCamera;

  public world: World;

  public portraits = new Map<
    string,
    {
      id: number;
      scene: Scene;
      canvas: HTMLCanvasElement;
      params: BlockPortraitParams;
      render: () => void;
      initialized: boolean;
    }
  >();

  constructor(world: World) {
    this.world = world;

    this.renderer = new WebGLRenderer({
      alpha: true,
    });
    this.renderer.outputEncoding = sRGBEncoding;
  }

  add = (
    name: string,
    id: number,
    params: Partial<BlockPortraitParams> = {}
  ) => {
    if (this.portraits.has(name)) {
      return this.portraits.get(name).canvas;
    }

    const { zoom, cameraType, width, height } = (params = {
      ...params,
      ...defaultParams,
    });

    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const scene = new Scene();

    const factor = 2.5;

    const camera =
      cameraType === "perspective"
        ? new PerspectiveCamera(45, 1, 0.1, zoom * factor * 2)
        : new OrthographicCamera(-zoom, zoom, zoom, -zoom, 0.1, 1000);

    camera.position.set(zoom * factor, zoom * factor, zoom * factor);
    camera.lookAt(0, 0, 0);

    const mesh = this.world.makeBlockMesh(id);

    if (mesh) {
      scene.add(mesh);
    }

    let count = Math.floor(Math.random() * 5);

    const render = () => {
      count++;

      if (count % 5 === 0) {
        this.renderer.setSize(width, height);
        this.renderer.render(scene, camera);
      } else if (count % 5 === 3) {
        const rendererCanvas = this.renderer.domElement;
        const ctx = canvas.getContext("2d");
        ctx.globalCompositeOperation = "copy";
        ctx.drawImage(
          rendererCanvas,
          0,
          rendererCanvas.height - height,
          width,
          height,
          0,
          0,
          width,
          height
        );
      }
    };

    this.portraits.set(name, {
      id,
      canvas,
      params: params as BlockPortraitParams,
      initialized: mesh ? true : false,
      scene,
      render,
    });

    return canvas;
  };

  remove = (name: string) => {
    this.portraits.delete(name);
  };

  update = () => {
    this.portraits.forEach((portrait) => {
      if (!portrait.initialized) {
        const mesh = this.world.makeBlockMesh(portrait.id);
        if (mesh) {
          portrait.scene.add(mesh);
          portrait.initialized = true;
        } else {
          return;
        }
      }

      portrait.render();
    });
  };
}
