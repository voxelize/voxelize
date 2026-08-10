import {
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  Vector4,
  WebGLRenderer,
} from "three";
import { describe, expect, it } from "vitest";

import { SHADER_LIGHTING_FLUID_CHUNK_SHADERS } from "../shaders";

import { LightClusterGrid } from "./clustering";
import { LightSourceRegistry } from "./registry";
import {
  deriveEmissiveAnchor,
  BlockProfileTable,
  SectionTracker,
} from "./scan";
import { LOCAL_LIGHTS_FUNCTIONS } from "./shader";
import {
  linearizeShadowDepth,
  orientPointFaceCamera,
  orientSpotCamera,
  POINT_FACE_GUARD_TAN_HALF,
  projectPointLightFragment,
} from "./shadow-atlas";
import { ShadowFrameLedger } from "./shadow-ledger";
import { LocalShadowScheduler } from "./shadow-scheduler";
import { LocalLightDescriptor, LocalLightStats } from "./types";

import { LocalLights } from "./index";

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
  shadowed: 0,
  shadowFacesRendered: 0,
  shadowFacesStatic: 0,
  shadowFacesDynamic: 0,
  shadowScheduleMs: 0,
  shadowScheduleMsPeak: 0,
  shadowInvalidations: 0,
  atlasEvictions: 0,
  atlasOccupancy: 0,
  shadowCacheHitRate: 1,
  ledgerUnitsCsm: 0,
  ledgerUnitsLocal: 0,
  atlasBytes: 0,
});

const shadowLight = (
  overrides: Partial<LocalLightDescriptor> = {},
): LocalLightDescriptor => ({
  shape: "point",
  color: [1, 0.8, 0.5],
  intensity: 1,
  range: 12,
  isStatic: true,
  shadowPolicy: "shadowMap",
  ...overrides,
});

const makeScheduler = (registry: LightSourceRegistry, maxShadowedLights = 2) =>
  new LocalShadowScheduler(registry, {
    maxShadowedLights,
    shadowAtlasSize: 2048,
    shadowSlotSize: 256,
    shadowEvictionHysteresis: { ratio: 1.25, frames: 5 },
  });

const indexOf = (registry: LightSourceRegistry, handle: number) =>
  registry.resolve(handle);

const selectionOf = (registry: LightSourceRegistry, handles: number[]) => {
  const selected = new Uint32Array(handles.length);
  handles.forEach((handle, n) => {
    selected[n] = registry.resolve(handle);
  });
  return selected;
};

describe("ShadowFrameLedger", () => {
  it("grants CSM everything when local lights are inactive (invariant 6)", () => {
    const ledger = new ShadowFrameLedger();
    // Even a budget far below the CSM costs never denies CSM while no
    // local consumer is active — low/potato tiers keep sun shadows whole.
    for (let frame = 0; frame < 10; frame++) {
      ledger.beginFrame(4);
      ledger.chargeCsmNear(4);
      expect(ledger.requestCsmFar(6)).toBe(true);
    }
    expect(ledger.frameStats.csmFarDenied).toBe(0);
    expect(ledger.frameStats.csmFarForced).toBe(0);
  });

  it("defers a far cascade while dynamic faces reserve, then force-grants", () => {
    const ledger = new ShadowFrameLedger(2);
    const denials: boolean[] = [];
    for (let frame = 0; frame < 4; frame++) {
      ledger.beginFrame(12);
      // A held light reserves 6 face units before CSM renders.
      expect(ledger.reserveDynamic(6)).toBe(6);
      ledger.chargeCsmNear(4);
      // 4 used + 6 far > 12 - 6 reserved: denied twice, forced on the 3rd.
      denials.push(ledger.requestCsmFar(6));
      // Locals consume their reservation regardless.
      expect(ledger.requestLocal("dynamic", 6)).toBe(true);
    }
    expect(denials).toEqual([false, false, true, false]);
  });

  it("gives static faces only unreserved budget and dynamic its reservation", () => {
    const ledger = new ShadowFrameLedger();
    ledger.beginFrame(12);
    expect(ledger.reserveDynamic(4)).toBe(4);
    ledger.chargeCsmNear(4);
    // 4 used, 4 reserved: static may spend the remaining free 4 only.
    expect(ledger.requestLocal("static", 4)).toBe(true);
    expect(ledger.requestLocal("static", 1)).toBe(false);
    // The reservation still honors dynamic faces.
    expect(ledger.requestLocal("dynamic", 4)).toBe(true);
    expect(ledger.requestLocal("dynamic", 1)).toBe(false);
    expect(ledger.frameStats.localDynamicUnits).toBe(4);
    expect(ledger.frameStats.localStaticUnits).toBe(4);
  });
});

