import { Coords2, BaseChunk, MeshData } from "@voxelize/common";

import { ExportOptions } from "./shared";

type ChunkParams = {
  size: number;
  maxHeight: number;
};

type ChunkTransferableData = {
  id: string;
  voxels?: ArrayBuffer;
  lights?: ArrayBuffer;
  heightMap?: ArrayBuffer;
  coords: Coords2;
  params: ChunkParams;
};

type ChunkTransferable = {
  output: ChunkTransferableData;
  buffers: ArrayBuffer[];
};

class Chunk extends BaseChunk {
  public mesh: {
    transparent?: MeshData;
    opaque?: MeshData;
  } = {};

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

  import = (raw: ChunkTransferableData) => {
    return Chunk.import(raw, this);
  };

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
