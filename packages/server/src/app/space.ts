import { isMainThread } from "worker_threads";

import {
  BlockUtils,
  ChunkUtils,
  Coords2,
  Coords3,
  LightColor,
  LightUtils,
} from "@voxelize/common";
import ndarray, { NdArray } from "ndarray";

import { Chunks } from "./chunks";
import { ExportOptions } from "./shared";

/**
 * Space parameters.
 */
type SpaceParams = {
  margin: number;
  chunkSize: number;
  maxHeight: number;
};

type MappedNdArray = Map<string, NdArray<Uint32Array>>;

type TransferableArrayMap = { [key: string]: ArrayBuffer };

/**
 * Information about the chunk to construct an identical space.
 */
type SpaceTransferableData = {
  coords: Coords2;
  width: number;
  shape: Coords3;
  min: Coords3;
  voxelsShape: Coords3;
  lightsShape: Coords3;
  heightMapShape: Coords3;
  voxels: TransferableArrayMap;
  lights: TransferableArrayMap;
  heightMaps: TransferableArrayMap;
  params: SpaceParams;
  fields: ExportOptions;
};

/**
 * Information containing the array buffers and other data ready to be used to
 * create a space instance.
 */
type SpaceTransferable = {
  output: SpaceTransferableData;
  buffers: ArrayBuffer[];
};

/**
 * A space in Voxelize is a data structure that allows developers to pass large amount of
 * chunk data into other threads without losing the ability to query data easily. For instance,
 * a space with a margin of 16 and a chunk size of 16 would have an additional 16/16=1 layer of
 * chunk surrounding the target chunk, creating a 3*3 grid of chunks that one can easily access
 * data within. Constructors have optional parameters because constructing a space from an export
 * requires an empty space instance.
 *
 * Notes:
 * - The margin on the space should be greater than 0.
 * - An error will be thrown if space is constructed with non-existent chunks.
 *
 * DO NOT INSTANTIATE A SPACE WITHOUT PASSING IN PARAMETERS! UNLESS CALLING `Space.import`.
 *
 * @param chunks - `Chunks` manager of the world, used to access chunk data
 * @param coords - Chunk coordinates of the center chunk
 * @param fields - `ExportOptions` describing what data this space should store
 * @param fields.needVoxels - For whether this export needs voxel data
 * @param fields.needLights - For whether this export needs lighting data
 * @param fields.needHeightMap - For whether this export needs max height data
 * @param params - `SpaceParams`, parameters to construct a space
 */
class Space {
  /**
   * Width of the space.
   */
  public width: number;

  /**
   * 3D shape of the space.
   */
  public shape: Coords3;

  /**
   * Minimum voxel coordinate of the space.
   */
  public min: Coords3;

  /**
   * Shape of the n-dimensional voxel data.
   */
  public voxelsShape?: Coords3;

  /**
   * Shape of the n-dimensional lighting data.
   */
  public lightsShape?: Coords3;

  /**
   * Shape of the n-dimensional height map data.
   */
  public heightMapShape?: Coords3;

  /**
   * A map of n-dimensional arrays that store the actual voxel data.
   */
  public voxels?: MappedNdArray = new Map();

  /**
   * A map of n-dimensional arrays that store the actual lighting data.
   */
  public lights?: MappedNdArray = new Map();

  /**
   * A map of n-dimensional arrays that store the actual height map data.
   */
  public heightMaps?: MappedNdArray = new Map();

