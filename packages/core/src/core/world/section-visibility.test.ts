import { Matrix4, PerspectiveCamera, Vector3 } from "three/webgpu";
import { describe, expect, it } from "vitest";

import {
  CONNECTIVITY_FULL,
  isEyeInOpaqueVoxel,
  nearPlaneReach,
  SectionVisibilityGraph,
} from "./section-visibility";

const CHUNK_SIZE = 16;
const MAX_HEIGHT = 64;
const SUB_CHUNKS = 4;

const pairBit = (a: number, b: number) => {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const offset = (lo * (2 * 6 - lo - 1)) / 2;
  return 1 << (offset + (hi - lo - 1));
};

const makeGraph = () =>
  new SectionVisibilityGraph({
    subChunks: SUB_CHUNKS,
    chunkSize: CHUNK_SIZE,
    maxHeight: MAX_HEIGHT,
  });

/**
 * A camera at `position` looking down +X with a wide FOV, so the whole strip
 * of chunks along +X sits inside the frustum.
 */
const walk = (
  graph: SectionVisibilityGraph,
  position: Vector3,
  fogFar = Infinity,
) => {
  const camera = new PerspectiveCamera(90, 1, 0.1, 10_000);
  camera.position.copy(position);
  camera.lookAt(position.x + 100, position.y, position.z);
  camera.updateMatrixWorld();
  const matrix = new Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  graph.walk(position, matrix, fogFar);
};

