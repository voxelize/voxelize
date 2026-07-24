import { describe, expect, it } from "vitest";

import { WorkerPool, WorkerPoolJob } from "./worker-pool";

/**
 * Accepts work and never answers, so every dispatched job stays in flight and
 * every further job stays queued. That is exactly the saturated state the
 * queue caps exist for.
 */
class SilentWorker extends EventTarget implements Worker {
  onmessage: Worker["onmessage"] = null;
  onmessageerror: Worker["onmessageerror"] = null;
  onerror: Worker["onerror"] = null;

  postMessage(): void {}
  terminate(): void {}
}

type JobResult = { id: number; isResolvedNull: boolean };

const makeJob = (
  id: number,
  results: JobResult[],
  extra: Partial<WorkerPoolJob> = {},
): WorkerPoolJob => ({
  message: { id },
  resolve: (value) => results.push({ id, isResolvedNull: value === null }),
  ...extra,
});

describe("WorkerPool queue capping", () => {
  it("leaves the queue unbounded when no cap is configured", () => {
    const pool = new WorkerPool(SilentWorker, { maxWorker: 1 });
    const results: JobResult[] = [];

    for (let id = 0; id < 20; id++) {
      pool.addJob(makeJob(id, results));
    }

    expect(pool.workingCount).toBe(1);
    expect(pool.queue.length).toBe(19);
    expect(results).toHaveLength(0);
  });

  it("sheds the oldest queued jobs past the cap, resolving them null", () => {
    const pool = new WorkerPool(SilentWorker, {
      maxWorker: 1,
      maxQueuedJobs: 2,
    });
    const results: JobResult[] = [];

    // Job 0 goes straight to the only worker; 1 and 2 fill the queue.
    for (let id = 0; id < 5; id++) {
      pool.addJob(makeJob(id, results));
    }

    expect(pool.queue.length).toBe(2);
    expect(results).toEqual([
      { id: 1, isResolvedNull: true },
      { id: 2, isResolvedNull: true },
    ]);
  });

  it("treats a cap below one as a cap of one", () => {
    const pool = new WorkerPool(SilentWorker, {
      maxWorker: 1,
      maxQueuedJobs: 0,
    });
    const results: JobResult[] = [];

    pool.addJob(makeJob(0, results));
    pool.addJob(makeJob(1, results));
    pool.addJob(makeJob(2, results));

    expect(pool.queue.length).toBe(1);
    expect(results).toEqual([{ id: 1, isResolvedNull: true }]);
  });
});

describe("WorkerPool.drainQueue", () => {
  it("drops every queued job and leaves in-flight jobs alone", () => {
    const pool = new WorkerPool(SilentWorker, { maxWorker: 2 });
    const results: JobResult[] = [];

    for (let id = 0; id < 6; id++) {
      pool.addJob(makeJob(id, results));
    }
    expect(pool.queue.length).toBe(4);

    expect(pool.drainQueue()).toBe(4);
    expect(pool.queue.length).toBe(0);
    // Jobs 0 and 1 are on the two workers and must not be resolved.
    expect(results.map(({ id }) => id)).toEqual([2, 3, 4, 5]);
    expect(results.every(({ isResolvedNull }) => isResolvedNull)).toBe(true);
    expect(pool.workingCount).toBe(2);
  });

  it("is a no-op on an empty queue", () => {
    const pool = new WorkerPool(SilentWorker, { maxWorker: 1 });

    expect(pool.drainQueue()).toBe(0);
  });
});

describe("WorkerPool.queuedBytes", () => {
  it("counts the transferable payloads parked behind busy workers", () => {
    const pool = new WorkerPool(SilentWorker, { maxWorker: 1 });
    const results: JobResult[] = [];

    pool.addJob(makeJob(0, results, { buffers: [new ArrayBuffer(64)] }));
    expect(pool.queuedBytes).toBe(0);

    pool.addJob(makeJob(1, results, { buffers: [new ArrayBuffer(64)] }));
    pool.addJob(makeJob(2, results, { buffers: [new ArrayBuffer(32)] }));
    expect(pool.queuedBytes).toBe(96);
  });
});

describe("WorkerPool slot accounting", () => {
  // Light-job dispatch only serializes a chunk payload when a worker can
  // start it immediately, which requires availableCount to drop the moment
  // a job is handed over rather than when the worker replies.
  it("reserves a worker slot synchronously on dispatch", () => {
    const pool = new WorkerPool(SilentWorker, { maxWorker: 3 });
    const results: JobResult[] = [];

    expect(pool.availableCount).toBe(3);
    pool.addJob(makeJob(0, results));
    expect(pool.availableCount).toBe(2);
    pool.addJob(makeJob(1, results));
    pool.addJob(makeJob(2, results));
    expect(pool.availableCount).toBe(0);
    expect(pool.isBusy).toBe(true);

    pool.addJob(makeJob(3, results));
    expect(pool.queue.length).toBe(1);
  });
});
