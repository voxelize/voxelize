/**
 * The pure half of the far-terrain layer: what a tile is on the wire, which
 * tiles a viewer needs for each detail ring, the geometry a tile becomes,
 * and the chunk-coverage mask that hides the layer under loaded chunks. No
 * three.js objects here so every rule is a plain unit test.
 */

/** What the server tells every client about its far terrain (INIT options). */
export type FarTerrainDescriptor = {
  /** Blocks between samples at the finest level; each level doubles it. */
  baseStep: number;
  /** Samples per tile side including the shared edge row (33 -> 32 cells). */
  tileSamples: number;
  /** Detail levels the server serves, 1..4. */
  levels: number;
  /** The y of the far water plane. */
  waterSurface: number;
};

export type FarTileKey = { level: number; tx: number; tz: number };

export const farTileId = ({ level, tx, tz }: FarTileKey) =>
  `${level}:${tx}:${tz}`;

/** One decoded tile. Samples are row-major by z then x. */
export type FarTileData = {
  key: FarTileKey;
  /** Blocks between samples. */
  step: number;
  /** Samples per side. */
  size: number;
  /** Top face y per sample. */
  heights: Uint16Array;
  /** Colour class per sample. */
  colors: Uint8Array;
  /** `(top, bottom)` per sample of floating land, 0 where none; or null. */
  sky: Uint16Array | null;
  /** Bytes of the reply payload, for the wire budget. */
  bytes: number;
};

const toU8 = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const toU16 = (base64: string): Uint16Array => {
  const bytes = toU8(base64);
  const out = new Uint16Array(bytes.length >> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = bytes[2 * i] | (bytes[2 * i + 1] << 8);
  }
  return out;
};

/**
 * A reply payload (already parsed from JSON, or the JSON string) to a tile,
 * or null when it is not one: every array must hold exactly `size * size`
 * samples.
 */
export function decodeFarTerrainReply(payload: unknown): FarTileData | null {
  let bytes = 0;
  let reply = payload;
  if (typeof reply === "string") {
    bytes = reply.length;
    try {
      reply = JSON.parse(reply);
    } catch {
      return null;
    }
  }
  if (!reply || typeof reply !== "object") return null;
  const r = reply as Record<string, unknown>;
  const { level, tx, tz, step, size } = r;
  if (
    typeof level !== "number" ||
    typeof tx !== "number" ||
    typeof tz !== "number" ||
    typeof step !== "number" ||
    typeof size !== "number" ||
    typeof r.heights !== "string" ||
    typeof r.colors !== "string" ||
    size < 2 ||
    step < 1
  ) {
    return null;
  }
  const count = size * size;
  const heights = toU16(r.heights);
  const colors = toU8(r.colors);
  if (heights.length !== count || colors.length !== count) return null;
  let sky: Uint16Array | null = null;
  if (typeof r.sky === "string") {
    sky = toU16(r.sky);
    if (sky.length !== count * 2) return null;
  }
  if (bytes === 0) {
    // Already-parsed payloads count their base64 bodies plus the header.
    const skyLength = typeof r.sky === "string" ? r.sky.length : 0;
    bytes = r.heights.length + r.colors.length + skyLength + 64;
  }
  return {
    key: { level, tx, tz },
    step,
    size,
    heights,
    colors,
    sky,
    bytes,
  };
}

/** World blocks one tile of `level` spans along x and z. */
export function farTileSpan(descriptor: FarTerrainDescriptor, level: number) {
  return (descriptor.tileSamples - 1) * (descriptor.baseStep << level);
}

/** A detail ring: horizontal distances from the viewer it draws between. */
export type FarRing = { level: number; inner: number; outer: number };

/**
 * The rings a far layer reaching `distance` blocks needs. The finest level
 * reaches `max(256, renderDistance)` and each coarser level doubles that,
 * so the cells of every ring subtend about the same angle; the last ring
 * the server offers stretches to the distance. Inside the render distance
 * the chunk-coverage mask does the hiding, so ring 0 starts at 0.
 */