describe("SectionVisibilityGraph", () => {
  it("hides the whole wedge behind a chunk with no node, even across open air", () => {
    // Three open rows along +X; chunk (2, 0) has no node. A walk never turns
    // back, so no path reaches (4, 0) around the gap: open terrain in plain
    // view is culled until the hole's own chunk arrives.
    const graph = makeGraph();
    for (let cx = 0; cx <= 4; cx++) {
      for (let cz = -1; cz <= 1; cz++) {
        if (cx === 2 && cz === 0) continue;
        graph.addChunk(cx, cz);
      }
    }
    walk(graph, new Vector3(8, 8, 8));
    expect(graph.isComplete).toBe(true);
    expect(graph.isSectionVisible(4, 0, 0)).toBe(false);
    expect(graph.isSectionVisible(3, 0, 0)).toBe(false);

    // A placeholder for the requested chunk (a node with no connectivity
    // yet) is walked through like air, so nothing behind a hole is hidden.
    graph.addChunk(2, 0);
    walk(graph, new Vector3(8, 8, 8));
    expect(graph.isSectionVisible(3, 0, 0)).toBe(true);
    expect(graph.isSectionVisible(4, 0, 0)).toBe(true);
  });

  it("keeps a placeholder open until the chunk's real connectivity lands", () => {
    const graph = makeGraph();
    for (let cx = 0; cx <= 3; cx++) graph.addChunk(cx, 0);
    walk(graph, new Vector3(8, 8, 8));
    expect(graph.isSectionVisible(3, 0, 0)).toBe(true);

    // Once meshed, a sealed section does occlude what is behind it.
    for (let level = 0; level < SUB_CHUNKS; level++) {
      graph.setConnectivity(1, 0, level, 0);
    }
    walk(graph, new Vector3(8, 8, 8));
    expect(graph.isSectionVisible(3, 0, 0)).toBe(false);
  });

  it("steps aside for frustum-only culling while suspended (a noclip eye in rock)", () => {
    const graph = makeGraph();
    for (let cx = 0; cx <= 4; cx++) {
      graph.addChunk(cx, 0);
      for (let level = 0; level < SUB_CHUNKS; level++)
        graph.setConnectivity(cx, 0, level, 0);
    }
    const camera = new PerspectiveCamera(90, 1, 0.1, 1000);
    for (const x of [8, 15.9, 16.1, 31.9, 32.1]) {
      camera.position.set(x, 8, 8);
      camera.lookAt(80, 8, 8);
      camera.updateMatrixWorld();
      const matrix = new Matrix4().multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      );
      graph.walk(camera.position, matrix, Infinity, true);
      expect(graph.isComplete).toBe(false);
      expect(graph.isSectionVisible(4, 0, 0)).toBe(true);
    }
    walk(graph, new Vector3(8, 8, 8));
    expect(graph.isComplete).toBe(true);
    expect(graph.isSectionVisible(4, 0, 0)).toBe(false);
  });
  it("matches the Rust pair-bit layout: all fifteen pairs fill 0x7FFF", () => {
    let all = 0;
    for (let a = 0; a < 6; a++) {
      for (let b = a + 1; b < 6; b++) {
        all |= pairBit(a, b);
      }
    }
    expect(all).toBe(CONNECTIVITY_FULL);
  });

  it("sees through open sections and stops at a sealed one", () => {
    const graph = makeGraph();
    for (let cx = 0; cx <= 4; cx++) graph.addChunk(cx, 0);

    // Seal every level of the column at cx=2.
    for (let level = 0; level < SUB_CHUNKS; level++) {
      graph.setConnectivity(2, 0, level, 0);
    }

    walk(graph, new Vector3(8, 8, 8));

    expect(graph.isComplete).toBe(true);
    expect(graph.isSectionVisible(1, 0, 0)).toBe(true);
    // The wall itself is reached (its near face is visible)...
    expect(graph.isSectionVisible(2, 0, 0)).toBe(true);
    // ...but nothing behind it is, not even as a shadow caster.
    expect(graph.isSectionVisible(3, 0, 0)).toBe(false);
    expect(graph.isSectionVisible(4, 0, 0)).toBe(false);
    expect(graph.isSectionReached(3, 0, 0)).toBe(false);
    expect(graph.isSectionReached(4, 0, 0)).toBe(false);
  });

  it("routes around a wall through connected sections", () => {
    const graph = makeGraph();
    for (let cx = 0; cx <= 4; cx++) graph.addChunk(cx, 0);

    // The wall at cx=2 is sealed at the camera's level but open above:
    // level 1 connects -X to +X, and the columns on both sides connect
    // vertically, so the walk can climb over.
    graph.setConnectivity(2, 0, 0, 0);
    graph.setConnectivity(2, 0, 1, pairBit(0, 1));

    walk(graph, new Vector3(8, 8, 8));

    expect(graph.isSectionVisible(3, 0, 1)).toBe(true);
    // Sodium's no-backtrack rule: the path over the wall traveled +Y, so it
    // may not turn back -Y behind it. Deliberate over-cull, matching Sodium.
    expect(graph.isSectionVisible(3, 0, 0)).toBe(false);
  });

  it("cannot pass through a section whose entry face does not connect", () => {
    const graph = makeGraph();
    for (let cx = 0; cx <= 3; cx++) graph.addChunk(cx, 0);

    // cx=2 level 0 connects only -Y to +Y: enterable from -X (it is adjacent
    // and reached), but its -X face pairs with nothing, so the walk cannot
    // continue to +X.
    graph.setConnectivity(2, 0, 0, pairBit(2, 3));
    // Seal the other levels of the wall column so nothing routes over it.
    for (let level = 1; level < SUB_CHUNKS; level++) {
      graph.setConnectivity(2, 0, level, 0);
    }

    walk(graph, new Vector3(8, 8, 8));

    expect(graph.isSectionVisible(2, 0, 0)).toBe(true);
    expect(graph.isSectionVisible(3, 0, 0)).toBe(false);
  });

  it("reports incomplete when the camera stands outside the graph", () => {
    const graph = makeGraph();
    graph.addChunk(5, 5);

    walk(graph, new Vector3(8, 8, 8));

    expect(graph.isComplete).toBe(false);
    expect(graph.isSectionVisible(5, 5, 0)).toBe(true);
  });

  it("fog-culls sections wholly past the far edge", () => {
    const graph = makeGraph();
    for (let cx = 0; cx <= 8; cx++) graph.addChunk(cx, 0);

    walk(graph, new Vector3(8, 8, 8), 40);

    expect(graph.isSectionVisible(2, 0, 0)).toBe(true);
    expect(graph.isSectionVisible(8, 0, 0)).toBe(false);
    // Fog prunes visibility, never the walk: the far section stays reached.
    expect(graph.isSectionReached(8, 0, 0)).toBe(true);
  });

  it("keeps sections visible after their chunk unloads mid-walk history", () => {
    const graph = makeGraph();
    for (let cx = 0; cx <= 2; cx++) graph.addChunk(cx, 0);
    walk(graph, new Vector3(8, 8, 8));

    graph.removeChunk(1, 0);

    // Unknown sections must never be claimed hidden.
    expect(graph.isSectionVisible(1, 0, 0)).toBe(true);
  });

  it("keeps columns on both sides of zero apart, and counts what unloads", () => {
    const graph = makeGraph();
    const columns: [number, number][] = [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [-12, 7],
    ];
    for (const [cx, cz] of columns) graph.addChunk(cx, cz);
    expect(graph.sectionCount).toBe(columns.length * SUB_CHUNKS);

    graph.removeChunk(-1, 1);
    graph.removeChunk(-1, 1);
    expect(graph.sectionCount).toBe((columns.length - 1) * SUB_CHUNKS);

    // The camera's column is untouched by its neighbour's unload; a walk
    // from it completes and reaches its own sections.
    walk(graph, new Vector3(-8, 8, -8));
    expect(graph.isComplete).toBe(true);
    expect(graph.isSectionReached(-1, -1, 0)).toBe(true);

    graph.clear();
    expect(graph.sectionCount).toBe(0);
  });
});

