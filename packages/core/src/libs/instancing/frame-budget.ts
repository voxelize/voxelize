/// Spreads work that cannot be interrupted mid-unit across frames.
///
/// The budget is spent, not reserved: it is checked after a unit of work
/// rather than before, because a unit that would overrun cannot be split and
/// a budget that could refuse every unit would never drain the queue. One
/// unit therefore always runs, and the slice ends as soon as the accumulated
/// cost reaches the budget.
///
/// While the world is still loading, a caller can opt in
/// (`setLoadPhaseDrainScheduling("task")`) to running a frame's slice as a
/// chain of short background-priority tasks that together spend the same
/// per-frame budget, instead of one long block inside
/// `requestAnimationFrame`. The browser hands a socket's bytes to the page
/// between tasks (Chrome through a 128 KB pipe), so a 60 ms frame slice lets
/// roughly one pipe in per frame and a 1.5 MB join message crawls in over
/// most of a second behind it. It is the background priority that lets the
/// socket in, not the slicing: in a game's same-build A/B the join message
/// arrived after 110 ms instead of 591 ms with background tasks, and after
/// 637 ms with the same tasks at normal priority, no gain at all.
///
/// Frame slices stay the default because that A/B lost more than it won.
/// With no long block to wait on, loading frames ran at 60 Hz instead of
/// about 10 Hz, each paid the game's world update, and at background
/// priority the warmup drain lost the main thread to every one of them:
/// the instanced-roster warmup took 56% longer and the player got control
/// 44% later. Opt in only where the loading frame loop is throttled. Once
/// the player has control (`markPlayInteractive`), every slice is a plain
/// frame slice in either mode.

import { isPlayInteractive } from "./pool-warmup";

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

/// The longest one load-phase task runs before handing the main thread back
/// (spent like the frame budget: checked after a unit, so one unit always
/// runs). Loopback bench, Chrome 131: a 1.51 MB socket message lands in
/// ~4 ms on an idle page, ~780 ms behind 60 ms frame slices and ~75 ms
/// behind 8 ms background tasks doing the same work per second.
export const LOAD_PHASE_BATCH_MS = 8;

/// What one unit of work cost the frame. `skipped` means the unit was
/// consumed without doing any painting - it must still make progress, or the
/// slice never ends - and so does not count against the budget. `yield`
/// means the unit is waiting on something off the main thread (a worker's
/// result): the slice ends there, the unit counts as neither worked nor
/// failed, and the drain comes back next frame instead of spinning on it.
export type BudgetedWorkOutcome = "worked" | "skipped" | "exhausted" | "yield";

/// How load-phase slices are run: `frame` (the default) as one block per
/// animation frame, which is how every slice runs once play is interactive;
/// `task` (opt-in) as a chain of short tasks at `LoadPhaseTaskPriority`.
export type LoadPhaseDrainScheduling = "task" | "frame";

/// The `scheduler.postTask` priority of load-phase tasks. `background` lets
/// every normal-priority task (socket messages, worker replies, input) run
/// first, which is what lets a join message in. `user-visible` competes with
/// them as an equal, and measured in a game it let the network in no sooner
/// than frame slices did.
export type LoadPhaseTaskPriority = "background" | "user-visible";

let loadPhaseScheduling: LoadPhaseDrainScheduling = "frame";
let loadPhaseTaskPriority: LoadPhaseTaskPriority = "background";

export function setLoadPhaseDrainScheduling(
  mode: LoadPhaseDrainScheduling,
  priority: LoadPhaseTaskPriority = "background",
): void {
  loadPhaseScheduling = mode;
  loadPhaseTaskPriority = priority;
}

/// Outside a page (a test, a worker) there is no socket pipe to protect and
/// frames are the only clock a caller drives, so drains stay frame-paced.
function isLoadPhaseTaskMode(): boolean {
  return (
    loadPhaseScheduling === "task" &&
    typeof window !== "undefined" &&
    !isPlayInteractive()
  );
}

interface PostTaskScheduler {
  postTask(
    callback: () => void,
    options?: { priority?: LoadPhaseTaskPriority; signal?: AbortSignal },
  ): Promise<unknown>;
}

type AbortControllerConstructor = new () => {
  readonly signal: AbortSignal;
  abort(): void;
};

/// A throw inside a `postTask` task rejects its promise instead of reaching
/// the page's error handlers, where the same throw from a frame callback
/// goes; this hands it on to them, so a failing `onDrained` is reported the
/// same way in either mode. Withdrawing a task rejects it with an
/// `AbortError`, which is not a failure.
function surfaceTaskError(error: unknown): void {
  if ((error as { name?: unknown } | null)?.name === "AbortError") return;
  const report = (globalThis as { reportError?: (error: unknown) => void })
    .reportError;
  if (typeof report === "function") {
    report(error);
    return;
  }
  queueMicrotask(() => {
    throw error;
  });
}

