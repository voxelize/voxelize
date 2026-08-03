import { Matrix4, PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import {
  CONNECTIVITY_FULL,
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
});
