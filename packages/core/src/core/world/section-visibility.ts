import { Frustum, Vector3 } from "three";

/**
 * Face order for connectivity bits: -X, +X, -Y, +Y, -Z, +Z. Mirrors
 * `crates/mesher/src/mesher/connectivity.rs`; change neither side alone.
 */
const FACE_COUNT = 6;

/**
 * All fifteen unordered face pairs connected — the encoding for a section the
 * eye passes straight through (all air, or not yet meshed).
 */
export const CONNECTIVITY_FULL = 0x7fff;

const FACE_OFFSETS: readonly (readonly [number, number, number])[] = [
  [-1, 0, 0],
  [1, 0, 0],
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
];

const OPPOSITE_FACE = [1, 0, 3, 2, 5, 4];

const pairBit = (a: number, b: number) => {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const offset = (lo * (2 * FACE_COUNT - lo - 1)) / 2;
  return 1 << (offset + (hi - lo - 1));
};

/**
 * `FACE_ROW_BITS[face]` selects the connectivity bits that pair `face` with
 * any other face, so "which faces can I leave through, having entered here"
 * is one AND instead of five pair lookups.
 */
const FACE_ROW_BITS = (() => {
  const rows = new Int32Array(FACE_COUNT * FACE_COUNT);
  for (let a = 0; a < FACE_COUNT; a++) {
    for (let b = 0; b < FACE_COUNT; b++) {
      if (a !== b) rows[a * FACE_COUNT + b] = pairBit(a, b);
    }
  }
  return rows;
})();

type SectionNode = {
  cx: number;
  cz: number;
  level: number;
  connectivity: number;
  neighbors: (SectionNode | null)[];
  /**
   * Generation stamp: an air path from the camera reaches this section. A
   * section that is reached but not visible sits outside the frustum or fog
   * — it may still cast shadows, so shadow-safe chunks keep it drawn.
   */
  reachedGen: number;
  /** Generation stamp: reached, inside the frustum, and inside the fog. */
  visibleGen: number;
  /** Directions traveled on any path that reached this node this BFS. */
  traveledMask: number;
  /** Faces of this node the BFS entered through this BFS. */
  entryMask: number;
};

export type SectionVisibilityGraphOptions = {
  subChunks: number;
  chunkSize: number;
  maxHeight: number;
};

/**
 * Sodium-style section traversal graph. Each meshed section reports which of
 * its face pairs see each other through non-opaque voxels; a per-frame BFS
 * from the camera's section walks the graph, only continuing through a
 * section when the face it entered connects to the face it wants to leave by,
 * and never doubling back toward the camera. Sections the walk cannot reach
 * are occluded — enclosed interiors stop paying for the terrain around them.
 */
export class SectionVisibilityGraph {
  private nodes = new Map<string, SectionNode>();
  private queue: SectionNode[] = [];
  private generation = 0;
  private isLastWalkComplete = false;
  private lastReachedCount = 0;
  private lastVisibleCount = 0;
  private sealedConnectivityCount = 0;

  private frustum = new Frustum();
  private corner = new Vector3();

  constructor(private options: SectionVisibilityGraphOptions) {}

  private keyOf(cx: number, cz: number, level: number) {
    return `${cx}|${cz}|${level}`;
  }

  private heightPerSubChunk() {
    return Math.floor(this.options.maxHeight / this.options.subChunks);
  }

  addChunk(cx: number, cz: number) {
    for (let level = 0; level < this.options.subChunks; level++) {
      this.ensureNode(cx, cz, level);
    }
  }

  removeChunk(cx: number, cz: number) {
    for (let level = 0; level < this.options.subChunks; level++) {
      const key = this.keyOf(cx, cz, level);
      const node = this.nodes.get(key);
      if (!node) continue;
      if (node.connectivity !== CONNECTIVITY_FULL) {
        this.sealedConnectivityCount -= 1;
      }
      for (let face = 0; face < FACE_COUNT; face++) {
        const neighbor = node.neighbors[face];
        if (neighbor) neighbor.neighbors[OPPOSITE_FACE[face]] = null;
      }
      this.nodes.delete(key);
    }
  }