  constructor(
    chunks?: Chunks,
    public coords?: Coords2,
    public fields?: ExportOptions,
    public params?: SpaceParams
  ) {
    if (!chunks && !params && !fields && !isMainThread) return;

    const { margin, chunkSize, maxHeight } = params;
    const { needLights, needVoxels, needHeightMap } = fields;
    const [cx, cz] = coords;

    if (margin <= 0) {
      throw new Error("Margin of 0 on Space is wasteful");
    }

    const extended = Math.ceil(margin / chunkSize);

    this.width = chunkSize + margin * 2;

    for (let x = -extended; x <= extended; x++) {
      for (let z = -extended; z <= extended; z++) {
        const name = ChunkUtils.getChunkName([cx + x, cz + z]);
        const chunk = chunks.raw(name);

        if (!chunk) {
          throw new Error("Space incomplete!");
        }

        if (chunk) {
          const { voxels, heightMap, lights } = chunk;

          if (needLights) this.lights.set(name, lights);
          if (needVoxels) this.voxels.set(name, voxels);
          if (needHeightMap) this.heightMaps.set(name, heightMap);

          // ? a bit hacky
          if (!this.voxelsShape) {
            this.voxelsShape = voxels.shape as Coords3;
            this.lightsShape = lights.shape as Coords3;
            this.heightMapShape = heightMap.shape as Coords3;
          }
        }
      }
    }

    this.min = [cx * chunkSize - margin, 0, cz * chunkSize - margin];
    this.shape = [this.width, maxHeight, this.width];
  }

  /**
   * Access a voxel by voxel coordinates within the space.
   *
   * @param vx - Voxel x position
   * @param vy - Voxel y position
   * @param vz - Voxel z position
   * @returns Voxel type at vx,vy,vz
   */
  getVoxel = (vx: number, vy: number, vz: number) => {
    if (!this.fields.needVoxels) {
      throw new Error("Space does not contain voxel data.");
    }

    const {
      name,
      contains,
      local: [lx, ly, lz],
    } = this.toLocal(vx, vy, vz);

    const voxels = this.voxels.get(name);

    if (voxels && contains) {
      return BlockUtils.extractID(voxels.get(lx, ly, lz));
    }

    return 0;
  };

  /**
   * Access raw voxel by voxel coordinates within the space.
   *
   * @param vx - Voxel x position
   * @param vy - Voxel y position
   * @param vz - Voxel z position
   * @returns Raw voxel value at vx,vy,vz
   */
  getRawVoxel = (vx: number, vy: number, vz: number) => {
    if (!this.fields.needVoxels) {
      throw new Error("Space does not contain voxel data.");
    }

    const {
      name,
      contains,
      local: [lx, ly, lz],
    } = this.toLocal(vx, vy, vz);

    const voxels = this.voxels.get(name);

    if (voxels && contains) {
      return voxels.get(lx, ly, lz);
    }

    return 0;
  };

  /**
   * Access a voxel rotation by voxel coordinates within the space.
   *
   * @param vx - Voxel x position
   * @param vy - Voxel y position
   * @param vz - Voxel z position
   * @returns Voxel rotation at vx,vy,vz
   */
  getVoxelRotation = (vx: number, vy: number, vz: number) => {
    if (!this.fields.needLights) {
      throw new Error("Space does not contain sunlight data.");
    }

    const {
      name,
      contains,
      local: [lx, ly, lz],
    } = this.toLocal(vx, vy, vz);

    const voxels = this.voxels.get(name);

    if (voxels && contains) {
      return BlockUtils.extractRotation(voxels.get(lx, ly, lz));
    }

    return 0;
  };

  /**
   * Access a voxel stage by voxel coordinates within the space.
   *
   * @param vx - Voxel x position
   * @param vy - Voxel y position
   * @param vz - Voxel z position
   * @returns Voxel stage at vx,vy,vz
   */
  getVoxelStage = (vx: number, vy: number, vz: number) => {
    if (!this.fields.needLights) {
      throw new Error("Space does not contain sunlight data.");
    }

    const {
      name,
      contains,
      local: [lx, ly, lz],
    } = this.toLocal(vx, vy, vz);

    const voxels = this.voxels.get(name);

    if (voxels && contains) {
      return BlockUtils.extractStage(voxels.get(lx, ly, lz));
    }

    return 0;
  };

  /**
   * Access sunlight by voxel coordinates within the space.
   *
   * @param vx - Voxel x position
   * @param vy - Voxel y position
   * @param vz - Voxel z position
   * @returns Sunlight level at vx,vy,vz
   */
  getSunlight = (vx: number, vy: number, vz: number) => {
    if (!this.fields.needLights) {
      throw new Error("Space does not contain sunlight data.");
    }

    const {
      name,
      contains,
      local: [lx, ly, lz],
    } = this.toLocal(vx, vy, vz);

    const lights = this.lights.get(name);

    if (lights && contains) {
      return LightUtils.extractSunlight(lights.get(lx, ly, lz));
    }

    return 0;
  };

