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

class Camera {
  public params: CameraParams;

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

  tick = () => {
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

  setZoom = (zoom: number) => {
    this.newZoom = zoom;
  };

  setFOV = (fov: number) => {
    this.newFOV = fov;
  };
}

export type { CameraParams };

export { Camera };