describe("noclip eye probe", () => {
  // A 3-wide wall of rock at voxel x = 5..7, everything else air.
  const isRock = (vx: number) => vx >= 5 && vx <= 7;
  const isOpaqueAt = (vx: number) => isRock(vx);

  it("measures the near plane's farthest corner", () => {
    // 90 deg vertical fov at 16:9 and near 0.1: half extents 0.1 x 0.178.
    const reach = nearPlaneReach(90, 16 / 9, 0.1);
    expect(reach).toBeCloseTo(0.1 * Math.sqrt(1 + 1 + (16 / 9) ** 2), 6);
  });

  it("calls an eye in open air clear, even a noclip one", () => {
    const reach = nearPlaneReach(90, 16 / 9, 0.1);
    expect(isEyeInOpaqueVoxel({ x: 2.5, y: 8, z: 8 }, reach, isOpaqueAt)).toBe(
      false,
    );
  });

  it("flags an eye inside rock", () => {
    const reach = nearPlaneReach(90, 16 / 9, 0.1);
    expect(isEyeInOpaqueVoxel({ x: 6.5, y: 8, z: 8 }, reach, isOpaqueAt)).toBe(
      true,
    );
  });

  it("flags an eye in air whose near plane clips into the wall", () => {
    const reach = nearPlaneReach(90, 16 / 9, 0.1);
    // 0.1 blocks from the wall face at x = 5: the near plane reaches in.
    expect(isEyeInOpaqueVoxel({ x: 4.9, y: 8, z: 8 }, reach, isOpaqueAt)).toBe(
      true,
    );
    // 0.5 blocks off it does not.
    expect(isEyeInOpaqueVoxel({ x: 4.5, y: 8, z: 8 }, reach, isOpaqueAt)).toBe(
      false,
    );
  });

  it("floors negative coordinates onto the right voxel", () => {
    const probed: number[] = [];
    isEyeInOpaqueVoxel({ x: -0.5, y: 0.5, z: 0.5 }, 0, (vx) => {
      probed.push(vx);
      return false;
    });
    expect(new Set(probed)).toEqual(new Set([-1]));
  });

  it("keeps culling behind a sealed wall for an unsuspended noclip walk", () => {
    const graph = makeGraph();
    for (let cx = 0; cx <= 4; cx++) graph.addChunk(cx, 0);
    for (let level = 0; level < SUB_CHUNKS; level++) {
      graph.setConnectivity(2, 0, level, 0);
    }
    // The eye is in open air (the probe says so), so the world passes
    // isSuspended = false even though the player is noclipping.
    walk(graph, new Vector3(8, 8, 8));
    expect(graph.isComplete).toBe(true);
    expect(graph.isSectionVisible(3, 0, 0)).toBe(false);
  });
});

