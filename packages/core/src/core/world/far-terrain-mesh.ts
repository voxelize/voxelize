/**
 * The geometry a far-terrain tile becomes, as plain typed arrays so a worker
 * can build it: stepped columns one cell per sample, the way distant blocks
 * look, with the generator's tree crowns standing where its trees stand and
 * skirts down from every tile edge so a coarser neighbour never shows a
 * crack.
 * What paints each face (which block, which tint) is decided per fragment
 * from the attributes written here; see far-terrain.ts.
 */

/** What a face is, for the shader to pick its texture. */
export const FAR_FACE_KIND = {
  /** The ground's upward face: the material's top, flat covers dithered in. */
  top: 0,
  /** A riser or cliff: the ground block's side, then the strata below it. */
  wall: 1,
  /** A tree crown's face: its species' leaves. */
  crown: 2,
  /** The underside of floating land. */
  bottom: 3,
  /** A crown's trunk: its species' bark. */
  trunk: 4,
} as const;

export type FarMeshInput = {
  /** World x and z of sample (0, 0). */
  originX: number;
  originZ: number;
  step: number;
  size: number;
  heights: ArrayLike<number>;
  classes: ArrayLike<number>;
  /** RGB per sample (128 = unchanged), or null. */
  tints: ArrayLike<number> | null;
  /** `(top, bottom)` per sample of floating land, or null. */
  sky: ArrayLike<number> | null;
  /**
   * The tree crowns over each cell as `(top, bottom, cover, kind)`, the
   * tile's own (`FarTileData.canopy`), or null for none.
   */
  canopy: ArrayLike<number> | null;
  /** Ground classes the materials name; a sample's class is clamped under it. */
  classCount: number;
  /** The class of the first tree species; a crown wears its species' class. */
  treeClass: number;
  /** The class floating land wears. */
  skyClass: number;
  /** The far water plane's y: nothing under it is built. Null builds all. */
  waterSurface: number | null;
};

/**
 * One mesh's vertex data. Positions are relative to the tile's origin
 * (`originX`, 0, `originZ`). `column` is per vertex the ground top and the
 * column top of the column the face belongs to; `material` is class, kind,
 * occlusion (255 open) and an unused byte; `tint` is RGB plus an unused
 * byte.
 */
export type FarMeshData = {
  position: Int16Array;
  column: Int16Array;
  material: Uint8Array;
  tint: Uint8Array;
  index: Uint16Array | Uint32Array;
  quads: number;
  /** Quads by what they are, for the budget. */
  counts: FarMeshCounts;
  minY: number;
  maxY: number;
};

export type FarMeshCounts = {
  tops: number;
  risers: number;
  skirts: number;
  crowns: number;
};

/** The chunk mesher's vertex occlusion, by level (0 fully shut, 3 open). */
const AO_LEVELS = [30, 120, 180, 255];

class QuadWriter {
  position: Int16Array;
  column: Int16Array;
  material: Uint8Array;
  tint: Uint8Array;
  quads = 0;
  minY = Infinity;
  maxY = -Infinity;
  counts: FarMeshCounts = { tops: 0, risers: 0, skirts: 0, crowns: 0 };

  constructor(capacity: number) {
    const vertices = Math.max(4, capacity * 4);
    this.position = new Int16Array(vertices * 3);
    this.column = new Int16Array(vertices * 2);
    this.material = new Uint8Array(vertices * 4);
    this.tint = new Uint8Array(vertices * 4);
  }

  private grow() {
    const grown = (array: Int16Array | Uint8Array) => {
      const next = new (array.constructor as
        | typeof Int16Array
        | typeof Uint8Array)(array.length * 2);
      next.set(array);
      return next;
    };
    this.position = grown(this.position) as Int16Array;
    this.column = grown(this.column) as Int16Array;
    this.material = grown(this.material) as Uint8Array;
    this.tint = grown(this.tint) as Uint8Array;
  }