  /**
   * Set the sunlight by voxel coordinates within the space.
   *
   * @param vx - Voxel x position
   * @param vy - Voxel y position
   * @param vz - Voxel z position
   * @param level - Desired level of sunlight
   * @returns Sunlight level at vx,vy,vz
   */
  setSunlight = (vx: number, vy: number, vz: number, level: number) => {
    if (!this.fields.needLights) {
      throw new Error("Space does not contain sunlight data.");
    }

    const {
      name,
      contains,
      local: [lx, ly, lz],
    } = this.toLocal(vx, vy, vz);

    const lights = this.lights.get(name);

    if (lights && contains) {
      lights.set(
        lx,
        ly,
        lz,
        LightUtils.insertSunlight(lights.get(lx, ly, lz), level)
      );
    }

    return level;
  };

  /**
   * Access red light by voxel coordinates within the space.
   *
   * @param vx - Voxel x position
   * @param vy - Voxel y position
   * @param vz - Voxel z position
   * @returns Red light level at vx,vy,vz
   */
  getRedLight = (vx: number, vy: number, vz: number) => {
    if (!this.fields.needLights) {
      throw new Error("Space does not contain red light data.");
    }

    const {
      name,
      contains,
      local: [lx, ly, lz],
    } = this.toLocal(vx, vy, vz);

    const lights = this.lights.get(name);

    if (lights && contains) {
      return LightUtils.extractRedLight(lights.get(lx, ly, lz));
    }

    return 0;
  };

  /**
   * Set the red light by voxel coordinates within the space.
   *
   * @param vx - Voxel x position
   * @param vy - Voxel y position
   * @param vz - Voxel z position
   * @param level - Desired level of red light
   * @returns Red light level at vx,vy,vz
   */
  setRedLight = (vx: number, vy: number, vz: number, level: number) => {
    if (!this.fields.needLights) {
      throw new Error("Space does not contain red light data.");
    }

    const {
      name,
      contains,
      local: [lx, ly, lz],
    } = this.toLocal(vx, vy, vz);

    const lights = this.lights.get(name);

    if (lights && contains) {
      lights.set(
        lx,
        ly,
        lz,
        LightUtils.insertRedLight(lights.get(lx, ly, lz), level)
      );
    }

    return level;
  };

  /**
   * Access green light by voxel coordinates within the space.
   *
   * @param vx - Voxel x position
   * @param vy - Voxel y position
   * @param vz - Voxel z position
   * @returns Green light level at vx,vy,vz
   */
  getGreenLight = (vx: number, vy: number, vz: number) => {
    if (!this.fields.needLights) {
      throw new Error("Space does not contain green light data.");
    }

    const {
      name,
      contains,
      local: [lx, ly, lz],
    } = this.toLocal(vx, vy, vz);

    const lights = this.lights.get(name);

    if (lights && contains) {
      return LightUtils.extractGreenLight(lights.get(lx, ly, lz));
    }

    return 0;
  };

  /**
   * Set the green light by voxel coordinates within the space.
   *
   * @param vx - Voxel x position
   * @param vy - Voxel y position
   * @param vz - Voxel z position
   * @param level - Desired level of green light
   * @returns Green light level at vx,vy,vz
   */
  setGreenLight = (vx: number, vy: number, vz: number, level: number) => {
    if (!this.fields.needLights) {
      throw new Error("Space does not contain green light data.");
    }

    const {
      name,
      contains,
      local: [lx, ly, lz],
    } = this.toLocal(vx, vy, vz);

    const lights = this.lights.get(name);

    if (lights && contains) {
      lights.set(
        lx,
        ly,
        lz,
        LightUtils.insertGreenLight(lights.get(lx, ly, lz), level)
      );
    }

    return 0;
  };

