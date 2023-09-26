import { AABB } from "@voxelize/aabb";
import { Engine as PhysicsEngine } from "@voxelize/physics-engine";
import { raycast } from "@voxelize/raycast";
import { GeometryProtocol } from "@voxelize/transport";
import { MeshProtocol, MessageProtocol } from "@voxelize/transport/src/types";
import { NetIntercept } from "core/network";
import {
  BufferGeometry,
  Clock,
  Color,
  Float32BufferAttribute,
  FrontSide,
  Group,
  Int32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Scene,
  ShaderLib,
  ShaderMaterial,
  Texture,
  MathUtils as ThreeMathUtils,
  // @ts-ignore
  TwoPassDoubleSide,
  Uniform,
  UniformsUtils,
  Vector3,
} from "three";
import MeshWorker from "web-worker:./workers/mesh-worker.ts";

import { WorkerPool } from "../../libs";
import { Coords2, Coords3 } from "../../types";
import {
  BLUE_LIGHT,
  BlockUtils,
  ChunkUtils,
  GREEN_LIGHT,
  LightColor,
  LightUtils,
  MathUtils,
  RED_LIGHT,
  SUNLIGHT,
} from "../../utils";

import { Block, BlockRotation, BlockUpdate, PY_ROTATION } from "./block";
import { Chunk } from "./chunk";
import { Chunks } from "./chunks";
import { Clouds, CloudsOptions } from "./clouds";
import { Loader } from "./loader";
import { Registry } from "./registry";
import { DEFAULT_CHUNK_SHADERS } from "./shaders";
import { Sky, SkyOptions } from "./sky";
import { AtlasTexture } from "./textures";

export * from "./block";
export * from "./chunk";
export * from "./clouds";
export * from "./loader";
export * from "./registry";
export * from "./shaders";
export * from "./sky";
export * from "./textures";
export * from "./uv";

export type LightNode = {
  voxel: Coords3;
  level: number;
};

export type BlockUpdateListener = (args: {
  oldValue: number;
  newValue: number;
  voxel: Coords3;
}) => void;

const VOXEL_NEIGHBORS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, 1, 0],
  [0, -1, 0],
];

/**
 * Custom shader material for chunks, simply a `ShaderMaterial` from ThreeJS with a map texture. Keep in mind that
 * if you want to change its map, you also have to change its `uniforms.map`.
 */
export type CustomChunkShaderMaterial = ShaderMaterial & {
  /**
   * The texture that this map runs on.
   */
  map: Texture;
};

/**
 * The client-side options to create a world. These are client-side only and can be customized to specific use.
 */
export type WorldClientOptions = {
  /**
   * The maximum chunk requests this world can request from the server per world update. Defaults to `12` chunks.
   */
  maxChunkRequestsPerUpdate: number;

  /**
   * The maximum amount of chunks received from the server that can be processed per world update.
   * By process, it means to be turned into a `Chunk` instance. Defaults to `8` chunks.
   */
  maxProcessesPerUpdate: number;

  /**
   * The maximum voxel updates that can be sent to the server per world update. Defaults to `1000` updates.
   */
  maxUpdatesPerUpdate: number;

  /**
   * Whether or not should the world generate ThreeJS meshes. Defaults to `true`.
   */
  shouldGenerateChunkMeshes: boolean;

  /**
   * The minimum light level even when sunlight and torch light levels are at zero. Defaults to `0.04`.
   */
  minLightLevel: number;

  /**
   * The fraction of the day that sunlight starts to appear. Defaults to `0.25`.
   */
  sunlightStartTimeFrac: number;

  /**
   * The fraction of the day that sunlight starts to disappear. Defaults to `0.7`.
   */
  sunlightEndTimeFrac: number;

  /**
   * The fraction of the day that sunlight takes to change from appearing to disappearing
   * or disappearing to appearing. Defaults to `0.1`.
   */
  sunlightChangeSpan: number;

  /**
   * The interval between each time a chunk is re-requested to the server. Defaults to `300` updates.
   */
  chunkRerequestInterval: number;

  /**
   * The default render radius of the world, in chunks. Change this through `world.renderRadius`. Defaults to `8` chunks.
   */
  defaultRenderRadius: number;

  /**
   * The default dimension to a single unit of a block face texture. If any texture loaded is greater, it will be downscaled to this resolution.
   * Defaults to `8` pixels.
   */
  textureUnitDimension: number;

  /**
   * The exponent applied to the ratio that chunks are loaded, which would then be used to determine whether an angle to a chunk is worth loading.
   * Defaults to `8`.
   */
  chunkLoadExponent: number;

  /**
   * The options to create the sky. Defaults to `{}`.
   */
  skyOptions: Partial<SkyOptions>;

  /**
   * The options to create the clouds. Defaults to `{}`.
   */
  cloudsOptions: Partial<CloudsOptions>;

  /**
   * The uniforms to overwrite the default chunk material uniforms. Defaults to `{}`.
   */
  chunkUniformsOverwrite: Partial<Chunks["uniforms"]>;

  /**
   * The threshold to force the server's time to the client's time. Defaults to `0.1`.
   */
  timeForceThreshold: number;

  /**
   * The interval between each time the world requests the server for its stats. Defaults to 500ms.
   */
  statsSyncInterval: number;
};

const defaultOptions: WorldClientOptions = {
  maxChunkRequestsPerUpdate: 12,
  maxProcessesPerUpdate: 8,
  maxUpdatesPerUpdate: 50,
  shouldGenerateChunkMeshes: true,
  minLightLevel: 0.04,
  chunkRerequestInterval: 300,
  defaultRenderRadius: 8,
  textureUnitDimension: 8,
  chunkLoadExponent: 8,
  skyOptions: {},
  cloudsOptions: {},
  chunkUniformsOverwrite: {},
  sunlightStartTimeFrac: 0.25,
  sunlightEndTimeFrac: 0.7,
  sunlightChangeSpan: 0.15,
  timeForceThreshold: 0.1,
  statsSyncInterval: 500,
};

/**
 * The options defined on the server-side, passed to the client on network joining.
 */
export type WorldServerOptions = {
  /**
   * The number of sub-chunks that divides a chunk vertically.
   */
  subChunks: number;

  /**
   * The width and depth of a chunk, in blocks.
   */
  chunkSize: number;

  /**
   * The height of a chunk, in blocks.
   */
  maxHeight: number;

  /**
   * The maximum light level that propagates in this world, including sunlight and torch light.
   */
  maxLightLevel: number;

  /**
   * The minimum chunk coordinate of this world, inclusive.
   */
  minChunk: [number, number];

  /**
   * The maximum chunk coordinate of this world, inclusive.
   */
  maxChunk: [number, number];

  /**
   * The gravity of everything physical in this world.
   */
  gravity: number[];

  /**
   * The minimum bouncing impulse of everything physical in this world.
   */
  minBounceImpulse: number;

  /**
   * The air drag of everything physical.
   */
  airDrag: number;

  /**
   * The fluid drag of everything physical.
   */
  fluidDrag: number;

  /**
   * The density of the fluid in this world.
   */
  fluidDensity: number;

  /**
   * The time per day in seconds.
   */
  timePerDay: number;
};

/**
 * The options to create a world. This consists of {@link WorldClientOptions} and {@link WorldServerOptions}.
 */
export type WorldOptions = WorldClientOptions & WorldServerOptions;

/**
 * A Voxelize world handles the chunk loading and rendering, as well as any 3D objects.
 * **This class extends the [ThreeJS `Scene` class](https://threejs.org/docs/#api/en/scenes/Scene).**
 * This means that you can add any ThreeJS objects to the world, and they will be rendered. The world
 * also implements {@link NetIntercept}, which means it intercepts chunk-related packets from the server
 * and constructs chunk meshes from them. You can optionally disable this by setting `shouldGenerateChunkMeshes` to `false`
 * in the options.
 *
 * There are a couple components that are by default created by the world that holds data:
 * - {@link World.registry}: A block registry that handles block textures and block instances.
 * - {@link World.chunks}: A chunk manager that stores all the chunks in the world.
 * - {@link World.physics}: A physics engine that handles voxel AABB physics simulation of client-side physics.
 * - {@link World.loader}: An asset loader that handles loading textures and other assets.
 * - {@link World.sky}: A sky that can render the sky and the sun.
 * - {@link World.clouds}: A clouds that renders the cubical clouds.
 *
 * One thing to keep in mind that there are no specific setters like `setVoxelByVoxel` or `setVoxelRotationByVoxel`.
 * This is because, instead, you should use `updateVoxel` and `updateVoxels` to update voxels.
 *
 * # Example
 * ```ts
 * const world = new VOXELIZE.World();
 *
 * // Update the voxel at `(0, 0, 0)` to a voxel type `12` in the world across the network.
 * world.updateVoxel(0, 0, 0, 12)
 *
 * // Register the interceptor with the network.
 * network.register(world);
 *
 * // Register an image to block sides.
 * world.applyBlockTexture("Test", VOXELIZE.ALL_FACES, "https://example.com/test.png");
 *
 * // Update the world every frame.
 * world.update(controls.position);
 * ```
 *
 * ![World](/img/docs/world.png)
 *
 * @category Core
 * @noInheritDoc
 */
export class World extends Scene implements NetIntercept {
  /**
   * The options to create the world.
   */
  public options: WorldOptions;

  /**
   * The block registry that holds all block data, such as texture and block properties.
   */
  public registry: Registry;

  /**
   * An asset loader to load in things like textures, images, GIFs and audio buffers.
   */
  public loader: Loader;

  /**
   * The manager that holds all chunk-related data, such as chunk meshes and voxel data.
   */
  public chunks: Chunks;

  /**
   * The voxel physics engine using `@voxelize/physics-engine`.
   */
  public physics: PhysicsEngine;

  /**
   * The sky that renders the sky and the sun.
   */
  public sky: Sky;

  /**
   * The clouds that renders the cubical clouds.
   */
  public clouds: Clouds;

  /**
   * Whether or not this world is connected to the server and initialized with data from the server.
   */
  public isInitialized = false;

  /**
   * The network packets to be sent to the server.
   * @hidden
   */
  public packets: MessageProtocol[] = [];

