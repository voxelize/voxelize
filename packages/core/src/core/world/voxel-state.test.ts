import { describe, expect, it } from "vitest";

import { stateBitsOf, withStateBits } from "./voxel-state";

describe("state bits", () => {
  const stateful = { rotationBitsAreState: true };

  it("carry every value of the byte through a word and back", () => {
    // Words with the id, the stage and the waterlog bits set around the
    // byte, so a mask that leaked would show.
    for (const around of [0, 0x0f00_1234, 0xff00_ffff]) {
      for (let byte = 0; byte <= 0xff; byte += 1) {
        const word = withStateBits(around, byte);
        expect(stateBitsOf(stateful, word)).toBe(byte);
        expect(word & ~0x00ff0000).toBe((around & ~0x00ff0000) | 0);
        expect(word).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("leave a rotating block's byte to the rotation decode", () => {
    expect(stateBitsOf({ rotationBitsAreState: false }, 0x00ab0001)).toBe(
      undefined,
    );
    expect(stateBitsOf(undefined, 0x00ab0001)).toBe(undefined);
  });
});
