import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  BudgetedWorkOutcome,
  createBudgetedDrain,
  setHiddenTabTicker,
} from "./frame-budget";

/// Drives the drain by hand: frames are a queue the test steps and the clock
/// only moves when a unit of work says it cost something, so where a slice
/// ends is a fact about the code rather than about real timing. The tab's
/// visibility is a fact the test states too, because a hidden tab is served
/// no frames at all and the drain has to notice.
function withFakeTab(
  tab: (controls: {
    step: () => void;
    pendingCount: () => number;
    advance: (ms: number) => void;
    hide: () => void;
    show: () => void;
    tickHidden: () => void;
    hiddenTickerCount: () => number;
  }) => void,
): void {
  const frames = new Map<number, FrameRequestCallback>();
  const visibilityListeners = new Set<() => void>();
  const hiddenTicks = new Set<() => void>();
  let nextHandle = 1;
  let clock = 0;

  const fakeDocument = {
    hidden: false,
    addEventListener: (_type: string, listener: () => void) => {
      visibilityListeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      visibilityListeners.delete(listener);
    },
  };

  const realRequest = globalThis.requestAnimationFrame;
  const realCancel = globalThis.cancelAnimationFrame;
  const realNow = performance.now;

  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
    const handle = nextHandle++;
    frames.set(handle, callback);
    return handle;
  };
  globalThis.cancelAnimationFrame = (handle: number) => {
    frames.delete(handle);
  };
  performance.now = () => clock;
  Object.defineProperty(globalThis, "document", {
    value: fakeDocument,
    configurable: true,
  });
  setHiddenTabTicker((onTick) => {
    hiddenTicks.add(onTick);
    return () => hiddenTicks.delete(onTick);
  });

  const setVisibility = (isHidden: boolean) => {
    fakeDocument.hidden = isHidden;
    for (const listener of [...visibilityListeners]) listener();
  };

  try {
    tab({
      step: () => {
        const pending = [...frames.values()];
        frames.clear();
        for (const callback of pending) callback(clock);
      },
      pendingCount: () => frames.size,
      advance: (ms: number) => {
        clock += ms;
      },
      hide: () => setVisibility(true),
      show: () => setVisibility(false),
      tickHidden: () => {
        for (const tick of [...hiddenTicks]) tick();
      },
      hiddenTickerCount: () => hiddenTicks.size,
    });
  } finally {
    globalThis.requestAnimationFrame = realRequest;
    globalThis.cancelAnimationFrame = realCancel;
    performance.now = realNow;
    Reflect.deleteProperty(globalThis, "document");
  }
}

function withCapturedErrors(body: (errors: () => string[]) => void): void {
  const messages: string[] = [];
  const realError = console.error;
  console.error = (...args) => {
    messages.push(args.map(String).join(" "));
  };
  try {
    body(() => messages);
  } finally {
    console.error = realError;
  }
}

