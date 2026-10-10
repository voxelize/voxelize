import { AABB } from "@voxelize/aabb";

/**
 * Where a branch's axis runs through its voxel. Mirrors `BranchSeat` in
 * crates/mesher/src/mesher/branch.rs: `centre` through the middle (a limb in
 * the air), `floor` along the middle of the voxel's floor, half sunk into
 * what lies below (a surface root, of which only the upper half exists).
 */
export type BranchSeat = "centre" | "floor";

/**
 * What a branch block's voxels are, beyond their joints. Mirrors
 * `BranchKind`: `voxel` is one voxel thick with its radius in its stage,
 * `core` is the core cell of a section wider than one voxel (its radius and
 * cut flag in {@link WideBranchBits}), `fin` a floor-seated fin as thick as
 * its stage says and as tall as its raw bits say.
 */
export type BranchKind = "voxel" | "core" | "fin";

/**
 * Draws a block as a branch: a square-section tube of the radius each voxel
 * holds in its stage, joined to face neighbours of the same key at the
 * thinner of the two radii. Mirrors `BranchShape` in the mesher crate.
 */
export type BranchShape = {
  key: number;
  seat?: BranchSeat;
  kind?: BranchKind;
  texelsPerBlock: number;
  /** The contiguous run of stage bits holding the radius less one. */
  radiusMask: number;
  sideFace: string;
  endFace: string;
};

/** A block that branches of `key` up to `maxRadius` run into. */
export type BranchSocket = { key: number; maxRadius: number };

/** What a branch sees across one face, as the mesher's `BranchSide`. */
type BranchSide =
  | { kind: "apart" }
  | { kind: "branch"; radius: number; seat: BranchSeat }
  | { kind: "fin"; radius: number; height: number }
  | { kind: "socket"; maxRadius: number }
  | { kind: "section" };

/** What the branch functions need to know about the blocks around one. */
export type BranchBlockLookup = {
  getRawVoxelAt: (vx: number, vy: number, vz: number) => number;
  getBlockById: (id: number) =>
    | {
        branch?: BranchShape | null;
        branchSockets?: BranchSocket[];
        branchShell?: boolean;
      }
    | null
    | undefined;
};

/**
 * The state wide branch voxels keep in raw bits 16-23. Mirrors
 * `WideBranchBits` in the mesher crate.
 */
export const WideBranchBits = {
  /** A core's radius, or a fin's height, in texels (1-64). */
  size: (raw: number) => ((raw >>> 16) & 0x3f) + 1,
  /** Stage bit 0 of a core: its own slice is cut away. */
  isCut: (raw: number) => ((raw >>> 24) & 1) !== 0,
  /** A shell's offset to its core, `[dx, dz]`, each -8..7. */
  shellOffset: (raw: number): [number, number] => [
    ((raw >>> 16) & 0xf) - 8,
    ((raw >>> 20) & 0xf) - 8,
  ],
};

/**
 * A branch section wider than one voxel: one square tube reaching `radius`
 * texels each way from the axis through its core cell's centre, cut into
 * the cells it covers. Mirrors `WideBranchSection` in the mesher crate.
 */
export const WideBranchSection = {
  /** Cells the section reaches on each side of its core. */
  reach(radius: number, texelsPerBlock: number) {
    const t = Math.max(texelsPerBlock, 1);
    return Math.floor(Math.max(radius + Math.floor(t / 2) - 1, 0) / t);
  },
  /**
   * The tube's span across the cell `d` cells from the core along one axis,
   * in that cell's texels, or null where the tube does not reach it.
   */
  span(
    radius: number,
    texelsPerBlock: number,
    d: number,
  ): [number, number] | null {
    const t = texelsPerBlock;
    const centre = Math.floor(t / 2);
    const start = d * t;
    const low = Math.max(centre - radius, start);
    const high = Math.min(centre + radius, start + t);
    return high > low ? [low - start, high - start] : null;
  },
  /**
   * The box the tube fills in the cell `(da, db)` from the core, as
   * `[a0, b0, a1, b1]` in that cell's texels; none where it misses the cell.
   */
  cellBoxes(
    radius: number,
    texelsPerBlock: number,
    da: number,
    db: number,
  ): [number, number, number, number][] {
    const a = WideBranchSection.span(radius, texelsPerBlock, da);
    const b = WideBranchSection.span(radius, texelsPerBlock, db);
    return a && b ? [[a[0], b[0], a[1], b[1]]] : [];
  },
};

