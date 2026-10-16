import assert from "node:assert/strict";

import { describe, it, vi } from "vitest";

import {
  BudgetedWorkOutcome,
  createBudgetedDrain,
  LOAD_PHASE_BATCH_MS,
  setHiddenTabTicker,
  setLoadPhaseDrainScheduling,
} from "./frame-budget";
import {
  markPlayInteractive,
  onPlayInteractive,
  resetLazyWorkLedger,
} from "./pool-warmup";

/// Drives the drain by hand: frames are a queue the test steps and the clock
/// only moves when a unit of work says it cost something, so where a slice
/// ends is a fact about the code rather than about real timing. The tab's
/// visibility is a fact the test states too, because a hidden tab is served
/// no frames at all and the drain has to notice.
interface TabControls {
  step: () => void;
  pendingCount: () => number;
  advance: (ms: number) => void;
  hide: () => void;
  show: () => void;
  tickHidden: () => void;
  hiddenTickerCount: () => number;
}

function withFakeTab(tab: (controls: TabControls) => void): void {
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

interface PageControls extends TabControls {
  /// Runs posted tasks in order (tasks posted while running included) and
  /// returns how many ran; a chain that never parks trips the guard.
  runTasks: () => number;
  taskCount: () => number;
  taskPriorities: () => string[];
  /// Hands every posted message to its port, closed or not: a closed port
  /// stands for a message the browser had already queued when it closed.
  deliverMessages: () => number;
  messageCount: () => number;
}

/// A loading page that opted in to task mode: `window` exists, play is not
/// interactive yet, and tasks are a queue the test runs by hand -
/// `scheduler.postTask` by default, or only `MessageChannel` (Safari) with
/// `postTask: false`. The engine default, frame slices, is restored after.
function withLoadingPage(
  page: (controls: PageControls) => void,
  { postTask = true }: { postTask?: boolean } = {},
): void {
  withFakeTab((tab) => {
    type FakeTask = { run: () => void; priority: string };
    const tasks: FakeTask[] = [];
    const priorities: string[] = [];
    type FakePort = { onmessage: ((event: unknown) => void) | null };
    const messages: FakePort[] = [];

    class FakeMessageChannel {
      port1 = {
        onmessage: null as ((event: unknown) => void) | null,
        close: () => {},
      };
      port2 = {
        postMessage: () => {
          messages.push(this.port1);
        },
      };
    }

    const fakeScheduler = {
      postTask(
        callback: () => void,
        options: { priority?: string; signal?: AbortSignal } = {},
      ): Promise<unknown> {
        return new Promise((resolve, reject) => {
          const task: FakeTask = {
            priority: options.priority ?? "user-visible",
            run: () => {
              try {
                callback();
                resolve(undefined);
              } catch (error) {
                reject(error);
              }
            },
          };
          priorities.push(task.priority);
          options.signal?.addEventListener("abort", () => {
            const index = tasks.indexOf(task);
            if (index >= 0) tasks.splice(index, 1);
            reject(options.signal?.reason);
          });
          tasks.push(task);
        });
      },
    };

    const globals = globalThis as Record<string, unknown>;
    const saved = {
      window: Object.getOwnPropertyDescriptor(globalThis, "window"),
      scheduler: Object.getOwnPropertyDescriptor(globalThis, "scheduler"),
      MessageChannel: Object.getOwnPropertyDescriptor(
        globalThis,
        "MessageChannel",
      ),
    };
    const install = (key: string, value: unknown) =>
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      });
    install("window", {});
    install("MessageChannel", FakeMessageChannel);
    if (postTask) install("scheduler", fakeScheduler);
    else Reflect.deleteProperty(globals, "scheduler");
    resetLazyWorkLedger();
    setLoadPhaseDrainScheduling("task");

    try {
      page({
        ...tab,
        runTasks: () => {
          let ran = 0;
          while (tasks.length > 0) {
            assert.ok(ran < 1000, "the chain never parked");
            tasks.shift()?.run();
            ran += 1;
          }
          return ran;
        },
        taskCount: () => tasks.length,
        taskPriorities: () => priorities,
        deliverMessages: () => {
          let delivered = 0;
          while (messages.length > 0) {
            assert.ok(delivered < 1000, "the chain never parked");
            messages.shift()?.onmessage?.({ data: null });
            delivered += 1;
          }
          return delivered;
        },
        messageCount: () => messages.length,
      });
    } finally {
      for (const [key, descriptor] of Object.entries(saved)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globals, key);
      }
      resetLazyWorkLedger();
      setLoadPhaseDrainScheduling("frame");
    }
  });
}

