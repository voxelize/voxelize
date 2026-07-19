import { beforeEach, describe, expect, it, vi } from "vitest";

import { DeferredBlockEntityUpdateController } from "../src/core/world/deferred-block-entity-updates";

describe("DeferredBlockEntityUpdateController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("applies deferred updates when chunk init callback runs", () => {
    const controller = new DeferredBlockEntityUpdateController();
    let initListener: (() => void) | null = null;
    const apply = vi.fn();

    controller.defer({
      chunkName: "0,0",
      timeoutMs: 3000,
      shouldApplyOnTimeout: () => true,
      onApply: apply,
      bindChunkInit: (listener) => {
        initListener = listener;
        return () => {
          initListener = null;
        };
      },
    });

    expect(apply).not.toHaveBeenCalled();
    expect(initListener).not.toBeNull();

    initListener?.();
    vi.advanceTimersByTime(3000);

    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("drops deferred updates when the chunk is canceled before init", () => {
    const controller = new DeferredBlockEntityUpdateController();
    const apply = vi.fn();

    controller.defer({
      chunkName: "0,0",
      timeoutMs: 3000,
      shouldApplyOnTimeout: () => true,
      onApply: apply,
      bindChunkInit: () => () => {},
    });

    controller.cancelChunk("0,0");
    vi.advanceTimersByTime(3000);

    expect(apply).not.toHaveBeenCalled();
  });

  it("does not apply timed-out updates when chunk is still unavailable", () => {
    const controller = new DeferredBlockEntityUpdateController();
    const apply = vi.fn();

    controller.defer({
      chunkName: "1,2",
      timeoutMs: 3000,
      shouldApplyOnTimeout: () => false,
      onApply: apply,
      bindChunkInit: () => () => {},
    });

    vi.advanceTimersByTime(3000);

    expect(apply).not.toHaveBeenCalled();
  });

  it("applies timed-out updates only if chunk becomes ready", () => {
    const controller = new DeferredBlockEntityUpdateController();
    const apply = vi.fn();

    controller.defer({
      chunkName: "2,3",
      timeoutMs: 3000,
      shouldApplyOnTimeout: () => true,
      onApply: apply,
      bindChunkInit: () => () => {},
    });

    vi.advanceTimersByTime(3000);

    expect(apply).toHaveBeenCalledTimes(1);
  });
});
