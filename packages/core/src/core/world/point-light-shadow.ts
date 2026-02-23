import {
  CubeCamera,
  CubeTexture,
  DoubleSide,
  HalfFloatType,
  MeshBasicMaterial,
  NearestFilter,
  Object3D,
  RGBAFormat,
  Scene,
  Vector3,
} from "three";
import { CubeRenderTarget, type Renderer } from "three/webgpu";

export interface PointLightShadowConfig {
  shadowMapSize: number;
  near: number;
  far: number;
  bias: number;
}

const defaultConfig: PointLightShadowConfig = {
  shadowMapSize: 512,
  near: 0.1,
  far: 32,
  bias: 0.005,
};

export class PointLightShadowRenderer {
  private config: PointLightShadowConfig;
  private cubeCamera: CubeCamera;
  private cubeRenderTarget: CubeRenderTarget;
  private depthMaterial: MeshBasicMaterial;
  private lightPosition = new Vector3();
  private lastLightPosition = new Vector3();
  private needsUpdate = true;
  private frameCount = 0;
  private updateInterval = 2;

  constructor(config: Partial<PointLightShadowConfig> = {}) {
    this.config = { ...defaultConfig, ...config };

    this.cubeRenderTarget = new CubeRenderTarget(this.config.shadowMapSize, {
      format: RGBAFormat,
      type: HalfFloatType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
    });

    this.cubeCamera = new CubeCamera(
      this.config.near,
      this.config.far,
      this.cubeRenderTarget,
    );

    this.depthMaterial = new MeshBasicMaterial({
      colorWrite: false,
      side: DoubleSide,
    });
  }

  setLightPosition(position: Vector3) {
    if (!this.lightPosition.equals(position)) {
      this.lightPosition.copy(position);
      this.needsUpdate = true;
    }
  }

  getLightPosition(): Vector3 {
    return this.lightPosition.clone();
  }

  getShadowMap(): CubeTexture {
    return this.cubeRenderTarget.texture;
  }

  getNear(): number {
    return this.config.near;
  }

  getFar(): number {
    return this.config.far;
  }

  getBias(): number {
    return this.config.bias;
  }

  update(
    renderer: Renderer,
    scene: Scene,
    skipObjects: Object3D[] = [],
  ): boolean {
    this.frameCount++;

    if (!this.needsUpdate && this.frameCount % this.updateInterval !== 0) {
      return false;
    }

    if (
      this.lightPosition.distanceToSquared(this.lastLightPosition) < 0.01 &&
      !this.needsUpdate
    ) {
      return false;
    }

    this.lastLightPosition.copy(this.lightPosition);
    this.needsUpdate = false;

    this.cubeCamera.position.copy(this.lightPosition);

    const originalVisibility = new Map<Object3D, boolean>();
    for (const obj of skipObjects) {
      originalVisibility.set(obj, obj.visible);
      obj.visible = false;
    }

    const originalOverrideMaterial = scene.overrideMaterial;
    scene.overrideMaterial = this.depthMaterial;

    this.cubeCamera.update(renderer, scene);

    scene.overrideMaterial = originalOverrideMaterial;

    for (const [obj, visible] of originalVisibility) {
      obj.visible = visible;
    }

    return true;
  }

  dispose() {
    this.cubeRenderTarget.dispose();
    this.depthMaterial.dispose();
  }
}