export function farTerrainRings(
  descriptor: FarTerrainDescriptor,
  renderDistance: number,
  distance: number,
): FarRing[] {
  if (distance <= 0 || descriptor.levels <= 0) return [];
  const rings: FarRing[] = [];
  let inner = 0;
  let reach = Math.max(256, renderDistance);
  for (let level = 0; level < descriptor.levels; level++) {
    const isLast = level === descriptor.levels - 1;
    const outer = isLast ? distance : Math.min(distance, reach);
    if (outer > inner) rings.push({ level, inner, outer });
    if (outer >= distance) break;
    inner = outer;
    reach *= 2;
  }
  return rings;
}

/**
 * The tiles of `span` blocks a viewer at `(x, z)` needs for `ring`, nearest
 * first: every tile whose square comes within `margin` of the annulus.
 */
export function selectFarTiles(
  x: number,
  z: number,
  ring: FarRing,
  span: number,
  margin = 0,
): FarTileKey[] {
  const outer = ring.outer + margin;
  const inner = Math.max(0, ring.inner - margin);
  const txMin = Math.floor((x - outer) / span);
  const txMax = Math.floor((x + outer) / span);
  const tzMin = Math.floor((z - outer) / span);
  const tzMax = Math.floor((z + outer) / span);
  const picked: { key: FarTileKey; distance: number }[] = [];
  for (let tx = txMin; tx <= txMax; tx++) {
    for (let tz = tzMin; tz <= tzMax; tz++) {
      const x0 = tx * span;
      const z0 = tz * span;
      const x1 = x0 + span;
      const z1 = z0 + span;
      // Nearest and farthest points of the square from the viewer.
      const nx = Math.max(0, x0 - x, x - x1);
      const nz = Math.max(0, z0 - z, z - z1);
      const nearest = Math.hypot(nx, nz);
      if (nearest > outer) continue;
      const fx = Math.max(Math.abs(x - x0), Math.abs(x - x1));
      const fz = Math.max(Math.abs(z - z0), Math.abs(z - z1));
      const farthest = Math.hypot(fx, fz);
      if (farthest < inner) continue;
      const cx = x0 + span / 2;
      const cz = z0 + span / 2;
      picked.push({
        key: { level: ring.level, tx, tz },
        distance: Math.hypot(cx - x, cz - z),
      });
    }
  }
  picked.sort((a, b) => a.distance - b.distance);
  return picked.map((p) => p.key);
}

/** The world-space box a tile's land and floating land fit in. */
export type FarTileBounds = {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
};

/**
 * The box every mesh of `tile` fits in: its span in x and z, and from its
 * lowest height (or sky bottom) to its highest (or sky top) in y.
 */
export function farTileBounds(tile: FarTileData): FarTileBounds {
  const { size, step, heights, sky, key } = tile;
  const span = (size - 1) * step;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let at = 0; at < heights.length; at++) {
    const h = heights[at];
    if (h < y0) y0 = h;
    if (h > y1) y1 = h;
  }
  if (sky) {
    for (let at = 0; at < sky.length; at += 2) {
      if (sky[at] === 0) continue;
      if (sky[at] > y1) y1 = sky[at];
      if (sky[at + 1] < y0) y0 = sky[at + 1];
    }
  }
  if (!Number.isFinite(y0)) y0 = 0;
  if (!Number.isFinite(y1)) y1 = 0;
  return {
    x0: key.tx * span,
    y0: Math.round(y0),
    z0: key.tz * span,
    x1: key.tx * span + span,
    y1: Math.round(y1),
    z1: key.tz * span + span,
  };
}

/** Flat typed arrays for one tile's land mesh. */
export type FarMeshArrays = {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
};

