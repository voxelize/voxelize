/**
 * The pure half of the far-terrain layer: what a tile is on the wire and
 * the chunk-coverage mask that hides the layer under loaded chunks. Which
 * tiles a viewer draws is far-terrain-lod.ts, the geometry a tile becomes
 * far-terrain-mesh.ts. No three.js objects here so every rule is a plain
 * unit test.
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
  /**
   * What each material class is made of, indexed by a sample's class.
   * Absent leaves the colours to the client's palette.
   */
  materials?: FarTerrainMaterial[];
  /** The class floating land is painted with. */
  skyMaterial?: number;
  /** The class of the sea floor, which shallow far water shows through. */
  seabedMaterial?: number;
  /** The tree species tiles' canopy samples name, by index. */
  trees?: FarTerrainTree[];
  /**
   * What one client may ask for: the server refuses the rest of a request
   * past it, and a refused tile is asked again only after the retry window.
   */
  budget?: FarTerrainBudget;
};

/** One client's request budget: a token bucket refilled by wall time. */
export type FarTerrainBudget = {
  tilesPerSecond: number;
  burst: number;
  maxTilesPerRequest: number;
};

/** A tree species: the block its crown is made of and the log it stands on. */
export type FarTerrainTree = { leaves: number; log: number };

/** The blocks one material class is made of (registry block ids). */
export type FarTerrainMaterial = {
  /** The block whose upward face is the class's ground. */
  top: number;
  /**
   * The block under it: a wall shows `top`'s side face on its highest
   * block, this block's below for `sideDepth` blocks, and `deep` under that.
   */
  side: number;
  /** The block below the side block (rock under soil); `side` when absent. */
  deep?: number;
  /** Blocks of `side` under the top block before `deep`; 3 when absent. */
  sideDepth?: number;
  /**
   * Blocks lying flat over part of the ground (snow, an outcrop), with the
   * share of it each hides.
   */
  covers?: { block: number; share: number }[];
};

/**
 * What one block face looks like from far away: the mean of its texels in
 * linear RGB, whether it takes a sample's regional tint (the face's
 * `stageTintMask`), and the texels themselves (RGBA8 sRGB, `size` square,
 * top row first) when the face has a texture.
 */
export type FarFaceLook = {
  color: readonly [number, number, number];
  isTinted: boolean;
  pixels?: ArrayLike<number>;
  size?: number;
};

export type FarFaceSide = "top" | "side";

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
  /** Material class per sample. */
  colors: Uint8Array;
  /** `(top, bottom)` per sample of floating land, 0 where none; or null. */
  sky: Uint16Array | null;
  /**
   * RGB tint per sample for the faces that take one, 128 meaning
   * unchanged (a chunk's `biomeTints` encoding); or null for none.
   */
  tints: Uint8Array | null;
  /**
   * The tree crowns over each sample's cell as `(top, bottom, cover, kind)`:
   * top and underside in blocks above the surface, the share of the cell
   * covered (255 all), and the species index with bit 7 on the cell its
   * trunk stands in; or null for none.
   */
  canopy: Uint8Array | null;
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
  let tints: Uint8Array | null = null;
  if (typeof r.tints === "string") {
    tints = toU8(r.tints);
    if (tints.length !== count * 3) return null;
  }
  let canopy: Uint8Array | null = null;
  if (typeof r.canopy === "string") {
    canopy = toU8(r.canopy);
    if (canopy.length !== count * 4) return null;
  }
  if (bytes === 0) {
    // Already-parsed payloads count their base64 bodies plus the header.
    const length = (field: unknown) =>
      typeof field === "string" ? field.length : 0;
    bytes =
      r.heights.length +
      r.colors.length +
      length(r.sky) +
      length(r.tints) +
      length(r.canopy) +
      64;
  }
  return {
    key: { level, tx, tz },
    step,
    size,
    heights,
    colors,
    sky,
    tints,
    canopy,
    bytes,
  };
}

const SRGB_TO_LINEAR = (() => {
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    table[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return table;
})();

/**
 * The mean colour of sRGB RGBA8 pixels in linear RGB, weighted by alpha so
 * a cutout's holes do not darken it; null when every pixel is transparent.
 * Averaged in linear light, as the GPU's filtering of an sRGB texture does.
 */
export function meanLinearRgb(
  pixels: ArrayLike<number>,
): [number, number, number] | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;
  for (let at = 0; at + 3 < pixels.length; at += 4) {
    const alpha = pixels[at + 3] / 255;
    if (alpha <= 0) continue;
    r += SRGB_TO_LINEAR[pixels[at]] * alpha;
    g += SRGB_TO_LINEAR[pixels[at + 1]] * alpha;
    b += SRGB_TO_LINEAR[pixels[at + 2]] * alpha;
    weight += alpha;
  }
  return weight > 0 ? [r / weight, g / weight, b / weight] : null;
}

/** World blocks one tile of `level` spans along x and z. */
export function farTileSpan(descriptor: FarTerrainDescriptor, level: number) {
  return (descriptor.tileSamples - 1) * (descriptor.baseStep << level);
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
 * until the chunk's own terrain lands, unless the far layer already draws
 * that column away from the viewer. The disc is the one the chunk
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