/** +x, -x, +y, -y, +z, -z: the mesher's `VOXEL_NEIGHBORS` order. */
const SIDES: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const maxRadius = (shape: BranchShape) =>
  Math.max(1, Math.floor(shape.texelsPerBlock / 2));

const radiusShift = (shape: BranchShape) => {
  let shift = 0;
  while (shift < 31 && ((shape.radiusMask >>> shift) & 1) === 0) shift += 1;
  return shift;
};

/** The radius, in texels, a voxel of `shape` holds at `stage`. */
export function branchRadius(shape: BranchShape, stage: number): number {
  return Math.min(
    ((stage & shape.radiusMask) >>> radiusShift(shape)) + 1,
    maxRadius(shape),
  );
}

/** `BranchShape::holds_water` in crates/mesher/src/mesher/branch.rs. */
export function branchHoldsWater(shape: BranchShape, stage: number): boolean {
  return (
    (shape.kind ?? "voxel") === "voxel" &&
    branchRadius(shape, stage) < maxRadius(shape)
  );
}

/** `stage` with its radius bits set to `radius`, every other bit kept. */
export function withBranchRadius(
  shape: BranchShape,
  stage: number,
  radius: number,
): number {
  const clamped = Math.min(Math.max(radius, 1), maxRadius(shape));
  return (
    (stage & ~shape.radiusMask) |
    (((clamped - 1) << radiusShift(shape)) & shape.radiusMask)
  );
}

const stageOf = (raw: number) => (raw >>> 24) & 0xf;
const finHeight = (shape: BranchShape, raw: number) =>
  Math.min(WideBranchBits.size(raw), shape.texelsPerBlock);

type BranchCell =
  | { kind: "voxel"; shape: BranchShape; raw: number }
  | {
      kind: "wide";
      shape: BranchShape;
      core: [number, number, number];
      radius: number;
      offset: [number, number];
      cut: boolean;
    };

/** The branch voxel at `vx, vy, vz`, as the mesher's `branch_cell`. */
function branchCellAt(
  vx: number,
  vy: number,
  vz: number,
  lookup: BranchBlockLookup,
): BranchCell | null {
  const raw = lookup.getRawVoxelAt(vx, vy, vz);
  const block = lookup.getBlockById(raw & 0xffff);
  const shape = block?.branch;
  if (shape) {
    if ((shape.kind ?? "voxel") !== "core")
      return { kind: "voxel", shape, raw };
    return {
      kind: "wide",
      shape,
      core: [vx, vy, vz],
      radius: WideBranchBits.size(raw),
      offset: [0, 0],
      cut: WideBranchBits.isCut(raw),
    };
  }
  if (!block?.branchShell) return null;
  const [dx, dz] = WideBranchBits.shellOffset(raw);
  if (dx === 0 && dz === 0) return null;
  const core: [number, number, number] = [vx + dx, vy, vz + dz];
  const coreRaw = lookup.getRawVoxelAt(...core);
  const coreShape = lookup.getBlockById(coreRaw & 0xffff)?.branch;
  if (!coreShape || coreShape.kind !== "core") return null;
  const radius = WideBranchBits.size(coreRaw);
  const reach = WideBranchSection.reach(radius, coreShape.texelsPerBlock);
  if (Math.abs(dx) > reach || Math.abs(dz) > reach) return null;
  return {
    kind: "wide",
    shape: coreShape,
    core,
    radius,
    offset: [-dx, -dz],
    cut: false,
  };
}

function sideOf(
  shape: BranchShape,
  other: BranchShape,
  raw: number,
): BranchSide {
  const radius = branchRadius(other, stageOf(raw));
  return other.kind === "fin"
    ? { kind: "fin", radius, height: finHeight(other, raw) }
    : { kind: "branch", radius, seat: other.seat ?? "centre" };
}