/**
 * Axis-aligned quads into flat typed arrays, four vertices each so every
 * face keeps its own flat colour. `a b c d` run counter-clockwise seen from
 * the side the face shows; the triangles are `a b c` and `a c d`.
 */
class FarQuadWriter {
  positions: Float32Array;

  colors: Float32Array;

  indices: Uint32Array;

  vertices = 0;

  indexCount = 0;

  constructor(maxQuads: number) {
    this.positions = new Float32Array(maxQuads * 12);
    this.colors = new Float32Array(maxQuads * 12);
    this.indices = new Uint32Array(maxQuads * 6);
  }

  private vertex(x: number, y: number, z: number, c: readonly number[]) {
    const at = this.vertices * 3;
    this.positions[at] = x;
    this.positions[at + 1] = y;
    this.positions[at + 2] = z;
    this.colors[at] = c[0];
    this.colors[at + 1] = c[1];
    this.colors[at + 2] = c[2];
    return this.vertices++;
  }

  private close(a: number) {
    const n = this.indexCount;
    this.indices[n] = a;
    this.indices[n + 1] = a + 1;
    this.indices[n + 2] = a + 2;
    this.indices[n + 3] = a;
    this.indices[n + 4] = a + 2;
    this.indices[n + 5] = a + 3;
    this.indexCount = n + 6;
  }

  /** A horizontal quad over `[x0, x1] x [z0, z1]` at `y`, facing up or down. */
  flat(
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    y: number,
    isUp: boolean,
    c: readonly number[],
  ) {
    const a = this.vertex(x0, y, z0, c);
    if (isUp) {
      this.vertex(x0, y, z1, c);
      this.vertex(x1, y, z1, c);
      this.vertex(x1, y, z0, c);
    } else {
      this.vertex(x1, y, z0, c);
      this.vertex(x1, y, z1, c);
      this.vertex(x0, y, z1, c);
    }
    this.close(a);
  }

  /** A wall in the plane `x = x`, from `y0` up to `y1`, facing +x or -x. */
  wallX(
    x: number,
    z0: number,
    z1: number,
    y0: number,
    y1: number,
    facesPositive: boolean,
    c: readonly number[],
  ) {
    const a = this.vertex(x, y0, z0, c);
    if (facesPositive) {
      this.vertex(x, y1, z0, c);
      this.vertex(x, y1, z1, c);
      this.vertex(x, y0, z1, c);
    } else {
      this.vertex(x, y0, z1, c);
      this.vertex(x, y1, z1, c);
      this.vertex(x, y1, z0, c);
    }
    this.close(a);
  }

  /** A wall in the plane `z = z`, from `y0` up to `y1`, facing +z or -z. */
  wallZ(
    z: number,
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    facesPositive: boolean,
    c: readonly number[],
  ) {
    const a = this.vertex(x0, y0, z, c);
    if (facesPositive) {
      this.vertex(x1, y0, z, c);
      this.vertex(x1, y1, z, c);
      this.vertex(x0, y1, z, c);
    } else {
      this.vertex(x0, y1, z, c);
      this.vertex(x1, y1, z, c);
      this.vertex(x1, y0, z, c);
    }
    this.close(a);
  }

  get isEmpty() {
    return this.indexCount === 0;
  }

  /** The arrays, trimmed to what was written when that is less. */
  finish(): FarMeshArrays {
    const full = this.vertices * 3 === this.positions.length;
    return {
      positions: full
        ? this.positions
        : this.positions.subarray(0, this.vertices * 3),
      colors: full ? this.colors : this.colors.subarray(0, this.vertices * 3),
      indices: full ? this.indices : this.indices.subarray(0, this.indexCount),
    };
  }
}

const GREY: readonly number[] = [0.5, 0.5, 0.5];