describe("shadow face camera math", () => {
  const camera = new PerspectiveCamera();
  const scratch = new Vector4();

  const projectThroughCamera = (point: Vector3) => {
    scratch.set(point.x, point.y, point.z, 1);
    scratch.applyMatrix4(camera.matrixWorldInverse);
    const viewZ = scratch.z;
    scratch.applyMatrix4(camera.projectionMatrix);
    return {
      u: (scratch.x / scratch.w) * 0.5 + 0.5,
      v: (scratch.y / scratch.w) * 0.5 + 0.5,
      depth01: (scratch.z / scratch.w) * 0.5 + 0.5,
      viewZ,
    };
  };

  it("reconstructs every point-light cube face exactly like the camera", () => {
    const light = new Vector3(100.5, 60.7, -40.5);
    const near = 0.25;
    const far = 14;
    // Deterministic pseudo-random sample points around the light.
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let tested = 0;
    for (let n = 0; n < 500; n++) {
      const point = new Vector3(
        light.x + (random() * 2 - 1) * far,
        light.y + (random() * 2 - 1) * far,
        light.z + (random() * 2 - 1) * far,
      );
      const analytic = projectPointLightFragment(
        light.x,
        light.y,
        light.z,
        point.x,
        point.y,
        point.z,
        POINT_FACE_GUARD_TAN_HALF,
      );
      if (!analytic || analytic.w < near * 1.5 || analytic.w > far * 0.98) {
        continue;
      }
      // Skip points hugging a face boundary, where float noise may flip the
      // chosen face (both faces contain them thanks to the guard band).
      if (
        Math.min(analytic.u, 1 - analytic.u) < 0.01 ||
        Math.min(analytic.v, 1 - analytic.v) < 0.01
      ) {
        continue;
      }
      orientPointFaceCamera(camera, {
        light: [light.x, light.y, light.z],
        face: analytic.face,
        tanHalf: POINT_FACE_GUARD_TAN_HALF,
        near,
        far,
      });
      const viaCamera = projectThroughCamera(point);
      expect(viaCamera.u).toBeCloseTo(analytic.u, 4);
      expect(viaCamera.v).toBeCloseTo(analytic.v, 4);
      // The stored hardware depth linearizes back to the axis distance the
      // shader compares against.
      const linear = linearizeShadowDepth(viaCamera.depth01, near, far);
      expect(linear).toBeCloseTo(analytic.w, 3);
      tested++;
    }
    expect(tested).toBeGreaterThan(150);
  });

  it("reconstructs the spot basis exactly like the camera", () => {
    const light = new Vector3(10, 50, 10);
    const near = 0.25;
    const far = 20;
    const direction = new Vector3(0.3, -0.8, 0.52).normalize();
    const cosOuter = Math.cos((70 * Math.PI) / 360);
    const tanHalf = (Math.sqrt(1 - cosOuter * cosOuter) / cosOuter) * 1.05;

    orientSpotCamera(camera, {
      light: [light.x, light.y, light.z],
      direction: [direction.x, direction.y, direction.z],
      tanHalf,
      near,
      far,
    });

    // Mirror of the GLSL spot reconstruction.
    const upRef =
      Math.abs(direction.y) > 0.99
        ? new Vector3(0, 0, 1)
        : new Vector3(0, 1, 0);
    const right = new Vector3().crossVectors(direction, upRef).normalize();
    const up = new Vector3().crossVectors(right, direction);

    const point = light
      .clone()
      .addScaledVector(direction, 9)
      .addScaledVector(right, 2.5)
      .addScaledVector(up, -1.75);
    const rel = point.clone().sub(light);
    const w = rel.dot(direction);
    const ndcU = rel.dot(right) / (w * tanHalf);
    const ndcV = rel.dot(up) / (w * tanHalf);

    const viaCamera = projectThroughCamera(point);
    expect(viaCamera.u).toBeCloseTo(ndcU * 0.5 + 0.5, 4);
    expect(viaCamera.v).toBeCloseTo(ndcV * 0.5 + 0.5, 4);
    expect(linearizeShadowDepth(viaCamera.depth01, near, far)).toBeCloseTo(
      w,
      3,
    );
  });
});

