import { Engine as PhysicsEngine } from "@voxelize/physics-engine";
import { ChunkProtocol, MessageProtocol } from "@voxelize/transport/src/types";
import {
  BackSide,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  FrontSide,
  Mesh,
  MeshBasicMaterial,
  Scene,
  ShaderLib,
  ShaderMaterial,
  sRGBEncoding,
  Texture,
  UniformsUtils,
  Vector3,
  Vector4,
} from "three";

import { ArtFunction } from "../../libs";
import { Coords2, Coords3 } from "../../types";
import { BlockUtils, ChunkUtils, LightColor, MathUtils } from "../../utils";
import { NetIntercept } from "../network";

import { TextureAtlas } from "./atlas";
import { Block, BlockRotation, BlockUpdate, PY_ROTATION } from "./block";
import { Chunk } from "./chunk";
import { Chunks } from "./chunks";
import { Loader } from "./loader";
import { Registry, TextureData, TextureRange } from "./registry";

export * from "./atlas";
export * from "./block";
export * from "./chunk";
export * from "./chunks";
export * from "./registry";

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

export type WorldParams = WorldClientParams & WorldServerParams;

/**
 * @category Core
 */
export class World extends Scene implements NetIntercept {
  // @ts-ignore
  public params: WorldParams = {};

  public initialized = false;

  public chunks: Chunks;

  public physics: PhysicsEngine;

  /**
   * The generated texture atlas built from all registered block textures.
   */
  public atlas: TextureAtlas;

  public uniforms: {
    fogColor: {
      value: Color;
    };
    fogNear: {
      value: number;
    };
    fogFar: {
      value: number;
    };
    atlas: {
      value: Texture | null;
    };
    ao: {
      value: Vector4;
    };
    minBrightness: {
      value: number;
    };
    sunlightIntensity: {
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
  };

  public blockCache = new Map<string, number>();

  public registry: Registry;

  /**
   * The shared material instances for chunks.
   */
  public materials: {
    opaque?: CustomShaderMaterial;
    transparent?: {
      front: CustomShaderMaterial;
      back: CustomShaderMaterial;
    };
  } = {};

  public packets: MessageProtocol[] = [];

  public loader: Loader = new Loader();

  private chunkInitListeners = new Map<string, ((chunk: Chunk) => void)[]>();

  private _renderRadius = 8;

  private callTick = 0;

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
        this.loadAtlas();
        this.setFogDistance(this.renderRadius);

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
   * @param textures - List of data to load into the game before the game starts.
   */
  applyTexturesByNames = (textures: TextureData[]) => {
    textures.forEach((texture) => {
      this.applyTextureByName(texture);
    });
  };

  /**
   * Apply a texture onto a face/side of a block.
   *
   * @param texture - The data of the texture and where the texture is applying to.
   */
  applyTextureByName = (texture: TextureData) => {
    const { data } = texture;

    // Offload texture loading to the loader for the loading screen
    if (typeof data === "string") {
      this.loader.addTexture(data);
    }

    this.registry.applyTextureByName(texture);
  };

  /**
   * Get the block information by its name.
   *
   * @param name - The name of the block to get.
   */
  getBlockByName = (name: string) => {
    return this.registry.getBlockByName(name);
  };

  /**
   * Get the block information by its ID.
   *
   * @param id - The ID of the block to get.
   */
  getBlockById = (id: number) => {
    return this.registry.getBlockById(id);
  };

  /**
   * Reverse engineer to get the block information from a texture name.
   *
   * @param textureName - The texture name that the block has.
   */
  getBlockByTextureName = (textureName: string) => {
    return this.registry.getBlockByTextureName(textureName);
  };

  /**
   * Applies the server settings onto this world.
   * Caution: do not call this after game started!
   *
   * @memberof World
   */
  setParams = (data: WorldServerParams) => {
    this.initialized = true;

    Object.keys(data).forEach((key) => {
      this.params[key] = data[key];
    });
  };

  /**
   * Set the farthest distance for the fog. Fog starts fogging up 50% from the farthest.
   *
   * @param distance - The maximum distance that the fog fully fogs up.
   */
  setFogDistance = (distance: number) => {
    const { chunkSize } = this.params;

    this.uniforms.fogNear.value = distance * 0.5 * chunkSize;
    this.uniforms.fogFar.value = distance * chunkSize;
  };

  setFogColor = (color: Color) => {
    this.uniforms.fogColor.value.copy(color);
  };

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

  updateVoxels = (updates: BlockUpdate[]) => {
    this.chunks.toUpdate.push(
      ...updates.filter((update) => {
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
          (rotation ? currRot.value === rotation : true) &&
          (yRotation ? currRot.yRotation === yRotation : true)
        ) {
          return false;
        }

        return true;
      })
    );
  };