  /**
   * The voxel cache that stores previous values.
   */
  private oldBlocks: Map<string, number[]> = new Map();

  /**
   * The internal clock.
   */
  private clock = new Clock();

  /**
   * A map of initialize listeners on chunks.
   */
  private chunkInitializeListeners = new Map<
    string,
    ((chunk: Chunk) => void)[]
  >();

  private blockUpdateListeners = new Set<BlockUpdateListener>();

  /**
   * The JSON data received from the world. Call `initialize` to initialize.
   */
  private initialData: any = null;

  /**
   * The internal time in seconds.
   */
  private _time = 0;

  /**
   * The internal render radius in chunks.
   */
  private _renderRadius = 0;

  /**
   * The internal delete radius in chunks.
   */
  private _deleteRadius = 0;

  private meshWorkerPool = new WorkerPool(MeshWorker, {
    maxWorker: 4,
  });

  private chunksTracker: [Coords2, number][] = [];

  private isTrackingChunks = false;

  /**
   * Create a new Voxelize world.
   *
   * @param options The options to create the world.
   */
  constructor(options: Partial<WorldOptions> = {}) {
    super();

    // @ts-ignore
    const { statsSyncInterval } = (this.options = {
      ...defaultOptions,
      ...options,
    });

    this.setupComponents();
    this.setupUniforms();

    setInterval(() => {
      this.packets.push({
        type: "METHOD",
        method: {
          name: "builtin:get-stats",
          payload: {},
        },
      });
    }, statsSyncInterval);
  }

