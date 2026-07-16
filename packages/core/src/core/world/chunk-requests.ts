export type ChunkRequestCandidate = {
  cx: number;
  cz: number;
  distanceSquared: number;
  isInView: boolean;
};

export function compareChunkRequestPriority(
  a: ChunkRequestCandidate,
  b: ChunkRequestCandidate,
): number {
  if (a.isInView !== b.isInView) {
    return a.isInView ? -1 : 1;
  }

  return a.distanceSquared - b.distanceSquared;
}
