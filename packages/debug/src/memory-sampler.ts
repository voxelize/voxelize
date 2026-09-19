export type HeapReading = {
  usedBytes: number;
  totalBytes: number;
  limitBytes: number;
};

/** One realm's share of a detailed measurement: the page itself or a worker. */
export type DetailedMemoryRealm = {
  bytes: number;
  isWorker: boolean;
};

export type DetailedMemoryReading = {
  totalBytes: number;
  realms: DetailedMemoryRealm[];
};

export type HeapReader = () => HeapReading | null;
export type DetailedMemoryMeasurer =
  () => Promise<DetailedMemoryReading | null>;

export type MemorySamplerOptions = {
  /** How often the heap is read. Reading is cheap; the cadence only bounds
   * how finely the sawtooth is resolved. */
  sampleIntervalMs?: number;
  /** Width of one trend bucket. Each bucket keeps only its lowest reading. */
  bucketMs?: number;
  /** Completed buckets kept for the trend; with `bucketMs` this is the window
   * the growth rate is judged over. */
  bucketCount?: number;
  /** Completed buckets needed before a growth rate is reported at all. A
   * leak is a rate over minutes; the default asks for two of them. */
  minBucketsForTrend?: number;
  /**
   * How long after construction the trend starts recording floors. The
   * heap is still settling when a debug UI comes up -- load-phase caches
   * filling, scaffolding being dropped, a swing of hundreds of megabytes --
   * and none of that is a leak. Readings are live from the first sample;
   * only the trend waits.
   */
  trendGraceMs?: number;
  /** How long after a detailed measurement resolves before the next one is
   * asked for. The browser can take many seconds to answer one. */
  detailedIntervalMs?: number;
  readHeap?: HeapReader;
  measureDetailed?: DetailedMemoryMeasurer | null;
};

type PerformanceWithMemory = Performance & {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
  measureUserAgentSpecificMemory?: () => Promise<{
    bytes: number;
    breakdown: {
      bytes: number;
      attribution: { scope: string }[];
    }[];
  }>;
};

/** The legacy Chrome heap counters. Absent everywhere else, and quantised to
 * coarse buckets in a renderer that is not locked to one site -- which on
 * desktop it always is. */
export const readPerformanceMemory: HeapReader = () => {
  if (typeof performance === "undefined") return null;
  const memory = (performance as PerformanceWithMemory).memory;
  if (!memory) return null;
  return {
    usedBytes: memory.usedJSHeapSize,
    totalBytes: memory.totalJSHeapSize,
    limitBytes: memory.jsHeapSizeLimit,
  };
};

/** The precise, cross-origin-isolated measurement. Unlike the legacy counters
 * it sees every realm the page owns -- dedicated workers included -- which is
 * where a mesher or lighting cache grows without the main heap ever moving. */
export const measureUserAgentSpecificMemory: DetailedMemoryMeasurer | null =
  typeof performance !== "undefined" &&
  typeof (performance as PerformanceWithMemory)
    .measureUserAgentSpecificMemory === "function"
    ? async () => {
        const measure = (performance as PerformanceWithMemory)
          .measureUserAgentSpecificMemory;
        if (!measure) return null;
        const result = await measure.call(performance);
        return {
          totalBytes: result.bytes,
          realms: result.breakdown.map((entry) => ({
            bytes: entry.bytes,
            isWorker: entry.attribution.some(
              (attribution) =>
                attribution.scope === "DedicatedWorkerGlobalScope" ||
                attribution.scope === "SharedWorkerGlobalScope" ||
                attribution.scope === "ServiceWorkerGlobalScope",
            ),
          })),
        };
      }
    : null;

/**
 * Watches the JS heap for the one shape a leak has and nothing else does: a
 * sawtooth whose floor keeps rising.
 *
 * A single heap reading says almost nothing. Garbage collection runs whenever
 * it likes, so the number swings by tens of megabytes between two frames and a
 * rising reading is as likely to be an overdue collection as a leak. What a
 * collection cannot lower is the live set, and the lowest reading in a window
 * is the closest a page gets to seeing it. The sampler keeps that floor per
 * bucket and takes the median of the slopes between every pair of floors
 * (Theil-Sen); that is the growth rate that survives collection, in bytes per
 * minute.
 *
 * The median rather than a least-squares line because the heap moves in
 * steps that are not leaks: the minute after a join fills in chunks and
 * creatures (+200 MB), the next few minutes give load scaffolding back
 * (-300 MB), and flying into a town steps the live set up once and holds.
 * A fitted line reports every one of those as a rate for as long as the step
 * is inside the window -- a fresh session read +20 MB/min at one minute and
 * -166 MB/min at three. The median of pairwise slopes reads a step as zero
 * once the step occupies less than about 29% of the window (the estimator's
 * breakdown point: with the default twenty 15-second buckets, a step under
 * ninety seconds long once the floors after it have held for three and a
 * half minutes), while a true steady leak, whose every pair rises, comes
 * through at its full rate.
 */