  /**
   * Access blue light by voxel coordinates within the space.
   *
   * @param vx - Voxel x position
   * @param vy - Voxel y position
   * @param vz - Voxel z position
   * @returns Blue light level at vx,vy,vz
   */
  getBlueLight = (vx: number, vy: number, vz: number) => {
    if (!this.fields.needLights) {
      throw new Error("Space does not contain blue light data.");
    }

    const {
      name,
      contains,
      local: [lx, ly, lz],
    } = this.toLocal(vx, vy, vz);

    const lights = this.lights.get(name);

    if (lights && contains) {
      return LightUtils.extractBlueLight(lights.get(lx, ly, lz));
    }

    return 0;
  };

  /**
   * Set the blue light by voxel coordinates within the space.
   *
   * @param vx - Voxel x position
   * @param vy - Voxel y position
   * @param vz - Voxel z position
   * @param level - Desired level of blue light
   * @returns Blue light level at vx,vy,vz
   */
  setBlueLight = (vx: number, vy: number, vz: number, level: number) => {
    if (!this.fields.needLights) {
      throw new Error("Space does not contain blue light data.");
    }

    const {
      name,
      contains,
      local: [lx, ly, lz],
    } = this.toLocal(vx, vy, vz);

    const lights = this.lights.get(name);

    if (lights && contains) {
      lights.set(
        lx,
        ly,
        lz,
        LightUtils.insertBlueLight(lights.get(lx, ly, lz), level)
      );
    }

    return 0;
  };

  /**
   * Access torch light by voxel coordinates within the space.
   *
   * @param vx - Voxel x position
   * @param vy - Voxel y position
   * @param vz - Voxel z position
   * @param color - Color of torch light
   * @returns Torch light level at vx,vy,vz
   */
  getTorchLight = (vx: number, vy: number, vz: number, color: LightColor) => {
    switch (color) {
      case "RED":
        return this.getRedLight(vx, vy, vz);
      case "GREEN":
        return this.getGreenLight(vx, vy, vz);
      case "BLUE":
        return this.getBlueLight(vx, vy, vz);
      default:
        throw new Error("Space received unknown light color...");
    }
  };

  /**
   * Access torch light by voxel coordinates within the space.
   *
   * @param vx - Voxel x position
   * @param vy - Voxel y position
   * @param vz - Voxel z position
   * @param level - Desired level of torch light
   * @param color - Color of torch light
   * @returns Torch light level at vx,vy,vz
   */
  setTorchLight = (
    vx: number,
    vy: number,
    vz: number,
    level: number,
    color: LightColor
  ) => {
    switch (color) {
      case "RED":
        return this.setRedLight(vx, vy, vz, level);
      case "GREEN":
        return this.setGreenLight(vx, vy, vz, level);
      case "BLUE":
        return this.setBlueLight(vx, vy, vz, level);
      default:
        throw new Error("Space received unknown light color...");
    }
  };

  /**
   * Access raw light by voxel coordinates within the space.
   *
   * @param vx - Voxel x position
   * @param vy - Voxel y position
   * @param vz - Voxel z position
   * @returns Raw light data at vx,vy,vz
   */
  getRawLight = (vx: number, vy: number, vz: number) => {
    if (!this.fields.needLights) {
      throw new Error("Space does not contain sunlight data.");
    }

    const {
      name,
      contains,
      local: [lx, ly, lz],
    } = this.toLocal(vx, vy, vz);

    const lights = this.lights.get(name);

    if (lights && contains) {
      return lights.get(lx, ly, lz);
    }

    return 0;
  };

  /**
   * Access the max height by voxel column within the space.
   *
   * @param vx - Voxel x position
   * @param vz - Voxel z position
   * @returns Max height at vx,vz
   */
  getMaxHeight = (vx: number, vz: number) => {
    if (!this.fields.needHeightMap) {
      throw new Error("Space does not have height map data.");
    }

    const {
      name,
      local: [lx, , lz],
    } = this.toLocal(vx, 0, vz);

    const heightMap = this.heightMaps.get(name);

    if (heightMap) {
      return heightMap.get(lx, lz);
    }

    return 0;
  };

