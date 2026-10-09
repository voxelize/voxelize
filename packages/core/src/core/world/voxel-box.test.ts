import type { GeometryProtocol } from "@voxelize/protocol";
import { describe, expect, it } from "vitest";

import type { BudgetedWorkOutcome } from "../../libs/instancing/frame-budget";

import {
  createVoxelBoxBand,
  fillVoxelBoxBand,
  splitVoxelBoxGeometry,
  voxelBoxBand,
  VoxelBoxWork,
} from "./voxel-box";

describe("voxel box bands", () => {
  it("fill a few columns at a time exactly as they fill at once", () => {
    const size: [number, number, number] = [5, 7, 4];
    const voxels = new Uint32Array(5 * 7 * 4).map((_, i) => (i % 3 ? i : 0));
    const lightAt = (x: number, y: number, z: number) =>
      x * 10_000 + y * 100 + z;
    const whole = voxelBoxBand({ size, voxels, firstRow: 2, rows: 3, lightAt });
    const sliced = createVoxelBoxBand({ size, firstRow: 2, rows: 3 });
    for (let from = 0; from < sliced.side; from += 2) {
      fillVoxelBoxBand({
        band: sliced,
        size,
        voxels,
        lightAt,
        fromColumn: from,
        toColumn: from + 2,
      });
    }
    expect(sliced.voxels).toEqual(whole.voxels);
    expect(sliced.lights).toEqual(whole.lights);
  });
});

/** `quads` quads in a row, four vertices and two triangles each. */
function quadStrip(quads: number): GeometryProtocol {
  const positions = new Float32Array(quads * 4 * 3).map((_, i) => i);
  const uvs = new Float32Array(quads * 4 * 2).map((_, i) => i / 2);
  const lights = new Uint32Array(quads * 4).map((_, i) => i * 7);
  const indices = new Uint32Array(quads * 6);
  for (let q = 0; q < quads; q++) {
    indices.set(
      [0, 1, 2, 2, 1, 3].map((v) => q * 4 + v),
      q * 6,
    );
  }
  return { voxel: 9, faceName: "px", positions, uvs, lights, indices };
}

describe("splitting a box's geometry", () => {
  it("keeps every triangle, each piece bounded and holding its own vertices", () => {
    const geometry = quadStrip(1_000);
    const pieces = splitVoxelBoxGeometry({ geometry, maxTriangles: 300 });
    expect(pieces.length).toBe(Math.ceil(2_000 / 300));
    let triangles = 0;
    for (const piece of pieces) {
      const count = piece.indices.length / 3;
      expect(count).toBeLessThanOrEqual(300);
      expect(count % 2).toBe(0);
      triangles += count;
      const vertices = piece.positions.length / 3;
      expect(Math.max(...piece.indices)).toBe(vertices - 1);
      expect(piece.lights.length).toBe(vertices);
      expect(piece.uvs.length).toBe(vertices * 2);
    }
    expect(triangles).toBe(2_000);
    // The second piece's first triangle is the original's triangle 300.
    const second = pieces[1];
    const original = geometry.indices[300 * 3];
    const firstVertex = second.indices[0];
    expect(second.positions[firstVertex * 3]).toBe(
      geometry.positions[original * 3],
    );
    expect(second.lights[firstVertex]).toBe(geometry.lights[original]);
  });

  it("leaves a small geometry whole", () => {
    const geometry = quadStrip(4);
    expect(splitVoxelBoxGeometry({ geometry, maxTriangles: 300 })).toEqual([
      geometry,
    ]);
  });
});

/** A drain driven by hand: each `frame()` runs one slice the way
 * `createBudgetedDrain` does, until `budgetMs` of fake time is spent. */
function handDrain(budgetMs: number) {
  let clock = 0;
  let work: (() => BudgetedWorkOutcome) | null = null;
  let isQueued = false;
  return {
    now: () => clock,
    advance: (ms: number) => (clock += ms),
    createDrain: (unitWork: () => BudgetedWorkOutcome) => {
      work = unitWork;
      return { schedule: () => (isQueued = true) };
    },
    /** Runs one frame's slice; returns its cost. */
    frame(): number {
      clock += 16;
      if (!isQueued || !work) return 0;
      isQueued = false;
      const started = clock;
      for (;;) {
        const outcome = work();
        if (outcome === "exhausted") return clock - started;
        if (clock - started >= budgetMs) break;
      }
      isQueued = true;
      return clock - started;
    },
  };
}

describe("voxel box work", () => {
  it("runs every box's units in order, a budgeted slice a frame between them", async () => {
    const drain = handDrain(2);
    const queue = new VoxelBoxWork({
      createDrain: drain.createDrain,
      now: drain.now,
      sliceGapMs: 1,
    });
    const order: string[] = [];
    const unit = (name: string) => () => {
      order.push(name);
      drain.advance(0.7);
    };
    const first = queue.run([unit("a1"), unit("a2"), unit("a3"), unit("a4")]);
    const second = queue.run([unit("b1"), unit("b2"), unit("b3")]);
    const slices: number[] = [];
    for (let i = 0; i < 10; i++) slices.push(drain.frame());
    const [a, b] = await Promise.all([first, second]);
    expect(order).toEqual(["a1", "a2", "a3", "a4", "b1", "b2", "b3"]);
    expect(Math.max(...slices)).toBeLessThanOrEqual(2 + 0.7);
    expect(slices.filter((ms) => ms > 0).length).toBeGreaterThanOrEqual(3);
    expect(a.mainThreadMs).toBeCloseTo(4 * 0.7);
    expect(b.mainThreadMs).toBeCloseTo(3 * 0.7);
    expect(a.maxSliceMs).toBeLessThanOrEqual(2 + 0.7);
    expect(b.maxSliceMs).toBeGreaterThan(0);
  });

  it("fails the run whose unit throws, and carries on with the next", async () => {
    const drain = handDrain(2);
    const queue = new VoxelBoxWork({
      createDrain: drain.createDrain,
      now: drain.now,
      sliceGapMs: 1,
    });
    let ranAfterFailure = false;
    const broken = queue.run([
      () => {
        throw new Error("no geometry");
      },
      () => {
        ranAfterFailure = true;
      },
    ]);
    const fine = queue.run([() => drain.advance(0.5)]);
    for (let i = 0; i < 5; i++) drain.frame();
    await expect(broken).rejects.toThrow("no geometry");
    expect(ranAfterFailure).toBe(false);
    await expect(fine).resolves.toMatchObject({ mainThreadMs: 0.5 });
  });
});
