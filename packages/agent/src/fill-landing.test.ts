import { describe, expect, it } from "vitest";

import type {
  CommandDispatch,
  ConnectionSnapshot,
  VoxelCensus,
  VoxelCensusBox,
} from "./bridge";
import {
  DEFAULT_FILL_LANDING,
  FillPageUnavailableError,
  boxVolume,
  censusVoxel,
  fillLandingTimeoutMs,
  landFill,
  type FillBox,
  type FillLandingOptions,
} from "./fill-landing";

const ran: CommandDispatch = {
  isSent: true,
  isQueued: false,
  outcome: { kind: "ran" },
};
const unanswered: CommandDispatch = {
  isSent: true,
  isQueued: false,
  outcome: { kind: "unanswered", waitedMs: 5000 },
};
const queued: CommandDispatch = {
  isSent: false,
  isQueued: true,
  queuedReason: "rejoining",
};

const OPTIONS: FillLandingOptions = {
  ...DEFAULT_FILL_LANDING,
  timeoutMs: 120_000,
  resendAfterMs: 20_000,
  arrivalGraceMs: 15_000,
};

type Fate = "lands" | "lost" | "late" | "queued" | "stalls";

/**
 * A world the page reads and a server the sends reach, with a clock the
 * loop's sleeps advance. Each send takes the next fate off `fates` (then
 * lands): a lost one goes unanswered and writes nothing, a late one writes
 * but its answer misses the wait.
 */
function harness(fates: Fate[] = []) {
  const voxels = new Map<string, string>();
  const unloaded = new Set<string>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  let clock = 0;
  const sent: FillBox[] = [];
  let connection: ConnectionSnapshot = {
    isConnected: true,
    isJoined: true,
    isJoinPending: false,
    isClientOutdated: false,
    joinGeneration: 1,
    pendingCommandCount: 0,
    droppedCommandCount: 0,
    serverUrl: null,
  };
  const pendingAfterRejoin: FillBox[] = [];
  const write = (box: FillBox) => {
    for (let i = 0; i < boxVolume(box); i++) {
      const { x, y, z } = censusVoxel(box, i);
      voxels.set(key(x, y, z), box.block.toLowerCase());
    }
  };
  const world = {
    voxels,
    unloaded,
    sent,
    key,
    write,
    rejoin(isFlushing = true) {
      connection = {
        ...connection,
        joinGeneration: connection.joinGeneration + 1,
      };
      if (isFlushing) pendingAfterRejoin.splice(0).forEach(write);
    },
    setLive(isLive: boolean) {
      connection = {
        ...connection,
        isConnected: isLive,
        isJoinPending: !isLive,
      };
    },
    deps: {
      async send(box: FillBox): Promise<CommandDispatch> {
        const fate = fates.shift() ?? "lands";
        if (fate === "stalls") {
          throw new FillPageUnavailableError('page call "call" timed out');
        }
        sent.push(box);
        if (fate === "lost") return unanswered;
        if (fate === "late") {
          write(box);
          return unanswered;
        }
        if (fate === "queued") {
          pendingAfterRejoin.push(box);
          return queued;
        }
        write(box);
        return ran;
      },
      async census(boxes: VoxelCensusBox[]): Promise<VoxelCensus[]> {
        return boxes.map((box) => {
          const fill = box as FillBox;
          const volume = boxVolume(fill);
          const bits = new Uint8Array(Math.ceil(volume / 8));
          let matching = 0;
          let missing = 0;
          const mismatches: VoxelCensus["mismatches"] = [];
          for (let i = 0; i < volume; i++) {
            const pos = censusVoxel(fill, i);
            const at = key(pos.x, pos.y, pos.z);
            if (unloaded.has(at)) {
              missing++;
              continue;
            }
            const held = voxels.get(at) ?? "air";
            if (held === box.block.toLowerCase()) {
              bits[i >> 3] |= 1 << (i & 7);
              matching++;
            } else if (mismatches.length < 8) {
              mismatches.push({ pos, name: held });
            }
          }
          return {
            volume,
            matching,
            refilled: 0,
            unloaded: missing,
            matched: Buffer.from(bits).toString("base64"),
            mismatches,
          };
        });
      },
      connection: () => connection,
      now: () => clock,
      async sleep(ms: number) {
        clock += ms;
      },
    },
  };
  return world;
}

const BOX: FillBox = { min: [0, 1, 0], max: [3, 2, 3], block: "Granite" };

describe("fillLandingTimeoutMs", () => {
  it("grows with the box in whole milliseconds, to a ceiling", () => {
    expect(fillLandingTimeoutMs(1)).toBe(180_001);
    expect(fillLandingTimeoutMs(864)).toBe(180_432);
    expect(fillLandingTimeoutMs(10_000_000)).toBe(900_000);
  });
});