describe("createBudgetedDrain while the world loads", () => {
  it("runs frame slices while loading unless a caller opts in to tasks", async () => {
    vi.resetModules();
    const fresh = await import("./frame-budget");
    withLoadingPage(({ step, taskCount, pendingCount, advance }) => {
      let unitCount = 0;
      const drain = fresh.createBudgetedDrain(10, () => {
        unitCount += 1;
        advance(4);
        return "worked";
      });

      drain.schedule();
      assert.equal(taskCount(), 0);
      assert.equal(pendingCount(), 1);
      step();
      assert.equal(unitCount, 3);
      drain.cancel();
    });
  });

  it("hands a throw from a task to the page's error reporting", async () => {
    const reported: unknown[] = [];
    const saved = Object.getOwnPropertyDescriptor(globalThis, "reportError");
    Object.defineProperty(globalThis, "reportError", {
      value: (error: unknown) => reported.push(error),
      configurable: true,
      writable: true,
    });
    try {
      const failure = new Error("onDrained failed");
      withLoadingPage(({ runTasks, taskCount, advance }) => {
        const withdrawn = createBudgetedDrain(100, () => {
          advance(1);
          return "worked";
        });
        withdrawn.schedule();
        withdrawn.cancel();

        const drain = createBudgetedDrain(
          100,
          () => "exhausted",
          () => {
            throw failure;
          },
        );
        drain.schedule();
        runTasks();
        assert.equal(taskCount(), 0);
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.deepEqual(
        reported,
        [failure],
        "the throw is reported; the withdrawn task's AbortError is not",
      );
    } finally {
      if (saved) Object.defineProperty(globalThis, "reportError", saved);
      else Reflect.deleteProperty(globalThis, "reportError");
    }
  });

  it("spends one frame's budget across short background tasks", () => {
    withLoadingPage(({ runTasks, taskCount, step, advance }) => {
      let unitCount = 0;
      const drain = createBudgetedDrain(20, () => {
        unitCount += 1;
        advance(3);
        return "worked";
      });

      drain.schedule();
      assert.equal(taskCount(), 1, "no frame needed to start");

      // 3+3+3 ends a batch at LOAD_PHASE_BATCH_MS, twice (18 ms spent);
      // the third batch runs one unit, which reaches the 20 ms budget.
      assert.equal(LOAD_PHASE_BATCH_MS, 8);
      assert.equal(runTasks(), 3);
      assert.equal(unitCount, 7);
      assert.equal(taskCount(), 0, "parked until the next frame");

      step();
      assert.equal(taskCount(), 1);
      runTasks();
      assert.equal(unitCount, 14);
    });
  });

  it("runs one unit per task even when it overruns the budget", () => {
    withLoadingPage(({ runTasks, step, advance }) => {
      let unitCount = 0;
      const drain = createBudgetedDrain(4, () => {
        unitCount += 1;
        advance(100);
        return "worked";
      });

      drain.schedule();
      assert.equal(runTasks(), 1);
      assert.equal(unitCount, 1);

      step();
      runTasks();
      assert.equal(unitCount, 2);
    });
  });

  it("does not charge the budget for units that did nothing", () => {
    withLoadingPage(({ runTasks, advance }) => {
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
      runTasks();

      assert.equal(index, 3);
    });
  });

  it("posts its tasks at background priority unless told otherwise", () => {
    withLoadingPage(({ runTasks, taskPriorities, advance, step }) => {
      const drain = createBudgetedDrain(1, () => {
        advance(2);
        return "worked";
      });

      drain.schedule();
      runTasks();
      assert.deepEqual(taskPriorities(), ["background"]);

      setLoadPhaseDrainScheduling("task", "user-visible");
      step();
      runTasks();
      assert.deepEqual(taskPriorities(), ["background", "user-visible"]);
    });
  });

  it("parks on a yield until the next frame instead of spinning", () => {
    withLoadingPage(({ runTasks, taskCount, step, advance }) => {
      let callCount = 0;
      let isResultIn = false;
      let drainedCount = 0;
      const drain = createBudgetedDrain(
        100,
        () => {
          callCount += 1;
          if (!isResultIn) return "yield";
          advance(1);
          return "exhausted";
        },
        () => {
          drainedCount += 1;
        },
      );

      drain.schedule();
      assert.equal(runTasks(), 1);
      assert.equal(callCount, 1);
      assert.equal(taskCount(), 0);

      step();
      runTasks();
      assert.equal(callCount, 2, "one look per frame while it waits");

      isResultIn = true;
      step();
      runTasks();
      assert.equal(callCount, 3);
      assert.equal(drainedCount, 1);
    });
  });

  it("neither works nor fails on a yield", () => {
    withCapturedErrors((errors) => {
      withLoadingPage(({ runTasks, step }) => {
        const script: (BudgetedWorkOutcome | "throw")[] = [
          "throw",
          "throw",
          "throw",
          "throw",
          "yield",
          "throw",
        ];
        let index = 0;
        let drainedCount = 0;
        const drain = createBudgetedDrain(
          100,
          () => {
            const next = script[index++] ?? "exhausted";
            if (next === "throw") throw new Error("bake failed");
            return next;
          },
          () => {
            drainedCount += 1;
          },
        );

        drain.schedule();
        runTasks();
        assert.equal(index, 5, "the yield ended the batch");

        step();
        runTasks();
        assert.equal(drainedCount, 1);
        assert.equal(index, 6, "the yield did not reset the failure count");
        assert.match(errors().at(-1) ?? "", /stopping this drain/);
      });
    });
  });

  it("calls onDrained once when the work is exhausted", () => {
    withLoadingPage(({ runTasks, step, advance, taskCount }) => {
      let remaining = 5;
      let drainedCount = 0;
      const drain = createBudgetedDrain(
        100,
        () => {
          advance(3);
          return remaining-- > 0 ? "worked" : "exhausted";
        },
        () => {
          drainedCount += 1;
        },
      );

      drain.schedule();
      runTasks();
      step();
      runTasks();

      assert.equal(drainedCount, 1);
      assert.equal(taskCount(), 0);
    });
  });

  it("cancel withdraws a task that has not run yet", () => {
    withLoadingPage(({ runTasks, taskCount, advance }) => {
      let unitCount = 0;
      const drain = createBudgetedDrain(100, () => {
        unitCount += 1;
        advance(1);
        return "worked";
      });

      drain.schedule();
      assert.equal(taskCount(), 1);

      drain.cancel();
      assert.equal(taskCount(), 0);
      runTasks();
      assert.equal(unitCount, 0);

      drain.schedule();
      runTasks();
      assert.ok(unitCount > 0, "a cancelled drain can be scheduled again");
    });
  });

  it("gives up out loud after five throws in a row", () => {
    withCapturedErrors((errors) => {
      withLoadingPage(({ runTasks, taskCount }) => {
        let callCount = 0;
        let drainedCount = 0;
        const drain = createBudgetedDrain(
          1,
          () => {
            callCount += 1;
            throw new Error("always fails");
          },
          () => {
            drainedCount += 1;
          },
        );

        drain.schedule();
        runTasks();

        assert.equal(callCount, 5);
        assert.equal(drainedCount, 1);
        assert.equal(taskCount(), 0);
        assert.match(errors().at(-1) ?? "", /stopping this drain/);
      });
    });
  });

  it("drains a hidden tab on the ticker, then goes back to tasks", () => {
    withLoadingPage(
      ({ hide, show, tickHidden, hiddenTickerCount, taskCount, advance }) => {
        let unitCount = 0;
        const drain = createBudgetedDrain(1, () => {
          unitCount += 1;
          advance(2);
          return "worked";
        });

        hide();
        drain.schedule();
        assert.equal(taskCount(), 0);
        assert.equal(hiddenTickerCount(), 1);

        tickHidden();
        tickHidden();
        assert.equal(unitCount, 2, "one slice per tick, as before");

        show();
        assert.equal(hiddenTickerCount(), 0);
        assert.equal(taskCount(), 1);
      },
    );
  });

  it("withdraws a pending task when the tab hides", () => {
    withLoadingPage(({ hide, runTasks, tickHidden, advance }) => {
      let unitCount = 0;
      const drain = createBudgetedDrain(1, () => {
        unitCount += 1;
        advance(2);
        return "worked";
      });

      drain.schedule();
      hide();
      runTasks();
      assert.equal(unitCount, 0);

      tickHidden();
      assert.equal(unitCount, 1);
    });
  });

  it("runs plain frame slices once play is interactive", () => {
    withLoadingPage(({ step, advance, taskCount, pendingCount }) => {
      markPlayInteractive();
      let unitCount = 0;
      const drain = createBudgetedDrain(10, () => {
        unitCount += 1;
        advance(4);
        return "worked";
      });

      drain.schedule();
      assert.equal(taskCount(), 0);
      assert.equal(pendingCount(), 1);

      step();
      assert.equal(unitCount, 3);
      step();
      assert.equal(unitCount, 6);
      assert.equal(taskCount(), 0);
    });
  });

  it("ends a frame slice on a yield once play is interactive", () => {
    withLoadingPage(({ step, advance }) => {
      markPlayInteractive();
      const outcomes: BudgetedWorkOutcome[] = ["worked", "yield", "worked"];
      let index = 0;
      const drain = createBudgetedDrain(100, () => {
        const outcome = outcomes[index++] ?? "exhausted";
        if (outcome === "worked") advance(1);
        return outcome;
      });

      drain.schedule();
      step();
      assert.equal(index, 2);
      step();
      assert.equal(index, 4);
    });
  });

  it("finishes the running batch when play begins, then uses frames", () => {
    withLoadingPage(({ runTasks, taskCount, step, advance }) => {
      let unitCount = 0;
      const drain = createBudgetedDrain(10, () => {
        unitCount += 1;
        if (unitCount === 2) markPlayInteractive();
        advance(2);
        return "worked";
      });

      drain.schedule();
      assert.equal(runTasks(), 1);
      assert.equal(unitCount, 4, "the batch ran to its 8 ms");
      assert.equal(taskCount(), 0);

      step();
      assert.equal(unitCount, 9, "a frame slice spends the whole 10 ms");
      assert.equal(taskCount(), 0);
    });
  });

  it("moves a task posted before play began onto frames", () => {
    withLoadingPage(({ runTasks, step, advance }) => {
      let unitCount = 0;
      const drain = createBudgetedDrain(10, () => {
        unitCount += 1;
        advance(4);
        return "worked";
      });

      drain.schedule();
      markPlayInteractive();
      runTasks();
      assert.equal(unitCount, 0);

      step();
      assert.equal(unitCount, 3);
    });
  });

  it("resumes a chain parked on the budget as a frame slice after play begins", () => {
    withLoadingPage(({ runTasks, step, advance, taskCount }) => {
      let unitCount = 0;
      const drain = createBudgetedDrain(4, () => {
        unitCount += 1;
        advance(4);
        return "worked";
      });

      drain.schedule();
      runTasks();
      assert.equal(unitCount, 1);

      markPlayInteractive();
      step();
      assert.equal(unitCount, 2);
      assert.equal(taskCount(), 0);
    });
  });

  it("stays on frames in the load phase when switched to frame mode", () => {
    withLoadingPage(({ step, taskCount, advance }) => {
      setLoadPhaseDrainScheduling("frame");
      let unitCount = 0;
      const drain = createBudgetedDrain(10, () => {
        unitCount += 1;
        advance(4);
        return "worked";
      });

      drain.schedule();
      assert.equal(taskCount(), 0);
      step();
      assert.equal(unitCount, 3);
    });
  });

  it("falls back to MessageChannel posts without scheduler.postTask", () => {
    withLoadingPage(
      ({ deliverMessages, messageCount, step, advance }) => {
        let unitCount = 0;
        const drain = createBudgetedDrain(20, () => {
          unitCount += 1;
          advance(3);
          return "worked";
        });

        drain.schedule();
        assert.equal(messageCount(), 1);
        assert.equal(deliverMessages(), 3);
        assert.equal(unitCount, 7);

        step();
        deliverMessages();
        assert.equal(unitCount, 14);
      },
      { postTask: false },
    );
  });

  it("ignores a MessageChannel delivery that lands after cancel", () => {
    withLoadingPage(
      ({ deliverMessages, advance }) => {
        let unitCount = 0;
        const drain = createBudgetedDrain(20, () => {
          unitCount += 1;
          advance(3);
          return "worked";
        });

        drain.schedule();
        drain.cancel();
        deliverMessages();
        assert.equal(unitCount, 0);
      },
      { postTask: false },
    );
  });
});

describe("onPlayInteractive", () => {
  it("fires once per transition into play", () => {
    resetLazyWorkLedger();
    let callCount = 0;
    const unsubscribe = onPlayInteractive(() => {
      callCount += 1;
    });
    try {
      markPlayInteractive();
      markPlayInteractive();
      assert.equal(callCount, 1);

      resetLazyWorkLedger();
      markPlayInteractive();
      assert.equal(callCount, 2, "a reloaded world fires it again");

      unsubscribe();
      resetLazyWorkLedger();
      markPlayInteractive();
      assert.equal(callCount, 2);
    } finally {
      unsubscribe();
      resetLazyWorkLedger();
    }
  });

  it("still runs the other listeners when one throws", () => {
    withCapturedErrors((errors) => {
      resetLazyWorkLedger();
      let laterCount = 0;
      const unsubscribeThrowing = onPlayInteractive(() => {
        throw new Error("listener failed");
      });
      const unsubscribeLater = onPlayInteractive(() => {
        laterCount += 1;
      });
      try {
        markPlayInteractive();
        assert.equal(laterCount, 1);
        assert.equal(errors().length, 1);
        assert.match(errors()[0], /play-interactive listener threw/);
      } finally {
        unsubscribeThrowing();
        unsubscribeLater();
        resetLazyWorkLedger();
      }
    });
  });
});
