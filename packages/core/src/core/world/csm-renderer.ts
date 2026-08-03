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
  /**
   * Map size for cascades past the first. The far cascades cover tens of
   * times the near cascade's area, so their texel density per block is far
   * higher than it needs to be at the near cascade's resolution — and a far
   * cascade re-render's depth-write cost is what turns a shadow refresh
   * into a dropped frame at high display resolutions.
   */
  farShadowMapSize: number;
  /**
   * Shadow strength at or below which cascade re-renders are skipped
   * entirely. During the dusk handoff the light azimuth swings 180 degrees
   * from sun to moon while the same curve fades shadows to invisibility;
   * re-rendering every cascade to track a swing nobody can see is the
   * single most expensive thing the renderer does all day.
   */
  shadowStrengthRenderFloor: number;
  /**
   * Per-frame light-direction delta above which direction changes stop
   * marking cascades dirty. The day-cycle drift moves the light a few
   * hundred-thousandths of a radian per frame; the dusk sun-to-moon
   * handoff swings it thirty times faster, fast enough that shadows
   * re-rendered mid-swing are stale by the time they are sampled. The
   * skipped motion keeps accumulating against the dirty threshold, so the
   * first calm frame after a swing (or a time-command jump) still
   * refreshes every cascade at the settled direction.
   */
  maxLightSwingPerFrame: number;
  /**
   * Player movement (blocks per frame) below which the camera counts as
   * still. Control smoothing approaches its target asymptotically and
   * never lands bit-exactly, so an exact-equality stillness test never
   * fires; this floor sits well above that residue and well below any
   * motion a player could perceive.
   */
  stillCameraPositionEpsilon: number;
  /**
   * Max absolute per-element view-projection delta below which the camera
   * counts as still, catching rotation the positional test cannot see.
   */
  stillCameraMatrixEpsilon: number;
  maxShadowDistance: number;
  shadowBias: number;
  shadowNormalBias: number;
  shadowSlopeBiasScale: number;
  shadowSlopeBiasMin: number;
  shadowTopFaceBiasScale: number;
  shadowSideFaceBiasScale: number;
  isDepthPolygonOffsetEnabled: boolean;
  depthPolygonOffsetFactor: number;
  depthPolygonOffsetUnits: number;
  lightMargin: number;
  shadowCasterDistance: number;
  entityShadowFrameInterval: number;
}

interface Cascade {
  renderTarget: WebGLRenderTarget;
  camera: OrthographicCamera;
  matrix: Matrix4;
  split: number;
}

/**
 * Blocks from the player within which entities cast dynamic shadows. The
 * cascade entity refresh and the caller's decision of whether any entity is
 * worth a refresh at all must agree on this number, or entities outside it
 * trigger full cascade re-renders for shadows that are then distance-culled
 * before drawing.
 */
export const ENTITY_SHADOW_DISTANCE = 32;

const defaultConfig: CSMConfig = {
  cascades: 3,
  shadowMapSize: 2048,
  farShadowMapSize: 2048,
  shadowStrengthRenderFloor: 0.15,
  maxLightSwingPerFrame: 0.0001,
  stillCameraPositionEpsilon: 0.0005,
  stillCameraMatrixEpsilon: 0.0005,
  maxShadowDistance: 128,
  shadowBias: 0.00018,
  shadowNormalBias: 0.0015,
  shadowSlopeBiasScale: 0.0012,
  shadowSlopeBiasMin: 0.00012,
  shadowTopFaceBiasScale: 1.0,
  shadowSideFaceBiasScale: 1.0,
  isDepthPolygonOffsetEnabled: true,
  depthPolygonOffsetFactor: 1.0,
  depthPolygonOffsetUnits: 4.0,
  lightMargin: 32,
  shadowCasterDistance: 200,
  entityShadowFrameInterval: 3,
};

