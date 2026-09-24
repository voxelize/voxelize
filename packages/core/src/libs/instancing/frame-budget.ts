/// Spreads work that cannot be interrupted mid-unit across frames.
///
/// The budget is spent, not reserved: it is checked after a unit of work
/// rather than before, because a unit that would overrun cannot be split and
/// a budget that could refuse every unit would never drain the queue. One
/// unit therefore always runs, and the slice ends as soon as the accumulated
/// cost reaches the budget.

/// How often a slice runs while the tab is hidden. A backgrounded tab is
/// served no frames at all, so a drain paced by `requestAnimationFrame`
/// freezes there and strands whoever awaits it; the ticker below keeps the
/// cadence the tab would have had, and there are no frames left to protect.
const HIDDEN_TAB_SLICE_INTERVAL_MS = 1000 / 60;

/// How many units in a row may throw before the drain stops. A unit that
/// throws without consuming itself is handed back on the next slice and
/// would otherwise fail forever, so the drain gives up out loud instead of
/// spinning on it.
const MAX_CONSECUTIVE_UNIT_FAILURES = 5;

/// What one unit of work cost the frame. `skipped` means the unit was
/// consumed without doing any painting - it must still make progress, or the
/// slice never ends - and so does not count against the budget.
export type BudgetedWorkOutcome = "worked" | "skipped" | "exhausted";

/// Starts a repeating tick and returns its stop function. Frames and
/// timeouts are both withheld from a hidden tab, so this has to come from a
/// source the browser still honours there - a worker's interval, which is
/// what the world loop switches to for the same reason.
export type HiddenTabTicker = (
  onTick: () => void,
  intervalMs: number,
) => () => void;

let hiddenTabTicker: HiddenTabTicker | null = null;

export function setHiddenTabTicker(ticker: HiddenTabTicker): void {
  hiddenTabTicker = ticker;
}

export interface BudgetedDrain {
  schedule(): void;
  cancel(): void;
}

function isTabHidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}

export function createBudgetedDrain(
  budgetMs: number,
  work: () => BudgetedWorkOutcome,
  onDrained?: () => void,
): BudgetedDrain {
  let frameHandle = 0;
  let stopHiddenTicks: (() => void) | null = null;
  let isSliceQueued = false;
  let consecutiveFailureCount = 0;

  function schedule(): void {
    if (isSliceQueued) return;
    isSliceQueued = true;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    attachTickSource();
  }

  function attachTickSource(): void {
    if (!isTabHidden()) {
      if (frameHandle === 0) frameHandle = requestAnimationFrame(runSlice);
      return;
    }
    if (stopHiddenTicks) return;
    if (!hiddenTabTicker) {
      console.error(
        "[frame-budget] the tab is hidden and no hidden-tab ticker is " +
          "installed, so this drain is parked until the tab is shown again",
      );
      return;
    }
    stopHiddenTicks = hiddenTabTicker(runSlice, HIDDEN_TAB_SLICE_INTERVAL_MS);
  }

  function detachTickSource(): void {
    if (frameHandle !== 0) {
      cancelAnimationFrame(frameHandle);
      frameHandle = 0;
    }
    stopHiddenTicks?.();
    stopHiddenTicks = null;
  }

  function onVisibilityChange(): void {
    if (!isSliceQueued) return;
    detachTickSource();
    attachTickSource();
  }

  function stop(): void {
    isSliceQueued = false;
    detachTickSource();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  }

  function runUnit(): BudgetedWorkOutcome {
    try {
      const outcome = work();
      consecutiveFailureCount = 0;
      return outcome;
    } catch (error) {
      consecutiveFailureCount += 1;
      console.error(
        "[frame-budget] a unit of work threw and is being skipped " +
          `(${consecutiveFailureCount} in a row)`,
        error,
      );
      if (consecutiveFailureCount >= MAX_CONSECUTIVE_UNIT_FAILURES) {
        console.error(
          `[frame-budget] stopping this drain after ${MAX_CONSECUTIVE_UNIT_FAILURES} ` +
            "consecutive failures; whatever is left in it will not be done",
        );
        return "exhausted";
      }
      return "worked";
    }
  }

  function runSlice(): void {
    frameHandle = 0;
    if (!isSliceQueued) return;
    isSliceQueued = false;

    const startedAt = performance.now();
    for (;;) {
      const outcome = runUnit();
      if (outcome === "exhausted") {
        stop();
        onDrained?.();
        return;
      }
      if (outcome === "worked" && performance.now() - startedAt >= budgetMs) {
        break;
      }
    }
    schedule();
  }

  return { schedule, cancel: stop };
}
