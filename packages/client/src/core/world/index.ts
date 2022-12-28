import { AABB } from "@voxelize/aabb";
import { Engine as PhysicsEngine } from "@voxelize/physics-engine";
import { raycast } from "@voxelize/raycast";
import { MeshProtocol, MessageProtocol } from "@voxelize/transport/src/types";
import { NetIntercept } from "core/network";
import {
  BufferGeometry,
  Clock,
  Color,
  Float32BufferAttribute,
  FrontSide,
  Int32BufferAttribute,
  Mesh,
  Scene,
  ShaderLib,
  ShaderMaterial,
  Texture,
  UniformsUtils,
  MeshBasicMaterial,
  MeshStandardMaterial,
  // @ts-ignore
  TwoPassDoubleSide,
  Vector3,
  Vector4,
  Group,
  Uniform,
} from "three";

import { Coords2, Coords3 } from "../../types";
import { BlockUtils, ChunkUtils, LightColor } from "../../utils";

import { BlockRotation, BlockUpdate, PY_ROTATION } from "./block";
import { Chunk } from "./chunk";
import { Chunks } from "./chunks";
import { Loader } from "./loader";
import { Registry } from "./registry";
import { DEFAULT_CHUNK_SHADERS } from "./shaders";
import { AtlasTexture } from "./textures";

export * from "./block";
export * from "./loader";
export * from "./registry";
export * from "./textures";
export * from "./shaders";

/**
 * Custom shader material for chunks, simply a `ShaderMaterial` from ThreeJS with a map texture.
 */
export type CustomShaderMaterial = ShaderMaterial & {
  map: Texture;
};

export type WorldClientParams = {
  maxRequestsPerTick: number;
  maxProcessesPerTick: number;
  maxUpdatesPerTick: number;
  maxAddsPerTick: number;
  generateMeshes: boolean;
  minBrightness: number;
  rerequestTicks: number;
  defaultRenderRadius: number;
  defaultDeleteRadius: number;
  textureDimension: number;
  updateTimeout: number;
};

const defaultParams: WorldClientParams = {
  maxRequestsPerTick: 4,
  maxProcessesPerTick: 8,
  maxUpdatesPerTick: 1000,
  maxAddsPerTick: 2,
  minBrightness: 0.04,
  generateMeshes: true,
  rerequestTicks: 1000000,
  defaultRenderRadius: 8,
  defaultDeleteRadius: 12,
  textureDimension: 8,
  updateTimeout: 1.5, // ms
};

export type WorldServerParams = {
  subChunks: number;
  chunkSize: number;
  maxHeight: number;
  maxLightLevel: number;
  minChunk: [number, number];
  maxChunk: [number, number];

  gravity: number[];
  minBounceImpulse: number;
  airDrag: number;
  fluidDrag: number;
  fluidDensity: number;
};

export type WorldParams = WorldClientParams & WorldServerParams;

export class World extends Scene implements NetIntercept {
  public params: WorldParams;

  public registry: Registry;

  public loader: Loader;

  public chunks: Chunks;

  public physics: PhysicsEngine;

  public packets: MessageProtocol[] = [];

  public initialized = false;

  public renderRadius = 0;

  public deleteRadius = 0;

  /**
   * The WebGL uniforms that are used in the chunk shader.
   */
  public uniforms: {
    /**
     * The fog color that is applied onto afar chunks. It is recommended to set this to the
     * middle color of the sky. Defaults to a new THREE.JS white color instance.
     */
    fogColor: {
      /**
       * The value passed into the chunk shader.
       */
      value: Color;
    };
    /**
     * The near distance of the fog. Defaults to `100` units.
     */
    fogNear: {
      /**
       * The value passed into the chunk shader.
       */
      value: number;
    };
    /**
     * The far distance of the fog. Defaults to `200` units.
     */
    fogFar: {
      /**
       * The value passed into the chunk shader.
       */
      value: number;
    };
    /**
     * The ambient occlusion levels that are applied onto the chunk meshes. Check out [this article](https://0fps.net/2013/07/03/ambient-occlusion-for-minecraft-like-worlds/)
     * for more information on ambient occlusion for voxel worlds. Defaults to `new Vector4(100.0, 170.0, 210.0, 255.0)`.
     */
    ao: {
      /**
       * The value passed into the chunk shader.
       */
      value: Vector4;
    };
    /**
     * The minimum brightness of the world at light level `0`. Defaults to `0.2`.
     */
    minBrightness: {
      /**
       * The value passed into the chunk shader.
       */
      value: number;
    };
    /**
     * The sunlight intensity of the world. Changing this to `0` would effectively simulate night time
     * in Voxelize. Defaults to `1.0`.
     */
    sunlightIntensity: {
      /**
       * The value passed into the chunk shader.
       */
      value: number;
    };
    /**
     * The time constant `performance.now()` that is used to animate the world. Defaults to `performance.now()`.
     */
    time: {
      /**
       * The value passed into the chunk shader.
       */
      value: number;
    };
  } = {
    fogColor: {
      value: new Color("#fff"),
    },
    fogNear: {
      value: 100,
    },
    fogFar: {
      value: 200,
    },
    ao: {
      value: new Vector4(100.0, 170.0, 210.0, 255.0),
    },
    minBrightness: {
      value: 0.2,
    },
    sunlightIntensity: {
      value: 1,
    },
    time: {
      value: performance.now(),
    },
  };

