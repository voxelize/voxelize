import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeferredBlockEntityUpdateController } from "./deferred-block-entity-updates";

type Harness = {
  controller: DeferredBlockEntityUpdateController;
  applied: number;
  dropped: number[];
  fireChunkInit: () => void;
  unbound: boolean;
};

function setUp(isReady: () => boolean, timeoutMs = 3000, maxWaitMs = 10_000) {
  const harness: Harness = {
    controller: new DeferredBlockEntityUpdateController(),
    applied: 0,
    dropped: [],
    fireChunkInit: () => {},
    unbound: false,
  };
  harness.controller.defer({
    chunkName: "0|0",
    timeoutMs,
    maxWaitMs,
    shouldApplyOnTimeout: isReady,
    onApply: () => {
      harness.applied += 1;
    },
    onDrop: (waitedMs) => {
      harness.dropped.push(waitedMs);
    },
    bindChunkInit: (listener) => {
      harness.fireChunkInit = listener;
      return () => {
        harness.unbound = true;
      };
    },
  });
  return harness;
}

describe("DeferredBlockEntityUpdateController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies when the chunk initializes", () => {
    const h = setUp(() => false);
    h.fireChunkInit();
    expect(h.applied).toBe(1);
    expect(h.unbound).toBe(true);
    expect(h.controller.pendingCount()).toBe(0);
  });

  it("applies at the soft timeout when the chunk is already ready", () => {
    const h = setUp(() => true);
    vi.advanceTimersByTime(3000);
    expect(h.applied).toBe(1);
    expect(h.dropped).toEqual([]);
  });

  it("keeps waiting past the soft timeout for a chunk still on its way", () => {
    const h = setUp(() => false);
    vi.advanceTimersByTime(3000);
    expect(h.applied).toBe(0);
    expect(h.unbound).toBe(false);
    expect(h.controller.pendingCount("0|0")).toBe(1);

    // The chunk lands late — well after the old 3s cliff would have
    // dropped the update on the floor.
    vi.advanceTimersByTime(4000);
    h.fireChunkInit();
    expect(h.applied).toBe(1);
    expect(h.dropped).toEqual([]);
    expect(h.controller.pendingCount()).toBe(0);
  });

  it("drops loudly at the hard bound when the chunk never comes", () => {
    const h = setUp(() => false);
    vi.advanceTimersByTime(10_000);
    expect(h.applied).toBe(0);
    expect(h.dropped).toHaveLength(1);
    expect(h.dropped[0]).toBeGreaterThanOrEqual(10_000);
    expect(h.unbound).toBe(true);
    expect(h.controller.pendingCount()).toBe(0);
  });

  it("cancelling a chunk withdraws its updates without applying them", () => {
    const h = setUp(() => false);
    h.controller.cancelChunk("0|0");
    expect(h.applied).toBe(0);
    expect(h.dropped).toEqual([]);
    expect(h.controller.pendingCount()).toBe(0);
    // Late signals after cancellation are inert.
    h.fireChunkInit();
    vi.advanceTimersByTime(20_000);
    expect(h.applied).toBe(0);
  });
});
