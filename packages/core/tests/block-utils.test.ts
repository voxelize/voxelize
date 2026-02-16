import { describe, expect, it } from "vitest";

import { BlockUtils } from "../src/utils/block-utils";

describe("BlockUtils.insertStage", () => {
  it("stores only the packed stage nibble", () => {
    const staged = BlockUtils.insertStage(0, 0x2f);
    expect(BlockUtils.extractStage(staged)).toBe(0xf);
  });

  it("wraps negative stage values into packed nibble semantics", () => {
    const staged = BlockUtils.insertStage(0, -1);
    expect(BlockUtils.extractStage(staged)).toBe(0xf);
  });

  it("preserves non-stage voxel bits", () => {
    let raw = 0;
    raw = BlockUtils.insertID(raw, 0x1234);
    raw = BlockUtils.insertRotationValues(raw, 0xa, 0xb);
    raw = BlockUtils.insertStage(raw, 0x1f);

    expect(BlockUtils.extractID(raw)).toBe(0x1234);
    expect((raw >> 16) & 0xf).toBe(0xa);
    expect((raw >> 20) & 0xf).toBe(0xb);
    expect(BlockUtils.extractStage(raw)).toBe(0xf);
  });

  it("detects block entity type prefix", () => {
    expect(BlockUtils.isBlockEntityType("block::stone::1::2::3")).toBe(true);
    expect(BlockUtils.isBlockEntityType("block::")).toBe(true);
    expect(BlockUtils.isBlockEntityType("entity::block::stone")).toBe(false);
    expect(BlockUtils.isBlockEntityType("block:stone")).toBe(false);
    expect(BlockUtils.isBlockEntityType("")).toBe(false);
  });
});
