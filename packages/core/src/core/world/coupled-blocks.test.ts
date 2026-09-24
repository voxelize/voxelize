import { describe, expect, it, vi } from "vitest";

import { Coords3 } from "../../types";

import { Block, BlockRotation, BlockUpdate, PY_ROTATION } from "./block";
import {
  CoupledWorldView,
  expandCoupledUpdates,
  isCoupledPart,
  resolveCoupledAnchor,
  rotateCoupledOffset,
} from "./coupled-blocks";

const WATER_ID = 10;
const STONE_ID = 20;
const DOOR_ID = 700;
const DOOR_TOP_ID = 701;
const BUSH_ID = 1004;
const BUSH_TOP_ID = 1005;
const BED_ID = 800;
const BED_FOOT_ID = 801;
const MAX_HEIGHT = 64;

function block(
  overrides: Partial<Block> & { id: number; name: string },
): Block {
  return {
    coupledParts: [],
    isCoupledAnchor: false,
    isWaterloggable: false,
    isWaterloggingFluid: false,
    ...overrides,
  } as Block;
}

const blocks = new Map<number, Block>(
  [
    block({ id: 0, name: "Air" }),
    block({ id: WATER_ID, name: "Water", isWaterloggingFluid: true }),
    block({ id: STONE_ID, name: "Stone" }),
    block({
      id: DOOR_ID,
      name: "Door",
      isWaterloggable: true,
      isCoupledAnchor: true,
      coupledParts: [{ offset: [0, 1, 0], id: DOOR_TOP_ID }],
    }),
    block({
      id: DOOR_TOP_ID,
      name: "Door Top",
      isWaterloggable: true,
      coupledParts: [{ offset: [0, -1, 0], id: DOOR_ID }],
    }),
    block({
      id: BUSH_ID,
      name: "Bush",
      isCoupledAnchor: true,
      coupledParts: [{ offset: [0, 1, 0], id: BUSH_TOP_ID }],
    }),
    block({
      id: BUSH_TOP_ID,
      name: "Bush Top",
      coupledParts: [{ offset: [0, -1, 0], id: BUSH_ID }],
    }),
    block({
      id: BED_ID,
      name: "Bed",
      isCoupledAnchor: true,
      coupledParts: [{ offset: [0, 0, 1], id: BED_FOOT_ID }],
    }),
    block({
      id: BED_FOOT_ID,
      name: "Bed Foot",
      coupledParts: [{ offset: [0, 0, -1], id: BED_ID }],
    }),
  ].map((b) => [b.id, b] as const),
);

type Voxel = {
  id: number;
  rotation?: number;
  yRotation?: number;
  stage?: number;
};

/** A sparse world: anything not written is air. */
function view(voxels: Record<string, Voxel>): CoupledWorldView {
  const at = (vx: number, vy: number, vz: number) =>
    voxels[`${vx},${vy},${vz}`] ?? { id: 0 };
  return {
    maxHeight: MAX_HEIGHT,
    getBlockById: (id) => blocks.get(id),
    getVoxelAt: (vx, vy, vz) => at(vx, vy, vz).id,
    getVoxelRotationAt: (vx, vy, vz) => {
      const voxel = at(vx, vy, vz);
      return BlockRotation.encode(
        voxel.rotation ?? PY_ROTATION,
        voxel.yRotation ?? 0,
      );
    },
    getVoxelStageAt: (vx, vy, vz) => at(vx, vy, vz).stage ?? 0,
  };
}

const BASE: Coords3 = [4, 10, 4];
const ABOVE: Coords3 = [4, 11, 4];
const key = ([x, y, z]: Coords3) => `${x},${y},${z}`;

function at(
  [vx, vy, vz]: Coords3,
  type: number,
  rest: Partial<BlockUpdate> = {},
): BlockUpdate {
  return { vx, vy, vz, type, ...rest };
}

