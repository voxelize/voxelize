import { beforeEach, describe, expect, it } from "vitest";

import { WorkerPool } from "../src/libs/worker-pool";

type FakeWorkerPost = {
  message: object | string | number | boolean | null;
  transferOrOptions?: Transferable[] | StructuredSerializeOptions;
};

class FakeWorker extends EventTarget implements Worker {
  static instances: FakeWorker[] = [];
  onerror: ((this: AbstractWorker, ev: ErrorEvent) => void) | null = null;
  onmessage: ((this: Worker, ev: MessageEvent) => void) | null = null;
  onmessageerror: ((this: Worker, ev: MessageEvent) => void) | null = null;
  posts: FakeWorkerPost[] = [];

  constructor(_options?: WorkerOptions) {
    super();
    FakeWorker.instances.push(this);
  }

  postMessage(
    message: object | string | number | boolean | null,
    transferOrOptions?: Transferable[] | StructuredSerializeOptions
  ): void {
    const normalizedTransferOrOptions = Array.isArray(transferOrOptions)
      ? [...transferOrOptions]
      : transferOrOptions;
    this.posts.push({
      message,
      transferOrOptions: normalizedTransferOrOptions,
    });
  }

  terminate(): void {}
}

const getTransferList = (
  transferOrOptions: Transferable[] | StructuredSerializeOptions | undefined
) => (Array.isArray(transferOrOptions) ? transferOrOptions : null);

beforeEach(() => {
  FakeWorker.instances.length = 0;
});

describe("WorkerPool constructor normalization", () => {
  it("falls back to default worker count for non-finite maxWorker", () => {
    const pool = new WorkerPool(FakeWorker, { maxWorker: Number.NaN });
    expect(pool.availableCount).toBe(8);
    expect(pool.options.maxWorker).toBe(8);

    const negativeInfinityPool = new WorkerPool(FakeWorker, {
      maxWorker: Number.NEGATIVE_INFINITY,
    });
    expect(negativeInfinityPool.availableCount).toBe(8);
    expect(negativeInfinityPool.options.maxWorker).toBe(8);
  });

  it("caps positive infinity worker counts to configured maximum", () => {
    const pool = new WorkerPool(FakeWorker, {
      maxWorker: Number.POSITIVE_INFINITY,
    });
    expect(pool.availableCount).toBe(256);
    expect(pool.options.maxWorker).toBe(256);
  });

  it("caps excessive worker counts to configured maximum", () => {
    const pool = new WorkerPool(FakeWorker, { maxWorker: 999 });
    expect(pool.availableCount).toBe(256);
    expect(pool.options.maxWorker).toBe(256);
  });

  it("floors finite fractional worker counts", () => {
    const pool = new WorkerPool(FakeWorker, { maxWorker: 3.9 });
    expect(pool.availableCount).toBe(3);
    expect(pool.options.maxWorker).toBe(3);
  });

  it("falls back to default worker count for non-positive maxWorker", () => {
    const zeroPool = new WorkerPool(FakeWorker, { maxWorker: 0 });
    expect(zeroPool.availableCount).toBe(8);
    expect(zeroPool.options.maxWorker).toBe(8);

    const negativePool = new WorkerPool(FakeWorker, { maxWorker: -4 });
    expect(negativePool.availableCount).toBe(8);
    expect(negativePool.options.maxWorker).toBe(8);
  });
});

