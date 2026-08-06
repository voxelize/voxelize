export type FrameSamplerOptions = {
  historySize?: number;
  publishIntervalMs?: number;
  maxPlausibleFrameMs?: number;
};

export class FrameSampler {
  readonly historySize: number;

  private readonly publishIntervalMs: number;
  private readonly maxPlausibleFrameMs: number;
  private readonly frameTimes: number[] = [];
  private lastFrameAt = performance.now();
  private lastPublishAt = 0;
  private publishedFps = 0;
  private publishedFrameMs = 0;
  private publishedWorstFrameMs = 0;
  private publishedRevision = 0;

  constructor(options: FrameSamplerOptions = {}) {
    this.historySize = options.historySize ?? 80;
    this.publishIntervalMs = options.publishIntervalMs ?? 200;
    this.maxPlausibleFrameMs = options.maxPlausibleFrameMs ?? 1000;
  }

  update(): void {
    const now = performance.now();
    const frameMs = now - this.lastFrameAt;
    this.lastFrameAt = now;

    // A backgrounded tab resumes with a multi-second gap that never rendered;
    // counting it would poison the average long after the tab is live again.
    if (frameMs <= 0 || frameMs > this.maxPlausibleFrameMs) return;

    this.frameTimes.push(frameMs);
    if (this.frameTimes.length > this.historySize) this.frameTimes.shift();

    if (now - this.lastPublishAt < this.publishIntervalMs) return;
    this.lastPublishAt = now;

    let total = 0;
    let worst = 0;
    for (const ms of this.frameTimes) {
      total += ms;
      if (ms > worst) worst = ms;
    }

    const average = total / this.frameTimes.length;
    this.publishedFps = Math.round(1000 / average);
    this.publishedFrameMs = Math.round(average * 10) / 10;
    this.publishedWorstFrameMs = Math.round(worst * 10) / 10;
    this.publishedRevision += 1;
  }

  get fps(): number {
    return this.publishedFps;
  }

  get frameMs(): number {
    return this.publishedFrameMs;
  }

  get worstFrameMs(): number {
    return this.publishedWorstFrameMs;
  }

  // Bumped once per publish so renderers can skip redrawing a stale graph.
  get revision(): number {
    return this.publishedRevision;
  }

  get frames(): readonly number[] {
    return this.frameTimes;
  }
}
