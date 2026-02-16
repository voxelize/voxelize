import * as THREE from "three";
import {
  Camera,
  DepthTexture,
  Frustum,
  Group,
  Matrix4,
  MeshDepthMaterial,
  Object3D,
  OrthographicCamera,
  RGBADepthPacking,
  Scene,
  Texture,
  UnsignedIntType,
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
  shadowCasterDistance: number;
}

interface Cascade {
  renderTarget: WebGLRenderTarget;
  camera: OrthographicCamera;
  matrix: Matrix4;
  split: number;
}

interface CSMUniforms {
  uShadowMaps: Texture[];
  uShadowMatrices: Matrix4[];
  uCascadeSplits: number[];
  uShadowBias: number;
  uNumCascades: number;
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
  private depthMaterial: MeshDepthMaterial;
  private frameCount = 0;
  private lastCameraPosition = new Vector3();
  private cascadeDirty: boolean[] = [];
  private cascadeNeedsRender: boolean[] = [];
  private tempMatrix = new Matrix4();
  private tempVec3 = new Vector3();

  private skipShadowObjectsCache: Object3D[] = [];
  private hiddenObjectsBuffer: Object3D[] = [];
  private hiddenEntitiesBuffer: Object3D[] = [];
  private reparentedEntitiesBuffer: Object3D[] = [];
  private reparentedParentsBuffer: Array<Object3D | null> = [];
  private poolOriginalMaterialMeshes: THREE.Mesh[] = [];
  private poolOriginalMaterials: Array<THREE.Material | THREE.Material[]> = [];

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
  private objectTraversalStack: Object3D[] = [];
  private cornerPool: Vector3[] = (() => {
    const corners = new Array<Vector3>(8);
    for (let index = 0; index < corners.length; index++) {
      corners[index] = new Vector3();
    }
    return corners;
  })();
  private uniforms: CSMUniforms = {
    uShadowMaps: [],
    uShadowMatrices: [],
    uCascadeSplits: [],
    uShadowBias: 0,
    uNumCascades: 0,
  };

  constructor(config: Partial<CSMConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
    this.uniforms.uShadowBias = this.config.shadowBias;

    this.depthMaterial = new MeshDepthMaterial({
      depthPacking: RGBADepthPacking,
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

      const renderTarget = new WebGLRenderTarget(size, size, {
        depthTexture: new DepthTexture(size, size),
      });
      renderTarget.depthTexture.type = UnsignedIntType;

      const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);

      this.cascades.push({
        renderTarget,
        camera,
        matrix: new Matrix4(),
        split: splits[i + 1],
      });
      const cascade = this.cascades[this.cascades.length - 1];
      this.uniforms.uShadowMaps.push(cascade.renderTarget.depthTexture);
      this.uniforms.uShadowMatrices.push(cascade.matrix);
      this.uniforms.uCascadeSplits.push(cascade.split);

      this.cascadeDirty.push(true);
      this.cascadeNeedsRender.push(true);
    }

    this.uniforms.uNumCascades = this.cascades.length;
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
    const objectTraversalStack = this.objectTraversalStack;
    objectTraversalStack.length = 0;
    objectTraversalStack.push(scene);

    while (objectTraversalStack.length > 0) {
      const object = objectTraversalStack.pop();
      if (!object) {
        continue;
      }
      if (
        "material" in object &&
        (object as { material: { userData?: { skipShadow?: boolean } } })
          .material?.userData?.skipShadow === true
      ) {
        this.skipShadowObjectsCache.push(object);
      }
      const children = object.children;
      for (let childIndex = 0; childIndex < children.length; childIndex++) {
        objectTraversalStack.push(children[childIndex]);
      }
    }
  }

  private hideEntitySkipShadowChildren(
    entity: Object3D,
    hiddenObjects: Object3D[]
  ) {
    const objectTraversalStack = this.objectTraversalStack;
    objectTraversalStack.length = 0;
    const entityChildren = entity.children;
    for (let childIndex = 0; childIndex < entityChildren.length; childIndex++) {
      objectTraversalStack.push(entityChildren[childIndex]);
    }

    while (objectTraversalStack.length > 0) {
      const child = objectTraversalStack.pop();
      if (!child) {
        continue;
      }

      if (
        child.visible &&
        "material" in child &&
        (child as { material: { userData?: { skipShadow?: boolean } } }).material
          ?.userData?.skipShadow === true
      ) {
        hiddenObjects.push(child);
        child.visible = false;
      }

      const children = child.children;
      for (let childIndex = 0; childIndex < children.length; childIndex++) {
        objectTraversalStack.push(children[childIndex]);
      }
    }
  }

