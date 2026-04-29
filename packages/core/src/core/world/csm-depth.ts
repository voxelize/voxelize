import {
  Camera,
  CoordinateSystem,
  HalfFloatType,
  Material,
  Matrix4,
  Mesh,
  NearestFilter,
  Object3D,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  Sprite,
  Texture,
  Vector3,
  WebGLRenderTarget,
  WebGPUCoordinateSystem,
} from "three";
import {
  cameraProjectionMatrix,
  div,
  mul,
  positionView,
  vec4,
} from "three/tsl";
import {
  MeshBasicNodeMaterial,
  NodeMaterial,
  WebGPURenderer,
} from "three/webgpu";

export interface CSMDepthConfig {
  cascades: number;
  shadowMapSize: number;
  cascadeShadowMapSizes?: readonly [number, number, number];
  maxShadowDistance: number;
  lightMargin: number;
  shadowCasterDistance: number;
  shadowBias: number;
  middleCascadeMovementThreshold: number;
  middleCascadeFrameInterval: number;
  farCascadeMovementThreshold: number;
  farCascadeFrameInterval: number;
  // Peak strength (1 = full occlusion) when the caster is high in the sky.
  dayShadowStrength: number;
  // Peak strength when the moon is the caster (sun below horizon, moon above).
  nightShadowStrength: number;
  // Floor on the sin(altitude) of whichever celestial body is currently
  // casting. Below this we'd see infinitely-stretched horizon shadows, so we
  // clamp the depth-camera direction to look slightly downward instead.
  minElevation: number;
  // Below `lowElevationFadeStart` we begin fading shadow strength to avoid
  // long, smeared shadows near the horizon. At `lowElevationFadeEnd` strength
  // is zero. Both are sin(altitude) values in [0, 1].
  lowElevationFadeStart: number;
  lowElevationFadeEnd: number;
}

const defaultConfig: CSMDepthConfig = {
  cascades: 3,
  shadowMapSize: 2048,
  maxShadowDistance: 128,
  lightMargin: 32,
  shadowCasterDistance: 200,
  shadowBias: 0.0005,
  middleCascadeMovementThreshold: 1.5,
  middleCascadeFrameInterval: 8,
  farCascadeMovementThreshold: 3,
  farCascadeFrameInterval: 16,
  dayShadowStrength: 0.55,
  nightShadowStrength: 0.3,
  minElevation: 0.2,
  lowElevationFadeStart: 0.35,
  lowElevationFadeEnd: 0.05,
};

export type CSMRenderTarget = WebGPURenderer;

interface Cascade {
  renderTarget: WebGLRenderTarget;
  camera: OrthographicCamera;
  matrix: Matrix4;
  split: number;
}

// The packed depth value is raw `clip.z / clip.w`, matching the TSL receiver's
// comparison against the same shadow matrix.
function createDepthPackingNodeMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  const viewPos = vec4(positionView.x, positionView.y, positionView.z, 1);
  const clip = mul(cameraProjectionMatrix, viewPos);
  const ndcZ = div(clip.z, clip.w);
  material.colorNode = vec4(ndcZ, 0, 0, 1);
  material.depthWrite = true;
  material.depthTest = true;
  return material;
}

function isShadowSkippedMaterial(material: Material): boolean {
  if (material.userData && material.userData.skipShadow === true) return true;
  // Transparent surfaces (alpha-blended overlays, hit/light effects, glass,
  // alpha-tested foliage) would write opaque silhouettes through the basic
  // depth material, producing rectangle/straight-line artifacts. Until we
  // implement an alpha-aware depth path, exclude them entirely.
  if (material.transparent === true) return true;
  return false;
}

function getObjectMaterial(
  object: Object3D,
): Material | Material[] | undefined {
  if (!("material" in object)) return undefined;
  return (object as Object3D & { material?: Material | Material[] }).material;
}

function hasSkipShadowMaterial(material: Material | Material[]): boolean {
  if (Array.isArray(material)) {
    return material.some((entry) => entry.userData?.skipShadow === true);
  }
  return material.userData?.skipShadow === true;
}

function shouldSkipNonMeshCaster(object: Object3D): boolean {
  if (object instanceof Mesh) return false;
  if (object instanceof Sprite) return true;
  const material = getObjectMaterial(object);
  return material !== undefined && hasSkipShadowMaterial(material);
}

