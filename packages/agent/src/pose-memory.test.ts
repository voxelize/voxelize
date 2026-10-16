import { describe, expect, it } from "vitest";

import {
  EMPTY_POSE_INTENT,
  carriedPoseIntent,
  describeJoinChange,
  isMidWorldSwitch,
  isNewJoin,
  isPoseSuperseded,
  poseRestoreSkipReason,
  rememberPose,
  type JoinIdentity,
} from "./pose-memory";

const firstJoin: JoinIdentity = {
  documentId: 1,
  joinSerial: 1,
  joinGeneration: 5,
  world: "world-a",
};

const remembered = rememberPose(
  {
    position: { x: 0.5, y: 102.3, z: 16.5 },
    facing: { yaw: 0, pitch: 0 },
    documentId: 1,
  },
  firstJoin,
  EMPTY_POSE_INTENT,
  1_000,
);

describe("isPoseSuperseded", () => {
  it("puts back a pose no command has moved the agent from", () => {
    expect(isPoseSuperseded(remembered, 900, 0)).toBe(false);
    expect(isPoseSuperseded(remembered, 0, 0)).toBe(false);
  });

  it("keeps the result of a command that started after the pose was remembered", () => {
    expect(isPoseSuperseded(remembered, 1_500, 0)).toBe(true);
  });

  it("never restores over a command still in flight, however old the pose", () => {
    expect(isPoseSuperseded(remembered, 900, 1)).toBe(true);
  });
});

describe("isNewJoin", () => {
  it("is the same join while nothing moved", () => {
    expect(isNewJoin(remembered, { ...firstJoin })).toBe(false);
  });

  it("sees a reload, an in-page rejoin and a new bridge in the same page", () => {
    expect(isNewJoin(remembered, { ...firstJoin, documentId: 2 })).toBe(true);
    expect(isNewJoin(remembered, { ...firstJoin, joinGeneration: 6 })).toBe(
      true,
    );
    // A world switched in place: same document, a fresh network whose join
    // generation started over at the same number, but a new bridge.
    expect(isNewJoin(remembered, { ...firstJoin, joinSerial: 2 })).toBe(true);
  });

  it("sees a world change even when every counter matches", () => {
    expect(isNewJoin(remembered, { ...firstJoin, world: "world-b" })).toBe(
      true,
    );
  });

  it("does not take a host that never names its world for a world change", () => {
    expect(isNewJoin(remembered, { ...firstJoin, world: null })).toBe(false);
    const unnamed = rememberPose(
      {
        position: { x: 0, y: 0, z: 0 },
        facing: { yaw: 0, pitch: 0 },
        documentId: 1,
      },
      { ...firstJoin, world: null },
      EMPTY_POSE_INTENT,
      1_000,
    );
    expect(isNewJoin(unnamed, firstJoin)).toBe(false);
  });

  it("treats hosts without a bridge serial the way it always did", () => {
    const legacy = rememberPose(
      {
        position: { x: 0, y: 0, z: 0 },
        facing: { yaw: 0, pitch: 0 },
        documentId: 1,
      },
      { documentId: 1, joinSerial: null, joinGeneration: 3, world: null },
      EMPTY_POSE_INTENT,
      1_000,
    );
    expect(
      isNewJoin(legacy, {
        documentId: 1,
        joinSerial: null,
        joinGeneration: 3,
        world: null,
      }),
    ).toBe(false);
    expect(
      isNewJoin(legacy, {
        documentId: 1,
        joinSerial: null,
        joinGeneration: 4,
        world: null,
      }),
    ).toBe(true);
  });
});

describe("isMidWorldSwitch", () => {
  it("is the old bridge still answering after the address moved on", () => {
    expect(
      isMidWorldSwitch(remembered, { ...firstJoin, world: "world-b" }),
    ).toBe(true);
  });

  it("is not a switch once the new world's bridge answers, or with no change", () => {
    expect(
      isMidWorldSwitch(remembered, {
        ...firstJoin,
        joinSerial: 2,
        joinGeneration: 1,
        world: "world-b",
      }),
    ).toBe(false);
    expect(
      isMidWorldSwitch(remembered, {
        ...firstJoin,
        documentId: 2,
        world: "world-b",
      }),
    ).toBe(false);
    expect(isMidWorldSwitch(remembered, firstJoin)).toBe(false);
  });
});

describe("poseRestoreSkipReason", () => {
  it("never puts a pose back in another world", () => {
    expect(
      poseRestoreSkipReason(remembered, {
        documentId: 1,
        joinSerial: 2,
        joinGeneration: 1,
        world: "world-b",
      }),
    ).toBe("world changed world-a->world-b; not restoring the pose");
    // A hard switch: a new document in another world.
    expect(
      poseRestoreSkipReason(remembered, {
        documentId: 7,
        joinSerial: 1,
        joinGeneration: 1,
        world: "world-b",
      }),
    ).toBe("world changed world-a->world-b; not restoring the pose");
  });

  it("puts it back on a rejoin, reload or remount of the same world", () => {
    expect(
      poseRestoreSkipReason(remembered, {
        ...firstJoin,
        joinSerial: 2,
        joinGeneration: 1,
      }),
    ).toBeNull();
    expect(
      poseRestoreSkipReason(remembered, { ...firstJoin, documentId: 2 }),
    ).toBeNull();
    expect(
      poseRestoreSkipReason(remembered, { ...firstJoin, world: null }),
    ).toBeNull();
  });
});

describe("carriedPoseIntent", () => {
  const intent = { isFlying: true, renderRadius: 12 };

  it("drops fly and view radius asked of another world", () => {
    expect(
      carriedPoseIntent(intent, firstJoin, {
        documentId: 7,
        joinSerial: 1,
        joinGeneration: 1,
        world: "world-b",
      }),
    ).toEqual(EMPTY_POSE_INTENT);
  });

  it("keeps them across a rejoin, reload or remount of the same world", () => {
    expect(
      carriedPoseIntent(intent, firstJoin, { ...firstJoin, documentId: 2 }),
    ).toBe(intent);
    expect(
      carriedPoseIntent(intent, firstJoin, { ...firstJoin, world: null }),
    ).toBe(intent);
  });
});

describe("describeJoinChange", () => {
  it("names what moved", () => {
    expect(
      describeJoinChange(firstJoin, {
        ...firstJoin,
        joinSerial: 2,
        joinGeneration: 1,
        world: "world-b",
      }),
    ).toBe(
      "join generation 5 -> 1, bridge 1 -> 2 in the same page, world world-a -> world-b",
    );
    expect(
      describeJoinChange(firstJoin, {
        ...firstJoin,
        documentId: 3,
        joinGeneration: 1,
      }),
    ).toBe("join generation 5 -> 1, new page document");
  });
});
