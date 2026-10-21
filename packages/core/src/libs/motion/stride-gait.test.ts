import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";

import { Vector3 } from "three";

import {
  capCadenceHz,
  StrideGait,
  strideGaitParamsForLeg,
  strideGaitParamsForScale,
  strideGaitParamsForWalker,
  walkerCadenceCeilingHz,
  walkerFullSwingSpeed,
} from "./stride-gait";

const TWO_PI = Math.PI * 2;
/// A deer as drawn: 0.34 * 2.5 of leg, swept 0.42 rad at full stride.
const DEER_LEG = 0.85;
const DEER_SWING = 0.42;
/// A fox: short legs, a wide sweep.
const FOX_LEG = 0.16;
const FOX_SWING = 0.6;

let nowMs = 0;

beforeEach(() => {
  nowMs = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => nowMs);
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface Glide {
  /// Phase advance per frame, radians.
  advances: number[];
  /// Cycles the clock ran over the glide.
  cycles: number;
  /// Horizontal ground the body covered.
  travel: number;
  seconds: number;
}

/// Slides a body along +x at a constant speed, feeding the clock the same
/// position as render and target (a cruising animal), one frame per tick.
function glide(
  gait: StrideGait,
  pos: Vector3,
  speed: number,
  seconds: number,
  fps = 60,
): Glide {
  const dt = 1 / fps;
  const frames = Math.round(seconds * fps);
  const advances: number[] = [];
  const phase0 = gait.phase;
  for (let i = 0; i < frames; i++) {
    nowMs += dt * 1000;
    pos.x += speed * dt;
    const before = gait.phase;
    gait.update(pos, pos);
    advances.push(gait.phase - before);
  }
  return {
    advances,
    cycles: (gait.phase - phase0) / TWO_PI,
    travel: speed * frames * dt,
    seconds: frames * dt,
  };
}

function deerGait(): StrideGait {
  const gait = new StrideGait(strideGaitParamsForWalker(DEER_LEG, DEER_SWING));
  gait.phase = 0;
  return gait;
}

describe("stride gait: the legs swing like pendulums, paced by the ground", () => {
  it("a walking deer's legs never pause: every frame advances the phase evenly", () => {
    const gait = deerGait();
    const pos = new Vector3();
    glide(gait, pos, 1.2, 1); // settle the speed estimate and swing
    const { advances } = glide(gait, pos, 1.2, 3);
    const min = Math.min(...advances);
    const max = Math.max(...advances);
    assert.ok(min > 0, `a frame held the legs: min advance ${min}`);
    assert.ok(
      max / min < 1.05,
      `the swing is not a steady pendulum: advances span ${min}..${max}`,
    );
  });

  it("one cycle covers exactly the ground the legs reach at a walk", () => {
    const gait = deerGait();
    const pos = new Vector3();
    const speed = 1.2;
    glide(gait, pos, speed, 1.5);
    const { cycles, travel } = glide(gait, pos, speed, 4);
    // Below the full-swing speed the swing is speed / fullSwingSpeed of the
    // walk sweep, so the stride per cycle is 4 * L * A * that.
    const swing = speed / walkerFullSwingSpeed(DEER_LEG);
    assert.ok(swing < 1, "the test speed must sit below full swing");
    const strideLength = 4 * DEER_LEG * DEER_SWING * swing;
    assert.ok(
      Math.abs(gait.swingScale - swing) < 0.01,
      `swing amplitude ${gait.swingScale} should track ${swing}`,
    );
    const expected = travel / strideLength;
    assert.ok(
      Math.abs(cycles / expected - 1) < 0.02,
      `${cycles} cycles over ${travel} blocks; a slide-free stride gives ${expected}`,
    );
  });

  it("cadence rises with speed and is held by a ceiling that follows leg length", () => {
    const hz = (leg: number, swing: number, speed: number) => {
      const gait = new StrideGait(strideGaitParamsForWalker(leg, swing));
      gait.phase = 0;
      const pos = new Vector3();
      glide(gait, pos, speed, 1.5);
      const run = glide(gait, pos, speed, 3);
      return run.cycles / run.seconds;
    };
    const deerWalk = hz(DEER_LEG, DEER_SWING, 1.0);
    const deerTrot = hz(DEER_LEG, DEER_SWING, 2.5);
    const deerFlee = hz(DEER_LEG, DEER_SWING, 8);
    assert.ok(deerWalk < deerTrot && deerTrot < deerFlee, "cadence climbs");
    assert.ok(deerWalk > 0.9 && deerWalk < 1.6, `deer walk ${deerWalk} Hz`);
    const deerCap = walkerCadenceCeilingHz(DEER_LEG);
    assert.ok(
      deerFlee <= deerCap + 1e-6 && deerFlee > deerCap * 0.9,
      `deer flee ${deerFlee} Hz sits just under its ${deerCap} Hz ceiling`,
    );
    assert.ok(
      deerFlee < 3,
      `a fleeing deer no longer flickers: ${deerFlee} Hz`,
    );

    const foxCap = walkerCadenceCeilingHz(FOX_LEG);
    assert.ok(foxCap > deerCap, "short legs may swing faster than long ones");
    const foxFlee = hz(FOX_LEG, FOX_SWING, 6);
    assert.ok(
      foxFlee <= foxCap + 1e-6 && foxFlee > 5,
      `fox flee ${foxFlee} Hz`,
    );
    assert.equal(
      walkerCadenceCeilingHz(0.03),
      8,
      "a tiny walker's cap is the 8 Hz roof",
    );
  });

  it("the old flat ceiling let the deer flicker; the walker law does not", () => {
    const run = (gait: StrideGait) => {
      gait.phase = 0;
      const pos = new Vector3();
      glide(gait, pos, 8, 1.5);
      const r = glide(gait, pos, 8, 3);
      return r.cycles / r.seconds;
    };
    const legacy = run(
      new StrideGait(strideGaitParamsForLeg(DEER_LEG, DEER_SWING)),
    );
    const walker = run(deerGait());
    assert.ok(legacy > 3.5, `legacy flee cadence ${legacy} Hz`);
    assert.ok(walker < 3, `walker flee cadence ${walker} Hz`);
  });

  it("past the ceiling the legs reach further before the feet skate", () => {
    const gait = deerGait();
    const pos = new Vector3();
    glide(gait, pos, 8, 3);
    assert.ok(
      gait.swingScale > 1.25 && gait.swingScale <= 1.3 + 1e-9,
      `sprint swing ${gait.swingScale} reaches up to 1.3 of the walk sweep`,
    );
    assert.ok(Math.abs(gait.gallopStretch - gait.swingScale) < 1e-9);
    // And never beyond: a longer reach would wind the legs like a windmill.
    glide(gait, pos, 20, 2);
    assert.ok(gait.swingScale <= 1.3 + 1e-9);
  });

  it("stopping holds the phase and eases the swing down instead of popping", () => {
    const gait = deerGait();
    const pos = new Vector3();
    glide(gait, pos, 1.5, 2);
    const swingMoving = gait.swingScale;
    const phaseAtStop = gait.phase;
    const swings: number[] = [];
    for (let i = 0; i < 90; i++) {
      nowMs += 1000 / 60;
      gait.update(pos, pos);
      swings.push(gait.swingScale);
    }
    assert.equal(
      gait.phase,
      phaseAtStop,
      "a standing body does not cycle the legs",
    );
    for (let i = 1; i < swings.length; i++) {
      assert.ok(
        swings[i] <= swings[i - 1] + 1e-12,
        "the swing eases down monotonically",
      );
    }
    assert.ok(
      swings[0] < swingMoving && swings[0] > swingMoving * 0.8,
      "no pop on the first frame",
    );
    assert.ok(
      Math.abs(swings[swings.length - 1] - 0.35) < 0.01,
      "settles at the creep floor",
    );
  });

  it("capCadenceHz follows the demand to the knee, then bends to the ceiling", () => {
    assert.equal(capCadenceHz(1, 4, 0.7), 1);
    assert.equal(capCadenceHz(2.8, 4, 0.7), 2.8);
    const nearCeiling = capCadenceHz(100, 4, 0.7);
    assert.ok(nearCeiling <= 4 && nearCeiling > 3.99);
    assert.ok(capCadenceHz(3.4, 4, 0.7) < 3.4, "past the knee it bends under");
    // Continuous through the knee.
    assert.ok(Math.abs(capCadenceHz(2.8 + 1e-6, 4, 0.7) - 2.8) < 1e-5);
    // Knee 0 is the pure soft cap the monsters and horses were tuned on.
    assert.equal(capCadenceHz(3, 4, 0), 4 * Math.tanh(0.75));
    assert.equal(capCadenceHz(0, 4, 0.7), 0);
  });

  it("legacy params (monsters, bots, horses) keep the soft cap and never over-reach", () => {
    const params = strideGaitParamsForLeg(0.75, 0.58);
    assert.equal(params.cadenceKnee, 0);
    assert.equal(params.gallopReachBoost, 0);
    assert.equal(params.maxStrideHz, 6.75);
    const gait = new StrideGait(params);
    const pos = new Vector3();
    glide(gait, pos, 9, 3);
    assert.ok(
      gait.swingScale <= 1 + 1e-9,
      "legacy swing never exceeds the walk sweep",
    );
    // The old lengthen: 0.2 ramped over 8 u/s above the 2.5 u/s full swing.
    const lengthen = 1 + 0.2 * Math.min((9 - 2.5) / 8, 1);
    assert.ok(
      Math.abs(gait.gallopStretch - lengthen) < 0.01,
      `legacy gallop stretch ${gait.gallopStretch} is the old lengthen ${lengthen}`,
    );
  });

  it("fitWalker re-paces a running clock from the drawn leg without moving the phase", () => {
    const gait = new StrideGait(strideGaitParamsForLeg(DEER_LEG, DEER_SWING));
    gait.phase = 1.23;
    gait.fitWalker(null, 1, DEER_SWING);
    gait.fitWalker(0, 1, DEER_SWING);
    const pos = new Vector3();
    glide(gait, pos, 8, 2);
    const legacyRun = glide(gait, pos, 8, 2);
    assert.ok(
      legacyRun.cycles / legacyRun.seconds > 3.5,
      "unfitted: still the legacy cap",
    );

    const phase = gait.phase;
    gait.fitWalker(0.34, 2.5, DEER_SWING);
    assert.equal(gait.phase, phase);
    glide(gait, pos, 8, 2);
    const walkerRun = glide(gait, pos, 8, 2);
    assert.ok(
      walkerRun.cycles / walkerRun.seconds < 3,
      "fitted: the deer's own ceiling",
    );
  });

  it("an unmeasured mesh falls back to the walker law on the leg its scale implies", () => {
    const params = strideGaitParamsForScale(2.5);
    assert.ok(Math.abs(params.strideLength - 0.65 * 2.5) < 0.01);
    assert.equal(params.cadenceKnee, 0.7);
    assert.ok(params.maxStrideHz < 8 && params.maxStrideHz > 2.2);
  });
});