describe("census bits", () => {
  it("walks a box x outermost, then y, then z from its low corner", () => {
    const box: FillBox = { min: [2, 5, 9], max: [0, 4, 7], block: "air" };
    expect(boxVolume(box)).toBe(18);
    expect(censusVoxel(box, 0)).toEqual({ x: 0, y: 4, z: 7 });
    expect(censusVoxel(box, 1)).toEqual({ x: 0, y: 4, z: 8 });
    expect(censusVoxel(box, 3)).toEqual({ x: 0, y: 5, z: 7 });
    expect(censusVoxel(box, 6)).toEqual({ x: 1, y: 4, z: 7 });
    expect(censusVoxel(box, 17)).toEqual({ x: 2, y: 5, z: 9 });
  });
});

describe("landFill", () => {
  it("lands a fill the server ran on the first send", async () => {
    const world = harness();
    const report = await landFill([BOX], world.deps, OPTIONS);
    expect(report.status).toBe("landed");
    expect(report.boxes[0].landed).toBe(32);
    expect(report.boxes[0].sends.map((s) => s.reason)).toEqual(["first"]);
    expect(report.message).toContain("all 32 voxels landed");
  });

  it("sends again a call the connection lost, once the box stops reading back", async () => {
    const world = harness(["lost"]);
    const report = await landFill([BOX], world.deps, OPTIONS);
    expect(report.status).toBe("landed");
    expect(report.boxes[0].sends.map((s) => s.reason)).toEqual([
      "first",
      "no-progress",
    ]);
    expect(report.elapsedMs).toBeGreaterThanOrEqual(OPTIONS.resendAfterMs);
  });

  it("sends again at once after a rejoin the server never answered across", async () => {
    const world = harness(["lost"]);
    const deps = {
      ...world.deps,
      async sleep(ms: number) {
        await world.deps.sleep(ms);
        if (world.sent.length === 1 && world.deps.now() === 2_000) {
          world.rejoin();
        }
      },
    };
    const report = await landFill([BOX], deps, OPTIONS);
    expect(report.status).toBe("landed");
    expect(report.boxes[0].sends.map((s) => s.reason)).toEqual([
      "first",
      "rejoined",
    ]);
    expect(report.elapsedMs).toBeLessThan(OPTIONS.resendAfterMs);
    expect(report.rejoins).toBe(1);
  });

  it("does not resend over a rejoin a fill the server said it ran", async () => {
    const world = harness();
    world.deps.send = async (box) => {
      world.sent.push(box);
      return ran;
    };
    let isLate = false;
    const deps = {
      ...world.deps,
      async sleep(ms: number) {
        await world.deps.sleep(ms);
        if (world.deps.now() === 1_000) world.rejoin();
        if (world.deps.now() === 5_000 && !isLate) {
          isLate = true;
          world.write(BOX);
        }
      },
    };
    const report = await landFill([BOX], deps, OPTIONS);
    expect(report.status).toBe("landed");
    expect(world.sent).toHaveLength(1);
  });

  it("waits for a queued send to go out on the rejoin it was queued for", async () => {
    const world = harness(["queued"]);
    world.setLive(false);
    const deps = {
      ...world.deps,
      async sleep(ms: number) {
        await world.deps.sleep(ms);
        if (world.deps.now() === 10_000) {
          world.setLive(true);
          world.rejoin();
        }
      },
    };
    const report = await landFill([BOX], deps, OPTIONS);
    expect(report.status).toBe("landed");
    expect(report.boxes[0].sends.map((s) => s.reason)).toEqual(["first"]);
  });

  it("retries a send the page could not take, without spending a send on it", async () => {
    const world = harness(["stalls", "stalls", "lost", "lost", "lost"]);
    const report = await landFill([BOX], world.deps, OPTIONS);
    expect(report.status).toBe("landed");
    const fates = report.boxes[0].sends.map((s) =>
      s.dispatch === null ? "not taken" : s.dispatch.outcome?.kind,
    );
    expect(fates).toEqual([
      "not taken",
      "not taken",
      "unanswered",
      "unanswered",
      "unanswered",
      "ran",
    ]);
  });

  it("fails loudly, naming what never landed, once its sends run out", async () => {
    const world = harness(["lost", "lost", "lost", "lost", "lost"]);
    const report = await landFill([BOX], world.deps, OPTIONS);
    expect(report.status).toBe("missing");
    expect(report.boxes[0].sends).toHaveLength(OPTIONS.maxSends);
    expect(report.boxes[0].landed).toBe(0);
    expect(report.elapsedMs).toBeGreaterThanOrEqual(OPTIONS.timeoutMs);
    expect(report.message).toContain("Granite 0,1,0..3,2,3: 0 of 32 landed");
    expect(report.message).toContain("32 never read back as Granite");
    expect(report.message).toContain("(0,1,0) holds air");
    expect(report.message).toContain("first unanswered after 5000ms");
  });

  it("counts a voxel that held the block once as landed when it changes after", async () => {
    const world = harness();
    let reads = 0;
    const deps = {
      ...world.deps,
      async census(boxes: VoxelCensusBox[]) {
        const readings = await world.deps.census(boxes);
        reads++;
        if (reads === 1) {
          world.voxels.set(world.key(0, 1, 0), "air");
          world.voxels.set(world.key(3, 2, 3), "air");
        }
        return readings;
      },
    };
    const report = await landFill([BOX], deps, OPTIONS);
    expect(report.status).toBe("landed");
  });

  it("calls a box it cannot see but the server ran unverified, at once", async () => {
    const world = harness();
    for (let i = 0; i < boxVolume(BOX); i++) {
      const { x, y, z } = censusVoxel(BOX, i);
      if (x >= 2) world.unloaded.add(world.key(x, y, z));
    }
    const report = await landFill([BOX], world.deps, OPTIONS);
    expect(report.status).toBe("unverified");
    expect(report.elapsedMs).toBe(0);
    expect(report.message).toContain(
      "16 are in chunks this page has not loaded",
    );
  });

  it("vouches for a box it cannot see once the connection held past the send", async () => {
    const world = harness(["late"]);
    for (let i = 0; i < boxVolume(BOX); i++) {
      const { x, y, z } = censusVoxel(BOX, i);
      world.unloaded.add(world.key(x, y, z));
    }
    const report = await landFill([BOX], world.deps, OPTIONS);
    expect(report.status).toBe("unverified");
    expect(report.boxes[0].arrival).toBe("held");
    expect(report.elapsedMs).toBeGreaterThanOrEqual(OPTIONS.arrivalGraceMs);
    expect(report.elapsedMs).toBeLessThan(OPTIONS.resendAfterMs);
    expect(report.message).toBe(
      "the fill reached the server (its connection held 15s past the send), " +
        "but all 32 voxels are in chunks this page has not loaded, so none were read back",
    );
  });

  it("does not vouch for a box it cannot see whose every send a drop followed", async () => {
    const world = harness(["lost", "lost", "lost", "lost"]);
    for (let i = 0; i < boxVolume(BOX); i++) {
      const { x, y, z } = censusVoxel(BOX, i);
      world.unloaded.add(world.key(x, y, z));
    }
    let rejoinedFor = 0;
    const deps = {
      ...world.deps,
      async sleep(ms: number) {
        await world.deps.sleep(ms);
        if (world.sent.length > rejoinedFor) {
          rejoinedFor = world.sent.length;
          world.rejoin();
        }
      },
    };
    const report = await landFill([BOX], deps, OPTIONS);
    expect(report.status).toBe("missing");
    expect(report.boxes[0].arrival).toBe(null);
    expect(report.boxes[0].sends.map((s) => s.reason)).toEqual([
      "first",
      "rejoined",
      "rejoined",
      "rejoined",
    ]);
    expect(report.message).toContain("32 in chunks this page has not loaded");
  });

  it("keeps reading through a page that cannot answer, and says so", async () => {
    const world = harness();
    let reads = 0;
    const deps = {
      ...world.deps,
      async census(boxes: VoxelCensusBox[]) {
        reads++;
        if (reads <= 3) throw new FillPageUnavailableError("page stalled");
        return world.deps.census(boxes);
      },
    };
    const report = await landFill([BOX], deps, OPTIONS);
    expect(report.status).toBe("landed");
    expect(report.failedReadings).toBe(3);
  });

  it("lets a later box win where it overlaps, and resends it after an earlier one", async () => {
    const world = harness(["lost", "lands"]);
    const floor: FillBox = { min: [0, 0, 0], max: [3, 0, 3], block: "Granite" };
    const patch: FillBox = { min: [1, 0, 1], max: [2, 0, 2], block: "Basalt" };
    const report = await landFill([floor, patch], world.deps, OPTIONS);
    expect(report.status).toBe("landed");
    expect(report.boxes[0].overwritten).toBe(4);
    expect(report.boxes[0].landed).toBe(12);
    expect(world.voxels.get(world.key(1, 0, 1))).toBe("basalt");
    expect(world.sent.map((box) => box.block)).toEqual([
      "Granite",
      "Basalt",
      "Granite",
      "Basalt",
    ]);
  });

  it("throws a refusal as it is", async () => {
    const world = harness();
    world.deps.send = async () => {
      throw new Error("test:fill did nothing in world 'bare': unknown block");
    };
    await expect(landFill([BOX], world.deps, OPTIONS)).rejects.toThrow(
      "unknown block",
    );
  });
});
