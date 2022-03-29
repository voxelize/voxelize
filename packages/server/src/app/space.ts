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

type SpaceParams = {
  margin: number;
  chunkSize: number;
  maxHeight: number;
};

type MappedNdArray = Map<string, NdArray<Uint32Array>>;

type TransferableArrayMap = { [key: string]: ArrayBuffer };

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

type SpaceTransferable = {
  output: SpaceTransferableData;
  buffers: ArrayBuffer[];
};

class Space {
  public width: number;
  public shape: Coords3;
  public min: Coords3;

  public voxelsShape?: Coords3;
  public lightsShape?: Coords3;
  public heightMapShape?: Coords3;

  public voxels?: MappedNdArray = new Map();
  public lights?: MappedNdArray = new Map();
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
   * Access a voxel by voxel coordinates within the space
   *
   * @param vx: Voxel x position
   * @param vz: Voxel z position
   *
   * @memberof Space
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
   * Access raw voxel by voxel coordinates within the space
   *
   * @param vx: Voxel x position
   * @param vz: Voxel z position
   *
   * @memberof Space
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
   * Access a voxel rotation by voxel coordinates within the space
   *
   * @param vx: Voxel x position
   * @param vz: Voxel z position
   *
   * @memberof Space
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
   * Access a voxel stage by voxel coordinates within the space
   *
   * @param vx: Voxel x position
   * @param vz: Voxel z position
   *
   * @memberof Space
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
   * Access sunlight by voxel coordinates within the space
   *
   * @param vx: Voxel x position
   * @param vz: Voxel z position
   *
   * @memberof Space
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
   * Set the sunlight by voxel coordinates within the space
   *
   * @param vx: Voxel x position
   * @param vz: Voxel z position
   *
   * @memberof Space
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

    return 0;
  };

  /**
   * Access red light by voxel coordinates within the space
   *
   * @param vx: Voxel x position
   * @param vz: Voxel z position
   *
   * @memberof Space
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
   * Set the red light by voxel coordinates within the space
   *
   * @param vx: Voxel x position
   * @param vz: Voxel z position
   *
   * @memberof Space
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

    return 0;
  };

  /**
   * Access green light by voxel coordinates within the space
   *
   * @param vx: Voxel x position
   * @param vz: Voxel z position
   *
   * @memberof Space
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
   * Set the green light by voxel coordinates within the space
   *
   * @param vx: Voxel x position
   * @param vz: Voxel z position
   *
   * @memberof Space
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
   * Access blue light by voxel coordinates within the space
   *
   * @param vx: Voxel x position
   * @param vz: Voxel z position
   *
   * @memberof Space
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
   * Set the blue light by voxel coordinates within the space
   *
   * @param vx: Voxel x position
   * @param vz: Voxel z position
   *
   * @memberof Space
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
   * Access torch light by voxel coordinates within the space
   *
   * @param vx: Voxel x position
   * @param vz: Voxel z position
   *
   * @memberof Space
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
   * Access torch light by voxel coordinates within the space
   *
   * @param vx: Voxel x position
   * @param vz: Voxel z position
   *
   * @memberof Space
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
   * Access raw light by voxel coordinates within the space
   *
   * @param vx: Voxel x position
   * @param vz: Voxel z position
   *
   * @memberof Space
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
   * Access the max height by voxel column within the space
   *
   * @param vx - Voxel x position
   * @param vz - Voxel z position
   *
   * @memberof Space
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
   * Get a reference to the voxels data array
   *
   * @memberof Space
   */
  getVoxels = (cx: number, cz: number) => {
    return this.voxels?.get(ChunkUtils.getChunkName([cx, cz]));
  };

  /**
   * Get a reference to the lights data array
   *
   * @memberof Space
   */
  getLights = (cx: number, cz: number) => {
    return this.lights?.get(ChunkUtils.getChunkName([cx, cz]));
  };

  /**
   * Get a reference to the height map data array
   *
   * @memberof Space
   */
  getHeightMap = (cx: number, cz: number) => {
    return this.heightMaps?.get(ChunkUtils.getChunkName([cx, cz]));
  };

  /**
   * Exports a space into a worker-transferable data structure
   *
   * @memberof Space
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
   * Import a space from a worker-transferable data structure
   *
   * @memberof Space
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
