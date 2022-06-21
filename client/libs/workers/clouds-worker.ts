importScripts("https://cdn.jsdelivr.net/npm/noisejs@2.1.0/index.min.js");

function set(arr, x, y, z, stride, value) {
  arr[x * stride[0] + y * stride[1] + z * stride[2]] = value;
}

// @ts-ignore
const noise = new Noise();

onmessage = function (e) {
  const {
    data: dataBuffer,
    configs: { min, max, seed, scale, threshold, stride },
  } = e.data;

  noise.seed(seed);

  const data = new Uint8Array(dataBuffer);

  const [startX, startY, startZ] = min;
  const [endX, endY, endZ] = max;

  const factor1 = 0.4;
  const factor2 = 0.7;

  for (let vx = startX, lx = 0; vx < endX; ++vx, ++lx) {
    for (let vz = startZ, lz = 0; vz < endZ; ++vz, ++lz) {
      for (let vy = startY, ly = 0; vy < endY; ++vy, ++ly) {
        const value =
          Math.abs(
            noise.simplex3(
              vx * scale * factor1,
              vy * scale * factor1,
              vz * scale * factor1
            ) +
              noise.simplex3(
                vx * scale * factor2,
                vy * scale * factor2,
                vz * scale * factor2
              ) +
              noise.simplex3(vx * scale, vy * scale, vz * scale)
          ) > threshold
            ? 1
            : 0;
        set(data, lx, ly, lz, stride, value);
      }
    }
  }

  // @ts-ignore
  postMessage(data.buffer, [data.buffer]);
};
