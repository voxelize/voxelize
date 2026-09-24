import type { UpdateProtocol } from "@voxelize/protocol";
import { describe, expect, it } from "vitest";

import { HeldServerUpdates } from "./held-server-updates";

const update = (vx: number, vy: number, vz: number, voxel: number) =>
  ({ vx, vy, vz, voxel, light: 0 }) as UpdateProtocol;

describe("HeldServerUpdates", () => {
  it("hands back a chunk's updates once, in arrival order", () => {
    const held = new HeldServerUpdates();
    held.hold("0|0", update(1, 2, 3, 5));
    held.hold("0|0", update(4, 5, 6, 7));
    held.hold("1|0", update(20, 5, 6, 9));

    expect(held.take("0|0").map((u) => u.voxel)).toEqual([5, 7]);
    expect(held.take("0|0")).toEqual([]);
    expect(held.chunkCount).toBe(1);
  });

  it("keeps only a voxel's latest update, replayed after the ones before it", () => {
    const held = new HeldServerUpdates();
    held.hold("0|0", update(1, 2, 3, 5));
    held.hold("0|0", update(4, 5, 6, 7));
    held.hold("0|0", update(1, 2, 3, 8));

    expect(held.take("0|0").map((u) => u.voxel)).toEqual([7, 8]);
  });

  it("drops chunks that left the pipeline before their data landed", () => {
    const held = new HeldServerUpdates();
    held.hold("0|0", update(1, 2, 3, 5));
    held.hold("9|9", update(150, 2, 150, 5));

    held.prune((name) => name === "0|0");

    expect(held.chunkCount).toBe(1);
    expect(held.take("9|9")).toEqual([]);
    expect(held.take("0|0")).toHaveLength(1);
  });
});