export class MemorySampler {
  readonly bucketMs: number;
  readonly bucketCount: number;

  private readonly sampleIntervalMs: number;
  private readonly minBucketsForTrend: number;
  private readonly detailedIntervalMs: number;
  private readonly readHeap: HeapReader;
  private readonly measureDetailed: DetailedMemoryMeasurer | null;

  private readonly floors: number[] = [];
  private currentBucketStartedAt: number | null = null;
  private currentBucketFloor = Infinity;
  private trendStartsAt: number | null = null;
  private readonly trendGraceMs: number;

  private lastSampleAt = -Infinity;
  private latest: HeapReading | null = null;
  private isHeapAvailable = false;
  private publishedGrowthBytesPerMinute: number | null = null;
  private publishedRevision = 0;

  private detailed: DetailedMemoryReading | null = null;
  private detailedMeasuredAt: number | null = null;
  private isDetailedInFlight = false;
  private isDetailedRefused = false;
  private nextDetailedAt = 0;
  private isDisposed = false;

  constructor(options: MemorySamplerOptions = {}) {
    this.sampleIntervalMs = options.sampleIntervalMs ?? 500;
    this.bucketMs = options.bucketMs ?? 15_000;
    this.bucketCount = options.bucketCount ?? 20;
    this.minBucketsForTrend = options.minBucketsForTrend ?? 8;
    this.trendGraceMs = options.trendGraceMs ?? 60_000;
    this.detailedIntervalMs = options.detailedIntervalMs ?? 20_000;
    this.readHeap = options.readHeap ?? readPerformanceMemory;
    this.measureDetailed =
      options.measureDetailed === undefined
        ? measureUserAgentSpecificMemory
        : options.measureDetailed;
  }

  update(): void {
    const now = performance.now();
    if (now - this.lastSampleAt < this.sampleIntervalMs) return;
    this.lastSampleAt = now;

    const reading = this.readHeap();
    this.isHeapAvailable = reading !== null;
    if (reading) {
      this.latest = reading;
      if (this.trendStartsAt === null) {
        this.trendStartsAt = now + this.trendGraceMs;
      }
      if (now >= this.trendStartsAt) this.recordFloor(reading.usedBytes, now);
    }

    this.maybeMeasureDetailed(now);
  }

  dispose(): void {
    this.isDisposed = true;
  }

  /** False where the browser exposes no heap counters at all. */
  get isAvailable(): boolean {
    return this.isHeapAvailable;
  }

  get usedBytes(): number {
    return this.latest?.usedBytes ?? 0;
  }

  get totalBytes(): number {
    return this.latest?.totalBytes ?? 0;
  }

  get limitBytes(): number {
    return this.latest?.limitBytes ?? 0;
  }

  /** How close the heap is to the ceiling the engine will refuse to grow past,
   * 0..1. This, not the raw size, is what turns into frame drops: near the
   * limit every collection is a full one and they come faster and faster. */
  get pressure(): number {
    if (!this.latest || this.latest.limitBytes <= 0) return 0;
    return this.latest.usedBytes / this.latest.limitBytes;
  }

  /** The lowest reading in the window -- the best available estimate of the
   * live set once collection has had its say. */
  get floorBytes(): number {
    let floor = this.currentBucketFloor;
    for (const value of this.floors) if (value < floor) floor = value;
    return Number.isFinite(floor) ? floor : this.usedBytes;
  }

  /** Bytes per minute the floor is rising by, or null until enough buckets
   * have completed to tell a rise from a collection that has not happened
   * yet. Negative when the live set is shrinking. A one-off step -- a town
   * flown into, a join's fill-in -- reads as zero once it is a small part
   * of the window and the floors since have held. */
  get growthBytesPerMinute(): number | null {
    return this.publishedGrowthBytesPerMinute;
  }

