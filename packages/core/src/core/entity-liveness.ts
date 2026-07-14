export type EntityLivenessOptions = {
  /**
   * Seconds an entity may go without any message before it is considered
   * lost and released. The server keep-alive cadence is roughly one second,
   * so this should comfortably exceed several missed keep-alives.
   */
  stalenessTimeoutSeconds: number;

  /**
   * Seconds of total message silence after which staleness judgment is
   * suspended. A quiet stream means the connection itself is degraded
   * (disconnect, tab suspension), not that individual entities were lost.
   */
  streamSilenceGraceSeconds: number;
};

/**
 * Tracks when each entity last received a message, distinguishing per-entity
 * silence (a lost entity that should be released) from whole-stream silence
 * (a degraded connection where nothing should be released).
 */
export class EntityLivenessTracker {
  private lastEntityTouch = new Map<string, number>();

  private lastStreamTouch = Number.NEGATIVE_INFINITY;

  constructor(private options: EntityLivenessOptions) {}

  touchStream(nowSeconds: number) {
    this.lastStreamTouch = nowSeconds;
  }

  touchEntity(id: string, nowSeconds: number) {
    this.lastEntityTouch.set(id, nowSeconds);
    this.lastStreamTouch = nowSeconds;
  }

  forget(id: string) {
    this.lastEntityTouch.delete(id);
  }

  collectStale(nowSeconds: number): string[] {
    const { stalenessTimeoutSeconds, streamSilenceGraceSeconds } = this.options;

    if (nowSeconds - this.lastStreamTouch >= streamSilenceGraceSeconds) {
      return [];
    }

    const stale: string[] = [];
    this.lastEntityTouch.forEach((touchedAt, id) => {
      if (nowSeconds - touchedAt >= stalenessTimeoutSeconds) {
        stale.push(id);
      }
    });

    return stale;
  }
}
