import { describe, expect, it } from "vitest";

import { LightUtils } from "./light-utils";

const MAX_LIGHT_LEVEL = 15;

describe("beerLambertTransmit", () => {
  it("keeps light unchanged through non-attenuating media", () => {
    expect(LightUtils.beerLambertTransmit(MAX_LIGHT_LEVEL, 0)).toBe(
      MAX_LIGHT_LEVEL,
    );
  });

  it("applies 222/256 per optical-density unit", () => {
    expect(LightUtils.beerLambertTransmit(15, 1)).toBe(13);
    expect(LightUtils.beerLambertTransmit(13, 1)).toBe(11);
  });

  it("always makes progress so light dies out", () => {
    expect(LightUtils.beerLambertTransmit(1, 1)).toBe(0);
  });

  it("extinguishes a max-level sunlight column within twelve water blocks", () => {
    let level = MAX_LIGHT_LEVEL;
    let blocks = 0;
    while (level > 0) {
      level = LightUtils.beerLambertTransmit(level, 1);
      blocks += 1;
    }
    expect(blocks).toBeLessThanOrEqual(12);
  });
});

describe("retainLiveFillNodes", () => {
  it("drops fill nodes whose voxel was zeroed after collection", () => {
    const nodes: { voxel: [number, number, number]; level: number }[] = [
      { voxel: [0, 0, 0], level: 13 },
      { voxel: [1, 0, 0], level: 11 },
    ];

    const levels = new Map<string, number>([
      ["0,0,0", 13],
      ["1,0,0", 0],
    ]);

    const live = LightUtils.retainLiveFillNodes(
      nodes,
      (vx, vy, vz) => levels.get(`${vx},${vy},${vz}`) ?? 0,
    );

    expect(live).toHaveLength(1);
    expect(live[0].voxel).toEqual([0, 0, 0]);
  });
});

describe("floodLightNextLevel", () => {
  it("keeps max sunlight when travelling down open air", () => {
    expect(
      LightUtils.floodLightNextLevel(
        true,
        0,
        -1,
        MAX_LIGHT_LEVEL,
        MAX_LIGHT_LEVEL,
      ),
    ).toBe(MAX_LIGHT_LEVEL);
  });

  it("attenuates max sunlight entering water downward", () => {
    expect(
      LightUtils.floodLightNextLevel(
        true,
        1,
        -1,
        MAX_LIGHT_LEVEL,
        MAX_LIGHT_LEVEL,
      ),
    ).toBe(13);
  });

  it("decays by one through air once below max", () => {
    expect(
      LightUtils.floodLightNextLevel(true, 0, -1, 13, MAX_LIGHT_LEVEL),
    ).toBe(12);
  });

  it("attenuates sideways entry into water", () => {
    expect(
      LightUtils.floodLightNextLevel(
        true,
        1,
        0,
        MAX_LIGHT_LEVEL,
        MAX_LIGHT_LEVEL,
      ),
    ).toBe(13);
  });
});