describe("WorkerPool.postMessage transfer cloning", () => {
  it("broadcasts plain messages to all workers without transfer lists", () => {
    const pool = new WorkerPool(FakeWorker, { maxWorker: 2 });
    pool.postMessage({ type: "plain" });

    expect(FakeWorker.instances).toHaveLength(2);
    for (let index = 0; index < FakeWorker.instances.length; index++) {
      const worker = FakeWorker.instances[index];
      expect(worker.posts).toHaveLength(1);
      expect(worker.posts[0].message).toEqual({ type: "plain" });
      expect(worker.posts[0].transferOrOptions).toBeUndefined();
    }
  });

  it("treats empty transfer lists as plain broadcasts", () => {
    const pool = new WorkerPool(FakeWorker, { maxWorker: 2 });
    pool.postMessage({ type: "plain-empty-transfer" }, []);

    expect(FakeWorker.instances).toHaveLength(2);
    for (let index = 0; index < FakeWorker.instances.length; index++) {
      const worker = FakeWorker.instances[index];
      expect(worker.posts).toHaveLength(1);
      expect(worker.posts[0].message).toEqual({
        type: "plain-empty-transfer",
      });
      expect(worker.posts[0].transferOrOptions).toBeUndefined();
    }
  });

  it("clones a single source buffer per worker", () => {
    const pool = new WorkerPool(FakeWorker, { maxWorker: 3 });
    const source = new Uint8Array([1, 2, 3]).buffer;
    pool.postMessage({ type: "single-buffer" }, [source]);

    expect(FakeWorker.instances).toHaveLength(3);
    const sentBuffers: ArrayBuffer[] = [];
    for (let index = 0; index < FakeWorker.instances.length; index++) {
      const worker = FakeWorker.instances[index];
      expect(worker.posts).toHaveLength(1);
      const transferList = getTransferList(worker.posts[0].transferOrOptions);
      if (!transferList) {
        throw new Error("Expected transfer list for single-buffer broadcast");
      }
      expect(transferList).toHaveLength(1);
      const sent = transferList[0];
      if (!(sent instanceof ArrayBuffer)) {
        throw new Error("Expected array buffer transfer for single-buffer broadcast");
      }
      expect(sent).not.toBe(source);
      expect(Array.from(new Uint8Array(sent))).toEqual([1, 2, 3]);
      sentBuffers.push(sent);
    }
    expect(new Set(sentBuffers).size).toBe(3);
  });

  it("clones each source buffer for every worker in multi-buffer broadcasts", () => {
    const pool = new WorkerPool(FakeWorker, { maxWorker: 2 });
    const sourceA = new Uint8Array([5, 6]).buffer;
    const sourceB = new Uint8Array([7, 8]).buffer;
    pool.postMessage({ type: "multi-buffer" }, [sourceA, sourceB]);

    expect(FakeWorker.instances).toHaveLength(2);
    const firstBuffers: ArrayBuffer[] = [];
    const secondBuffers: ArrayBuffer[] = [];
    for (let index = 0; index < FakeWorker.instances.length; index++) {
      const worker = FakeWorker.instances[index];
      expect(worker.posts).toHaveLength(1);
      const transferList = getTransferList(worker.posts[0].transferOrOptions);
      if (!transferList) {
        throw new Error("Expected transfer list for multi-buffer broadcast");
      }
      expect(transferList).toHaveLength(2);
      const first = transferList[0];
      const second = transferList[1];
      if (!(first instanceof ArrayBuffer) || !(second instanceof ArrayBuffer)) {
        throw new Error("Expected array buffer transfers for multi-buffer broadcast");
      }
      expect(first).not.toBe(sourceA);
      expect(second).not.toBe(sourceB);
      expect(Array.from(new Uint8Array(first))).toEqual([5, 6]);
      expect(Array.from(new Uint8Array(second))).toEqual([7, 8]);
      firstBuffers.push(first);
      secondBuffers.push(second);
    }
    expect(new Set(firstBuffers).size).toBe(2);
    expect(new Set(secondBuffers).size).toBe(2);
  });
});

describe("WorkerPool queue hardening", () => {
  it("skips malformed queued entries before dispatching valid jobs", () => {
    const pool = new WorkerPool(FakeWorker, { maxWorker: 1 });
    pool.queue.push({} as never);

    expect(() =>
      pool.addJob({
        message: { type: "valid" },
        resolve: () => {
          return;
        },
      })
    ).not.toThrow();

    expect(FakeWorker.instances).toHaveLength(1);
    const posts = FakeWorker.instances[0].posts;
    expect(posts).toHaveLength(1);
    expect(posts[0].message).toEqual({ type: "valid" });
  });

  it("treats non-function reject handlers as absent", () => {
    const pool = new WorkerPool(FakeWorker, { maxWorker: 1 });
    const worker = FakeWorker.instances[0];
    let resolved = false;
    pool.addJob({
      message: { type: "reject-guard" },
      resolve: () => {
        resolved = true;
      },
      reject: "invalid-reject-handler" as never,
    });

    expect(worker.posts).toHaveLength(1);
    worker.dispatchEvent(new MessageEvent("message", { data: { ok: true } }));
    expect(resolved).toBe(true);
  });
});
