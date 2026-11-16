export type FrameSamplerOptions = {
  historySize?: number;
  publishIntervalMs?: number;
};

export class FrameSampler {
  readonly historySize: number;

  private readonly publishIntervalMs: number;
  private readonly frameTimes: number[] = [];
  private readonly sortScratch: number[] = [];
  private lastFrameAt: number | null = null;
  private lastPublishAt = 0;
  private publishedFps = 0;
  private publishedMedianFps = 0;
  private publishedFrameMs = 0;
  private publishedP95FrameMs = 0;
  private publishedWorstFrameMs = 0;
  private publishedDroppedFrames = 0;
  private publishedRevision = 0;
  private isResumingAfterPause = false;
  private visibilityHandler: (() => void) | null = null;

  constructor(options: FrameSamplerOptions = {}) {
    this.historySize = options.historySize ?? 80;
    this.publishIntervalMs = options.publishIntervalMs ?? 200;

    // Owned here rather than by the host: a sampler that has to be told about
    // its own blind spot is one every new consumer forgets to tell.
    if (typeof document !== "undefined") {
      this.visibilityHandler = () => {
        if (document.visibilityState === "visible") this.noteRenderingResumed();
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }
  }

  // The one interval the sampler refuses, and it refuses it on a fact rather
  // than on the gap's size: rendering that stopped and restarted leaves dead
  // time nobody waited on. Judging that by duration instead would also swallow
  // a genuine multi-second stall, which is the reading that matters most.
  noteRenderingResumed(): void {
    this.isResumingAfterPause = true;
  }

  dispose(): void {
    if (!this.visibilityHandler) return;
    document.removeEventListener("visibilitychange", this.visibilityHandler);
    this.visibilityHandler = null;
  }

  update(): void {
    const now = performance.now();
    const previous = this.lastFrameAt;
    this.lastFrameAt = now;

    if (this.isResumingAfterPause) {
      this.isResumingAfterPause = false;
      return;
    }

    // An interval needs two frames to exist; the first call has only one.
    if (previous === null) return;

    const frameMs = now - previous;
    if (frameMs <= 0) return;

    this.frameTimes.push(frameMs);
    if (this.frameTimes.length > this.historySize) this.frameTimes.shift();

    if (now - this.lastPublishAt < this.publishIntervalMs) return;
    this.lastPublishAt = now;
    this.publish();
  }

  /** Frames delivered per second across the history window: the frames
   * counted against the time they took. A missed refresh lowers it, so it
   * cannot read a full 60 over a window that hitched. */
  get fps(): number {
    return this.publishedFps;
  }

  /** The rate the typical frame is running at. It ignores hitches by design,
   * which makes it the cadence missed refreshes are counted against and the
   * wrong number to show a person on its own. */
  get medianFps(): number {
    return this.publishedMedianFps;
  }

  /** The typical (median) frame time. */
  get frameMs(): number {
    return this.publishedFrameMs;
  }

  get p95FrameMs(): number {
    return this.publishedP95FrameMs;
  }

  get worstFrameMs(): number {
    return this.publishedWorstFrameMs;
  }

  /** Refreshes missed across the history window, counted against the cadence
   * the client is actually holding. One missed refresh in eighty moves `fps`
   * by a single frame; this is the reading that names it. */
  get droppedFrames(): number {
    return this.publishedDroppedFrames;
  }

  // Bumped once per publish so renderers can skip redrawing a stale graph.
  get revision(): number {
    return this.publishedRevision;
  }

  get frames(): readonly number[] {
    return this.frameTimes;
  }

  private publish(): void {
    const sorted = this.sortScratch;
    sorted.length = 0;
    let windowMs = 0;
    for (const ms of this.frameTimes) {
      sorted.push(ms);
      windowMs += ms;
    }
    sorted.sort((a, b) => a - b);

    const median = sorted[sorted.length >> 1];
    if (median <= 0) return;

    // Two rates, because neither is honest alone. The headline is the frames
    // counted against the time they took: the median reads a full 60 through
    // any hitch shorter than half the window, which is exactly when a person
    // feels a lag and sees a number that denies it. The median stays as the
    // cadence -- what a refresh is, for counting the ones that were missed.
    this.publishedFrameMs = Math.round(median * 10) / 10;
    this.publishedMedianFps = Math.round(1000 / median);
    this.publishedFps = Math.round((this.frameTimes.length * 1000) / windowMs);
    this.publishedP95FrameMs =
      Math.round(sorted[Math.floor((sorted.length - 1) * 0.95)] * 10) / 10;
    this.publishedWorstFrameMs =
      Math.round(sorted[sorted.length - 1] * 10) / 10;

    let dropped = 0;
    for (const ms of this.frameTimes) {
      const refreshes = Math.round(ms / median);
      if (refreshes > 1) dropped += refreshes - 1;
    }
    this.publishedDroppedFrames = dropped;
    this.publishedRevision += 1;
  }
}
