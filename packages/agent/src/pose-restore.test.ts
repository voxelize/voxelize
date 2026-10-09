import { describe, expect, it } from "vitest";

import type { RememberedPose } from "./pose-memory";
import { PoseRestoreSteps, replayPose } from "./pose-restore";

const NOT_YET =
  "render radius 6 not applied: the client's settings do not exist yet (the join has not finished), so the world still runs at 4";

const POSE: RememberedPose = {
  position: { x: 6.5, y: 40, z: 6.5 },
  facing: { yaw: 1.1, pitch: -0.2 },
  isFlying: true,
  renderRadius: 6,
  sampledAt: 0,
  join: { documentId: 1, joinGeneration: 1 },
};

/**
 * A page whose join reports finished after `joinPolls` asks and whose
 * settings take `failures` tries; time only moves in sleeps. `onSleep` lets
 * a test change the world between tries.
 */
function page({
  failures = 0,
  joinPolls = 0,
  onSleep = () => undefined,
}: {
  failures?: number;
  joinPolls?: number;
  onSleep?: (calls: string[]) => void;
} = {}) {
  let clock = 0;
  const calls: string[] = [];
  const lines: string[] = [];
  const state = {
    isMoveOverridden: false,
    isRadiusOverridden: false,
    isSameJoin: true,
  };
  let radiusTries = 0;
  let polls = 0;
  const steps: PoseRestoreSteps = {
    isJoinFinished: async () => {
      polls += 1;
      return polls > joinPolls;
    },
    setFlying: async (isFlying) => {
      calls.push(`fly ${isFlying}`);
    },
    teleport: async ({ x, y, z }) => {
      calls.push(`teleport ${x},${y},${z}`);
    },
    face: async () => {
      calls.push("face");
    },
    setRenderRadius: async (radius) => {
      radiusTries += 1;
      calls.push(`radius ${radius}`);
      if (radiusTries <= failures) throw new Error(NOT_YET);
      return radius;
    },
    isMoveOverridden: () => state.isMoveOverridden,
    isRadiusOverridden: () => state.isRadiusOverridden,
    isSameJoin: async () => state.isSameJoin,
  };
  return {
    steps,
    calls,
    lines,
    state,
    options: {
      intervalMs: 1_000,
      log: (line: string) => lines.push(line),
      sleep: async (ms: number) => {
        clock += ms;
        onSleep(calls);
      },
      now: () => clock,
    },
  };
}

