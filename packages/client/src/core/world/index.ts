import { AABB } from "@voxelize/aabb";
import { Engine as PhysicsEngine } from "@voxelize/physics-engine";
import { MeshProtocol, MessageProtocol } from "@voxelize/transport/src/types";
import { NetIntercept } from "core/network";
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Int32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  Scene,
  Vector3,
  Vector4,
} from "three";

import { Coords2, Coords3 } from "../../types";
import { ChunkUtils, LightColor } from "../../utils";

import { BlockRotation } from "./block";
import { Chunk } from "./chunk";
import { Chunks } from "./chunks";
import { Registry } from "./registry";

export * from "./block";
export * from "./registry";

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

  private oldBlocks: Map<string, number[]> = new Map();

  private initJSON: any = null;

  constructor(params: Partial<WorldParams> = {}) {
    super();

    this.registry = new Registry();
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
    const voxel = ChunkUtils.mapWorldToVoxel([px, py, pz]);
    const coords = ChunkUtils.mapVoxelToChunk(voxel, this.params.chunkSize);
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
  getVoxel(px: number, py: number, pz: number) {
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
  getVoxelRotation(px: number, py: number, pz: number) {
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
  getVoxelStage(px: number, py: number, pz: number) {
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
  getSunlight(px: number, py: number, pz: number) {
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
  getTorchLight(px: number, py: number, pz: number, color: LightColor) {
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
  getLightColor = (vx: number, vy: number, vz: number) => {
    this.initCheck("get light color", false);

    const sunlight = this.getSunlight(vx, vy, vz);
    const redLight = this.getTorchLight(vx, vy, vz, "RED");
    const greenLight = this.getTorchLight(vx, vy, vz, "GREEN");
    const blueLight = this.getTorchLight(vx, vy, vz, "BLUE");

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
   * Get the block type data by a 3D world position.
   *
   * @param px The x coordinate of the position.
   * @param py The y coordinate of the position.
   * @param pz The z coordinate of the position.
   * @returns The block at the given position, or null if it does not exist.
   */
  getBlock(px: number, py: number, pz: number) {
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
  getMaxHeight(px: number, pz: number) {
    this.initCheck("get max height", false);

    const vx = px | 0;
    const vz = pz | 0;

    for (let vy = this.params.maxHeight - 1; vy >= 0; vy--) {
      const block = this.getBlock(vx, vy, vz);
      if (block.isEmpty) {
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
  getPreviousValue(px: number, py: number, pz: number, count = 1) {
    const name = ChunkUtils.getVoxelName([px | 0, py | 0, pz | 0]);
    const arr = this.oldBlocks.get(name) || [];
    return arr[arr.length - count] || 0;
  }

  /**
   * Get the block type data by a block id.
   *
   * @param id The block id.
   * @returns The block data for the given id, or null if it does not exist.
   */
  getBlockById(id: number) {
    return this.registry.blocksById.get(id);
  }

  /**
   * Get the block type data by a block name.
   *
   * @param name The block name.
   * @returns The block data for the given name, or null if it does not exist.
   */
  getBlockByName(name: string) {
    return this.registry.blocksByName.get(name.toLowerCase());
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

    const { blocks, ranges, params } = this.initJSON;

    // Loading the registry
    Object.keys(blocks).forEach((name) => {
      const block = blocks[name];
      const { id, faces, aabbs, isDynamic } = block;

      const lowerName = name.toLowerCase();

      block.independentFaces = new Set();

      for (const face of faces) {
        if (face.highRes || face.animated) {
          block.independentFaces.add(face.name);
          face.independent = true;
        }
      }

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

    // TODO: make the texture atlas here.

    this.initialized = true;
  }

  update(position: Vector3 = new Vector3()) {
    if (!this.initialized) {
      return;
    }

    const center = ChunkUtils.mapVoxelToChunk(
      position.toArray() as Coords3,
      this.params.chunkSize
    );

    this.requestChunks(center);
    this.processChunks(center);
    this.maintainChunks(center);
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
          const oldVal = chunk.getRawValue(vx, vy, vz);

          if (oldVal !== voxel) {
            const name = ChunkUtils.getVoxelName([vx | 0, vy | 0, vz | 0]);
            const arr = this.oldBlocks.get(name) || [];
            arr.push(oldVal);
            this.oldBlocks.set(name, arr);
          }

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

    this.chunks.toRequest = this.chunks.toRequest.filter(([x, z]) => {
      return (x - centerX) ** 2 + (z - centerZ) ** 2 <= deleteRadius ** 2;
    });

    this.chunks.toProcess = this.chunks.toProcess.filter((chunk) => {
      const { x, z } = chunk;
      return (x - centerX) ** 2 + (z - centerZ) ** 2 <= deleteRadius ** 2;
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
      const { faceIdx, voxel, indices, lights, positions, uvs } = geo;

      const geometry = new BufferGeometry();

      geometry.setAttribute(
        "position",
        new Float32BufferAttribute(positions, 3)
      );
      geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
      geometry.setAttribute("light", new Int32BufferAttribute(lights, 1));
      geometry.setIndex(indices);

      const mesh = new Mesh(
        geometry,
        new MeshBasicMaterial({
          color: 0x123f23,
        })
      );

      mesh.position.set(
        cx * chunkSize,
        level * heightPerSubChunk,
        cz * chunkSize
      );

      mesh.updateMatrix();
      mesh.matrixAutoUpdate = false;

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

        const id = this.getVoxel(vx, vy, vz);
        const rotation = this.getVoxelRotation(vx, vy, vz);
        const { aabbs, isPassable, isFluid } = this.getBlockById(id);

        if (isPassable || isFluid) return [];

        return aabbs.map((aabb) =>
          rotation.rotateAABB(aabb).translate([vx, vy, vz])
        );
      },
      (vx: number, vy: number, vz: number) => {
        if (!this.getChunkByPosition(vx, vy, vz)) return false;

        const id = this.getVoxel(vx, vy, vz);
        const { isFluid } = this.getBlockById(id);
        return isFluid;
      },
      this.params
    );
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
