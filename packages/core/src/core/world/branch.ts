import { AABB } from "@voxelize/aabb";

/**
 * Where a branch's axis runs through its voxel. Mirrors `BranchSeat` in
 * crates/mesher/src/mesher/branch.rs: `centre` through the middle (a limb in
 * the air), `floor` along the middle of the voxel's floor, half sunk into
 * what lies below (a surface root, of which only the upper half exists).
 */
export type BranchSeat = "centre" | "floor";

/**
 * Draws a block as a branch: a square-section tube of the radius each voxel
 * holds in its stage, joined to face neighbours of the same key at the
 * thinner of the two radii. Mirrors `BranchShape` in the mesher crate.
 */
export type BranchShape = {
  key: number;
  seat?: BranchSeat;
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
  | { kind: "socket"; maxRadius: number };

/** What the branch functions need to know about the blocks around one. */
export type BranchBlockLookup = {
  getVoxelAt: (vx: number, vy: number, vz: number) => number;
  getVoxelStageAt: (vx: number, vy: number, vz: number) => number;
  getBlockById: (
    id: number,
  ) =>
    | { branch?: BranchShape | null; branchSockets?: BranchSocket[] }
    | null
    | undefined;
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

function sideOf(
  shape: BranchShape,
  neighbor: ReturnType<BranchBlockLookup["getBlockById"]>,
  stage: number,
): BranchSide {
  const other = neighbor?.branch;
  if (other && other.key === shape.key) {
    return {
      kind: "branch",
      radius: branchRadius(other, stage),
      seat: other.seat ?? "centre",
    };
  }
  const socket = neighbor?.branchSockets?.find((s) => s.key === shape.key);
  return socket
    ? { kind: "socket", maxRadius: socket.maxRadius }
    : { kind: "apart" };
}

function jointRadius(radius: number, side: BranchSide): number {
  switch (side.kind) {
    case "apart":
      return 0;
    case "branch":
      return Math.min(radius, side.radius);
    case "socket":
      return radius <= side.maxRadius ? radius : 0;
  }
}

/**
 * The boxes the branch voxel at `vx, vy, vz` is drawn as, in blocks of the
 * voxel: what bodies collide with and rays pick. The same layout as
 * `BranchLayout::new` in crates/mesher/src/mesher/branch.rs, box for box
 * (branch-parity.test.ts holds the two to the server's numbers).
 */
export function branchAABBs(
  shape: BranchShape,
  vx: number,
  vy: number,
  vz: number,
  lookup: BranchBlockLookup,
): AABB[] {
  const t = shape.texelsPerBlock;
  const c = Math.floor(t / 2);
  const seat = shape.seat ?? "centre";
  const radius = branchRadius(shape, lookup.getVoxelStageAt(vx, vy, vz));
  const sides = SIDES.map(([dx, dy, dz]) => {
    const [x, y, z] = [vx + dx, vy + dy, vz + dz];
    return sideOf(
      shape,
      lookup.getBlockById(lookup.getVoxelAt(x, y, z)),
      lookup.getVoxelStageAt(x, y, z),
    );
  });
  const joints = sides.map((side) => jointRadius(radius, side));
  const floorJoint = (side: number) => {
    const s = sides[side];
    return (
      Math.floor(side / 2) !== 1 &&
      (seat === "floor" || (s.kind === "branch" && s.seat === "floor"))
    );
  };

  const candidates = seat === "centre" ? [1, 0, 2] : [0, 2];
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

  const r = radius;
  const coreMin = [c - r, seat === "floor" ? 0 : c - r, c - r];
  const coreMax = [c + r, seat === "floor" ? r : c + r, c + r];
  const absorbs = (side: number) =>
    joints[side] === radius &&
    floorJoint(side) === (seat === "floor" && axis !== 1);
  if (absorbs(axis * 2)) coreMax[axis] = t;
  if (absorbs(axis * 2 + 1)) coreMin[axis] = 0;

  const boxes: [number[], number[]][] = [[coreMin, coreMax]];
  for (let side = 0; side < 6; side += 1) {
    const j = joints[side];
    if (j === 0) continue;
    const along = Math.floor(side / 2);
    const [start, end] =
      side % 2 === 0 ? [coreMax[along], t] : [0, coreMin[along]];
    if (start >= end) continue;
    const min = [c - j, c - j, c - j];
    const max = [c + j, c + j, c + j];
    if (floorJoint(side)) {
      min[1] = 0;
      max[1] = j;
    }
    min[along] = start;
    max[along] = end;
    boxes.push([min, max]);
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
