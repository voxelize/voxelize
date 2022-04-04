import { Coords2, BaseChunk, MeshData } from "@voxelize/common";

import { ExportOptions } from "./shared";

/**
 * Chunk parameters.
 */
type ChunkParams = {
  size: number;
  maxHeight: number;
};

/**
 * Information about the chunk to construct an identical chunk.
 */
type ChunkTransferableData = {
  id: string;
  voxels?: ArrayBuffer;
  lights?: ArrayBuffer;
  heightMap?: ArrayBuffer;
  coords: Coords2;
  params: ChunkParams;
};

/**
 * Information containing the array buffers and other data ready to be passed
 * into a chunk instance.
 */
type ChunkTransferable = {
  output: ChunkTransferableData;
  buffers: ArrayBuffer[];
};

/**
 * A base group of blocks in the infinite world of Voxelize. Used to
 * hold lighting, voxels, and mesh data for each `width * height * depth`
 * amount of blocks.
 *
 * @extends {BaseChunk}
 */
class Chunk extends BaseChunk {
  /**
   * Mesh data for `Chunk`
   */
  public mesh: {
    transparent?: MeshData;
    opaque?: MeshData;
  } = {};

  /**
   * Exports chunk into a worker-transferable object.
   *
   * @param options - Options of export, to not over-export unused members
   * @param options.needVoxels - Option for whether this export needs voxel data
   * @param options.needLights - Option for whether this export needs lighting data
   * @param options.needHeightMap - Option for whether this export needs max height data
   * @returns An object containing transferable data of the chunk
   */
  export = (
    { needVoxels, needLights, needHeightMap }: ExportOptions = {
      needVoxels: false,
      needLights: false,
      needHeightMap: false,
    }
  ) => {
    const output: ChunkTransferableData = {
      id: this.id,
      coords: this.coords,
      params: this.params,
    };

    const buffers: ArrayBuffer[] = [];

    if (needVoxels) {
      output.voxels = this.voxels.data.buffer;
      buffers.push(this.voxels.data.buffer.slice(0));
    }

    if (needLights) {
      output.lights = this.lights.data.buffer;
      buffers.push(this.lights.data.buffer.slice(0));
    }

    if (needHeightMap) {
      output.heightMap = this.heightMap.data.buffer;
      buffers.push(this.heightMap.data.buffer.slice(0));
    }

    return {
      output,
      buffers,
    } as ChunkTransferable;
  };

  /**
   * Import results from exported data into the chunk itself. Calls `Chunk.import`
   * with itself as instance.
   *
   * @param raw - `ChunkTransferableData`, holding information to build a chunk.
   * @returns A chunk instance built from provided data
   */
  import = (raw: ChunkTransferableData) => {
    return Chunk.import(raw, this);
  };

  /**
   * Construct a new chunk or mutate a passed-in instance with the provided information.
   *
   * @static
   * @param raw - `ChunkTransferableData` holding chunk information
   * @param [instance] - Optional, passed in to overwrite existing instance's data
   * @returns A chunk instance built from provided data
   */
  static import = (raw: ChunkTransferableData, instance?: Chunk) => {
    const { id, coords, params, heightMap, lights, voxels } = raw;

    instance = instance || new Chunk(id, ...coords, params);

    if (heightMap) {
      instance.heightMap.data = new Uint32Array(heightMap);
    }

    if (lights) {
      instance.lights.data = new Uint32Array(lights);
    }

    if (voxels) {
      instance.voxels.data = new Uint32Array(voxels);
    }

    return instance;
  };
}

export type { ChunkTransferable, ChunkTransferableData };

export { Chunk, ChunkParams };
