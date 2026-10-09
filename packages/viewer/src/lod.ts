/**
 * Which chunks get real meshes: a disc of chunk columns around the focus,
 * nearest first, sized to what the camera frames. Everything past it is
 * the far layer's.
 */

export type ChunkCoord = [number, number];

/** Chunk columns whose centres lie within `radius` chunks of (cx, cz), nearest first. */
export function chunksAround(
  cx: number,
  cz: number,
  radius: number,
): ChunkCoord[] {
  const out: { c: ChunkCoord; d: number }[] = [];
  const r = Math.max(0, Math.floor(radius));
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      const d = dx * dx + dz * dz;
      if (d <= r * r + r) out.push({ c: [cx + dx, cz + dz], d });
    }
  }
  out.sort((a, b) => a.d - b.d || a.c[0] - b.c[0] || a.c[1] - b.c[1]);
  return out.map((o) => o.c);
}

/**
 * The near radius in chunks for a view framing `span` blocks: enough to
 * fill the frame, never more than `max` (the meshing and memory budget).
 */
export function nearRadiusFor({
  span,
  chunkSize,
  max,
  min = 2,
}: {
  span: number;
  chunkSize: number;
  max: number;
  min?: number;
}): number {
  const wanted = Math.ceil(span / chunkSize / 2) + 1;
  return Math.max(min, Math.min(max, wanted));
}

export const chunkKey = (cx: number, cz: number) => `${cx},${cz}`;

/** Splits `wanted` into batches of at most `size`, keeping the order. */
export function batches<T>(wanted: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < wanted.length; i += size) {
    out.push(wanted.slice(i, i + size));
  }
  return out;
}
