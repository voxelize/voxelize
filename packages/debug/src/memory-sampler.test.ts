import { afterEach, describe, expect, it, vi } from "vitest";

import { MemorySampler, type HeapReading } from "./memory-sampler";

const MB = 1024 * 1024;

const useClock = () => {
  const clock = { now: 0 };
  vi.spyOn(performance, "now").mockImplementation(() => clock.now);
  return clock;
};

/** A heap that follows a scripted function of time: the test owns the
 * sawtooth, so a reading can be attributed to the shape that produced it. */
const makeSampler = (
  usedAt: (nowMs: number) => number,
  clock: { now: number },
  options: {
    bucketMs?: number;
    bucketCount?: number;
    trendGraceMs?: number;
    minBucketsForTrend?: number;
  } = {},
) => {
  const reader = (): HeapReading => ({
    usedBytes: usedAt(clock.now),
    totalBytes: usedAt(clock.now) + 50 * MB,
    limitBytes: 4096 * MB,
  });
  return new MemorySampler({
    sampleIntervalMs: 500,
    bucketMs: options.bucketMs ?? 10_000,
    bucketCount: options.bucketCount ?? 12,
    // The estimator is under test here, not the wait for it: three floors
    // is the least the median of pairwise slopes is defined over.
    minBucketsForTrend: options.minBucketsForTrend ?? 3,
    trendGraceMs: options.trendGraceMs ?? 0,
    readHeap: reader,
    measureDetailed: null,
  });
};

const run = (
  sampler: MemorySampler,
  clock: { now: number },
  untilMs: number,
) => {
  while (clock.now < untilMs) {
    sampler.update();
    clock.now += 500;
  }
};

/** A young-generation sawtooth: 30 MB of garbage every two seconds on top
 * of a live set that drifts by `leakBytesPerMinute`. */
const sawtooth =
  (baseBytes: number, leakBytesPerMinute: number) => (nowMs: number) =>
    baseBytes +
    (leakBytesPerMinute * nowMs) / 60_000 +
    ((nowMs % 2000) / 2000) * 30 * MB;

