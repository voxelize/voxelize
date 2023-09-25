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
  stride: number[]
) {
  const index = x * stride[0] + y * stride[1] + z * stride[2];
  return index > arr.length || index < 0 ? 0 : arr[index];
}

function contains(voxel, min, max) {
  const [sx, sy, sz] = min;
  const [ex, ey, ez] = max;
  const [vx, vy, vz] = voxel;
  return vx < ex && vx >= sx && vy < ey && vy >= sy && vz < ez && vz >= sz;
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

  const [dx, dy, dz] = dimensions;

  for (let vx = startX, x = 0; vx < endX; ++vx, ++x) {
    for (let vz = startZ, z = 0; vz < endZ; ++vz, ++z) {
      for (let vy = startY, y = 0; vy < endY; ++vy, ++y) {
        const voxel = get(data, vx, vy, vz, stride);

        if (voxel) {
          // There is a voxel here but do we need faces for it?
          for (const { dir, corners } of FACES) {
            const nvx = vx + dir[0];
            const nvy = vy + dir[1];
            const nvz = vz + dir[2];

            const nVoxel = [nvx, nvy, nvz];

            if (
              !get(data, nvx, nvy, nvz, stride) ||
              !contains(nVoxel, realMin, realMax)
            ) {
              // this voxel has no neighbor in this direction so we need a face.
              const ndx = positions.length / 3;

              for (const pos of corners) {
                const posX = pos[0] + x;
                const posY = pos[1] + y;
                const posZ = pos[2] + z;

                positions.push(posX * dx, posY * dy, posZ * dz);
                normals.push(...dir);
              }

              indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
            }
          }
        }
      }
    }
  }

  const positionsArray = new Float32Array(positions);
  const normalsArray = new Float32Array(normals);
  const indicesArray = new Float32Array(indices);

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
