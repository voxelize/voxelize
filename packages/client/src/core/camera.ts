import { PerspectiveCamera, Vector3, MathUtils } from "three";

import { Client } from "..";

type CameraParams = {
  fov: number;
  near: number;
  far: number;
  lerpFactor: number;
  minPolarAngle: number;
  maxPolarAngle: number;
};

const defaultParams: CameraParams = {
  fov: 90,
  near: 0.1,
  far: 8000,
  lerpFactor: 0.7,
  minPolarAngle: 0,
  maxPolarAngle: Math.PI,
};

/**
 * A wrapper class around THREE.JS's perspective camera, adding on custom functionalities
 * for Voxelize and in-game utilities such as FOV interpolating
 *
 * @class Camera
 */
class Camera {
  /**
   * An object storing the parameters passed on `Camera` construction
   *
   * @type {CameraParams}
   * @memberof Camera
   */
  public params: CameraParams;

  /**
   * Actual THREE.JS `PerspectiveCamera` instance
   *
   * @type {PerspectiveCamera}
   * @memberof Camera
   */
  public threeCamera: PerspectiveCamera;

  private newZoom: number;
  private newFOV: number;

  constructor(public client: Client, params: Partial<CameraParams> = {}) {
    const { fov, near, far } = (this.params = {
      ...defaultParams,
      ...params,
    });

    this.newFOV = fov;
    this.newZoom = 1;

    // three.js camera
    this.threeCamera = new PerspectiveCamera(
      fov,
      this.client.rendering.aspectRatio,
      near,
      far
    );

    // initialize camera position
    this.threeCamera.lookAt(new Vector3(0, 0, 0));

    // listen to resize, and adjust accordingly
    // ? should move to it's own logic for all event listeners?
    window.addEventListener("resize", () => {
      client.container.fitCanvas();
      client.rendering.adjustRenderer();

      this.threeCamera.aspect = client.rendering.aspectRatio;
      this.threeCamera.updateProjectionMatrix();
    });
  }

  /**
   * Update for the camera of the game, does the following:
   * - interpolate FOV to a new value if `camera.setFOV` is called
   * - interpolate zoom to a new value if `camera.setZoom` is called
   *
   * @memberof Camera
   */
  update = () => {
    if (this.newFOV !== this.threeCamera.fov) {
      this.threeCamera.fov = MathUtils.lerp(
        this.threeCamera.fov,
        this.newFOV,
        this.params.lerpFactor
      );
      this.threeCamera.updateProjectionMatrix();
    }

    if (this.newZoom !== this.threeCamera.zoom) {
      this.threeCamera.zoom = MathUtils.lerp(
        this.threeCamera.zoom,
        this.newZoom,
        this.params.lerpFactor
      );
      this.threeCamera.updateProjectionMatrix();
    }
  };

  /**
   * Set the zoom of the game camera, gets lerp over time. Default is 1.
   *
   * @param zoom - The desired zoom for camera
   *
   * @memberof Camera
   */
  setZoom = (zoom: number) => {
    this.newZoom = zoom;
  };

  /**
   * Set the FOV of the game camera, gets lerp over time. Default is 90.
   *
   * @param fov - The desired FOV for camera
   *
   * @memberof Camera
   */
  setFOV = (fov: number) => {
    this.newFOV = fov;
  };
}

export type { CameraParams };

export { Camera };
