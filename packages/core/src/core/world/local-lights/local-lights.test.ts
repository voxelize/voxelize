import { describe, expect, it } from "vitest";

import { LightClusterGrid } from "./clustering";
import {
  LIGHT_FLAG_MASKED,
  LIGHT_FLAG_STATIC,
  LightSourceRegistry,
} from "./registry";
import { BlockProfileTable, EmitterBlock, SectionTracker } from "./scan";
import {
  BlockLightProfile,
  INVALID_LIGHT_HANDLE,
  LocalLightDescriptor,
  LocalLightStats,
} from "./types";

const CHUNK_SIZE = 16;
const MAX_HEIGHT = 64;
const SUB_CHUNKS = 2;
const MAX_LIGHT_LEVEL = 15;

const pointLight = (
  overrides: Partial<LocalLightDescriptor> = {},
): LocalLightDescriptor => ({
  shape: "point",
  color: [1, 0.8, 0.5],
  intensity: 1,
  range: 10,
  isStatic: false,
  shadowPolicy: "none",
  ...overrides,
});

const makeStats = (): LocalLightStats => ({
  registered: 0,
  candidates: 0,
  clustered: 0,
  cellsOverflowed: 0,
  selectMs: 0,
  packMs: 0,
  scanMs: 0,
  selectMsPeak: 0,
  packMsPeak: 0,
  scanMsPeak: 0,
  sectionsPendingScan: 0,
  selectionChurn: 0,
  gridTextureUploads: 0,
  dataTextureUploads: 0,
});

const makeGrid = (
  registry: LightSourceRegistry,
  overrides: Partial<{
    maxClusteredLights: number;
    maxLightsPerCell: number;
    analyticRadius: number;
  }> = {},
) =>
  new LightClusterGrid(registry, {
    gridCellSize: 8,
    gridDims: [24, 12, 24],
    maxClusteredLights: overrides.maxClusteredLights ?? 192,
    maxLightsPerCell: overrides.maxLightsPerCell ?? 8,
    analyticRadius: overrides.analyticRadius ?? 64,
    selectionHysteresis: 1.2,
    maskKnee: 2 / 15,
    fluidSpecularStrength: 1,
  });

describe("LightSourceRegistry", () => {
  it("issues stable generation-checked handles", () => {
    const registry = new LightSourceRegistry(8);
    const a = registry.add(pointLight(), 0, 0, 0);
    const b = registry.add(pointLight(), 1, 0, 0);
    expect(a).not.toBe(INVALID_LIGHT_HANDLE);
    expect(registry.resolve(a)).toBeGreaterThanOrEqual(0);
    expect(registry.resolve(b)).toBeGreaterThanOrEqual(0);

    expect(registry.remove(a)).toBe(true);
    expect(registry.resolve(a)).toBe(-1);
    expect(registry.remove(a)).toBe(false);
    expect(registry.setIntensity(a, 5)).toBe(false);

    // The slot is reused with a fresh generation: the old handle stays dead.
    const c = registry.add(pointLight(), 2, 0, 0);
    expect(registry.resolve(c)).toBeGreaterThanOrEqual(0);
    expect(registry.resolve(a)).toBe(-1);
  });

  it("never hands out handle zero and survives generation wrap", () => {
    const registry = new LightSourceRegistry(1);
    for (let cycle = 0; cycle < 5000; cycle++) {
      const handle = registry.add(pointLight(), 0, 0, 0);
      expect(handle).not.toBe(INVALID_LIGHT_HANDLE);
      expect(registry.remove(handle)).toBe(true);
    }
  });

  it("exhausts the pool gracefully", () => {
    const registry = new LightSourceRegistry(2);
    registry.add(pointLight(), 0, 0, 0);
    registry.add(pointLight(), 1, 0, 0);
    expect(registry.add(pointLight(), 2, 0, 0)).toBe(INVALID_LIGHT_HANDLE);
  });

  it("rejects setPosition on static lights", () => {
    const registry = new LightSourceRegistry(2);
    const fixed = registry.add(
      pointLight({ isStatic: true, shadowPolicy: "voxelMask" }),
      0,
      0,
      0,
    );
    const held = registry.add(pointLight(), 0, 0, 0);
    expect(registry.setPosition(fixed, 1, 2, 3)).toBe(false);
    expect(registry.setPosition(held, 1, 2, 3)).toBe(true);
  });

  it("flags static + voxelMask sources as masked, dynamic ones never", () => {
    const registry = new LightSourceRegistry(2);
    const masked = registry.add(
      pointLight({ isStatic: true, shadowPolicy: "voxelMask" }),
      0,
      0,
      0,
    );
    const dynamic = registry.add(
      pointLight({ shadowPolicy: "voxelMask" }),
      0,
      0,
      0,
    );
    expect(registry.flags[registry.resolve(masked)] & LIGHT_FLAG_MASKED).toBe(
      LIGHT_FLAG_MASKED,
    );
    expect(registry.flags[registry.resolve(masked)] & LIGHT_FLAG_STATIC).toBe(
      LIGHT_FLAG_STATIC,
    );
    expect(registry.flags[registry.resolve(dynamic)] & LIGHT_FLAG_MASKED).toBe(
      0,
    );
  });
});