describe("LocalShadowScheduler", () => {
  it("assigns slots to shadow-requesting clustered lights only", () => {
    const registry = new LightSourceRegistry(16);
    const scheduler = makeScheduler(registry);
    const stats = makeStats();

    const shadowed = registry.add(shadowLight(), 4, 60, 4);
    const plain = registry.add(
      shadowLight({ shadowPolicy: "voxelMask" }),
      8,
      60,
      8,
    );

    const selection = selectionOf(registry, [shadowed, plain]);
    scheduler.update(selection, 2, 0, 60, 0, stats);

    expect(stats.shadowed).toBe(1);
    expect(
      scheduler.recordForIndex(indexOf(registry, shadowed)),
    ).not.toBeNull();
    expect(scheduler.recordForIndex(indexOf(registry, plain))).toBeNull();
  });

  it("releases a slot when its light dies or leaves the clustered set", () => {
    const registry = new LightSourceRegistry(16);
    const scheduler = makeScheduler(registry);
    const stats = makeStats();

    const a = registry.add(shadowLight(), 4, 60, 4);
    scheduler.update(selectionOf(registry, [a]), 1, 0, 60, 0, stats);
    expect(stats.shadowed).toBe(1);

    // Out of the clustered set: released.
    scheduler.update(selectionOf(registry, []), 0, 0, 60, 0, stats);
    expect(stats.shadowed).toBe(0);

    // Back in, then removed from the registry entirely.
    scheduler.update(selectionOf(registry, [a]), 1, 0, 60, 0, stats);
    expect(stats.shadowed).toBe(1);
    const index = indexOf(registry, a);
    registry.remove(a);
    const stale = new Uint32Array([index]);
    scheduler.update(stale, 0, 0, 60, 0, stats);
    expect(stats.shadowed).toBe(0);
  });

  it("evicts only after the challenger sustains its lead (hysteresis)", () => {
    const registry = new LightSourceRegistry(16);
    const scheduler = makeScheduler(registry, 1);
    const stats = makeStats();

    // Holder: modest light near the camera. Challenger: far brighter.
    const holder = registry.add(shadowLight({ intensity: 1 }), 6, 60, 0);
    scheduler.update(selectionOf(registry, [holder]), 1, 0, 60, 0, stats);
    expect(scheduler.recordForIndex(indexOf(registry, holder))).not.toBeNull();

    const challenger = registry.add(shadowLight({ intensity: 10 }), 0, 60, 6);
    const selection = selectionOf(registry, [holder, challenger]);

    // Four frames of sustained challenge: still held (frames = 5).
    for (let n = 0; n < 4; n++) {
      scheduler.update(selection, 2, 0, 60, 0, stats);
      expect(
        scheduler.recordForIndex(indexOf(registry, holder)),
      ).not.toBeNull();
    }
    // Fifth frame: swap.
    scheduler.update(selection, 2, 0, 60, 0, stats);
    expect(scheduler.recordForIndex(indexOf(registry, holder))).toBeNull();
    expect(
      scheduler.recordForIndex(indexOf(registry, challenger)),
    ).not.toBeNull();
    expect(stats.atlasEvictions).toBe(1);
  });

  it("invalidates cached maps only for edits inside a light's range", () => {
    const registry = new LightSourceRegistry(16);
    const scheduler = makeScheduler(registry);
    const stats = makeStats();

    const light = registry.add(shadowLight({ range: 10 }), 0, 60, 0);
    scheduler.update(selectionOf(registry, [light]), 1, 0, 60, 0, stats);

    // Drain the initial static queue by hand so the cache reads as warm.
    const anyScheduler = scheduler as unknown as {
      slots: { staticPending: number; staticMask: number }[];
    };
    anyScheduler.slots[0].staticPending = 0;
    anyScheduler.slots[0].staticMask = 0b111111;

    scheduler.notifyBlockEdit(100, 60, 100); // far outside range
    expect(anyScheduler.slots[0].staticPending).toBe(0);

    scheduler.notifyBlockEdit(4, 62, -3); // inside range
    expect(anyScheduler.slots[0].staticPending).not.toBe(0);
    expect(stats.shadowInvalidations ?? 0).toBe(0); // stats update next frame

    // The region API behaves identically.
    anyScheduler.slots[0].staticPending = 0;
    scheduler.invalidateRegion({ min: [50, 0, 50], max: [60, 100, 60] }); // outside
    expect(anyScheduler.slots[0].staticPending).toBe(0);
    scheduler.invalidateRegion({ min: [-2, 59, -2], max: [2, 61, 2] }); // overlapping
    expect(anyScheduler.slots[0].staticPending).not.toBe(0);
  });

  it("skips faces buried in opaque mounts, keeping the rest", () => {
    const registry = new LightSourceRegistry(16);
    const scheduler = makeScheduler(registry);
    const stats = makeStats();

    // Wall torch: the wall fills the -X neighbor; the floor the -Y one.
    scheduler.getIsOpaqueAt = (vx, vy, vz) =>
      (vx === 3 && vy === 60 && vz === 4) ||
      (vx === 4 && vy === 59 && vz === 4);

    const light = registry.add(shadowLight(), 4.5, 60.6, 4.5);
    scheduler.update(selectionOf(registry, [light]), 1, 0, 60, 0, stats);

    const record = scheduler.recordForIndex(indexOf(registry, light));
    expect(record).not.toBeNull();
    const anyScheduler = scheduler as unknown as {
      slots: { allowedMask: number }[];
    };
    // Faces: 0 +X, 1 -X (wall), 2 +Y, 3 -Y (floor), 4 +Z, 5 -Z.
    expect(anyScheduler.slots[0].allowedMask).toBe(0b110101);
  });

  it("packs shadow texels for holders and falls back to the mask otherwise", () => {
    const registry = new LightSourceRegistry(16);
    const scheduler = makeScheduler(registry, 1);
    const grid = new LightClusterGrid(registry, {
      gridCellSize: 8,
      gridDims: [24, 12, 24],
      maxClusteredLights: 8,
      maxLightsPerCell: 8,
      analyticRadius: 64,
      selectionHysteresis: 1.2,
      maskKnee: 2 / 15,
      fluidSpecularStrength: 1,
    });
    grid.shadowProvider = (index) => scheduler.recordForIndex(index);
    const stats = makeStats();

    // Two shadow-requesting statics; one slot: the closer one wins it, the
    // other falls back to the flood mask.
    const winner = registry.add(shadowLight(), 2, 60, 2);
    const loser = registry.add(shadowLight(), 30, 60, 30);

    grid.update(0, 60, 0, stats);
    scheduler.update(grid.selectedIndices, grid.selectedCount, 0, 60, 0, stats);
    // Simulate rendered faces so the packed record flips to "shadowed".
    const anyScheduler = scheduler as unknown as {
      slots: { staticPending: number; staticMask: number }[];
    };
    anyScheduler.slots[0].staticPending = 0;
    anyScheduler.slots[0].staticMask = 0b111111;
    grid.refreshShadowTexels(stats);

    const data = (grid as unknown as { lightData: Float32Array }).lightData;
    const winnerRank = [
      ...grid.selectedIndices.slice(0, grid.selectedCount),
    ].indexOf(indexOf(registry, winner));
    const loserRank = [
      ...grid.selectedIndices.slice(0, grid.selectedCount),
    ].indexOf(indexOf(registry, loser));
    expect(winnerRank).toBeGreaterThanOrEqual(0);
    expect(loserRank).toBeGreaterThanOrEqual(0);

    const winnerFlags = data[winnerRank * 24 + 7];
    const loserFlags = data[loserRank * 24 + 7];
    expect(winnerFlags & 4).toBe(4); // shadowed
    // The mask bit rides along on a static holder: the diffuse ladder
    // prefers the atlas, but the fluid specular pass occludes by the mask.
    expect(winnerFlags & 1).toBe(1);
    expect(loserFlags & 4).toBe(0);
    expect(loserFlags & 1).toBe(1); // graceful mask fallback
    expect(data[winnerRank * 24 + 16]).toBe(0); // slot id
    expect(data[winnerRank * 24 + 17]).toBe(0b111111); // static mask
    expect(data[loserRank * 24 + 16]).toBe(-1);
  });

  it("packs a dynamic shadow holder without the mask bit", () => {
    // A held light has no flood field of its own; masking its specular by
    // whatever flood happens to be around would kill legitimate glints in
    // unlit rooms, so only its diffuse occlusion (the atlas) applies.
    const registry = new LightSourceRegistry(16);
    const scheduler = makeScheduler(registry, 1);
    const grid = new LightClusterGrid(registry, {
      gridCellSize: 8,
      gridDims: [24, 12, 24],
      maxClusteredLights: 8,
      maxLightsPerCell: 8,
      analyticRadius: 64,
      selectionHysteresis: 1.2,
      maskKnee: 2 / 15,
      fluidSpecularStrength: 1,
    });
    grid.shadowProvider = (index) => scheduler.recordForIndex(index);
    const stats = makeStats();

    const held = registry.add(shadowLight({ isStatic: false }), 2, 60, 2);
    grid.update(0, 60, 0, stats);
    scheduler.update(grid.selectedIndices, grid.selectedCount, 0, 60, 0, stats);
    const anyScheduler = scheduler as unknown as {
      slots: { staticPending: number; staticMask: number }[];
    };
    anyScheduler.slots[0].staticPending = 0;
    anyScheduler.slots[0].staticMask = 0b111111;
    grid.refreshShadowTexels(stats);

    const data = (grid as unknown as { lightData: Float32Array }).lightData;
    const rank = [...grid.selectedIndices.slice(0, grid.selectedCount)].indexOf(
      indexOf(registry, held),
    );
    expect(rank).toBeGreaterThanOrEqual(0);
    const flags = data[rank * 24 + 7];
    expect(flags & 4).toBe(4); // shadowed
    expect(flags & 1).toBe(0); // no flood stand-in for a dynamic holder
  });
});

