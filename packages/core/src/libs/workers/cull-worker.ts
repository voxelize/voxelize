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

function get(
  arr: Uint8Array,
  x: number,
  y: number,
  z: number,
  strideX: number,
  strideY: number,
  strideZ: number
) {
  const index = x * strideX + y * strideY + z * strideZ;
  return index >= arr.length || index < 0 ? 0 : arr[index];
}

// @ts-ignore
onmessage = function (e) {
  const {
    data,
    configs: { dimensions, min, max, realMin, realMax, stride },
  } = e.data;

  const positions = [];
  const normals = [];
  const indices = [];

  const [startX, startY, startZ] = min;
  const [endX, endY, endZ] = max;
  const [realStartX, realStartY, realStartZ] = realMin;
  const [realEndX, realEndY, realEndZ] = realMax;
  const [strideX, strideY, strideZ] = stride;

  const [dx, dy, dz] = dimensions;

  for (let vx = startX, x = 0; vx < endX; ++vx, ++x) {
    for (let vz = startZ, z = 0; vz < endZ; ++vz, ++z) {
      for (let vy = startY, y = 0; vy < endY; ++vy, ++y) {
        const voxel = get(data, vx, vy, vz, strideX, strideY, strideZ);

        if (voxel) {
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

            if (
              !get(data, nvx, nvy, nvz, strideX, strideY, strideZ) ||
              !inRealBounds
            ) {
              // this voxel has no neighbor in this direction so we need a face.
              const ndx = positions.length / 3;

              for (let cornerIndex = 0; cornerIndex < corners.length; cornerIndex++) {
                const corner = corners[cornerIndex];
                const posX = corner[0] + x;
                const posY = corner[1] + y;
                const posZ = corner[2] + z;

                positions.push(posX * dx, posY * dy, posZ * dz);
                normals.push(dir[0], dir[1], dir[2]);
              }

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

  postMessage(
    {
      positions: positionsArray,
      normals: normalsArray,
      indices: indicesArray,
    },
    // @ts-ignore
    [positionsArray.buffer, normalsArray.buffer, indicesArray.buffer]
  );
};