describe("SectionVisibilityGraph, the kept walk", () => {
  const RADIUS = 5;
  /** A disc of chunks whose sections carry a repeatable mix of open, sealed
   * and partly open connectivity. */
  const fill = (graph: SectionVisibilityGraph, salt = 0) => {
    let seed = 12345 + salt;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let cx = -RADIUS; cx <= RADIUS; cx++) {
      for (let cz = -RADIUS; cz <= RADIUS; cz++) {
        graph.addChunk(cx, cz);
        for (let level = 0; level < SUB_CHUNKS; level++) {
          const roll = next() % 10;
          const connectivity =
            roll < 5 ? CONNECTIVITY_FULL : roll < 7 ? 0 : next() & 0x7fff;
          graph.setConnectivity(cx, cz, level, connectivity);
        }
      }
    }
  };
  const look = (
    graph: SectionVisibilityGraph,
    eye: Vector3,
    toward: Vector3,
    fogFar = Infinity,
  ) => {
    const camera = new PerspectiveCamera(70, 1.6, 0.1, 10_000);
    camera.position.copy(eye);
    camera.lookAt(toward);
    camera.updateMatrixWorld();
    const matrix = new Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    graph.walk(eye, matrix, fogFar);
  };
  const answers = (graph: SectionVisibilityGraph) => {
    const rows: string[] = [];
    for (let cx = -RADIUS; cx <= RADIUS; cx++) {
      for (let cz = -RADIUS; cz <= RADIUS; cz++) {
        let visible = 0;
        let reached = 0;
        for (let level = 0; level < SUB_CHUNKS; level++) {
          if (graph.isSectionVisible(cx, cz, level)) visible |= 1 << level;
          if (graph.isSectionReached(cx, cz, level)) reached |= 1 << level;
        }
        // The column's answer in one call is the levels' answers.
        expect(graph.columnMask(cx, cz, false)).toBe(visible);
        expect(graph.columnMask(cx, cz, true)).toBe(reached);
        rows.push(`${cx},${cz}:${visible}/${reached}`);
      }
    }
    return rows.join(" ");
  };
  /** The answers a graph gives that has never walked before. */
  const fresh = (
    eye: Vector3,
    toward: Vector3,
    fogFar = Infinity,
    edit?: (graph: SectionVisibilityGraph) => void,
  ) => {
    const graph = makeGraph();
    fill(graph);
    edit?.(graph);
    look(graph, eye, toward, fogFar);
    return answers(graph);
  };

  it("turning and moving inside a section reuses the walk and answers as a new one would", () => {
    const graph = makeGraph();
    fill(graph);
    const views: [Vector3, Vector3, number][] = [
      [new Vector3(8, 20, 8), new Vector3(100, 20, 8), Infinity],
      [new Vector3(8, 20, 8), new Vector3(-100, 30, 40), Infinity],
      [new Vector3(3, 17, 12), new Vector3(8, 200, 9), Infinity],
      [new Vector3(14, 30, 2), new Vector3(-50, 0, -80), 40],
      [new Vector3(8, 20, 8), new Vector3(100, 20, 8), 24],
    ];
    for (const [eye, toward, fogFar] of views) {
      look(graph, eye, toward, fogFar);
      expect(answers(graph)).toBe(fresh(eye, toward, fogFar));
    }
    expect(graph.stats.walks).toBe(1);
  });

  it("walks again from another section", () => {
    const graph = makeGraph();
    fill(graph);
    const steps: [Vector3, Vector3][] = [
      [new Vector3(8, 20, 8), new Vector3(100, 20, 8)],
      // Up a level, then across into the next chunk, then back.
      [new Vector3(8, 40, 8), new Vector3(100, 20, 8)],
      [new Vector3(24, 40, 8), new Vector3(100, 20, 8)],
      [new Vector3(8, 20, 8), new Vector3(100, 20, 8)],
    ];
    for (const [eye, toward] of steps) {
      look(graph, eye, toward);
      expect(answers(graph)).toBe(fresh(eye, toward));
    }
    expect(graph.stats.walks).toBe(4);
  });

  it("walks again when the graph changes, and only then", () => {
    const eye = new Vector3(8, 20, 8);
    const toward = new Vector3(100, 20, 8);
    const graph = makeGraph();
    fill(graph);
    look(graph, eye, toward);

    // A remesh that reports what the section already had changes nothing.
    graph.setConnectivity(3, 0, 1, CONNECTIVITY_FULL);
    graph.setConnectivity(3, 0, 1, CONNECTIVITY_FULL);
    look(graph, eye, toward);
    const walksBefore = graph.stats.walks;

    const edits: ((g: SectionVisibilityGraph) => void)[] = [
      (g) => g.setConnectivity(1, 0, 1, 0),
      (g) => g.removeChunk(2, 1),
      (g) => g.addChunk(RADIUS + 1, 0),
      (g) => g.setConnectivity(1, 0, 1, CONNECTIVITY_FULL),
    ];
    const applied: ((g: SectionVisibilityGraph) => void)[] = [];
    for (const edit of edits) {
      edit(graph);
      applied.push(edit);
      look(graph, eye, toward);
      // The extra column is outside the disc `answers` reads; the rest must
      // match a graph built the same way and walked once.
      expect(answers(graph)).toBe(
        fresh(eye, toward, Infinity, (g) => applied.forEach((e) => e(g))),
      );
    }
    expect(graph.stats.walks).toBe(walksBefore + edits.length);
  });

  it("starts over after a clear", () => {
    const graph = makeGraph();
    fill(graph);
    look(graph, new Vector3(8, 20, 8), new Vector3(100, 20, 8));
    graph.clear();
    fill(graph);
    look(graph, new Vector3(8, 20, 8), new Vector3(100, 20, 8));
    expect(answers(graph)).toBe(
      fresh(new Vector3(8, 20, 8), new Vector3(100, 20, 8)),
    );
  });

  it("a walk that could not start, or was suspended, leaves the next one right", () => {
    const eye = new Vector3(8, 20, 8);
    const toward = new Vector3(100, 20, 8);
    const graph = makeGraph();
    fill(graph);
    look(graph, eye, toward);
    // Outside the loaded disc: nothing is claimed hidden.
    look(graph, new Vector3(4000, 20, 8), toward);
    expect(graph.isComplete).toBe(false);
    expect(graph.columnMask(0, 0, false)).toBe((1 << SUB_CHUNKS) - 1);
    graph.walk(eye, new Matrix4(), Infinity, true);
    expect(graph.isComplete).toBe(false);
    look(graph, eye, toward);
    expect(graph.isComplete).toBe(true);
    expect(answers(graph)).toBe(fresh(eye, toward));
  });
});