  getChunk = (cx: number, cz: number) => {
    return this.getChunkByName(ChunkUtils.getChunkName([cx, cz]));
  };

  getChunkByName = (name: string) => {
    return this.chunks.get(name);
  };

  getChunkByVoxel = (vx: number, vy: number, vz: number) => {
    const coords = ChunkUtils.mapVoxelPosToChunkPos(
      [vx, vy, vz],
      this.params.chunkSize
    );

    return this.getChunk(...coords);
  };

  getVoxelByVoxel = (vx: number, vy: number, vz: number) => {
    const chunk = this.getChunkByVoxel(vx, vy, vz);
    if (!chunk) return 0;
    return chunk.getVoxel(vx, vy, vz);
  };

  getVoxelByWorld = (wx: number, wy: number, wz: number) => {
    const voxel = ChunkUtils.mapWorldPosToVoxelPos([wx, wy, wz]);
    return this.getVoxelByVoxel(...voxel);
  };

  getVoxelRotationByVoxel = (vx: number, vy: number, vz: number) => {
    const chunk = this.getChunkByVoxel(vx, vy, vz);
    if (!chunk) return new BlockRotation(0, 0);
    return chunk.getVoxelRotation(vx, vy, vz);
  };

  getVoxelStageByVoxel = (vx: number, vy: number, vz: number) => {
    const chunk = this.getChunkByVoxel(vx, vy, vz);
    if (!chunk) return 0;
    return chunk.getVoxelStage(vx, vy, vz);
  };

  getSunlightByVoxel = (vx: number, vy: number, vz: number) => {
    const chunk = this.getChunkByVoxel(vx, vy, vz);
    if (!chunk) return 0;
    return chunk.getSunlight(vx, vy, vz);
  };

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

  getLightColorByWorld = (wx: number, wy: number, wz: number) => {
    const voxel = ChunkUtils.mapWorldPosToVoxelPos([wx, wy, wz]);
    return this.getLightColorByVoxel(...voxel);
  };

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

  getBlockByVoxel = (vx: number, vy: number, vz: number) => {
    const voxel = this.getVoxelByVoxel(vx, vy, vz);
    return this.registry.getBlockById(voxel);
  };

  getBlockByWorld = (wx: number, wy: number, wz: number) => {
    const voxel = ChunkUtils.mapWorldPosToVoxelPos([wx, wy, wz]);
    return this.getBlockByVoxel(...voxel);
  };

  getMaxHeightByVoxel = (vx: number, vz: number) => {
    for (let vy = this.params.maxHeight - 1; vy >= 0; vy--) {
      const id = this.getVoxelByVoxel(vx, vy, vz);

      if (vy == 0 || this.registry.checkHeight(id)) {
        return vy;
      }
    }

    return 0;
  };

  getMaxHeightByWorld = (wx: number, wz: number) => {
    const voxel = ChunkUtils.mapWorldPosToVoxelPos([wx, 0, wz]);
    return this.getMaxHeightByVoxel(voxel[0], voxel[2]);
  };

  getPreviousVoxelByVoxel = (vx: number, vy: number, vz: number) => {
    const name = ChunkUtils.getVoxelName([vx, vy, vz]);
    return this.blockCache.get(name);
  };

  getPreviousVoxelByWorld = (wx: number, wy: number, wz: number) => {
    const voxel = ChunkUtils.mapWorldPosToVoxelPos([wx, wy, wz]);
    return this.getPreviousVoxelByVoxel(...voxel);
  };