  setConnectivity(cx: number, cz: number, level: number, connectivity: number) {
    const node = this.ensureNode(cx, cz, level);
    if (
      node.connectivity !== CONNECTIVITY_FULL &&
      connectivity === CONNECTIVITY_FULL
    ) {
      this.sealedConnectivityCount -= 1;
    } else if (
      node.connectivity === CONNECTIVITY_FULL &&
      connectivity !== CONNECTIVITY_FULL
    ) {
      this.sealedConnectivityCount += 1;
    }
    node.connectivity = connectivity;
  }

  clear() {
    this.nodes.clear();
    this.queue.length = 0;
    this.isLastWalkComplete = false;
    this.sealedConnectivityCount = 0;
    this.lastReachedCount = 0;
    this.lastVisibleCount = 0;
  }

  get sectionCount() {
    return this.nodes.size;
  }

  get stats() {
    return {
      sections: this.nodes.size,
      // "Constrained" counts sections reporting anything other than fully
      // open connectivity — zero means no real connectivity data has arrived.
      constrained: this.sealedConnectivityCount,
      reached: this.lastReachedCount,
      visible: this.lastVisibleCount,
      isComplete: this.isLastWalkComplete,
    };
  }

  /**
   * Whether the last {@link walk} started from a loaded section. When the
   * camera stands outside the graph the walk cannot claim anything is hidden,
   * and callers must fall back to frustum-only culling.
   */
  get isComplete() {
    return this.isLastWalkComplete;
  }

  isSectionVisible(cx: number, cz: number, level: number) {
    if (!this.isLastWalkComplete) return true;
    const node = this.nodes.get(this.keyOf(cx, cz, level));
    if (!node) return true;
    return node.visibleGen === this.generation;
  }

  isSectionReached(cx: number, cz: number, level: number) {
    if (!this.isLastWalkComplete) return true;
    const node = this.nodes.get(this.keyOf(cx, cz, level));
    if (!node) return true;
    return node.reachedGen === this.generation;
  }

  /**
   * Runs the traversal for the current camera. The walk itself follows only
   * connectivity — frustum and fog decide which reached sections count as
   * visible, never where the walk may go, so the reached set stays a pure
   * "an air path exists" answer that shadow-safe chunks can trust. `fogFar`
   * (in blocks, horizontal) is the fully-fogged distance; `Infinity` disables
   * fog culling.
   */
  walk(
    cameraPosition: Vector3,
    projectionScreenMatrix: Parameters<Frustum["setFromProjectionMatrix"]>[0],
    fogFar: number,
  ) {
    const { chunkSize } = this.options;
    const heightPerSubChunk = this.heightPerSubChunk();

    this.generation += 1;
    const gen = this.generation;
    this.frustum.setFromProjectionMatrix(projectionScreenMatrix);

    const startCx = Math.floor(cameraPosition.x / chunkSize);
    const startCz = Math.floor(cameraPosition.z / chunkSize);
    const startLevel = Math.min(
      this.options.subChunks - 1,
      Math.max(0, Math.floor(cameraPosition.y / heightPerSubChunk)),
    );

    const start = this.nodes.get(this.keyOf(startCx, startCz, startLevel));
    if (!start) {
      this.isLastWalkComplete = false;
      this.lastReachedCount = 0;
      this.lastVisibleCount = 0;
      return;
    }
    this.isLastWalkComplete = true;
    let reachedCount = 1;
    let visibleCount = 1;

    const fogFarSquared = fogFar * fogFar;
    const queue = this.queue;
    queue.length = 0;

    start.reachedGen = gen;
    start.visibleGen = gen;
    start.traveledMask = 0;
    start.entryMask = (1 << FACE_COUNT) - 1;
    queue.push(start);

    for (let head = 0; head < queue.length; head++) {
      const node = queue[head];

      let exitableMask = 0;
      if (node === start) {
        exitableMask = (1 << FACE_COUNT) - 1;
      } else {
        for (let entry = 0; entry < FACE_COUNT; entry++) {
          if ((node.entryMask & (1 << entry)) === 0) continue;
          for (let exit = 0; exit < FACE_COUNT; exit++) {
            if (node.connectivity & FACE_ROW_BITS[entry * FACE_COUNT + exit]) {
              exitableMask |= 1 << exit;
            }
          }
        }
      }

      for (let face = 0; face < FACE_COUNT; face++) {
        if ((exitableMask & (1 << face)) === 0) continue;
        if (node.traveledMask & (1 << OPPOSITE_FACE[face])) continue;

        const neighbor = node.neighbors[face];
        if (!neighbor) continue;

        const traveledMask = node.traveledMask | (1 << face);
        const entryFaceBit = 1 << OPPOSITE_FACE[face];

        if (neighbor.reachedGen === gen) {
          // Paths merge: union the masks, and only re-expand when the union
          // actually widened what this node can do.
          const widened =
            (neighbor.traveledMask | traveledMask) !== neighbor.traveledMask ||
            (neighbor.entryMask | entryFaceBit) !== neighbor.entryMask;
          neighbor.traveledMask |= traveledMask;
          neighbor.entryMask |= entryFaceBit;
          if (widened) {
            queue.push(neighbor);
          }
          continue;
        }

        neighbor.reachedGen = gen;
        neighbor.traveledMask = traveledMask;
        neighbor.entryMask = entryFaceBit;
        reachedCount += 1;

        if (this.isSectionInRange(neighbor, cameraPosition, fogFarSquared)) {
          neighbor.visibleGen = gen;
          visibleCount += 1;
        }

        queue.push(neighbor);
      }
    }

    this.lastReachedCount = reachedCount;
    this.lastVisibleCount = visibleCount;
  }