  public materialStore: Map<string, CustomShaderMaterial> = new Map();

  private oldBlocks: Map<string, number[]> = new Map();

  private clock = new Clock();

  private chunkInitListeners = new Map<string, ((chunk: Chunk) => void)[]>();

  private initJSON: any = null;

  constructor(params: Partial<WorldParams> = {}) {
    super();

    this.registry = new Registry();
    this.loader = new Loader();
    this.chunks = new Chunks();

    this.setupPhysics();

    // @ts-ignore
    const { defaultRenderRadius, defaultDeleteRadius } = (this.params = {
      ...defaultParams,
      ...params,
    });

    this.renderRadius = defaultRenderRadius;
    this.deleteRadius = defaultDeleteRadius;
  }

  async applyBlockTexture(
    idOrName: number | string,
    faceNames: string | string[],
    source: string | Color | HTMLImageElement | Texture
  ) {
    this.initCheck("apply block texture", false);

    const block = this.getBlockOf(idOrName);

    faceNames = Array.isArray(faceNames) ? faceNames : [faceNames];

    const data =
      typeof source === "string" ? await this.loader.loadImage(source) : source;

    faceNames.forEach((faceName) => {
      const face = block.faces.find((f) => f.name === faceName);

      if (!face) {
        throw new Error(
          `Face "${faceName}" does not exist on block "${block.name}"`
        );
      }

      const mat = this.getMaterial(block.id, faceName);

      if (face.independent) {
        if (source instanceof Texture) {
          mat.map = source;
          mat.uniforms.map = { value: source };
        } else if (data instanceof HTMLImageElement) {
          mat.map.image = data;
        }

        return;
      }

      const atlas = mat.map as AtlasTexture;
      atlas.drawImageToRange(face.range, data);
    });
  }

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