  getBlockAABBsByVoxel = (
    vx: number,
    vy: number,
    vz: number,
    ignoreFluid = false
  ) => {
    if (vy >= this.params.maxHeight || vy < 0) {
      return [];
    }

    const id = this.getVoxelByVoxel(vx, vy, vz);
    const rotation = this.getVoxelRotationByVoxel(vx, vy, vz);
    const { isFluid, aabbs } = this.getBlockById(id);

    return ignoreFluid && isFluid
      ? []
      : aabbs.map((aabb) => rotation.rotateAABB(aabb));
  };

  getBlockAABBsByWorld = (
    wx: number,
    wy: number,
    wz: number,
    ignoreFluid = false
  ) => {
    const voxel = ChunkUtils.mapWorldPosToVoxelPos([wx, wy, wz]);
    return this.getBlockAABBsByVoxel(...voxel, ignoreFluid);
  };

  setMinBrightness = (minBrightness: number) => {
    this.uniforms.minBrightness.value = minBrightness;
  };

  getSunlightIntensity = () => {
    return this.uniforms.sunlightIntensity.value;
  };

  setSunlightIntensity = (intensity: number) => {
    if (intensity < 0 || intensity > this.params.maxLightLevel) {
      throw new Error(
        `Sunlight intensity must be between 0 and ${this.params.maxLightLevel}`
      );
    }

    this.uniforms.sunlightIntensity.value = intensity;
  };

  addChunkInitListener = (
    coords: Coords2,
    listener: (chunk: Chunk) => void
  ) => {
    const name = ChunkUtils.getChunkName(coords);
    const listeners = this.chunkInitListeners.get(name) || [];
    listeners.push(listener);
    this.chunkInitListeners.set(name, listeners);
  };

  isWithinWorld = (cx: number, cz: number) => {
    const { minChunk, maxChunk } = this.params;

    return (
      cx >= minChunk[0] &&
      cx <= maxChunk[0] &&
      cz >= minChunk[1] &&
      cz <= maxChunk[1]
    );
  };

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

  canPlace = (vx: number, vy: number, vz: number, type: number) => {
    const current = this.getBlockByVoxel(vx, vy, vz);

    return this.getVoxelByVoxel(vx, vy, vz) === 0 || current.isFluid;
  };

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
        this.registry.makeSideName(block.name, name)
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

  update = (center: Vector3, delta: number) => {
    // Normalize the delta
    delta = Math.min(delta, 0.1);

    this.calculateCurrChunk(center);

    if (this.callTick % 2 === 0) {
      this.surroundChunks();
    } else if (this.callTick % 3 === 0) {
      this.meshChunks();
    }

    this.addChunks();
    this.requestChunks();
    this.maintainChunks(center);

    this.emitServerUpdates();

    this.updatePhysics(delta);

    this.callTick++;
  };

  get renderRadius() {
    return this._renderRadius;
  }

  set renderRadius(radius: number) {
    this._renderRadius = radius;
    this.setFogDistance(radius);
  }

  private calculateCurrChunk = (center: Vector3) => {
    const { chunkSize } = this.params;

    const coords = ChunkUtils.mapVoxelPosToChunkPos(
      ChunkUtils.mapWorldPosToVoxelPos([center.x, center.y, center.z]),
      chunkSize
    );

    this.chunks.currentChunk = coords;
  };

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
            raw = BlockUtils.insertId(raw, update.type);

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

