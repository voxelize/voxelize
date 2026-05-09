import {
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
  WebGLCoordinateSystem,
  WebGLRenderTarget,
  WebGLRenderer,
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
  shadowMapSize: number;
  radius: number;
  lightMargin: number;
  shadowCasterDistance: number;
  shadowBias: number;
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
  shadowMapSize: 2048,
  radius: 48,
  lightMargin: 24,
  shadowCasterDistance: 200,
  shadowBias: 0.0003,
  dayShadowStrength: 0.55,
  nightShadowStrength: 0.3,
  minElevation: 0.2,
  lowElevationFadeStart: 0.35,
  lowElevationFadeEnd: 0.05,
};

export type CSMRenderTarget = WebGLRenderer | WebGPURenderer;

// The packed depth value is `clip.z / clip.w`, which the rasterizer naturally
// produces in different ranges depending on the renderer's clip-space
// convention: [-1, 1] for WebGL, [0, 1] for WebGPU. HalfFloat handles both
// signed and unsigned ranges; the chunk receiver computes the matching value
// from the same shadow matrix, so we MUST store raw NDC z here (not a
// remapped depth01) or skinned/basic casters will produce inverse shadows.
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

function shouldSkipBasicCaster(mesh: Mesh): boolean {
  // Sprites (e.g. nametags) face the rendering camera, so during the depth
  // pass they reorient to face the depth camera and project oriented quads
  // into the shadow map. Always skip.
  if (mesh instanceof Sprite) return true;
  if (mesh.castShadow === false) return true;
  const mat = mesh.material;
  if (!mat) return false;
  if (Array.isArray(mat)) {
    return mat.length > 0 && mat.every(isShadowSkippedMaterial);
  }
  return isShadowSkippedMaterial(mat);
}

export class CSMDepthPass {
  private config: CSMDepthConfig;
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  private renderTarget: WebGLRenderTarget;
  private depthMaterial: Material;
  private matrixValue = new Matrix4();
  private lightDirection = new Vector3(0, -1, 0).normalize();

  private up = new Vector3(0, 1, 0);
  private lookTarget = new Vector3();
  private snappedFocus = new Vector3();

  // The renderer's clip-space convention. Defaults to WebGL; the world syncs
  // this to the active renderer before the first chunk material is built so
  // the depth-pack camera matrix and the receiver's TSL graph agree on
  // whether NDC z is in [-1, 1] (WebGL) or [0, 1] (WebGPU).
  private _coordinateSystem: CoordinateSystem = WebGLCoordinateSystem;

  // Monotonic counter incremented every time the depth pass renders. Tests
  // and tooling read this to verify the WebGPU CSM path is actually running
  // rather than relying on screenshot inspection alone.
  public renderCount = 0;
  public lastRenderAt = 0;

  constructor(config: Partial<CSMDepthConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
    const size = this.config.shadowMapSize;
    this.renderTarget = new WebGLRenderTarget(size, size, {
      depthBuffer: true,
      stencilBuffer: false,
      format: RGBAFormat,
      type: HalfFloatType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
    });
    this.renderTarget.texture.name = "CSMDepthPass.depth";
    this.depthMaterial = createDepthPackingNodeMaterial();
  }

  get coordinateSystem(): CoordinateSystem {
    return this._coordinateSystem;
  }

  setCoordinateSystem(system: CoordinateSystem): void {
    if (system !== WebGLCoordinateSystem && system !== WebGPUCoordinateSystem) {
      return;
    }
    this._coordinateSystem = system;
    this.camera.coordinateSystem = system;
  }

  update(sunDirection: Vector3, focus: Vector3): void {
    this.lightDirection.copy(sunDirection).normalize();
    const { radius, lightMargin, shadowCasterDistance } = this.config;

    this.up.set(0, 1, 0);
    if (Math.abs(this.lightDirection.dot(this.up)) > 0.999) {
      this.up.set(0, 0, 1);
    }

    const texelSize = (2 * radius) / this.config.shadowMapSize;
    this.snappedFocus.set(
      Math.floor(focus.x / texelSize) * texelSize,
      Math.floor(focus.y / texelSize) * texelSize,
      Math.floor(focus.z / texelSize) * texelSize,
    );

    const offset = radius + lightMargin;
    this.camera.up.copy(this.up);
    this.camera.position
      .copy(this.snappedFocus)
      .addScaledVector(this.lightDirection, offset);
    this.lookTarget.copy(this.snappedFocus);
    this.camera.lookAt(this.lookTarget);

    this.camera.left = -radius;
    this.camera.right = radius;
    this.camera.top = radius;
    this.camera.bottom = -radius;
    this.camera.near = 0.1;
    this.camera.far = offset + Math.max(offset, shadowCasterDistance);
    this.camera.coordinateSystem = this._coordinateSystem;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    this.matrixValue
      .copy(this.camera.projectionMatrix)
      .multiply(this.camera.matrixWorldInverse);
  }

  render(
    renderer: CSMRenderTarget,
    scene: Scene,
    casters: Object3D[],
    customDepthCasters: Object3D[] = [],
  ): void {
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
    const meshHidden: Mesh[] = [];

    // Per-mesh swap (instead of `scene.overrideMaterial`) so we can filter out
    // unsafe casters: sprites, transparent overlays/effects, fluids, and
    // anything explicitly opted out via `castShadow = false` or
    // `material.userData.skipShadow`.
    for (const root of casters) {
      root.traverse((obj) => {
        if (!(obj instanceof Mesh) || !obj.visible) return;
        if (shouldSkipBasicCaster(obj)) {
          obj.visible = false;
          meshHidden.push(obj);
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
        if (!(obj instanceof Mesh) || !obj.visible) return;
        if (obj.customDepthMaterial instanceof NodeMaterial) {
          swaps.push({ mesh: obj, original: obj.material });
          obj.material = obj.customDepthMaterial;
        } else {
          obj.visible = false;
          meshHidden.push(obj);
        }
      });
    }

    renderer.setRenderTarget(this.renderTarget);
    renderer.clear();
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(null);

    this.renderCount += 1;
    this.lastRenderAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();

    for (const swap of swaps) {
      swap.mesh.material = swap.original;
    }
    for (const m of meshHidden) {
      m.visible = true;
    }
    for (const entry of sceneHidden) {
      entry.object.visible = entry.visible;
    }
  }

  get shadowMap(): Texture {
    return this.renderTarget.texture;
  }

  get shadowMatrix(): Matrix4 {
    return this.matrixValue;
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

  // Back-compat: legacy callers read a static `shadowStrength`. Returns the
  // peak day strength so existing wiring still produces a sensible value.
  get shadowStrength(): number {
    return this.config.dayShadowStrength;
  }

  get shadowMapTexelSize(): number {
    return 1 / this.config.shadowMapSize;
  }

  dispose(): void {
    this.renderTarget.dispose();
    this.depthMaterial.dispose();
  }
}
