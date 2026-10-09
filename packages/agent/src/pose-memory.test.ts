import { describe, expect, it } from "vitest";

import {
  EMPTY_POSE_INTENT,
  isPoseSuperseded,
  rememberPose,
} from "./pose-memory";

const remembered = rememberPose(
  {
    position: { x: 0.5, y: 102.3, z: 16.5 },
    facing: { yaw: 0, pitch: 0 },
    documentId: 1,
  },
  { documentId: 1, joinGeneration: 5 },
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
