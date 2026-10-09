import { describe, expect, it } from "vitest";

import { CameraRig, orbitNear } from "./camera";
import type { Pose, Vec3 } from "./pose";

/** Enough of an element for the rig's listeners, driven with plain events. */
function element() {
  const target = new EventTarget();
  Object.assign(target, {
    clientWidth: 1280,
    clientHeight: 720,
    focus() {},
    setPointerCapture() {},
    releasePointerCapture() {},
  });
  return target as unknown as HTMLElement;
}

function fire(
  el: HTMLElement,
  type: string,
  props: Record<string, unknown> = {},
) {
  el.dispatchEvent(
    Object.assign(new Event(type, { cancelable: true }), {
      clientX: 0,
      clientY: 0,
      button: 0,
      shiftKey: false,
      pointerId: 1,
      ...props,
    }),
  );
}

/** An orbit looking at `look` from the +z side (so D pans toward +x). */
function orbitPose(look: Vec3, distance = 100, pitch = 0.6): Pose {
  return {
    eye: [
      look[0],
      look[1] + distance * Math.sin(pitch),
      look[2] + distance * Math.cos(pitch),
    ],
    look,
  };
}

function rig(
  ground: (x: number, z: number) => number | null,
  smoothing = 0.75,
) {
  const el = element();
  const camera = new CameraRig(el);
  camera.resize(1280, 720);
  camera.groundAt = ground;
  camera.smoothing = smoothing;
  return { el, camera };
}

/** Holds D for `hold` seconds then rests until `total`, at `fps`; eye heights per frame. */
function panAcross(
  camera: CameraRig,
  el: HTMLElement,
  fps: number,
  hold: number,
  total: number,
) {
  const heights: { t: number; eye: number; look: number }[] = [];
  fire(el, "keydown", { code: "KeyD" });
  const frames = Math.round(total * fps);
  for (let i = 1; i <= frames; i++) {
    if (i === Math.round(hold * fps) + 1) fire(el, "keyup", { code: "KeyD" });
    camera.update(1 / fps);
    const pose = camera.pose();
    heights.push({ t: i / fps, eye: pose.eye[1], look: pose.look[1] });
  }
  return heights;
}

const cliff = (x: number) => (x < 50 ? 80 : 140);