describe("emissive-face anchors", () => {
  it("derives the anchor from the strength-weighted hot faces", () => {
    // A torch: stick faces unlit, tip face at y=0.62 hot.
    const anchor = deriveEmissiveAnchor([
      {
        corners: [
          { pos: [0.4, 0, 0.4] },
          { pos: [0.6, 0, 0.4] },
          { pos: [0.4, 0.62, 0.4] },
          { pos: [0.6, 0.62, 0.4] },
        ],
      },
      {
        corners: [
          { pos: [0.4, 0.62, 0.4] },
          { pos: [0.6, 0.62, 0.4] },
          { pos: [0.4, 0.62, 0.6] },
          { pos: [0.6, 0.62, 0.6] },
        ],
        emissive: 2.5,
      },
    ]);
    expect(anchor).not.toBeNull();
    expect(anchor![0]).toBeCloseTo(0.5, 5);
    expect(anchor![1]).toBeCloseTo(0.62, 5);
    expect(anchor![2]).toBeCloseTo(0.5, 5);
  });

  it("keeps a fully emissive cube anchored at its center, clamped inside", () => {
    const corners = (y: number) => [
      { pos: [0, y, 0] as [number, number, number] },
      { pos: [1, y, 0] as [number, number, number] },
      { pos: [0, y, 1] as [number, number, number] },
      { pos: [1, y, 1] as [number, number, number] },
    ];
    const anchor = deriveEmissiveAnchor([
      { corners: corners(0), emissive: 2 },
      { corners: corners(1), emissive: 2 },
    ]);
    expect(anchor![1]).toBeCloseTo(0.5, 5);

    const top = deriveEmissiveAnchor([{ corners: corners(1), emissive: 2 }]);
    expect(top![1]).toBeCloseTo(0.98, 5); // clamped inside the voxel
  });

  it("returns null when nothing is emissive", () => {
    expect(
      deriveEmissiveAnchor([{ corners: [{ pos: [0.5, 0.5, 0.5] }] }]),
    ).toBeNull();
  });
});