  async meshChunkLocally(cx: number, cz: number, level: number) {
    const neighbors = [
      [-1, -1],
      [0, -1],
      [1, -1],
      [-1, 0],
      [0, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
    ];

    const chunks = neighbors.map(([dx, dz]) =>
      this.getChunkByCoords(cx + dx, cz + dz)
    );

    const centerChunk = chunks[4];
    const { min, max } = centerChunk;
    const heightPerSubChunk = Math.floor(
      this.options.maxHeight / this.options.subChunks
    );
    const subChunkMin = [min[0], heightPerSubChunk * level, min[2]];
    const subChunkMax = [max[0], heightPerSubChunk * (level + 1), max[2]];

    const chunksData: any[] = [];
    const arrayBuffers: ArrayBuffer[] = [];

    for (const chunk of chunks) {
      if (!chunk) {
        chunksData.push(null);
      }

      const [chunkData, chunkArrayBuffers] = chunk.serialize();

      chunksData.push(chunkData);
      arrayBuffers.push(...chunkArrayBuffers);
    }

    const data = {
      chunksData,
      options: this.options,
      min: subChunkMin,
      max: subChunkMax,
    };

    // Make sure it's not already processed by the server
    if (this.chunks.toProcess.find((c) => c.x === cx && c.z === cz)) {
      return;
    }

    const { geometries } = await new Promise<{
      geometries: GeometryProtocol[];
    }>((resolve) => {
      this.meshWorkerPool.addJob({
        message: data,
        buffers: arrayBuffers,
        resolve,
      });
    });

    // Make sure it's not already processed by the server
    if (this.chunks.toProcess.find((c) => c.x === cx && c.z === cz)) {
      return;
    }

    const mesh: MeshProtocol = {
      level,
      geometries: geometries.map((geometry) => ({
        indices: Array.from(geometry.indices),
        positions: Array.from(geometry.positions),
        uvs: Array.from(geometry.uvs),
        lights: Array.from(geometry.lights),
        voxel: geometry.voxel,
        faceName: geometry.faceName,
      })),
    };

    const chunk = this.getChunkByCoords(cx, cz);

    // This means the server was faster than the client, so we can just ignore this.
    if (!chunk.isDirty) {
      return;
    }

    chunk.isDirty = false;

    this.buildChunkMesh(cx, cz, mesh);
  }

  /**
   * Apply a texture to a face or faces of a block. This will automatically load the image from the source
   * and draw it onto the block's texture atlas.
   *
   * @param idOrName The ID or name of the block.
   * @param faceNames The face names to apply the texture to.
   * @param source The source of the texture.
   */
  async applyBlockTexture(
    idOrName: number | string,
    faceNames: string | string[],
    source: string | Color | HTMLImageElement | Texture
  ) {
    this.checkIsInitialized("apply block texture", false);

    const block = this.getBlockOf(idOrName);

    faceNames = Array.isArray(faceNames) ? faceNames : [faceNames];

    // If it is a string, load the image.
    const data =
      typeof source === "string" ? await this.loader.loadImage(source) : source;

    faceNames.forEach((faceName) => {
      const face = block.faces.find((f) => f.name === faceName);

      if (!face) {
        throw new Error(
          `Face "${faceName}" does not exist on block "${block.name}"`
        );
      }

      const mat = this.getBlockFaceMaterial(block.id, faceName);

      // If the face is independent, that means this face does not share a texture atlas with other faces.
      // In this case, we can just set the map to the texture.
      if (face.independent) {
        if (source instanceof Texture) {
          mat.map = source;
          mat.uniforms.map = { value: source };
        } else if (data instanceof HTMLImageElement) {
          mat.map.image = data;
        }

        return;
      }

      // Otherwise, we need to draw the image onto the texture atlas.
      const atlas = mat.map as AtlasTexture;
      atlas.drawImageToRange(face.range, data);
    });
  }

  /**
   * Apply multiple block textures at once. See {@link applyBlockTexture} for more information.
   *
   * @param data The data to apply the block textures.
   * @returns A promise that resolves when all the textures are applied.
   */
  async applyBlockTextures(
    data: {
      idOrName: number | string;
      faceNames: string | string[];
      source: string | Color;
    }[]
  ) {
    return Promise.all(
      data.map(({ idOrName, faceNames, source }) =>
        this.applyBlockTexture(idOrName, faceNames, source)
      )
    );
  }

  /**
   * Apply a set of keyframes to a block. This will load the keyframes from the sources and start the animation
   * to play the keyframes on the block's texture atlas.
   *
   * @param idOrName The ID or name of the block.
   * @param faceNames The face name or names to apply the texture to.
   * @param keyframes The keyframes to apply to the texture.
   * @param fadeFrames The number of frames to fade between each keyframe.
   */
  async applyBlockFrames(
    idOrName: number | string,
    faceNames: string | string[],
    keyframes: [number, string | Color | HTMLImageElement][],
    fadeFrames = 0
  ) {
    this.checkIsInitialized("apply block animation", false);

    const block = this.getBlockOf(idOrName);

    const realKeyframes = [];

    // Convert string sources to images.
    for (const [duration, source] of keyframes) {
      if (typeof source === "string") {
        realKeyframes.push([duration, await this.loader.loadImage(source)]);
        continue;
      }

      realKeyframes.push([duration, source]);
    }

    faceNames = Array.isArray(faceNames) ? faceNames : [faceNames];

    faceNames.forEach((faceName) => {
      const face = block.faces.find((f) => f.name === faceName);

      if (!face) {
        throw new Error(
          `Face "${faceName}" does not exist on block "${block.name}"`
        );
      }

      const mat = this.getBlockFaceMaterial(block.id, faceName);

      // If the block's material is not set up to an atlas texture, we need to set it up.
      if (!(mat.map instanceof AtlasTexture)) {
        const { image } = mat.map;

        if (image && image.width) {
          const atlas = new AtlasTexture(1, image.width);
          atlas.drawImageToRange(face.range, image);

          mat.map.dispose();
          mat.map = atlas;
          mat.uniforms.map = { value: atlas };
          mat.needsUpdate = true;
        } else {
          throw new Error(
            `Cannot animate face "${faceName}" on block "${block.name}" because it does not have a texture.`
          );
        }
      }

      // Register the animation. This will start the animation.
      (mat.map as AtlasTexture).registerAnimation(
        face.range,
        realKeyframes,
        fadeFrames
      );
    });
  }

  /**
   * Apply a GIF animation to a block. This will load the GIF from the source and start the animation
   * using {@link applyBlockFrames} internally.
   *
   * @param idOrName The ID or name of the block.
   * @param faceNames The face name or names to apply the texture to.
   * @param source The source of the GIF. Note that this must be a GIF file ending with `.gif`.
   * @param interval The interval between each frame of the GIF in milliseconds. Defaults to `66.666667ms`.
   */
  async applyBlockGif(
    idOrName: string,
    faceNames: string[] | string,
    source: string,
    interval = 66.666667
  ) {
    this.checkIsInitialized("apply GIF animation", false);

    if (!source.endsWith(".gif")) {
      console.warn(
        "There's a chance that this file isn't a GIF as it doesn't end with .gif"
      );
    }

    // Load the keyframes from this GIF.
    const images = await this.loader.loadGifImages(source);

    const keyframes = images.map(
      (image) => [interval, image] as [number, HTMLImageElement]
    );

    await this.applyBlockFrames(idOrName, faceNames, keyframes);
  }

  /**
   * Apply a resolution to a block. This will set the resolution of the block's texture atlas.
   * Keep in mind that this face or faces must be independent.
   *
   * @param idOrName The ID or name of the block.
   * @param faceNames The face name or names to apply the resolution to.
   * @param resolution The resolution to apply to the block, in pixels.
   */
  setResolutionOf(
    idOrName: number | string,
    faceNames: string | string[],
    resolution: number
  ) {
    this.checkIsInitialized("apply resolution", false);

    const block = this.getBlockOf(idOrName);

    faceNames = Array.isArray(faceNames) ? faceNames : [faceNames];

    faceNames.forEach((faceName) => {
      const face = block.faces.find((f) => f.name === faceName);

      if (!face) {
        throw new Error(
          `Face "${faceName}" does not exist on block "${block.name}"`
        );
      }

      if (!face.independent) {
        throw new Error(
          `Cannot apply resolution to face "${faceName}" on block "${block.name}" because it is not independent.`
        );
      }

      const mat = this.getBlockFaceMaterial(block.id, faceName);

      // We know that this atlas texture will only be used for one single face.
      if (mat.map instanceof AtlasTexture) {
        throw new Error(
          "Cannot apply resolution to a face that is using an atlas texture. Have you accidentally applied keyframes to this face?"
        );
      }

      const canvas = mat.map.image;

      if (!canvas) {
        throw new Error(
          `Cannot apply resolution to face "${faceName}" on block "${block.name}" because it does not have a texture.`
        );
      }

      canvas.width = resolution;
      canvas.height = resolution;
    });
  }

  /**
   * Get a chunk by its name.
   *
   * @param name The name of the chunk to get.
   * @returns The chunk with the given name, or undefined if it does not exist.
   */
  getChunkByName(name: string) {
    this.checkIsInitialized("get chunk by name", false);
    return this.chunks.loaded.get(name);
  }

  /**
   * Get a chunk by its 2D coordinates.
   *
   * @param cx The x coordinate of the chunk.
   * @param cz The z coordinate of the chunk.
   * @returns The chunk at the given coordinates, or undefined if it does not exist.
   */
  getChunkByCoords(cx: number, cz: number) {
    this.checkIsInitialized("get chunk by coords", false);
    const name = ChunkUtils.getChunkName([cx, cz]);
    return this.getChunkByName(name);
  }

  /**
   * Get a chunk that contains a given position.
   *
   * @param px The x coordinate of the position.
   * @param py The y coordinate of the position.
   * @param pz The z coordinate of the position.
   * @returns The chunk that contains the position at the given position, or undefined if it does not exist.
   */
  getChunkByPosition(px: number, py: number, pz: number) {
    this.checkIsInitialized("get chunk by position", false);
    const coords = ChunkUtils.mapVoxelToChunk(
      [px | 0, py | 0, pz | 0],
      this.options.chunkSize
    );
    return this.getChunkByCoords(...coords);
  }

  /**
   * Get a voxel by a 3D world position.
   *
   * @param px The x coordinate of the position.
   * @param py The y coordinate of the position.
   * @param pz The z coordinate of the position.
   * @returns The voxel at the given position, or 0 if it does not exist.
   */
  getVoxelAt(px: number, py: number, pz: number) {
    this.checkIsInitialized("get voxel", false);
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return 0;
    return chunk.getVoxel(px, py, pz);
  }

  setVoxelAt(px: number, py: number, pz: number, voxel: number) {
    this.checkIsInitialized("set voxel", false);
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return;
    chunk.setVoxel(px, py, pz, voxel);
    this.trackChunkAt(px, py, pz);
  }

  /**
   * Get a voxel rotation by a 3D world position.
   *
   * @param px The x coordinate of the position.
   * @param py The y coordinate of the position.
   * @param pz The z coordinate of the position.
   * @returns The voxel rotation at the given position, or the default rotation if it does not exist.
   */
  getVoxelRotationAt(px: number, py: number, pz: number) {
    this.checkIsInitialized("get voxel rotation", false);
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return new BlockRotation();
    return chunk.getVoxelRotation(px, py, pz);
  }

  /**
   * Set a voxel rotation at a 3D world position.
   *
   * @param px The x coordinate of the position.
   * @param py The y coordinate of the position.
   * @param pz The z coordinate of the position.
   * @param rotation The rotation to set.
   */
  setVoxelRotationAt(
    px: number,
    py: number,
    pz: number,
    rotation: BlockRotation
  ) {
    this.checkIsInitialized("set voxel rotation", false);
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return;
    chunk.setVoxelRotation(px, py, pz, rotation);
    this.trackChunkAt(px, py, pz);
  }

  /**
   * Get a voxel stage by a 3D world position.
   *
   * @param px The x coordinate of the position.
   * @param py The y coordinate of the position.
   * @param pz The z coordinate of the position.
   * @returns The voxel stage at the given position, or 0 if it does not exist.
   */
  getVoxelStageAt(px: number, py: number, pz: number) {
    this.checkIsInitialized("get voxel stage", false);
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return 0;
    return chunk.getVoxelStage(px, py, pz);
  }

  /**
   * Get a voxel sunlight by a 3D world position.
   *
   * @param px The x coordinate of the position.
   * @param py The y coordinate of the position.
   * @param pz The z coordinate of the position.
   * @returns The voxel sunlight at the given position, or 0 if it does not exist.
   */
  getSunlightAt(px: number, py: number, pz: number) {
    this.checkIsInitialized("get sunlight", false);
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return 0;
    return chunk.getSunlight(px, py, pz);
  }

  setSunlightAt(px: number, py: number, pz: number, level: number) {
    this.checkIsInitialized("set sunlight", false);
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return;
    chunk.setSunlight(px, py, pz, level);
    this.trackChunkAt(px, py, pz);
  }

  /**
   * Get a voxel torch light by a 3D world position.
   *
   * @param px The x coordinate of the position.
   * @param py The y coordinate of the position.
   * @param pz The z coordinate of the position.
   * @param color The color of the torch light.
   * @returns The voxel torchlight at the given position, or 0 if it does not exist.
   */
  getTorchLightAt(px: number, py: number, pz: number, color: LightColor) {
    this.checkIsInitialized("get torch light", false);
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return 0;
    return chunk.getTorchLight(px, py, pz, color);
  }

  setTorchLightAt(
    px: number,
    py: number,
    pz: number,
    level: number,
    color: LightColor
  ) {
    this.checkIsInitialized("set torch light", false);
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return;
    chunk.setTorchLight(px, py, pz, level, color);
    this.trackChunkAt(px, py, pz);
  }

  /**
   * Get a color instance that represents what an object would be like
   * if it were rendered at the given 3D voxel coordinate. This is useful
   * to dynamically shade objects based on their position in the world. Also
   * used in {@link LightShined}.
   *
   * @param vx The voxel's X position.
   * @param vy The voxel's Y position.
   * @param vz The voxel's Z position.
   * @returns The voxel's light color at the given coordinate.
   */
  getLightColorAt(vx: number, vy: number, vz: number) {
    this.checkIsInitialized("get light color", false);

    const sunlight = this.getSunlightAt(vx, vy, vz);
    const redLight = this.getTorchLightAt(vx, vy, vz, "RED");
    const greenLight = this.getTorchLightAt(vx, vy, vz, "GREEN");
    const blueLight = this.getTorchLightAt(vx, vy, vz, "BLUE");

    const { sunlightIntensity, minLightLevel } = this.chunks.uniforms;

    const s = Math.min(
      (sunlight / this.options.maxLightLevel) ** 2 *
        sunlightIntensity.value *
        (1 - minLightLevel.value) +
        minLightLevel.value,
      1
    );

    return new Color(
      s + Math.pow(redLight / this.options.maxLightLevel, 2),
      s + Math.pow(greenLight / this.options.maxLightLevel, 2),
      s + Math.pow(blueLight / this.options.maxLightLevel, 2)
    );
  }

  /**
   * Get the block type data by a 3D world position.
   *
   * @param px The x coordinate of the position.
   * @param py The y coordinate of the position.
   * @param pz The z coordinate of the position.
   * @returns The block at the given position, or null if it does not exist.
   */
  getBlockAt(px: number, py: number, pz: number) {
    this.checkIsInitialized("get block", false);
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return null;
    const id = chunk.getVoxel(px, py, pz);
    return this.getBlockById(id);
  }

  /**
   * Get the highest block at a x/z position. Highest block means the first block counting downwards that
   * isn't empty (`isEmpty`).
   *
   * @param px The x coordinate of the position.
   * @param pz The z coordinate of the position.
   * @returns The highest block at the given position, or 0 if it does not exist.
   */
  getMaxHeightAt(px: number, pz: number) {
    this.checkIsInitialized("get max height", false);

    const vx = px | 0;
    const vz = pz | 0;

    for (let vy = this.options.maxHeight - 1; vy >= 0; vy--) {
      const block = this.getBlockAt(vx, vy, vz);

      if (!block.isEmpty) {
        return vy;
      }
    }

    return 0;
  }

  /**
   * Get the previous value of a voxel by a 3D world position.
   *
   * @param px The x coordinate of the position.
   * @param py The y coordinate of the position.
   * @param pz The z coordinate of the position.
   * @param count By how much to look back in the history. Defaults to `1`.
   * @returns
   */
  getPreviousValueAt(px: number, py: number, pz: number, count = 1) {
    const name = ChunkUtils.getVoxelName([px | 0, py | 0, pz | 0]);
    const arr = this.oldBlocks.get(name) || [];
    return arr[arr.length - count] || 0;
  }

  getBlockOf(idOrName: number | string) {
    if (typeof idOrName === "number") {
      return this.getBlockById(idOrName);
    }

    return this.getBlockByName(idOrName.toLowerCase());
  }

  /**
   * Get the block type data by a block id.
   *
   * @param id The block id.
   * @returns The block data for the given id, or null if it does not exist.
   */
  getBlockById(id: number) {
    const block = this.registry.blocksById.get(id);

    if (!block) {
      throw new Error(`Block with id ${id} does not exist`);
    }

    return block;
  }

  /**
   * Get the block type data by a block name.
   *
   * @param name The block name.
   * @returns The block data for the given name, or null if it does not exist.
   */
  getBlockByName(name: string) {
    const block = this.registry.blocksByName.get(name.toLowerCase());

    if (!block) {
      throw new Error(`Block with name ${name} does not exist`);
    }

    return block;
  }

  /**
   * Get the status of a chunk.
   *
   * @param cx The x 2D coordinate of the chunk.
   * @param cz The z 2D coordinate of the chunk.
   * @returns The status of the chunk.
   */
  getChunkStatus(
    cx: number,
    cz: number
  ): "to request" | "requested" | "processing" | "loaded" {
    const name = ChunkUtils.getChunkName([cx, cz]);

    const isRequested = this.chunks.requested.has(name);
    const isLoaded = this.chunks.loaded.has(name);
    const isProcessing = !!this.chunks.toProcess.find(
      ({ x, z }) => x === cx && z === cz
    );
    const isToRequest = !!this.chunks.toRequest.find(
      ([x, z]) => x === cx && z === cz
    );

    // Check if more than one is true. If that is the case, throw an error.
    if (
      (isRequested && isProcessing) ||
      (isRequested && isToRequest) ||
      (isProcessing && isToRequest)
    ) {
      throw new Error(
        `Chunk ${name} is in more than one state other than the loaded state. This should not happen. These are the states: requested: ${isRequested}, loaded: ${isLoaded}, processing: ${isProcessing}, to request: ${isToRequest}`
      );
    }

    if (isLoaded) return "loaded";
    if (isProcessing) return "processing";
    if (isRequested) return "requested";
    if (isToRequest) return "to request";

    return null;
  }

  getBlockFaceMaterial(idOrName: number | string, faceName?: string) {
    this.checkIsInitialized("get material", false);

    const block = this.getBlockOf(idOrName);

    if (faceName && block.independentFaces.has(faceName)) {
      return this.chunks.materials.get(
        this.makeChunkMaterialKey(block.id, faceName)
      );
    }

    return this.chunks.materials.get(this.makeChunkMaterialKey(block.id));
  }

  /**
   * Add a listener to a chunk. This listener will be called when this chunk is loaded and ready to be rendered.
   * This is useful for, for example, teleporting the player to the top of the chunk when the player just joined.
   *
   * @param coords The chunk coordinates to listen to.
   * @param listener The listener to add.
   */
  addChunkInitListener = (
    coords: Coords2,
    listener: (chunk: Chunk) => void
  ) => {
    const name = ChunkUtils.getChunkName(coords);

    if (this.chunks.loaded.has(name)) {
      listener(this.chunks.loaded.get(name));
      return;
    }

    const listeners = this.chunkInitializeListeners.get(name) || [];
    listeners.push(listener);
    this.chunkInitializeListeners.set(name, listeners);
  };

  addBlockUpdateListener = (listener: BlockUpdateListener) => {
    this.blockUpdateListeners.add(listener);
  };

  /**
   * Whether or not if this chunk coordinate is within (inclusive) the world's bounds. That is, if this chunk coordinate
   * is within {@link WorldServerOptions | WorldServerOptions.minChunk} and {@link WorldServerOptions | WorldServerOptions.maxChunk}.
   *
   * @param cx The chunk's X position.
   * @param cz The chunk's Z position.
   * @returns Whether or not this chunk is within the bounds of the world.
   */
  isWithinWorld(cx: number, cz: number) {
    const { minChunk, maxChunk } = this.options;

    return (
      cx >= minChunk[0] &&
      cx <= maxChunk[0] &&
      cz >= minChunk[1] &&
      cz <= maxChunk[1]
    );
  }

  isChunkInView(
    center: Coords2,
    target: Coords2,
    direction: Vector3,
    threshold: number
  ) {
    const [cx, cz] = center;
    const [tx, tz] = target;

    if (
      (cx - tx) ** 2 + (cz - tz) ** 2 <
      Math.floor(this.renderRadius / 2) ** 2
    ) {
      return true;
    }

    const vec1 = new Vector3(tz - cz, tx - cx, 0);
    const vec2 = new Vector3(direction.z, direction.x, 0);

    const angle = MathUtils.normalizeAngle(vec1.angleTo(vec2));

    return Math.abs(angle) < threshold;
  }

  /**
   * Raycast through the world of voxels and return the details of the first block intersection.
   *
   * @param origin The origin of the ray.
   * @param direction The direction of the ray.
   * @param maxDistance The maximum distance of the ray.
   * @param options The options for the ray.
   * @param options.ignoreFluids Whether or not to ignore fluids. Defaults to `true`.
   * @param options.ignorePassables Whether or not to ignore passable blocks. Defaults to `false`.
   * @param options.ignoreSeeThrough Whether or not to ignore see through blocks. Defaults to `false`.
   * @param options.ignoreList A list of blocks to ignore. Defaults to `[]`.
   * @returns
   */
  raycastVoxels = (
    origin: Coords3,
    direction: Coords3,
    maxDistance: number,
    options: {
      ignoreFluids?: boolean;
      ignorePassables?: boolean;
      ignoreSeeThrough?: boolean;
      ignoreList?: number[];
    } = {}
  ) => {
    this.checkIsInitialized("raycast voxels", false);

    const { ignoreFluids, ignorePassables, ignoreSeeThrough } = {
      ignoreFluids: true,
      ignorePassables: false,
      ignoreSeeThrough: false,
      ...options,
    };

    const ignoreList = new Set(options.ignoreList || []);

    return raycast(
      (wx, wy, wz) => {
        const block = this.getBlockAt(wx, wy, wz);

        if (!block) {
          return [];
        }

        const {
          id,
          isFluid,
          isPassable,
          isSeeThrough,
          aabbs,
          dynamicFn,
          isDynamic,
        } = block;

        if (ignoreList.has(id)) {
          return [];
        }

        if (isDynamic && !dynamicFn) {
          console.warn(
            `Block of ID ${id} is dynamic but has no dynamic function.`
          );
        }

        if (
          (isFluid && ignoreFluids) ||
          (isPassable && ignorePassables) ||
          (isSeeThrough && ignoreSeeThrough)
        ) {
          return [];
        }

        const rotation = this.getVoxelRotationAt(wx, wy, wz);

        return (
          isDynamic
            ? dynamicFn
              ? dynamicFn([wx | 0, wy | 0, wz | 0]).aabbs
              : aabbs
            : aabbs
        ).map((aabb) => rotation.rotateAABB(aabb));
      },
      origin,
      direction,
      maxDistance
    );
  };

  /**
   * This sends a block update to the server and updates across the network. Block updates are queued to
   * {@link World.chunks | World.chunks.toUpdate} and scaffolded to the server {@link WorldClientOptions | WorldClientOptions.maxUpdatesPerUpdate} times
   * per tick. Keep in mind that for rotation and y-rotation, the value should be one of the following:
   * - Rotation: {@link PX_ROTATION} | {@link NX_ROTATION} | {@link PY_ROTATION} | {@link NY_ROTATION} | {@link PZ_ROTATION} | {@link NZ_ROTATION}
   * - Y-rotation: 0 to {@link Y_ROT_SEGMENTS} - 1.
   *
   * This ignores blocks that are not defined, and also ignores rotations for blocks that are not {@link Block | Block.rotatable} (Same for if
   * block is not {@link Block | Block.yRotatable}).
   *
   * @param vx The voxel's X position.
   * @param vy The voxel's Y position.
   * @param vz The voxel's Z position.
   * @param type The type of the voxel.
   * @param rotation The major axis rotation of the voxel.
   * @param yRotation The Y rotation on the major axis. Applies to blocks with major axis of PY or NY.
   */
  updateVoxel = (
    vx: number,
    vy: number,
    vz: number,
    type: number,
    rotation = PY_ROTATION,
    yRotation = 0
  ) => {
    this.updateVoxels([{ vx, vy, vz, type, rotation, yRotation }]);
  };

  /**
   * This sends a list of block updates to the server and updates across the network. Block updates are queued to
   * {@link World.chunks | World.chunks.toUpdate} and scaffolded to the server {@link WorldClientOptions | WorldClientOptions.maxUpdatesPerUpdate} times
   * per tick. Keep in mind that for rotation and y-rotation, the value should be one of the following:
   *
   * - Rotation: {@link PX_ROTATION} | {@link NX_ROTATION} | {@link PY_ROTATION} | {@link NY_ROTATION} | {@link PZ_ROTATION} | {@link NZ_ROTATION}
   * - Y-rotation: 0 to {@link Y_ROT_SEGMENTS} - 1.
   *
   * This ignores blocks that are not defined, and also ignores rotations for blocks that are not {@link Block | Block.rotatable} (Same for if
   * block is not {@link Block | Block.yRotatable}).
   *
   * @param updates A list of updates to send to the server.
   */
  updateVoxels = (updates: BlockUpdate[]) => {
    this.checkIsInitialized("update voxels", false);

    const voxelUpdates = updates
      .filter((update) => {
        if (update.vy < 0 || update.vy >= this.options.maxHeight) {
          return false;
        }

        const { vx, vy, vz, type, rotation, yRotation } = update;

        const currId = this.getVoxelAt(vx, vy, vz);
        const currRot = this.getVoxelRotationAt(vx, vy, vz);

        if (!this.getBlockById(type)) {
          console.warn(`Block ID ${type} does not exist.`);
          return false;
        }

        if (
          currId === type &&
          (rotation !== undefined ? currRot.value === rotation : false) &&
          (yRotation !== undefined ? currRot.yRotation === yRotation : false)
        ) {
          return false;
        }

        return true;
      })
      .map((update) => {
        if (isNaN(update.rotation)) {
          update.rotation = 0;
        }

        if (!this.getBlockById(update.type).yRotatable) {
          update.yRotation = 0;
        }

        return update;
      });

    this.chunks.toUpdate.push(...voxelUpdates);
  };

  floodLight(
    queue: LightNode[],
    color: LightColor,
    min?: Coords3,
    max?: Coords3
  ) {
    if (!queue.length) {
      return;
    }

    const { maxHeight, minChunk, maxChunk, maxLightLevel, chunkSize } =
      this.options;

    const [startCX, startCZ] = minChunk;
    const [endCX, endCZ] = maxChunk;

    const isSunlight = color === "SUNLIGHT";

    while (queue.length) {
      const node = queue.shift();
      const { voxel, level } = node;

      if (level === 0) {
        continue;
      }

      const [vx, vy, vz] = voxel;
      const sourceBlock = this.getBlockAt(vx, vy, vz);
      const sourceTransparency =
        !isSunlight &&
        BlockUtils.getBlockTorchLightLevel(sourceBlock, color) > 0
          ? [true, true, true, true, true, true]
          : BlockUtils.getBlockRotatedTransparency(
              sourceBlock,
              this.getVoxelRotationAt(vx, vy, vz)
            );

      for (const [ox, oy, oz] of VOXEL_NEIGHBORS) {
        const nvy = vy + oy;

        if (nvy < 0 || nvy >= maxHeight) {
          continue;
        }

        const nvx = vx + ox;
        const nvz = vz + oz;

        const [ncx, ncz] = ChunkUtils.mapVoxelToChunk(
          [nvx, nvy, nvz],
          chunkSize
        );

        if (
          ncx < startCX ||
          ncx > endCX ||
          ncz < startCZ ||
          ncz > endCZ ||
          (min && (nvx < min[0] || nvz < min[2])) ||
          (max && (nvx > max[0] || nvz > max[2]))
        ) {
          continue;
        }

        const nextVoxel = [nvx, nvy, nvz] as Coords3;
        const nBlock = this.getBlockAt(nvx, nvy, nvz);
        const nTransparency = BlockUtils.getBlockRotatedTransparency(
          nBlock,
          this.getVoxelRotationAt(nvx, nvy, nvz)
        );
        const nextLevel =
          level -
          (isSunlight &&
          !nBlock.lightReduce &&
          oy === -1 &&
          level === maxLightLevel
            ? 0
            : 1);

        if (
          !LightUtils.canEnter(sourceTransparency, nTransparency, ox, oy, oz) ||
          (isSunlight
            ? this.getSunlightAt(nvx, nvy, nvz)
            : this.getTorchLightAt(nvx, nvy, nvz, color)) >= nextLevel
        ) {
          continue;
        }

        if (isSunlight) {
          this.setSunlightAt(nvx, nvy, nvz, nextLevel);
        } else {
          this.setTorchLightAt(nvx, nvy, nvz, nextLevel, color);
        }

        queue.unshift({ voxel: nextVoxel, level: nextLevel });
      }
    }
  }

  public removeLight(voxel: Coords3, color: LightColor) {
    const { maxHeight, maxLightLevel, chunkSize, minChunk, maxChunk } =
      this.options;

    const fill: LightNode[] = [];
    const queue: LightNode[] = [];

    const isSunlight = color === "SUNLIGHT";
    const [vx, vy, vz] = voxel;

    queue.push({
      voxel,
      level: isSunlight
        ? this.getSunlightAt(vx, vy, vz)
        : this.getTorchLightAt(vx, vy, vz, color),
    });

    if (isSunlight) {
      this.setSunlightAt(vx, vy, vz, 0);
    } else {
      this.setTorchLightAt(vx, vy, vz, 0, color);
    }

    while (queue.length) {
      const node = queue.shift();
      const { voxel, level } = node;

      const [vx, vy, vz] = voxel;

      for (const [ox, oy, oz] of VOXEL_NEIGHBORS) {
        const nvy = vy + oy;

        if (nvy < 0 || nvy >= maxHeight) {
          continue;
        }

        const nvx = vx + ox;
        const nvz = vz + oz;
        const [ncx, ncz] = ChunkUtils.mapVoxelToChunk(
          [nvx, nvy, nvz],
          chunkSize
        );

        if (
          ncx < minChunk[0] ||
          ncz < minChunk[1] ||
          ncx > maxChunk[0] ||
          ncz > maxChunk[1]
        ) {
          continue;
        }

        const nBlock = this.getBlockAt(nvx, nvy, nvz);
        const rotation = this.getVoxelRotationAt(nvx, nvy, nvz);
        const nTransparency = BlockUtils.getBlockRotatedTransparency(
          nBlock,
          rotation
        );

        if (
          (isSunlight
            ? true
            : BlockUtils.getBlockTorchLightLevel(nBlock, color) === 0) &&
          !LightUtils.canEnterInto(nTransparency, ox, oy, oz)
        ) {
          continue;
        }

        const nVoxel = [nvx, nvy, nvz] as Coords3;
        const nl = isSunlight
          ? this.getSunlightAt(nvx, nvy, nvz)
          : this.getTorchLightAt(nvx, nvy, nvz, color);

        if (nl === 0) {
          continue;
        }

        if (
          nl < level ||
          (isSunlight &&
            oy === -1 &&
            level === maxLightLevel &&
            nl === maxLightLevel)
        ) {
          queue.push({ voxel: nVoxel, level: nl });

          if (isSunlight) {
            this.setSunlightAt(nvx, nvy, nvz, 0);
          } else {
            this.setTorchLightAt(nvx, nvy, nvz, 0, color);
          }
        } else if (isSunlight && oy === -1 ? nl > level : nl >= level) {
          fill.push({ voxel: nVoxel, level: nl });
        }
      }
    }

    this.floodLight(fill, color);
  }

  /**
   * Get a mesh of the model of the given block.
   *
   * @param id The ID of the block.
   * @param options The options of creating this block mesh.
   * @param options.material The type of material to use for this generated mesh.
   * @param options.separateFaces: Whether or not to separate the faces of the block into different meshes.
   * @param options.crumbs: Whether or not to mess up the block mesh's faces and UVs to make it look like crumbs.
   * @returns A 3D mesh (group) of the block model.
   */
  makeBlockMesh = (
    idOrName: number | string,
    options: Partial<{
      separateFaces: boolean;
      crumbs: boolean;
      material: "basic" | "standard";
    }> = {}
  ) => {
    this.checkIsInitialized("make block mesh", false);

    if (!idOrName) {
      return null;
    }

    const block = this.getBlockOf(idOrName);
    if (!block) return null;

    const { separateFaces, crumbs, material } = {
      separateFaces: false,
      crumbs: false,
      material: "basic",
      ...options,
    };

    const { faces, isSeeThrough } = block;

    const geometries = new Map<
      string,
      {
        identifier: string;
        positions: number[];
        uvs: number[];
        indices: number[];
        material: MeshStandardMaterial | MeshBasicMaterial;
      }
    >();

    faces.forEach((face, index) => {
      const faceScale = crumbs && separateFaces ? Math.random() + 0.5 : 1;

      const { corners, name, range } = face;

      const identifier = `${block.name}-${name}-${
        separateFaces ? index : "all"
      }`;

      let geometry = geometries.get(identifier);

      if (!geometry) {
        const chunkMat = this.getBlockFaceMaterial(block.id, name);

        const matOptions = {
          transparent: isSeeThrough,
          map: chunkMat.map,
          side: isSeeThrough ? TwoPassDoubleSide : FrontSide,
        };

        const mat =
          material === "basic"
            ? new MeshBasicMaterial(matOptions)
            : new MeshStandardMaterial(matOptions);

        geometry = {
          identifier,
          positions: [],
          uvs: [],
          indices: [],
          material: mat,
        };
      }

      const { positions, uvs, indices } = geometry;

      const ndx = Math.floor(positions.length / 3);
      let { startU, endU, startV, endV } = range;

      if (crumbs) {
        if (Math.random() < 0.5) {
          startU = startU + ((endU - startU) / 2) * Math.random();
          endV = endV - ((endV - startV) / 2) * Math.random();
        } else {
          endU = endU - ((endU - startU) / 2) * Math.random();
          startV = startV + ((endV - startV) / 2) * Math.random();
        }
      }

      corners.forEach(({ uv, pos }) => {
        positions.push(...pos.map((p) => p * faceScale));
        uvs.push(
          uv[0] * (endU - startU) + startU,
          uv[1] * (endV - startV) + startV
        );
      });

      indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);

      geometries.set(identifier, geometry);
    });

    const group = new Group();

    geometries.forEach(({ identifier, positions, uvs, indices, material }) => {
      const geometry = new BufferGeometry();
      geometry.setAttribute(
        "position",
        new Float32BufferAttribute(positions, 3)
      );
      geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const mesh = new Mesh(geometry, material);
      mesh.name = identifier;
      group.add(mesh);
    });

    group.name = block.name;

    group.position.x -= 0.5;
    group.position.y -= 0.5;
    group.position.z -= 0.5;

    return group;
  };