describe("terrain following", () => {
  it("eases over a cliff instead of jumping, the same at any frame rate", () => {
    const runs = [30, 144].map((fps) => {
      const { el, camera } = rig(cliff);
      camera.setPose(orbitPose([0, 80, 0]), "orbit");
      return panAcross(camera, el, fps, 1, 4);
    });
    for (const heights of runs) {
      const steps = heights
        .slice(1)
        .map((h, i) => Math.abs(h.look - heights[i].look));
      expect(Math.max(...steps)).toBeLessThan(6);
      expect(heights[heights.length - 1].look).toBeCloseTo(140, 1);
    }
    const at = (heights: { t: number; look: number }[], t: number) =>
      heights.reduce((best, h) =>
        Math.abs(h.t - t) < Math.abs(best.t - t) ? h : best,
      ).look;
    for (const t of [0.8, 1.2, 1.6, 2.4]) {
      expect(Math.abs(at(runs[0], t) - at(runs[1], t))).toBeLessThan(3);
    }
  });

  it("snaps to the column under the target with smoothing and footprint off, as the first rig did", () => {
    const { el, camera } = rig(cliff, 0);
    Object.assign(camera.feel, { footprint: 0, footprintMin: 0, deadband: 0 });
    camera.setPose(orbitPose([0, 80, 0]), "orbit");
    const heights = panAcross(camera, el, 60, 1, 1.2);
    const steps = heights
      .slice(1)
      .map((h, i) => Math.abs(h.look - heights[i].look));
    expect(Math.max(...steps)).toBe(60);
  });

  it("does not register a lone column, a tree or a pillar, under the target", () => {
    const spike = (x: number, z: number) =>
      Math.abs(x - 40) < 1 && Math.abs(z) < 1 ? 200 : 80;
    const { el, camera } = rig(spike);
    camera.setPose(orbitPose([0, 80, 0]), "orbit");
    const heights = panAcross(camera, el, 60, 1, 2);
    expect(Math.max(...heights.map((h) => h.look))).toBe(80);
  });

  it("leaves a resting camera alone while the heightfield refines", () => {
    let refine = 0;
    const { el, camera } = rig((x) => cliff(x) + refine);
    camera.setPose(orbitPose([0, 80, 0]), "orbit");
    panAcross(camera, el, 60, 1, 4);
    const rested = camera.pose();
    refine = 4;
    for (let i = 0; i < 120; i++) camera.update(1 / 60);
    expect(camera.pose()).toEqual(rested);
  });

  it("eases onto ground that arrives after the pan, instead of resting inside it", () => {
    let loaded = false;
    const { el, camera } = rig((x) => (x < 50 || loaded ? cliff(x) : null));
    camera.setPose(orbitPose([0, 80, 0]), "orbit");
    panAcross(camera, el, 60, 1, 2);
    expect(camera.pose().look[1]).toBe(80);
    loaded = true;
    const looks: number[] = [];
    for (let i = 0; i < 180; i++) {
      camera.update(1 / 60);
      looks.push(camera.pose().look[1]);
    }
    const steps = looks.slice(1).map((y, i) => y - looks[i]);
    expect(Math.max(...steps)).toBeLessThan(6);
    expect(looks[looks.length - 1]).toBeCloseTo(140, 1);
  });

  it("leaves an explicit pose where it is until the user pans", () => {
    const { camera } = rig(() => 40);
    const pose = orbitPose([0, 95, 0]);
    camera.setPose(pose, "orbit");
    for (let i = 0; i < 120; i++) camera.update(1 / 60);
    expect(camera.pose()).toEqual(pose);
  });

  it("raises the eye over a ridge behind the target, easing up", () => {
    const ridge = (_x: number, z: number) => (z > 50 ? 150 : 80);
    const { el, camera } = rig(ridge);
    camera.setPose(orbitPose([0, 80, 0], 100, 0.1), "orbit");
    fire(el, "pointerdown", { clientX: 100, clientY: 100 });
    fire(el, "pointermove", { clientX: 101, clientY: 100 });
    fire(el, "pointerup", { clientX: 101, clientY: 100 });
    const eyes: number[] = [];
    for (let i = 0; i < 180; i++) {
      camera.update(1 / 60);
      eyes.push(camera.pose().eye[1]);
    }
    const steps = eyes.slice(1).map((y, i) => y - eyes[i]);
    expect(Math.max(...steps)).toBeLessThan(5);
    expect(eyes[eyes.length - 1]).toBeCloseTo(150 + camera.feel.clearance, 1);
    expect(camera.pose().look[1]).toBe(80);
  });
});

describe("controls", () => {
  it("does not turn the camera for the clicks of a double-click", () => {
    const { el, camera } = rig(() => 80);
    camera.setPose(orbitPose([0, 80, 0]), "orbit");
    const before = camera.pose();
    for (let i = 0; i < 2; i++) {
      fire(el, "pointerdown", { clientX: 300, clientY: 200 });
      fire(el, "pointermove", { clientX: 300, clientY: 200 });
      fire(el, "pointerup", { clientX: 300, clientY: 200 });
    }
    camera.update(1 / 60);
    expect(camera.pose()).toEqual(before);
  });

  it("keeps free flight level unless Space or Shift asks", () => {
    for (const level of [true, false]) {
      const { el, camera } = rig(() => 80);
      camera.levelFlight = level;
      camera.setPose({ eye: [0, 150, 0], look: [0, 120, -60] }, "free");
      fire(el, "keydown", { code: "KeyW" });
      for (let i = 0; i < 60; i++) camera.update(1 / 60);
      const y = camera.pose().eye[1];
      if (level) expect(y).toBeCloseTo(150, 9);
      else expect(y).toBeLessThan(140);
    }
  });

  it("eases a wheel zoom to the same distance at any frame rate", () => {
    const distances = [30, 144].map((fps) => {
      const { el, camera } = rig(() => 80);
      camera.setPose(orbitPose([0, 80, 0], 200), "orbit");
      fire(el, "wheel", { deltaY: -400 });
      const after = camera.orbit.distance;
      for (let i = 0; i < fps / 6; i++) camera.update(1 / fps);
      const partway = camera.orbit.distance;
      for (let i = 0; i < 2 * fps; i++) camera.update(1 / fps);
      return { after, partway, end: camera.orbit.distance };
    });
    for (const d of distances) {
      expect(d.after).toBe(200);
      expect(d.partway).toBeLessThan(200);
      expect(d.end).toBeCloseTo(200 * Math.exp(-400 * 0.0015), 6);
    }
    expect(distances[0].partway).toBeCloseTo(distances[1].partway, 6);
  });
});

