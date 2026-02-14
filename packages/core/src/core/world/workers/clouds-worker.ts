import { Noise } from "noisejs";

type CloudsWorkerMessage = {
  data: Uint8Array;
  configs: {
    min: [number, number, number];
    max: [number, number, number];
    noiseScale: number;
    threshold: number;
    stride: [number, number, number];
    octaves: number;
    falloff: number;
    seed: number;
  };
};

const instance = new Noise();

function noise(
  x: number,
  y: number,
  z: number,
  octaves: number,
  falloff: number,
  lacunarity = 0.8
) {
  let total = 0;
  let frequency = 1.0;
  let amplitude = 1.0;
  let maxVal = 0.0;

  for (let i = 0; i < octaves; i++) {
    total +=
      instance.simplex3(x * frequency, y * frequency, z * frequency) *
      amplitude;

    maxVal += amplitude;

    amplitude *= falloff;
    frequency *= lacunarity;
  }

  return total / maxVal;
}

self.onmessage = function (e: MessageEvent<CloudsWorkerMessage>) {
  const {
    data,
    configs: {
      min,
      max,
      noiseScale,
      threshold,
      stride,
      octaves,
      falloff,
      seed,
    },
  } = e.data;

  instance.seed(seed);

  const [startX, startY, startZ] = min;
  const [endX, endY, endZ] = max;
  const [strideX, strideY, strideZ] = stride;

  for (let vx = startX, lx = 0; vx < endX; ++vx, ++lx) {
    const scaledX = vx * noiseScale;
    for (let vz = startZ, lz = 0; vz < endZ; ++vz, ++lz) {
      const scaledZ = vz * noiseScale;
      for (let vy = startY, ly = 0; vy < endY; ++vy, ++ly) {
        const scaledY = vy * noiseScale;
        const value =
          noise(scaledX, scaledY, scaledZ, octaves, falloff) > threshold
            ? 1
            : 0;
        data[lx * strideX + ly * strideY + lz * strideZ] = value;
      }
    }
  }

  const transfer: Transferable[] = [];
  const buffer = data.buffer;
  if (buffer instanceof ArrayBuffer) {
    transfer.push(buffer);
  }
  self.postMessage(data, { transfer });
};
