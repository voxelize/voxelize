import type { Group } from "three";

import type { Coords3 } from "../../types";

/** A box of voxels to mesh on its own, away from the chunks. */
export type VoxelBoxInput = {
  /** The box's lowest corner in the world, where it stands: lights and
   * regional tints are read from the world there. */
  origin: Coords3;
  /** Voxels along x, y and z. */
  size: Coords3;
  /** Raw voxel words, x outermost, then y, then z (a chunk's layout); 0 is
   * air. */
  voxels: Uint32Array;
  /** Rows meshed per worker job, at most a section's height. */
  bandHeight?: number;
  /** Mesh ahead of the chunk queue. */
  isUrgent?: boolean;
};

export type VoxelBoxMesh = {
  /** The box on the chunk materials, its lowest corner at the group's
   * origin. Not added to anything: the caller places and moves it. */
  group: Group;
  triangles: number;
  /** Jobs the box was meshed in, one per band of rows. */
  bands: number;
  /** From the call to every band back from the workers, and the main
   * thread's share of that: filling the bands and building the meshes. */
  totalMs: number;
  mainThreadMs: number;
  dispose: () => void;
};

/** One band of a box laid out as a single chunk the mesher reads: a cell of
 * air round the box on every side, and one row of the box above and below
 * the band so its faces cull against the rows they meet. */
export type VoxelBoxBand = {
  /** The band's first row of the box. */
  firstRow: number;
  /** Rows of the box the band meshes. */
  rows: number;
  /** The chunk's width and depth (the wider of the box's two, plus the air). */
  side: number;
  /** The chunk's height: the band's rows plus one above and one below. */
  height: number;
  voxels: Uint32Array;
  lights: Uint32Array;
};

export type VoxelBoxBandOptions = {
  size: Coords3;
  voxels: Uint32Array;
  firstRow: number;
  rows: number;
  /** The raw light word at a cell of the box (which may lie past its
   * edges), in the box's own coordinates. */
  lightAt: (x: number, y: number, z: number) => number;
};

/** Lays out one band of a box for the mesher. */
export function voxelBoxBand({
  size,
  voxels,
  firstRow,
  rows,
  lightAt,
}: VoxelBoxBandOptions): VoxelBoxBand {
  const [sx, sy, sz] = size;
  const side = Math.max(sx, sz) + 2;
  const height = rows + 2;
  const cells = side * height * side;
  const bandVoxels = new Uint32Array(cells);
  const bandLights = new Uint32Array(cells);
  for (let vx = 0; vx < side; vx++) {
    const x = vx - 1;
    for (let vy = 0; vy < height; vy++) {
      const y = firstRow + vy - 1;
      for (let vz = 0; vz < side; vz++) {
        const z = vz - 1;
        const index = (vx * height + vy) * side + vz;
        bandLights[index] = lightAt(x, y, z);
        if (x < 0 || x >= sx || y < 0 || y >= sy || z < 0 || z >= sz) {
          continue;
        }
        bandVoxels[index] = voxels[(x * sy + y) * sz + z];
      }
    }
  }
  return {
    firstRow,
    rows,
    side,
    height,
    voxels: bandVoxels,
    lights: bandLights,
  };
}

/** The bands a box of `rows` rows meshes in, `bandHeight` rows each. */
export function voxelBoxBandRows({
  rows,
  bandHeight,
}: {
  rows: number;
  bandHeight: number;
}): { firstRow: number; rows: number }[] {
  const step = Math.max(1, Math.floor(bandHeight));
  const bands: { firstRow: number; rows: number }[] = [];
  for (let firstRow = 0; firstRow < rows; firstRow += step) {
    bands.push({ firstRow, rows: Math.min(step, rows - firstRow) });
  }
  return bands;
}

/** The widest box the world's vertex quantization can hold, in blocks. */
export function maxVoxelBoxSide({
  positionUnits,
  positionBias,
}: {
  positionUnits: number;
  positionBias: number;
}): number {
  return Math.floor(65535 / positionUnits) - positionBias - 1;
}