/** Lets a resolved measurement run its whole then/catch/finally chain. */
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MemorySampler trend", () => {
  it("reports no trend until enough buckets have completed", () => {
    const clock = useClock();
    const sampler = makeSampler(sawtooth(400 * MB, 0), clock);

    run(sampler, clock, 25_000);

    expect(sampler.isAvailable).toBe(true);
    expect(sampler.growthBytesPerMinute).toBeNull();
  });

  it("by default waits out a minute of grace and two minutes of floors", () => {
    const clock = useClock();
    const sampler = new MemorySampler({
      sampleIntervalMs: 500,
      readHeap: () => ({
        usedBytes: sawtooth(400 * MB, 6 * MB)(clock.now),
        totalBytes: 450 * MB,
        limitBytes: 4096 * MB,
      }),
      measureDetailed: null,
    });

    // 60 s grace + 8 buckets of 15 s: nothing before three minutes.
    run(sampler, clock, 170_000);
    expect(sampler.growthBytesPerMinute).toBeNull();

    run(sampler, clock, 190_000);
    expect(sampler.growthBytesPerMinute).not.toBeNull();
    expect(sampler.growthBytesPerMinute ?? 0).toBeGreaterThan(5 * MB);
  });

  it("reads a steady sawtooth as no growth", () => {
    const clock = useClock();
    const sampler = makeSampler(sawtooth(400 * MB, 0), clock);

    run(sampler, clock, 120_000);

    expect(sampler.growthBytesPerMinute).not.toBeNull();
    expect(Math.abs(sampler.growthBytesPerMinute ?? 0)).toBeLessThan(0.5 * MB);
    // The floor is the live set, not whatever the sawtooth happened to read.
    expect(sampler.floorBytes).toBeGreaterThanOrEqual(400 * MB);
    expect(sampler.floorBytes).toBeLessThan(403 * MB);
  });

  it("recovers the leak rate from under the sawtooth", () => {
    const clock = useClock();
    const sampler = makeSampler(sawtooth(400 * MB, 6 * MB), clock);

    run(sampler, clock, 120_000);

    const growth = sampler.growthBytesPerMinute ?? 0;
    expect(growth).toBeGreaterThan(5 * MB);
    expect(growth).toBeLessThan(7 * MB);
  });

  it("reports shrinkage as a negative rate", () => {
    const clock = useClock();
    const sampler = makeSampler(sawtooth(800 * MB, -12 * MB), clock);

    run(sampler, clock, 120_000);

    expect(sampler.growthBytesPerMinute ?? 0).toBeLessThan(-10 * MB);
  });

  it("keeps only the window it was sized for", () => {
    const clock = useClock();
    const sampler = makeSampler(sawtooth(400 * MB, 0), clock, {
      bucketMs: 10_000,
      bucketCount: 6,
    });

    run(sampler, clock, 200_000);

    expect(sampler.floorHistory.length).toBe(6);
    expect(sampler.trendSpanMs).toBe(60_000);
  });

  /** Flying into a dense build: +200 MB over 30 s starting at 10 s, then flat. */
  const stepUp = (nowMs: number) =>
    Math.min(200 * MB, Math.max(0, nowMs - 10_000) * ((200 * MB) / 30_000));

  it("reads a step in the live set as no growth once the window has held", () => {
    const clock = useClock();
    // Twenty floors, like the default window; the ramp is the first three.
    // A fitted line through that reads tens of MB/min for as long as the
    // ramp is inside the window; the pairwise median reads the flat
    // majority.
    const sampler = makeSampler(
      (nowMs) => sawtooth(400 * MB, 0)(nowMs) + stepUp(nowMs),
      clock,
      { bucketCount: 20 },
    );

    run(sampler, clock, 200_000);

    expect(sampler.growthBytesPerMinute).not.toBeNull();
    expect(Math.abs(sampler.growthBytesPerMinute ?? 0)).toBeLessThan(0.5 * MB);
    expect(sampler.floorBytes).toBeGreaterThanOrEqual(400 * MB);
  });

  it("still reports a leak that runs alongside a step", () => {
    const clock = useClock();
    const sampler = makeSampler(
      (nowMs) => sawtooth(400 * MB, 6 * MB)(nowMs) + stepUp(nowMs),
      clock,
      { bucketCount: 20 },
    );

    run(sampler, clock, 200_000);

    const growth = sampler.growthBytesPerMinute ?? 0;
    expect(growth).toBeGreaterThan(5 * MB);
    expect(growth).toBeLessThan(7.5 * MB);
  });

  it("keeps the settling heap after load out of the trend", () => {
    const clock = useClock();
    // The first half minute frees 300 MB of load scaffolding; after that
    // the live set is flat. Without the grace this reads as a plunge.
    const settling = (nowMs: number) =>
      sawtooth(400 * MB, 0)(nowMs) +
      Math.max(0, 300 * MB - (nowMs * 10 * MB) / 1000);
    const sampler = makeSampler(settling, clock, { trendGraceMs: 30_000 });

    run(sampler, clock, 120_000);

    // Readings themselves are live from the first sample.
    expect(sampler.usedBytes).toBeGreaterThan(0);
    expect(sampler.growthBytesPerMinute).not.toBeNull();
    expect(Math.abs(sampler.growthBytesPerMinute ?? 0)).toBeLessThan(0.5 * MB);
    // Nothing from the grace window made it into the history.
    expect(sampler.trendSpanMs).toBeLessThanOrEqual(90_000);
  });

  it("exposes the bucket in progress and redraws as its floor falls", () => {
    const clock = useClock();
    const sampler = makeSampler(sawtooth(400 * MB, 0), clock);

    expect(sampler.pendingFloorBytes).toBeNull();
    sampler.update();
    const firstRevision = sampler.revision;
    expect(sampler.pendingFloorBytes).toBe(400 * MB);

    // The sawtooth climbs for two seconds: no lower floor, no redraw.
    run(sampler, clock, 1_500);
    expect(sampler.revision).toBe(firstRevision);
    // A lower reading is a new floor and a new revision.
    clock.now = 2_000;
    sampler.update();
    expect(sampler.pendingFloorBytes).toBe(400 * MB);
    run(sampler, clock, 10_500);
    // The bucket closed: its floor moved into the history, the next is open.
    expect(sampler.floorHistory.length).toBe(1);
    expect(sampler.pendingFloorBytes).not.toBeNull();
    expect(sampler.revision).toBeGreaterThan(firstRevision);
  });

  it("does not credit a hidden-tab gap as buckets of readings", () => {
    const clock = useClock();
    const sampler = makeSampler(sawtooth(400 * MB, 0), clock);

    run(sampler, clock, 35_000);
    const before = sampler.floorHistory.length;

    // Away for two minutes with no samples: the gap is not history.
    clock.now += 120_000;
    sampler.update();

    expect(sampler.floorHistory.length).toBeLessThanOrEqual(before + 1);
    // And sampling resumes on a fresh bucket rather than a stale one.
    run(sampler, clock, clock.now + 30_000);
    expect(sampler.floorHistory.length).toBeLessThanOrEqual(before + 4);
  });
});

