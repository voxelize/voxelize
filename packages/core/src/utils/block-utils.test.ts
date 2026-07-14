import { describe, expect, it } from "vitest";

import { Block, BlockRotation } from "../core/world/block";

import { BlockUtils } from "./block-utils";

const makeBlock = (
  isTransparent: [boolean, boolean, boolean, boolean, boolean, boolean],
): Block =>
  ({
    id: 1,
    name: "Probe",
    isTransparent,
  }) as Block;

describe("BlockUtils.getBlockRotatedTransparency", () => {
  it("passes transparency through for an unrotated block", () => {
    const block = makeBlock([true, false, true, false, true, false]);
    const result = BlockUtils.getBlockRotatedTransparency(
      block,
      new BlockRotation(),
    );
    expect(result).toEqual([true, false, true, false, true, false]);
  });

  it("returns a six-face array without throwing for every rotation", () => {
    const block = makeBlock([true, false, false, false, false, false]);
    for (let rotationValue = 0; rotationValue < 6; rotationValue++) {
      const result = BlockUtils.getBlockRotatedTransparency(
        block,
        BlockRotation.encode(rotationValue),
      );
      expect(result).toHaveLength(6);
      result.forEach((face) => expect(typeof face).toBe("boolean"));
    }
  });

  it("treats a null block as fully opaque instead of throwing", () => {
    expect(() =>
      BlockUtils.getBlockRotatedTransparency(null, new BlockRotation()),
    ).not.toThrow();
    expect(
      BlockUtils.getBlockRotatedTransparency(null, new BlockRotation()),
    ).toEqual([false, false, false, false, false, false]);
  });

  it("treats an undefined block as fully opaque instead of throwing", () => {
    expect(
      BlockUtils.getBlockRotatedTransparency(undefined, new BlockRotation()),
    ).toEqual([false, false, false, false, false, false]);
  });
});
