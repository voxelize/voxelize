// @ts-ignore
import { Noise } from "noisejs";

function set(arr, x, y, z, stride, value) {
  arr[x * stride[0] + y * stride[1] + z * stride[2]] = value;
}

// @ts-ignore
const instance = new Noise();

function noise(
  x: number,
  y: number,
  z: number,
  octaves: number,
  falloff: number,
  lacunarity = 0.8,
): number {
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

// @ts-ignore
onmessage = function (e) {
  const {
    data,
    configs: {
      min,
      max,
      noiseScale,
      verticalNoiseScale,
      threshold,
      stride,
      octaves,
      falloff,
      seed,
    },
  } = e.data;

  // Sampled separately from the horizontal scale. At one shared scale a stack
  // of cloud layers only a few blocks tall spans almost no noise, so every
  // column fills to the same layer and the deck comes out with a dead flat top
  // no matter how much structure the horizontal field has.
  const yScale = verticalNoiseScale ?? noiseScale;

  instance.seed(seed);

  const [startX, startY, startZ] = min;
  const [endX, endY, endZ] = max;

  for (let vx = startX, lx = 0; vx < endX; ++vx, ++lx) {
    for (let vz = startZ, lz = 0; vz < endZ; ++vz, ++lz) {
      for (let vy = startY, ly = 0; vy < endY; ++vy, ++ly) {
        const value =
          noise(
            vx * noiseScale,
            vy * yScale,
            vz * noiseScale,
            octaves,
            falloff,
          ) > threshold
            ? 1
            : 0;
        set(data, lx, ly, lz, stride, value);
      }
    }
  }

  // @ts-ignore
  postMessage(data, [data.buffer]);
};
