import {
  BufferGeometry,
  type Camera,
  Color,
  Data3DTexture,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NearestFilter,
  type NodeMaterial,
  type Renderer,
  RenderTarget,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  type Texture,
  UnsignedByteType,
} from "three/webgpu";

import { WorkerPool } from "../../libs/worker-pool";
import { Coords3 } from "../../types";
import { callbackRenderer } from "../../utils/three-utils";

import { renderClearing } from "./clearing-render";
import { ORDER_INDEPENDENT_KEY } from "./order-independent-transparency";
import { SceneDepthCopy } from "./scene-depth-copy";
import { exemptFromLightCones } from "./light-cones";
import { markNeverCaster } from "./shadow-casters";
import {
  createVolumetricCloudCoarseMaterial,
  createVolumetricCloudMaterial,
  createVolumetricCloudUniforms,
  VOLUMETRIC_CLOUD_MAX_LAYERS,
  type VolumetricCloudsSharedInputs,
  type VolumetricCloudUniforms,
} from "./shading/volumetric-clouds";
import { ownUniform } from "./shading/uniforms";
import { driftShift } from "./volumetric-clouds-drift";
import VolumetricCloudWorker from "./workers/volumetric-clouds-worker.ts?worker&inline";

const scratchClear = new Color();

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

export { VOLUMETRIC_CLOUD_MAX_LAYERS };