  customizeMaterialShaders = (
    idOrName: number | string,
    faceName: string | null = null,
    data: {
      vertexShader: string;
      fragmentShader: string;
      uniforms?: { [key: string]: Uniform };
    } = {
      vertexShader: DEFAULT_CHUNK_SHADERS.vertex,
      fragmentShader: DEFAULT_CHUNK_SHADERS.fragment,
      uniforms: {},
    }
  ) => {
    this.checkIsInitialized("customize material shaders", false);

    const {
      vertexShader = DEFAULT_CHUNK_SHADERS.vertex,
      fragmentShader = DEFAULT_CHUNK_SHADERS.fragment,
      uniforms = {},
    } = data;

    const mat = this.getBlockFaceMaterial(idOrName, faceName);

    if (!mat) {
      throw new Error(
        `Could not find material for block ${idOrName} and face ${faceName}`
      );
    }

    mat.vertexShader = vertexShader;
    mat.fragmentShader = fragmentShader;
    mat.uniforms = {
      ...mat.uniforms,
      ...uniforms,
    };
    mat.needsUpdate = true;

    return mat;
  };

  customizeBlockDynamic = (
    idOrName: number | string,
    fn: Block["dynamicFn"]
  ) => {
    this.checkIsInitialized("customize block dynamic", false);

    const block = this.getBlockOf(idOrName);

    if (!block) {
      throw new Error(
        `Block with ID ${idOrName} does not exist, could not overwrite dynamic function.`
      );
    }

    block.dynamicFn = fn;
  };