describe("rotation-aware scan anchors", () => {
  const CHUNK_SIZE = 16;
  const MAX_HEIGHT = 64;
  const SUB_CHUNKS = 2;
  const MAX_LIGHT_LEVEL = 15;
  const PX_ROTATION_BITS = 2; // BlockRotation PX axis value

  const makeChunk = () => ({
    min: [0, 0, 0] as [number, number, number],
    voxels: { data: new Uint32Array(CHUNK_SIZE * CHUNK_SIZE * MAX_HEIGHT) },
  });

  const voxelIndex = (lx: number, ly: number, lz: number) =>
    lx * MAX_HEIGHT * CHUNK_SIZE + ly * CHUNK_SIZE + lz;

  const torchBlock = {
    id: 7,
    isLight: true,
    redLightLevel: 14,
    greenLightLevel: 9,
    blueLightLevel: 2,
    faces: [
      {
        corners: [
          { pos: [0.4, 0.62, 0.4] as [number, number, number] },
          { pos: [0.6, 0.62, 0.4] as [number, number, number] },
          { pos: [0.4, 0.62, 0.6] as [number, number, number] },
          { pos: [0.6, 0.62, 0.6] as [number, number, number] },
        ],
        emissive: 2.5,
      },
    ],
  };

  it("anchors an upright torch at its hot tip and a rotated one sideways", () => {
    const registry = new LightSourceRegistry(32);
    const tracker = new SectionTracker(
      registry,
      CHUNK_SIZE,
      MAX_HEIGHT,
      SUB_CHUNKS,
    );
    const table = new BlockProfileTable(
      [torchBlock],
      new Map(),
      MAX_LIGHT_LEVEL,
    );
    const chunk = makeChunk();

    // Upright torch at (2, 10, 3); PX-rotated torch at (5, 10, 3).
    chunk.voxels.data[voxelIndex(2, 10, 3)] = 7;
    chunk.voxels.data[voxelIndex(5, 10, 3)] = 7 | (PX_ROTATION_BITS << 16);

    tracker.rescanSection("0,0,0", chunk, 0, table);
    expect(registry.aliveCount).toBe(2);

    const positions: [number, number, number][] = [];
    for (let n = 0; n < registry.aliveCount; n++) {
      const index = registry.aliveIndices[n];
      positions.push([
        registry.positions[index * 3],
        registry.positions[index * 3 + 1],
        registry.positions[index * 3 + 2],
      ]);
    }
    positions.sort((a, b) => a[0] - b[0]);

    // Upright: anchored at the tip, above center.
    expect(positions[0][0]).toBeCloseTo(2.5, 4);
    expect(positions[0][1]).toBeCloseTo(10.62, 4);
    expect(positions[0][2]).toBeCloseTo(3.5, 4);

    // PX rotation swings the tip toward +X: x offset becomes the old y.
    expect(positions[1][0]).toBeCloseTo(5.62, 4);
    expect(positions[1][1]).toBeCloseTo(10.5, 4);
    expect(positions[1][2]).toBeCloseTo(3.5, 4);
  });

  it("re-anchors when a block is rotated in place (same id)", () => {
    const registry = new LightSourceRegistry(32);
    const tracker = new SectionTracker(
      registry,
      CHUNK_SIZE,
      MAX_HEIGHT,
      SUB_CHUNKS,
    );
    const table = new BlockProfileTable(
      [torchBlock],
      new Map(),
      MAX_LIGHT_LEVEL,
    );
    const chunk = makeChunk();
    chunk.voxels.data[voxelIndex(2, 10, 3)] = 7;
    tracker.rescanSection("0,0,0", chunk, 0, table);
    const before = registry.positions[registry.aliveIndices[0] * 3 + 1];
    expect(before).toBeCloseTo(10.62, 4);

    chunk.voxels.data[voxelIndex(2, 10, 3)] = 7 | (PX_ROTATION_BITS << 16);
    tracker.rescanSection("0,0,0", chunk, 0, table);
    expect(registry.aliveCount).toBe(1);
    const index = registry.aliveIndices[0];
    expect(registry.positions[index * 3]).toBeCloseTo(2.62, 4);
    expect(registry.positions[index * 3 + 1]).toBeCloseTo(10.5, 4);
  });

  it("rescans a rotated-in-place block through the facade's edit path", () => {
    // The world hands the facade raw voxel words. Rotating a torch changes
    // only the rotation bits — same block id — and must still queue the
    // section rescan that re-anchors its light (regression: the old
    // id-equality early-out dropped exactly this edit).
    const lights = new LocalLights(
      {},
      () => ({
        chunkSize: CHUNK_SIZE,
        maxHeight: MAX_HEIGHT,
        subChunks: SUB_CHUNKS,
        maxLightLevel: MAX_LIGHT_LEVEL,
      }),
      () => [torchBlock],
    );
    const chunk = makeChunk();
    chunk.voxels.data[voxelIndex(2, 10, 3)] = 7;
    lights.handleChunkLoaded(0, 0, chunk);
    const camera = new Vector3(2, 10, 3);
    for (let n = 0; n < 4; n++) lights.update(camera);
    expect(lights.registry.aliveCount).toBe(1);
    let index = lights.registry.aliveIndices[0];
    expect(lights.registry.positions[index * 3 + 1]).toBeCloseTo(10.62, 4);

    const oldValue = 7;
    const newValue = 7 | (PX_ROTATION_BITS << 16);
    chunk.voxels.data[voxelIndex(2, 10, 3)] = newValue;
    lights.handleBlockUpdate({ voxel: [2, 10, 3], oldValue, newValue, chunk });
    for (let n = 0; n < 4; n++) lights.update(camera);

    expect(lights.registry.aliveCount).toBe(1);
    index = lights.registry.aliveIndices[0];
    expect(lights.registry.positions[index * 3]).toBeCloseTo(2.62, 4);
    expect(lights.registry.positions[index * 3 + 1]).toBeCloseTo(10.5, 4);
    lights.dispose();
  });
});

