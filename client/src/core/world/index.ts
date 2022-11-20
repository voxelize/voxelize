import { Engine as PhysicsEngine } from "@voxelize/physics-engine";
import { raycast } from "@voxelize/raycast";
import { ChunkProtocol, MessageProtocol } from "@voxelize/transport/src/types";
import {
  BackSide,
  BufferGeometry,
  Clock,
  Color,
  Float32BufferAttribute,
  FrontSide,
  Mesh,
  MeshBasicMaterial,
  Scene,
  ShaderLib,
  ShaderMaterial,
  Texture,
  Uniform,
  UniformsUtils,
  Vector3,
  Vector4,
} from "three";

import { ArtFunction } from "../../libs";
import { Coords2, Coords3 } from "../../types";
import { BlockUtils, ChunkUtils, LightColor, MathUtils } from "../../utils";
import { NetIntercept } from "../network";

import { Block, BlockRotation, BlockUpdate, PY_ROTATION } from "./block";
import { Chunk } from "./chunk";
import { Chunks } from "./chunks";
import { Loader } from "./loader";
import { Registry, TextureData, TextureRange } from "./registry";
import { TextureAtlas } from "./texture";

export * from "./texture";
export * from "./block";
export * from "./chunk";
export * from "./chunks";
export * from "./registry";
export * from "./shaders";

export type SkyFace = ArtFunction | Color | string | null;

/**
 * Custom shader material for chunks, simply a `ShaderMaterial` from ThreeJS with a map texture.
 */
export type CustomShaderMaterial = ShaderMaterial & {
  map: Texture;
};

