import { ChunkProtocol } from "@voxelize/protocol";
import { Material, Mesh, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";

import { Coords2 } from "../../types";

import {
  LodChunkManager,
  LodChunkManagerHost,
  lodLevelForDistance,
  lodRegionKey,
  lodRegionSideInChunks,
  resolveLodTarget,
} from "./chunk-lod";

describe("lodLevelForDistance", () => {
  it("maps distance to geometric rings around the render radius", () => {
    const R = 8;
    expect(lodLevelForDistance(0, R, 3)).toBe(0);
    expect(lodLevelForDistance(8, R, 3)).toBe(0);
    expect(lodLevelForDistance(8.5, R, 3)).toBe(1);
    expect(lodLevelForDistance(16, R, 3)).toBe(1);
    expect(lodLevelForDistance(16.5, R, 3)).toBe(2);
    expect(lodLevelForDistance(32, R, 3)).toBe(2);
    expect(lodLevelForDistance(33, R, 3)).toBe(3);
    expect(lodLevelForDistance(64, R, 3)).toBe(3);
    expect(lodLevelForDistance(64.5, R, 3)).toBeNull();
  });

  it("caps at the configured max level", () => {
    expect(lodLevelForDistance(100, 8, 1)).toBeNull();
    expect(lodLevelForDistance(16, 8, 1)).toBe(1);
  });
});

describe("resolveLodTarget hysteresis", () => {
  const R = 8;
  const MAX = 2;
  const H = 1;

  it("keeps the current level inside the widened ring band", () => {
    // A chunk displayed at LOD 1 (ring 8..16) stays LOD 1 anywhere in
    // (7, 17], so hovering exactly on a boundary never thrashes.
    expect(resolveLodTarget(7.5, 1, R, MAX, H)).toBe(1);
    expect(resolveLodTarget(16.9, 1, R, MAX, H)).toBe(1);
    expect(resolveLodTarget(7.5, 0, R, MAX, H)).toBe(0);
    expect(resolveLodTarget(16.9, 2, R, MAX, H)).toBe(2);
  });

  it("switches once the band is left", () => {
    expect(resolveLodTarget(6.9, 1, R, MAX, H)).toBe(0);
    expect(resolveLodTarget(17.1, 1, R, MAX, H)).toBe(2);
    expect(resolveLodTarget(33.1, 2, R, MAX, H)).toBeNull();
  });

  it("is stable under oscillation across a boundary", () => {
    // Walk back and forth across the 0/1 boundary at 8 chunks: the level
    // computed from the previous level must never flip on sub-band moves.
    let level: number | null = 0;
    for (const distance of [7.8, 8.2, 7.9, 8.4, 7.7, 8.6]) {
      const next = resolveLodTarget(distance, level, R, MAX, H);
      expect(next).toBe(0);
      level = next;
    }
  });

  it("assigns fresh chunks their ring level directly", () => {
    expect(resolveLodTarget(12, null, R, MAX, H)).toBe(1);
    expect(resolveLodTarget(20, null, R, MAX, H)).toBe(2);
    expect(resolveLodTarget(40, null, R, MAX, H)).toBeNull();
  });
});

describe("lod regions", () => {
  it("doubles region side with level for constant per-ring draw calls", () => {
    expect(lodRegionSideInChunks(1)).toBe(8);
    expect(lodRegionSideInChunks(2)).toBe(16);
    expect(lodRegionSideInChunks(3)).toBe(32);
  });

  it("buckets chunk coords into level-scoped regions", () => {
    expect(lodRegionKey(0, 0, 1)).toBe("1|0,0");
    expect(lodRegionKey(7, 7, 1)).toBe("1|0,0");
    expect(lodRegionKey(8, 0, 1)).toBe("1|1,0");
    expect(lodRegionKey(-1, -1, 1)).toBe("1|-1,-1");
    expect(lodRegionKey(8, 0, 2)).toBe("2|0,0");
  });
});

type HostLog = {
  requested: [number, number, number][][];
  unloaded: Coords2[][];
  disposedFull: Coords2[];
  revealedFull: Coords2[];
  refreshedFull: Coords2[];
};

function makeHost(overrides: Partial<LodChunkManagerHost> = {}): {
  host: LodChunkManagerHost;
  log: HostLog;
} {
  const log: HostLog = {
    requested: [],
    unloaded: [],
    disposedFull: [],
    revealedFull: [],
    refreshedFull: [],
  };

  const material = new MeshBasicMaterial() as Material;

  const host: LodChunkManagerHost = {
    chunkSize: 16,
    renderRadius: () => 4,
    resolveMaterial: () => ({ key: "default", material }),
    configureTransparentMesh: () => undefined,
    requestLodChunks: (requests) => log.requested.push(requests),
    unloadChunks: (coords) => log.unloaded.push(coords),
    isWithinWorld: () => true,
    isFullChunkActive: () => false,
    disposeFullChunk: (cx, cz) => log.disposedFull.push([cx, cz]),
    setFullChunkVisible: (cx, cz, isVisible) => {
      if (isVisible) log.revealedFull.push([cx, cz]);
    },
    refreshFullChunk: (cx, cz) => log.refreshedFull.push([cx, cz]),
    ...overrides,
  };

  return { host, log };
}

function makeManager(
  overrides: Partial<LodChunkManagerHost> = {},
  options: Partial<{
    maxLodLevel: number;
    maxRegionRebuildsPerUpdate: number;
    regionRebuildCooldown: number;
  }> = {},
) {
  const { host, log } = makeHost(overrides);
  const manager = new LodChunkManager(host, {
    maxLodLevel: 2,
    hysteresis: 1,
    maxRequestsPerUpdate: 512,
    rerequestInterval: 300,
    maxLodRadius: 96,
    // Unthrottled by default so single-update expectations stay simple; the
    // budget and cooldown behaviors have dedicated tests.
    maxRegionRebuildsPerUpdate: 64,
    regionRebuildCooldown: 0,
    ...options,
  });
  return { manager, log };
}

function lodProtocol(
  cx: number,
  cz: number,
  lod: number,
  quads = 1,
): ChunkProtocol {
  const positions = new Float32Array(quads * 12);
  const indices = new Uint32Array(quads * 6);
  for (let quad = 0; quad < quads; quad++) {
    const base = quad * 4;
    indices.set(
      [base, base + 1, base + 2, base + 2, base + 1, base + 3],
      quad * 6,
    );
  }

  return {
    id: `${cx},${cz}`,
    x: cx,
    z: cz,
    voxels: new Uint32Array(),
    lights: new Uint32Array(),
    meshes: [
      {
        level: 0,
        lod,
        geometries: [
          {
            voxel: 1,
            positions,
            indices,
            uvs: new Float32Array(quads * 8),
            lights: new Uint32Array(quads * 4),
          },
        ],
      },
    ],
  };
}

describe("LodChunkManager", () => {
  it("requests ring chunks nearest-first and skips the full-detail disc", () => {
    const { manager, log } = makeManager();

    manager.update([0, 0]);

    expect(log.requested.length).toBeGreaterThan(0);
    const requests = log.requested.flat();

    for (const [cx, cz, level] of requests) {
      const distance = Math.sqrt(cx * cx + cz * cz);
      expect(distance).toBeGreaterThan(4);
      expect(level).toBe(lodLevelForDistance(distance, 4, 2));
    }

    // Nearest-first ordering across the whole candidate list.
    const distances = requests.map(([cx, cz]) => Math.sqrt(cx * cx + cz * cz));
    const sorted = [...distances].sort((a, b) => a - b);
    expect(distances).toEqual(sorted);
  });

  it("displays arrived meshes in level-scoped regions", () => {
    const { manager } = makeManager();

    manager.update([0, 0]);
    manager.onLodChunk(lodProtocol(6, 0, 1));
    manager.onLodChunk(lodProtocol(7, 0, 1));
    manager.onLodChunk(lodProtocol(10, 0, 2));
    manager.update([0, 0]);

    expect(manager.displayedCount).toBe(3);

    const meshes: Mesh[] = [];
    manager.group.traverse((object) => {
      if ((object as Mesh).isMesh) meshes.push(object as Mesh);
    });

    // 6,0 and 7,0 share a level-1 region; 10,0 lives in a level-2 region.
    expect(meshes).toHaveLength(2);

    const merged = meshes.find((mesh) => mesh.userData.lodLevel === 1) as Mesh;
    const positionCount = merged.geometry.getAttribute("position").array.length;
    expect(positionCount).toBe(2 * 12);
  });

  it("strips the water-optics flag from LOD fluid geometry", () => {
    const fluidBit = 1 << 18;
    const waveBit = 1 << 20;
    const { manager } = makeManager({
      resolveMaterial: () => ({
        key: "water::lod-fluid",
        material: new MeshBasicMaterial() as Material,
        isLodFluid: true,
      }),
    });

    const protocol = lodProtocol(6, 0, 1);
    protocol.meshes[0].geometries[0].lights.set(
      [fluidBit | waveBit | 0xfff, fluidBit, waveBit, 0],
      0,
    );

    manager.update([0, 0]);
    manager.onLodChunk(protocol);
    manager.update([0, 0]);

    const meshes: Mesh[] = [];
    manager.group.traverse((object) => {
      if ((object as Mesh).isMesh) meshes.push(object as Mesh);
    });
    expect(meshes).toHaveLength(1);

    const lights = meshes[0].geometry.getAttribute("light").array as Int32Array;
    const levelBits = 1 << 21;
    expect(lights[0]).toBe(waveBit | 0xfff | levelBits);
    expect(lights[1]).toBe(levelBits);
    expect(lights[2]).toBe(waveBit | levelBits);
    expect(lights[3]).toBe(levelBits);
  });

  it("stamps the region LOD level into the merged light attribute", () => {
    const { manager } = makeManager();

    const protocol = lodProtocol(10, 0, 2);
    protocol.meshes[0].geometries[0].lights.set([0xf0f0, 0x0f0f, 7, 0], 0);

    manager.update([0, 0]);
    manager.onLodChunk(protocol);
    manager.update([0, 0]);

    const meshes: Mesh[] = [];
    manager.group.traverse((object) => {
      if ((object as Mesh).isMesh) meshes.push(object as Mesh);
    });
    expect(meshes).toHaveLength(1);

    const lights = meshes[0].geometry.getAttribute("light").array as Int32Array;
    const levelBits = 2 << 21;
    expect(lights[0]).toBe(0xf0f0 | levelBits);
    expect(lights[1]).toBe(0x0f0f | levelBits);
    expect(lights[2]).toBe(7 | levelBits);
    expect(lights[3]).toBe(levelBits);
  });

  it("offsets merged chunk geometry by chunk world position", () => {
    const { manager } = makeManager();

    const protocol = lodProtocol(6, 0, 1);
    protocol.meshes[0].geometries[0].positions.set([1, 2, 3], 0);

    manager.update([0, 0]);
    manager.onLodChunk(protocol);
    manager.update([0, 0]);

    const meshes: Mesh[] = [];
    manager.group.traverse((object) => {
      if ((object as Mesh).isMesh) meshes.push(object as Mesh);
    });
    expect(meshes).toHaveLength(1);

    const positions = meshes[0].geometry.getAttribute("position")
      .array as Float32Array;
    expect(positions[0]).toBe(1 + 6 * 16);
    expect(positions[1]).toBe(2);
    expect(positions[2]).toBe(3);
  });

  it("swaps LOD levels atomically when a replacement level arrives", () => {
    const { manager } = makeManager();

    manager.update([0, 0]);
    manager.onLodChunk(lodProtocol(6, 0, 1));
    manager.update([0, 0]);
    manager.onLodChunk(lodProtocol(6, 0, 2));
    manager.update([0, 0]);

    expect(manager.displayedCount).toBe(1);

    const levels: number[] = [];
    manager.group.traverse((object) => {
      if ((object as Mesh).isMesh) {
        levels.push((object as Mesh).userData.lodLevel);
      }
    });
    expect(levels).toEqual([2]);
  });

  it("disposes the full form only after its LOD replacement displays", () => {
    const fullActive = new Set(["6,0"]);
    const { manager, log } = makeManager({
      isFullChunkActive: (cx, cz) => fullActive.has(`${cx},${cz}`),
    });

    manager.update([0, 0]);
    expect(log.disposedFull).toHaveLength(0);

    manager.onLodChunk(lodProtocol(6, 0, 1));
    manager.update([0, 0]);

    expect(log.disposedFull).toEqual([[6, 0]]);
    expect(manager.hasDisplayedForm(6, 0)).toBe(true);
  });

  it("retires the LOD form and reveals the full chunk when displayable", () => {
    const { manager, log } = makeManager();

    manager.update([0, 0]);
    manager.onLodChunk(lodProtocol(6, 0, 1));
    manager.update([0, 0]);
    expect(manager.hasDisplayedForm(6, 0)).toBe(true);

    manager.onFullChunkDisplayable(6, 0);
    manager.update([0, 0]);

    expect(manager.hasDisplayedForm(6, 0)).toBe(false);
    expect(log.revealedFull).toEqual([[6, 0]]);

    let meshCount = 0;
    manager.group.traverse((object) => {
      if ((object as Mesh).isMesh) meshCount++;
    });
    expect(meshCount).toBe(0);
  });

  it("discards stale LOD arrivals for chunks back inside the full ring", () => {
    const { manager, log } = makeManager({
      isFullChunkActive: (cx, cz) => cx === 2 && cz === 0,
    });

    manager.update([0, 0]);
    manager.onLodChunk(lodProtocol(2, 0, 1));
    manager.update([0, 0]);

    expect(manager.hasDisplayedForm(2, 0)).toBe(false);
    expect(log.disposedFull).toHaveLength(0);
    expect(log.refreshedFull).toEqual([[2, 0]]);
  });

  it("unloads chunks beyond the LOD horizon", () => {
    const { manager, log } = makeManager();

    manager.update([0, 0]);
    manager.onLodChunk(lodProtocol(6, 0, 1));
    manager.update([0, 0]);
    expect(manager.displayedCount).toBe(1);

    // Teleport far away: the chunk leaves the scan window entirely.
    manager.update([1000, 1000]);

    expect(manager.displayedCount).toBe(0);
    expect(log.unloaded.flat()).toContainEqual([6, 0]);
  });

  it("keeps chunks in the full-detail disc out of its ownership", () => {
    const { manager } = makeManager();
    manager.update([0, 0]);
    expect(manager.owns(0, 0)).toBe(false);
    expect(manager.owns(2, 2)).toBe(false);
  });
});

describe("LodChunkManager rebuild throttling", () => {
  const countMeshes = (manager: LodChunkManager) => {
    let count = 0;
    manager.group.traverse((object) => {
      if ((object as Mesh).isMesh) count++;
    });
    return count;
  };

  it("rebuilds at most the budgeted number of regions per update, nearest first", () => {
    const { manager } = makeManager({}, { maxRegionRebuildsPerUpdate: 1 });

    manager.update([0, 0]);
    // Two different level-1 regions: chunks at x=6 (region 0) and x=9
    // (region 1, farther from center).
    manager.onLodChunk(lodProtocol(6, 0, 1));
    manager.onLodChunk(lodProtocol(9, 0, 1));

    manager.update([0, 0]);
    expect(countMeshes(manager)).toBe(1);

    manager.update([0, 0]);
    expect(countMeshes(manager)).toBe(2);
  });

  it("batches repeated arrivals into one rebuild per cooldown window", () => {
    const { manager } = makeManager(
      {},
      { maxRegionRebuildsPerUpdate: 64, regionRebuildCooldown: 5 },
    );

    manager.update([0, 0]);
    manager.onLodChunk(lodProtocol(6, 0, 1));
    manager.update([0, 0]);
    expect(countMeshes(manager)).toBe(1);
    const firstMesh = manager.group.children[0].children[0];

    // A second arrival into the same region within the cooldown must not
    // trigger an immediate re-merge...
    manager.onLodChunk(lodProtocol(7, 0, 1));
    manager.update([0, 0]);
    expect(manager.group.children[0].children[0]).toBe(firstMesh);

    // ...but once the cooldown elapses the region re-merges with both.
    for (let i = 0; i < 5; i++) manager.update([0, 0]);
    const rebuilt = manager.group.children[0].children[0] as Mesh;
    expect(rebuilt).not.toBe(firstMesh);
    expect(rebuilt.geometry.getAttribute("position").count).toBe(8);
  });

  it("defers full-chunk disposal until the LOD region actually re-merged", () => {
    const fullActive = new Set(["9,0"]);
    const { manager, log } = makeManager(
      { isFullChunkActive: (cx, cz) => fullActive.has(`${cx},${cz}`) },
      { maxRegionRebuildsPerUpdate: 1 },
    );

    manager.update([0, 0]);
    // Nearer region (chunk 6,0) competes for the single-slot budget with the
    // demote replacement for chunk (9,0) in the farther region.
    manager.onLodChunk(lodProtocol(6, 0, 1));
    manager.onLodChunk(lodProtocol(9, 0, 1));

    manager.update([0, 0]);
    expect(log.disposedFull).toHaveLength(0);

    manager.update([0, 0]);
    expect(log.disposedFull).toEqual([[9, 0]]);
  });

  it("defers the full-chunk reveal until the LOD form left the scene", () => {
    const { manager, log } = makeManager({}, { maxRegionRebuildsPerUpdate: 1 });

    manager.update([0, 0]);
    manager.onLodChunk(lodProtocol(9, 0, 1));
    manager.update([0, 0]);
    expect(manager.hasDisplayedForm(9, 0)).toBe(true);

    // Retire the LOD form while a nearer region hogs the rebuild budget.
    manager.onLodChunk(lodProtocol(6, 0, 1));
    manager.onFullChunkDisplayable(9, 0);

    manager.update([0, 0]);
    expect(log.revealedFull).toHaveLength(0);

    manager.update([0, 0]);
    expect(log.revealedFull).toEqual([[9, 0]]);
  });
});