function shouldSkipBasicCaster(mesh: Mesh): boolean {
  const mat = mesh.material;
  if (!mat) return false;
  if (Array.isArray(mat)) {
    return mat.length > 0 && mat.every(isShadowSkippedMaterial);
  }
  return isShadowSkippedMaterial(mat);
}

export class WebGPUCSMDepthPass {
  private config: CSMDepthConfig;
  private cascades: Cascade[] = [];
  private depthMaterial: Material;
  private lightDirection = new Vector3(0, -1, 0).normalize();
  private lastLightDirection = new Vector3(0, -1, 0).normalize();
  private lastCameraPosition = new Vector3();
  private frameCount = 0;
  private cascadeDirty: boolean[] = [];
  private cascadeNeedsRender: boolean[] = [];
  private tempVec3 = new Vector3();

  private frustumCenter = new Vector3();
  private frustumUp = new Vector3();
  private lightViewMatrix = new Matrix4();
  private lightViewMatrixInverse = new Matrix4();
  private lightSpaceCenter = new Vector3();
  private tempLookAtTarget = new Vector3();
  private cornerPool: Vector3[] = Array(8)
    .fill(null)
    .map(() => new Vector3());

  private _coordinateSystem: CoordinateSystem = WebGPUCoordinateSystem;

  // Monotonic counter incremented every time the depth pass renders. Tests
  // and tooling read this to verify the WebGPU CSM path is actually running
  // rather than relying on screenshot inspection alone.
  public renderCount = 0;
  public lastRenderAt = 0;

  constructor(config: Partial<CSMDepthConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
    if (this.config.cascades !== 3) {
      throw new Error("WebGPUCSMDepthPass requires exactly 3 cascades");
    }
    this.depthMaterial = createDepthPackingNodeMaterial();
    this.initCascades();
  }

