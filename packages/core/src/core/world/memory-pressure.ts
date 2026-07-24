/**
 * A single reading of the renderer's JavaScript heap.
 */
export type HeapSample = {
  usedBytes: number;
  limitBytes: number;
};

/**
 * Reads the current heap, or returns `null` when the engine exposes no heap
 * numbers at all (every non-Chromium browser).
 */
export type HeapReader = () => HeapSample | null;

export type MemoryPressureOptions = {
  /**
   * Milliseconds between heap samples. Zero or less disables the watchdog.
   */
  sampleIntervalMs: number;

  /**
   * `usedJSHeapSize / jsHeapSizeLimit` at or above which the renderer is
   * treated as under pressure and load shedding begins. A worker that runs
   * out of V8 heap takes the whole renderer process down with it, so this
   * sits well below the limit rather than near it.
   */
  sheddingHeapRatio: number;

  /**
   * Ratio at or below which pressure is considered relieved. Kept under
   * {@link MemoryPressureOptions.sheddingHeapRatio} so the monitor has
   * hysteresis instead of flapping around a single threshold.
   */
  recoveryHeapRatio: number;

  /**
   * Consecutive over-threshold samples required before shedding engages,
   * so one transient spike (a large chunk batch mid-flight) does not throw
   * away work that was about to be collected anyway.
   */
  sheddingSampleCount: number;

  /**
   * Minimum milliseconds between two shed actions while pressure persists.
   */
  shedCooldownMs: number;
};

export const defaultMemoryPressureOptions: MemoryPressureOptions = {
  sampleIntervalMs: 2000,
  sheddingHeapRatio: 0.8,
  recoveryHeapRatio: 0.65,
  sheddingSampleCount: 2,
  shedCooldownMs: 5000,
};

/**
 * What a sample concluded: `shed` asks the owner to drop load now,
 * `relieved` says pressure is over, `steady` means do nothing.
 */
export type MemoryPressureVerdict = "steady" | "shed" | "relieved";

export type MemoryPressureStatus = {
  /** False on engines that expose no heap numbers; the monitor stays inert. */
  isHeapReadable: boolean;
  isUnderPressure: boolean;
  heapRatio: number;
  heapUsedBytes: number;
  heapLimitBytes: number;
  shedCount: number;
};

type ChromiumHeapInfo = {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
};

export const readChromiumHeap: HeapReader = () => {
  if (typeof performance === "undefined") return null;

  const { memory } = performance as Performance & { memory?: ChromiumHeapInfo };
  if (!memory || memory.jsHeapSizeLimit <= 0) return null;

  return {
    usedBytes: memory.usedJSHeapSize,
    limitBytes: memory.jsHeapSizeLimit,
  };
};

/**
 * Samples the renderer's heap and tells its owner when to shed load.
 *
 * This is the backstop under every individual queue cap: a bounded queue
 * only protects against the growth path someone thought to bound, while a
 * heap watchdog notices the ones nobody found. Sampling is pure and
 * time-injected ({@link MemoryPressureMonitor.sample}) so the state machine
 * is testable without timers, and a missing `performance.memory` degrades to
 * a permanently `steady` monitor rather than a throw.
 */
export class MemoryPressureMonitor {
  public readonly options: MemoryPressureOptions;

  private readonly readHeap: HeapReader;

  private timer: ReturnType<typeof setInterval> | null = null;
  private consecutiveHighSamples = 0;
  private isPressureActive = false;
  private isHeapReadable = false;
  private lastShedAtMs = 0;
  private hasShedOnce = false;
  private shedCount = 0;
  private lastHeapRatio = 0;
  private lastSample: HeapSample = { usedBytes: 0, limitBytes: 0 };

  constructor(
    options: Partial<MemoryPressureOptions> = {},
    readHeap: HeapReader = readChromiumHeap,
  ) {
    const merged = { ...defaultMemoryPressureOptions, ...options };
    this.options = {
      ...merged,
      // An inverted pair would make every sample both trip and recover.
      recoveryHeapRatio: Math.min(
        merged.recoveryHeapRatio,
        merged.sheddingHeapRatio,
      ),
    };
    this.readHeap = readHeap;
  }

  sample(nowMs: number): MemoryPressureVerdict {
    const heap = this.readHeap();

    if (!heap || heap.limitBytes <= 0) {
      this.isHeapReadable = false;
      return "steady";
    }

    this.isHeapReadable = true;
    this.lastSample = heap;
    this.lastHeapRatio = heap.usedBytes / heap.limitBytes;

    if (this.isPressureActive) {
      if (this.lastHeapRatio <= this.options.recoveryHeapRatio) {
        this.isPressureActive = false;
        this.consecutiveHighSamples = 0;
        return "relieved";
      }
      if (
        this.hasShedOnce &&
        nowMs - this.lastShedAtMs < this.options.shedCooldownMs
      ) {
        return "steady";
      }
      return this.recordShed(nowMs);
    }

    if (this.lastHeapRatio < this.options.sheddingHeapRatio) {
      this.consecutiveHighSamples = 0;
      return "steady";
    }

    this.consecutiveHighSamples++;
    if (this.consecutiveHighSamples < this.options.sheddingSampleCount) {
      return "steady";
    }

    this.isPressureActive = true;
    return this.recordShed(nowMs);
  }

  private recordShed(nowMs: number): MemoryPressureVerdict {
    this.lastShedAtMs = nowMs;
    this.hasShedOnce = true;
    this.shedCount++;
    return "shed";
  }

  start(
    onVerdict: (
      verdict: Exclude<MemoryPressureVerdict, "steady">,
      status: MemoryPressureStatus,
    ) => void,
  ): void {
    this.stop();
    if (this.options.sampleIntervalMs <= 0) return;

    this.timer = setInterval(() => {
      const verdict = this.sample(Date.now());
      if (verdict === "steady") return;
      onVerdict(verdict, this.getStatus());
    }, this.options.sampleIntervalMs);
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  getStatus(): MemoryPressureStatus {
    return {
      isHeapReadable: this.isHeapReadable,
      isUnderPressure: this.isPressureActive,
      heapRatio: this.lastHeapRatio,
      heapUsedBytes: this.lastSample.usedBytes,
      heapLimitBytes: this.lastSample.limitBytes,
      shedCount: this.shedCount,
    };
  }
}
