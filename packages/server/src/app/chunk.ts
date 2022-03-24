import { Coords2, BaseChunk } from "@voxelize/common";

type ChunkParams = {
  size: number;
  padding: number;
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
  export = (
    {
      voxels,
      lights,
      heightMap,
    }: {
      voxels?: boolean;
      lights?: boolean;
      heightMap?: boolean;
    } = { voxels: false, lights: false, heightMap: false }
  ) => {
    const output: ChunkTransferableData = {
      id: this.id,
      coords: this.coords,
      params: this.params,
    };

    const buffers: ArrayBuffer[] = [];

    if (voxels) {
      output.voxels = this.voxels.data.buffer;
      buffers.push(this.voxels.data.buffer.slice(0));
    }

    if (lights) {
      output.lights = this.lights.data.buffer;
      buffers.push(this.lights.data.buffer.slice(0));
    }

    if (heightMap) {
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
