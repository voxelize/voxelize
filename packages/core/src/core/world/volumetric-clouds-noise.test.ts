import { describe, expect, it } from "vitest";

import { generateCloudNoiseVolume } from "./volumetric-clouds-noise";

describe("cloud noise volume", () => {
  const size: [number, number, number] = [32, 8, 32];
  const data = generateCloudNoiseVolume({ size, seed: 7 });
  const at = (x: number, y: number, z: number, c: number) =>
    data[(x + y * size[0] + z * size[0] * size[1]) * 4 + c];

  it("is deterministic per seed", () => {
    expect(generateCloudNoiseVolume({ size, seed: 7 })).toEqual(data);
    expect(generateCloudNoiseVolume({ size, seed: 8 })).not.toEqual(data);
  });

  it("wraps seamlessly: opposite edges differ like neighbours do", () => {
    let seam = 0;
    let inner = 0;
    for (let z = 0; z < size[2]; z++) {
      for (let y = 0; y < size[1]; y++) {
        seam += Math.abs(at(size[0] - 1, y, z, 0) - at(0, y, z, 0));
        inner += Math.abs(at(1, y, z, 0) - at(0, y, z, 0));
      }
    }
    expect(seam).toBeLessThan(inner * 2);
  });

  it("leaves open sky between the clouds", () => {
    let empty = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 64) empty++;
    expect(empty / (data.length / 4)).toBeGreaterThan(0.2);
  });
});