  /**
   * Initialize the world with the data received from the server. This includes populating
   * the registry, setting the options, and creating the texture atlas.
   */
  async initialize() {
    if (this.isInitialized) {
      console.warn("World has already been isInitialized.");
      return;
    }

    if (this.initialData === null) {
      throw new Error(
        "World has not received any initialization data from the server."
      );
    }

    const { blocks, options, stats } = this.initialData;

    this.time = stats.time;

    // Loading the registry
    Object.keys(blocks).forEach((name) => {
      const block = blocks[name];
      const { id, aabbs, isDynamic } = block;

      const lowerName = name.toLowerCase();

      block.independentFaces = new Set();

      block.faces.forEach((face) => {
        if (face.independent) {
          block.independentFaces.add(face.name);
        }
      });

      block.aabbs = aabbs.map(
        ({ minX, minY, minZ, maxX, maxY, maxZ }) =>
          new AABB(minX, minY, minZ, maxX, maxY, maxZ)
      );

      if (isDynamic) {
        block.dynamicFn = () => {
          return {
            aabbs: block.aabbs,
            faces: block.faces,
            isTransparent: block.isTransparent,
          };
        };
      }

      this.registry.blocksByName.set(lowerName, block);
      this.registry.blocksById.set(id, block);
      this.registry.nameMap.set(lowerName, id);
      this.registry.idMap.set(id, lowerName);
    });

    // Loading the options
    this.options = {
      ...this.options,
      ...options,
    };

    this.physics.options = this.options;

    await this.loadMaterials();

    const registryData = this.registry.serialize();
    this.meshWorkerPool.postMessage({ type: "init", registryData });

    this.isInitialized = true;

    this.renderRadius = this.options.defaultRenderRadius;
  }