describe("expandCoupledUpdates", () => {
  it("places and breaks horizontal units in all facings at negative chunk borders", () => {
    const base: Coords3 = [-16, 10, -16];
    for (const yRotation of [0, 4, 8, 12]) {
      const offset = rotateCoupledOffset(
        [0, 0, 1],
        BlockRotation.encode(0, yRotation),
      )!;
      const foot = base.map((v, i) => v + offset[i]) as Coords3;
      const head = at(base, BED_ID, { rotation: 0, yRotation, stage: 0 });
      const part = at(foot, BED_FOOT_ID, { rotation: 0, yRotation, stage: 0 });
      expect(expandCoupledUpdates(view({}), [head])).toEqual([head, part]);
      const world = view({
        [key(base)]: { id: BED_ID, yRotation },
        [key(foot)]: { id: BED_FOOT_ID, yRotation },
      });
      expect(expandCoupledUpdates(world, [at(foot, 0)])).toEqual([
        at(foot, 0),
        at(base, 0),
      ]);
    }
  });

  it("moves the old part on rotation, refuses blockers and never adopts another unit", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const foot: Coords3 = [4, 10, 5];
    const next: Coords3 = [5, 10, 4];
    const voxels = {
      [key(BASE)]: { id: BED_ID },
      [key(foot)]: { id: BED_FOOT_ID },
    };
    const rotated = at(BASE, BED_ID, { yRotation: 4 });
    expect(expandCoupledUpdates(view(voxels), [rotated])).toEqual([
      rotated,
      at(next, BED_FOOT_ID, { rotation: 0, yRotation: 4, stage: 0 }),
      at(foot, 0),
    ]);
    expect(
      expandCoupledUpdates(view({ ...voxels, [key(next)]: { id: STONE_ID } }), [
        rotated,
      ]),
    ).toEqual([]);
    expect(
      expandCoupledUpdates(view({}), [at(BASE, BED_ID, { yRotation: 2 })]),
    ).toEqual([]);
    const foreign = view({ [key(foot)]: { id: BED_FOOT_ID, yRotation: 4 } });
    expect(expandCoupledUpdates(foreign, [at(BASE, BED_ID)])).toEqual([]);
    const orphan = view({
      ...voxels,
      [key(foot)]: { id: BED_FOOT_ID, yRotation: 4 },
    });
    expect(expandCoupledUpdates(orphan, [at(BASE, 0)])).toEqual([at(BASE, 0)]);
    warn.mockRestore();
  });
  it("breaking the anchor clears the partner in the same batch", () => {
    const world = view({
      [key(BASE)]: { id: BUSH_ID },
      [key(ABOVE)]: { id: BUSH_TOP_ID },
    });
    expect(expandCoupledUpdates(world, [at(BASE, 0)])).toEqual([
      at(BASE, 0),
      at(ABOVE, 0),
    ]);
  });

  it("breaking the part clears the anchor in the same batch", () => {
    const world = view({
      [key(BASE)]: { id: BUSH_ID },
      [key(ABOVE)]: { id: BUSH_TOP_ID },
    });
    expect(expandCoupledUpdates(world, [at(ABOVE, 0)])).toEqual([
      at(ABOVE, 0),
      at(BASE, 0),
    ]);
  });

  it("replacing a part with another block still clears the rest", () => {
    const world = view({
      [key(BASE)]: { id: DOOR_ID },
      [key(ABOVE)]: { id: DOOR_TOP_ID },
    });
    expect(expandCoupledUpdates(world, [at(BASE, STONE_ID)])).toEqual([
      at(BASE, STONE_ID),
      at(ABOVE, 0),
    ]);
  });

  it("never touches a voxel that is not the partner", () => {
    const world = view({
      [key(BASE)]: { id: STONE_ID },
      [key(ABOVE)]: { id: DOOR_TOP_ID },
      "4,12,4": { id: STONE_ID },
    });
    expect(expandCoupledUpdates(world, [at(ABOVE, 0)])).toEqual([at(ABOVE, 0)]);
  });

  it("placing the anchor materialises its parts with its shape state", () => {
    const world = view({});
    const leaf = at(BASE, DOOR_ID, {
      rotation: PY_ROTATION,
      yRotation: 4,
      stage: 1,
    });
    expect(expandCoupledUpdates(world, [leaf])).toEqual([
      leaf,
      at(ABOVE, DOOR_TOP_ID, { rotation: PY_ROTATION, yRotation: 4, stage: 1 }),
    ]);
  });

  it("drops an anchor whose part voxel is occupied, whole", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const world = view({ [key(ABOVE)]: { id: STONE_ID } });
    expect(expandCoupledUpdates(world, [at(BASE, DOOR_ID)])).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("partner voxel occupied");
    warn.mockRestore();
  });

  it("lets an anchor take water only when its part can hold it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const world = view({ [key(ABOVE)]: { id: WATER_ID } });
    expect(expandCoupledUpdates(world, [at(BASE, DOOR_ID)])).toHaveLength(2);
    expect(expandCoupledUpdates(world, [at(BASE, BUSH_ID)])).toEqual([]);
    warn.mockRestore();
  });

  it("drops a part written without its anchor", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const world = view({});
    expect(expandCoupledUpdates(world, [at(ABOVE, DOOR_TOP_ID)])).toEqual([]);
    expect(warn.mock.calls[0][0]).toContain("written without its anchor");
    warn.mockRestore();
  });

  it("commits a batch carrying the whole unit exactly as sent, in any order", () => {
    const world = view({});
    const top = at(ABOVE, DOOR_TOP_ID, { yRotation: 4 });
    const bottom = at(BASE, DOOR_ID, { yRotation: 4 });
    expect(expandCoupledUpdates(world, [top, bottom])).toEqual([top, bottom]);
  });

  it("adds nothing to a batch that already breaks both halves", () => {
    const world = view({
      [key(BASE)]: { id: DOOR_ID },
      [key(ABOVE)]: { id: DOOR_TOP_ID },
    });
    expect(expandCoupledUpdates(world, [at(BASE, 0), at(ABOVE, 0)])).toEqual([
      at(BASE, 0),
      at(ABOVE, 0),
    ]);
  });

  it("carries a toggle from either leaf to the other", () => {
    const world = view({
      [key(BASE)]: { id: DOOR_ID, yRotation: 4, stage: 0 },
      [key(ABOVE)]: { id: DOOR_TOP_ID, yRotation: 4, stage: 0 },
    });
    const openBottom = at(BASE, DOOR_ID, {
      rotation: PY_ROTATION,
      yRotation: 4,
      stage: 1,
    });
    const openTop = at(ABOVE, DOOR_TOP_ID, {
      rotation: PY_ROTATION,
      yRotation: 4,
      stage: 1,
    });

    expect(expandCoupledUpdates(world, [openBottom])).toEqual([
      openBottom,
      openTop,
    ]);
    expect(expandCoupledUpdates(world, [openTop])).toEqual([
      openTop,
      openBottom,
    ]);
  });

  it("writes no partner when a rewrite changes no shape state", () => {
    const world = view({
      [key(BASE)]: { id: DOOR_ID, yRotation: 4, stage: 1 },
      [key(ABOVE)]: { id: DOOR_TOP_ID, yRotation: 4, stage: 1 },
    });
    const same = at(BASE, DOOR_ID, {
      rotation: PY_ROTATION,
      yRotation: 4,
      stage: 1,
    });
    expect(expandCoupledUpdates(world, [same])).toEqual([same]);
  });

  it("lets a fresh part beside an existing anchor take the anchor's state", () => {
    const world = view({ [key(BASE)]: { id: DOOR_ID, stage: 1 } });
    const closedTop = at(ABOVE, DOOR_TOP_ID, { stage: 0 });
    expect(expandCoupledUpdates(world, [closedTop])).toEqual([closedTop]);
  });

  it("drops an anchor whose partner would sit above the world ceiling", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const world = view({});
    expect(
      expandCoupledUpdates(world, [at([4, MAX_HEIGHT - 1, 4], DOOR_ID)]),
    ).toEqual([]);
    warn.mockRestore();
  });

  it("passes uncoupled blocks through untouched", () => {
    const world = view({ [key(BASE)]: { id: STONE_ID } });
    const batch = [at(BASE, 0), at(ABOVE, STONE_ID)];
    expect(expandCoupledUpdates(world, batch)).toEqual(batch);
  });

  it("is idempotent", () => {
    const world = view({
      [key(BASE)]: { id: DOOR_ID },
      [key(ABOVE)]: { id: DOOR_TOP_ID },
    });
    const once = expandCoupledUpdates(world, [at(BASE, 0)]);
    expect(expandCoupledUpdates(world, once)).toEqual(once);
  });
});

describe("unit membership", () => {
  it("resolves the anchor from any part", () => {
    const registry = { getBlockById: (id: number) => blocks.get(id) };
    const known = (id: number): Block => {
      const found = blocks.get(id);
      if (!found) throw new Error(`test registry has no block ${id}`);
      return found;
    };
    expect(resolveCoupledAnchor(registry, known(DOOR_TOP_ID)).id).toBe(DOOR_ID);
    expect(resolveCoupledAnchor(registry, known(DOOR_ID)).id).toBe(DOOR_ID);
    expect(resolveCoupledAnchor(registry, known(STONE_ID)).id).toBe(STONE_ID);
  });

  it("knows which blocks are non-anchor parts", () => {
    expect(isCoupledPart(blocks.get(DOOR_TOP_ID))).toBe(true);
    expect(isCoupledPart(blocks.get(DOOR_ID))).toBe(false);
    expect(isCoupledPart(blocks.get(STONE_ID))).toBe(false);
    expect(isCoupledPart(undefined)).toBe(false);
  });
});