/// Posts `run` as its own task and returns a function that withdraws it.
/// `scheduler.postTask` where the browser has it; a `MessageChannel` post
/// otherwise (Safari). That fallback is a normal-priority task, and normal
/// priority measured no network gain in a game (see the top of this file),
/// so it keeps task mode correct where `postTask` is missing, not fast.
/// Each post gets its own channel, closed on delivery or withdrawal, so no
/// port outlives the work it carried.
function postLoadPhaseTask(run: () => void): () => void {
  const scheduler = (globalThis as { scheduler?: Partial<PostTaskScheduler> })
    .scheduler;
  if (scheduler && typeof scheduler.postTask === "function") {
    const globals = globalThis as {
      TaskController?: AbortControllerConstructor;
      AbortController?: AbortControllerConstructor;
    };
    const Controller = globals.TaskController ?? globals.AbortController;
    const controller = Controller ? new Controller() : null;
    scheduler
      .postTask(run, {
        priority: loadPhaseTaskPriority,
        signal: controller?.signal,
      })
      .catch(surfaceTaskError);
    return () => controller?.abort();
  }
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    channel.port1.close();
    run();
  };
  channel.port2.postMessage(null);
  return () => channel.port1.close();
}

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

  // The load-phase chain. `spentThisFrame` is what its tasks have cost since
  // the last frame; a frame watch (one `requestAnimationFrame` after any
  // batch that spent time) resets it, and resumes a chain parked on a spent
  // budget or a `yield`. A posted task carries the generation it was posted
  // in, so one that was withdrawn but delivered anyway does nothing.
  let withdrawPendingBatch: (() => void) | null = null;
  let batchGeneration = 0;
  let isBatchRunning = false;
  let isWaitingForFrame = false;
  let hasYieldedThisFrame = false;
  let frameWatchHandle = 0;
  let spentThisFrame = 0;

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
      if (isLoadPhaseTaskMode()) {
        continueLoadPhaseChain();
        return;
      }
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
    batchGeneration += 1;
    withdrawPendingBatch?.();
    withdrawPendingBatch = null;
    isWaitingForFrame = false;
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
      if (outcome !== "yield") consecutiveFailureCount = 0;
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
      if (outcome === "yield") break;
      if (outcome === "worked" && performance.now() - startedAt >= budgetMs) {
        break;
      }
    }
    schedule();
  }

  function continueLoadPhaseChain(): void {
    if (isBatchRunning || withdrawPendingBatch || isWaitingForFrame) return;
    if (spentThisFrame >= budgetMs || hasYieldedThisFrame) {
      isWaitingForFrame = true;
      watchForNextFrame();
      return;
    }
    const generation = batchGeneration;
    withdrawPendingBatch = postLoadPhaseTask(() => runBatch(generation));
  }

  function watchForNextFrame(): void {
    if (frameWatchHandle === 0) {
      frameWatchHandle = requestAnimationFrame(onFrame);
    }
  }

  function onFrame(): void {
    frameWatchHandle = 0;
    spentThisFrame = 0;
    hasYieldedThisFrame = false;
    if (!isWaitingForFrame) return;
    isWaitingForFrame = false;
    if (!isSliceQueued) return;
    if (isLoadPhaseTaskMode()) {
      continueLoadPhaseChain();
      return;
    }
    // Play began while the chain was parked: this frame gets the plain
    // slice every frame gets from here on.
    runSlice();
  }

  function runBatch(generation: number): void {
    if (generation !== batchGeneration) return;
    withdrawPendingBatch = null;
    if (!isSliceQueued) return;
    if (!isLoadPhaseTaskMode()) {
      // Play began while this task waited: the queued work moves to frames.
      attachTickSource();
      return;
    }
    isSliceQueued = false;
    isBatchRunning = true;

    const startedAt = performance.now();
    let outcome: BudgetedWorkOutcome;
    for (;;) {
      outcome = runUnit();
      if (outcome === "exhausted" || outcome === "yield") break;
      if (outcome === "worked") {
        const elapsed = performance.now() - startedAt;
        if (
          elapsed >= LOAD_PHASE_BATCH_MS ||
          spentThisFrame + elapsed >= budgetMs
        ) {
          break;
        }
      }
    }
    isBatchRunning = false;
    spentThisFrame += performance.now() - startedAt;
    watchForNextFrame();

    if (outcome === "exhausted") {
      stop();
      onDrained?.();
      return;
    }
    if (outcome === "yield") hasYieldedThisFrame = true;
    // A unit may have scheduled more work while the batch ran; that request
    // was held until here, and this re-queue covers it.
    isSliceQueued = false;
    schedule();
  }

  return { schedule, cancel: stop };
}
