import type { GeometryProtocol } from "@voxelize/protocol";
import type { Group } from "three";

import type { BudgetedWorkOutcome } from "../../libs/instancing/frame-budget";
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
  /** The most main-thread time any one frame spent building voxel boxes
   * while this one was built (the budget is shared by every box at once). */
  maxSliceMs: number;
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
export function voxelBoxBand(options: VoxelBoxBandOptions): VoxelBoxBand {
  const band = createVoxelBoxBand(options);
  fillVoxelBoxBand({ ...options, band, fromColumn: 0, toColumn: band.side });
  return band;
}

/** One band's chunk, empty: `fillVoxelBoxBand` lays it out a few columns at
 * a time, so a big box never fills in one go. */
export function createVoxelBoxBand({
  size,
  firstRow,
  rows,
}: {
  size: Coords3;
  firstRow: number;
  rows: number;
}): VoxelBoxBand {
  const [sx, , sz] = size;
  const side = Math.max(sx, sz) + 2;
  const height = rows + 2;
  const cells = side * height * side;
  return {
    firstRow,
    rows,
    side,
    height,
    voxels: new Uint32Array(cells),
    lights: new Uint32Array(cells),
  };
}

/** Lays out the band's chunk columns `fromColumn` up to `toColumn` (along
 * x, the chunk's outermost axis). */
export function fillVoxelBoxBand({
  band,
  size,
  voxels,
  lightAt,
  fromColumn,
  toColumn,
}: Omit<VoxelBoxBandOptions, "firstRow" | "rows"> & {
  band: VoxelBoxBand;
  fromColumn: number;
  toColumn: number;
}): void {
  const [sx, sy, sz] = size;
  const { side, height, firstRow } = band;
  const last = Math.min(side, toColumn);
  for (let vx = Math.max(0, fromColumn); vx < last; vx++) {
    const x = vx - 1;
    for (let vy = 0; vy < height; vy++) {
      const y = firstRow + vy - 1;
      for (let vz = 0; vz < side; vz++) {
        const z = vz - 1;
        const index = (vx * height + vy) * side + vz;
        band.lights[index] = lightAt(x, y, z);
        if (x < 0 || x >= sx || y < 0 || y >= sy || z < 0 || z >= sz) {
          continue;
        }
        band.voxels[index] = voxels[(x * sy + y) * sz + z];
      }
    }
  }
}

/**
 * `geometry` cut into pieces of at most `maxTriangles` triangles, each with
 * only the vertices its own triangles use, so building any one piece on the
 * main thread is a bounded unit of work. Pieces start on even triangles, so
 * a quad the mesher wrote as two triangles stays in one piece.
 */
export function splitVoxelBoxGeometry({
  geometry,
  maxTriangles,
}: {
  geometry: GeometryProtocol;
  maxTriangles: number;
}): GeometryProtocol[] {
  const triangles = Math.floor(geometry.indices.length / 3);
  const perPiece = Math.max(2, Math.floor(maxTriangles / 2) * 2);
  if (triangles <= perPiece) return [geometry];
  const pieces: GeometryProtocol[] = [];
  for (let first = 0; first < triangles; first += perPiece) {
    const indices = geometry.indices.subarray(
      first * 3,
      Math.min(triangles, first + perPiece) * 3,
    );
    let low = Infinity;
    let high = -1;
    for (const index of indices) {
      if (index < low) low = index;
      if (index > high) high = index;
    }
    const remapped = new Uint32Array(indices.length);
    for (let i = 0; i < indices.length; i++) remapped[i] = indices[i] - low;
    const vertices = <T extends { slice(start: number, end: number): T }>(
      array: T,
      stride: number,
    ) => array.slice(low * stride, (high + 1) * stride);
    pieces.push({
      voxel: geometry.voxel,
      at: geometry.at,
      faceName: geometry.faceName,
      positions: vertices(geometry.positions, 3),
      uvs: vertices(geometry.uvs, 2),
      lights: vertices(geometry.lights, 1),
      normals:
        geometry.normals && geometry.normals.length > 0
          ? vertices(geometry.normals, 3)
          : geometry.normals,
      lightTwist: geometry.lightTwist
        ? vertices(geometry.lightTwist, 4)
        : undefined,
      indices: remapped,
    });
  }
  return pieces;
}

/** What a run of voxel-box work cost the main thread. */
export type VoxelBoxWorkCost = {
  mainThreadMs: number;
  /** The most any one slice ran while this work was queued, including other
   * boxes' work sharing it. */
  maxSliceMs: number;
};

/**
 * Work every voxel box being built shares, in order, a slice per frame: the
 * frame-paced drain (`createBudgetedDrain`, made by `createDrain`) runs units
 * until the slice has spent its budget, so however many boxes bake at once
 * (a felled tree bakes several) the frame pays one budget for all of them. A
 * unit that throws fails its own run, loudly, never the drain.
 */
export class VoxelBoxWork {
  private readonly units: (() => void)[] = [];
  private readonly drain: { schedule(): void };
  private sliceMs = 0;
  private lastUnitEndMs = -Infinity;
  private readonly openRuns = new Set<{ maxSliceMs: number }>();

  constructor(
    private readonly options: {
      createDrain: (work: () => BudgetedWorkOutcome) => { schedule(): void };
      now: () => number;
      /** A pause between units longer than this starts a new slice. */
      sliceGapMs: number;
    },
  ) {
    this.drain = options.createDrain(() => this.runUnit());
  }

  /** Queues `units`, resolving once they have all run. */
  run(units: (() => void)[]): Promise<VoxelBoxWorkCost> {
    return new Promise((resolve, reject) => {
      const stats = { maxSliceMs: 0 };
      let mainThreadMs = 0;
      let failure: unknown = null;
      this.openRuns.add(stats);
      for (const unit of units) {
        this.units.push(() => {
          if (failure !== null) return;
          const started = this.options.now();
          try {
            unit();
          } catch (error) {
            failure = error;
          }
          mainThreadMs += this.options.now() - started;
        });
      }
      this.units.push(() => {
        this.openRuns.delete(stats);
        if (failure !== null) reject(failure);
        else resolve({ mainThreadMs, maxSliceMs: stats.maxSliceMs });
      });
      this.drain.schedule();
    });
  }

  private runUnit(): BudgetedWorkOutcome {
    const unit = this.units.shift();
    if (!unit) return "exhausted";
    const started = this.options.now();
    if (started - this.lastUnitEndMs > this.options.sliceGapMs) {
      this.sliceMs = 0;
    }
    unit();
    const ended = this.options.now();
    this.sliceMs += ended - started;
    this.lastUnitEndMs = ended;
    for (const stats of this.openRuns) {
      stats.maxSliceMs = Math.max(stats.maxSliceMs, this.sliceMs);
    }
    return this.units.length > 0 ? "worked" : "exhausted";
  }
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