  private updatePhysics = (delta: number) => {
    if (!this.physics || !this.params.gravity) return;

    const noGravity =
      this.params.gravity[0] ** 2 +
        this.params.gravity[1] ** 2 +
        this.params.gravity[2] ** 2 <
      0.01;

    this.physics.bodies.forEach((body) => {
      const coords = ChunkUtils.mapVoxelPosToChunkPos(
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

  private meshChunks = () => {
    const { maxProcessesPerTick, updateTimeout } = this.params;

    const now = performance.now();
    let count = 0;

    const [cx, cz] = this.chunks.currentChunk;
    this.chunks.toProcess.sort((a, b) => {
      const { x: cx1, z: cz1 } = a;
      const { x: cx2, z: cz2 } = b;

      return (
        (cx - cx1) ** 2 + (cz - cz1) ** 2 - (cx - cx2) ** 2 - (cz - cz2) ** 2
      );
    });

    while (count < maxProcessesPerTick && this.chunks.toProcess.length) {
      const data = this.chunks.toProcess.shift();
      const { x, z } = data;

      this.chunks.requested.delete(ChunkUtils.getChunkName([x, z]));

      count++;
      this.meshChunk(data);

      if (performance.now() - now > updateTimeout) {
        return;
      }
    }
  };

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

    chunk.build(data, this.materials).then(() => {
      if (!fresh) return;

      const listeners = this.chunkInitListeners.get(chunk.name);
      if (!listeners) return;

      listeners.forEach((listener) => listener(chunk));
      this.chunkInitListeners.delete(chunk.name);
    });
  };

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

  private loadAtlas = () => {
    if (this.atlas && this.atlas.texture) {
      this.atlas.texture.dispose();
    }

    /* -------------------------------------------------------------------------- */
    /*                             Generating Texture                             */
    /* -------------------------------------------------------------------------- */
    const { textureDimension } = this.params;

    const { sources, ranges } = this.registry;

    Array.from(ranges.keys()).forEach((key) => {
      if (!sources.has(key)) {
        sources.set(key, null);
      }
    });

    const textures = new Map();
    Array.from(sources.entries()).forEach(([sideName, source]) => {
      textures.set(
        sideName,
        source instanceof Color ? source : this.loader.getTexture(source)
      );
    });

    this.atlas = TextureAtlas.create(textures, ranges, {
      countPerSide: this.registry.perSide,
      dimension: textureDimension,
    });

    this.uniforms.atlas.value = this.atlas.texture;

    if (this.materials.opaque) {
      this.materials.opaque.map = this.atlas.texture.clone();
    } else {
      this.materials.opaque = this.makeShaderMaterial();
    }

    if (this.materials.transparent) {
      this.materials.transparent.front.map = this.atlas.texture.clone();
      this.materials.transparent.back.map = this.atlas.texture.clone();
    } else {
      this.materials.transparent = {} as any;

      const makeTransparentMat = () => {
        const mat = this.makeShaderMaterial();
        mat.transparent = true;
        mat.alphaTest = 0.1;
        // mat.depthWrite = false;
        return mat;
      };

      this.materials.transparent.front = makeTransparentMat();
      this.materials.transparent.back = makeTransparentMat();

      this.materials.transparent.front.side = FrontSide;
      this.materials.transparent.back.side = BackSide;
    }
  };

  private handleServerChunk = (data: ChunkProtocol, urgent = false) => {
    if (urgent) {
      this.meshChunk(data);
    } else {
      this.chunks.toProcess.push(data);
    }
  };

  private makeShaderMaterial = () => {
    const material = new ShaderMaterial({
      vertexColors: true,
      fragmentShader: ShaderLib.basic.fragmentShader
        .replace(
          "#include <common>",
          `
#include <common>
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uSunlightIntensity;
uniform float uMinBrightness;
varying float vAO;
varying vec4 vLight; 
varying vec4 vWorldPosition;
`
        )
        .replace(
          "#include <envmap_fragment>",
          `
#include <envmap_fragment>
// Not sure why, but making this power of 2 makes it look better.
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

// float depth = gl_FragCoord.z / gl_FragCoord.w;
float fogFactor = smoothstep(uFogNear, uFogFar, depth);
gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, fogFactor);
`
        ),
      vertexShader: ShaderLib.basic.vertexShader
        .replace(
          "#include <common>",
          `
attribute int light;
varying float vAO;
varying vec4 vLight;
varying vec4 vWorldPosition;
uniform vec4 uAOTable;
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
      uniforms: {
        ...UniformsUtils.clone(ShaderLib.basic.uniforms),
        map: this.uniforms.atlas,
        uSunlightIntensity: this.uniforms.sunlightIntensity,
        uAOTable: this.uniforms.ao,
        uMinBrightness: this.uniforms.minBrightness,
        uFogNear: this.uniforms.fogNear,
        uFogFar: this.uniforms.fogFar,
        uFogColor: this.uniforms.fogColor,
      },
    }) as CustomShaderMaterial;

    material.map = this.uniforms.atlas.value;
    material.map.encoding = sRGBEncoding;
    material.toneMapped = false;

    return material;
  };
}