export type WorldClientParams = {
  inViewRadius: number;
  maxRequestsPerTick: number;
  maxProcessesPerTick: number;
  maxUpdatesPerTick: number;
  maxAddsPerTick: number;
  minBrightness: number;
  rerequestTicks: number;
  defaultRenderRadius: number;
  defaultDeleteRadius: number;
  textureDimension: number;
  updateTimeout: number;
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

const defaultParams: WorldClientParams = {
  inViewRadius: 5,
  maxRequestsPerTick: 4,
  maxProcessesPerTick: 8,
  maxUpdatesPerTick: 1000,
  maxAddsPerTick: 2,
  minBrightness: 0.04,
  rerequestTicks: 100,
  defaultRenderRadius: 8,
  defaultDeleteRadius: 12,
  textureDimension: 8,
  updateTimeout: 1.5, // ms
};

/**
 * This is the default shaders used for the chunks.
 */
export const DEFAULT_CHUNK_SHADERS = {
  vertex: ShaderLib.basic.vertexShader
    .replace(
      "#include <common>",
      `
attribute int light;

varying float vAO;
varying vec4 vLight;
varying vec4 vWorldPosition;
uniform vec4 uAOTable;
uniform float uTime;

vec4 unpackLight(int l) {
  float r = float((l >> 8) & 0xF) / 15.0;
  float g = float((l >> 4) & 0xF) / 15.0;
  float b = float(l & 0xF) / 15.0;
  float s = float((l >> 12) & 0xF) / 15.0;
  return vec4(r, g, b, s);
}

#include <common>
`
    )
    .replace(
      "#include <color_vertex>",
      `
#include <color_vertex>

int ao = light >> 16;

vAO = ((ao == 0) ? uAOTable.x :
    (ao == 1) ? uAOTable.y :
    (ao == 2) ? uAOTable.z : uAOTable.w) / 255.0; 

vLight = unpackLight(light & ((1 << 16) - 1));
`
    )
    .replace(
      "#include <worldpos_vertex>",
      `
vec4 worldPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  worldPosition = instanceMatrix * worldPosition;
#endif
worldPosition = modelMatrix * worldPosition;
vWorldPosition = worldPosition;
`
    ),
  fragment: ShaderLib.basic.fragmentShader
    .replace(
      "#include <common>",
      `
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uSunlightIntensity;
uniform float uMinBrightness;
uniform float uTime;
varying float vAO;
varying vec4 vLight; 
varying vec4 vWorldPosition;

#include <common>
`
    )
    .replace(
      "#include <envmap_fragment>",
      `
#include <envmap_fragment>

// Intensity of light is wavelength ** 2 
float s = min(vLight.a * vLight.a * uSunlightIntensity * (1.0 - uMinBrightness) + uMinBrightness, 1.0);
float scale = 2.0;

outgoingLight.rgb *= vec3(s + pow(vLight.r, scale), s + pow(vLight.g, scale), s + pow(vLight.b, scale));
outgoingLight *= vAO;
`
    )
    .replace(
      "#include <fog_fragment>",
      `
vec3 fogOrigin = cameraPosition;

float depth = sqrt(pow(vWorldPosition.x - fogOrigin.x, 2.0) + pow(vWorldPosition.z - fogOrigin.z, 2.0));
float fogFactor = smoothstep(uFogNear, uFogFar, depth);

gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, fogFactor);
`
    ),
};

console.log(DEFAULT_CHUNK_SHADERS.vertex);

export type WorldParams = WorldClientParams & WorldServerParams;

/**
 * A Voxelize world handles the chunk loading and rendering, as well as any 3D objects.
 * **This class extends the [ThreeJS `Scene` class](https://threejs.org/docs/#api/en/scenes/Scene).**
 * This means that you can add any ThreeJS objects to the world, and they will be rendered. The world
 * also implements {@link NetIntercept}, which means it intercepts chunk-related packets from the server
 * and constructs chunk meshes from them.
 *
 * There are a couple important components that are by default created by the world:
 * - {@link World.registry}: A block registry that handles block textures and block instances.
 * - {@link World.chunks}: A chunk manager that stores all the chunks in the world.
 * - {@link World.physics}: A physics engine that handles voxel AABB physics simulation of client-side physics.
 * - {@link World.loader}: An asset loader that handles loading textures and other assets.
 * - {@link World.atlas}: A texture atlas that handles texture packing.
 *
 * One thing to keep in mind that there are no specific setters like `setVoxelByVoxel` or `setVoxelRotationByVoxel`.
 * This is because, instead, you should use `updateVoxel` and `updateVoxels` to update voxels.
 *
 * # Example
 * ```ts
 * const world = new VOXELIZE.World();
 *
 * // Update a voxel in the world across the network.
 * world.updateVoxel({
 *   vx: 0,
 *   vy: 0,
 *   vz: 0,
 *   type: 12,
 * });
 *
 * // Register the interceptor with the network.
 * network.register(world);
 *
 * // Register an image to block sides.
 * world.applyTextureByName("Test", VOXELIZE.ALL_FACES, "https://example.com/test.png");
 *
 * // Update the world every frame.
 * world.update(controls.object.position);
 * ```
 *
 * ![World](/img/docs/world.png)
 *
 * @category Core
 * @noInheritDoc
 */
export class World extends Scene implements NetIntercept {
  /**
   * Parameters to configure the world. This is a combination of the client-side parameters, {@link WorldClientParams},
   * and the server-side parameters, {@link WorldServerParams}. The server-side parameters are defined on the server, and
   * are sent to the client when the client connects to the server.
   */
  // @ts-ignore
  public params: WorldParams = {};

  /**
   * Whether or not this world is connected to a server and has configurations and block data loaded from the server.
   */
  public initialized = false;

  /**
   * A chunk manager that stores useful information about chunks, such as the chunk mesh and chunk data.
   */
  public chunks: Chunks;

  /**
   * The block registry that handles block textures and block instances.
   */
  public registry: Registry;

  /**
   * A voxel AABB physics engine that handles physics simulation of client-side physics. You can use `world.physics.iterateBody`
   * individually to iterate over a rigid body.
   */
  public physics: PhysicsEngine;

  /**
   * An asset loader that handles loading textures and other assets.
   */
  public loader: Loader = new Loader();

  /**
   * The generated texture atlas built from all registered block textures.
   */
  public atlas: TextureAtlas;

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
     * The 2D texture atlas that is used to render the chunk. This will be set after
     * {@link World.atlas} is generated.
     */
    atlas: {
      /**
       * The value passed into the chunk shader.
       */
      value: Texture | null;
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
    atlas: {
      value: null,
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

  /**
   * This is a map that keeps track of the block IDs before they are updated to any new block IDs.
   * Use {@link World.getPreviousVoxelByVoxel} and {@link World.getPreviousVoxelByWorld} to get the previous
   * block ID, if it exists.
   */
  public blockCache = new Map<string, number>();

  /**
   * The shared material instances for chunks.
   */
  public materials: {
    /**
     * The chunk material that is used to render the opaque portions of the chunk meshes.
     */
    opaque?: CustomShaderMaterial;

    /**
     * The chunk materials that are used to render the transparent portions of the chunk meshes.
     * This is a map of the block ID (identifier) to the material instances (front & back).
     */
    transparent: Map<
      number,
      {
        front: CustomShaderMaterial;
        back: CustomShaderMaterial;
      }
    >;
  } = {
    transparent: new Map(),
  };

  /**
   * An array of network packets that will be sent on `network.flush` calls.
   *
   * @hidden
   */
  public packets: MessageProtocol[] = [];

  /**
   * A list of listeners that are called when certain chunks are loaded.
   */
  private chunkInitListeners = new Map<string, ((chunk: Chunk) => void)[]>();

  /**
   * Internal radius to load chunks around the player.
   */
  private _renderRadius = 8;

  /**
   * Internal clock instance for delta time.
   */
  private clock = new Clock();

  /**
   * A tick counter to schedule chunk updates by tick.
   */
  private callTick = 0;

  /**
   * Create a new world instance.
   *
   * @param params The client-side parameters to configure the world.
   */
  constructor(params: Partial<WorldClientParams> = {}) {
    super();

    const { defaultRenderRadius } = (params = {
      ...defaultParams,
      ...params,
    });

    this.chunks = new Chunks();
    this.registry = new Registry();

    this.params = {
      ...this.params,
      ...params,
    };

    this.renderRadius = defaultRenderRadius;

    this.uniforms.minBrightness.value = this.params.minBrightness;

    this.setupPhysics();
  }

  /**
   * The network intercept implementation for world.
   *
   * DO NOT CALL THIS METHOD OR CHANGE IT UNLESS YOU KNOW WHAT YOU ARE DOING.
   *
   * @hidden
   * @param message The message to intercept.
   */
  onMessage = (
    message: MessageProtocol<{
      blocks: Block[];
      ranges: { [key: string]: TextureRange };
      params: WorldServerParams;
    }>
  ) => {
    switch (message.type) {
      case "INIT": {
        const {
          json: { blocks, ranges, params },
        } = message;

        this.registry.load(blocks, ranges);

        this.setParams(params);
        this.setFogDistance(this.renderRadius);

        this.loader.load().then(() => {
          this.loadAtlas();
        });

        return;
      }
      case "LOAD": {
        const { chunks } = message;

        chunks.forEach((chunk) => {
          this.handleServerChunk(chunk);
        });

        return;
      }
      case "UPDATE": {
        const { updates, chunks } = message;

        if (updates && updates.length) {
          updates.forEach((update) => {
            const { vx, vy, vz, voxel, light } = update;
            const chunk = this.getChunkByVoxel(vx, vy, vz);

            const oldID = BlockUtils.extractID(chunk.getVoxel(vx, vy, vz));
            const newID = BlockUtils.extractID(voxel);

            if (oldID !== newID) {
              this.blockCache.set(ChunkUtils.getVoxelName([vx, vy, vz]), oldID);
            }

            if (chunk) {
              chunk.setRawValue(vx, vy, vz, voxel || 0);
              chunk.setRawLight(vx, vy, vz, light || 0);
            }
          });
        }

        if (chunks && chunks.length) {
          chunks.forEach((chunk) => {
            this.handleServerChunk(chunk, true);
          });
        }

        return;
      }
      default:
        break;
    }
  };

  /**
   * Reset the world's chunk and block caches.
   */
  reset = () => {
    this.chunks.forEach((chunk) => {
      chunk.removeFromScene(this);
      chunk.dispose();
    });
    this.chunks.clear();

    this.chunks.requested.clear();
    this.chunks.toRequest.length = 0;
    this.chunks.toProcess.length = 0;
    this.chunks.currentChunk = [0, 0];

    this.blockCache.clear();
  };

  /**
   * Apply a list of textures to a list of blocks' faces. The textures are loaded in before the game starts.
   *
   * @param textures List of data to load into the game before the game starts.
   */
  applyTexturesByNames = (textures: TextureData[]) => {
    if (this.initialized) {
      throw new Error("Cannot apply textures after the world has started.");
    }

    textures.forEach((texture) => {
      if (typeof texture.data === "string") {
        this.loader.addTexture(texture.data);
      }

      this.registry.applyTextureByName(texture);
    });
  };

  /**
   * Apply a texture onto a face/side of a block.
   *
   * @param texture The data of the texture and where the texture is applying to.
   */
  applyTextureByName = (
    name: string,
    sides: string[] | string,
    data: string | Color
  ) => {
    if (this.initialized) {
      throw new Error("Cannot apply textures after the world has started.");
    }

    // Offload texture loading to the loader for the loading screen
    if (typeof data === "string") {
      this.loader.addTexture(data);
    }

    this.registry.applyTextureByName({
      name,
      sides,
      data,
    });
  };

  /**
   * Apply a block animation to a block.
   *
   * @param name The name of the block to apply the animation to.
   * @param sides The side(s) of the block to apply the animation to.
   * @param keyframes The keyframes of the animation. The first element is the duration of
   * the animation, and the second element is the source to the texture to apply.
   * @param fadeFrames The number of frames to fade between keyframes.
   */
  applyAnimationByName = (
    name: string,
    sides: string[] | string,
    keyframes: [number, string | Color][],
    fadeFrames = 0
  ) => {
    keyframes.forEach((keyframe) => {
      if (typeof keyframe[1] === "string") {
        this.loader.addTexture(keyframe[1]);
      }
    });

    (Array.isArray(sides) ? sides : [sides]).forEach((side) => {
      const sideName = Registry.makeSideName(name, side);
      this.registry.keyframes.set(sideName, [keyframes, fadeFrames]);
    });
  };

  /**
   * Get the block information by its name.
   *
   * @param name The name of the block to get.
   */
  getBlockByName = (name: string) => {
    return this.registry.getBlockByName(name);
  };

  /**
   * Get the block information by its ID.
   *
   * @param id The ID of the block to get.
   */
  getBlockById = (id: number) => {
    return this.registry.getBlockById(id);
  };

  /**
   * Reverse engineer to get the block information from a texture name.
   *
   * @param textureName The texture name that the block has.
   */
  getBlockByTextureName = (textureName: string) => {
    return this.registry.getBlockByTextureName(textureName);
  };

  /**
   * Set the farthest distance for the fog. Fog starts fogging up the chunks 50% from the farthest.
   *
   * @param distance The maximum distance that the fog fully fogs up.
   */
  setFogDistance = (distance: number) => {
    const { chunkSize } = this.params;

    this.uniforms.fogNear.value = distance * 0.5 * chunkSize;
    this.uniforms.fogFar.value = distance * chunkSize;
  };

  /**
   * Set the fog color that is applied to the chunks.
   *
   * @param color The color reference to link the fog to.
   */
  setFogColor = (color: Color) => {
    this.uniforms.fogColor.value.copy(color);
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
    this.chunks.toUpdate.push(
      ...updates
        .filter((update) => {
          if (update.vy < 0 || update.vy >= this.params.maxHeight) {
            return false;
          }

          const { vx, vy, vz, type, rotation, yRotation } = update;

          const currId = this.getVoxelByVoxel(vx, vy, vz);
          const currRot = this.getVoxelRotationByVoxel(vx, vy, vz);

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
   * Get a chunk instance by its 2D coordinates.
   *
   * @param cx The 2D chunk X position.
   * @param cz The 2D chunk Z position.
   * @returns The chunk at the given coordinate.
   */
  getChunk = (cx: number, cz: number) => {
    return this.getChunkByName(ChunkUtils.getChunkName([cx, cz]));
  };

  /**
   * Get a chunk instance by its coordinate representation.
   *
   * @param name The 2D coordinate representation of the chunk.
   * @returns The chunk at the given coordinate.
   */
  getChunkByName = (name: string) => {
    return this.chunks.get(name);
  };

  /**
   * Get a chunk by a 3D voxel coordinate.
   *
   * @param vx The voxel's X position.
   * @param vy The voxel's Y position.
   * @param vz The voxel's Z position.
   * @returns The chunk at the given voxel coordinate.
   */
  getChunkByVoxel = (vx: number, vy: number, vz: number) => {
    const coords = ChunkUtils.mapVoxelToChunk(
      [vx, vy, vz],
      this.params.chunkSize
    );

    return this.getChunk(...coords);
  };

  /**
   * Get the voxel ID at the given 3D voxel coordinate.
   *
   * @param vx The voxel's X position.
   * @param vy The voxel's Y position.
   * @param vz The voxel's Z position.
   * @returns The voxel's ID at the given coordinate.
   */
  getVoxelByVoxel = (vx: number, vy: number, vz: number) => {
    const chunk = this.getChunkByVoxel(vx, vy, vz);
    if (!chunk) return 0;
    return chunk.getVoxel(vx, vy, vz);
  };

  /**
   * Get the voxel ID at the given 3D world coordinate.
   *
   * @param wx The voxel's un-floored X position.
   * @param wy The voxel's un-floored Y position.
   * @param wz The voxel's un-floored Z position.
   * @returns The voxel's ID at the given coordinate.
   */
  getVoxelByWorld = (wx: number, wy: number, wz: number) => {
    const voxel = ChunkUtils.mapWorldToVoxel([wx, wy, wz]);
    return this.getVoxelByVoxel(...voxel);
  };

  /**
   * Get the voxel rotation at the given 3D voxel coordinate.
   *
   * @param vx The voxel's X position.
   * @param vy The voxel's Y position.
   * @param vz The voxel's Z position.
   * @returns The voxel's rotation at the given coordinate.
   */
  getVoxelRotationByVoxel = (vx: number, vy: number, vz: number) => {
    const chunk = this.getChunkByVoxel(vx, vy, vz);
    if (!chunk) return new BlockRotation(0, 0);
    return chunk.getVoxelRotation(vx, vy, vz);
  };

  /**
   * Get the voxel rotation at the given 3D world coordinate.
   *
   * @param wx The voxel's un-floored X position.
   * @param wy The voxel's un-floored Y position.
   * @param wz The voxel's un-floored Z position.
   * @returns The voxel's rotation at the given coordinate.
   */
  getVoxelRotationByWorld = (wx: number, wy: number, wz: number) => {
    const voxel = ChunkUtils.mapWorldToVoxel([wx, wy, wz]);
    return this.getVoxelRotationByVoxel(...voxel);
  };

  /**
   * Get the voxel's stage at the given 3D voxel coordinate.
   *
   * @param vx The voxel's X position.
   * @param vy The voxel's Y position.
   * @param vz The voxel's Z position.
   * @returns The voxel stage at the given coordinate.
   */
  getVoxelStageByVoxel = (vx: number, vy: number, vz: number) => {
    const chunk = this.getChunkByVoxel(vx, vy, vz);
    if (!chunk) return 0;
    return chunk.getVoxelStage(vx, vy, vz);
  };

  /**
   * Get the voxel's stage at the given 3D world coordinate.
   *
   * @param wx The voxel's un-floored X position.
   * @param wy The voxel's un-floored Y position.
   * @param wz The voxel's un-floored Z position.
   * @returns The voxel stage at the given coordinate.
   */
  getVoxelStageByWorld = (wx: number, wy: number, wz: number) => {
    const voxel = ChunkUtils.mapWorldToVoxel([wx, wy, wz]);
    return this.getVoxelStageByVoxel(...voxel);
  };

  /**
   * Get the voxel's sunlight level at the given 3D voxel coordinate.
   *
   * @param vx The voxel's X position.
   * @param vy The voxel's Y position.
   * @param vz The voxel's Z position.
   * @returns The voxel's sunlight level at the given coordinate.
   */
  getSunlightByVoxel = (vx: number, vy: number, vz: number) => {
    const chunk = this.getChunkByVoxel(vx, vy, vz);
    if (!chunk) return 0;
    return chunk.getSunlight(vx, vy, vz);
  };

  /**
   * Get the voxel's sunlight level at the given 3D world coordinate.
   *
   * @param wx The voxel's un-floored X position.
   * @param wy The voxel's un-floored Y position.
   * @param wz The voxel's un-floored Z position.
   * @returns The voxel's sunlight level at the given coordinate.
   */
  getSunlightByWorld = (wx: number, wy: number, wz: number) => {
    const voxel = ChunkUtils.mapWorldToVoxel([wx, wy, wz]);
    return this.getSunlightByVoxel(...voxel);
  };

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
  getLightColorByVoxel = (vx: number, vy: number, vz: number) => {
    const sunlight = this.getSunlightByVoxel(vx, vy, vz);
    const redLight = this.getTorchLightByVoxel(vx, vy, vz, "RED");
    const greenLight = this.getTorchLightByVoxel(vx, vy, vz, "GREEN");
    const blueLight = this.getTorchLightByVoxel(vx, vy, vz, "BLUE");

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
  };

  /**
   * Get a color instance that represents what an object would be like if it
   * were rendered at the given 3D world coordinate. This is useful to dynamically
   * shade objects based on their position in the world. Also used in {@link LightShined}.
   *
   * @param wx The voxel's un-floored X position.
   * @param wy The voxel's un-floored Y position.
   * @param wz The voxel's un-floored Z position.
   * @returns The voxel's light color at the given coordinate.
   */
  getLightColorByWorld = (wx: number, wy: number, wz: number) => {
    const voxel = ChunkUtils.mapWorldToVoxel([wx, wy, wz]);
    return this.getLightColorByVoxel(...voxel);
  };

  /**
   * Get the voxel's torch light level at the given 3D voxel coordinate.
   *
   * @param vx The voxel's X position.
   * @param vy The voxel's Y position.
   * @param vz The voxel's Z position.
   * @param color The color of the torch light to get.
   * @returns The voxel's torch light level at the given coordinate.
   */
  getTorchLightByVoxel = (
    vx: number,
    vy: number,
    vz: number,
    color: LightColor
  ) => {
    const chunk = this.getChunkByVoxel(vx, vy, vz);
    if (!chunk) return 0;
    return chunk.getTorchLight(vx, vy, vz, color);
  };

  /**
   * Get the voxel's torch light level at the given 3D world coordinate.
   *
   * @param wx The voxel's un-floored X position.
   * @param wy The voxel's un-floored Y position.
   * @param wz The voxel's un-floored Z position.
   * @param color The color of the torch light to get.
   * @returns The voxel's torch light level at the given coordinate.
   */
  getTorchLightByWorld = (
    wx: number,
    wy: number,
    wz: number,
    color: LightColor
  ) => {
    const voxel = ChunkUtils.mapWorldToVoxel([wx, wy, wz]);
    return this.getTorchLightByVoxel(...voxel, color);
  };

  /**
   * Get the block data at the given 3D voxel coordinate.
   *
   * @param vx The voxel's X position.
   * @param vy The voxel's Y position.
   * @param vz The voxel's Z position.
   * @returns The block type data at the given coordinate.
   */
  getBlockByVoxel = (vx: number, vy: number, vz: number) => {
    const voxel = this.getVoxelByVoxel(vx, vy, vz);
    return this.registry.getBlockById(voxel);
  };

  /**
   * Get the block data at the given 3D world coordinate.
   *
   * @param wx The voxel's un-floored X position.
   * @param wy The voxel's un-floored Y position.
   * @param wz The voxel's un-floored Z position.
   * @returns The block type data at the given coordinate.
   */
  getBlockByWorld = (wx: number, wy: number, wz: number) => {
    const voxel = ChunkUtils.mapWorldToVoxel([wx, wy, wz]);
    return this.getBlockByVoxel(...voxel);
  };

  /**
   * Get the maximum height of the block column at the given 3D voxel coordinate.
   *
   * @param vx The voxel's X position.
   * @param vz The voxel's Z position.
   * @returns The max height at the given coordinate.
   */
  getMaxHeightByVoxel = (vx: number, vz: number) => {
    for (let vy = this.params.maxHeight - 1; vy >= 0; vy--) {
      const id = this.getVoxelByVoxel(vx, vy, vz);

      if (vy == 0 || this.registry.checkHeight(id)) {
        return vy;
      }
    }

    return 0;
  };

  /**
   * Get the maximum height of the block column at the given 3D world coordinate.
   *
   * @param wx The voxel's un-floored X position.
   * @param wz The voxel's un-floored Z position.
   * @returns The max height at the given coordinate.
   */
  getMaxHeightByWorld = (wx: number, wz: number) => {
    const voxel = ChunkUtils.mapWorldToVoxel([wx, 0, wz]);
    return this.getMaxHeightByVoxel(voxel[0], voxel[2]);
  };

  /**
   * Get the previous voxel ID before the latest update was made.
   *
   * @param vx The voxel's X position.
   * @param vy The voxel's Y position.
   * @param vz The voxel's Z position.
   * @returns The voxel ID that was previously at the given coordinate.
   */
  getPreviousVoxelByVoxel = (vx: number, vy: number, vz: number) => {
    const name = ChunkUtils.getVoxelName([vx, vy, vz]);
    return this.blockCache.get(name);
  };

  /**
   * Get the previous voxel ID before the latest update was made.
   *
   * @param wx The voxel's un-floored X position.
   * @param wy The voxel's un-floored Y position.
   * @param wz The voxel's un-floored Z position.
   * @returns The voxel ID that was previously at the given coordinate.
   */
  getPreviousVoxelByWorld = (wx: number, wy: number, wz: number) => {
    const voxel = ChunkUtils.mapWorldToVoxel([wx, wy, wz]);
    return this.getPreviousVoxelByVoxel(...voxel);
  };

  /**
   * Get the block AABBs by the given 3D voxel coordinate.
   *
   * @param vx The voxel's X position.
   * @param vy The voxel's Y position.
   * @param vz The voxel's Z position.
   * @param ignoreFluid Whether to ignore fluid blocks.
   * @returns The AABB of the block at the given coordinate.
   */
  getBlockAABBsByVoxel = (vx: number, vy: number, vz: number) => {
    if (vy >= this.params.maxHeight || vy < 0) {
      return [];
    }

    const id = this.getVoxelByVoxel(vx, vy, vz);
    const rotation = this.getVoxelRotationByVoxel(vx, vy, vz);
    const { aabbs } = this.getBlockById(id);

    return aabbs.map((aabb) => rotation.rotateAABB(aabb));
  };

  /**
   * Get the block AABBs by the given 3D world coordinate.
   *
   * @param wx The voxel's un-floored X position.
   * @param wy The voxel's un-floored Y position.
   * @param wz The voxel's un-floored Z position.
   * @param ignoreFluid Whether to ignore fluid blocks.
   * @returns The AABB of the block at the given coordinate.
   */
  getBlockAABBsByWorld = (wx: number, wy: number, wz: number) => {
    const voxel = ChunkUtils.mapWorldToVoxel([wx, wy, wz]);
    return this.getBlockAABBsByVoxel(...voxel);
  };

  /**
   * Get the uniform value of the minimum brightness at sunlight `0` voxels.
   *
   * @returns The minimum brightness of the chunk.
   */
  getMinBrightness = () => {
    return this.uniforms.minBrightness.value;
  };

  /**
   * Set the uniform value of the minimum brightness at sunlight level of `0` voxels.
   *
   * @param minBrightness The minimum brightness value.
   */
  setMinBrightness = (minBrightness: number) => {
    this.uniforms.minBrightness.value = minBrightness;
  };

  /**
   * Get the uniform value of the intensity of sunlight.
   *
   * @returns The intensity of the sun.
   */
  getSunlightIntensity = () => {
    return this.uniforms.sunlightIntensity.value;
  };

  /**
   * Set the uniform value of the intensity of sunlight.
   *
   * @param intensity The intensity of the sun.
   */
  setSunlightIntensity = (intensity: number) => {
    if (intensity < 0 || intensity > this.params.maxLightLevel) {
      throw new Error(
        `Sunlight intensity must be between 0 and ${this.params.maxLightLevel}`
      );
    }

    this.uniforms.sunlightIntensity.value = intensity;
  };

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
  isWithinWorld = (cx: number, cz: number) => {
    const { minChunk, maxChunk } = this.params;

    return (
      cx >= minChunk[0] &&
      cx <= maxChunk[0] &&
      cz >= minChunk[1] &&
      cz <= maxChunk[1]
    );
  };

  /**
   * This checks if the chunk is within the given x/z directions by testing of the given chunk
   * coordinate is within `3 * Math.PI / 5` radians of the given direction.
   *
   * @param cx The chunk's X position.
   * @param cz The chunk's Z position.
   * @param dx The x direction that is being checked.
   * @param dz The z direction that is being checked.
   * @returns Whether or not the chunk is within the render view.
   */
  isChunkInView = (cx: number, cz: number, dx: number, dz: number) => {
    const [pcx, pcz] = this.chunks.currentChunk;

    if ((pcx - cx) ** 2 + (pcz - cz) ** 2 <= this.params.inViewRadius ** 2) {
      return true;
    }

    const vec1 = new Vector3(cz - pcz, cx - pcx, 0);
    const vec2 = new Vector3(dz, dx, 0);
    const angle = MathUtils.normalizeAngle(vec1.angleTo(vec2));

    return Math.abs(angle) < (Math.PI * 3) / 5;
  };

  /**
   * Get a mesh of the model of the given block.
   *
   * @param id The ID of the block.
   * @returns A 3D mesh of the block model.
   */
  makeBlockMesh = (id: number) => {
    const block = this.registry.getBlockById(id);
    if (!block) return null;

    const { faces, isSeeThrough } = block;

    const geometry = new BufferGeometry();

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    faces.forEach(({ corners, name }) => {
      const ndx = Math.floor(positions.length / 3);
      const { startU, endU, startV, endV } = this.registry.ranges.get(
        Registry.makeSideName(block.name, name)
      );

      corners.forEach(({ uv, pos }) => {
        positions.push(...pos);
        uvs.push(
          uv[0] * (endU - startU) + startU,
          uv[1] * (endV - startV) + startV
        );
      });

      indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
    });

    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);

    const material = new MeshBasicMaterial({
      transparent: isSeeThrough,
      alphaTest: 0.3,
      map: this.atlas.texture,
    });

    const mesh = new Mesh(geometry, material);
    mesh.name = block.name;

    return mesh;
  };

  /**
   * Get the transparent material instances for this specific block. If this set of material instances
   * does not exist, then they will be created.
   *
   * @param identifier The identifier of the block.
   * @returns The material instances related to the block.
   */
  getTransparentMaterials = (identifier: number) => {
    return this.materials.transparent.has(identifier)
      ? this.materials.transparent.get(identifier)
      : this.overwriteTransparentMaterial(identifier);
  };

  /**
   * Overwrite the chunk shader for a certain block within all chunks. This is useful for, for example, making
   * blocks such as grass to wave in the wind.
   *
   * @param identifier The identifier of the block, which is the ID you want to overwrite.
   * @param shaders The shaders to use for the block.
   * @param shaders.vertexShader The vertex shader to use for the block.
   * @param shaders.fragmentShader The fragment shader to use for the block.
   */
  overwriteTransparentMaterial = (
    identifier: number,
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
    const { transparent } = this.materials;

    if (transparent.has(identifier)) {
      const { front, back } = transparent.get(identifier);

      if (data.vertexShader) {
        front.vertexShader = data.vertexShader;
        back.vertexShader = data.vertexShader;
      }

      if (data.fragmentShader) {
        front.fragmentShader = data.fragmentShader;
        back.fragmentShader = data.fragmentShader;
      }

      if (data.uniforms) {
        front.uniforms = {
          ...front.uniforms,
          ...data.uniforms,
        };

        back.uniforms = {
          ...back.uniforms,
          ...data.uniforms,
        };
      }

      front.needsUpdate = true;
      back.needsUpdate = true;

      return transparent.get(identifier);
    }

    const make = () => {
      const mat = this.makeShaderMaterial(
        data.fragmentShader || DEFAULT_CHUNK_SHADERS.fragment,
        data.vertexShader || DEFAULT_CHUNK_SHADERS.vertex,
        data.uniforms
      );

      mat.transparent = true;
      mat.alphaTest = 0.1;

      if (this.atlas && this.atlas.texture) {
        mat.map = this.atlas.texture;
      }

      return mat;
    };

    const front = make();
    front.side = FrontSide;

    const back = make();
    back.side = BackSide;

    const materials = {
      front,
      back,
    };

    transparent.set(identifier, materials);

    return materials;
  };

  /**
   * The updater of the world. This requests the chunks around the given coordinates and meshes any
   * new chunks that are received from the server. This should be called every frame.
   *
   * @param center The center of the update. That is, the center that the chunks should
   *    be requested around.
   */
  update = (center: Vector3) => {
    // Normalize the delta
    const delta = Math.min(this.clock.getDelta(), 0.1);

    this.calculateCurrChunk(center);

    if (this.callTick % 2 === 0) {
      this.surroundChunks();
    } else {
      this.meshChunks();
    }

    this.addChunks();
    this.requestChunks();
    this.maintainChunks(center);

    this.emitServerUpdates();

    this.updatePhysics(delta);

    this.updateUniforms();

    this.callTick++;
  };

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
    const ignoreFluids = options.ignoreFluids || true;
    const ignorePassables = options.ignorePassables || false;
    const ignoreSeeThrough = options.ignoreSeeThrough || false;
    const ignoreList = new Set(options.ignoreList || []);

    return raycast(
      (wx, wy, wz) => {
        const [vx, vy, vz] = ChunkUtils.mapWorldToVoxel([wx, wy, wz]);
        const {
          id,
          isFluid,
          isPassable,
          isSeeThrough,
          aabbs,
          dynamicFn,
          isDynamic,
        } = this.getBlockByVoxel(vx, vy, vz);

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

        const rotation = this.getVoxelRotationByVoxel(vx, vy, vz);

        return (
          isDynamic
            ? dynamicFn
              ? dynamicFn([vx, vy, vz], this).aabbs
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
   * The render radius that this world is requesting chunks at.
   */
  get renderRadius() {
    return this._renderRadius;
  }

  /**
   * Set the render radius that this world is requesting chunks at.
   */
  set renderRadius(radius: number) {
    this._renderRadius = radius;
    this.setFogDistance(radius);
  }

  /**
   * Applies the server settings onto this world.
   */
  private setParams = (data: WorldServerParams) => {
    this.initialized = true;

    Object.keys(data).forEach((key) => {
      this.params[key] = data[key];
    });
  };

  /**
   * Calculate the current chunk that the world is centered around.
   */
  private calculateCurrChunk = (center: Vector3) => {
    const { chunkSize } = this.params;

    const coords = ChunkUtils.mapVoxelToChunk(
      ChunkUtils.mapWorldToVoxel([center.x, center.y, center.z]),
      chunkSize
    );

    this.chunks.currentChunk = coords;
  };

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
            const { type, vx, vy, vz } = update;

            const chunk = this.getChunkByVoxel(vx, vy, vz);

            if (chunk) {
              this.blockCache.set(
                ChunkUtils.getVoxelName([vx, vy, vz]),
                chunk.getVoxel(vx, vy, vz)
              );
              chunk.setVoxel(vx, vy, vz, type);

              if (!isNaN(update.rotation) || !isNaN(update.yRotation)) {
                chunk.setVoxelRotation(
                  vx,
                  vy,
                  vz,
                  BlockRotation.encode(update.rotation, update.yRotation)
                );
              }
            }

            let raw = 0;
            raw = BlockUtils.insertID(raw, update.type);

            if (!isNaN(update.rotation) || !isNaN(update.yRotation)) {
              raw = BlockUtils.insertRotation(
                raw,
                BlockRotation.encode(update.rotation, update.yRotation)
              );
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
   * Go around the center chunk and request chunks that are not already requested.
   */
  private surroundChunks = () => {
    const [cx, cz] = this.chunks.currentChunk;

    (() => {
      const now = performance.now();
      for (let x = -this.renderRadius; x <= this.renderRadius; x++) {
        for (let z = -this.renderRadius; z <= this.renderRadius; z++) {
          // Stop process if it's taking too long.
          if (performance.now() - now >= this.params.updateTimeout) {
            return;
          }

          if (x ** 2 + z ** 2 >= this.renderRadius ** 2) continue;

          if (!this.isWithinWorld(cx + x, cz + z)) {
            continue;
          }

          const name = ChunkUtils.getChunkName([cx + x, cz + z]);

          if (this.chunks.requested.has(name)) {
            let already = this.chunks.requested.get(name);
            already += 1;

            if (already > this.params.rerequestTicks) {
              this.chunks.toRequest.push(name);
              this.chunks.requested.delete(name);
            } else {
              this.chunks.requested.set(name, already);
            }

            continue;
          }

          const chunk = this.getChunkByName(name);

          if (!chunk) {
            if (!this.chunks.toRequest.includes(name)) {
              this.chunks.toRequest.push(name);
            }

            continue;
          }

          if (!chunk.isReady) {
            continue;
          }

          if (!this.chunks.toAdd.includes(chunk.name) && !chunk.added) {
            this.chunks.toAdd.push(chunk.name);
          }
        }
      }
    })();
  };

  /**
   * Setup the physics engine for this world.
   */
  private setupPhysics = () => {
    // initialize the physics engine with server provided parameters.
    this.physics = new PhysicsEngine(
      (vx: number, vy: number, vz: number) => {
        const id = this.getVoxelByVoxel(vx, vy, vz);
        const rotation = this.getVoxelRotationByVoxel(vx, vy, vz);
        const { aabbs, isPassable, isFluid } = this.getBlockById(id);

        if (isPassable || isFluid) return [];

        return aabbs.map((aabb) =>
          rotation.rotateAABB(aabb).translate([vx, vy, vz])
        );
      },
      (vx: number, vy: number, vz: number) => {
        const id = this.getVoxelByVoxel(vx, vy, vz);
        const { isFluid } = this.getBlockById(id);
        return isFluid;
      },
      this.params
    );
  };

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
      const chunk = this.getChunkByVoxel(...(body.getPosition() as Coords3));

      if ((!chunk || !chunk.isReady) && this.isWithinWorld(...coords)) {
        return;
      }

      this.physics.iterateBody(body, delta, noGravity);
    });
  };

  /**
   * Actually requesting chunks from the server.
   */
  private requestChunks = () => {
    const { maxRequestsPerTick } = this.params;
    const toRequest = this.chunks.toRequest.splice(
      0,
      this.chunks.get(ChunkUtils.getChunkName(this.chunks.currentChunk))
        ? maxRequestsPerTick
        : maxRequestsPerTick * 10
    );

    if (toRequest.length === 0) return;

    toRequest.forEach((name) => this.chunks.requested.set(name, 1));

    this.packets.push({
      type: "LOAD",
      json: {
        chunks: toRequest.map((name) => ChunkUtils.parseChunkName(name)),
      },
    });
  };

  /**
   * Mesh the received chunk data.
   */
  private meshChunks = () => {
    const { maxProcessesPerTick, updateTimeout } = this.params;

    const now = performance.now();
    let count = 0;

    const [cx, cz] = this.chunks.currentChunk;

    this.chunks.toProcess.sort((a, b) => {
      const [{ x: cx1, z: cz1 }, aTime] = a;
      const [{ x: cx2, z: cz2 }, bTime] = b;

      if (cx1 === cx2 && cz1 === cz2) {
        return aTime - bTime;
      }

      return (
        (cx - cx1) ** 2 + (cz - cz1) ** 2 - (cx - cx2) ** 2 - (cz - cz2) ** 2
      );
    });

    while (count < maxProcessesPerTick && this.chunks.toProcess.length) {
      const data = this.chunks.toProcess.shift();
      const { x, z } = data[0];

      this.chunks.requested.delete(ChunkUtils.getChunkName([x, z]));

      count++;
      this.meshChunk(data[0]);

      if (performance.now() - now > updateTimeout) {
        return;
      }
    }
  };

  /**
   * Mesh a single chunk data.
   */
  private meshChunk = (data: ChunkProtocol) => {
    const { x, z, id } = data;

    let chunk = this.getChunk(x, z);

    const { chunkSize, maxHeight, subChunks } = this.params;

    let fresh = false;

    if (!chunk) {
      chunk = new Chunk(id, x, z, {
        size: chunkSize,
        maxHeight,
        subChunks,
      });

      this.chunks.set(chunk.name, chunk);

      fresh = true;
    }

    // TODO: kinda ugly passing in the whole world here.
    chunk.build(data, this).then(() => {
      if (!fresh) return;

      const listeners = this.chunkInitListeners.get(chunk.name);
      if (!listeners) return;

      listeners.forEach((listener) => listener(chunk));
      this.chunkInitListeners.delete(chunk.name);
    });
  };

  /**
   * Scaffold add chunks to the scene.
   */
  private addChunks = () => {
    const toAdd = this.chunks.toAdd.splice(0, this.params.maxAddsPerTick);

    toAdd.forEach((name) => {
      const chunk = this.chunks.get(name);
      if (chunk) {
        chunk.addToScene(this);
      }
    });
  };

  // If the chunk is too far away, remove from scene. If chunk is not in the view,
  // make it invisible to the client.
  private maintainChunks = (center: Vector3) => {
    const { chunkSize, defaultDeleteRadius } = this.params;

    const deleteDistance = defaultDeleteRadius * chunkSize;
    const deleted: Coords2[] = [];

    for (const chunk of this.chunks.values()) {
      const dist = chunk.distTo(center.x, center.y, center.z);

      if (dist > deleteDistance) {
        chunk.dispose();
        chunk.removeFromScene(this);
        this.chunks.delete(chunk.name);
        deleted.push(chunk.coords);
      }
    }

    if (deleted.length) {
      this.packets.push({
        type: "UNLOAD",
        json: {
          chunks: deleted,
        },
      });
    }
  };

  /**
   * Load the texture atlas.
   */
  private loadAtlas = () => {
    if (this.atlas && this.atlas.texture) {
      this.atlas.texture.dispose();
    }

    /* -------------------------------------------------------------------------- */
    /*                             Generating Texture                             */
    /* -------------------------------------------------------------------------- */
    const { textureDimension } = this.params;

    const { sources, keyframes, ranges } = this.registry;

    Array.from(ranges.keys()).forEach((key) => {
      if (!sources.has(key) && !keyframes.has(key)) {
        sources.set(key, null);
        keyframes.set(key, null);
      }
    });

    const textures = new Map();

    Array.from(sources.entries()).forEach(([sideName, source]) => {
      textures.set(
        sideName,
        source
          ? // @ts-ignore
            source.isColor
            ? source
            : this.loader.getTexture(source as string)
          : null
      );
    });

    Array.from(keyframes.entries()).forEach(([sideName, keyframes]) => {
      if (keyframes) {
        keyframes[0].forEach((keyframe) => {
          if (typeof keyframe[1] === "string") {
            keyframe[1] = this.loader.getTexture(keyframe[1]) as any;
          }
        });

        textures.set(sideName, keyframes);
      }
    });

    this.atlas = new TextureAtlas(textures, ranges, {
      countPerSide: this.registry.perSide,
      dimension: textureDimension,
    });

    this.uniforms.atlas.value = this.atlas.texture;

    if (this.materials.opaque) {
      this.materials.opaque.map = this.atlas.texture;
    } else {
      this.materials.opaque = this.makeShaderMaterial();
    }

    this.materials.transparent.forEach(({ front, back }) => {
      front.map = this.atlas.texture;
      back.map = this.atlas.texture;
    });
  };

  /**
   * Handle any server chunk data by either meshing it immediately or adding it
   * to the queue.
   */
  private handleServerChunk = (data: ChunkProtocol, urgent = false) => {
    if (urgent) {
      this.meshChunk(data);
    } else {
      this.chunks.toProcess.push([data, performance.now()]);
    }
  };

  /**
   * Update the uniform values.
   */
  private updateUniforms = () => {
    this.uniforms.time.value = performance.now();
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
        map: this.uniforms.atlas,
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

    material.map = this.uniforms.atlas.value;

    material.toneMapped = false;

    return material;
  };
}