function sidesOf(
  cell: BranchCell,
  vx: number,
  vy: number,
  vz: number,
  lookup: BranchBlockLookup,
): BranchSide[] {
  const { shape } = cell;
  return SIDES.map(([dx, dy, dz]) => {
    const [x, y, z] = [vx + dx, vy + dy, vz + dz];
    const other = branchCellAt(x, y, z, lookup);
    if (other && other.shape.key === shape.key) {
      if (other.kind === "voxel") return sideOf(shape, other.shape, other.raw);
      if (other.cut) return { kind: "apart" };
      if (
        cell.kind === "wide" &&
        cell.core.every((value, i) => value === other.core[i])
      ) {
        return { kind: "section" };
      }
      return { kind: "branch", radius: other.radius, seat: "centre" };
    }
    const socket = lookup
      .getBlockById(lookup.getRawVoxelAt(x, y, z) & 0xffff)
      ?.branchSockets?.find((s) => s.key === shape.key);
    return socket
      ? { kind: "socket", maxRadius: socket.maxRadius }
      : { kind: "apart" };
  });
}

const UP = 2;
const DOWN = 3;

/** `grain_axis` in crates/mesher/src/mesher/branch.rs. */
function grainAxis(joints: number[], candidates: number[]): number {
  let axis = candidates[0];
  let best: [number, number] = [0, 0];
  for (const candidate of candidates) {
    const a = joints[candidate * 2];
    const b = joints[candidate * 2 + 1];
    const score: [number, number] = [
      Math.max(a, b),
      (a > 0 ? 1 : 0) + (b > 0 ? 1 : 0),
    ];
    if (score[0] > best[0] || (score[0] === best[0] && score[1] > best[1])) {
      best = score;
      axis = candidate;
    }
  }
  return axis;
}

function jointRadius(radius: number, side: BranchSide): number {
  switch (side.kind) {
    case "apart":
      return 0;
    case "branch":
    case "fin":
      return Math.min(radius, side.radius);
    case "socket":
      return radius <= side.maxRadius ? radius : 0;
    case "section":
      return radius;
  }
}

function liesAlongFloor(
  ownSeat: BranchSeat,
  sides: BranchSide[],
  side: number,
): boolean {
  const s = sides[side];
  return (
    Math.floor(side / 2) !== 1 &&
    (ownSeat === "floor" ||
      (s.kind === "branch" && s.seat === "floor") ||
      s.kind === "fin")
  );
}

type Box = [number[], number[]];

function arm(
  side: number,
  j: number,
  start: number,
  end: number,
  floor: boolean,
  height: number,
  c: number,
): Box {
  const along = Math.floor(side / 2);
  const min = [c - j, c - j, c - j];
  const max = [c + j, c + j, c + j];
  if (floor) {
    min[1] = 0;
    max[1] = height;
  }
  min[along] = start;
  max[along] = end;
  return [min, max];
}

/** A one-voxel branch or fin, box for box as `BranchLayout::laid`. */
function voxelBoxes(
  shape: BranchShape,
  radius: number,
  finHeightOrNull: number | null,
  sides: BranchSide[],
): Box[] {
  const t = shape.texelsPerBlock;
  const c = Math.floor(t / 2);
  const seat = shape.seat ?? "centre";
  const candidates = seat === "centre" ? [1, 0, 2] : [0, 2];
  const offered = sides.map((side) => jointRadius(radius, side));
  const isSocket = (side: number) => sides[side].kind === "socket";
  const own = offered.map((j, side) => (isSocket(side) ? 0 : j));
  const ownCount = own.filter((j) => j > 0).length;
  const only = Math.max(
    0,
    own.findIndex((j) => j > 0),
  );
  const ground = (side: number) =>
    side === DOWN && (seat === "floor" || own[UP] > 0);
  const joints = offered.map((j, side) =>
    !isSocket(side) ||
    ownCount === 0 ||
    ground(side) ||
    (ownCount === 1 && side === (only ^ 1))
      ? j
      : 0,
  );
  const axis = grainAxis(joints, candidates);
  if (ownCount === 0) {
    for (let side = 0; side < 6; side += 1) {
      if (isSocket(side) && Math.floor(side / 2) !== axis && !ground(side)) {
        joints[side] = 0;
      }
    }
  }
  const floorJoint = (side: number) => liesAlongFloor(seat, sides, side);
  const floorHeight = (side: number) => {
    const s = sides[side];
    if (s.kind === "fin") return s.height;
    if (s.kind === "branch" && s.seat === "floor") return s.radius;
    return t;
  };
  const ownFloor =
    finHeightOrNull !== null ? finHeightOrNull : seat === "floor" ? radius : t;
  const jointHeights = sides.map((s, side) => {
    if (!floorJoint(side)) return 0;
    if (finHeightOrNull !== null || s.kind === "fin") {
      return Math.min(ownFloor, floorHeight(side), t);
    }
    return joints[side];
  });

  const r = radius;
  const coreMin = [c - r, seat === "floor" ? 0 : c - r, c - r];
  const coreMax = [c + r, seat === "floor" ? ownFloor : c + r, c + r];
  const absorbs = (side: number) =>
    joints[side] === radius &&
    floorJoint(side) === (seat === "floor" && axis !== 1);
  if (absorbs(axis * 2)) coreMax[axis] = t;
  if (absorbs(axis * 2 + 1)) coreMin[axis] = 0;

  const boxes: Box[] = [[coreMin, coreMax]];
  for (let side = 0; side < 6; side += 1) {
    const j = joints[side];
    if (j === 0) continue;
    const along = Math.floor(side / 2);
    const [start, end] =
      side % 2 === 0 ? [coreMax[along], t] : [0, coreMin[along]];
    if (start >= end) continue;
    boxes.push(
      arm(side, j, start, end, floorJoint(side), jointHeights[side], c),
    );
  }
  return boxes;
}