const defaultLayer: VolumetricCloudLayer = {
  bottom: 260,
  top: 320,
  coverage: 0.45,
  extinction: 0.12,
  cell: [8, 6, 8],
  coverageScale: 3.3,
  bottomRound: 0.15,
  topRound: 0.5,
  shadeFloor: 0.9,
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
 * What a volumetric deck reads from the rest of the world (fog, sky glow,
 * sun, and the cloud colour the day cycle drives): pass the classic deck's
 * `Clouds.shared` and both decks light and haze alike.
 */
export type VolumetricCloudsSharedUniforms = VolumetricCloudsSharedInputs;

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
export class VolumetricClouds extends Mesh<BufferGeometry, NodeMaterial> {
  public options: VolumetricCloudsOptions;

  public isInitialized = false;

  private texture: Data3DTexture | null = null;

  private pool = new WorkerPool(VolumetricCloudWorker, {
    maxWorker: 1,
    name: "volumetric-cloud-worker",
  });

  private readonly uniforms: VolumetricCloudUniforms;

  private depthCopy: SceneDepthCopy;

  /**
   * The half of the deck behind the blended layers: the same march over
   * the same uniforms, split at their distance, drawn in its own render
   * under their composite.
   */
  private readonly behind: {
    scene: Scene;
    mesh: Mesh<BufferGeometry, NodeMaterial>;
  };

  /**
   * The deck marched at half the frame's size, before its draws into the
   * frame: they take their even stretches from it and march only the
   * pixels it cannot stand in for (see `createVolumetricCloudCoarseMaterial`).
   */
  private readonly coarse: {
    scene: Scene;
    mesh: Mesh<BufferGeometry, NodeMaterial>;
    target: RenderTarget;
  };

  /** The render and the camera the half-size march was last drawn for. */
  private coarseFrame = -1;
  private coarseCamera: Camera | null = null;

  private generation = 0;

  private isDisposed = false;

  private isHidden = false;

  /** The layers as drawn, defaults filled in, for the per-frame drift. */
  private resolvedLayers: VolumetricCloudLayer[] = [];

  /** The render whose blended layers the back half drew under. */
  private splitFrame = -1;

  /** The render a depth copy was lent for ({@link borrowDepth}). */
  private borrowedDepthFrame = -1;

  constructor(
    options: Partial<VolumetricCloudsOptions> = {},
    shared: VolumetricCloudsSharedUniforms,
  ) {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
    );
    const uniforms = createVolumetricCloudUniforms();
    super(geometry, createVolumetricCloudMaterial(uniforms, shared));
    this.uniforms = uniforms;
    this.depthCopy = new SceneDepthCopy({
      sceneDepth: uniforms.sceneDepth,
      sceneDepthReady: uniforms.sceneDepthReady,
    });
    this.material.userData[ORDER_INDEPENDENT_KEY] = false;

    const behindMaterial = createVolumetricCloudMaterial(
      { ...uniforms, blendedSplit: ownUniform(1) },
      shared,
    );
    const behindMesh = new Mesh(geometry, behindMaterial);
    behindMesh.frustumCulled = false;
    const behindScene = new Scene();
    behindScene.add(behindMesh);
    this.behind = { scene: behindScene, mesh: behindMesh };

    const coarseMesh = new Mesh(
      geometry,
      createVolumetricCloudCoarseMaterial(uniforms, shared),
    );
    coarseMesh.frustumCulled = false;
    const coarseScene = new Scene();
    coarseScene.add(coarseMesh);
    const coarseTarget = new RenderTarget(1, 1, {
      type: HalfFloatType,
      format: RGBAFormat,
      depthBuffer: false,
      generateMipmaps: false,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
    });
    coarseTarget.texture.name = "VolumetricClouds.coarse";
    this.coarse = { scene: coarseScene, mesh: coarseMesh, target: coarseTarget };

    this.options = { ...defaultVolumetricCloudsOptions, ...options };
    this.frustumCulled = false;
    // After the transparency composite closes (999_999) and before the
    // additive band (999_999.5): the scene behind is final, water included.
    this.renderOrder = 999_999.25;
    this.visible = false;
    markNeverCaster(this);
    exemptFromLightCones(this, "clouds sit far past any beam's reach");

    this.applyOptions();
    this.regenerate();
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
   * same cloud in the same place. Pass a slewed clock (`World.shaderClock`):
   * the shared clock itself snaps on every server correction, and the deck
   * would jump with it.
   */
  update(driftClock: number) {
    const { speed, noiseSize } = this.options;
    const grid = this.uniforms.layerGridShift.array as unknown as {
      set(x: number, y: number, z: number, w: number): void;
    }[];
    const noise = this.uniforms.layerNoiseShift.array as unknown as {
      set(x: number, y: number, z: number, w: number): void;
    }[];
    for (let i = 0; i < this.resolvedLayers.length; i++) {
      const layer = this.resolvedLayers[i];
      const shift = driftShift(
        speed * driftClock * layer.drift,
        layer.cell[2],
        noiseSize[2],
        layer.coverageScale,
      );
      grid[i].set(0, shift.grid, 0, 0);
      noise[i].set(0, shift.noise, 0, shift.coverage);
    }
  }

  /**
   * Draws the half of the deck behind the scene's blended layers, under
   * their composite: `layers` is the accumulation's weight target, read for
   * where they stand. Called with the scene's target bound, just before the
   * composite; the deck's own draw later this frame is the front half.
   */
  drawBehindBlended(renderer: Renderer, camera: Camera, layers: Texture) {
    if (!this.visible) return;
    this.uniforms.blendedLayers.value = layers;
    this.captureDepth(renderer);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.behind.scene, camera);
    renderer.autoClear = autoClear;
    this.uniforms.blendedSplit.value = 2;
    this.splitFrame = renderer.info.frame;
    this.prepare(renderer, camera);
  }

  /**
   * Marches the deck at half the size of the bound target, for the draw
   * into it that follows this frame. Call it between renders, with the
   * frame's target bound and its depth final: the world does, before the
   * deck draws ({@link drawBehindBlended} does for a frame with see-through
   * layers). A frame that skips it marches every pixel in the deck's own
   * draw, as does the soft style, whose grain is per pixel.
   */
  prepare(renderer: Renderer, camera: Camera) {
    if (!this.visible || this.options.style !== "voxel") return;
    const frame = renderer.info.frame;
    if (this.coarseFrame === frame && this.coarseCamera === camera) return;
    const target = renderer.getRenderTarget();
    if (!target) return;
    const u = this.uniforms;
    if (this.splitFrame !== frame) u.blendedSplit.value = 0;
    this.captureDepth(renderer);

    const coarse = this.coarse.target;
    const width = Math.max(1, Math.ceil(target.width / 2));
    const height = Math.max(1, Math.ceil(target.height / 2));
    if (coarse.width !== width || coarse.height !== height) {
      coarse.setSize(width, height);
    }
    u.frameSize.value.set(target.width, target.height);
    u.coarseSize.value.set(width, height);

    const clearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(scratchClear);
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(coarse);
    try {
      renderClearing(renderer, this.coarse.scene, camera, { color: true });
    } finally {
      renderer.setClearColor(scratchClear, clearAlpha);
      renderer.setRenderTarget(target);
    }
    u.coarse.value = coarse.texture;
    u.coarseReady.value = 1;
    this.coarseFrame = frame;
    this.coarseCamera = camera;
  }

  onBeforeRender = (renderer: unknown, _scene: unknown, camera: Camera) => {
    const gpu = callbackRenderer(renderer);
    const frame = gpu.info.frame;
    // No back half this frame (no blended layers accumulated): one march.
    if (this.splitFrame !== frame) this.uniforms.blendedSplit.value = 0;
    // No half-size march for this view: every pixel marches for itself.
    this.uniforms.coarseReady.value =
      this.coarseFrame === frame && this.coarseCamera === camera ? 1 : 0;
    this.captureDepth(gpu);
  };

  /**
   * Hands the deck a copy of the frame's depth that already exists this
   * render (the world's, made as its blended layers open: nothing after
   * it writes depth), so the deck makes none of its own. Without one it
   * copies the bound target's depth itself.
   */
  borrowDepth(renderer: Renderer, depth: Texture) {
    this.uniforms.sceneDepth.value = depth;
    this.uniforms.sceneDepthReady.value = 1;
    this.borrowedDepthFrame = renderer.info.frame;
    // Its own copy would sit idle at the size of the frame.
    this.depthCopy.dispose();
  }

  private captureDepth(renderer: Renderer) {
    if (this.borrowedDepthFrame === renderer.info.frame) return;
    this.depthCopy.capture(renderer, renderer.getRenderTarget());
  }

  dispose() {
    this.isDisposed = true;
    this.pool.terminate();
    this.depthCopy.dispose();
    this.texture?.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.behind.mesh.material.dispose();
    this.coarse.mesh.material.dispose();
    this.coarse.target.dispose();
  }

  private applyOptions() {
    const { style, layers, maxDistance, fadeStartRatio } = this.options;
    const u = this.uniforms;

    u.style.value = style === "soft" ? 1 : 0;
    u.maxDistance.value = maxDistance;
    u.fadeStart.value = maxDistance * fadeStartRatio;

    const count = Math.min(layers.length, VOLUMETRIC_CLOUD_MAX_LAYERS);
    u.layerCount.value = count;
    const span = u.layerSpan.array as unknown as Vector4Like[];
    const cell = u.layerCell.array as unknown as Vector4Like[];
    const shape = u.layerShape.array as unknown as Vector4Like[];
    this.resolvedLayers.length = 0;
    for (let i = 0; i < count; i++) {
      const layer = { ...defaultLayer, ...layers[i] };
      this.resolvedLayers.push(layer);
      span[i].set(layer.bottom, layer.top, layer.coverage, layer.extinction);
      cell[i].set(
        layer.cell[0],
        layer.cell[1],
        layer.cell[2],
        layer.coverageScale,
      );
      shape[i].set(
        layer.bottomRound,
        layer.topRound,
        layer.shadeFloor,
        layer.offset,
      );
    }

    this.visible = this.isInitialized && count > 0 && !this.isHidden;
    this.behind.mesh.visible = this.visible;
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
        this.uniforms.noise.value = texture;
        this.uniforms.noiseSize.value.set(...noiseSize);
        this.isInitialized = true;
        this.applyOptions();
      },
    });
  }
}

type Vector4Like = { set(x: number, y: number, z: number, w: number): void };