describe("MemorySampler availability", () => {
  it("reports unavailable when the browser exposes no heap", () => {
    useClock();
    const sampler = new MemorySampler({
      readHeap: () => null,
      measureDetailed: null,
    });

    sampler.update();

    expect(sampler.isAvailable).toBe(false);
    expect(sampler.usedBytes).toBe(0);
    expect(sampler.pressure).toBe(0);
    expect(sampler.growthBytesPerMinute).toBeNull();
  });

  it("measures pressure against the heap limit", () => {
    useClock();
    const sampler = new MemorySampler({
      readHeap: () => ({
        usedBytes: 3000 * MB,
        totalBytes: 3100 * MB,
        limitBytes: 4000 * MB,
      }),
      measureDetailed: null,
    });

    sampler.update();

    expect(sampler.pressure).toBeCloseTo(0.75, 5);
  });

  it("asks for a detailed measurement on its own cadence and keeps the answer", async () => {
    const clock = useClock();
    const measure = vi.fn(async () => ({
      totalBytes: 900 * MB,
      realms: [
        { bytes: 700 * MB, isWorker: false },
        { bytes: 200 * MB, isWorker: true },
      ],
    }));
    const sampler = new MemorySampler({
      sampleIntervalMs: 500,
      detailedIntervalMs: 20_000,
      readHeap: () => ({
        usedBytes: 400 * MB,
        totalBytes: 450 * MB,
        limitBytes: 4096 * MB,
      }),
      measureDetailed: measure,
    });

    sampler.update();
    await flushMicrotasks();
    expect(measure).toHaveBeenCalledTimes(1);
    expect(sampler.detailedReading?.totalBytes).toBe(900 * MB);
    expect(
      sampler.detailedReading?.realms.filter((r) => r.isWorker),
    ).toHaveLength(1);

    // Not again until the interval has passed since the answer landed.
    clock.now += 5_000;
    sampler.update();
    expect(measure).toHaveBeenCalledTimes(1);

    clock.now += 20_000;
    sampler.update();
    expect(measure).toHaveBeenCalledTimes(2);
  });

  it("stops asking once the browser refuses on security grounds", async () => {
    const clock = useClock();
    const measure = vi.fn(async () => {
      throw new DOMException("not isolated", "SecurityError");
    });
    const sampler = new MemorySampler({
      sampleIntervalMs: 500,
      detailedIntervalMs: 1_000,
      readHeap: () => ({
        usedBytes: 400 * MB,
        totalBytes: 450 * MB,
        limitBytes: 4096 * MB,
      }),
      measureDetailed: measure,
    });

    sampler.update();
    await flushMicrotasks();
    clock.now += 5_000;
    sampler.update();
    clock.now += 5_000;
    sampler.update();

    expect(measure).toHaveBeenCalledTimes(1);
    expect(sampler.detailedReading).toBeNull();
  });
});
