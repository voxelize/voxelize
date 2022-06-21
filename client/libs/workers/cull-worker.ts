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

function get(arr, x, y, z, stride) {
  return arr[x * stride[0] + y * stride[1] + z * stride[2]];
}

function contains(voxel, min, max) {
  const [sx, sy, sz] = min;
  const [ex, ey, ez] = max;
  const [vx, vy, vz] = voxel;
  return vx < ex && vx >= sx && vy < ey && vy >= sy && vz < ez && vz >= sz;
}

onmessage = function (e) {
  const {
    data: dataBuffer,
    configs: { dimensions, min, max, realMin, realMax, stride },
  } = e.data;

  const data = new Uint8Array(dataBuffer);

  const positions = [];
  const normals = [];
  const indices = [];

  const [startX, startY, startZ] = min;
  const [endX, endY, endZ] = max;

  const [dx, dy, dz] = dimensions;

  for (let vx = startX; vx < endX; ++vx) {
    for (let vz = startZ; vz < endZ; ++vz) {
      for (let vy = startY; vy < endY; ++vy) {
        const voxel = get(data, vx, vy, vz, stride);

        if (voxel) {
          // There is a voxel here but do we need faces for it?
          for (const { dir, corners } of FACES) {
            const nvx = vx + dir[0];
            const nvy = vy + dir[1];
            const nvz = vz + dir[2];

            const nVoxel = [vx + dir[0], vy + dir[1], vz + dir[2]];

            const neighbor = get(data, nvx, nvy, nvz, stride);

            if (!neighbor || !contains(nVoxel, realMin, realMax)) {
              // this voxel has no neighbor in this direction so we need a face.
              const ndx = positions.length / 3;

              for (const pos of corners) {
                const posX = pos[0] + vx;
                const posY = pos[1] + vy;
                const posZ = pos[2] + vz;

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

  const positionsArrayBuffer = new Float32Array(positions).buffer;
  const normalsArrayBuffer = new Float32Array(normals).buffer;
  const indicesArrayBuffer = new Float32Array(indices).buffer;

  postMessage(
    {
      positions: positionsArrayBuffer,
      normals: normalsArrayBuffer,
      indices: indicesArrayBuffer,
    },
    // @ts-ignore
    [positionsArrayBuffer, normalsArrayBuffer, indicesArrayBuffer]
  );
};