  private isSectionInRange(
    node: SectionNode,
    cameraPosition: Vector3,
    fogFarSquared: number,
  ) {
    const { chunkSize } = this.options;
    const heightPerSubChunk = this.heightPerSubChunk();

    const minX = node.cx * chunkSize;
    const minY = node.level * heightPerSubChunk;
    const minZ = node.cz * chunkSize;
    const maxX = minX + chunkSize;
    const maxY = minY + heightPerSubChunk;
    const maxZ = minZ + chunkSize;

    if (Number.isFinite(fogFarSquared)) {
      const nearestX = Math.min(Math.max(cameraPosition.x, minX), maxX);
      const nearestZ = Math.min(Math.max(cameraPosition.z, minZ), maxZ);
      const dx = nearestX - cameraPosition.x;
      const dz = nearestZ - cameraPosition.z;
      if (dx * dx + dz * dz > fogFarSquared) return false;
    }

    // Inline AABB-vs-frustum p-vertex test; Frustum.intersectsBox needs a
    // Box3 and this runs thousands of times per frame.
    const planes = this.frustum.planes;
    for (let i = 0; i < 6; i++) {
      const plane = planes[i];
      this.corner.set(
        plane.normal.x > 0 ? maxX : minX,
        plane.normal.y > 0 ? maxY : minY,
        plane.normal.z > 0 ? maxZ : minZ,
      );
      if (plane.distanceToPoint(this.corner) < 0) return false;
    }

    return true;
  }

  private ensureNode(cx: number, cz: number, level: number) {
    const key = this.keyOf(cx, cz, level);
    const existing = this.nodes.get(key);
    if (existing) return existing;

    const node: SectionNode = {
      cx,
      cz,
      level,
      connectivity: CONNECTIVITY_FULL,
      neighbors: [null, null, null, null, null, null],
      reachedGen: -1,
      visibleGen: -1,
      traveledMask: 0,
      entryMask: 0,
    };
    this.nodes.set(key, node);

    for (let face = 0; face < FACE_COUNT; face++) {
      const [dx, dy, dz] = FACE_OFFSETS[face];
      const neighborLevel = level + dy;
      if (neighborLevel < 0 || neighborLevel >= this.options.subChunks) {
        continue;
      }
      const neighbor = this.nodes.get(
        this.keyOf(cx + dx, cz + dz, neighborLevel),
      );
      if (!neighbor) continue;
      node.neighbors[face] = neighbor;
      neighbor.neighbors[OPPOSITE_FACE[face]] = node;
    }

    return node;
  }
}