/** A wide section's cell, box for box as `BranchLayout::wide`. */
function wideBoxes(
  shape: BranchShape,
  cell: Extract<BranchCell, { kind: "wide" }>,
  sides: BranchSide[],
): Box[] {
  const t = shape.texelsPerBlock;
  const c = Math.floor(t / 2);
  if (cell.cut) return [];
  const boxes = WideBranchSection.cellBoxes(
    cell.radius,
    t,
    cell.offset[0],
    cell.offset[1],
  );
  if (boxes.length === 0) return [];
  const joints = sides.map((side) => jointRadius(cell.radius, side));
  const parts: Box[] = boxes.map(([x0, z0, x1, z1]) => [
    [x0, 0, z0],
    [x1, t, z1],
  ]);
  for (const side of [0, 1, 4, 5]) {
    const j = joints[side];
    const s = sides[side];
    if (j === 0 || s.kind === "section" || s.kind === "socket") continue;
    const along = Math.floor(side / 2);
    const [lo, hi] = along === 0 ? [1, 3] : [0, 2];
    const across = boxes.filter((b) => b[lo] < c + j && b[hi] > c - j);
    let start: number;
    let end: number;
    if (side % 2 === 0) {
      const far = along === 0 ? 2 : 3;
      start = across.length ? Math.max(...across.map((b) => b[far])) : 0;
      end = t;
    } else {
      const near = along === 0 ? 0 : 1;
      start = 0;
      end = across.length ? Math.min(...across.map((b) => b[near])) : t;
    }
    if (start >= end) continue;
    const floor = liesAlongFloor("centre", sides, side);
    const height = s.kind === "fin" ? Math.min(s.height, t) : j;
    parts.push(arm(side, j, start, end, floor, height, c));
  }
  return parts;
}

/**
 * The boxes the branch voxel at `vx, vy, vz` is drawn as, in blocks of the
 * voxel: what bodies collide with and rays pick. A one-voxel branch, a fin,
 * or a cell of a wide section (a core, or a shell drawing its core's tube);
 * none for a cut core or a shell whose core is gone. The same layout as
 * `branch_layout_at` in crates/mesher/src/mesher/branch.rs, box for box
 * (branch-parity.test.ts holds the two to the server's numbers).
 */
export function branchAABBsAt(
  vx: number,
  vy: number,
  vz: number,
  lookup: BranchBlockLookup,
): AABB[] {
  const cell = branchCellAt(vx, vy, vz, lookup);
  if (!cell) return [];
  const sides = sidesOf(cell, vx, vy, vz, lookup);
  const t = cell.shape.texelsPerBlock;
  let boxes: Box[];
  if (cell.kind === "wide") {
    boxes = wideBoxes(cell.shape, cell, sides);
  } else {
    const radius = branchRadius(cell.shape, stageOf(cell.raw));
    boxes = voxelBoxes(
      cell.shape,
      radius,
      cell.shape.kind === "fin" ? finHeight(cell.shape, cell.raw) : null,
      sides,
    );
  }
  return boxes.map(
    ([min, max]) =>
      new AABB(
        min[0] / t,
        min[1] / t,
        min[2] / t,
        max[0] / t,
        max[1] / t,
        max[2] / t,
      ),
  );
}
