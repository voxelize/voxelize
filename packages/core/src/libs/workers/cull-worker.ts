const FACES = [
  {
    // left
    dir: [-1, 0, 0],
    corners: [
      [0, 1, 0],
      [0, 0, 0],
      [0, 1, 1],
      [0, 0, 1],
    ],
  },
  {
    // right
    dir: [1, 0, 0],
    corners: [
      [1, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
      [1, 0, 0],
    ],
  },
  {
    // bottom
    dir: [0, -1, 0],
    corners: [
      [1, 0, 1],
      [0, 0, 1],
      [1, 0, 0],
      [0, 0, 0],
    ],
  },
  {
    // top
    dir: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
  {
    // back
    dir: [0, 0, -1],
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
  {
    // front
    dir: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
    ],
  },
];

type CullWorkerMessage = {
  data: Uint8Array;
  configs: {
    dimensions: [number, number, number];
    min: [number, number, number];
    max: [number, number, number];
    realMin: [number, number, number];
    realMax: [number, number, number];
    stride: [number, number, number];
  };
};

self.onmessage = function (e: MessageEvent<CullWorkerMessage>) {
  const {
    data,
    configs: { dimensions, min, max, realMin, realMax, stride },
  } = e.data;

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let vertexCount = 0;

  const [startX, startY, startZ] = min;
  const [endX, endY, endZ] = max;
  const [realStartX, realStartY, realStartZ] = realMin;
  const [realEndX, realEndY, realEndZ] = realMax;
  const [strideX, strideY, strideZ] = stride;
  const dataLength = data.length;

  const [dx, dy, dz] = dimensions;

  for (let vx = startX, x = 0; vx < endX; ++vx, ++x) {
    for (let vz = startZ, z = 0; vz < endZ; ++vz, ++z) {
      for (let vy = startY, y = 0; vy < endY; ++vy, ++y) {
        const voxelIndex = vx * strideX + vy * strideY + vz * strideZ;
        const voxel =
          voxelIndex >= 0 && voxelIndex < dataLength ? data[voxelIndex] : 0;

        if (voxel) {
          const baseX = x * dx;
          const baseY = y * dy;
          const baseZ = z * dz;
          // There is a voxel here but do we need faces for it?
          for (let faceIndex = 0; faceIndex < FACES.length; faceIndex++) {
            const face = FACES[faceIndex];
            const { dir, corners } = face;
            const nvx = vx + dir[0];
            const nvy = vy + dir[1];
            const nvz = vz + dir[2];
            const inRealBounds =
              nvx < realEndX &&
              nvx >= realStartX &&
              nvy < realEndY &&
              nvy >= realStartY &&
              nvz < realEndZ &&
              nvz >= realStartZ;
            let neighborSolid = 0;
            if (inRealBounds) {
              const neighborIndex = nvx * strideX + nvy * strideY + nvz * strideZ;
              if (neighborIndex >= 0 && neighborIndex < dataLength) {
                neighborSolid = data[neighborIndex];
              }
            }

            if (!neighborSolid) {
              // this voxel has no neighbor in this direction so we need a face.
              const ndx = vertexCount;

              for (let cornerIndex = 0; cornerIndex < corners.length; cornerIndex++) {
                const corner = corners[cornerIndex];
                positions.push(
                  baseX + corner[0] * dx,
                  baseY + corner[1] * dy,
                  baseZ + corner[2] * dz
                );
                normals.push(dir[0], dir[1], dir[2]);
              }
              vertexCount += corners.length;

              indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
            }
          }
        }
      }
    }
  }

  const positionsArray = new Float32Array(positions);
  const normalsArray = new Int8Array(normals);
  const indicesArray = new Uint32Array(indices);

  self.postMessage(
    {
      positions: positionsArray,
      normals: normalsArray,
      indices: indicesArray,
    },
    {
      transfer: [positionsArray.buffer, normalsArray.buffer, indicesArray.buffer],
    }
  );
};
