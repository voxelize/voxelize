/**
 * Finished re-meshes waiting to be swapped in until the chunks around them
 * are on screen.
 *
 * A chunk meshed while a neighbour was missing draws a wall along that
 * border (the worker reads a missing neighbour as air). When the neighbour's
 * data lands, the chunk is re-meshed without the wall. Swapped in before the
 * neighbour's own mesh, that re-mesh left the border open for as long as the
 * neighbour took to mesh, and the terrain behind showed through the gap:
 * chunks seemed to blink out and back in along the loading edge. A re-mesh
 * of a section already on screen therefore waits here, its old mesh still
 * drawn, until no ready neighbour is missing its geometry.
 */
export type HeldMeshResult<G> = {
  cx: number;
  cz: number;
  level: number;
  geometries: G;
  connectivity: number;
  generation: number;
  heldAt: number;
};

export class BorderSwapHold<G> {
  private held = new Map<string, HeldMeshResult<G>>();

  private static keyOf(cx: number, cz: number, level: number) {
    return `${cx},${cz}:${level}`;
  }

  /** Holds `result`; a newer result for the same section replaces it. */
  hold(result: HeldMeshResult<G>) {
    this.held.set(
      BorderSwapHold.keyOf(result.cx, result.cz, result.level),
      result,
    );
  }

  /** Takes every held result of the eight chunks around (cx, cz). */
  takeAround(cx: number, cz: number): HeldMeshResult<G>[] {
    const taken: HeldMeshResult<G>[] = [];
    for (const [key, result] of this.held) {
      const dx = result.cx - cx;
      const dz = result.cz - cz;
      if (Math.abs(dx) > 1 || Math.abs(dz) > 1 || (dx === 0 && dz === 0)) {
        continue;
      }
      this.held.delete(key);
      taken.push(result);
    }
    return taken;
  }

  /** Takes results held for at least `maxAgeMs`. */
  takeOlderThan(nowMs: number, maxAgeMs: number): HeldMeshResult<G>[] {
    const taken: HeldMeshResult<G>[] = [];
    for (const [key, result] of this.held) {
      if (nowMs - result.heldAt < maxAgeMs) continue;
      this.held.delete(key);
      taken.push(result);
    }
    return taken;
  }

  /** Forgets the results of an unloaded chunk. */
  dropChunk(cx: number, cz: number) {
    for (const [key, result] of this.held) {
      if (result.cx === cx && result.cz === cz) this.held.delete(key);
    }
  }

  get size() {
    return this.held.size;
  }

  clear() {
    this.held.clear();
  }
}
