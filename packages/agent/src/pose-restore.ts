import type { PoseVec3, RememberedPose } from "./pose-memory";

/**
 * Putting a remembered pose back after a rejoin.
 *
 * The session reads fresh once its connection is live, and a host's join can
 * still be finishing then: it may place the player and create the settings
 * that hold the view radius at the very end, seconds later. A pose replayed
 * at that moment loses its radius (the settings do not exist yet) and can be
 * moved by the join's last steps. So the replay waits for the host to report
 * its join finished (`Snapshot.isReady`), then puts the pose back: position
 * and facing first, then flight, so flight that cannot take off (a rejoin
 * that came back on the floor) does not cost the position too. The radius is
 * still retried, for a host whose readiness says less than that; once it
 * needed retries, position and facing are put back after it lands. Every
 * wait is bounded, and stops when a command takes over or the page rejoins.
 */

export type PoseRestoreSteps = {
  /** The host's join has finished: the world can be played and set up. */
  isJoinFinished(): Promise<boolean>;
  setFlying(isFlying: boolean): Promise<unknown>;
  teleport(position: PoseVec3): Promise<unknown>;
  face(facing: { yaw: number; pitch: number }): Promise<unknown>;
  setRenderRadius(radius: number): Promise<unknown>;
  /** A move command started after the pose was remembered: leave it there. */
  isMoveOverridden(): boolean;
  /** A command set the view radius after the rejoin was seen: keep that one. */
  isRadiusOverridden(): boolean;
  /** The page is still on the join this restore is for. */
  isSameJoin(): Promise<boolean>;
};

export type PoseReplayOptions = {
  /** How long the join, and then the view radius, may take before giving up. */
  retryMs: number;
  intervalMs?: number;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type PoseReplayReport = {
  /** Null when every part landed; otherwise why one did not. */
  error: string | null;
  /** How long the replay waited for the host's join to finish. */
  joinWaitMs: number;
  /** Tries the view radius took, 0 when the pose carries none. */
  renderRadiusAttempts: number;
  /** From the first failed try to the one that landed (or the last). */
  renderRadiusWaitMs: number;
};

export const DEFAULT_RENDER_RADIUS_RETRY_INTERVAL_MS = 1_000;

const MOVED_FIRST = "a command moved the agent first; left where it put it";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatSeconds(ms: number): string {
  return `${Math.round(ms / 100) / 10}s`;
}

export async function replayPose(
  pose: RememberedPose,
  steps: PoseRestoreSteps,
  options: PoseReplayOptions,
): Promise<PoseReplayReport> {
  const {
    retryMs,
    intervalMs = DEFAULT_RENDER_RADIUS_RETRY_INTERVAL_MS,
    log = () => undefined,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
  } = options;
  const report: PoseReplayReport = {
    error: null,
    joinWaitMs: 0,
    renderRadiusAttempts: 0,
    renderRadiusWaitMs: 0,
  };
  const putBack = async () => {
    if (!steps.isMoveOverridden()) await steps.teleport(pose.position);
    if (!steps.isMoveOverridden()) await steps.face({ ...pose.facing });
  };
  let flightError: string | null = null;
  let thrown: string | null = null;
  try {
    const startedAt = now();
    while (!(await steps.isJoinFinished())) {
      report.joinWaitMs = now() - startedAt;
      if (report.joinWaitMs + intervalMs > retryMs) {
        report.error = `the join did not finish within ${formatSeconds(report.joinWaitMs)}, so the pose was not put back`;
        return report;
      }
      await sleep(intervalMs);
      if (steps.isMoveOverridden()) {
        report.error = MOVED_FIRST;
        return report;
      }
      if (!(await steps.isSameJoin())) {
        report.error =
          "the page rejoined again before its join finished; the next restore takes over";
        return report;
      }
    }
    report.joinWaitMs = now() - startedAt;
    await putBack();
    if (pose.isFlying !== null) {
      try {
        await steps.setFlying(pose.isFlying);
        // Taking off kicks the body up; put the staged pose back exactly.
        if (pose.isFlying && !steps.isMoveOverridden()) {
          await steps.teleport(pose.position);
        }
      } catch (error) {
        flightError = describeError(error);
      }
    }
    if (pose.renderRadius !== null) {
      report.error = await restoreRenderRadius(
        pose.renderRadius,
        steps,
        report,
        { retryMs, intervalMs, log, sleep, now },
      );
      if (report.error === null && report.renderRadiusAttempts > 1) {
        await putBack();
      }
    }
  } catch (error) {
    thrown = describeError(error);
  }
  if (thrown !== null) {
    report.error = thrown;
  } else if (report.error === null && steps.isMoveOverridden()) {
    report.error = MOVED_FIRST;
  } else if (flightError !== null) {
    report.error = [`placed, but ${flightError}`, report.error]
      .filter((part) => part !== null)
      .join("; ");
  }
  return report;
}

async function restoreRenderRadius(
  radius: number,
  steps: PoseRestoreSteps,
  report: PoseReplayReport,
  options: Required<Omit<PoseReplayOptions, "retryMs">> & { retryMs: number },
): Promise<string | null> {
  const { retryMs, intervalMs, log, sleep, now } = options;
  let firstFailureAt: number | null = null;
  for (;;) {
    if (steps.isRadiusOverridden()) {
      return null;
    }
    report.renderRadiusAttempts += 1;
    let failure: string;
    try {
      await steps.setRenderRadius(radius);
      if (firstFailureAt !== null) {
        report.renderRadiusWaitMs = now() - firstFailureAt;
        log(
          `render radius ${radius} landed on try ${report.renderRadiusAttempts}, ${formatSeconds(report.renderRadiusWaitMs)} after the first`,
        );
      }
      return null;
    } catch (error) {
      failure = describeError(error);
    }
    firstFailureAt ??= now();
    report.renderRadiusWaitMs = now() - firstFailureAt;
    if (report.renderRadiusWaitMs + intervalMs > retryMs) {
      return `render radius ${radius} not applied after ${formatSeconds(report.renderRadiusWaitMs)} (${report.renderRadiusAttempts} tries): ${failure}`;
    }
    if (report.renderRadiusAttempts === 1) {
      log(
        `render radius ${radius} not applied yet (${failure}); retrying every ${formatSeconds(intervalMs)} for up to ${formatSeconds(retryMs)} while the join finishes`,
      );
    }
    await sleep(intervalMs);
    if (!(await steps.isSameJoin())) {
      return `the page rejoined again before render radius ${radius} landed (${report.renderRadiusAttempts} tries); the next restore takes over`;
    }
  }
}
