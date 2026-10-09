import { Group, Quaternion, Vector3 } from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { Arm, ArmIdleSway, ArmObjectOptions } from "./arm";

let clock = 0;

beforeAll(() => {
  vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
  });
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});

afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const REST_POSITION = new Vector3(1, -1, -2);
const PEAK_POSITION = new Vector3(2, -1, -2);
const X_AXIS = new Vector3(1, 0, 0);

const swingOptions = (
  extra: Partial<ArmObjectOptions> = {},
): ArmObjectOptions => ({
  position: REST_POSITION.clone(),
  quaternion: new Quaternion(),
  swingTimes: [0, 0.1, 0.2, 0.3, 0.4],
  swingPositions: [
    new Vector3(1.5, -1, -2),
    PEAK_POSITION.clone(),
    new Vector3(1.5, -1, -2),
  ],
  swingQuaternions: [0.4, 0.8, 0.4].map((angle) =>
    new Quaternion().setFromAxisAngle(X_AXIS, angle),
  ),
  ...extra,
});

const IDLE_SWAY: ArmIdleSway = {
  pivot: new Vector3(1, -1.4, -2),
  breathSeconds: 3.7,
  breathLift: 0.02,
  breathTilt: 0.02,
  driftSeconds: 6.1,
  driftReach: 0.015,
  driftRoll: 0.01,
  fadeInSeconds: 0.5,
  fadeOutSeconds: 0.08,
};

// The mixer keeps its keys in float32, so a keyed quaternion is unit length
// only to float32 precision and `angleTo` reads a few 1e-4 rad off itself.
const TURN_TOLERANCE = 1e-6;
const turnBetween = (a: Quaternion, b: Quaternion) => {
  const angle = a.clone().normalize().angleTo(b.clone().normalize());
  return angle < TURN_TOLERANCE ? 0 : angle;
};

function equip(options: ArmObjectOptions) {
  const arm = new Arm({ customObjectOptions: { held: options } });
  const object = new Group();
  arm.setArmObject(object, false, "held");
  arm.update();
  return { arm, object };
}

/** Run `seconds` of frames at `fps`. */
function play(arm: Arm, seconds: number, fps = 60) {
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) {
    clock += 1000 / fps;
    arm.update();
  }
}

describe("arm swing restarts", () => {
  it("restart on every request by default", () => {
    const { arm } = equip(swingOptions());
    let sent = 0;
    arm.emitSwingEvent = () => (sent += 1);
    expect(arm.doSwing()).toBe(true);
    play(arm, 0.05);
    expect(arm.doSwing()).toBe(true);
    expect(sent).toBe(2);
  });

  it("drop a request until the swing is far enough along, and send it to nobody", () => {
    const { arm } = equip(swingOptions({ swingRestartAfter: 0.5 }));
    let sent = 0;
    arm.emitSwingEvent = () => (sent += 1);
    expect(arm.doSwing()).toBe(true);
    play(arm, 0.1);
    expect(arm.swingProgress).toBeCloseTo(0.25, 2);
    expect(arm.doSwing()).toBe(false);
    play(arm, 0.12);
    expect(arm.doSwing()).toBe(true);
    expect(sent).toBe(2);
  });

  it("ease out of the pose they interrupt instead of snapping to rest", () => {
    const blend = 0.1;
    const { arm, object } = equip(swingOptions({ swingRestartBlend: blend }));
    arm.doSwing();
    play(arm, 0.2);
    const interrupted = object.position.clone();
    expect(interrupted.distanceTo(PEAK_POSITION)).toBeLessThan(1e-6);

    arm.doSwing();
    play(arm, 1 / 60);
    expect(object.position.distanceTo(interrupted)).toBeLessThan(
      0.1 * interrupted.distanceTo(REST_POSITION),
    );

    play(arm, blend);
    const reference = equip(swingOptions());
    reference.arm.doSwing();
    play(reference.arm, 1 / 60 + blend);
    expect(object.position.distanceTo(reference.object.position)).toBeLessThan(
      1e-6,
    );
    expect(turnBetween(object.quaternion, reference.object.quaternion)).toBe(0);
  });
});

describe("arm idle sway", () => {
  it("breathes at rest, the same at any frame rate", () => {
    const fast = equip({ ...swingOptions(), idleSway: IDLE_SWAY });
    play(fast.arm, 2.9, 120);
    const slow = equip({ ...swingOptions(), idleSway: IDLE_SWAY });
    play(slow.arm, 2.9, 30);

    expect(fast.object.position.distanceTo(REST_POSITION)).toBeGreaterThan(
      1e-3,
    );
    expect(fast.object.position.distanceTo(slow.object.position)).toBeLessThan(
      1e-6,
    );
    expect(turnBetween(fast.object.quaternion, slow.object.quaternion)).toBe(0);
  });

  it("stays subtle: never further from rest than its own reach", () => {
    const { arm, object } = equip({ ...swingOptions(), idleSway: IDLE_SWAY });
    let furthest = 0;
    for (let i = 0; i < 600; i++) {
      play(arm, 1 / 60);
      furthest = Math.max(furthest, object.position.distanceTo(REST_POSITION));
    }
    const pivotReach = IDLE_SWAY.pivot.distanceTo(REST_POSITION);
    const bound =
      Math.hypot(IDLE_SWAY.driftReach, IDLE_SWAY.breathLift) +
      pivotReach * (IDLE_SWAY.breathTilt + IDLE_SWAY.driftRoll);
    expect(furthest).toBeGreaterThan(0);
    expect(furthest).toBeLessThanOrEqual(bound);
  });

  it("leaves a swing to play its own keys", () => {
    const { arm, object } = equip({ ...swingOptions(), idleSway: IDLE_SWAY });
    play(arm, 2);
    arm.doSwing();
    play(arm, 0.2);

    const reference = equip(swingOptions());
    reference.arm.doSwing();
    play(reference.arm, 0.2);
    expect(object.position.distanceTo(reference.object.position)).toBeLessThan(
      1e-6,
    );
    expect(turnBetween(object.quaternion, reference.object.quaternion)).toBe(0);
  });

  it("stops when the item is switched, leaving the old object exactly at rest", () => {
    const { arm, object } = equip({ ...swingOptions(), idleSway: IDLE_SWAY });
    play(arm, 2.3);
    expect(object.position.distanceTo(REST_POSITION)).toBeGreaterThan(1e-3);

    const next = new Group();
    arm.setArmObject(next, false, "held");
    expect(object.position.distanceTo(REST_POSITION)).toBeLessThan(1e-9);
    expect(turnBetween(object.quaternion, new Quaternion())).toBe(0);

    // The new object comes in at rest and fades its own sway in.
    arm.update();
    expect(next.position.distanceTo(REST_POSITION)).toBeLessThan(1e-9);
  });
});

describe("arm swing hold", () => {
  it("pins a swing at a moment, ignores clicks, and goes back to rest when released", () => {
    const { arm, object } = equip({ ...swingOptions(), idleSway: IDLE_SWAY });
    play(arm, 1);
    arm.holdSwingAt(0.2);
    expect(object.position.distanceTo(PEAK_POSITION)).toBeLessThan(1e-6);

    play(arm, 1);
    expect(object.position.distanceTo(PEAK_POSITION)).toBeLessThan(1e-6);
    expect(arm.swingProgress).toBeCloseTo(0.5, 6);
    expect(arm.doSwing()).toBe(false);

    arm.holdSwingAt(null);
    expect(object.position.distanceTo(REST_POSITION)).toBeLessThan(1e-6);
    expect(turnBetween(object.quaternion, new Quaternion())).toBe(0);
  });
});