  /** Per-bucket floors, oldest first. */
  get floorHistory(): readonly number[] {
    return this.floors;
  }

  /** The floor of the bucket still filling, or null before its first sample
   * (and throughout the grace period). It can only fall until the bucket
   * closes and joins {@link floorHistory}. */
  get pendingFloorBytes(): number | null {
    return Number.isFinite(this.currentBucketFloor)
      ? this.currentBucketFloor
      : null;
  }

  /** How long the trend window currently covers, in milliseconds. */
  get trendSpanMs(): number {
    return this.floors.length * this.bucketMs;
  }

  /** The latest detailed measurement, when the browser offers one. */
  get detailedReading(): DetailedMemoryReading | null {
    return this.detailed;
  }

  /** performance.now() of the latest detailed measurement. */
  get detailedMeasuredAtMs(): number | null {
    return this.detailedMeasuredAt;
  }

  /** Bumps whenever something a readout draws has changed: a bucket
   * closing, the pending floor falling, a detailed measurement landing. */
  get revision(): number {
    return this.publishedRevision;
  }

  private recordFloor(usedBytes: number, now: number): void {
    if (this.currentBucketStartedAt === null) {
      this.currentBucketStartedAt = now;
    }

    // Close every bucket the clock has passed, not just one: a tab that was
    // hidden for a while comes back with a gap, and the gap must not be
    // credited to a single bucket as if it were fifteen seconds long.
    while (now - this.currentBucketStartedAt >= this.bucketMs) {
      if (Number.isFinite(this.currentBucketFloor)) {
        this.floors.push(this.currentBucketFloor);
        if (this.floors.length > this.bucketCount) this.floors.shift();
        this.publishTrend();
      }
      this.currentBucketStartedAt += this.bucketMs;
      this.currentBucketFloor = Infinity;
      // An empty stretch means no samples, and a floor of nothing is not a
      // floor; the loop only pushes what a sample actually set.
      if (now - this.currentBucketStartedAt >= this.bucketMs) {
        this.currentBucketStartedAt = now;
        break;
      }
    }

    // A lower floor is a change worth redrawing for: it is the bar a graph
    // shows for the bucket in progress. At most a handful per bucket.
    if (usedBytes < this.currentBucketFloor) {
      this.currentBucketFloor = usedBytes;
      this.publishedRevision += 1;
    }
  }

  private publishTrend(): void {
    const n = this.floors.length;
    if (n < this.minBucketsForTrend) {
      this.publishedGrowthBytesPerMinute = null;
      this.publishedRevision += 1;
      return;
    }

    // Theil-Sen: the median slope over every pair of floors, in bytes per
    // bucket. At most 190 pairs for the default window, so the sort is
    // nothing, and unlike a fitted line one step or one odd floor cannot
    // drag the answer: a rate has to be there between most pairs to be
    // reported at all.
    const slopes: number[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        slopes.push((this.floors[j] - this.floors[i]) / (j - i));
      }
    }
    slopes.sort((a, b) => a - b);
    const middle = slopes.length >> 1;
    const bytesPerBucket =
      slopes.length % 2 === 1
        ? slopes[middle]
        : (slopes[middle - 1] + slopes[middle]) / 2;

    this.publishedGrowthBytesPerMinute =
      (bytesPerBucket * 60_000) / this.bucketMs;
    this.publishedRevision += 1;
  }

  private maybeMeasureDetailed(now: number): void {
    if (!this.measureDetailed || this.isDetailedInFlight) return;
    if (this.isDetailedRefused || now < this.nextDetailedAt) return;

    this.isDetailedInFlight = true;
    this.measureDetailed()
      .then((reading) => {
        if (this.isDisposed) return;
        if (reading) {
          this.detailed = reading;
          this.detailedMeasuredAt = performance.now();
          this.publishedRevision += 1;
        }
      })
      .catch((error: unknown) => {
        // A page that is not cross-origin isolated is refused outright, and
        // asking again every twenty seconds would not change the answer. Any
        // other failure (throttled, torn down mid-measure) is retried; the
        // readout keeps showing the heap counters on their own meanwhile.
        if ((error as { name?: string })?.name === "SecurityError") {
          this.isDetailedRefused = true;
        }
      })
      .finally(() => {
        this.isDetailedInFlight = false;
        this.nextDetailedAt = performance.now() + this.detailedIntervalMs;
      });
  }
}
