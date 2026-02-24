import * as THREE from "three";
import {
  Camera,
  DepthTexture,
  Frustum,
  LessEqualCompare,
  Group,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  OrthographicCamera,
  Scene,
  Texture,
  UnsignedIntType,
  Vector3,
  RenderTarget,
} from "three";
import type { Renderer } from "three/webgpu";

export interface CSMConfig {
  cascades: number;
  shadowMapSize: number;
  maxShadowDistance: number;
  shadowBias: number;
  shadowNormalBias: number;
  lightMargin: number;
  shadowCasterDistance: number;
}

type CoordinateSystemCamera = Camera & {
  coordinateSystem?: number;
};

interface Cascade {
  renderTarget: RenderTarget;
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
  shadowCasterDistance: 200,
};

export class CSMRenderer {
  private config: CSMConfig;
  private cascades: Cascade[] = [];
  private lightDirection = new Vector3(0, -1, 0.3).normalize();
  private lastLightDirection = new Vector3(0, -1, 0.3).normalize();
  private frustum = new Frustum();
  private depthMaterial: MeshBasicMaterial;
  private frameCount = 0;
  private lastCameraPosition = new Vector3();
  private cascadeDirty: boolean[] = [];
  private cascadeNeedsRender: boolean[] = [];
  private tempMatrix = new Matrix4();
  private tempVec3 = new Vector3();

  private skipShadowObjectsCache: Object3D[] = [];

  private cascadeFrustum = new Frustum();
  private cascadeMatrix = new Matrix4();
  private entityBatchGroup = new Group();

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

