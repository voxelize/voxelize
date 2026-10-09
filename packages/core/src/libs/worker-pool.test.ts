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

/**
 * Answers every job it is handed at once and records what it was sent, so a
 * test can see which worker of a pool ran a job and what a replacement got.
 */
class EchoWorker extends EventTarget implements Worker {
  static spawned: EchoWorker[] = [];

  onmessage: Worker["onmessage"] = null;
  onmessageerror: Worker["onmessageerror"] = null;
  onerror: Worker["onerror"] = null;

  readonly received: unknown[] = [];
  isTerminated = false;

  constructor(readonly workerOptions?: WorkerOptions) {
    super();
    EchoWorker.spawned.push(this);
  }

  postMessage(message: unknown): void {
    this.received.push(message);
    if ((message as { isJob?: boolean }).isJob) {
      queueMicrotask(() =>
        this.dispatchEvent(
          new MessageEvent("message", {
            data: { name: this.workerOptions?.name },
          }),
        ),
      );
    }
  }

  terminate(): void {
    this.isTerminated = true;
  }
}

const runJob = (pool: WorkerPool): Promise<{ name?: string }> =>
  new Promise((resolve) =>
    pool.addJob({
      message: { isJob: true },
      resolve: (value) => resolve(value as { name?: string }),
    }),
  );

describe("WorkerPool worker reuse", () => {
  it("hands a light load to the worker released last instead of rotating", async () => {
    EchoWorker.spawned = [];
    const pool = new WorkerPool(EchoWorker, { maxWorker: 4, name: "echo" });

    const names = [];
    for (let i = 0; i < 6; i++) names.push((await runJob(pool)).name);

    expect(new Set(names)).toEqual(new Set(["echo-0"]));
    pool.terminate();
  });
});

describe("WorkerPool.recycleIdleWorkers", () => {
  it("replaces only idle workers that have run a job", async () => {
    EchoWorker.spawned = [];
    const pool = new WorkerPool(EchoWorker, { maxWorker: 3, name: "echo" });
    const [first] = EchoWorker.spawned;

    await runJob(pool);
    expect(pool.recycleIdleWorkers()).toBe(1);

    expect(first.isTerminated).toBe(true);
    expect(EchoWorker.spawned).toHaveLength(4);
    expect(EchoWorker.spawned[3].workerOptions?.name).toBe("echo-0");
    // A fresh worker has nothing to hand back.
    expect(pool.recycleIdleWorkers()).toBe(0);
    pool.terminate();
  });

  it("leaves a busy worker alone", () => {
    const pool = new WorkerPool(SilentWorker, { maxWorker: 2 });
    pool.addJob(makeJob(0, []));

    expect(pool.recycleIdleWorkers()).toBe(0);
    expect(pool.workingCount).toBe(1);
    pool.terminate();
  });

  it("replays broadcasts onto replacements, at most maxReplays of them", async () => {
    EchoWorker.spawned = [];
    const pool = new WorkerPool(EchoWorker, { maxWorker: 2, name: "echo" });
    pool.postMessage({ type: "init" });
    // Two jobs in flight together, so both workers have served.
    await Promise.all([runJob(pool), runJob(pool)]);

    expect(pool.recycleIdleWorkers(1)).toBe(1);
    const replacement = EchoWorker.spawned[2];
    expect(replacement.received).toEqual([{ type: "init" }]);
    expect(pool.recycleIdleWorkers(1)).toBe(1);
    expect(pool.recycleIdleWorkers(1)).toBe(0);
    pool.terminate();
  });

  it("reaches every live pool, and no terminated one", async () => {
    EchoWorker.spawned = [];
    const a = new WorkerPool(EchoWorker, { maxWorker: 1, name: "a" });
    const b = new WorkerPool(EchoWorker, { maxWorker: 1, name: "b" });
    const gone = new WorkerPool(EchoWorker, { maxWorker: 1, name: "gone" });
    await Promise.all([runJob(a), runJob(b), runJob(gone)]);
    gone.terminate();

    expect(WorkerPool.recycleIdleWorkersEverywhere()).toEqual({
      pools: 2,
      workers: 2,
    });
    a.terminate();
    b.terminate();
  });
});