describe("replayPose", () => {
  it("places the pose, then flies and places it again, then sets the radius", async () => {
    const live = page();
    const report = await replayPose(POSE, live.steps, {
      ...live.options,
      retryMs: 60_000,
    });
    expect(report).toEqual({
      error: null,
      joinWaitMs: 0,
      renderRadiusAttempts: 1,
      renderRadiusWaitMs: 0,
    });
    expect(live.calls).toEqual([
      "teleport 6.5,40,6.5",
      "face",
      "fly true",
      "teleport 6.5,40,6.5",
      "radius 6",
    ]);
    expect(live.lines).toEqual([]);
  });

  it("keeps the position when flight cannot take off, and says so", async () => {
    const live = page();
    live.steps.setFlying = async () => {
      throw new Error("flight did not take off: the body is on the floor");
    };
    const report = await replayPose(POSE, live.steps, {
      ...live.options,
      retryMs: 60_000,
    });
    expect(report.error).toBe(
      "placed, but flight did not take off: the body is on the floor",
    );
    expect(live.calls).toEqual(["teleport 6.5,40,6.5", "face", "radius 6"]);
  });

  it("waits for a join that creates its settings late, then puts the pose back again", async () => {
    const live = page({ failures: 3 });
    const report = await replayPose(POSE, live.steps, {
      ...live.options,
      retryMs: 60_000,
    });
    expect(report).toEqual({
      error: null,
      joinWaitMs: 0,
      renderRadiusAttempts: 4,
      renderRadiusWaitMs: 3_000,
    });
    expect(live.calls).toEqual([
      "teleport 6.5,40,6.5",
      "face",
      "fly true",
      "teleport 6.5,40,6.5",
      "radius 6",
      "radius 6",
      "radius 6",
      "radius 6",
      "teleport 6.5,40,6.5",
      "face",
    ]);
    expect(live.lines[0]).toContain(
      "render radius 6 not applied yet (render radius 6 not applied: the client's settings do not exist yet",
    );
    expect(live.lines[0]).toContain("retrying every 1s for up to 60s");
    expect(live.lines[1]).toBe(
      "render radius 6 landed on try 4, 3s after the first",
    );
  });

  it("gives up once the budget runs out, saying how long it tried and why", async () => {
    const live = page({ failures: 100 });
    const report = await replayPose(POSE, live.steps, {
      ...live.options,
      retryMs: 5_000,
    });
    // Tries at 0..5s; a seventh would start past the 5s budget.
    expect(report.renderRadiusAttempts).toBe(6);
    expect(report.error).toBe(
      `render radius 6 not applied after 5s (6 tries): ${NOT_YET}`,
    );
    // Placed, and placed again after takeoff; never after a radius that failed.
    expect(
      live.calls.filter((call) => call === "teleport 6.5,40,6.5"),
    ).toHaveLength(2);
  });

  it("stops when the page rejoins again: the next restore takes over", async () => {
    const live = page({
      failures: 100,
      onSleep: () => {
        live.state.isSameJoin = false;
      },
    });
    const report = await replayPose(POSE, live.steps, {
      ...live.options,
      retryMs: 60_000,
    });
    expect(report.error).toBe(
      "the page rejoined again before render radius 6 landed (1 tries); the next restore takes over",
    );
  });

  it("keeps a radius a command set meanwhile, and leaves a moved agent where it went", async () => {
    const radiusSet = page({
      failures: 100,
      onSleep: () => {
        radiusSet.state.isRadiusOverridden = true;
      },
    });
    const kept = await replayPose(POSE, radiusSet.steps, {
      ...radiusSet.options,
      retryMs: 60_000,
    });
    expect(kept.error).toBeNull();
    expect(radiusSet.calls.filter((call) => call === "radius 6")).toHaveLength(
      1,
    );

    const moved = page({
      failures: 2,
      onSleep: () => {
        moved.state.isMoveOverridden = true;
      },
    });
    const left = await replayPose(POSE, moved.steps, {
      ...moved.options,
      retryMs: 60_000,
    });
    expect(left.error).toBe(
      "a command moved the agent first; left where it put it",
    );
    // Placed and placed after takeoff, but not again once the move came in.
    expect(
      moved.calls.filter((call) => call.startsWith("teleport")),
    ).toHaveLength(2);
  });

  it("waits for the host's join to finish before putting anything back", async () => {
    const live = page({ joinPolls: 2 });
    const report = await replayPose(POSE, live.steps, {
      ...live.options,
      retryMs: 60_000,
    });
    expect(report).toEqual({
      error: null,
      joinWaitMs: 2_000,
      renderRadiusAttempts: 1,
      renderRadiusWaitMs: 0,
    });
    expect(live.calls[0]).toBe("teleport 6.5,40,6.5");
  });

  it("puts nothing back when the join never finishes, a command moves first, or the page rejoins", async () => {
    const stuck = page({ joinPolls: 100 });
    const never = await replayPose(POSE, stuck.steps, {
      ...stuck.options,
      retryMs: 3_000,
    });
    expect(never.error).toBe(
      "the join did not finish within 3s, so the pose was not put back",
    );
    expect(stuck.calls).toEqual([]);

    const moved = page({
      joinPolls: 100,
      onSleep: () => {
        moved.state.isMoveOverridden = true;
      },
    });
    const left = await replayPose(POSE, moved.steps, {
      ...moved.options,
      retryMs: 60_000,
    });
    expect(left.error).toBe(
      "a command moved the agent first; left where it put it",
    );
    expect(moved.calls).toEqual([]);

    const rejoined = page({
      joinPolls: 100,
      onSleep: () => {
        rejoined.state.isSameJoin = false;
      },
    });
    const next = await replayPose(POSE, rejoined.steps, {
      ...rejoined.options,
      retryMs: 60_000,
    });
    expect(next.error).toBe(
      "the page rejoined again before its join finished; the next restore takes over",
    );
    expect(rejoined.calls).toEqual([]);
  });

  it("restores a pose without a radius at once, and never waits for one", async () => {
    const live = page();
    const report = await replayPose(
      { ...POSE, renderRadius: null, isFlying: null },
      live.steps,
      { ...live.options, retryMs: 60_000 },
    );
    expect(report).toEqual({
      error: null,
      joinWaitMs: 0,
      renderRadiusAttempts: 0,
      renderRadiusWaitMs: 0,
    });
    expect(live.calls).toEqual(["teleport 6.5,40,6.5", "face"]);
  });

  it("reports a step that throws for any other reason", async () => {
    const live = page();
    live.steps.teleport = async () => {
      throw new Error('page call "teleport" timed out after 10000ms');
    };
    const report = await replayPose(POSE, live.steps, {
      ...live.options,
      retryMs: 60_000,
    });
    expect(report.error).toBe('page call "teleport" timed out after 10000ms');
  });
});
