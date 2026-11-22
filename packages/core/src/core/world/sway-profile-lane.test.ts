import { positionGeometry } from "three/tsl";
import { describe, expect, it } from "vitest";

import {
  POSITION_WITH_PROFILE_HASH,
  positionWithProfile,
} from "./shading/chunk-vertex";

type Hashed = { getHash(builder: unknown): string };

// three shares attribute nodes by name: a second read of "position" beside
// the built-in three-wide one came back as that node widened, its fourth
// lane 1 on every vertex. Every plant of a shared cutout then swayed by the
// first profile registered, the ones told to hold still included.
describe("the sway profile lane", () => {
  it("is read through a node of its own, not the built-in position's", () => {
    const lane = positionWithProfile() as unknown as Hashed;
    const builtIn = positionGeometry as unknown as Hashed;
    expect(lane.getHash(null)).toBe(POSITION_WITH_PROFILE_HASH);
    expect(lane.getHash(null)).not.toBe(builtIn.getHash(null));
  });
});
