import { NdArray } from "ndarray";
import CullWorker from "web-worker:./workers/cull-worker.ts";

import { Coords3 } from "../types";

import { WorkerPool } from "./worker-pool";

export type MeshResultType = {
  positions: Float32Array;
  normals: Float32Array;
  indices: Float32Array;
};

export type CullOptionsType = {
  min: Coords3;
  max: Coords3;
  realMin: Coords3;
  realMax: Coords3;
  dimensions: Coords3;
};

const cullPool = new WorkerPool(CullWorker, {
  maxWorker: 6,
});

async function cull(
  array: NdArray,
  options: CullOptionsType
): Promise<MeshResultType> {
  const { stride, data } = array;
  const { dimensions, min, max, realMin, realMax } = options;

  const voxelsBuffer = (<Uint8Array>data).buffer.slice(0);

  const { positions, normals, indices } = await new Promise<MeshResultType>(
    (resolve) => {
      cullPool.addJob({
        message: {
          data: voxelsBuffer,
          configs: {
            min,
            max,
            realMin,
            realMax,
            dimensions,
            stride,
          },
        },
        resolve,
        buffers: [voxelsBuffer],
      });
    }
  );

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Float32Array(indices),
  };
}

export { cull };
