import {
  BufferGeometry,
  Camera,
  Data3DTexture,
  Float32BufferAttribute,
  LinearFilter,
  Matrix4,
  Mesh,
  NormalBlending,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  type IUniform,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";

import { WorkerPool } from "../../libs/worker-pool";
import VolumetricCloudsFragmentShader from "../../shaders/volumetric-clouds/fragment.glsl?raw";
import VolumetricCloudsVertexShader from "../../shaders/volumetric-clouds/vertex.glsl?raw";
import { Coords3 } from "../../types";

import { ORDER_INDEPENDENT_KEY } from "./order-independent-transparency";
import { SceneDepthCopy } from "./scene-depth-copy";
import { markNeverCaster } from "./shadow-casters";
import { createSkyFogFragment, SKY_FOG_UNIFORM_DECLARATIONS } from "./sky-fog";
import VolumetricCloudWorker from "./workers/volumetric-clouds-worker.ts?worker&inline";

/** How a volumetric deck is drawn. */
export type VolumetricCloudStyle = "voxel" | "soft";

/** One horizontal slab of cloud. */
export type VolumetricCloudLayer = {
  /** Height of the slab's underside, in blocks. */
  bottom: number;
  /** Height of the slab's top, in blocks. */
  top: number;
  /** Share of the sky the slab covers, `0..1`. */
  coverage: number;
  /** Light lost per block through cloud at full density. */
  extinction: number;
  /**
   * Blocks per texel of the noise volume. In the voxel style this is the
   * size of one cloud cube.
   */
  cell: Coords3;
  /** How many noise tiles one sweep of the coverage map spans. */
  coverageScale: number;
  /** Fraction of the slab height over which the underside rounds off. */
  bottomRound: number;
  /** Fraction of the slab height over which the top rounds off. */
  topRound: number;
  /** Brightness of the slab's underside relative to its top, `0..1`. */
  shadeFloor: number;
  /** Shifts this slab's noise so two slabs never repeat each other. */
  offset: number;
  /**
   * Share of the deck's drift speed this slab moves with: valley cloud
   * barely moves while the high deck sails over it.
   */
  drift: number;
};

export type VolumetricCloudsOptions = {
  style: VolumetricCloudStyle;
  /** At most two slabs. */
  layers: VolumetricCloudLayer[];
  /** Texels of the tileable noise volume. */
  noiseSize: Coords3;
  /** The drift speed along `-z`, in blocks per second of the shared clock. */
  speed: number;
  /** How far a ray marches, in blocks. */
  maxDistance: number;
  /** Fraction of `maxDistance` where the deck starts fading into the haze. */
  fadeStartRatio: number;
  seed: number;
};

export const VOLUMETRIC_CLOUD_MAX_LAYERS = 2;

const defaultLayer: VolumetricCloudLayer = {
  bottom: 260,
  top: 320,
  coverage: 0.45,
  extinction: 0.12,
  cell: [8, 6, 8],
  coverageScale: 3.3,
  bottomRound: 0.15,
  topRound: 0.5,
  shadeFloor: 0.62,
  offset: 0,
  drift: 1,
};

export const defaultVolumetricCloudsOptions: VolumetricCloudsOptions = {
  style: "voxel",
  layers: [defaultLayer],
  noiseSize: [128, 16, 128],
  speed: 8,
  maxDistance: 2400,
  fadeStartRatio: 0.55,
  seed: 1,
};

/**
 * The uniforms a volumetric deck reads from the rest of the world (fog, sky
 * glow, sun, and the cloud colour the day cycle drives): pass the classic
 * deck's material uniforms and both decks light and haze alike.
 */
export type VolumetricCloudsSharedUniforms = Record<string, IUniform>;

/**
 * Clouds marched through a tileable noise volume instead of meshed. Drawn as
 * one screen-covering triangle after the scene's transparency composites,
 * reading a copy of the scene's depth so a slab wraps around the terrain
 * that rises through it: a low layer becomes a sea of cloud with the peaks
 * standing out of it.
 *
 * The voxel style steps cell by cell (each texel is one cloud cube, shaded by
 * the face the ray crossed into it); the soft style marches evenly through a
 * filtered volume.
 */
export class VolumetricClouds extends Mesh<BufferGeometry, ShaderMaterial> {
  public options: VolumetricCloudsOptions;

  public isInitialized = false;

  private texture: Data3DTexture | null = null;

  private pool = new WorkerPool(VolumetricCloudWorker, {
    maxWorker: 1,
    name: "volumetric-cloud-worker",
  });

  private depthUniforms = {
    sceneDepth: { value: null },
    sceneDepthReady: { value: 0 },
  };

  private depthCopy = new SceneDepthCopy(this.depthUniforms);

  private generation = 0;

  private isDisposed = false;

  private resolution = new Vector2();

  private isHidden = false;

  constructor(
    options: Partial<VolumetricCloudsOptions> = {},
    shared: VolumetricCloudsSharedUniforms = {},
  ) {
    super(...VolumetricClouds.createParts(shared));
    const material = this.material;
    material.uniforms.uSceneDepth = this.depthUniforms.sceneDepth;
    material.uniforms.uSceneDepthReady = this.depthUniforms.sceneDepthReady;

    this.options = { ...defaultVolumetricCloudsOptions, ...options };
    this.frustumCulled = false;
    // After the transparency composite closes (999_999) and before the
    // additive band (999_999.5): the scene behind is final, water included.
    this.renderOrder = 999_999.25;
    this.visible = false;
    markNeverCaster(this);

    this.applyOptions();
    this.regenerate();
  }

  private static createParts(
    shared: VolumetricCloudsSharedUniforms,
  ): [BufferGeometry, ShaderMaterial] {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
    );

    const material = new ShaderMaterial({
      vertexShader: VolumetricCloudsVertexShader,
      fragmentShader: VolumetricCloudsFragmentShader.replace(
        "#include <sky_fog_pars_fragment>",
        SKY_FOG_UNIFORM_DECLARATIONS,
      ).replace(
        "#include <sky_fog_fragment>",
        createSkyFogFragment(
          "sqrt(dot(fogDiff, fogDiff)) / max(uCloudFogDistanceScale, 0.001)",
        ),
      ),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: NormalBlending,
      uniforms: {
        ...shared,
        uCloudNoise: { value: null },
        uNoiseSize: { value: new Vector3() },
        uSceneDepth: { value: null },
        uSceneDepthReady: { value: 0 },
        uInverseProjection: { value: new Matrix4() },
        uCameraWorld: { value: new Matrix4() },
        uResolution: { value: new Vector2(1, 1) },
        uStyle: { value: 0 },
        uDrift: { value: new Vector3() },
        uMaxDistance: { value: 2400 },
        uFadeStart: { value: 1200 },
        uLayerCount: { value: 0 },
        uLayerSpan: {
          value: Array.from(
            { length: VOLUMETRIC_CLOUD_MAX_LAYERS },
            () => new Vector4(),
          ),
        },
        uLayerCell: {
          value: Array.from(
            { length: VOLUMETRIC_CLOUD_MAX_LAYERS },
            () => new Vector4(1, 1, 1, 1),
          ),
        },
        uLayerShape: {
          value: Array.from(
            { length: VOLUMETRIC_CLOUD_MAX_LAYERS },
            () => new Vector4(),
          ),
        },
        uLayerDrift: {
          value: Array.from({ length: VOLUMETRIC_CLOUD_MAX_LAYERS }, () => 1),
        },
      },
    });
    material.toneMapped = false;
    material.userData[ORDER_INDEPENDENT_KEY] = false;

    return [geometry, material];
  }

  /** Change the style or the layers in place; the noise is kept. */
  configure(options: Partial<VolumetricCloudsOptions>) {
    const needsNoise =
      (options.seed !== undefined && options.seed !== this.options.seed) ||
      (options.noiseSize !== undefined &&
        options.noiseSize.join() !== this.options.noiseSize.join());

    this.options = { ...this.options, ...options };
    this.applyOptions();
    if (needsNoise) this.regenerate();
  }

  setSeed = (seed: number) => this.configure({ seed });

  /** Hide the deck without dropping it (the camera under water). */
  setHidden(hidden: boolean) {
    this.isHidden = hidden;
    this.applyOptions();
  }

  /**
   * Drift the deck with a clock every viewer shares, so two clients see the
   * same cloud in the same place.
   */
  update(driftClock: number) {
    this.material.uniforms.uDrift.value.set(
      0,
      0,
      this.options.speed * driftClock,
    );
  }

  onBeforeRender = (
    renderer: WebGLRenderer,
    _scene: unknown,
    camera: Camera,
  ) => {
    const uniforms = this.material.uniforms;
    uniforms.uInverseProjection.value.copy(camera.projectionMatrixInverse);
    uniforms.uCameraWorld.value.copy(camera.matrixWorld);

    const target = renderer.getRenderTarget() as WebGLRenderTarget | null;
    if (target) {
      this.resolution.set(target.width, target.height);
    } else {
      renderer.getDrawingBufferSize(this.resolution);
    }
    uniforms.uResolution.value.copy(this.resolution);

    this.depthCopy.capture(renderer, target);
  };

  dispose() {
    this.isDisposed = true;
    this.pool.terminate();
    this.depthCopy.dispose();
    this.texture?.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }

  private applyOptions() {
    const { style, layers, maxDistance, fadeStartRatio } = this.options;
    const uniforms = this.material.uniforms;

    uniforms.uStyle.value = style === "soft" ? 1 : 0;
    uniforms.uMaxDistance.value = maxDistance;
    uniforms.uFadeStart.value = maxDistance * fadeStartRatio;

    const count = Math.min(layers.length, VOLUMETRIC_CLOUD_MAX_LAYERS);
    uniforms.uLayerCount.value = count;
    for (let i = 0; i < count; i++) {
      const layer = { ...defaultLayer, ...layers[i] };
      uniforms.uLayerSpan.value[i].set(
        layer.bottom,
        layer.top,
        layer.coverage,
        layer.extinction,
      );
      uniforms.uLayerCell.value[i].set(
        layer.cell[0],
        layer.cell[1],
        layer.cell[2],
        layer.coverageScale,
      );
      uniforms.uLayerShape.value[i].set(
        layer.bottomRound,
        layer.topRound,
        layer.shadeFloor,
        layer.offset,
      );
      uniforms.uLayerDrift.value[i] = layer.drift;
    }

    this.visible = this.isInitialized && count > 0 && !this.isHidden;
  }

  private regenerate() {
    const generation = ++this.generation;
    const { noiseSize, seed } = this.options;

    this.pool.addJob({
      message: { size: noiseSize, seed },
      buffers: [],
      resolve: (data: Uint8Array | null) => {
        if (!data || this.isDisposed || generation !== this.generation) {
          return;
        }

        const texture = new Data3DTexture(
          data,
          noiseSize[0],
          noiseSize[1],
          noiseSize[2],
        );
        texture.format = RGBAFormat;
        texture.type = UnsignedByteType;
        texture.minFilter = LinearFilter;
        texture.magFilter = LinearFilter;
        texture.wrapS = RepeatWrapping;
        texture.wrapT = RepeatWrapping;
        texture.wrapR = RepeatWrapping;
        texture.unpackAlignment = 1;
        texture.needsUpdate = true;

        this.texture?.dispose();
        this.texture = texture;
        this.material.uniforms.uCloudNoise.value = texture;
        this.material.uniforms.uNoiseSize.value.set(...noiseSize);
        this.isInitialized = true;
        this.applyOptions();
      },
    });
  }
}
