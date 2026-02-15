declare module "*?sharedworker" {
  const SharedWorkerFactory: new () => SharedWorker;
  export default SharedWorkerFactory;
}

declare module "*?sharedworker&inline" {
  const SharedWorkerFactory: new () => SharedWorker;
  export default SharedWorkerFactory;
}

declare module "*?worker" {
  const WebWorkerFactory: new (options?: WorkerOptions) => Worker;
  export default WebWorkerFactory;
}

declare module "*?worker&url" {
  const WebWorkerFactory: new () => Worker;
  export default WebWorkerFactory;
}

declare module "*?worker&inline" {
  const WebWorkerFactory: new (options?: WorkerOptions) => Worker;
  export default WebWorkerFactory;
}

declare module "*.glsl" {
  const value: string;
  export default value;
}

declare module "*.glsl?raw" {
  const value: string;
  export default value;
}

declare module "postprocessing";

declare module "@voxelize/wasm-mesher" {
  type ChunkData = {
    voxels: Uint32Array | number[];
    lights: Uint32Array | number[];
    shape: [number, number, number];
    min: [number, number, number];
  };

  type GeometryData = {
    voxel: number;
    at: [number, number, number] | null;
    faceName: string | null;
    positions: number[];
    indices: number[];
    uvs: number[];
    lights: number[];
  };

  export const set_registry: (registry: object) => void;
  export const mesh_chunk_fast: (
    chunks: (ChunkData | null)[],
    min: Int32Array,
    max: Int32Array,
    chunkSize: number,
    greedyMeshing: boolean
  ) => { geometries: GeometryData[] };

  const init: () => Promise<void>;
  export default init;
}