describe("moving-light shadow scheduling", () => {
  const makeMockRenderer = () => {
    const renders: { scene: unknown }[] = [];
    let target: unknown = null;
    const renderer = {
      getRenderTarget: () => target,
      setRenderTarget: (t: unknown) => {
        target = t;
      },
      clear: () => {},
      render: (scene: unknown) => {
        renders.push({ scene });
      },
    } as unknown as WebGLRenderer;
    return { renders, renderer };
  };

  it("reserves only the work the frame will render, and keeps an idle held light's caster shadows live", () => {
    const registry = new LightSourceRegistry(16);
    const scheduler = makeScheduler(registry);
    const stats = makeStats();

    const held = registry.add(shadowLight({ isStatic: false }), 4, 60, 4);
    scheduler.update(selectionOf(registry, [held]), 1, 0, 60, 0, stats);

    // Fresh slot: all six world faces pending, so six dynamic units.
    expect(scheduler.estimateDynamicDemand()).toBe(6);

    const entity = new Object3D();
    entity.position.set(9, 60, 4); // squarely in the +X face
    const scene = new Scene();
    const ledger = new ShadowFrameLedger();
    const { renders, renderer } = makeMockRenderer();

    ledger.beginFrame(100);
    scheduler.render(renderer, scene, ledger, [entity], undefined, [], stats);
    // Six world-only refreshes into the static cells plus one entity
    // overlay: the caster is never baked into the cached world depth.
    expect(renders.filter((r) => r.scene === scene).length).toBe(6);
    expect(renders.length - 6).toBe(1);
    expect(stats.shadowFacesDynamic).toBe(7);

    // Idle light (no movement): the reservation shrinks to the overlay
    // face a caster actually stands in — and to zero without casters.
    scheduler.update(selectionOf(registry, [held]), 1, 0, 60, 0, stats);
    expect(scheduler.estimateDynamicDemand([entity])).toBe(1);
    expect(scheduler.estimateDynamicDemand()).toBe(0);

    renders.length = 0;
    ledger.beginFrame(100);
    scheduler.render(renderer, scene, ledger, [entity], undefined, [], stats);
    // The overlay re-renders every frame while the caster stands there
    // (live shadow, not a frozen imprint); the world cache is untouched.
    expect(renders.filter((r) => r.scene === scene).length).toBe(0);
    expect(renders.length).toBe(1);

    // The caster leaves: the overlay clears and nothing renders at all.
    entity.position.set(200, 60, 200);
    renders.length = 0;
    ledger.beginFrame(100);
    scheduler.render(renderer, scene, ledger, [entity], undefined, [], stats);
    expect(renders.length).toBe(0);
    expect(scheduler.estimateDynamicDemand([entity])).toBe(0);
  });

  it("never defers CSM far cascades for an idle held light", () => {
    const registry = new LightSourceRegistry(16);
    const scheduler = makeScheduler(registry);
    const stats = makeStats();
    const ledger = new ShadowFrameLedger(2);

    const held = registry.add(shadowLight({ isStatic: false }), 4, 60, 4);
    scheduler.update(selectionOf(registry, [held]), 1, 0, 60, 0, stats);
    // Drain the initial refresh so the light reads as idle.
    const anyScheduler = scheduler as unknown as {
      slots: { staticPending: number; staticMask: number }[];
    };
    anyScheduler.slots[0].staticPending = 0;
    anyScheduler.slots[0].staticMask = 0b111111;

    // The old estimate reserved six units for the idle light every frame,
    // squeezing far cascades into their deferral path forever.
    for (let frame = 0; frame < 6; frame++) {
      ledger.beginFrame(12);
      const demand = scheduler.estimateDynamicDemand();
      if (demand > 0) ledger.reserveDynamic(demand);
      ledger.chargeCsmNear(4);
      expect(ledger.requestCsmFar(6)).toBe(true);
    }
    expect(ledger.frameStats.csmFarDenied).toBe(0);
    expect(ledger.frameStats.csmFarForced).toBe(0);
  });

  it("tests spot overlay casters against the cone aim, not the +X cube face", () => {
    const registry = new LightSourceRegistry(16);
    const scheduler = makeScheduler(registry);
    const stats = makeStats();

    // Spot at the origin aiming -Z. Its one face renders along the cone,
    // so the caster test must follow the aim (regression: it used the
    // cube-face +X axis, skipping casters in the beam and opening overlay
    // faces for casters beside the light).
    const spot = registry.add(
      shadowLight({
        shape: "spot",
        direction: [0, 0, -1],
        angleDeg: 60,
        isStatic: false,
      }),
      4,
      60,
      4,
    );
    scheduler.update(selectionOf(registry, [spot]), 1, 0, 60, 0, stats);
    const anyScheduler = scheduler as unknown as {
      slots: { staticPending: number }[];
    };
    anyScheduler.slots[0].staticPending = 0; // idle: only overlay demand left

    const inBeam = new Object3D();
    inBeam.position.set(4, 60, -2);
    const besideLight = new Object3D();
    besideLight.position.set(9, 60, 4);

    expect(scheduler.estimateDynamicDemand([inBeam])).toBe(1);
    expect(scheduler.estimateDynamicDemand([besideLight])).toBe(0);
  });

  it("requeues cached spot faces when the cone rotates or widens", () => {
    const registry = new LightSourceRegistry(16);
    const scheduler = makeScheduler(registry);
    const stats = makeStats();

    const spot = registry.add(
      shadowLight({ shape: "spot", direction: [1, 0, 0], angleDeg: 60 }),
      4,
      60,
      4,
    );
    scheduler.update(selectionOf(registry, [spot]), 1, 0, 60, 0, stats);
    const anyScheduler = scheduler as unknown as {
      slots: {
        staticPending: number;
        staticMask: number;
        allowedMask: number;
        tanHalf: number;
      }[];
    };
    expect(anyScheduler.slots[0].allowedMask).toBe(0b1); // spots use one face
    anyScheduler.slots[0].staticPending = 0;
    anyScheduler.slots[0].staticMask = 0b1;

    // An unrelated frame leaves the warm cache alone…
    scheduler.update(selectionOf(registry, [spot]), 1, 0, 60, 0, stats);
    expect(anyScheduler.slots[0].staticPending).toBe(0);

    // …but rotating the cone requeues the face: the cached map still aims
    // the old way and would shadow the wrong geometry.
    registry.setDirection(spot, 0, 0, 1);
    scheduler.update(selectionOf(registry, [spot]), 1, 0, 60, 0, stats);
    expect(anyScheduler.slots[0].staticPending).toBe(0b1);
    expect(
      scheduler.invalidationLog[scheduler.invalidationLog.length - 1]?.cause,
    ).toBe("lightRotated");
  });
});

describe("fluid specular occlusion (shader source)", () => {
  it("masks specular by the flood term and wires the flood through the call site", () => {
    expect(LOCAL_LIGHTS_FUNCTIONS).toContain(
      "vec3 localLightSpecular(vec3 llPos, vec3 llNormal, vec3 llViewDir, vec3 llFlood)",
    );
    const specularBody = LOCAL_LIGHTS_FUNCTIONS.slice(
      LOCAL_LIGHTS_FUNCTIONS.indexOf("vec3 localLightSpecular"),
    );
    expect(specularBody).toContain("uLocalMaskKnee");
    expect(specularBody).toContain("llOcclusion");
    expect(SHADER_LIGHTING_FLUID_CHUNK_SHADERS.fragment).toContain(
      "localLightSpecular(wPos, waterNormal, viewDir, vLight.rgb)",
    );
  });
});
