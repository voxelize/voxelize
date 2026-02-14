import { describe, expect, it } from "vitest";

import { WorkerPool } from "../src/libs/worker-pool";

class FakeWorker extends EventTarget implements Worker {
  onerror: ((this: AbstractWorker, ev: ErrorEvent) => void) | null = null;
  onmessage: ((this: Worker, ev: MessageEvent) => void) | null = null;
  onmessageerror: ((this: Worker, ev: MessageEvent) => void) | null = null;

  constructor(_options?: WorkerOptions) {
    super();
  }

  postMessage(
    _message: object | string | number | boolean | null,
    _transferOrOptions?: Transferable[] | StructuredSerializeOptions
  ): void {}

  terminate(): void {}
}

describe("WorkerPool constructor normalization", () => {
  it("falls back to default worker count for non-finite maxWorker", () => {
    const pool = new WorkerPool(FakeWorker, { maxWorker: Number.NaN });
    expect(pool.availableCount).toBe(8);
    expect(pool.options.maxWorker).toBe(8);
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
