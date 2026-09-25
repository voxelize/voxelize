/**
 * Counts loaded chunks whose data came back under a new server id and
 * reports them as one line per burst, never one per chunk.
 *
 * A server process mints ids for the chunks it generates, so a page that
 * rejoins a restarted server gets every chunk the server had not saved back
 * under a new id — hundreds at once. Each is the same place on the map and
 * is replaced in place ({@link RawChunk.setData}); this keeps that visible
 * without flooding the console.
 */
export class ChunkIdReplacementReport {
  private count = 0;
  private lastAt = 0;

  /** @param quietMs How long the burst must go quiet before it is reported. */
  constructor(private readonly quietMs = 3000) {}

  note(now: number): void {
    this.count += 1;
    this.lastAt = now;
  }

  /**
   * The burst's count once no replacement has landed for `quietMs`, or
   * `force` to end it early (a new rejoin starts its own count); `null`
   * while it is still going or when there is nothing to report.
   */
  take(now: number, force = false): number | null {
    if (this.count === 0) return null;
    if (!force && now - this.lastAt < this.quietMs) return null;
    const count = this.count;
    this.count = 0;
    return count;
  }
}