  /**
   * Get a reference to the voxels data array.
   *
   * @returns N-dimensional voxel array at chunk coordinates
   */
  getVoxels = (cx: number, cz: number) => {
    return this.voxels?.get(ChunkUtils.getChunkName([cx, cz]));
  };

  /**
   * Get a reference to the lights data array.
   *
   * @returns N-dimensional lighting array at chunk coordinates
   */
  getLights = (cx: number, cz: number) => {
    return this.lights?.get(ChunkUtils.getChunkName([cx, cz]));
  };

  /**
   * Get a reference to the height map data array.
   *
   * @returns N-dimensional height-map array at chunk coordinates
   */
  getHeightMap = (cx: number, cz: number) => {
    return this.heightMaps?.get(ChunkUtils.getChunkName([cx, cz]));
  };

  /**
   * Exports a space into a worker-transferable data structure.
   *
   * @returns A worker-transferable object that represents the space
   */
  export = () => {
    const buffers: ArrayBuffer[] = [];

    const voxels: TransferableArrayMap = {};
    const lights: TransferableArrayMap = {};
    const heightMaps: TransferableArrayMap = {};

    this.voxels.forEach((v, name) => {
      voxels[name] = v.data.buffer;
      buffers.push(v.data.buffer.slice(0));
    });

    this.lights.forEach((l, name) => {
      lights[name] = l.data.buffer;
      buffers.push(l.data.buffer.slice(0));
    });

    this.heightMaps.forEach((hm, name) => {
      heightMaps[name] = hm.data.buffer;
      buffers.push(hm.data.buffer.slice(0));
    });

    return {
      output: {
        voxels,
        lights,
        heightMaps,
        min: this.min,
        shape: this.shape,
        width: this.width,
        coords: this.coords,
        voxelsShape: this.voxelsShape,
        lightsShape: this.lightsShape,
        heightMapShape: this.heightMapShape,
        params: this.params,
        fields: this.fields,
      },
      buffers: buffers.filter(Boolean),
    } as SpaceTransferable;
  };

  /**
   * Import a space from a worker-transferable data structure.
   *
   * @static
   * @param raw - A space transferable data that describes a space
   * @returns a new `Space` instance
   */
  static import = (raw: SpaceTransferableData) => {
    const {
      width,
      shape,
      coords,
      min,
      heightMaps,
      heightMapShape,
      voxels,
      voxelsShape,
      lights,
      lightsShape,
      params,
      fields,
    } = raw;

    const instance = new Space();

    instance.coords = coords;
    instance.width = width;
    instance.shape = shape;
    instance.min = min;
    instance.voxelsShape = voxelsShape;
    instance.heightMapShape = heightMapShape;
    instance.params = params;
    instance.fields = fields;

    instance.voxels = new Map();
    instance.lights = new Map();
    instance.heightMaps = new Map();

    Object.keys(voxels).forEach((name) => {
      const arr = voxels[name];
      instance.voxels.set(name, ndarray(new Uint32Array(arr), voxelsShape));
    });

    Object.keys(lights).forEach((name) => {
      const arr = lights[name];
      instance.lights.set(name, ndarray(new Uint32Array(arr), lightsShape));
    });

    Object.keys(heightMaps).forEach((name) => {
      const arr = heightMaps[name];
      instance.heightMaps.set(
        name,
        ndarray(new Uint32Array(arr), heightMapShape)
      );
    });

    return instance;
  };

  private toLocal = (vx: number, vy: number, vz: number) => {
    const { chunkSize, maxHeight } = this.params;
    const coords = ChunkUtils.mapVoxelPosToChunkPos([vx, vy, vz], chunkSize);
    const local = ChunkUtils.mapVoxelPosToChunkLocalPos(
      [vx, vy, vz],
      chunkSize
    );

    return {
      local,
      coords,
      contains: vy >= 0 && vy < maxHeight,
      name: ChunkUtils.getChunkName(coords),
    };
  };
}

export type { SpaceTransferable, SpaceTransferableData };

export { Space };