  private initCascades(): void {
    const {
      cascades,
      shadowMapSize,
      cascadeShadowMapSizes,
      maxShadowDistance,
    } = this.config;
    const lambda = 2.0;
    const splits: number[] = [];

    for (let i = 0; i <= cascades; i++) {
      const p = i / cascades;
      const log = Math.pow(p, lambda);
      splits.push(log * maxShadowDistance);
    }

    for (let i = 0; i < cascades; i++) {
      const cascadeShadowMapSize = cascadeShadowMapSizes?.[i] ?? shadowMapSize;
      const renderTarget = new WebGLRenderTarget(
        cascadeShadowMapSize,
        cascadeShadowMapSize,
        {
          depthBuffer: true,
          stencilBuffer: false,
          format: RGBAFormat,
          type: HalfFloatType,
          minFilter: NearestFilter,
          magFilter: NearestFilter,
        },
      );
      renderTarget.texture.name = `WebGPUCSMDepthPass.depth.${i}`;

      const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
      camera.coordinateSystem = this._coordinateSystem;

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

  get coordinateSystem(): CoordinateSystem {
    return this._coordinateSystem;
  }

  setCoordinateSystem(system: CoordinateSystem): void {
    if (system !== WebGPUCoordinateSystem) {
      return;
    }
    this._coordinateSystem = system;
    for (const cascade of this.cascades) {
      cascade.camera.coordinateSystem = system;
    }
  }

  private markAllCascadesDirty(): void {
    for (let i = 0; i < this.cascadeDirty.length; i++) {
      this.cascadeDirty[i] = true;
      this.cascadeNeedsRender[i] = true;
    }
  }

  markAllCascadesForRender(): void {
    for (let i = 0; i < this.cascadeNeedsRender.length; i++) {
      this.cascadeNeedsRender[i] = true;
    }
  }

  private shouldUpdateCascade(index: number, cameraMovement: number): boolean {
    if (this.cascadeDirty[index]) return true;
    if (index === 0) return true;
    if (index === 1) {
      return (
        cameraMovement > this.config.middleCascadeMovementThreshold ||
        this.frameCount % this.config.middleCascadeFrameInterval === 0
      );
    }
    return (
      cameraMovement > this.config.farCascadeMovementThreshold ||
      this.frameCount % this.config.farCascadeFrameInterval === 0
    );
  }

  update(mainCamera: Camera, sunDirection: Vector3, focus: Vector3): void {
    this.frameCount++;
    this.lightDirection.copy(sunDirection).normalize();

    const lightDirChange = this.tempVec3
      .copy(this.lightDirection)
      .sub(this.lastLightDirection)
      .length();
    if (lightDirChange > 0.01) {
      this.markAllCascadesDirty();
      this.lastLightDirection.copy(this.lightDirection);
    }

    const cameraMovement = this.tempVec3
      .copy(focus)
      .sub(this.lastCameraPosition)
      .length();
    this.lastCameraPosition.copy(focus);

    mainCamera.updateMatrixWorld();

    for (let i = 0; i < this.cascades.length; i++) {
      const cascade = this.cascades[i];
      if (!cascade) continue;

      if (!this.shouldUpdateCascade(i, cameraMovement)) {
        continue;
      }

      this.updateCascadeFrustum(i, mainCamera, focus, cascade.split);
      this.cascadeDirty[i] = false;
      this.cascadeNeedsRender[i] = true;
    }
  }

  private updateCascadeFrustum(
    index: number,
    mainCamera: Camera,
    focus: Vector3,
    farSplit: number,
  ): void {
    const cascade = this.cascades[index];
    if (!cascade) return;

    const { lightMargin, shadowCasterDistance } = this.config;
    this.frustumCenter.set(0, 0, 0);

    const yScale = 0.3 + 0.7 * (index / Math.max(1, this.cascades.length - 1));

    let cornerIndex = 0;
    for (let x = -1; x <= 1; x += 2) {
      for (let y = -1; y <= 1; y += 2) {
        for (let z = -1; z <= 1; z += 2) {
          const corner = this.cornerPool[cornerIndex++];
          if (!corner) continue;
          corner.copy(focus);
          corner.x += x * farSplit;
          corner.y += y * farSplit * yScale;
          corner.z += z * farSplit;
          this.frustumCenter.add(corner);
        }
      }
    }

    this.frustumCenter.divideScalar(8);

    let radius = 0;
    for (const corner of this.cornerPool) {
      radius = Math.max(radius, corner.distanceTo(this.frustumCenter));
    }
    radius = Math.ceil(radius * 16) / 16;

    this.frustumUp.set(0, 1, 0);
    if (Math.abs(this.lightDirection.dot(this.frustumUp)) > 0.999) {
      this.frustumUp.set(0, 0, 1);
    }

    const texelSize = (2 * radius) / cascade.renderTarget.width;
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
    const casterDepth = Math.max(offset, shadowCasterDistance);

    cascade.camera.up.copy(this.frustumUp);
    cascade.camera.position
      .copy(this.frustumCenter)
      .addScaledVector(this.lightDirection, offset);
    cascade.camera.lookAt(this.frustumCenter);
    cascade.camera.left = -radius;
    cascade.camera.right = radius;
    cascade.camera.top = radius;
    cascade.camera.bottom = -radius;
    cascade.camera.near = 0.1;
    cascade.camera.far = offset + casterDepth;
    cascade.camera.coordinateSystem = this._coordinateSystem;
    cascade.camera.updateProjectionMatrix();
    cascade.camera.updateMatrixWorld();

    cascade.matrix
      .copy(cascade.camera.projectionMatrix)
      .multiply(cascade.camera.matrixWorldInverse);
  }

  render(
    renderer: CSMRenderTarget,
    scene: Scene,
    casters: Object3D[],
    customDepthCasters: Object3D[] = [],
    farCascadeHiddenCasters: Object3D[] = [],
  ): void {
    const hasCascadeToRender = this.cascadeNeedsRender.some(Boolean);
    if (!hasCascadeToRender) return;

    const allCasters = new Set<Object3D>([...casters, ...customDepthCasters]);

    const sceneHidden: { object: Object3D; visible: boolean }[] = [];
    for (const child of scene.children) {
      if (!allCasters.has(child) && child.visible) {
        sceneHidden.push({ object: child, visible: true });
        child.visible = false;
      }
    }

    const swaps: {
      mesh: Mesh;
      original: Material | Material[];
    }[] = [];
    const casterHidden: { object: Object3D; isVisible: boolean }[] = [];

    for (const root of casters) {
      root.traverse((obj) => {
        if (!obj.visible) return;
        if (shouldSkipNonMeshCaster(obj)) {
          casterHidden.push({ object: obj, isVisible: obj.visible });
          obj.visible = false;
          return;
        }
        if (!(obj instanceof Mesh)) return;
        if (shouldSkipBasicCaster(obj)) {
          obj.visible = false;
          casterHidden.push({ object: obj, isVisible: true });
          return;
        }
        swaps.push({ mesh: obj, original: obj.material });
        obj.material = this.depthMaterial;
      });
    }

    // Custom-depth casters carry their own NodeMaterial (e.g. instanced
    // skinned animals/characters that require per-instance bone sampling).
    // Anything else under those roots that lacks a NodeMaterial customDepth
    // is hidden for the pass rather than force-swapped to the basic depth
    // material, which can't reproduce skinning.
    for (const root of customDepthCasters) {
      root.traverse((obj) => {
        if (!obj.visible) return;
        if (shouldSkipNonMeshCaster(obj)) {
          casterHidden.push({ object: obj, isVisible: obj.visible });
          obj.visible = false;
          return;
        }
        if (!(obj instanceof Mesh)) return;
        if (obj.customDepthMaterial instanceof NodeMaterial) {
          swaps.push({ mesh: obj, original: obj.material });
          obj.material = obj.customDepthMaterial;
        } else {
          obj.visible = false;
          casterHidden.push({ object: obj, isVisible: true });
        }
      });
    }

    for (let i = 0; i < this.cascades.length; i++) {
      if (!this.cascadeNeedsRender[i]) continue;
      const cascade = this.cascades[i];
      if (!cascade) continue;

      const hiddenFarCasters: { object: Object3D; visible: boolean }[] = [];
      if (i >= 2) {
        for (const object of farCascadeHiddenCasters) {
          if (object.visible) {
            hiddenFarCasters.push({ object, visible: true });
            object.visible = false;
          }
        }
      }

      renderer.setRenderTarget(cascade.renderTarget);
      renderer.clear();
      renderer.render(scene, cascade.camera);

      for (const entry of hiddenFarCasters) {
        entry.object.visible = entry.visible;
      }

      this.cascadeNeedsRender[i] = false;
      this.renderCount += 1;
      this.lastRenderAt =
        typeof performance !== "undefined" ? performance.now() : Date.now();
    }
    renderer.setRenderTarget(null);

    for (const swap of swaps) {
      swap.mesh.material = swap.original;
    }
    for (const entry of casterHidden) {
      entry.object.visible = entry.isVisible;
    }
    for (const entry of sceneHidden) {
      entry.object.visible = entry.visible;
    }
  }

  get hasPendingRender(): boolean {
    return this.cascadeNeedsRender.some(Boolean);
  }

  get shadowMaps(): readonly [Texture, Texture, Texture] {
    return [
      this.getCascade(0).renderTarget.texture,
      this.getCascade(1).renderTarget.texture,
      this.getCascade(2).renderTarget.texture,
    ];
  }

  get shadowMatrices(): readonly [Matrix4, Matrix4, Matrix4] {
    return [
      this.getCascade(0).matrix,
      this.getCascade(1).matrix,
      this.getCascade(2).matrix,
    ];
  }

  get cascadeSplits(): readonly [number, number, number] {
    return [
      this.getCascade(0).split,
      this.getCascade(1).split,
      this.getCascade(2).split,
    ];
  }

  get cascadeCount(): number {
    return this.cascades.length;
  }

  get shadowBias(): number {
    return this.config.shadowBias;
  }

  get minElevation(): number {
    return this.config.minElevation;
  }

  // Strength as a function of the caster's elevation (sin of altitude in
  // [-1, 1]). Day caster (sunY >= 0) ramps from `dayShadowStrength` down to
  // zero across the low-elevation fade band; below the horizon we treat the
  // moon (|sunY|) as the caster and ramp `nightShadowStrength` the same way.
  computeShadowStrength(sunY: number): number {
    const isDay = sunY >= 0;
    const elevation = Math.abs(sunY);
    const peak = isDay
      ? this.config.dayShadowStrength
      : this.config.nightShadowStrength;
    const start = this.config.lowElevationFadeStart;
    const end = this.config.lowElevationFadeEnd;
    if (elevation >= start) return peak;
    if (elevation <= end) return 0;
    const t = (elevation - end) / (start - end);
    const smooth = t * t * (3 - 2 * t);
    return peak * smooth;
  }

  get shadowStrength(): number {
    return this.config.dayShadowStrength;
  }

  private getCascade(index: number): Cascade {
    const cascade = this.cascades[index];
    if (!cascade) {
      throw new Error(`Missing CSM depth cascade ${index}`);
    }
    return cascade;
  }

  dispose(): void {
    for (const cascade of this.cascades) {
      cascade.renderTarget.dispose();
    }
    this.depthMaterial.dispose();
    this.cascades = [];
  }
}
