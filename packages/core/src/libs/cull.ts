import { NdArray } from "ndarray";

import { Coords3 } from "../types";

import { WorkerPool } from "./worker-pool";
import CullWorker from "./workers/cull-worker.ts?worker&inline";

export type MeshResultType = {
  positions: Float32Array;
  normals: Int8Array;
  indices: Uint32Array;
};

export type CullOptionsType = {
  min: Coords3;
  max: Coords3;
  realMin: Coords3;
  realMax: Coords3;
  dimensions: Coords3;
};

const cullPool = new WorkerPool(CullWorker, {
  maxWorker: 2,
  name: "cull-worker",
});

export async function cull(
  array: NdArray<Uint8Array>,
  options: CullOptionsType
): Promise<MeshResultType> {
  const { stride, data } = array;
  const { dimensions, min, max, realMin, realMax } = options;
  const sourceBuffer = data.buffer as ArrayBuffer;
  const transferBuffer = sourceBuffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength
  );
  const transferData = new Uint8Array(transferBuffer);

  return new Promise<MeshResultType>((resolve, reject) => {
    cullPool.addJob({
      message: {
        data: transferData,
        configs: {
          min,
          max,
          dimensions,
          stride,
          realMin,
          realMax,
        },
      },
      resolve,
      reject,
      buffers: [transferBuffer],
    });
  });
}
