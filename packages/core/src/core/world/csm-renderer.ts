import * as THREE from "three";
import {
  Box3,
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

import { boundsIntersectSphere } from "./dynamic-caster-bounds";

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

/**
 * Margin added when testing a pool's instance-origin bounds against the
 * entity shadow sphere: a creature's silhouette reaches past its origin by
 * up to its body radius, and bounds fold origins only.
 */
const ENTITY_CASTER_BODY_RADIUS = 1.6;

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

/**
 * The slice of the shared shadow ledger CSM consults. Injected rather than
 * imported so the CSM renderer stays constructible without the local-light
 * system (and byte-identical in behavior when no ledger is attached).
 */
export interface CSMShadowLedger {
  chargeCsmNear(units: number): void;
  requestCsmFar(units: number): boolean;
}

export class CSMRenderer {
  private config: CSMConfig;
  private cascades: Cascade[] = [];
  private lightDirection = new Vector3(0, -1, 0.3).normalize();
  private lastLightDirection = new Vector3(0, -1, 0.3).normalize();
  // The direction maps are actually drawn with: the live direction drifts a
  // few hundred-thousandths of a radian every frame, and fitting cascades to
  // it would make every fit unique — no fit could ever be skipped as
  // unchanged. Maps instead hold the last *accepted* direction and step when
  // the accumulated drift crosses the dirty threshold, which is the cadence
  // stationary cameras have always seen.
  private renderLightDirection = new Vector3(0, -1, 0.3).normalize();
  private frustum = new Frustum();
  private depthMaterial: MeshDepthMaterial;
  private lastCameraPosition = new Vector3();
  private lastViewProjection = new Matrix4();
  private isCameraStill = false;
  private currentShadowStrength = 1;
  private lastFrameLightSwing = 0;
  private lastMainCamera: Camera | null = null;
  private cascadeDirty: boolean[] = [];
  private cascadeNeedsRender: boolean[] = [];
  private cascadeGeometryStale: boolean[] = [];
  private tempMatrix = new Matrix4();
  private tempVec3 = new Vector3();

  private skipShadowObjectsCache: Object3D[] = [];

  private ledger: CSMShadowLedger | null = null;
  private ledgerNearUnits = 4;
  private ledgerFarUnits = 6;

  private cascadeFrustum = new Frustum();
  private cascadeMatrix = new Matrix4();
  private entityBatchScene = new Scene();
  private hiddenObjects: VisibilitySnapshot[] = [];
  private hiddenEntities: VisibilitySnapshot[] = [];
  private activePoolsScratch: Group[] = [];
  private poolOriginalMaterials = new Map<
    Object3D,
    THREE.Material | THREE.Material[]
  >();
  private originalEntityParents = new Map<Object3D, Object3D | null>();

  private frustumCenter = new Vector3();
  private frustumUp = new Vector3();
  private lightViewMatrix = new Matrix4();
  private lightViewMatrixInverse = new Matrix4();
  private lightSpaceCenter = new Vector3();
  private tempLookAtTarget = new Vector3();
  private cornerPool: Vector3[] = Array(8)
    .fill(null)
    .map(() => new Vector3());
  // Scratch camera the candidate fit is computed on. The real cascade camera
  // and matrix are only written once a draw is committed: a matrix that moves
  // a frame ahead of its map flashes the whole cascade band, and a fit that
  // turns out identical should leave no trace at all.
  private fitCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  private fitMatrix = new Matrix4();

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
      this.cascadeGeometryStale.push(true);
    }
  }

  setLightDirection(direction: Vector3) {
    this.lightDirection.copy(direction).normalize();
    this.renderLightDirection.copy(this.lightDirection);
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

  /**
   * Share the per-frame shadow budget with the local light atlas. The near
   * cascade is priority 1 and only *records* its spend; far cascades ask for
   * a grant where the hard-coded one-far-per-frame rule used to be the only
   * throttle. With no ledger attached (or no local lights active — the
   * ledger grants unconditionally then), behavior is exactly today's.
   */
  attachShadowLedger(
    ledger: CSMShadowLedger | null,
    nearUnits = 4,
    farUnits = 6,
  ) {
    this.ledger = ledger;
    this.ledgerNearUnits = nearUnits;
    this.ledgerFarUnits = farUnits;
  }

  /**
   * The `skipShadow`-flagged objects every depth consumer must hide. The
   * local shadow atlas hides the same list, so casters can never disagree
   * between the sun's maps and a torch's.
   */
  get skipShadowObjects(): readonly Object3D[] {
    return this.skipShadowObjectsCache;
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
      this.renderLightDirection.copy(this.lightDirection);
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

    // Only the flags are decided here; render() decides the draws. A dirty
    // cascade (light step) must redraw whatever else happens. Camera motion
    // only makes a cascade's *fit* suspect — the fit is player-anchored and
    // texel-snapped, so rotation and sub-texel movement land on a bitwise
    // identical matrix, and render() skips the redraw after checking rather
    // than paying for a full caster pass on every mouse twitch.
    this.lastMainCamera = mainCamera;
    for (let i = 0; i < this.cascades.length; i++) {
      if (this.cascadeDirty[i]) {
        this.cascadeDirty[i] = false;
        this.cascadeNeedsRender[i] = true;
      }
      if (!this.isCameraStill) {
        this.cascadeGeometryStale[i] = true;
      }
    }
  }

  /**
   * Computes the cascade's candidate fit on the scratch camera and reports
   * whether the resulting shadow matrix differs from the one the map was
   * last drawn with. Nothing on the cascade is touched: the caller applies
   * the fit only together with the draw it belongs to.
   *
   * The fit reads only the player position, the accepted light direction,
   * and per-cascade constants, and the light-space centre snaps to the
   * texel grid — so rotation and sub-texel movement reproduce the previous
   * matrix bit for bit, and the comparison can be exact.
   */
  private fitCascade(index: number, playerPosition: Vector3): boolean {
    const cascade = this.cascades[index];
    const { lightMargin } = this.config;

    this.frustumCenter.set(0, 0, 0);

    const far = cascade.split;
    const yScale = 0.3 + 0.7 * (index / (this.cascades.length - 1));

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
    if (Math.abs(this.renderLightDirection.dot(this.frustumUp)) > 0.999) {
      this.frustumUp.set(0, 0, 1);
    }

    const shadowMapSize = cascade.renderTarget.width;
    const texelSize = (2 * radius) / shadowMapSize;

    this.tempLookAtTarget.addVectors(
      this.frustumCenter,
      this.renderLightDirection,
    );
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

    const camera = this.fitCamera;
    camera.position
      .copy(this.frustumCenter)
      .addScaledVector(this.renderLightDirection, offset);
    camera.up.copy(this.frustumUp);
    camera.lookAt(this.frustumCenter);
    camera.updateMatrixWorld();

    camera.left = -radius;
    camera.right = radius;
    camera.top = radius;
    camera.bottom = -radius;
    camera.near = 0.1;
    camera.far = offset + casterDepth;
    camera.updateProjectionMatrix();

    this.fitMatrix.copy(camera.projectionMatrix);
    this.fitMatrix.multiply(camera.matrixWorldInverse);

    return !this.fitMatrix.equals(cascade.matrix);
  }

  private applyCascadeFit(index: number) {
    const cascade = this.cascades[index];
    cascade.camera.copy(this.fitCamera);
    cascade.matrix.copy(this.fitMatrix);
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
    poolBounds?: readonly (Box3 | null)[],
  ) {
    // Invisible shadows are not worth a depth pass; marked flags stay put
    // and drain when the strength comes back.
    if (this.currentShadowStrength <= this.config.shadowStrengthRenderFloor) {
      return;
    }

    // Entity shadows are distance-culled per entity; pools were not, so a
    // roster of dozens of pool groups rendered into both near cascades even
    // when every creature stood beyond the entity shadow distance. Bounds
    // (folded from live instance positions) restore the same rule per pool.
    const activePools = this.activePoolsScratch;
    activePools.length = 0;
    if (instancePools && instancePools.length > 0) {
      for (let p = 0; p < instancePools.length; p++) {
        const bounds = poolBounds?.[p];
        if (
          bounds &&
          !boundsIntersectSphere(
            bounds,
            this.lastCameraPosition.x,
            this.lastCameraPosition.y,
            this.lastCameraPosition.z,
            maxEntityShadowDistance,
            ENTITY_CASTER_BODY_RADIUS,
          )
        ) {
          continue;
        }
        activePools.push(instancePools[p]);
      }
    }

    // Resolve suspect fits before any scene bookkeeping: rotation and
    // sub-texel movement land on the exact matrix each map was already drawn
    // with, and if nothing owes a draw the preamble (hiding skip-shadow
    // casters, traversing entities) is not worth paying either.
    for (let i = 0; i < this.cascades.length; i++) {
      if (!this.cascadeGeometryStale[i]) {
        continue;
      }
      this.cascadeGeometryStale[i] = false;
      if (this.cascadeNeedsRender[i] || !this.lastMainCamera) {
        continue;
      }
      if (this.fitCascade(i, this.lastCameraPosition)) {
        this.cascadeNeedsRender[i] = true;
      }
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
    if (this.shouldRenderEntityShadows && activePools.length > 0) {
      for (const pool of activePools) {
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

      // The ledger can defer a far cascade a frame when local shadow faces
      // reserved the budget; needsRender stays set so it lands on the next.
      // Near cascades never ask — they are the ledger's priority 1.
      if (
        i > 0 &&
        this.ledger &&
        !this.ledger.requestCsmFar(this.ledgerFarUnits)
      ) {
        continue;
      }
      if (i === 0) {
        this.ledger?.chargeCsmNear(this.ledgerNearUnits);
      }

      const cascade = this.cascades[i];

      // The fit lands here, atomically with the map it describes — a matrix
      // that moves a frame ahead of its map flashes the whole cascade band.
      // Recomputed rather than cached from the resolve pass above: the fit
      // scratch holds one cascade at a time, and the computation is a few
      // dozen vector operations against a full caster draw.
      if (this.lastMainCamera) {
        this.fitCascade(i, this.lastCameraPosition);
        this.applyCascadeFit(i);
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

      if (this.shouldRenderEntityShadows && activePools.length > 0 && i < 2) {
        scene.overrideMaterial = null;
        for (const pool of activePools) {
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