    this.depthMaterial = new MeshBasicMaterial({
      colorWrite: false,
      side: THREE.DoubleSide,
    });
    this.initCascades();
  }

  private initCascades() {
    const { cascades, shadowMapSize, maxShadowDistance } = this.config;

    const lambda = 2.0;
    const splits: number[] = [];

    for (let i = 0; i <= cascades; i++) {
      const p = i / cascades;
      const log = Math.pow(p, lambda);
      splits.push(log * maxShadowDistance);
    }

    for (let i = 0; i < cascades; i++) {
      const size = shadowMapSize;

      const depthTexture = new DepthTexture(size, size);
      depthTexture.type = UnsignedIntType;
      depthTexture.compareFunction = LessEqualCompare;
      const renderTarget = new RenderTarget(size, size, {
        depthTexture,
      });

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
      return true;
    }

    if (index === 1) {
      return cameraMovement > 1.5 || this.frameCount % 5 === 0;
    }

    return cameraMovement > 3.0 || this.frameCount % 10 === 0;
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
    const mainCameraWithCoordinateSystem = mainCamera as CoordinateSystemCamera;
    const mainCameraCoordinateSystem =
      mainCameraWithCoordinateSystem.coordinateSystem;
    let synchronizedCascadeCoordinateSystems = 0;
    if (mainCameraCoordinateSystem !== undefined) {
      for (const cascade of this.cascades) {
        const cascadeCamera = cascade.camera as CoordinateSystemCamera;
        if (cascadeCamera.coordinateSystem !== mainCameraCoordinateSystem) {
          cascadeCamera.coordinateSystem = mainCameraCoordinateSystem;
          synchronizedCascadeCoordinateSystems += 1;
        }
      }
      if (synchronizedCascadeCoordinateSystems > 0) {
        this.markAllCascadesDirty();
      }
    }

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
        this.cascades[i].split,
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
    farSplit: number,
  ) {
    const cascade = this.cascades[index];
    const { lightMargin } = this.config;

    this.frustumCenter.set(0, 0, 0);

    const far = farSplit;
    const yScale = 0.3 + 0.7 * (index / (this.cascades.length - 1));

    mainCamera.getWorldDirection(this.frustumCameraDir);

    let cornerIdx = 0;
    for (let x = -1; x <= 1; x += 2) {
      for (let y = -1; y <= 1; y += 2) {
        for (let z = -1; z <= 1; z += 2) {
          const corner = this.cornerPool[cornerIdx++];
          corner.copy(playerPosition);
          corner.x += x * far;
          corner.y += y * far * yScale;
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
        this.cornerPool[i].distanceTo(this.frustumCenter),
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
      this.frustumUp,
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

    const offset = radius + lightMargin;
    const casterDepth = Math.max(offset, this.config.shadowCasterDistance);

    cascade.camera.position
      .copy(this.frustumCenter)
      .addScaledVector(this.lightDirection, offset);
    cascade.camera.lookAt(this.frustumCenter);
    cascade.camera.up.copy(this.frustumUp);
    cascade.camera.updateMatrixWorld();

    cascade.camera.left = -radius;
    cascade.camera.right = radius;
    cascade.camera.top = radius;
    cascade.camera.bottom = -radius;
    cascade.camera.near = 0.1;
    cascade.camera.far = offset + casterDepth;
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

  private isMaterialMarkedSkipShadow(
    material: THREE.Material | THREE.Material[] | null | undefined,
  ): boolean {
    if (!material) {
      return false;
    }

    if (Array.isArray(material)) {
      return material.some((entry) => entry.userData?.skipShadow === true);
    }

    return material.userData?.skipShadow === true;
  }

  render(
    renderer: Renderer,
    scene: Scene,
    entities?: Object3D[],
    maxEntityShadowDistance = 32,
    instancePools?: Group[],
  ) {
    const anyNeedsRender = this.cascadeNeedsRender.some((v) => v);
    if (!anyNeedsRender) {
      return;
    }

    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    const originalOverrideMaterial = scene.overrideMaterial;

    const hiddenObjects: { object: Object3D; visible: boolean }[] = [];
    for (const object of this.skipShadowObjectsCache) {
      if (object.visible) {
        hiddenObjects.push({ object, visible: true });
        object.visible = false;
      }
    }
    const autoHiddenNegativeRenderOrderObjects: {
      object: Object3D;
      visible: boolean;
    }[] = [];
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.visible) {
        return;
      }

      if (object.userData?.isChunk === true) {
        return;
      }

      if (object.userData?.castsShadow === true) {
        return;
      }

      if (object.renderOrder < 0) {
        autoHiddenNegativeRenderOrderObjects.push({ object, visible: true });
        object.visible = false;
      }
    });

    if (entities) {
      for (const entity of entities) {
        entity.traverse((child) => {
          if (
            child !== entity &&
            child.visible &&
            "material" in child &&
            (child as { material: { userData?: { skipShadow?: boolean } } })
              .material?.userData?.skipShadow === true
          ) {
            hiddenObjects.push({ object: child, visible: true });
            child.visible = false;
          }
        });
      }
    }

    const poolOriginalMaterials: Map<
      Object3D,
      THREE.Material | THREE.Material[]
    > = new Map();
    if (this.shouldRenderEntityShadows && instancePools) {
      for (const pool of instancePools) {
        pool.traverse((child) => {
          if (child instanceof THREE.Mesh && child.customDepthMaterial) {
            poolOriginalMaterials.set(child, child.material);
            child.material = child.customDepthMaterial;
          }
        });
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

      const hiddenEntities: { object: Object3D; visible: boolean }[] = [];
      if (i >= 2 && entities) {
        for (const entity of entities) {
          if (entity.visible) {
            hiddenEntities.push({ object: entity, visible: true });
            entity.visible = false;
          }
        }
      }
      const shouldHideInstancePoolsDuringScenePass = Boolean(
        instancePools && (i >= 2 || (this.shouldRenderEntityShadows && i < 2)),
      );
      if (shouldHideInstancePoolsDuringScenePass && instancePools) {
        for (const pool of instancePools) {
          if (pool.visible) {
            hiddenEntities.push({ object: pool, visible: true });
            pool.visible = false;
          }
        }
      }

      renderer.render(scene, cascade.camera);

      for (const { object, visible } of hiddenEntities) {
        object.visible = visible;
      }

      if (
        this.shouldRenderEntityShadows &&
        instancePools &&
        instancePools.length > 0 &&
        i < 2
      ) {
        scene.overrideMaterial = null;
        for (const pool of instancePools) {
          renderer.render(pool as unknown as Scene, cascade.camera);
        }
        scene.overrideMaterial = this.depthMaterial;
      }

      if (this.shouldRenderEntityShadows && entities && i < 2) {
        const maxDistSq = maxEntityShadowDistance * maxEntityShadowDistance;
        const originalParents: Map<Object3D, Object3D | null> = new Map();
        const entityWorldPosition = new Vector3();
        for (const entity of entities) {
          if (!entity.visible) {
            continue;
          }
          if (entity.userData.castsShadow === false) {
            continue;
          }

          entity.getWorldPosition(entityWorldPosition);
          const localDistSq = entity.position.distanceToSquared(
            this.lastCameraPosition,
          );
          const localWithinDistance = localDistSq < maxDistSq;
          const localInsideFrustum = this.cascadeFrustum.containsPoint(
            entity.position,
          );
          if (!localWithinDistance) {
            continue;
          }
          if (!localInsideFrustum) {
            continue;
          }

          entity.updateMatrixWorld(true);
          originalParents.set(entity, entity.parent);
          this.entityBatchGroup.add(entity);
          this.entityBatchGroup.updateMatrixWorld(true);
          entity.updateMatrixWorld(true);
        }
        if (this.entityBatchGroup.children.length > 0) {
          const batchAsScene = this.entityBatchGroup as unknown as Scene;
          batchAsScene.overrideMaterial = this.depthMaterial;
          renderer.render(batchAsScene, cascade.camera);
          batchAsScene.overrideMaterial = null;
          for (const [entity, originalParent] of originalParents) {
            if (originalParent) {
              originalParent.add(entity);
            } else {
              this.entityBatchGroup.remove(entity);
            }
          }
          this.entityBatchGroup.children.length = 0;
        }
      }

      this.cascadeNeedsRender[i] = false;
    }

    for (const [mesh, originalMaterial] of poolOriginalMaterials) {
      (mesh as THREE.Mesh).material = originalMaterial;
    }

    for (const { object, visible } of hiddenObjects) {
      object.visible = visible;
    }
    for (const { object, visible } of autoHiddenNegativeRenderOrderObjects) {
      object.visible = visible;
    }

    scene.overrideMaterial = originalOverrideMaterial;
    renderer.autoClear = previousAutoClear;
    renderer.setRenderTarget(null);
  }

  private entityShadowFrameCounter = 0;
  private shouldRenderEntityShadows = false;

  markCascadesForEntityRender() {
    this.entityShadowFrameCounter++;
    this.shouldRenderEntityShadows = this.entityShadowFrameCounter % 1 === 0;
    if (!this.shouldRenderEntityShadows) {
      return;
    }
    this.cascadeNeedsRender[0] = true;
    this.cascadeNeedsRender[1] = true;
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