  update(
    position: Vector3 = new Vector3(),
    direction: Vector3 = new Vector3()
  ) {
    if (!this.isInitialized) {
      return;
    }

    const delta = this.clock.getDelta();

    const center = ChunkUtils.mapVoxelToChunk(
      position.toArray() as Coords3,
      this.options.chunkSize
    );

    this._time = (this.time + delta) % this.options.timePerDay;

    this.maintainChunks(center, direction);
    this.requestChunks(center, direction);
    this.processChunks(center);

    this.updatePhysics(delta);
    this.updateUniforms();
    this.updateSkyAndClouds(position);

    this.emitServerUpdates();
  }

  /**
   * The message interceptor.
   *
   * @hidden
   */
  onMessage(message: MessageProtocol) {
    const { type } = message;

    switch (type) {
      case "INIT": {
        const { json } = message;

        this.initialData = json;

        break;
      }
      case "STATS": {
        const { json } = message;

        if (Math.abs(json.time - this.time) > this.options.timeForceThreshold) {
          this.time = json.time;
        }

        break;
      }
      case "LOAD": {
        const { chunks } = message;

        chunks.forEach((chunk) => {
          const { x, z } = chunk;
          const name = ChunkUtils.getChunkName([x, z]);

          // Only process if we're interested.
          this.chunks.requested.delete(name);
          this.chunks.toProcess.push(chunk);
        });

        break;
      }
      case "UPDATE": {
        const { updates, chunks } = message;

        // TODO: figure out how to do block cache
        updates.forEach((update) => {
          const { vx, vy, vz, light, voxel } = update;
          const chunk = this.getChunkByPosition(vx, vy, vz);

          const currentValue = chunk.getRawValue(vx, vy, vz);
          const currentLight = chunk.getRawLight(vx, vy, vz);

          if (currentValue === voxel && currentLight === light) {
            return;
          }

          this.attemptBlockCache(vx, vy, vz, voxel);

          if (chunk) {
            chunk.setRawValue(vx, vy, vz, voxel);
            chunk.setRawLight(vx, vy, vz, light);
          }
        });

        chunks.forEach((chunk) => {
          this.chunks.toProcess.unshift(chunk);
        });

        break;
      }
    }
  }

  get time() {
    return this._time;
  }

  set time(time: number) {
    this._time = time;
  }

  get renderRadius() {
    return this._renderRadius;
  }

  set renderRadius(radius: number) {
    this.checkIsInitialized("set render radius", false);

    radius = Math.floor(radius);

    this._renderRadius = radius;
    this._deleteRadius = radius * 1.1;

    const { chunkSize } = this.options;

    this.chunks.uniforms.fogNear.value = radius * 0.7 * chunkSize;
    this.chunks.uniforms.fogFar.value = radius * chunkSize;
  }

  get deleteRadius() {
    return this._deleteRadius;
  }

  private requestChunks(center: Coords2, direction: Vector3) {
    const {
      renderRadius,
      options: { chunkRerequestInterval, chunkLoadExponent },
    } = this;

    const total =
      this.chunks.loaded.size +
      this.chunks.requested.size +
      this.chunks.toRequest.length +
      this.chunks.toProcess.length;

    const ratio = this.chunks.loaded.size / total;
    const hasDirection = direction.length() > 0;

    const angleThreshold =
      ratio === 1
        ? (Math.PI * 3) / 8
        : Math.max(ratio ** chunkLoadExponent, 0.1);

    const [centerX, centerZ] = center;

    // Surrounding the center, request all chunks that are not loaded.
    for (let ox = -renderRadius; ox <= renderRadius; ox++) {
      for (let oz = -renderRadius; oz <= renderRadius; oz++) {
        if (ox * ox + oz * oz > renderRadius * renderRadius) continue;

        const cx = centerX + ox;
        const cz = centerZ + oz;

        if (!this.isWithinWorld(cx, cz)) {
          continue;
        }

        if (
          hasDirection &&
          !this.isChunkInView(center, [cx, cz], direction, angleThreshold)
        ) {
          continue;
        }

        const status = this.getChunkStatus(cx, cz);

        if (!status) {
          if (
            !this.chunks.toRequest.find(
              ([tcx, tcz]) => tcx === cx && tcz === cz
            )
          )
            this.chunks.toRequest.push([cx, cz]);
          continue;
        }

        if (status === "loaded") continue;

        if (status === "requested") {
          const name = ChunkUtils.getChunkName([cx, cz]);
          const count = this.chunks.requested.get(name);

          if (count + 1 > chunkRerequestInterval) {
            this.chunks.requested.delete(name);
            this.chunks.toRequest.push([cx, cz]);
          } else {
            this.chunks.requested.set(name, count + 1);
          }

          continue;
        }
      }
    }

    if (this.chunks.toRequest.length === 0) return;

    // Sort the chunks by distance from the center, closest first.
    this.chunks.toRequest.sort((a, b) => {
      const [ax, az] = a;
      const [bx, bz] = b;

      const ad = (ax - center[0]) ** 2 + (az - center[1]) ** 2;
      const bd = (bx - center[0]) ** 2 + (bz - center[1]) ** 2;

      return ad - bd;
    });

    const { maxChunkRequestsPerUpdate } = this.options;

    const toRequest = this.chunks.toRequest.splice(
      0,
      maxChunkRequestsPerUpdate
    );

    this.packets.push({
      type: "LOAD",
      json: {
        center,
        chunks: toRequest,
      },
    });

    toRequest.forEach((coords) => {
      const name = ChunkUtils.getChunkName(coords);
      this.chunks.requested.set(name, 0);
    });
  }

  private processChunks(center: Coords2) {
    if (this.chunks.toProcess.length === 0) return;

    // Sort the chunks by distance from the center, closest first.
    this.chunks.toProcess.sort((a, b) => {
      const { x: ax, z: az } = a;
      const { x: bx, z: bz } = b;

      const ad = (ax - center[0]) ** 2 + (az - center[1]) ** 2;
      const bd = (bx - center[0]) ** 2 + (bz - center[1]) ** 2;

      return ad - bd;
    });

    const {
      maxProcessesPerUpdate,
      chunkSize,
      maxHeight,
      subChunks,
      shouldGenerateChunkMeshes,
    } = this.options;

    const triggerInitListener = (chunk: Chunk) => {
      const listeners = this.chunkInitializeListeners.get(chunk.name);

      if (Array.isArray(listeners)) {
        listeners.forEach((listener) => listener(chunk));
        this.chunkInitializeListeners.delete(chunk.name);
      }
    };

    const toProcess = this.chunks.toProcess.splice(0, maxProcessesPerUpdate);

    toProcess.forEach((data) => {
      const { x, z, id, meshes } = data;
      const name = ChunkUtils.getChunkName([x, z]);

      let chunk = this.getChunkByCoords(x, z);

      if (!chunk) {
        chunk = new Chunk(id, [x, z], {
          maxHeight,
          subChunks,
          size: chunkSize,
        });
      }

      chunk.setData(data);
      chunk.isDirty = false;

      this.chunks.loaded.set(name, chunk);

      if (shouldGenerateChunkMeshes) {
        for (const mesh of meshes) {
          this.buildChunkMesh(x, z, mesh);
        }

        triggerInitListener(chunk);
      } else {
        triggerInitListener(chunk);
      }
    });
  }

  private maintainChunks(center: Coords2, direction: Vector3) {
    const { deleteRadius } = this;

    const [centerX, centerZ] = center;
    const deleted: Coords2[] = [];

    // Surrounding the center, delete all chunks that are too far away.
    this.chunks.loaded.forEach((chunk) => {
      const {
        name,
        coords: [x, z],
      } = chunk;

      // Too far away from center, delete.
      if ((x - centerX) ** 2 + (z - centerZ) ** 2 > deleteRadius ** 2) {
        const chunk = this.chunks.loaded.get(name);
        chunk.dispose();

        this.chunks.loaded.delete(name);

        deleted.push(chunk.coords);
      }
    });

    this.chunks.requested.forEach((_, name) => {
      const [x, z] = ChunkUtils.parseChunkName(name);

      if ((x - centerX) ** 2 + (z - centerZ) ** 2 > deleteRadius ** 2) {
        this.chunks.requested.delete(name);
        deleted.push([x, z]);
      }
    });

    const tempToRequest = [...this.chunks.toRequest];
    this.chunks.toRequest.length = 0;
    this.chunks.toRequest.push(
      ...tempToRequest.filter(([x, z]) => {
        return (x - centerX) ** 2 + (z - centerZ) ** 2 <= deleteRadius ** 2;
      })
    );

    const tempToProcess = [...this.chunks.toProcess];
    this.chunks.toProcess.length = 0;
    this.chunks.toProcess.push(
      ...tempToProcess.filter((chunk) => {
        const { x, z } = chunk;
        return (x - centerX) ** 2 + (z - centerZ) ** 2 <= deleteRadius ** 2;
      })
    );

    // Remove any listeners for deleted chunks.
    deleted.forEach((coords) => {
      const name = ChunkUtils.getChunkName(coords);
      this.chunkInitializeListeners.delete(name);
    });

    if (deleted.length) {
      this.packets.push({
        type: "UNLOAD",
        json: {
          chunks: deleted,
        },
      });
    }
  }

  private triggerBlockUpdateListeners(
    vx: number,
    vy: number,
    vz: number,
    oldValue: number,
    newValue: number
  ) {
    this.blockUpdateListeners.forEach((listener) =>
      listener({
        voxel: [vx, vy, vz],
        oldValue,
        newValue,
      })
    );
  }

  private attemptBlockCache(
    vx: number,
    vy: number,
    vz: number,
    newVal: number
  ) {
    const chunk = this.getChunkByPosition(vx, vy, vz);
    if (!chunk) return;

    const oldVal = chunk.getRawValue(vx, vy, vz);

    if (oldVal !== newVal) {
      const name = ChunkUtils.getVoxelName([vx, vy, vz]);
      const arr = this.oldBlocks.get(name) || [];
      arr.push(oldVal);
      this.oldBlocks.set(name, arr);
      this.triggerBlockUpdateListeners(vx, vy, vz, oldVal, newVal);
    }
  }

