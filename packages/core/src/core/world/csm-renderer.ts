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
  private cascadeNeedsRender: boolean[] = [];
  private tempMatrix = new Matrix4();
  private tempVec3 = new Vector3();

  private skipShadowObjectsCache: Object3D[] = [];

  private cascadeFrustum = new Frustum();
  private cascadeMatrix = new Matrix4();

  private frustumCenter = new Vector3();
  private frustumCameraDir = new Vector3();
  private frustumUp = new Vector3();
  private lightViewMatrix = new Matrix4();
  private lightViewMatrixInverse = new Matrix4();
  private lightSpaceCenter = new Vector3();
  private tempLookAtTarget = new Vector3();
  private cornerPool: Vector3[] = Array(8)
    .fill(null)
    .map(() => new Vector3());

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
      this.cascadeNeedsRender.push(true);
    }
  }

  setLightDirection(direction: Vector3) {
    this.lightDirection.copy(direction).normalize();
    this.markAllCascadesDirty();
  }

  private markAllCascadesDirty() {
    for (let i = 0; i < this.cascadeDirty.length; i++) {
      this.cascadeDirty[i] = true;
      this.cascadeNeedsRender[i] = true;
    }
  }

  markAllCascadesForRender() {
    for (let i = 0; i < this.cascadeNeedsRender.length; i++) {
      this.cascadeNeedsRender[i] = true;
    }
  }

  private shouldUpdateCascade(index: number, cameraMovement: number): boolean {
    if (this.cascadeDirty[index]) {
      return true;
    }

    if (index === 0) {
      return cameraMovement > 0.5;
    }

    if (index === 1) {
      return cameraMovement > 2.0 || this.frameCount % 3 === 0;
    }

    return cameraMovement > 4.0 || this.frameCount % 6 === 0;
  }

  rebuildSkipShadowCache(scene: Scene) {
    this.skipShadowObjectsCache = [];
    scene.traverse((object) => {
      if (
        "material" in object &&
        (object as { material: { userData?: { skipShadow?: boolean } } })
          .material?.userData?.skipShadow === true
      ) {
        this.skipShadowObjectsCache.push(object);
      }
    });
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
      this.cascadeNeedsRender[i] = true;
    }
  }

  private updateCascadeFrustum(
    index: number,
    mainCamera: Camera,
    playerPosition: Vector3,
    _nearSplit: number,
    farSplit: number
  ) {
    const cascade = this.cascades[index];
    const { lightMargin } = this.config;

    this.frustumCenter.set(0, 0, 0);

    const far = farSplit;

    mainCamera.getWorldDirection(this.frustumCameraDir);

    let cornerIdx = 0;
    for (let x = -1; x <= 1; x += 2) {
      for (let y = -1; y <= 1; y += 2) {
        for (let z = -1; z <= 1; z += 2) {
          const corner = this.cornerPool[cornerIdx++];
          corner.copy(playerPosition);
          corner.x += x * far;
          corner.y += y * far * 0.3;
          corner.z += z * far;
          this.frustumCenter.add(corner);
        }
      }
    }

    this.frustumCenter.divideScalar(8);

    let radius = 0;
    for (let i = 0; i < 8; i++) {
      radius = Math.max(
        radius,
        this.cornerPool[i].distanceTo(this.frustumCenter)
      );
    }
    radius = Math.ceil(radius * 16) / 16;

    this.frustumUp.set(0, 1, 0);
    if (Math.abs(this.lightDirection.dot(this.frustumUp)) > 0.999) {
      this.frustumUp.set(0, 0, 1);
    }

    const shadowMapSize = cascade.renderTarget.width;
    const texelSize = (2 * radius) / shadowMapSize;

    this.tempLookAtTarget.addVectors(this.frustumCenter, this.lightDirection);
    this.lightViewMatrix.lookAt(
      this.tempLookAtTarget,
      this.frustumCenter,
      this.frustumUp
    );
    this.lightSpaceCenter
      .copy(this.frustumCenter)
      .applyMatrix4(this.lightViewMatrix);
    this.lightSpaceCenter.x =
      Math.floor(this.lightSpaceCenter.x / texelSize) * texelSize;
    this.lightSpaceCenter.y =
      Math.floor(this.lightSpaceCenter.y / texelSize) * texelSize;
    this.lightViewMatrixInverse.copy(this.lightViewMatrix).invert();
    this.frustumCenter
      .copy(this.lightSpaceCenter)
      .applyMatrix4(this.lightViewMatrixInverse);

    cascade.camera.position
      .copy(this.frustumCenter)
      .addScaledVector(this.lightDirection, radius + lightMargin);
    cascade.camera.lookAt(this.frustumCenter);
    cascade.camera.up.copy(this.frustumUp);
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

  addSkipShadowObject(object: Object3D) {
    if (
      "material" in object &&
      (object as { material: { userData?: { skipShadow?: boolean } } }).material
        ?.userData?.skipShadow === true
    ) {
      this.skipShadowObjectsCache.push(object);
    }
  }

  removeSkipShadowObject(object: Object3D) {
    const idx = this.skipShadowObjectsCache.indexOf(object);
    if (idx !== -1) {
      this.skipShadowObjectsCache.splice(idx, 1);
    }
  }

  render(
    renderer: WebGLRenderer,
    scene: Scene,
    entities?: Object3D[],
    maxEntityShadowDistance = 32
  ) {
    const anyNeedsRender = this.cascadeNeedsRender.some((v) => v);
    if (!anyNeedsRender) {
      return;
    }

    const originalOverrideMaterial = scene.overrideMaterial;

    const hiddenObjects: { object: Object3D; visible: boolean }[] = [];
    for (const object of this.skipShadowObjectsCache) {
      if (object.visible) {
        hiddenObjects.push({ object, visible: true });
        object.visible = false;
      }
    }

    scene.overrideMaterial = this.depthMaterial;

    for (let i = 0; i < this.cascades.length; i++) {
      if (!this.cascadeNeedsRender[i]) {
        continue;
      }

      const cascade = this.cascades[i];

      this.cascadeMatrix
        .copy(cascade.camera.projectionMatrix)
        .multiply(cascade.camera.matrixWorldInverse);
      this.cascadeFrustum.setFromProjectionMatrix(this.cascadeMatrix);

      renderer.setRenderTarget(cascade.renderTarget);
      renderer.clear();

      renderer.render(scene, cascade.camera);

      if (entities && i < 2) {
        const maxDistSq = maxEntityShadowDistance * maxEntityShadowDistance;
        for (const entity of entities) {
          if (entity.userData.castsShadow === false) continue;
          const distSq = entity.position.distanceToSquared(
            this.lastCameraPosition
          );
          if (distSq >= maxDistSq) continue;
          if (!this.cascadeFrustum.containsPoint(entity.position)) continue;
          renderer.render(entity as unknown as Scene, cascade.camera);
        }
      }

      this.cascadeNeedsRender[i] = false;
    }

    for (const { object, visible } of hiddenObjects) {
      object.visible = visible;
    }

    scene.overrideMaterial = originalOverrideMaterial;
    renderer.setRenderTarget(null);
  }

  markCascadesForEntityRender() {
    this.cascadeNeedsRender[0] = true;
    if (this.cascadeNeedsRender.length > 1) {
      this.cascadeNeedsRender[1] = true;
    }
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
