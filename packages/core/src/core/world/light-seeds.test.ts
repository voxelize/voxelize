import { describe, expect, it } from "vitest";

import { packLightSeeds, unpackLightSeeds } from "./light-seeds";

describe("light seeds on their way to a worker", () => {
  it("come back as they went in", () => {
    const seeds = {
      removals: [
        [1, 2, 3],
        [-40, 0, 511],
      ] as [number, number, number][],
      floods: [
        { voxel: [7, 8, 9] as [number, number, number], level: 15 },
        // A seed whose level the worker reads from its neighbours.
        { voxel: [-1, 300, -2000000] as [number, number, number], level: -1 },
      ],
      pendingRemovals: [
        { voxel: [4, 5, 6] as [number, number, number], level: 11 },
      ],
    };
    expect(unpackLightSeeds(packLightSeeds(seeds))).toEqual(seeds);
  });

  it("leave out pending removals a job does not have", () => {
    const unpacked = unpackLightSeeds(
      packLightSeeds({ removals: [[0, 1, 2]], floods: [] }),
    );
    expect(unpacked).toEqual({ removals: [[0, 1, 2]], floods: [] });
    expect("pendingRemovals" in unpacked).toBe(false);
  });

  it("carry nothing as nothing", () => {
    const packed = packLightSeeds({ removals: [], floods: [] });
    expect(Array.from(packed)).toEqual([0, 0, 0]);
    expect(unpackLightSeeds(packed)).toEqual({ removals: [], floods: [] });
  });
});