  /**
   * Update the physics engine by ticking all inner AABBs.
   */
  private updatePhysics = (delta: number) => {
    if (!this.physics || !this.options.gravity) return;

    const noGravity =
      this.options.gravity[0] ** 2 +
        this.options.gravity[1] ** 2 +
        this.options.gravity[2] ** 2 <
      0.01;

    this.physics.bodies.forEach((body) => {
      const coords = ChunkUtils.mapVoxelToChunk(
        body.getPosition() as Coords3,
        this.options.chunkSize
      );
      const chunk = this.getChunkByPosition(...(body.getPosition() as Coords3));

      if ((!chunk || !chunk.isReady) && this.isWithinWorld(...coords)) {
        return;
      }

      this.physics.iterateBody(body, delta, noGravity);
    });
  };

  public updateSkyAndClouds(position: Vector3) {
    const {
      sunlightStartTimeFrac,
      sunlightEndTimeFrac,
      sunlightChangeSpan,
      timePerDay,
      minLightLevel,
    } = this.options;

    this.sky.update(position, this.time, timePerDay);
    this.clouds.update(position);

    // Update the sunlight intensity
    const sunlightStartTime = Math.floor(sunlightStartTimeFrac * timePerDay);
    const sunlightEndTime = Math.floor(sunlightEndTimeFrac * timePerDay);
    const sunlightChangeSpanTime = Math.floor(sunlightChangeSpan * timePerDay);

    const sunlightIntensity = Math.max(
      minLightLevel,
      this.time < sunlightStartTime
        ? 0.0
        : this.time < sunlightStartTime + sunlightChangeSpanTime
        ? (this.time - sunlightStartTime) / sunlightChangeSpanTime
        : this.time <= sunlightEndTime
        ? 1.0
        : this.time <= sunlightEndTime + sunlightChangeSpanTime
        ? 1 - (this.time - sunlightEndTime) / sunlightChangeSpanTime
        : 0.0
    );

    this.chunks.uniforms.sunlightIntensity.value = sunlightIntensity;

    // Update the clouds' colors based on the sky's colors.
    const cloudColor = this.clouds.material.uniforms.uCloudColor.value;
    const cloudColorHSL = cloudColor.getHSL({});
    cloudColor.setHSL(
      cloudColorHSL.h,
      cloudColorHSL.s,
      ThreeMathUtils.clamp(sunlightIntensity, 0, 1)
    );

    this.chunks.uniforms.fogColor.value?.copy(this.sky.uMiddleColor.value);
  }

  /**
   * Update the uniform values.
   */
  private updateUniforms = () => {
    this.chunks.uniforms.time.value = performance.now();
  };

  private buildChunkMesh(cx: number, cz: number, data: MeshProtocol) {
    const chunk = this.getChunkByCoords(cx, cz);
    if (!chunk) return; // May be already maintained and deleted.

    const { maxHeight, subChunks, chunkSize } = this.options;
    const { level, geometries } = data;
    const heightPerSubChunk = Math.floor(maxHeight / subChunks);

    chunk.meshes.get(level)?.forEach((mesh) => {
      mesh.geometry.dispose();
      this.remove(mesh);
    });

    chunk.meshes.delete(level);

    if (geometries.length === 0) return;

    const mesh = geometries.map((geo) => {
      const { voxel, faceName, indices, lights, positions, uvs } = geo;
      const geometry = new BufferGeometry();

      geometry.setAttribute(
        "position",
        new Float32BufferAttribute(positions, 3)
      );
      geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
      geometry.setAttribute("light", new Int32BufferAttribute(lights, 1));
      geometry.setIndex(indices);

      const material = this.getBlockFaceMaterial(voxel, faceName);
      if (!material) return;

      const mesh = new Mesh(geometry, material);
      mesh.position.set(
        cx * chunkSize,
        level * heightPerSubChunk,
        cz * chunkSize
      );
      mesh.updateMatrix();
      mesh.matrixAutoUpdate = false;
      mesh.matrixWorldAutoUpdate = false;
      mesh.userData = { isChunk: true, voxel };

      this.add(mesh);
      return mesh;
    });

    chunk.meshes.set(level, mesh);
  }

  private setupComponents() {
    const { skyOptions, cloudsOptions } = this.options;

    this.registry = new Registry();
    this.loader = new Loader();
    this.chunks = new Chunks();

    if (!cloudsOptions.uFogColor) {
      cloudsOptions.uFogColor = this.chunks.uniforms.fogColor;
    }

    this.sky = new Sky(skyOptions);
    this.clouds = new Clouds(cloudsOptions);

    this.add(this.sky, this.clouds);

    // initialize the physics engine with server provided options.
    this.physics = new PhysicsEngine(
      (vx: number, vy: number, vz: number) => {
        if (!this.getChunkByPosition(vx, vy, vz)) return [];

        const id = this.getVoxelAt(vx, vy, vz);
        const rotation = this.getVoxelRotationAt(vx, vy, vz);
        const { aabbs, isPassable, isFluid } = this.getBlockById(id);

        if (isPassable || isFluid) return [];

        return aabbs.map((aabb) =>
          rotation.rotateAABB(aabb).translate([vx, vy, vz])
        );
      },
      (vx: number, vy: number, vz: number) => {
        if (!this.getChunkByPosition(vx, vy, vz)) return false;

        const id = this.getVoxelAt(vx, vy, vz);
        const { isFluid } = this.getBlockById(id);

        return isFluid;
      },
      this.options
    );
  }

  private setupUniforms() {
    const { minLightLevel } = this.options;

    this.chunks.uniforms.minLightLevel.value = minLightLevel;
  }