/**
 * The land of a tile as flat-topped columns, so the far layer steps like
 * distant blocks instead of rolling: one quad per cell at its sample's
 * height (whole blocks), and a vertical wall along every cell edge whose
 * two sides differ in height, from the lower top up to the higher one,
 * facing the lower side and coloured as the higher column. The cell of
 * sample `(i, j)` spans `[i, i + 1) x [j, j + 1)` steps, so the last sample
 * row is the first cell of the next tile: this tile walls that shared edge
 * from both heights and the next tile leaves its low edge alone, so no edge
 * is walled twice and none is missed. Colours are RGB triples in 0..1 from
 * `palette`, one per class; a class past the palette takes its last entry.
 */
export function buildFarLandArrays(
  tile: FarTileData,
  palette: Float32Array,
): FarMeshArrays {
  const { size, step, heights, colors, key } = tile;
  const span = (size - 1) * step;
  const originX = key.tx * span;
  const originZ = key.tz * span;
  const cells = size - 1;
  const classes = Math.max(1, Math.floor(palette.length / 3));
  const triples: number[][] = [];
  for (let c = 0; c < classes; c++) {
    triples.push(
      palette.length >= 3
        ? [palette[c * 3], palette[c * 3 + 1], palette[c * 3 + 2]]
        : [...GREY],
    );
  }
  const colorOf = (i: number, j: number) =>
    triples[Math.min(colors[j * size + i], classes - 1)];
  const heightOf = (i: number, j: number) => Math.round(heights[j * size + i]);

  // A top per cell and a wall on each of its +x and +z edges that steps;
  // counted first so the arrays are allocated once at their final size.
  let quads = cells * cells;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const y = heightOf(i, j);
      if (heightOf(i + 1, j) !== y) quads++;
      if (heightOf(i, j + 1) !== y) quads++;
    }
  }
  const writer = new FarQuadWriter(quads);
  for (let j = 0; j < cells; j++) {
    const z0 = originZ + j * step;
    const z1 = z0 + step;
    for (let i = 0; i < cells; i++) {
      const x0 = originX + i * step;
      const x1 = x0 + step;
      const y = heightOf(i, j);
      const color = colorOf(i, j);
      writer.flat(x0, x1, z0, z1, y, true, color);
      const east = heightOf(i + 1, j);
      if (east < y) writer.wallX(x1, z0, z1, east, y, true, color);
      else if (east > y)
        writer.wallX(x1, z0, z1, y, east, false, colorOf(i + 1, j));
      const south = heightOf(i, j + 1);
      if (south < y) writer.wallZ(z1, x0, x1, south, y, true, color);
      else if (south > y)
        writer.wallZ(z1, x0, x1, y, south, false, colorOf(i, j + 1));
    }
  }
  return writer.finish();
}

/**
 * Floating land of a tile as boxy slabs, one column per cell whose sample
 * carries sky land: a flat top at the land's top, a flat underside at its
 * bottom, a full wall from bottom to top along every edge where the land
 * ends, and between two land cells a wall for each step in their tops (from
 * the lower top up, facing it) and in their bottoms (from the deeper bottom
 * up, facing the shallower). Edges are shared with the next tile the same
 * way as the land's. Returns null when the tile has no floating land.
 */