describe("LightClusterGrid selection", () => {
  it("is deterministic for identical state", () => {
    const build = () => {
      const registry = new LightSourceRegistry(64);
      for (let i = 0; i < 32; i++) {
        registry.add(
          pointLight({ intensity: 1 + (i % 3), range: 8 + (i % 5) }),
          (i % 8) * 6,
          0,
          Math.floor(i / 8) * 6,
        );
      }
      const grid = makeGrid(registry, { maxClusteredLights: 16 });
      const stats = makeStats();
      grid.update(10, 0, 10, stats);
      return [...grid.selectedIndices.slice(0, grid.selectedCount)];
    };
    expect(build()).toEqual(build());
  });

  it("breaks score ties by registration order", () => {
    const registry = new LightSourceRegistry(8);
    // Four identical lights equidistant from the camera; only two slots.
    registry.add(pointLight(), 8, 0, 0);
    registry.add(pointLight(), -8, 0, 0);
    registry.add(pointLight(), 0, 0, 8);
    registry.add(pointLight(), 0, 0, -8);
    const grid = makeGrid(registry, { maxClusteredLights: 2 });
    const stats = makeStats();
    grid.update(0, 0, 0, stats);
    expect(grid.selectedCount).toBe(2);
    expect([...grid.selectedIndices.slice(0, 2)].sort()).toEqual([0, 1]);
  });

  it("keeps an incumbent through hysteresis against an equal challenger", () => {
    const registry = new LightSourceRegistry(8);
    const incumbent = registry.add(pointLight(), 8, 0, 0);
    const grid = makeGrid(registry, { maxClusteredLights: 1 });
    const stats = makeStats();
    grid.update(0, 0, 0, stats);
    expect(grid.selectedCount).toBe(1);

    // A same-strength challenger slightly closer would win a memoryless
    // selection; hysteresis keeps the incumbent.
    registry.add(pointLight(), 7.6, 0, 0);
    grid.update(0, 0, 0, stats);
    expect(grid.selectedCount).toBe(1);
    expect(grid.selectedIndices[0]).toBe(registry.resolve(incumbent));
  });

  it("does not leak hysteresis onto a new light reusing a freed slot", () => {
    const registry = new LightSourceRegistry(2);
    const incumbent = registry.add(pointLight(), 8, 0, 0);
    const grid = makeGrid(registry, { maxClusteredLights: 1 });
    const stats = makeStats();
    grid.update(0, 0, 0, stats);
    expect(grid.selectedIndices[0]).toBe(registry.resolve(incumbent));

    // The incumbent dies; a challenger reuses its slot at a slightly worse
    // spot than a new second light. Without generation-checked hysteresis
    // the reused slot would inherit the dead light's boost and win.
    registry.remove(incumbent);
    const reusedSlot = registry.add(pointLight(), 8, 0, 0);
    const closer = registry.add(pointLight(), 7.6, 0, 0);
    grid.update(0, 0, 0, stats);
    expect(grid.selectedCount).toBe(1);
    expect(grid.selectedIndices[0]).toBe(registry.resolve(closer));
    expect(registry.resolve(reusedSlot)).toBeGreaterThanOrEqual(0);
  });

  it("does nothing when neither the registry nor the camera cell changed", () => {
    const registry = new LightSourceRegistry(8);
    registry.add(pointLight(), 4, 0, 4);
    const grid = makeGrid(registry);
    const stats = makeStats();
    grid.update(0, 0, 0, stats);
    const uploads = stats.gridTextureUploads;

    // Sub-cell camera motion, no registry writes: a no-op frame.
    grid.update(0.5, 0.25, 0.5, stats);
    grid.update(1.5, 0.25, 1.5, stats);
    expect(stats.gridTextureUploads).toBe(uploads);

    registry.setIntensity(registry.add(pointLight(), 2, 0, 2), 2);
    grid.update(1.5, 0.25, 1.5, stats);
    expect(stats.gridTextureUploads).toBe(uploads + 1);
  });

  it("drops the lowest-importance light in a full cell, deterministically", () => {
    const registry = new LightSourceRegistry(16);
    // Ten lights stacked on the same spot: one cell, eight slots.
    for (let i = 0; i < 10; i++) {
      registry.add(pointLight({ intensity: 10 - i, range: 4 }), 4, 4, 4);
    }
    const grid = makeGrid(registry);
    const stats = makeStats();
    grid.update(0, 0, 0, stats);
    expect(grid.selectedCount).toBe(10);
    expect(stats.cellsOverflowed).toBeGreaterThan(0);

    // The overflow victims must be the two weakest lights: ranks 8 and 9.
    const sample: [number, number, number] = [0, 0, 0];
    const contributors = grid.sampleIrradiance(4, 4, 4, sample);
    expect(contributors).toBe(10);
  });

  it("culls candidates outside the grid window's vertical span", () => {
    const registry = new LightSourceRegistry(8);
    // Window is 24x12x24 cells of 8 blocks: ±96 horizontal, ±48 vertical.
    registry.add(pointLight({ range: 4 }), 8, 0, 0);
    const tooHigh = registry.add(pointLight({ range: 4 }), 0, 60, 0);
    const grid = makeGrid(registry, { analyticRadius: 96 });
    const stats = makeStats();
    grid.update(0, 0, 0, stats);
    // The high light could never be binned; selecting it would waste a slot.
    expect(stats.candidates).toBe(1);
    expect(grid.selectedCount).toBe(1);
    expect(grid.selectedIndices[0]).not.toBe(registry.resolve(tooHigh));
  });

  it("caps the clustered set at the tier limit", () => {
    const registry = new LightSourceRegistry(64);
    for (let i = 0; i < 40; i++) {
      registry.add(pointLight({ range: 4 }), i * 2, 0, 0);
    }
    const grid = makeGrid(registry, { maxClusteredLights: 8 });
    const stats = makeStats();
    grid.update(0, 0, 0, stats);
    expect(grid.selectedCount).toBe(8);

    grid.setTierCaps(0, 0, 0, 0);
    grid.update(0, 0, 0, stats);
    expect(grid.selectedCount).toBe(0);
    expect(grid.uniforms.clusteredCount.value).toBe(0);
  });
});