describe("createBudgetedDrain", () => {
  it("runs a unit that overruns the budget rather than refusing it", () => {
    withFakeTab(({ step, advance }) => {
      let unitCount = 0;
      const drain = createBudgetedDrain(4, () => {
        unitCount += 1;
        advance(100);
        return "worked";
      });

      drain.schedule();
      step();

      assert.equal(unitCount, 1);
    });
  });

  it("keeps working until the budget is spent, then yields the frame", () => {
    withFakeTab(({ step, advance }) => {
      let unitCount = 0;
      const drain = createBudgetedDrain(10, () => {
        unitCount += 1;
        advance(4);
        return "worked";
      });

      drain.schedule();
      step();
      assert.equal(unitCount, 3);

      step();
      assert.equal(unitCount, 6);
    });
  });

  it("does not charge the budget for units that did nothing", () => {
    withFakeTab(({ step, advance }) => {
      const outcomes: BudgetedWorkOutcome[] = [
        "skipped",
        "skipped",
        "worked",
        "worked",
      ];
      let index = 0;
      const drain = createBudgetedDrain(6, () => {
        const outcome = outcomes[index++] ?? "exhausted";
        if (outcome === "worked") advance(6);
        return outcome;
      });

      drain.schedule();
      step();

      assert.equal(index, 3);
    });
  });

  it("stops scheduling once the work is exhausted", () => {
    withFakeTab(({ step, pendingCount }) => {
      let drainedCount = 0;
      let remaining = 2;
      const drain = createBudgetedDrain(
        10,
        () => (remaining-- > 0 ? "worked" : "exhausted"),
        () => {
          drainedCount += 1;
        },
      );

      drain.schedule();
      step();

      assert.equal(drainedCount, 1);
      assert.equal(pendingCount(), 0);
    });
  });

  it("cancel stops a drain that has more work queued", () => {
    withFakeTab(({ step, pendingCount, advance }) => {
      let unitCount = 0;
      const drain = createBudgetedDrain(1, () => {
        unitCount += 1;
        advance(2);
        return "worked";
      });

      drain.schedule();
      step();
      assert.equal(pendingCount(), 1);

      drain.cancel();
      step();

      assert.equal(unitCount, 1);
      assert.equal(pendingCount(), 0);
    });
  });

  it("drains a hidden tab, which is served no frames at all", () => {
    withFakeTab(({ pendingCount, tickHidden, hide, advance }) => {
      let remaining = 4;
      let drainedCount = 0;
      const drain = createBudgetedDrain(
        1,
        () => {
          advance(2);
          return remaining-- > 0 ? "worked" : "exhausted";
        },
        () => {
          drainedCount += 1;
        },
      );

      hide();
      drain.schedule();

      assert.equal(pendingCount(), 0);

      for (let slice = 0; slice < 5; slice++) tickHidden();

      assert.equal(remaining, -1);
      assert.equal(drainedCount, 1);
    });
  });

  it("moves a queued slice onto the hidden ticker when the tab hides", () => {
    withFakeTab(({ step, pendingCount, hide, tickHidden, advance }) => {
      let unitCount = 0;
      const drain = createBudgetedDrain(1, () => {
        unitCount += 1;
        advance(2);
        return "worked";
      });

      drain.schedule();
      assert.equal(pendingCount(), 1);

      hide();
      assert.equal(pendingCount(), 0);

      tickHidden();
      assert.equal(unitCount, 1);

      step();
      assert.equal(unitCount, 1);
    });
  });

  it("returns to frames when the tab is shown again", () => {
    withFakeTab(
      ({ step, hide, show, tickHidden, hiddenTickerCount, advance }) => {
        let unitCount = 0;
        const drain = createBudgetedDrain(1, () => {
          unitCount += 1;
          advance(2);
          return "worked";
        });

        hide();
        drain.schedule();
        tickHidden();
        assert.equal(unitCount, 1);

        show();
        assert.equal(hiddenTickerCount(), 0);

        step();
        assert.equal(unitCount, 2);
      },
    );
  });

  it("stops the hidden ticker once the work is exhausted", () => {
    withFakeTab(({ hide, tickHidden, hiddenTickerCount }) => {
      const drain = createBudgetedDrain(1, () => "exhausted");

      hide();
      drain.schedule();
      assert.equal(hiddenTickerCount(), 1);

      tickHidden();
      assert.equal(hiddenTickerCount(), 0);
    });
  });

  it("reports a unit that throws and carries on with the rest", () => {
    withCapturedErrors((errors) => {
      withFakeTab(({ step, advance }) => {
        let remaining = 3;
        let drainedCount = 0;
        const drain = createBudgetedDrain(
          1,
          () => {
            advance(2);
            if (remaining === 2) {
              remaining -= 1;
              throw new Error("bake failed");
            }
            return remaining-- > 0 ? "worked" : "exhausted";
          },
          () => {
            drainedCount += 1;
          },
        );

        drain.schedule();
        for (let slice = 0; slice < 5; slice++) step();

        assert.equal(drainedCount, 1);
        assert.equal(errors().length, 1);
        assert.match(errors()[0], /threw/);
      });
    });
  });

  it("gives up out loud on a unit that throws every time", () => {
    withCapturedErrors((errors) => {
      withFakeTab(({ step, pendingCount }) => {
        let drainedCount = 0;
        // Nothing consumes this unit, so an unbounded retry would spin
        // inside the slice and hang the test rather than fail it.
        const drain = createBudgetedDrain(
          1,
          () => {
            throw new Error("always fails");
          },
          () => {
            drainedCount += 1;
          },
        );

        drain.schedule();
        step();

        assert.equal(drainedCount, 1);
        assert.equal(pendingCount(), 0);
        assert.match(errors().at(-1) ?? "", /stopping this drain/);
      });
    });
  });
});