export function buildFarSkyArrays(
  tile: FarTileData,
  topColor: readonly [number, number, number],
  sideColor: readonly [number, number, number],
): FarMeshArrays | null {
  const { sky, size, step, key } = tile;
  if (!sky) return null;
  let present = 0;
  for (let at = 0; at < size * size; at++) if (sky[at * 2] > 0) present++;
  if (present === 0) return null;
  const span = (size - 1) * step;
  const originX = key.tx * span;
  const originZ = key.tz * span;
  const cells = size - 1;
  const has = (i: number, j: number) => sky[(j * size + i) * 2] > 0;
  const top = (i: number, j: number) => Math.round(sky[(j * size + i) * 2]);
  const bottom = (i: number, j: number) =>
    Math.round(sky[(j * size + i) * 2 + 1]);

  // Top, underside and up to two walls on each of the +x and +z edges.
  const writer = new FarQuadWriter(cells * cells * 6);
  for (let j = 0; j < cells; j++) {
    const z0 = originZ + j * step;
    const z1 = z0 + step;
    for (let i = 0; i < cells; i++) {
      const x0 = originX + i * step;
      const x1 = x0 + step;
      const here = has(i, j);
      if (here) {
        writer.flat(x0, x1, z0, z1, top(i, j), true, topColor);
        writer.flat(x0, x1, z0, z1, bottom(i, j), false, sideColor);
      }
      const east = has(i + 1, j);
      if (here && !east) {
        writer.wallX(x1, z0, z1, bottom(i, j), top(i, j), true, sideColor);
      } else if (!here && east) {
        writer.wallX(
          x1,
          z0,
          z1,
          bottom(i + 1, j),
          top(i + 1, j),
          false,
          sideColor,
        );
      } else if (here && east) {
        const t0 = top(i, j);
        const t1 = top(i + 1, j);
        if (t0 > t1) writer.wallX(x1, z0, z1, t1, t0, true, sideColor);
        else if (t1 > t0) writer.wallX(x1, z0, z1, t0, t1, false, sideColor);
        const b0 = bottom(i, j);
        const b1 = bottom(i + 1, j);
        if (b0 < b1) writer.wallX(x1, z0, z1, b0, b1, true, sideColor);
        else if (b1 < b0) writer.wallX(x1, z0, z1, b1, b0, false, sideColor);
      }
      const south = has(i, j + 1);
      if (here && !south) {
        writer.wallZ(z1, x0, x1, bottom(i, j), top(i, j), true, sideColor);
      } else if (!here && south) {
        writer.wallZ(
          z1,
          x0,
          x1,
          bottom(i, j + 1),
          top(i, j + 1),
          false,
          sideColor,
        );
      } else if (here && south) {
        const t0 = top(i, j);
        const t1 = top(i, j + 1);
        if (t0 > t1) writer.wallZ(z1, x0, x1, t1, t0, true, sideColor);
        else if (t1 > t0) writer.wallZ(z1, x0, x1, t0, t1, false, sideColor);
        const b0 = bottom(i, j);
        const b1 = bottom(i, j + 1);
        if (b0 < b1) writer.wallZ(z1, x0, x1, b0, b1, true, sideColor);
        else if (b1 < b0) writer.wallZ(z1, x0, x1, b1, b0, false, sideColor);
      }
    }
  }
  return writer.isEmpty ? null : writer.finish();
}

/**
 * How long after loading a chunk column may still count as pending while it
 * owes its mesh. Past this the far layer may show through it again: a
 * section a missing neighbour keeps failing to mesh (the loaded disc's
 * perimeter has no outer halo) must not pin sky over the far layer for the
 * rest of the session, and a chunk that is simply slow gets the old
 * behaviour back, the far layer standing in until its terrain lands.
 */
export const CHUNK_PENDING_GRACE_MS = 6000;

/** What the world knows of one chunk column, for `isChunkColumnPending`. */
export type ChunkColumnState = {
  /** The chunk pipeline's stage for the column; null when nothing is known of it. */
  stage: "requested" | "processing" | "loaded" | null;
  /** A loaded chunk whose data and light are in place. */
  isReady: boolean;
  /** A loaded chunk with a mesh job queued or running at some level. */
  isMeshOwed: boolean;
  /** Milliseconds since the chunk loaded; meaningless until it has. */
  loadedForMs: number;
};

/**
 * Whether a chunk column still owes the viewer its terrain: not loaded at
 * all (not even asked for, asked for, or in flight), or loaded within the
 * grace and not ready or with a mesh still being built. A loaded, ready
 * column with no mesh owed is settled: what it draws, which may be
 * nothing, is final until it changes, so the far layer may show where it
 * is genuinely empty. So is one that has owed its mesh past the grace.
 */