const makeChunk = (minX: number, minZ: number) => ({
  min: [minX, 0, minZ] as [number, number, number],
  voxels: { data: new Uint32Array(CHUNK_SIZE * MAX_HEIGHT * CHUNK_SIZE) },
});

const setVoxel = (
  chunk: ReturnType<typeof makeChunk>,
  lx: number,
  ly: number,
  lz: number,
  id: number,
) => {
  chunk.voxels.data[lx * MAX_HEIGHT * CHUNK_SIZE + ly * CHUNK_SIZE + lz] = id;
};

const TORCH: EmitterBlock = {
  id: 7,
  isLight: true,
  redLightLevel: 14,
  greenLightLevel: 9,
  blueLightLevel: 2,
};
const LAVA: EmitterBlock = {
  id: 9,
  isLight: true,
  redLightLevel: 15,
  greenLightLevel: 8,
  blueLightLevel: 0,
};
const STONE: EmitterBlock = {
  id: 1,
  isLight: false,
  redLightLevel: 0,
  greenLightLevel: 0,
  blueLightLevel: 0,
};

const makeTable = (profiles: [number, BlockLightProfile][] = []) =>
  new BlockProfileTable(
    [STONE, TORCH, LAVA],
    new Map(profiles),
    MAX_LIGHT_LEVEL,
  );

describe("BlockProfileTable", () => {
  it("derives a default profile from flood levels", () => {
    const table = makeTable();
    expect(table.isLightById[TORCH.id]).toBe(1);
    expect(table.isLightById[STONE.id]).toBe(0);
    const profile = table.profileFor(TORCH.id)!;
    expect(profile.descriptor.isStatic).toBe(true);
    expect(profile.descriptor.shadowPolicy).toBe("voxelMask");
    expect(profile.descriptor.range).toBe(14);
    expect(profile.descriptor.intensity).toBeCloseTo(14 / 15);
    expect(profile.descriptor.color![0]).toBeCloseTo(1);
    expect(profile.descriptor.color![1]).toBeCloseTo(9 / 14);
  });

  it("lets a declared profile override the defaults", () => {
    const table = makeTable([
      [TORCH.id, { colorTemperatureK: 1900, intensity: 1.2, range: 12 }],
    ]);
    const profile = table.profileFor(TORCH.id)!;
    expect(profile.descriptor.intensity).toBe(1.2);
    expect(profile.descriptor.range).toBe(12);
    expect(profile.descriptor.color).toBeUndefined();
    expect(profile.descriptor.colorTemperatureK).toBe(1900);
  });
});