  private applyPoolDepthMaterials(
    pool: Group,
    poolOriginalMaterialMeshes: THREE.Mesh[],
    poolOriginalMaterials: Array<THREE.Material | THREE.Material[]>
  ) {
    const objectTraversalStack = this.objectTraversalStack;
    objectTraversalStack.length = 0;
    objectTraversalStack.push(pool);

    while (objectTraversalStack.length > 0) {
      const child = objectTraversalStack.pop();
      if (!child) {
        continue;
      }

      if (child instanceof THREE.Mesh && child.customDepthMaterial) {
        poolOriginalMaterialMeshes.push(child);
        poolOriginalMaterials.push(child.material);
        child.material = child.customDepthMaterial;
      }

      const children = child.children;
      for (let childIndex = 0; childIndex < children.length; childIndex++) {
        objectTraversalStack.push(children[childIndex]);
      }
    }
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

    let radiusSq = 0;
    for (let i = 0; i < 8; i++) {
      const cornerRadiusSq = this.cornerPool[i].distanceToSquared(
        this.frustumCenter
      );
      if (cornerRadiusSq > radiusSq) {
        radiusSq = cornerRadiusSq;
      }
    }
    const radius = Math.ceil(Math.sqrt(radiusSq) * 16) / 16;

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
      const cache = this.skipShadowObjectsCache;
      const cacheLength = cache.length;
      if (cacheLength > 0) {
        if (cache[cacheLength - 1] === object) {
          return;
        }
        if (cacheLength <= 4) {
          for (let objectIndex = 0; objectIndex < cacheLength; objectIndex++) {
            if (cache[objectIndex] === object) {
              return;
            }
          }
        } else if (cache.includes(object)) {
          return;
        }
      }
      cache.push(object);
    }
  }

  removeSkipShadowObject(object: Object3D) {
    const cache = this.skipShadowObjectsCache;
    const cacheLength = cache.length;
    if (cacheLength === 0) {
      return;
    }
    const lastIndex = cacheLength - 1;
    if (cache[lastIndex] === object) {
      cache.pop();
      return;
    }
    if (cacheLength === 1) {
      return;
    }
    if (cacheLength === 2) {
      if (cache[0] === object) {
        cache.splice(0, 1);
      }
      return;
    }
    if (cacheLength === 3) {
      if (cache[0] === object) {
        cache.splice(0, 1);
      } else if (cache[1] === object) {
        cache.splice(1, 1);
      }
      return;
    }
    for (let objectIndex = 0; objectIndex < lastIndex; objectIndex++) {
      if (cache[objectIndex] === object) {
        cache.splice(objectIndex, 1);
        return;
      }
    }
  }

  render(
    renderer: WebGLRenderer,
    scene: Scene,
    entities?: Object3D[],
    maxEntityShadowDistance = 32,
    instancePools?: Group[]
  ) {
    let anyNeedsRender = false;
    for (
      let cascadeIndex = 0;
      cascadeIndex < this.cascadeNeedsRender.length;
      cascadeIndex++
    ) {
      if (this.cascadeNeedsRender[cascadeIndex]) {
        anyNeedsRender = true;
        break;
      }
    }
    if (!anyNeedsRender) {
      return;
    }

    const originalOverrideMaterial = scene.overrideMaterial;

    const hiddenObjects = this.hiddenObjectsBuffer;
    hiddenObjects.length = 0;
    for (
      let objectIndex = 0;
      objectIndex < this.skipShadowObjectsCache.length;
      objectIndex++
    ) {
      const object = this.skipShadowObjectsCache[objectIndex];
      if (object.visible) {
        hiddenObjects.push(object);
        object.visible = false;
      }
    }

    if (entities) {
      for (let entityIndex = 0; entityIndex < entities.length; entityIndex++) {
        this.hideEntitySkipShadowChildren(entities[entityIndex], hiddenObjects);
      }
    }

    const poolOriginalMaterialMeshes = this.poolOriginalMaterialMeshes;
    poolOriginalMaterialMeshes.length = 0;
    const poolOriginalMaterials = this.poolOriginalMaterials;
    poolOriginalMaterials.length = 0;
    if (this.shouldRenderEntityShadows && instancePools) {
      for (let poolIndex = 0; poolIndex < instancePools.length; poolIndex++) {
        this.applyPoolDepthMaterials(
          instancePools[poolIndex],
          poolOriginalMaterialMeshes,
          poolOriginalMaterials
        );
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

      const hiddenEntities = this.hiddenEntitiesBuffer;
      hiddenEntities.length = 0;
      if (i >= 2 && entities) {
        for (let entityIndex = 0; entityIndex < entities.length; entityIndex++) {
          const entity = entities[entityIndex];
          if (entity.visible) {
            hiddenEntities.push(entity);
            entity.visible = false;
          }
        }
      }
      if (i >= 2 && instancePools) {
        for (let poolIndex = 0; poolIndex < instancePools.length; poolIndex++) {
          const pool = instancePools[poolIndex];
          if (pool.visible) {
            hiddenEntities.push(pool);
            pool.visible = false;
          }
        }
      }

      renderer.render(scene, cascade.camera);

      for (let hiddenIndex = 0; hiddenIndex < hiddenEntities.length; hiddenIndex++) {
        hiddenEntities[hiddenIndex].visible = true;
      }

      if (
        this.shouldRenderEntityShadows &&
        instancePools &&
        instancePools.length > 0 &&
        i < 2
      ) {
        scene.overrideMaterial = null;
        for (let poolIndex = 0; poolIndex < instancePools.length; poolIndex++) {
          renderer.render(instancePools[poolIndex], cascade.camera);
        }
        scene.overrideMaterial = this.depthMaterial;
      }

      if (this.shouldRenderEntityShadows && entities && i < 2) {
        const maxDistSq = maxEntityShadowDistance * maxEntityShadowDistance;
        const reparentedEntities = this.reparentedEntitiesBuffer;
        const reparentedParents = this.reparentedParentsBuffer;
        reparentedEntities.length = 0;
        reparentedParents.length = 0;
        for (let entityIndex = 0; entityIndex < entities.length; entityIndex++) {
          const entity = entities[entityIndex];
          if (entity.userData.castsShadow === false) continue;
          const distSq = entity.position.distanceToSquared(
            this.lastCameraPosition
          );
          if (distSq >= maxDistSq) continue;
          if (!this.cascadeFrustum.containsPoint(entity.position)) continue;
          reparentedEntities.push(entity);
          reparentedParents.push(entity.parent);
          this.entityBatchGroup.add(entity);
        }
        if (this.entityBatchGroup.children.length > 0) {
          const batchWithOverrideMaterial = this.entityBatchGroup as Group & {
            overrideMaterial: THREE.Material | null;
          };
          batchWithOverrideMaterial.overrideMaterial = this.depthMaterial;
          renderer.render(this.entityBatchGroup, cascade.camera);
          batchWithOverrideMaterial.overrideMaterial = null;
          for (
            let reparentIndex = 0;
            reparentIndex < reparentedEntities.length;
            reparentIndex++
          ) {
            const entity = reparentedEntities[reparentIndex];
            const originalParent = reparentedParents[reparentIndex];
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

    for (
      let materialIndex = 0;
      materialIndex < poolOriginalMaterialMeshes.length;
      materialIndex++
    ) {
      poolOriginalMaterialMeshes[materialIndex].material =
        poolOriginalMaterials[materialIndex];
    }
    poolOriginalMaterialMeshes.length = 0;
    poolOriginalMaterials.length = 0;

    for (let hiddenIndex = 0; hiddenIndex < hiddenObjects.length; hiddenIndex++) {
      hiddenObjects[hiddenIndex].visible = true;
    }

    scene.overrideMaterial = originalOverrideMaterial;
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
  }

  getUniforms(): CSMUniforms {
    return this.uniforms;
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
    for (let cascadeIndex = 0; cascadeIndex < this.cascades.length; cascadeIndex++) {
      const cascade = this.cascades[cascadeIndex];
      cascade.renderTarget.dispose();
      cascade.renderTarget.depthTexture?.dispose();
    }
    this.depthMaterial.dispose();
    this.cascades = [];
    this.uniforms.uShadowMaps.length = 0;
    this.uniforms.uShadowMatrices.length = 0;
    this.uniforms.uCascadeSplits.length = 0;
    this.uniforms.uNumCascades = 0;
  }
}