describe("flights", () => {
  it("flies to frame a point, closing the frame in, and keeps the preset", async () => {
    const { camera } = rig(() => 80);
    camera.setPose(orbitPose([0, 80, 0], 400), "orbit");
    const landing = camera.flyToPoint([300, 95, -200]);
    let frames = 0;
    while (camera.flying && frames < 600) {
      camera.update(1 / 60);
      frames += 1;
    }
    const result = await landing;
    expect(result.completed).toBe(true);
    expect(result.seconds).toBeGreaterThanOrEqual(camera.feel.flightMin);
    expect(result.seconds).toBeLessThanOrEqual(camera.feel.flightMax + 1 / 60);
    expect(camera.preset).toBe("orbit");
    expect(camera.pose().look).toEqual([300, 95, -200]);
    expect(camera.orbit.distance).toBeCloseTo(400 * camera.feel.flightZoom, 6);
  });

  it("is in the same place at the same time at any frame rate", () => {
    const at = (fps: number) => {
      const { camera } = rig(() => 80);
      camera.setPose(orbitPose([0, 80, 0], 300), "top");
      void camera.flyToPoint([600, 80, 400], { duration: 1 });
      for (let i = 0; i < Math.round(0.5 * fps); i++) camera.update(1 / fps);
      return camera.pose();
    };
    const slow = at(30);
    const fast = at(144);
    slow.look.forEach((v, i) => expect(fast.look[i]).toBeCloseTo(v, 6));
  });

  for (const [what, cut] of [
    [
      "a click",
      (el: HTMLElement) => fire(el, "pointerdown", { clientX: 5, clientY: 5 }),
    ],
    ["the wheel", (el: HTMLElement) => fire(el, "wheel", { deltaY: 100 })],
    ["a key", (el: HTMLElement) => fire(el, "keydown", { code: "KeyX" })],
  ] as const) {
    it(`stops where it is on ${what}`, async () => {
      const { el, camera } = rig(() => 80);
      camera.setPose(orbitPose([0, 80, 0], 300), "orbit");
      const landing = camera.flyToPoint([500, 80, 0], { duration: 1 });
      for (let i = 0; i < 24; i++) camera.update(1 / 60);
      const midway = camera.pose();
      cut(el);
      const result = await landing;
      expect(result.completed).toBe(false);
      expect(result.pose).toEqual(midway);
      for (let i = 0; i < 60; i++) camera.update(1 / 60);
      expect(camera.pose().look).toEqual(midway.look);
      expect(midway.look[0]).toBeGreaterThan(0);
      expect(midway.look[0]).toBeLessThan(500);
    });
  }

  it("eases between bookmarks across free and orbit", async () => {
    const { camera } = rig(() => 80);
    camera.setPose({ eye: [0, 150, 100], look: [0, 80, 0] }, "free");
    const target: Pose = { eye: [800, 200, 900], look: [700, 100, 700] };
    const landing = camera.flyToPose(target, "orbit");
    while (camera.flying) camera.update(1 / 60);
    expect((await landing).completed).toBe(true);
    expect(camera.preset).toBe("orbit");
    const pose = camera.pose();
    pose.eye.forEach((v, i) => expect(v).toBeCloseTo(target.eye[i], 6));
    pose.look.forEach((v, i) => expect(v).toBeCloseTo(target.look[i], 6));
  });
});

describe("the near plane", () => {
  it("stays close for a walking eye and pulls out with an orbit, up to a cap", () => {
    expect(orbitNear(40)).toBe(0.5);
    expect(orbitNear(1024)).toBe(4);
    expect(orbitNear(1e6)).toBe(8);
    const camera = new CameraRig(element());
    camera.setPose(orbitPose([0, 80, 0], 1024), "orbit");
    camera.sync();
    expect(camera.perspective.near).toBeCloseTo(4, 6);
    camera.setPose(orbitPose([0, 80, 0], 1024), "free");
    camera.sync();
    expect(camera.perspective.near).toBe(0.5);
  });
});