  /**
   * A quad from four corners `[x, y, z]` counter-clockwise seen from the side
   * it faces, with one occlusion value per corner.
   */
  quad(
    corners: readonly (readonly [number, number, number])[],
    occlusion: readonly number[],
    ground: number,
    top: number,
    cls: number,
    kind: number,
    slot: number,
    tint: readonly number[],
  ) {
    if ((this.quads + 1) * 4 * 3 > this.position.length) this.grow();
    for (let k = 0; k < 4; k++) {
      const v = this.quads * 4 + k;
      const [x, y, z] = corners[k];
      this.position[v * 3] = x;
      this.position[v * 3 + 1] = y;
      this.position[v * 3 + 2] = z;
      this.column[v * 2] = ground;
      this.column[v * 2 + 1] = top;
      this.material[v * 4] = cls;
      this.material[v * 4 + 1] = kind;
      this.material[v * 4 + 2] = occlusion[k];
      this.material[v * 4 + 3] = slot;
      this.tint[v * 4] = tint[0];
      this.tint[v * 4 + 1] = tint[1];
      this.tint[v * 4 + 2] = tint[2];
      if (y < this.minY) this.minY = y;
      if (y > this.maxY) this.maxY = y;
    }
    this.quads += 1;
  }

  finish(): FarMeshData | null {
    if (this.quads === 0) return null;
    const vertices = this.quads * 4;
    const index =
      vertices > 65535
        ? new Uint32Array(this.quads * 6)
        : new Uint16Array(this.quads * 6);
    for (let q = 0; q < this.quads; q++) {
      const a = q * 4;
      index.set([a, a + 1, a + 2, a, a + 2, a + 3], q * 6);
    }
    return {
      position: this.position.slice(0, vertices * 3),
      column: this.column.slice(0, vertices * 2),
      material: this.material.slice(0, vertices * 4),
      tint: this.tint.slice(0, vertices * 4),
      index,
      quads: this.quads,
      counts: this.counts,
      minY: this.minY,
      maxY: this.maxY,
    };
  }
}

/**
 * A 32-bit integer hash of a lattice point and a salt, in [0, 1). The
 * coordinates are mixed in one after the other, so no sign or swap of them
 * maps to the same value and no pattern mirrors across an axis.
 */
export function farHash(x: number, z: number, salt: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= Math.imul(z | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) & 0xffffff) / 0x1000000;
}

/** Salt of the hash that keeps a crown in a cell crowns only partly cover. */
const CANOPY_SALT = 0x5eed;

const OPEN = [255, 255, 255, 255];
const NEUTRAL_TINT = [128, 128, 128];

/** What a crown's shade leaves of the light on the ground under it. */
const UNDER_CROWN = 0.55;

/**
 * A tile's land: per cell a column at its sample's height (whole blocks), a
 * wall along every edge whose two columns differ (facing the lower,
 * belonging to the higher), skirts down from the tile's four edges, and a
 * crown over the cells a forest covers. Nothing under `waterSurface` is
 * built: the far water plane hides it. Cell `(i, j)` spans
 * `[i, i + 1) x [j, j + 1)` steps; the last sample row is the next tile's
 * first cell, so this tile walls that shared edge and the next leaves its
 * low edge alone. Open tops of one height, class and tint merge into runs.
 * Crowns are the tile's canopy samples: per cell a box from the crown's
 * underside to its top, with a side wherever one stands out past its
 * neighbour, over shaded ground, standing on a trunk at the finest cells.
 */
