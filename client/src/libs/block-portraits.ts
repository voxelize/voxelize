import {
  DirectionalLight,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  sRGBEncoding,
  Vector3,
  WebGLRenderer,
} from "three";

import { CameraPerspective } from "../common";
import { World } from "../core/world/index";

export type BlockPortraitParams = {
  zoom: number;
  perspective: CameraPerspective;
  width: number;
  height: number;
  alpha: boolean;
  lightRotationOffset: number;
};

const defaultParams: BlockPortraitParams = {
  zoom: 1,
  perspective: "pxyz",
  width: 100,
  height: 100,
  alpha: false,
  lightRotationOffset: -Math.PI / 8,
};

export class BlockPortraits {
  public renderer: WebGLRenderer;

  public camera: PerspectiveCamera;

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

    const { zoom, perspective, width, height, alpha, lightRotationOffset } =
      (params = {
        ...params,
        ...defaultParams,
      });

    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const scene = new Scene();

    const negative = perspective.includes("n") ? -1 : 1;
    const xFactor = perspective.includes("x") ? 1 : 0;
    const yFactor = perspective.includes("y") ? 1 : 0;
    const zFactor = perspective.includes("z") ? 1 : 0;

    // const camera = new PerspectiveCamera(75, width / height, 0.1, 1000);

    const camera = new OrthographicCamera(-zoom, zoom, zoom, -zoom);

    camera.far = zoom * 10 + 1;
    camera.near = 0.1;
    camera.position.set(
      negative * xFactor * zoom * 3.5,
      negative * yFactor * zoom * 3.5,
      negative * zFactor * zoom * 3.5
    );
    camera.lookAt(0, 0, 0);

    const lightPosition = camera.position.clone();
    // Rotate light position by y axis 45 degrees.
    lightPosition.applyAxisAngle(new Vector3(0, 1, 0), lightRotationOffset);

    const light = new DirectionalLight(0xffffff, 1);
    light.position.copy(lightPosition);
    scene.add(light);

    const mesh = this.world.makeBlockMesh(id);

    if (mesh) {
      scene.add(mesh);
    }

    let count = Math.floor(Math.random() * 5);

    const render = () => {
      count++;

      if (count % 2 === 0) {
        this.renderer.setSize(width, height);
        this.renderer.render(scene, camera);
      } else {
        const rendererCanvas = this.renderer.domElement;
        const ctx = canvas.getContext("2d", { alpha });
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