type VisibilitySnapshot = {
  object: Object3D;
  visible: boolean;
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
  private lastViewProjection = new Matrix4();
  private isCameraStill = false;
  private currentShadowStrength = 1;
  private lastFrameLightSwing = 0;
  private lastMainCamera: Camera | null = null;
  private cascadeDirty: boolean[] = [];
  private cascadeNeedsRender: boolean[] = [];
  private tempMatrix = new Matrix4();
  private tempVec3 = new Vector3();

  private skipShadowObjectsCache: Object3D[] = [];

  private cascadeFrustum = new Frustum();
  private cascadeMatrix = new Matrix4();
  private entityBatchScene = new Scene();
  private hiddenObjects: VisibilitySnapshot[] = [];
  private hiddenEntities: VisibilitySnapshot[] = [];
  private poolOriginalMaterials = new Map<
    Object3D,
    THREE.Material | THREE.Material[]
  >();
  private originalEntityParents = new Map<Object3D, Object3D | null>();

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
      polygonOffset: this.config.isDepthPolygonOffsetEnabled,
      polygonOffsetFactor: this.config.depthPolygonOffsetFactor,
      polygonOffsetUnits: this.config.depthPolygonOffsetUnits,
    });
    this.initCascades();
  }

  private initCascades() {
    const { cascades, shadowMapSize, farShadowMapSize, maxShadowDistance } =
      this.config;

    const lambda = 2.0;
    const splits: number[] = [];

    for (let i = 0; i <= cascades; i++) {
      const p = i / cascades;
      const log = Math.pow(p, lambda);
      splits.push(log * maxShadowDistance);
    }

    for (let i = 0; i < cascades; i++) {
      const size = i === 0 ? shadowMapSize : farShadowMapSize;

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

    // A cascade render redraws every caster in its frustum, so a frame where
    // neither the camera nor the light budged buys nothing from one. Chunk
    // remeshes and entity refreshes bypass this via markAllCascadesForRender
    // and markCascadesForEntityRender, which set needsRender directly.
    if (this.isCameraStill) {
      return false;
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

  update(
    mainCamera: Camera,
    sunDirection: Vector3,
    playerPosition?: Vector3,
    shadowStrength = 1,
  ) {
    this.frameCount++;

    const frameLightSwing = this.tempVec3
      .copy(sunDirection)
      .normalize()
      .sub(this.lightDirection)
      .length();
    this.lastFrameLightSwing = frameLightSwing;
    const isLightSwinging = frameLightSwing > this.config.maxLightSwingPerFrame;

    this.lightDirection.copy(sunDirection).normalize();
    this.currentShadowStrength = shadowStrength;

    const effectivePosition = playerPosition || mainCamera.position;

    // Faded shadows (the dusk dip) and a fast-swinging light (the dusk
    // sun-to-moon handoff, or a time-command jump) both make re-rendering
    // worthless: the result is invisible or stale on arrival.
    // lastLightDirection deliberately keeps accumulating through the skip,
    // so the first calm frame afterwards crosses the dirty threshold and
    // refreshes every cascade at the settled direction.
    const isShadowFaded =
      shadowStrength <= this.config.shadowStrengthRenderFloor;

    const lightDirChange = this.tempVec3
      .copy(this.lightDirection)
      .sub(this.lastLightDirection)
      .length();

    if (lightDirChange > 0.01 && !isShadowFaded && !isLightSwinging) {
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

    // Epsilon comparison on the view-projection: control smoothing keeps
    // nudging the camera by asymptotic residue long after input stops, so
    // exact equality never fires. The matrix delta catches rotation, which
    // the positional cameraMovement metric cannot see.
    const viewProjection = this.tempMatrix.elements;
    const lastViewProjection = this.lastViewProjection.elements;
    let isViewProjectionUnchanged = true;
    for (let i = 0; i < 16; i++) {
      if (
        Math.abs(viewProjection[i] - lastViewProjection[i]) >
        this.config.stillCameraMatrixEpsilon
      ) {
        isViewProjectionUnchanged = false;
        break;
      }
    }
    this.lastViewProjection.copy(this.tempMatrix);
    this.isCameraStill =
      isViewProjectionUnchanged &&
      cameraMovement < this.config.stillCameraPositionEpsilon;

    // Only the flags are decided here. The cascade frustum (and with it the
    // shadow matrix the shader samples through) is computed in render(),
    // immediately before the map it describes is drawn: a far cascade can be
    // deferred a frame by the one-far-cascade-per-frame cap, and a matrix
    // that moves a frame ahead of its map flashes the whole cascade band.
    this.lastMainCamera = mainCamera;
    for (let i = 0; i < this.cascades.length; i++) {
      if (!this.shouldUpdateCascade(i, cameraMovement)) {
        continue;
      }

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

  render(
    renderer: WebGLRenderer,
    scene: Scene,
    entities?: Object3D[],
    maxEntityShadowDistance = ENTITY_SHADOW_DISTANCE,
    instancePools?: Group[],
  ) {
    // Invisible shadows are not worth a depth pass; marked flags stay put
    // and drain when the strength comes back.
    if (this.currentShadowStrength <= this.config.shadowStrengthRenderFloor) {
      return;
    }

    const anyNeedsRender = this.cascadeNeedsRender.some((v) => v);
    if (!anyNeedsRender) {
      return;
    }

    const originalOverrideMaterial = scene.overrideMaterial;

    const hiddenObjects = this.hiddenObjects;
    hiddenObjects.length = 0;
    for (const object of this.skipShadowObjectsCache) {
      if (object.visible) {
        hiddenObjects.push({ object, visible: true });
        object.visible = false;
      }
    }

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

    const poolOriginalMaterials = this.poolOriginalMaterials;
    poolOriginalMaterials.clear();
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

    // At most one far cascade per frame: a sun step or a chunk remesh marks
    // all cascades at once, and redrawing every caster into two big shadow
    // maps in a single frame is exactly the double-length frame players feel
    // as a hitch. A deferred cascade keeps its needsRender flag and lands on
    // the next frame instead.
    let hasRenderedFarCascade = false;

    for (let i = 0; i < this.cascades.length; i++) {
      if (!this.cascadeNeedsRender[i]) {
        continue;
      }

      if (i > 0 && hasRenderedFarCascade) {
        continue;
      }

      const cascade = this.cascades[i];

      // Frustum and matrix update land here, atomically with the map they
      // describe — see the note in update().
      if (this.lastMainCamera) {
        this.updateCascadeFrustum(
          i,
          this.lastMainCamera,
          this.lastCameraPosition,
          i === 0 ? 0 : this.cascades[i - 1].split,
          cascade.split,
        );
      }

      this.cascadeMatrix
        .copy(cascade.camera.projectionMatrix)
        .multiply(cascade.camera.matrixWorldInverse);
      this.cascadeFrustum.setFromProjectionMatrix(this.cascadeMatrix);

      renderer.setRenderTarget(cascade.renderTarget);
      renderer.clear();

      const hiddenEntities = this.hiddenEntities;
      hiddenEntities.length = 0;
      if (i >= 2 && entities) {
        for (const entity of entities) {
          if (entity.visible) {
            hiddenEntities.push({ object: entity, visible: true });
            entity.visible = false;
          }
        }
      }
      if (i >= 2 && instancePools) {
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
          renderer.render(pool, cascade.camera);
        }
        scene.overrideMaterial = this.depthMaterial;
      }

      if (this.shouldRenderEntityShadows && entities && i < 2) {
        const maxDistSq = maxEntityShadowDistance * maxEntityShadowDistance;
        const originalParents = this.originalEntityParents;
        originalParents.clear();
        for (const entity of entities) {
          if (entity.userData.castsShadow === false) continue;
          const distSq = entity.position.distanceToSquared(
            this.lastCameraPosition,
          );
          if (distSq >= maxDistSq) continue;
          if (!this.cascadeFrustum.containsPoint(entity.position)) continue;
          originalParents.set(entity, entity.parent);
          this.entityBatchScene.add(entity);
        }
        if (this.entityBatchScene.children.length > 0) {
          this.entityBatchScene.overrideMaterial = this.depthMaterial;
          renderer.render(this.entityBatchScene, cascade.camera);
          this.entityBatchScene.overrideMaterial = null;
          for (const [entity, originalParent] of originalParents) {
            if (originalParent) {
              originalParent.add(entity);
            } else {
              this.entityBatchScene.remove(entity);
            }
          }
          this.entityBatchScene.children.length = 0;
          originalParents.clear();
        }
      }

      this.cascadeNeedsRender[i] = false;
      if (i > 0) {
        hasRenderedFarCascade = true;
      }
    }

    for (const [mesh, originalMaterial] of poolOriginalMaterials) {
      (mesh as THREE.Mesh).material = originalMaterial;
    }

    for (const { object, visible } of hiddenObjects) {
      object.visible = visible;
    }

    scene.overrideMaterial = originalOverrideMaterial;
    renderer.setRenderTarget(null);
  }

  private entityShadowFrameCounter = 0;
  private shouldRenderEntityShadows = false;

  markCascadesForEntityRender() {
    if (this.currentShadowStrength <= this.config.shadowStrengthRenderFloor) {
      this.shouldRenderEntityShadows = false;
      return;
    }
    this.entityShadowFrameCounter++;
    const frameInterval = Math.max(1, this.config.entityShadowFrameInterval);
    this.shouldRenderEntityShadows =
      this.entityShadowFrameCounter % frameInterval === 0;
    if (!this.shouldRenderEntityShadows) {
      return;
    }
    this.cascadeNeedsRender[0] = true;
  }

  getUniforms(): {
    uShadowMaps: Texture[];
    uShadowMatrices: Matrix4[];
    uCascadeSplits: number[];
    uShadowBias: number;
    uShadowNormalBias: number;
    uShadowSlopeBiasScale: number;
    uShadowSlopeBiasMin: number;
    uShadowTopFaceBiasScale: number;
    uShadowSideFaceBiasScale: number;
    uNumCascades: number;
  } {
    return {
      uShadowMaps: this.cascades.map((c) => c.renderTarget.depthTexture),
      uShadowMatrices: this.cascades.map((c) => c.matrix),
      uCascadeSplits: this.cascades.map((c) => c.split),
      uShadowBias: this.config.shadowBias,
      uShadowNormalBias: this.config.shadowNormalBias,
      uShadowSlopeBiasScale: this.config.shadowSlopeBiasScale,
      uShadowSlopeBiasMin: this.config.shadowSlopeBiasMin,
      uShadowTopFaceBiasScale: this.config.shadowTopFaceBiasScale,
      uShadowSideFaceBiasScale: this.config.shadowSideFaceBiasScale,
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

  getDebugState(): {
    isCameraStill: boolean;
    cascadeDirty: boolean[];
    cascadeNeedsRender: boolean[];
    currentShadowStrength: number;
    lastFrameLightSwing: number;
  } {
    return {
      isCameraStill: this.isCameraStill,
      cascadeDirty: [...this.cascadeDirty],
      cascadeNeedsRender: [...this.cascadeNeedsRender],
      currentShadowStrength: this.currentShadowStrength,
      lastFrameLightSwing: this.lastFrameLightSwing,
    };
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
