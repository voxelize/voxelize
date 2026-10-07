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

/** Flat typed arrays for one tile's land mesh. */
export type FarMeshArrays = {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
};

/**
 * The land heightfield of a tile as world-space triangles with a colour per
 * vertex from `palette` (RGB triples in 0..1, one per class; a class past
 * the palette takes its last entry).
 */
export function buildFarLandArrays(
  tile: FarTileData,
  palette: Float32Array,
): FarMeshArrays {
  const { size, step, heights, colors, key } = tile;
  const span = (size - 1) * step;
  const originX = key.tx * span;
  const originZ = key.tz * span;
  const count = size * size;
  const positions = new Float32Array(count * 3);
  const colorArray = new Float32Array(count * 3);
  const classes = Math.max(1, palette.length / 3);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const at = j * size + i;
      positions[at * 3] = originX + i * step;
      positions[at * 3 + 1] = heights[at];
      positions[at * 3 + 2] = originZ + j * step;
      const c = Math.min(colors[at], classes - 1) * 3;
      colorArray[at * 3] = palette[c] ?? 0.5;
      colorArray[at * 3 + 1] = palette[c + 1] ?? 0.5;
      colorArray[at * 3 + 2] = palette[c + 2] ?? 0.5;
    }
  }
  const cells = (size - 1) * (size - 1);
  const indices = new Uint32Array(cells * 6);
  let n = 0;
  for (let j = 0; j < size - 1; j++) {
    for (let i = 0; i < size - 1; i++) {
      const a = j * size + i;
      const b = a + 1;
      const c = a + size;
      const d = c + 1;
      // Counter-clockwise seen from above (+y), the split along the
      // shorter diagonal so ridges and gullies keep their line.
      const ad = Math.abs(heights[a] - heights[d]);
      const bc = Math.abs(heights[b] - heights[c]);
      if (ad <= bc) {
        indices[n++] = a;
        indices[n++] = c;
        indices[n++] = d;
        indices[n++] = a;
        indices[n++] = d;
        indices[n++] = b;
      } else {
        indices[n++] = a;
        indices[n++] = c;
        indices[n++] = b;
        indices[n++] = b;
        indices[n++] = c;
        indices[n++] = d;
      }
    }
  }
  return { positions, colors: colorArray, indices };
}

/**
 * Floating land of a tile as slabs: a top heightfield over every cell whose
 * four corners carry sky land, the matching underside, and a vertical wall
 * along every cell edge where the land ends. Returns null when the tile
 * has no floating land.
 */
export function buildFarSkyArrays(
  tile: FarTileData,
  topColor: readonly [number, number, number],
  sideColor: readonly [number, number, number],
): FarMeshArrays | null {
  const { sky, size, step, key } = tile;
  if (!sky) return null;
  const span = (size - 1) * step;
  const originX = key.tx * span;
  const originZ = key.tz * span;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const has = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < size && j < size && sky[(j * size + i) * 2] > 0;
  const cellPresent = (i: number, j: number) =>
    i >= 0 &&
    j >= 0 &&
    i < size - 1 &&
    j < size - 1 &&
    has(i, j) &&
    has(i + 1, j) &&
    has(i, j + 1) &&
    has(i + 1, j + 1);
  const push = (x: number, y: number, z: number, c: readonly number[]) => {
    positions.push(x, y, z);
    colors.push(c[0], c[1], c[2]);
    return positions.length / 3 - 1;
  };
  const top = (i: number, j: number) => sky[(j * size + i) * 2];
  const bottom = (i: number, j: number) => sky[(j * size + i) * 2 + 1];
  const wx = (i: number) => originX + i * step;
  const wz = (j: number) => originZ + j * step;

  for (let j = 0; j < size - 1; j++) {
    for (let i = 0; i < size - 1; i++) {
      if (!cellPresent(i, j)) continue;
      // Top, counter-clockwise from above.
      const a = push(wx(i), top(i, j), wz(j), topColor);
      const b = push(wx(i + 1), top(i + 1, j), wz(j), topColor);
      const c = push(wx(i), top(i, j + 1), wz(j + 1), topColor);
      const d = push(wx(i + 1), top(i + 1, j + 1), wz(j + 1), topColor);
      indices.push(a, c, d, a, d, b);
      // Underside, wound to face down.
      const a2 = push(wx(i), bottom(i, j), wz(j), sideColor);
      const b2 = push(wx(i + 1), bottom(i + 1, j), wz(j), sideColor);
      const c2 = push(wx(i), bottom(i, j + 1), wz(j + 1), sideColor);
      const d2 = push(wx(i + 1), bottom(i + 1, j + 1), wz(j + 1), sideColor);
      indices.push(a2, d2, c2, a2, b2, d2);
      // Walls where a neighbouring cell has no land: two triangles from the
      // edge's tops down to its bottoms.
      const wall = (i0: number, j0: number, i1: number, j1: number) => {
        const t0 = push(wx(i0), top(i0, j0), wz(j0), sideColor);
        const t1 = push(wx(i1), top(i1, j1), wz(j1), sideColor);
        const b0 = push(wx(i0), bottom(i0, j0), wz(j0), sideColor);
        const b1 = push(wx(i1), bottom(i1, j1), wz(j1), sideColor);
        indices.push(t0, b0, b1, t0, b1, t1);
      };
      if (!cellPresent(i, j - 1)) wall(i, j, i + 1, j);
      if (!cellPresent(i, j + 1)) wall(i + 1, j + 1, i, j + 1);
      if (!cellPresent(i - 1, j)) wall(i, j + 1, i, j);
      if (!cellPresent(i + 1, j)) wall(i + 1, j, i + 1, j + 1);
    }
  }
  if (indices.length === 0) return null;
  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
  };
}

/**
 * The chunk-coverage mask: `size x size` texels of chunk columns from
 * `(originCx, originCz)`, 255 where a chunk draws real terrain and 0 where
 * the far layer may show. Chunks outside the window are ignored.
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