export function buildFarLandMesh(input: FarMeshInput): FarMeshData | null {
  const { step, size, heights, classes, tints, canopy, treeClass } = input;
  const cells = size - 1;
  const water = Number.isFinite(input.waterSurface)
    ? Math.floor(input.waterSurface as number)
    : -Infinity;
  const ground = new Int16Array(size * size);
  const crownBase = new Int16Array(size * size);
  const crownTop = new Int16Array(size * size);
  const slot = new Uint8Array(size * size);
  const trunk = new Uint8Array(size * size);
  const lastClass = Math.max(0, input.classCount - 1);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const at = j * size + i;
      const g = Math.round(heights[at]);
      ground[at] = g;
      if (!canopy || g <= water) continue;
      const top = canopy[at * 4];
      if (top <= 0) continue;
      // A cell crowns cover only in part (one coarser than its trees) keeps
      // a crown at that chance, so a forest keeps its density from afar.
      const cover = canopy[at * 4 + 2];
      const x = input.originX + i * step;
      const z = input.originZ + j * step;
      if (cover < 255 && farHash(x, z, CANOPY_SALT) * 255 >= cover) continue;
      const kind = canopy[at * 4 + 3];
      crownTop[at] = g + top;
      crownBase[at] = g + Math.min(canopy[at * 4 + 1], top - 1);
      slot[at] = kind & 0x7f;
      trunk[at] = kind & 0x80 ? 1 : 0;
    }
  }

  const tintOf = (at: number) =>
    tints
      ? [tints[at * 3], tints[at * 3 + 1], tints[at * 3 + 2]]
      : NEUTRAL_TINT;
  const classOf = (at: number) => Math.min(classes[at], lastClass);
  const groundAt = (i: number, j: number) => ground[j * size + i];

  // Chunk-mesher occlusion at a top's corner: the two cells sharing its
  // edges and the one sharing only the corner, counted when they stand
  // higher. Spread over a cell of `step` blocks, so the strength is scaled
  // to keep the darkened area what a block's would be.
  const strength = 1 / step;
  const inside = (a: number, b: number) =>
    a >= 0 && b >= 0 && a <= cells && b <= cells;
  const occlusion = (i: number, j: number, di: number, dj: number) => {
    const y = groundAt(i, j);
    const ii = i + di;
    const jj = j + dj;
    const side1 = inside(ii, j) && groundAt(ii, j) > y ? 1 : 0;
    const side2 = inside(i, jj) && groundAt(i, jj) > y ? 1 : 0;
    const corner = inside(ii, jj) && groundAt(ii, jj) > y ? 1 : 0;
    const level = side1 && side2 ? 0 : 3 - (side1 + side2 + corner);
    return Math.round(255 - (255 - AO_LEVELS[level]) * strength);
  };
  const cornersOf = (i: number, j: number) => {
    const shade = crownTop[j * size + i] > 0 ? UNDER_CROWN : 1;
    return [
      occlusion(i, j, -1, -1),
      occlusion(i, j, -1, 1),
      occlusion(i, j, 1, 1),
      occlusion(i, j, 1, -1),
    ].map((ao) => Math.round(ao * shade));
  };
  const isOpen = (corners: number[]) => corners.every((ao) => ao === 255);
  const sameTint = (a: number, b: number) =>
    !tints ||
    (tints[a * 3] === tints[b * 3] &&
      tints[a * 3 + 1] === tints[b * 3 + 1] &&
      tints[a * 3 + 2] === tints[b * 3 + 2]);

  const writer = new QuadWriter(cells * cells * 2 + cells * 4);
  const s = step;

  // Tops, an open run of equal cells as one quad.
  for (let j = 0; j < cells; j++) {
    const z0 = j * s;
    const z1 = z0 + s;
    let i = 0;
    while (i < cells) {
      const at = j * size + i;
      const g = ground[at];
      if (g <= water) {
        i += 1;
        continue;
      }
      const corners = cornersOf(i, j);
      let end = i;
      if (isOpen(corners)) {
        while (end + 1 < cells) {
          const next = j * size + end + 1;
          if (
            ground[next] !== g ||
            classOf(next) !== classOf(at) ||
            !sameTint(next, at) ||
            !isOpen(cornersOf(end + 1, j))
          )
            break;
          end += 1;
        }
      }
      const x0 = i * s;
      const x1 = (end + 1) * s;
      // Corners counter-clockwise from above: (x0,z0) (x0,z1) (x1,z1) (x1,z0).
      writer.quad(
        [
          [x0, g, z0],
          [x0, g, z1],
          [x1, g, z1],
          [x1, g, z0],
        ],
        corners,
        g,
        g,
        classOf(at),
        FAR_FACE_KIND.top,
        0,
        tintOf(at),
      );
      writer.counts.tops += 1;
      i = end + 1;
    }
  }

  // A wall between two columns, from the lower top up to the higher, above
  // the water.
  const wall = (
    owner: number,
    low: number,
    high: number,
    corners: (bottom: number, upper: number) => [number, number, number][],
  ) => {
    const bottom = Math.max(low, water);
    if (high <= bottom) return;
    writer.quad(
      corners(bottom, high),
      OPEN,
      ground[owner],
      ground[owner],
      classOf(owner),
      FAR_FACE_KIND.wall,
      0,
      tintOf(owner),
    );
    writer.counts.skirts += 1;
  };
  // Risers between columns: along each line between two rows of cells, a
  // run of the same step belonging to the same kind of column is one quad.
  type Riser = { owner: number; low: number; high: number; faces: 1 | -1 };
  const riserBetween = (a: number, b: number): Riser | null => {
    const ya = ground[a];
    const yb = ground[b];
    if (ya === yb) return null;
    const owner = ya > yb ? a : b;
    const low = Math.max(Math.min(ya, yb), water);
    const high = Math.max(ya, yb);
    if (high <= low) return null;
    return { owner, low, high, faces: ya > yb ? 1 : -1 };
  };
  const sameRiser = (r: Riser, q: Riser) =>
    r.low === q.low &&
    r.high === q.high &&
    r.faces === q.faces &&
    classOf(r.owner) === classOf(q.owner) &&
    sameTint(r.owner, q.owner);
  const riser = (r: Riser, corners: [number, number, number][]) => {
    writer.quad(
      corners,
      OPEN,
      ground[r.owner],
      ground[r.owner],
      classOf(r.owner),
      FAR_FACE_KIND.wall,
      0,
      tintOf(r.owner),
    );
    writer.counts.risers += 1;
  };
  // Planes x = (i + 1) * step, runs along z; the riser faces the lower side.
  for (let i = 0; i < cells; i++) {
    const x = (i + 1) * s;
    let run: Riser | null = null;
    let from = 0;
    const flush = (to: number) => {
      if (!run) return;
      const z0 = from * s;
      const z1 = to * s;
      const { low: b, high: u } = run;
      riser(
        run,
        run.faces > 0
          ? [
              [x, b, z0],
              [x, u, z0],
              [x, u, z1],
              [x, b, z1],
            ]
          : [
              [x, b, z1],
              [x, u, z1],
              [x, u, z0],
              [x, b, z0],
            ],
      );
      run = null;
    };
    for (let j = 0; j < cells; j++) {
      const at = j * size + i;
      const next = riserBetween(at, at + 1);
      if (run && next && sameRiser(run, next)) continue;
      flush(j);
      if (next) {
        run = next;
        from = j;
      }
    }
    flush(cells);
  }
  // Planes z = (j + 1) * step, runs along x.
  for (let j = 0; j < cells; j++) {
    const z = (j + 1) * s;
    let run: Riser | null = null;
    let from = 0;
    const flush = (to: number) => {
      if (!run) return;
      const x0 = from * s;
      const x1 = to * s;
      const { low: b, high: u } = run;
      riser(
        run,
        run.faces > 0
          ? [
              [x0, b, z],
              [x1, b, z],
              [x1, u, z],
              [x0, u, z],
            ]
          : [
              [x0, b, z],
              [x0, u, z],
              [x1, u, z],
              [x1, b, z],
            ],
      );
      run = null;
    };
    for (let i = 0; i < cells; i++) {
      const at = j * size + i;
      const next = riserBetween(at, at + size);
      if (run && next && sameRiser(run, next)) continue;
      flush(i);
      if (next) {
        run = next;
        from = i;
      }
    }
    flush(cells);
  }

  // Skirts: from each edge cell's lower top down past anything a coarser
  // neighbour could leave open, facing out of the tile.
  const skirtDepth = Math.max(4, step * 3);
  const span = cells * s;
  for (let k = 0; k < cells; k++) {
    const a0 = k * s;
    const a1 = a0 + s;
    const west = k * size;
    wall(west, ground[west] - skirtDepth, ground[west], (b, u) => [
      [0, b, a1],
      [0, u, a1],
      [0, u, a0],
      [0, b, a0],
    ]);
    const north = k;
    wall(north, ground[north] - skirtDepth, ground[north], (b, u) => [
      [a0, b, 0],
      [a0, u, 0],
      [a1, u, 0],
      [a1, b, 0],
    ]);
    const eastIn = k * size + cells - 1;
    const eastLow = Math.min(ground[eastIn], ground[eastIn + 1]);
    wall(eastIn, ground[eastIn] - skirtDepth, eastLow, (b, u) => [
      [span, b, a0],
      [span, u, a0],
      [span, u, a1],
      [span, b, a1],
    ]);
    const southIn = (cells - 1) * size + k;
    const southLow = Math.min(ground[southIn], ground[southIn + size]);
    wall(southIn, ground[southIn] - skirtDepth, southLow, (b, u) => [
      [a1, b, span],
      [a1, u, span],
      [a0, u, span],
      [a0, b, span],
    ]);
  }

  // Crowns: a box per crowned cell, sides only where it stands out past the
  // neighbouring crown (a neighbour outside the tile counts as open).
  const crownOf = (i: number, j: number): [number, number] | null => {
    if (!inside(i, j)) return null;
    const at = j * size + i;
    return crownTop[at] > 0 ? [crownBase[at], crownTop[at]] : null;
  };
  const crownFace = (
    at: number,
    corners: [number, number, number][],
    base: number,
    tip: number,
  ) => {
    writer.quad(
      corners,
      OPEN,
      ground[at],
      tip,
      treeClass + slot[at],
      FAR_FACE_KIND.crown,
      0,
      tintOf(at),
    );
    writer.counts.crowns += 1;
  };
  // Tops and undersides, a run of one crown's cells as one quad.
  const sameCrown = (a: number, b: number) =>
    crownTop[a] === crownTop[b] &&
    crownBase[a] === crownBase[b] &&
    slot[a] === slot[b] &&
    sameTint(a, b);
  for (let j = 0; j < cells; j++) {
    const z0 = j * s;
    const z1 = z0 + s;
    let i = 0;
    while (i < cells) {
      const at = j * size + i;
      if (crownTop[at] <= 0) {
        i += 1;
        continue;
      }
      let end = i;
      while (end + 1 < cells && sameCrown(at, j * size + end + 1)) end += 1;
      const x0 = i * s;
      const x1 = (end + 1) * s;
      const base = crownBase[at];
      const tip = crownTop[at];
      crownFace(
        at,
        [
          [x0, tip, z0],
          [x0, tip, z1],
          [x1, tip, z1],
          [x1, tip, z0],
        ],
        base,
        tip,
      );
      // The underside shows only to a viewer under the leaves, which only
      // the finest cells are near enough for.
      if (step <= 2) {
        crownFace(
          at,
          [
            [x1, base, z0],
            [x1, base, z1],
            [x0, base, z1],
            [x0, base, z0],
          ],
          base,
          tip,
        );
      }
      i = end + 1;
    }
  }
  for (let j = 0; j < cells; j++) {
    const z0 = j * s;
    const z1 = z0 + s;
    for (let i = 0; i < cells; i++) {
      const own = crownOf(i, j);
      if (!own) continue;
      const at = j * size + i;
      const [base, tip] = own;
      const x0 = i * s;
      const x1 = x0 + s;
      const sides: [
        number,
        number,
        (b: number, u: number) => [number, number, number][],
      ][] = [
        [
          i - 1,
          j,
          (b, u) => [
            [x0, b, z1],
            [x0, u, z1],
            [x0, u, z0],
            [x0, b, z0],
          ],
        ],
        [
          i + 1,
          j,
          (b, u) => [
            [x1, b, z0],
            [x1, u, z0],
            [x1, u, z1],
            [x1, b, z1],
          ],
        ],
        [
          i,
          j - 1,
          (b, u) => [
            [x0, b, z0],
            [x0, u, z0],
            [x1, u, z0],
            [x1, b, z0],
          ],
        ],
        [
          i,
          j + 1,
          (b, u) => [
            [x0, b, z1],
            [x1, b, z1],
            [x1, u, z1],
            [x0, u, z1],
          ],
        ],
      ];
      for (const [ni, nj, corners] of sides) {
        const other = crownOf(ni, nj);
        if (!other) {
          crownFace(at, corners(base, tip), base, tip);
          continue;
        }
        const [otherBase, otherTip] = other;
        if (otherBase > base) {
          crownFace(at, corners(base, Math.min(tip, otherBase)), base, tip);
        }
        if (otherTip < tip) {
          crownFace(at, corners(Math.max(base, otherTip), tip), base, tip);
        }
      }
    }
  }

  // Trunks, where crowns are near enough to tell a tree from a cloud of
  // leaves: a column of bark one block across from the ground up into the
  // crown, in the cell the tree stands in.
  if (step <= 2) {
    for (let j = 0; j < cells; j++) {
      const z0 = j * s;
      const z1 = z0 + 1;
      for (let i = 0; i < cells; i++) {
        const at = j * size + i;
        if (!trunk[at] || crownTop[at] <= 0) continue;
        const g = ground[at];
        const up = crownBase[at];
        if (up <= g) continue;
        const x0 = i * s;
        const x1 = x0 + 1;
        const bark = (corners: [number, number, number][]) => {
          writer.quad(
            corners,
            OPEN,
            g,
            up,
            treeClass + slot[at],
            FAR_FACE_KIND.trunk,
            0,
            tintOf(at),
          );
          writer.counts.crowns += 1;
        };
        bark([
          [x0, g, z1],
          [x0, up, z1],
          [x0, up, z0],
          [x0, g, z0],
        ]);
        bark([
          [x1, g, z0],
          [x1, up, z0],
          [x1, up, z1],
          [x1, g, z1],
        ]);
        bark([
          [x0, g, z0],
          [x0, up, z0],
          [x1, up, z0],
          [x1, g, z0],
        ]);
        bark([
          [x0, g, z1],
          [x1, g, z1],
          [x1, up, z1],
          [x0, up, z1],
        ]);
      }
    }
  }
  return writer.finish();
}