export function isChunkColumnPending(
  column: ChunkColumnState,
  graceMs: number = CHUNK_PENDING_GRACE_MS,
): boolean {
  if (column.stage !== "loaded") return true;
  if (column.isReady && !column.isMeshOwed) return false;
  return column.loadedForMs < graceMs;
}

/**
 * The chunk columns inside the render radius that still owe their terrain
 * (`isChunkColumnPending`): not loaded yet, or loaded with the mesh still
 * being built. Right after arriving
 * somewhere these are the holes the far layer would show through, and from
 * inside a canyon that reads as seeing through the walls for a second; the
 * coverage mask counts them as covered, so sky and fog show there instead
 * until the chunk's own terrain lands. The disc is the one the chunk
 * requests walk; `isPending` answers for one column (a column outside the
 * world, or one loaded and meshed with nothing to draw, is not pending).
 */
export function pendingChunksWithin(
  centerCx: number,
  centerCz: number,
  renderRadius: number,
  isPending: (cx: number, cz: number) => boolean,
): [number, number][] {
  const radius = Math.max(0, Math.floor(renderRadius));
  const radiusSquared = radius * radius;
  const pending: [number, number][] = [];
  for (let ox = -radius; ox <= radius; ox++) {
    for (let oz = -radius; oz <= radius; oz++) {
      if (ox * ox + oz * oz > radiusSquared) continue;
      const cx = centerCx + ox;
      const cz = centerCz + oz;
      if (isPending(cx, cz)) pending.push([cx, cz]);
    }
  }
  return pending;
}

/**
 * The chunk-coverage mask: `size x size` texels of chunk columns from
 * `(originCx, originCz)`, 255 where a chunk draws real terrain (or is still
 * on its way, `pendingChunksWithin`) and 0 where the far layer may show.
 * Chunks outside the window are ignored.
 */
export function buildCoverageMask(
  meshedChunks: Iterable<readonly [number, number]>,
  originCx: number,
  originCz: number,
  size: number,
  into?: Uint8Array,
): Uint8Array {
  const mask =
    into && into.length === size * size ? into : new Uint8Array(size * size);
  mask.fill(0);
  for (const [cx, cz] of meshedChunks) {
    const i = cx - originCx;
    const j = cz - originCz;
    if (i < 0 || j < 0 || i >= size || j >= size) continue;
    mask[j * size + i] = 255;
  }
  return mask;
}

/** Whether the mask hides the far layer at world `(x, z)`. */
export function isCoveredAt(
  mask: Uint8Array,
  originCx: number,
  originCz: number,
  size: number,
  chunkSize: number,
  x: number,
  z: number,
): boolean {
  const i = Math.floor(x / chunkSize) - originCx;
  const j = Math.floor(z / chunkSize) - originCz;
  if (i < 0 || j < 0 || i >= size || j >= size) return false;
  return mask[j * size + i] > 127;
}

/**
 * Tiles to drop: resident tiles no ring needs any more, with a tile of
 * hysteresis so a viewer pacing a boundary does not churn.
 */
export function farTilesToEvict(
  resident: Iterable<FarTileKey>,
  needed: ReadonlySet<string>,
  x: number,
  z: number,
  rings: FarRing[],
  spanOf: (level: number) => number,
): FarTileKey[] {
  const ringOf = new Map(rings.map((ring) => [ring.level, ring]));
  const evict: FarTileKey[] = [];
  for (const key of resident) {
    if (needed.has(farTileId(key))) continue;
    const ring = ringOf.get(key.level);
    if (!ring) {
      evict.push(key);
      continue;
    }
    const span = spanOf(key.level);
    const x0 = key.tx * span;
    const z0 = key.tz * span;
    const nx = Math.max(0, x0 - x, x - (x0 + span));
    const nz = Math.max(0, z0 - z, z - (z0 + span));
    const nearest = Math.hypot(nx, nz);
    if (nearest > ring.outer + span) evict.push(key);
  }
  return evict;
}
