import { isMainThread } from "worker_threads";

import { ChunkUtils, Coords2, Coords3 } from "@voxelize/common";
import ndarray, { NdArray } from "ndarray";

import { Chunks } from "./chunks";

type SpaceParams = {
  margin: number;
  chunkSize: number;
  maxHeight: number;
};

type MappedNdArray = Map<string, NdArray<Uint32Array>>;

type TransferableArrayMap = { [key: string]: Uint32Array };

type SpaceTransferableData = {
  width: number;
  shape: Coords3;
  min: Coords3;
  voxelsShape: Coords3;
  heightMapShape: Coords3;
  voxels: TransferableArrayMap;
  heightMaps: TransferableArrayMap;
  params: SpaceParams;
};

type SpaceTransferable = {
  output: SpaceTransferableData;
  buffers: ArrayBuffer[];
};

class Space {
  public width: number;
  public shape: Coords3;
  public min: Coords3;

  public voxelsShape: Coords3;
  public heightMapShape: Coords3;

  public voxels: MappedNdArray = new Map();
  public heightMaps: MappedNdArray = new Map();

  constructor(
    public coords?: Coords2,
    chunks?: Chunks,
    public params?: SpaceParams
  ) {
    if (!chunks || !params || !isMainThread) return;

    const { margin, chunkSize, maxHeight } = params;
    const [cx, cz] = coords;

    if (margin <= 0) {
      throw new Error("Margin of 0 on Space is wasteful");
    }

    const extended = Math.ceil(margin / chunkSize);

    this.width = chunkSize + margin * 2;

    for (let x = -extended; x <= extended; x++) {
      for (let z = -extended; z <= extended; z++) {
        const name = ChunkUtils.getChunkName([cx + x, cz + z]);
        const chunk = chunks.getChunkByName(name);

        if (chunk) {
          const { voxels, heightMap } = chunk;
          this.voxels.set(name, voxels);
          this.heightMaps.set(name, heightMap);

          // ? a bit hacky
          if (!this.voxelsShape) {
            this.voxelsShape = voxels.shape as Coords3;
            this.heightMapShape = this.heightMapShape as Coords3;
          }
        }
      }
    }

    this.min = [cx * chunkSize - margin + 1, 0, cz * chunkSize - margin + 1];
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
    const { chunkSize } = this.params;
    const coords = ChunkUtils.mapVoxelPosToChunkPos([vx, vy, vz], chunkSize);
    const [lx, ly, lz] = ChunkUtils.mapVoxelPosToChunkLocalPos(
      [vx, vy, vz],
      chunkSize
    );

    const voxels = this.voxels.get(ChunkUtils.getChunkName(coords));

    if (voxels) {
      return voxels.get(lx, ly, lz);
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
    const { chunkSize } = this.params;
    const coords = ChunkUtils.mapVoxelPosToChunkPos([vx, 0, vz], chunkSize);
    const [lx, , lz] = ChunkUtils.mapVoxelPosToChunkLocalPos(
      [vx, 0, vz],
      chunkSize
    );

    const heightMap = this.heightMaps.get(ChunkUtils.getChunkName(coords));

    if (heightMap) {
      return heightMap.get(lx, lz);
    }

    return 0;
  };

  /**
   * Exports a space into a worker-transferable data structure
   *
   * @memberof Space
   */
  export = () => {
    const buffers: ArrayBuffer[] = [];

    const voxels: TransferableArrayMap = {};
    const heightMaps: TransferableArrayMap = {};

    this.voxels.forEach((v, name) => {
      voxels[name] = v.data;
      buffers.push(v.data.buffer);
    });

    this.heightMaps.forEach((hm, name) => {
      heightMaps[name] = hm.data;
      buffers.push(hm.data.buffer);
    });

    return {
      output: {
        heightMaps,
        voxels,
        min: this.min,
        shape: this.shape,
        width: this.width,
        voxelsShape: this.voxelsShape,
        heightMapShape: this.heightMapShape,
        params: this.params,
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
    if (isMainThread) {
      throw new Error(
        "SpaceTransferable should be used in a worker environment."
      );
    }

    const {
      width,
      shape,
      min,
      heightMaps,
      heightMapShape,
      voxels,
      voxelsShape,
      params,
    } = raw;

    const instance = new Space();

    instance.width = width;
    instance.shape = shape;
    instance.min = min;
    instance.voxelsShape = voxelsShape;
    instance.heightMapShape = heightMapShape;
    instance.params = params;

    instance.voxels = new Map();
    instance.heightMaps = new Map();

    Object.keys(voxels).forEach((name) => {
      const arr = voxels[name];
      instance.voxels.set(name, ndarray(arr, voxelsShape));
    });

    Object.keys(heightMaps).forEach((name) => {
      const arr = heightMaps[name];
      instance.heightMaps.set(name, ndarray(arr, heightMapShape));
    });

    return instance;
  };
}

export { Space };