/**
 * Floating land of a tile as boxy slabs, as buildFarSkyArrays lays them out:
 * a top and an underside per cell that carries sky land, a full wall where
 * the land ends, and steps where two land cells' tops or bottoms differ. All
 * faces wear `skyClass`.
 */
export function buildFarSkyMesh(input: FarMeshInput): FarMeshData | null {
  const { sky, size, step, skyClass } = input;
  if (!sky) return null;
  const cells = size - 1;
  const has = (i: number, j: number) => sky[(j * size + i) * 2] > 0;
  const topOf = (i: number, j: number) => Math.round(sky[(j * size + i) * 2]);
  const bottomOf = (i: number, j: number) =>
    Math.round(sky[(j * size + i) * 2 + 1]);
  const writer = new QuadWriter(cells * cells * 2);
  const s = step;
  const wall = (corners: [number, number, number][], i: number, j: number) =>
    writer.quad(
      corners,
      OPEN,
      topOf(i, j),
      topOf(i, j),
      skyClass,
      FAR_FACE_KIND.wall,
      0,
      NEUTRAL_TINT,
    );
  for (let j = 0; j < cells; j++) {
    const z0 = j * s;
    const z1 = z0 + s;
    for (let i = 0; i < cells; i++) {
      const x0 = i * s;
      const x1 = x0 + s;
      const here = has(i, j);
      if (here) {
        const t = topOf(i, j);
        const b = bottomOf(i, j);
        writer.quad(
          [
            [x0, t, z0],
            [x0, t, z1],
            [x1, t, z1],
            [x1, t, z0],
          ],
          OPEN,
          t,
          t,
          skyClass,
          FAR_FACE_KIND.top,
          0,
          NEUTRAL_TINT,
        );
        writer.quad(
          [
            [x1, b, z0],
            [x1, b, z1],
            [x0, b, z1],
            [x0, b, z0],
          ],
          OPEN,
          t,
          t,
          skyClass,
          FAR_FACE_KIND.bottom,
          0,
          NEUTRAL_TINT,
        );
      }
      const east = has(i + 1, j);
      if (here !== east) {
        const [ci, cj] = here ? [i, j] : [i + 1, j];
        const b = bottomOf(ci, cj);
        const t = topOf(ci, cj);
        wall(
          here
            ? [
                [x1, b, z0],
                [x1, t, z0],
                [x1, t, z1],
                [x1, b, z1],
              ]
            : [
                [x1, b, z1],
                [x1, t, z1],
                [x1, t, z0],
                [x1, b, z0],
              ],
          ci,
          cj,
        );
      } else if (here) {
        const t0 = topOf(i, j);
        const t1 = topOf(i + 1, j);
        if (t0 !== t1) {
          const [lo, hi, ci, faces] =
            t0 > t1 ? [t1, t0, i, 1] : [t0, t1, i + 1, -1];
          wall(
            faces > 0
              ? [
                  [x1, lo, z0],
                  [x1, hi, z0],
                  [x1, hi, z1],
                  [x1, lo, z1],
                ]
              : [
                  [x1, lo, z1],
                  [x1, hi, z1],
                  [x1, hi, z0],
                  [x1, lo, z0],
                ],
            ci,
            j,
          );
        }
      }
      const south = has(i, j + 1);
      if (here !== south) {
        const [ci, cj] = here ? [i, j] : [i, j + 1];
        const b = bottomOf(ci, cj);
        const t = topOf(ci, cj);
        wall(
          here
            ? [
                [x0, b, z1],
                [x1, b, z1],
                [x1, t, z1],
                [x0, t, z1],
              ]
            : [
                [x0, t, z1],
                [x1, t, z1],
                [x1, b, z1],
                [x0, b, z1],
              ],
          ci,
          cj,
        );
      } else if (here) {
        const t0 = topOf(i, j);
        const t1 = topOf(i, j + 1);
        if (t0 !== t1) {
          const [lo, hi, cj, faces] =
            t0 > t1 ? [t1, t0, j, 1] : [t0, t1, j + 1, -1];
          wall(
            faces > 0
              ? [
                  [x0, lo, z1],
                  [x1, lo, z1],
                  [x1, hi, z1],
                  [x0, hi, z1],
                ]
              : [
                  [x0, hi, z1],
                  [x1, hi, z1],
                  [x1, lo, z1],
                  [x0, lo, z1],
                ],
            i,
            cj,
          );
        }
      }
    }
  }
  return writer.finish();
}