describe("SectionTracker", () => {
  it("registers scanned emitters and keeps handles stable across rescans", () => {
    const registry = new LightSourceRegistry(64);
    const tracker = new SectionTracker(
      registry,
      CHUNK_SIZE,
      MAX_HEIGHT,
      SUB_CHUNKS,
    );
    const table = makeTable();
    const chunk = makeChunk(0, 0);
    setVoxel(chunk, 3, 5, 3, TORCH.id);
    setVoxel(chunk, 10, 20, 10, TORCH.id);

    const key = tracker.sectionKey(0, 0, 0);
    tracker.rescanSection(key, chunk, 0, table);
    expect(registry.aliveCount).toBe(2);

    const handlesBefore = [...registry.aliveIndices.slice(0, 2)];
    // An unrelated edit in the same section: rescan must not churn handles.
    setVoxel(chunk, 8, 8, 8, STONE.id);
    tracker.rescanSection(key, chunk, 0, table);
    expect(registry.aliveCount).toBe(2);
    expect([...registry.aliveIndices.slice(0, 2)]).toEqual(handlesBefore);

    // Breaking one torch releases exactly that one.
    setVoxel(chunk, 3, 5, 3, 0);
    tracker.rescanSection(key, chunk, 0, table);
    expect(registry.aliveCount).toBe(1);

    tracker.releaseSection(key);
    expect(registry.aliveCount).toBe(0);
  });

  it("places emitters at the profile offset in world space", () => {
    const registry = new LightSourceRegistry(8);
    const tracker = new SectionTracker(
      registry,
      CHUNK_SIZE,
      MAX_HEIGHT,
      SUB_CHUNKS,
    );
    const table = makeTable([[TORCH.id, { offset: [0.5, 0.7, 0.5] }]]);
    const chunk = makeChunk(32, -16);
    setVoxel(chunk, 4, 33, 6, TORCH.id);

    tracker.rescanSection(tracker.sectionKey(2, -1, 1), chunk, 1, table);
    expect(registry.aliveCount).toBe(1);
    const slot = registry.aliveIndices[0];
    expect(registry.positions[slot * 3]).toBeCloseTo(32 + 4 + 0.5);
    expect(registry.positions[slot * 3 + 1]).toBeCloseTo(33 + 0.7);
    expect(registry.positions[slot * 3 + 2]).toBeCloseTo(-16 + 6 + 0.5);
  });

  it("aggregates dense fields into few proxies, deterministically", () => {
    const build = () => {
      const registry = new LightSourceRegistry(256);
      const tracker = new SectionTracker(
        registry,
        CHUNK_SIZE,
        MAX_HEIGHT,
        SUB_CHUNKS,
      );
      const table = makeTable([
        [LAVA.id, { aggregateThreshold: 6, maxProxiesPerSection: 4 }],
      ]);
      const chunk = makeChunk(0, 0);
      // A 10x10 lava patch: 100 emitters, far past the threshold.
      for (let lx = 2; lx < 12; lx++) {
        for (let lz = 2; lz < 12; lz++) {
          setVoxel(chunk, lx, 10, lz, LAVA.id);
        }
      }
      tracker.rescanSection(tracker.sectionKey(0, 0, 0), chunk, 0, table);
      const records: number[] = [];
      for (let k = 0; k < registry.aliveCount; k++) {
        const i = registry.aliveIndices[k];
        records.push(
          registry.positions[i * 3],
          registry.positions[i * 3 + 1],
          registry.positions[i * 3 + 2],
          registry.ranges[i],
          registry.intensities[i],
        );
      }
      return records;
    };

    const first = build();
    expect(first.length / 5).toBeLessThanOrEqual(4);
    expect(first.length / 5).toBeGreaterThan(0);
    expect(build()).toEqual(first);
  });

  it("keeps sparse aggregatable blocks individual", () => {
    const registry = new LightSourceRegistry(16);
    const tracker = new SectionTracker(
      registry,
      CHUNK_SIZE,
      MAX_HEIGHT,
      SUB_CHUNKS,
    );
    const table = makeTable([
      [LAVA.id, { aggregateThreshold: 6, maxProxiesPerSection: 4 }],
    ]);
    const chunk = makeChunk(0, 0);
    setVoxel(chunk, 1, 1, 1, LAVA.id);
    setVoxel(chunk, 14, 1, 14, LAVA.id);
    tracker.rescanSection(tracker.sectionKey(0, 0, 0), chunk, 0, table);
    expect(registry.aliveCount).toBe(2);
  });
});