  /**
   * Scaffold the server updates onto the network, including chunk requests and block updates.
   */
  private emitServerUpdates = () => {
    // Update server voxels
    if (this.chunks.toUpdate.length >= 0) {
      const updates = this.chunks.toUpdate.splice(
        0,
        this.options.maxUpdatesPerUpdate
      );

      if (updates.length) {
        this.packets.push({
          type: "UPDATE",
          updates: updates.map((update) => {
            const { type, vx, vy, vz, rotation, yRotation } = update;

            const chunk = this.getChunkByPosition(vx, vy, vz);
            const block = this.getBlockById(type);

            let raw = 0;
            raw = BlockUtils.insertID(raw, type);

            if (
              block.rotatable &&
              (!isNaN(update.rotation) || !isNaN(yRotation))
            ) {
              raw = BlockUtils.insertRotation(
                raw,
                BlockRotation.encode(rotation, yRotation)
              );
            }

            if (chunk) {
              chunk.setRawValue(vx, vy, vz, raw);
            }

            return {
              ...update,
              voxel: raw,
            };
          }),
        });

        const { maxHeight, maxLightLevel } = this.options;

        // Placing a light
        const redFlood: LightNode[] = [];
        const greenFlood: LightNode[] = [];
        const blueFlood: LightNode[] = [];
        const sunFlood: LightNode[] = [];

        this.isTrackingChunks = true;
        for (const update of updates) {
          const { type, vx, vy, vz, rotation, yRotation } = update;

          const currentBlock = this.getBlockAt(vx, vy, vz);
          const currentRotation = this.getVoxelRotationAt(vx, vy, vz);
          const currentTransparency = BlockUtils.getBlockRotatedTransparency(
            currentBlock,
            currentRotation
          );
          const updatedBlock = this.getBlockById(type);
          const updatedRotation = BlockRotation.encode(rotation, yRotation);
          const updatedTransparency = BlockUtils.getBlockRotatedTransparency(
            updatedBlock,
            updatedRotation
          );

          const newValue = BlockUtils.insertAll(
            updatedBlock.id,
            updatedBlock.rotatable ? updatedRotation : undefined
          );
          this.attemptBlockCache(vx, vy, vz, newValue);

          this.setVoxelAt(vx, vy, vz, type);

          if (updatedBlock.rotatable) {
            this.setVoxelRotationAt(vx, vy, vz, updatedRotation);
          }

          if (updatedBlock.isOpaque || updatedBlock.lightReduce) {
            if (this.getSunlightAt(vx, vy, vz) > 0) {
              this.removeLight([vx, vy, vz], "SUNLIGHT");
            }

            ([RED_LIGHT, GREEN_LIGHT, BLUE_LIGHT] as LightColor[]).map(
              (color) => {
                if (this.getTorchLightAt(vx, vy, vz, color) > 0) {
                  this.removeLight([vx, vy, vz], color);
                }
              }
            );
          } else {
            let removeCount = 0;

            const lightData = [
              [SUNLIGHT, this.getSunlightAt(vx, vy, vz)],
              [RED_LIGHT, this.getTorchLightAt(vx, vy, vz, "RED")],
              [GREEN_LIGHT, this.getTorchLightAt(vx, vy, vz, "GREEN")],
              [BLUE_LIGHT, this.getTorchLightAt(vx, vy, vz, "BLUE")],
            ] as const;

            VOXEL_NEIGHBORS.forEach(([ox, oy, oz]) => {
              const nvy = vy + oy;
              if (nvy < 0 || nvy >= maxHeight) {
                return;
              }

              const nvx = vx + ox;
              const nvz = vz + oz;

              const nBlock = this.getBlockAt(nvx, nvy, nvz);
              const nTransparency = BlockUtils.getBlockRotatedTransparency(
                nBlock,
                // Maybe use the new rotation?
                currentRotation
              );

              if (
                !(
                  LightUtils.canEnter(
                    currentTransparency,
                    nTransparency,
                    ox,
                    oy,
                    oz
                  ) &&
                  !LightUtils.canEnter(
                    updatedTransparency,
                    nTransparency,
                    ox,
                    oy,
                    oz
                  )
                )
              ) {
                return;
              }

              lightData.forEach(([color, sourceLevel]) => {
                const isSunlight = color === SUNLIGHT;

                const nLevel = isSunlight
                  ? this.getSunlightAt(nvx, nvy, nvz)
                  : this.getTorchLightAt(nvx, nvy, nvz, color);

                if (
                  nLevel < sourceLevel ||
                  (oy === -1 &&
                    isSunlight &&
                    nLevel === maxLightLevel &&
                    sourceLevel === maxLightLevel)
                ) {
                  removeCount += 1;
                  this.removeLight([nvx, nvy, nvz], color);
                }
              });
            });

            if (removeCount === 0) {
              if (this.getSunlightAt(vx, vy, vz) !== 0) {
                this.removeLight([vx, vy, vz], "SUNLIGHT");
              }

              ([RED_LIGHT, GREEN_LIGHT, BLUE_LIGHT] as LightColor[]).map(
                (color) => {
                  if (this.getTorchLightAt(vx, vy, vz, color) !== 0) {
                    this.removeLight([vx, vy, vz], color);
                  }
                }
              );
            }
          }

          if (updatedBlock.isLight) {
            if (updatedBlock.redLightLevel > 0) {
              this.setTorchLightAt(
                vx,
                vy,
                vz,
                updatedBlock.redLightLevel,
                "RED"
              );
              redFlood.push({
                voxel: [vx, vy, vz],
                level: updatedBlock.redLightLevel,
              });
            }

            if (updatedBlock.greenLightLevel > 0) {
              this.setTorchLightAt(
                vx,
                vy,
                vz,
                updatedBlock.greenLightLevel,
                "GREEN"
              );
              greenFlood.push({
                voxel: [vx, vy, vz],
                level: updatedBlock.greenLightLevel,
              });
            }

            if (updatedBlock.blueLightLevel > 0) {
              this.setTorchLightAt(
                vx,
                vy,
                vz,
                updatedBlock.blueLightLevel,
                "BLUE"
              );
              blueFlood.push({
                voxel: [vx, vy, vz],
                level: updatedBlock.blueLightLevel,
              });
            }
          } else {
            // Check the six neighbors.
            VOXEL_NEIGHBORS.forEach(([ox, oy, oz]) => {
              const nvy = vy + oy;

              if (nvy < 0) {
                return;
              }

              // Sunlight should propagate downwards here.
              if (nvy >= maxHeight) {
                // Light can go downwards into this block.
                if (
                  LightUtils.canEnter(
                    [true, true, true, true, true, true],
                    updatedTransparency,
                    ox,
                    -1,
                    oz
                  )
                ) {
                  sunFlood.push({
                    voxel: [vx + ox, vy, vz + oz],
                    level: maxLightLevel,
                  });
                }

                return;
              }

              const nvx = vx + ox;
              const nvz = vz + oz;

              const nBlock = this.getBlockAt(nvx, nvy, nvz);
              const nTransparency = BlockUtils.getBlockRotatedTransparency(
                nBlock,
                this.getVoxelRotationAt(nvx, nvy, nvz)
              );

              const nVoxel = [nvx, nvy, nvz] as Coords3;

              // See if light couldn't originally go from source to neighbor, but now can in the updated block. If not, move on.
              if (
                !(
                  !LightUtils.canEnter(
                    currentTransparency,
                    nTransparency,
                    ox,
                    oy,
                    oz
                  ) &&
                  LightUtils.canEnter(
                    updatedTransparency,
                    nTransparency,
                    ox,
                    oy,
                    oz
                  )
                )
              ) {
                return;
              }

              const level =
                this.getSunlightAt(nvx, nvy, nvz) -
                (updatedBlock.lightReduce ? 1 : 0);
              if (level !== 0) {
                sunFlood.push({
                  voxel: nVoxel,
                  level,
                });
              }

              const redLevel =
                this.getTorchLightAt(nvx, nvy, nvz, "RED") -
                (updatedBlock.lightReduce ? 1 : 0);
              if (redLevel !== 0 && nBlock.isLight) {
                redFlood.push({
                  voxel: nVoxel,
                  level: redLevel,
                });
              }

              const greenLevel =
                this.getTorchLightAt(nvx, nvy, nvz, "GREEN") -
                (updatedBlock.lightReduce ? 1 : 0);
              if (greenLevel !== 0 && nBlock.isLight) {
                greenFlood.push({
                  voxel: nVoxel,
                  level: greenLevel,
                });
              }

              const blueLevel =
                this.getTorchLightAt(nvx, nvy, nvz, "BLUE") -
                (updatedBlock.lightReduce ? 1 : 0);
              if (blueLevel !== 0 && nBlock.isLight) {
                blueFlood.push({
                  voxel: nVoxel,
                  level: blueLevel,
                });
              }
            });
          }
        }

        this.floodLight(sunFlood, "SUNLIGHT");
        this.floodLight(redFlood, "RED");
        this.floodLight(greenFlood, "GREEN");
        this.floodLight(blueFlood, "BLUE");

        this.isTrackingChunks = false;
        const dirtyChunks = this.chunksTracker.splice(
          0,
          this.chunksTracker.length
        );

        dirtyChunks.forEach(([coords, level]) => {
          const [cx, cz] = coords;
          const chunk = this.getChunkByCoords(cx, cz);
          chunk.isDirty = true;

          this.meshChunkLocally(cx, cz, level);
        });
      }
    }
  };

  /**
   * Make a chunk shader material with the current atlas.
   */
  private makeShaderMaterial = (
    fragmentShader = DEFAULT_CHUNK_SHADERS.fragment,
    vertexShader = DEFAULT_CHUNK_SHADERS.vertex,
    uniforms: any = {}
  ) => {
    const chunksUniforms = {
      ...this.chunks.uniforms,
      ...this.options.chunkUniformsOverwrite,
    };

    const material = new ShaderMaterial({
      vertexColors: true,
      fragmentShader,
      vertexShader,
      uniforms: {
        ...UniformsUtils.clone(ShaderLib.basic.uniforms),
        uSunlightIntensity: chunksUniforms.sunlightIntensity,
        uAOTable: chunksUniforms.ao,
        uminLightLevel: chunksUniforms.minLightLevel,
        uFogNear: chunksUniforms.fogNear,
        uFogFar: chunksUniforms.fogFar,
        uFogColor: chunksUniforms.fogColor,
        uTime: chunksUniforms.time,
        ...uniforms,
      },
    }) as CustomChunkShaderMaterial;

    Object.defineProperty(material, "renderStage", {
      get: function () {
        return material.uniforms.renderStage.value;
      },

      set: function (stage) {
        material.uniforms.renderStage.value = parseFloat(stage);
      },
    });

    // @ts-ignore
    material.map = AtlasTexture.makeUnknownTexture();
    material.uniforms.map = { value: material.map };

    return material;
  };

  private async loadMaterials() {
    const { textureUnitDimension } = this.options;

    const perSide = (total: number) => {
      let countPerSide = 1;
      const sqrt = Math.ceil(Math.sqrt(total));
      while (countPerSide < sqrt) {
        countPerSide *= 2;
      }

      return countPerSide;
    };

    const make = (transparent: boolean, map: Texture) => {
      const mat = this.makeShaderMaterial();

      mat.side = transparent ? TwoPassDoubleSide : FrontSide;
      mat.transparent = transparent;
      mat.map = map;
      mat.uniforms.map.value = map;

      return mat;
    };

    for (const block of this.registry.blocksById.values()) {
      let totalFaces = block.faces.length;

      block.faces.forEach((f) => {
        if (f.independent) totalFaces--;
      });

      const countPerSide = perSide(totalFaces);

      const atlas = new AtlasTexture(countPerSide, textureUnitDimension);

      const mat = make(block.isSeeThrough, atlas);
      const key = this.makeChunkMaterialKey(block.id);

      this.chunks.materials.set(key, mat);

      // Process independent faces
      for (const face of block.faces) {
        if (!face.independent) continue;

        // For independent faces, we need to create a new material for it with a non-atlas texture.
        const mat = make(
          block.isSeeThrough,
          AtlasTexture.makeUnknownTexture(textureUnitDimension)
        );

        const key = this.makeChunkMaterialKey(block.id, face.name);

        this.chunks.materials.set(key, mat);
      }
    }
  }

  private makeChunkMaterialKey(id: number, faceName?: string) {
    return faceName ? `${id}-${faceName}` : `${id}`;
  }

  private trackChunkAt(vx: number, vy: number, vz: number) {
    if (!this.isTrackingChunks) return;
    const { chunkSize, maxHeight, subChunks } = this.options;

    const voxel = [vx | 0, vy | 0, vz | 0] as Coords3;
    const [cx, cz] = ChunkUtils.mapVoxelToChunk(voxel, chunkSize);
    const [lcx, , lcz] = ChunkUtils.mapVoxelToChunkLocal(voxel, chunkSize);

    if (this.chunksTracker.find(([[cxt, czt]]) => cxt === cx && czt === cz)) {
      return;
    }

    const subChunkHeight = maxHeight / subChunks;
    const level = Math.floor(vy / subChunkHeight);

    const chunkCoordsList: Coords2[] = [];
    chunkCoordsList.push([cx, cz]);

    if (lcx === 0) chunkCoordsList.push([cx - 1, cz]);
    if (lcz === 0) chunkCoordsList.push([cx, cz - 1]);
    if (lcx === 0 && lcz === 0) chunkCoordsList.push([cx - 1, cz - 1]);
    if (lcx === chunkSize - 1) chunkCoordsList.push([cx + 1, cz]);
    if (lcz === chunkSize - 1) chunkCoordsList.push([cx, cz + 1]);
    if (lcx === chunkSize - 1 && lcz === chunkSize - 1)
      chunkCoordsList.push([cx + 1, cz + 1]);

    const levels: number[] = [];

    if (vy % subChunkHeight === 0 && level > 0) {
      levels.push(level - 1);
    } else if (
      vy % subChunkHeight === subChunkHeight - 1 &&
      level < subChunks
    ) {
      levels.push(level + 1);
    }
    levels.push(level);

    for (const [cx, cz] of chunkCoordsList) {
      for (const level of levels) {
        this.chunksTracker.push([[cx, cz], level]);
      }
    }
  }

  /**
   * A sanity check to make sure that an action is not being performed after
   * the world has been isInitialized.
   */
  private checkIsInitialized(action: string, beforeInit = true) {
    if (beforeInit ? this.isInitialized : !this.isInitialized) {
      throw new Error(
        `Cannot ${action} ${beforeInit ? "after" : "before"} the world ${
          beforeInit ? "has been" : "is"
        } isInitialized. ${
          beforeInit
            ? "This has to be called before `world.init`."
            : "Remember to call the asynchronous function `world.init` beforehand."
        }`
      );
    }
  }
}