  async applyBlockFrames(
    idOrName: number | string,
    faceNames: string | string[],
    keyframes: [number, string | Color | HTMLImageElement][],
    fadeFrames = 0
  ) {
    this.initCheck("apply block animation", false);

    const block = this.getBlockOf(idOrName);

    const realKeyframes = [];

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

      const mat = this.getMaterial(block.id, faceName);

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

      (mat.map as AtlasTexture).registerAnimation(
        face.range,
        realKeyframes,
        fadeFrames
      );
    });
  }

  async applyBlockGif(
    idOrName: string,
    faceNames: string[] | string,
    source: string,
    interval = 66.6666667
  ) {
    this.initCheck("apply GIF animation", false);

    if (!source.endsWith(".gif")) {
      console.warn(
        "There's a chance that this file isn't a GIF as it doesn't end with .gif"
      );
    }

    const images = await this.loader.loadGifImages(source);

    const keyframes = images.map(
      (image) => [interval, image] as [number, HTMLImageElement]
    );

    await this.applyBlockFrames(idOrName, faceNames, keyframes);
  }

  setResolutionOf(
    idOrName: number | string,
    faceNames: string | string[],
    resolution: number
  ) {
    this.initCheck("apply resolution", false);

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

      const mat = this.getMaterial(block.id, faceName);

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
    this.initCheck("get chunk by name", false);
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
    this.initCheck("get chunk by coords", false);
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
    this.initCheck("get chunk by position", false);
    const coords = ChunkUtils.mapVoxelToChunk(
      [px | 0, py | 0, pz | 0],
      this.params.chunkSize
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
    this.initCheck("get voxel", false);
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return 0;
    return chunk.getVoxel(px, py, pz);
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
    this.initCheck("get voxel rotation", false);
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return new BlockRotation();
    return chunk.getVoxelRotation(px, py, pz);
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
    this.initCheck("get voxel stage", false);
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
    this.initCheck("get sunlight", false);
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return 0;
    return chunk.getSunlight(px, py, pz);
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
    this.initCheck("get torch light", false);
    const chunk = this.getChunkByPosition(px, py, pz);
    if (chunk === undefined) return 0;
    return chunk.getTorchLight(px, py, pz, color);
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
    this.initCheck("get light color", false);

    const sunlight = this.getSunlightAt(vx, vy, vz);
    const redLight = this.getTorchLightAt(vx, vy, vz, "RED");
    const greenLight = this.getTorchLightAt(vx, vy, vz, "GREEN");
    const blueLight = this.getTorchLightAt(vx, vy, vz, "BLUE");

    const { sunlightIntensity, minBrightness } = this.uniforms;

    const s = Math.min(
      (sunlight / this.params.maxLightLevel) ** 2 *
        sunlightIntensity.value *
        (1 - minBrightness.value) +
        minBrightness.value,
      1
    );

    return new Color(
      s + Math.pow(redLight / this.params.maxLightLevel, 2),
      s + Math.pow(greenLight / this.params.maxLightLevel, 2),
      s + Math.pow(blueLight / this.params.maxLightLevel, 2)
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
    this.initCheck("get block", false);
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
    this.initCheck("get max height", false);

    const vx = px | 0;
    const vz = pz | 0;

    for (let vy = this.params.maxHeight - 1; vy >= 0; vy--) {
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
    const block = this.registry.blocksByName.get(name);

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

  getMaterial(idOrName: number | string, faceName?: string) {
    this.initCheck("get material", false);

    const block = this.getBlockOf(idOrName);

    if (faceName && block.independentFaces.has(faceName)) {
      return this.materialStore.get(this.makeMaterialKey(block.id, faceName));
    }

    return this.materialStore.get(this.makeMaterialKey(block.id));
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
    const listeners = this.chunkInitListeners.get(name) || [];
    listeners.push(listener);
    this.chunkInitListeners.set(name, listeners);
  };

  /**
   * Whether or not if this chunk coordinate is within (inclusive) the world's bounds. That is, if this chunk coordinate
   * is within {@link WorldServerParams | WorldServerParams.minChunk} and {@link WorldServerParams | WorldServerParams.maxChunk}.
   *
   * @param cx The chunk's X position.
   * @param cz The chunk's Z position.
   * @returns Whether or not this chunk is within the bounds of the world.
   */
  isWithinWorld(cx: number, cz: number) {
    const { minChunk, maxChunk } = this.params;

    return (
      cx >= minChunk[0] &&
      cx <= maxChunk[0] &&
      cz >= minChunk[1] &&
      cz <= maxChunk[1]
    );
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
    this.initCheck("raycast voxels", false);

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
              ? dynamicFn([wx | 0, wy | 0, wz | 0], this).aabbs
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
   * {@link World.chunks | World.chunks.toUpdate} and scaffolded to the server {@link WorldClientParams | WorldClientParams.maxUpdatesPerTick} times
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
   * {@link World.chunks | World.chunks.toUpdate} and scaffolded to the server {@link WorldClientParams | WorldClientParams.maxUpdatesPerTick} times
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
    this.initCheck("update voxels", false);

    this.chunks.toUpdate.push(
      ...updates
        .filter((update) => {
          if (update.vy < 0 || update.vy >= this.params.maxHeight) {
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
        })
    );
  };

  /**
   * Get a mesh of the model of the given block.
   *
   * @param id The ID of the block.
   * @param params The params of creating this block mesh.
   * @param params.material The type of material to use for this generated mesh.
   * @param params.separateFaces: Whether or not to separate the faces of the block into different meshes.
   * @param params.crumbs: Whether or not to mess up the block mesh's faces and UVs to make it look like crumbs.
   * @returns A 3D mesh (group) of the block model.
   */
  makeBlockMesh = (
    idOrName: number | string,
    params: Partial<{
      separateFaces: boolean;
      crumbs: boolean;
      material: "basic" | "standard";
    }> = {}
  ) => {
    this.initCheck("make block mesh", false);

    if (!idOrName) {
      return null;
    }

    const block = this.getBlockOf(idOrName);
    if (!block) return null;

    const { separateFaces, crumbs, material } = {
      separateFaces: false,
      crumbs: false,
      material: "basic",
      ...params,
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
        const chunkMat = this.getMaterial(block.id, name);

        const matParams = {
          transparent: isSeeThrough,
          map: chunkMat.map,
          alphaTest: 0.3,
          side: isSeeThrough ? TwoPassDoubleSide : FrontSide,
        };

        const mat =
          material === "basic"
            ? new MeshBasicMaterial(matParams)
            : new MeshStandardMaterial(matParams);

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
    const {
      vertexShader = DEFAULT_CHUNK_SHADERS.vertex,
      fragmentShader = DEFAULT_CHUNK_SHADERS.fragment,
      uniforms = {},
    } = data;

    const mat = this.getMaterial(idOrName, faceName);

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

  /**
   * Initialize the world with the data received from the server. This includes populating
   * the registry, setting the parameters, and creating the texture atlas.
   */
  async init() {
    if (this.initialized) {
      console.warn("World has already been initialized.");
      return;
    }

    if (this.initJSON === null) {
      throw new Error(
        "World has not received any initialization data from the server."
      );
    }

    const { blocks, params } = this.initJSON;

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

    // Loading the parameters
    this.params = {
      ...this.params,
      ...params,
    };

    this.physics.options = this.params;

    await this.loadMaterials();

    this.initialized = true;
  }

  update(position: Vector3 = new Vector3()) {
    if (!this.initialized) {
      return;
    }

    const delta = this.clock.getDelta();

    const center = ChunkUtils.mapVoxelToChunk(
      position.toArray() as Coords3,
      this.params.chunkSize
    );

    this.requestChunks(center);
    this.processChunks(center);
    this.maintainChunks(center);

    this.updatePhysics(delta);
    this.updateUniforms();

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

        this.initJSON = json;

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

        updates.forEach((update) => {
          const { vx, vy, vz, light, voxel } = update;
          const chunk = this.getChunkByPosition(vx, vy, vz);

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

  private requestChunks(center: Coords2) {
    const {
      renderRadius,
      params: { rerequestTicks },
    } = this;

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

          if (count + 1 > rerequestTicks) {
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

    const { maxRequestsPerTick } = this.params;

    const toRequest = this.chunks.toRequest.splice(0, maxRequestsPerTick);

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
      maxProcessesPerTick,
      chunkSize,
      maxHeight,
      subChunks,
      generateMeshes,
    } = this.params;

    const toProcess = this.chunks.toProcess.splice(0, maxProcessesPerTick);

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

      this.chunks.loaded.set(name, chunk);

      if (generateMeshes) {
        let frame: any;

        const process = (index: number) => {
          const data = meshes[index];

          if (!data) {
            const listeners = this.chunkInitListeners.get(chunk.name);

            if (Array.isArray(listeners)) {
              listeners.forEach((listener) => listener(chunk));
              this.chunkInitListeners.delete(chunk.name);
            }

            cancelAnimationFrame(frame);
            return;
          }

          this.buildChunkMesh(x, z, data);
          frame = requestAnimationFrame(() => process(index + 1));
        };

        process(0);
      }
    });
  }

  private maintainChunks(center: Coords2) {
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
      this.chunkInitListeners.delete(name);
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
    }
  }

  /**
   * Update the physics engine by ticking all inner AABBs.
   */
  private updatePhysics = (delta: number) => {
    if (!this.physics || !this.params.gravity) return;

    const noGravity =
      this.params.gravity[0] ** 2 +
        this.params.gravity[1] ** 2 +
        this.params.gravity[2] ** 2 <
      0.01;

    this.physics.bodies.forEach((body) => {
      const coords = ChunkUtils.mapVoxelToChunk(
        body.getPosition() as Coords3,
        this.params.chunkSize
      );
      const chunk = this.getChunkByPosition(...(body.getPosition() as Coords3));

      if ((!chunk || !chunk.isReady) && this.isWithinWorld(...coords)) {
        return;
      }

      this.physics.iterateBody(body, delta, noGravity);
    });
  };

  /**
   * Update the uniform values.
   */
  private updateUniforms = () => {
    this.uniforms.time.value = performance.now();
  };

  private buildChunkMesh(cx: number, cz: number, data: MeshProtocol) {
    const chunk = this.getChunkByCoords(cx, cz);

    if (!chunk) {
      // May be already maintained and deleted.
      return;
    }

    const { maxHeight, subChunks, chunkSize } = this.params;
    const { level, geometries } = data;

    const heightPerSubChunk = Math.floor(maxHeight / subChunks);

    const original = chunk.meshes.get(level);

    if (original) {
      original.forEach((mesh) => {
        mesh.geometry.dispose();
        this.remove(mesh);
      });

      chunk.meshes.delete(level);
    }

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

      const material = this.getMaterial(voxel, faceName);
      if (!material) return;

      const mesh = new Mesh(geometry, material);

      mesh.position.set(
        cx * chunkSize,
        level * heightPerSubChunk,
        cz * chunkSize
      );

      mesh.updateMatrix();
      mesh.matrixAutoUpdate = false;
      mesh.userData.isChunk = true;

      this.add(mesh);

      return mesh;
    });

    chunk.meshes.set(level, mesh);
  }

  /**
   * Setup the physics engine for this world.
   */
  private setupPhysics() {
    // initialize the physics engine with server provided parameters.
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
      this.params
    );
  }

  /**
   * Scaffold the server updates onto the network, including chunk requests and block updates.
   */
  private emitServerUpdates = () => {
    // Update server voxels
    if (this.chunks.toUpdate.length >= 0) {
      const updates = this.chunks.toUpdate.splice(
        0,
        this.params.maxUpdatesPerTick
      );

      if (updates.length) {
        this.packets.push({
          type: "UPDATE",
          updates: updates.map((update) => {
            const { type, vx, vy, vz, rotation, yRotation } = update;

            const chunk = this.getChunkByPosition(vx, vy, vz);

            let raw = 0;
            raw = BlockUtils.insertID(raw, type);

            if (!isNaN(update.rotation) || !isNaN(yRotation)) {
              raw = BlockUtils.insertRotation(
                raw,
                BlockRotation.encode(rotation, yRotation)
              );
            }

            if (chunk) {
              this.attemptBlockCache(vx, vy, vz, raw);
              chunk.setRawValue(vx, vy, vz, raw);
            }

            return {
              ...update,
              voxel: raw,
            };
          }),
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
    const material = new ShaderMaterial({
      vertexColors: true,
      fragmentShader,
      vertexShader,
      uniforms: {
        ...UniformsUtils.clone(ShaderLib.basic.uniforms),
        uSunlightIntensity: this.uniforms.sunlightIntensity,
        uAOTable: this.uniforms.ao,
        uMinBrightness: this.uniforms.minBrightness,
        uFogNear: this.uniforms.fogNear,
        uFogFar: this.uniforms.fogFar,
        uFogColor: this.uniforms.fogColor,
        uTime: this.uniforms.time,
        ...uniforms,
      },
    }) as CustomShaderMaterial;

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
    const { textureDimension } = this.params;

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

      const atlas = new AtlasTexture(countPerSide, textureDimension);

      const mat = make(block.isSeeThrough, atlas);
      const key = this.makeMaterialKey(block.id);

      this.materialStore.set(key, mat);

      // Process independent faces
      for (const face of block.faces) {
        if (!face.independent) continue;

        // For independent faces, we need to create a new material for it with a non-atlas texture.
        const mat = make(
          block.isSeeThrough,
          AtlasTexture.makeUnknownTexture(textureDimension)
        );

        const key = this.makeMaterialKey(block.id, face.name);

        this.materialStore.set(key, mat);
      }
    }
  }

  private makeMaterialKey(id: number, faceName?: string) {
    return faceName ? `${id}-${faceName}` : `${id}`;
  }

  /**
   * A sanity check to make sure that an action is not being performed after
   * the world has been initialized.
   */
  private initCheck(action: string, beforeInit = true) {
    if (beforeInit ? this.initialized : !this.initialized) {
      throw new Error(
        `Cannot ${action} ${beforeInit ? "after" : "before"} the world ${
          beforeInit ? "has been" : "is"
        } initialized. ${
          beforeInit
            ? "This has to be called before `world.init`."
            : "Remember to call the asynchronous function `world.init` beforehand."
        }`
      );
    }
  }
}
