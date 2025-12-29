import {
  Camera,
  DepthTexture,
  Frustum,
  Matrix4,
  MeshDepthMaterial,
  Object3D,
  OrthographicCamera,
  RGBADepthPacking,
  Scene,
  Texture,
  UnsignedShortType,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from "three";

export interface CSMConfig {
  cascades: number;
  shadowMapSize: number;
  maxShadowDistance: number;
  shadowBias: number;
  shadowNormalBias: number;
  lightMargin: number;
}

interface Cascade {
  renderTarget: WebGLRenderTarget;
  camera: OrthographicCamera;
  matrix: Matrix4;
  split: number;
}

const defaultConfig: CSMConfig = {
  cascades: 3,
  shadowMapSize: 2048,
  maxShadowDistance: 128,
  shadowBias: 0.002,
  shadowNormalBias: 0.02,
  lightMargin: 32,
};

export class CSMRenderer {
  private config: CSMConfig;
  private cascades: Cascade[] = [];
  private lightDirection = new Vector3(0, -1, 0.3).normalize();
  private lastLightDirection = new Vector3(0, -1, 0.3).normalize();
  private frustum = new Frustum();
  private depthMaterial: MeshDepthMaterial;
  private frameCount = 0;
  private lastCameraPosition = new Vector3();
  private cascadeDirty: boolean[] = [];
  private tempMatrix = new Matrix4();
  private tempVec3 = new Vector3();

  constructor(config: Partial<CSMConfig> = {}) {
    this.config = { ...defaultConfig, ...config };

    this.depthMaterial = new MeshDepthMaterial({
      depthPacking: RGBADepthPacking,
    });

    this.initCascades();
  }

  private initCascades() {
    const { cascades, shadowMapSize, maxShadowDistance } = this.config;

    const lambda = 0.5;
    const splits: number[] = [];

    for (let i = 0; i <= cascades; i++) {
      const p = i / cascades;
      const log = Math.pow(p, lambda);
      splits.push(log * maxShadowDistance);
    }

    for (let i = 0; i < cascades; i++) {
      const size = i < cascades - 1 ? shadowMapSize : shadowMapSize / 2;

      const renderTarget = new WebGLRenderTarget(size, size, {
        depthTexture: new DepthTexture(size, size),
      });
      renderTarget.depthTexture.type = UnsignedShortType;

      const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);

      this.cascades.push({
        renderTarget,
        camera,
        matrix: new Matrix4(),
        split: splits[i + 1],
      });

      this.cascadeDirty.push(true);
    }
  }

  setLightDirection(direction: Vector3) {
    this.lightDirection.copy(direction).normalize();
    this.markAllCascadesDirty();
  }

  private markAllCascadesDirty() {
    for (let i = 0; i < this.cascadeDirty.length; i++) {
      this.cascadeDirty[i] = true;
    }
  }

  private shouldUpdateCascade(index: number, cameraMovement: number): boolean {
    if (this.cascadeDirty[index]) {
      return true;
    }

    if (index === 0) {
      return cameraMovement > 0.1;
    }

    if (index === 1) {
      return cameraMovement > 0.5 || this.frameCount % 2 === 0;
    }

    return cameraMovement > 1.0 || this.frameCount % 4 === index;
  }

  update(mainCamera: Camera, sunDirection: Vector3, playerPosition?: Vector3) {
    this.frameCount++;
    this.lightDirection.copy(sunDirection).normalize();

    const effectivePosition = playerPosition || mainCamera.position;

    const lightDirChange = this.tempVec3
      .copy(this.lightDirection)
      .sub(this.lastLightDirection)
      .length();

    if (lightDirChange > 0.01) {
      this.markAllCascadesDirty();
      this.lastLightDirection.copy(this.lightDirection);
    }

    const cameraMovement = this.tempVec3
      .copy(effectivePosition)
      .sub(this.lastCameraPosition)
      .length();

    this.lastCameraPosition.copy(effectivePosition);

    mainCamera.updateMatrixWorld();
    this.tempMatrix
      .copy(mainCamera.projectionMatrix)
      .multiply(mainCamera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.tempMatrix);

    let prevSplit = 0;
    for (let i = 0; i < this.cascades.length; i++) {
      if (!this.shouldUpdateCascade(i, cameraMovement)) {
        prevSplit = this.cascades[i].split;
        continue;
      }

      this.updateCascadeFrustum(
        i,
        mainCamera,
        effectivePosition,
        prevSplit,
        this.cascades[i].split
      );
      prevSplit = this.cascades[i].split;
      this.cascadeDirty[i] = false;
    }
  }

  private updateCascadeFrustum(
    index: number,
    mainCamera: Camera,
    playerPosition: Vector3,
    nearSplit: number,
    farSplit: number
  ) {
    const cascade = this.cascades[index];
    const { lightMargin } = this.config;

    const center = new Vector3();
    const corners: Vector3[] = [];

    const near = nearSplit;
    const far = farSplit;

    const cameraDir = new Vector3();
    mainCamera.getWorldDirection(cameraDir);

    for (let x = -1; x <= 1; x += 2) {
      for (let y = -1; y <= 1; y += 2) {
        for (let z = 0; z <= 1; z++) {
          const t = z === 0 ? near : far;
          const corner = playerPosition.clone().addScaledVector(cameraDir, t);
          corner.x += x * t * 0.5;
          corner.y += y * t * 0.3;

          corners.push(corner);
          center.add(corner);
        }
      }
    }

    center.divideScalar(8);

    let radius = 0;
    for (const corner of corners) {
      radius = Math.max(radius, corner.distanceTo(center));
    }
    radius = Math.ceil(radius * 16) / 16;

    const up = new Vector3(0, 1, 0);
    if (Math.abs(this.lightDirection.dot(up)) > 0.999) {
      up.set(0, 0, 1);
    }

    cascade.camera.position
      .copy(center)
      .addScaledVector(this.lightDirection, radius + lightMargin);
    cascade.camera.lookAt(center);
    cascade.camera.up.copy(up);
    cascade.camera.updateMatrixWorld();

    cascade.camera.left = -radius;
    cascade.camera.right = radius;
    cascade.camera.top = radius;
    cascade.camera.bottom = -radius;
    cascade.camera.near = 0.1;
    cascade.camera.far = radius * 2 + lightMargin * 2;
    cascade.camera.updateProjectionMatrix();

    cascade.matrix.copy(cascade.camera.projectionMatrix);
    cascade.matrix.multiply(cascade.camera.matrixWorldInverse);
  }

  render(
    renderer: WebGLRenderer,
    scene: Scene,
    entities?: Object3D[],
    maxEntityShadowDistance = 32
  ) {
    const originalOverrideMaterial = scene.overrideMaterial;

    scene.overrideMaterial = this.depthMaterial;

    for (let i = 0; i < this.cascades.length; i++) {
      const cascade = this.cascades[i];

      renderer.setRenderTarget(cascade.renderTarget);
      renderer.clear();

      renderer.render(scene, cascade.camera);

      if (entities && i < 2) {
        const entitiesToRender = entities.filter((e) => {
          const dist = e.position.distanceTo(this.lastCameraPosition);
          return (
            dist < maxEntityShadowDistance && e.userData.castsShadow !== false
          );
        });

        for (const entity of entitiesToRender) {
          renderer.render(entity as unknown as Scene, cascade.camera);
        }
      }
    }

    scene.overrideMaterial = originalOverrideMaterial;
    renderer.setRenderTarget(null);
  }

  getUniforms(): {
    uShadowMaps: Texture[];
    uShadowMatrices: Matrix4[];
    uCascadeSplits: number[];
    uShadowBias: number;
    uNumCascades: number;
  } {
    return {
      uShadowMaps: this.cascades.map((c) => c.renderTarget.depthTexture),
      uShadowMatrices: this.cascades.map((c) => c.matrix),
      uCascadeSplits: this.cascades.map((c) => c.split),
      uShadowBias: this.config.shadowBias,
      uNumCascades: this.cascades.length,
    };
  }

  getShadowMap(index: number): Texture | null {
    return this.cascades[index]?.renderTarget.depthTexture ?? null;
  }

  getCascadeMatrix(index: number): Matrix4 | null {
    return this.cascades[index]?.matrix ?? null;
  }

  getCascadeSplit(index: number): number {
    return this.cascades[index]?.split ?? 0;
  }

  get numCascades(): number {
    return this.cascades.length;
  }

  get shadowBias(): number {
    return this.config.shadowBias;
  }

  dispose() {
    for (const cascade of this.cascades) {
      cascade.renderTarget.dispose();
      cascade.renderTarget.depthTexture?.dispose();
    }
    this.depthMaterial.dispose();
    this.cascades = [];
  }
}
