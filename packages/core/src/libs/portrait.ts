import {
  DirectionalLight,
  Object3D,
  OrthographicCamera,
  SRGBColorSpace,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";

import { CameraPerspective } from "../common";

/**
 * Parameters to create a portrait with.
 */
export type PortraitOptions = {
  /**
   * The arbitrary zoom from the camera to the object. This is used to calculate the zoom
   * of the camera. Defaults to `1`.
   */
  zoom: number;

  /**
   * The position of where the camera should be looking at. Defaults to `pxyz`, which
   * means that the camera will be looking at the center of the object from the positive
   * x, y, and z axis scaled by the zoom.
   */
  perspective: CameraPerspective;

  /**
   * The width of the portrait canvas. Defaults to `100` pixels.
   */
  width: number;

  /**
   * The height of the portrait canvas. Defaults to `100` pixels.
   */
  height: number;

  /**
   * Whether or not should this portrait only render once. Defaults to `false`.
   */
  renderOnce: boolean;

  /**
   * The rotation around the y axis about the camera. This is used to calculate the
   * position of the light. Defaults to `-Math.PI / 8`.
   */
  lightRotationOffset: number;
};

const defaultOptions: PortraitOptions = {
  zoom: 1,
  perspective: "pxyz",
  width: 100,
  height: 100,
  renderOnce: false,
  lightRotationOffset: -Math.PI / 8,
};

/**
 * This class allows you to render a single THREE.js object to a canvas element.
 * This is useful for generating images of objects for use in the game. However, there
 * are performance bottlenecks that you should be aware of:
 * - The THREE.js renderer is shared between all instances of this class. This is because
 *   there is a limit to how many webgl contexts can be created.
 * - Each individual portrait has their own render loop. This means that if you have a lto
 *   of portraits, you will be rendering a lot of frames per second. This can be mitigated
 *   by either using the renderOnce parameter or utilizing the {@link ItemSlots} class, which
 *   batch renders objects in a grid-like fashion.
 *
 * # Example
 * ```ts
 * const portrait = new Portrait(world.makeBlockMesh(5));
 * document.body.appendChild(portrait.canvas);
 * ```
 */
export class Portrait {
  private static _renderer: WebGLRenderer | null = null;

  public static get renderer(): WebGLRenderer {
    if (!Portrait._renderer) {
      Portrait._renderer = new WebGLRenderer({
        antialias: false,
        failIfMajorPerformanceCaveat: false,
      });
    }
    return Portrait._renderer;
  }

  /**
   * Parameters to create this portrait with.
   */
  public options: PortraitOptions;

  /**
   * The THREE.js camera to use for rendering this portrait.
   */
  public camera: OrthographicCamera;

  /**
   * The THREE.js scene to use for rendering this portrait.
   */
  public scene: Scene;

  /**
   * The canvas element to render this portrait to.
   */
  public canvas: HTMLCanvasElement;

  /**
   * The target of this portrait.
   */
  public object: Object3D;

  /**
   * The animation frame id of the render loop.
   */
  private animationFrameId = -1;

  /**
   * Create a new portrait. This automatically starts a render loop.
   *
   * @param object The object to render to the canvas.
   * @param options The options to create this portrait with.
   */
  constructor(object: Object3D, options: Partial<PortraitOptions> = {}) {
    if (!object) {
      throw new Error("A target object is required for portraits.");
    }

    Portrait.renderer.outputColorSpace = SRGBColorSpace;

    const { width, height, zoom, perspective, lightRotationOffset } =
      (this.options = {
        ...defaultOptions,
        ...options,
      });

    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;

    this.scene = new Scene();

    const negative = perspective.includes("n") ? -1 : 1;
    const xFactor = perspective.includes("x") ? 1 : 0;
    const yFactor = perspective.includes("y") ? 1 : 0;
    const zFactor = perspective.includes("z") ? 1 : 0;

    this.camera = new OrthographicCamera(-zoom, zoom, zoom, -zoom);
    this.camera.far = zoom * 10 + 1;
    this.camera.near = 0.1;
    this.camera.position.set(
      negative * xFactor * zoom * 3.5,
      negative * yFactor * zoom * 3.5,
      negative * zFactor * zoom * 3.5
    );
    this.camera.lookAt(0, 0, 0);

    const lightPosition = this.camera.position.clone();
    // Rotate light position by y axis 45 degrees.
    lightPosition.applyAxisAngle(new Vector3(0, 1, 0), lightRotationOffset);

    const light = new DirectionalLight(0xffffff, 3);
    light.position.copy(lightPosition);
    this.scene.add(light);

    this.setObject(object);

    this.render();
  }

  /**
   * Set the object to render to the canvas.
   *
   * @param object The object to render to the canvas.
   */
  setObject = (object: Object3D) => {
    if (this.object) {
      this.scene.remove(this.object);
    }

    this.scene.add(object);
    this.object = object;
  };

  /**
   * Dispose of this portrait. This stops the render loop and removes the object from the scene.
   * However, it does not remove the canvas from the DOM.
   */
  dispose = () => {
    cancelAnimationFrame(this.animationFrameId);

    this.scene.remove(this.object);
    this.object = null;
  };

  /**
   * The render loop that is fired off when this portrait is created.
   */
  private render = () => {
    this.animationFrameId = requestAnimationFrame(this.render);

    const renderer = Portrait.renderer;
    const { renderOnce } = this.options;

    // Get the renderer's sizes
    const { width, height } = renderer.getSize(new Vector2(0, 0));

    if (width !== this.canvas.width || height !== this.canvas.height) {
      renderer.setSize(this.canvas.width, this.canvas.height);
    }

    renderer.render(this.scene, this.camera);

    const rendererCanvas = renderer.domElement;
    const ctx = this.canvas.getContext("2d");

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

    if (renderOnce) {
      this.dispose();
    }
  };
}
