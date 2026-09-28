import { PerspectiveCamera, Scene } from "three";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { NameTag, nameTagFade, type NameTagDistance } from "./nametag";
import { SCENE_OVERLAY_LAYER } from "./sprite-text";

// SpriteText paints its label into a canvas; outside a browser a 2D context
// that measures every string as 10px wide and draws nothing is enough.
beforeAll(() => {
  const context = new Proxy(
    {},
    {
      get: (_target, key) =>
        key === "measureText" ? () => ({ width: 10 }) : () => {},
      set: () => true,
    },
  );
  vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
});

describe("nameTagFade", () => {
  it("holds full strength up to the start and is gone from the end on", () => {
    expect(nameTagFade(0, 16, 30)).toBe(1);
    expect(nameTagFade(16, 16, 30)).toBe(1);
    expect(nameTagFade(30, 16, 30)).toBe(0);
    expect(nameTagFade(500, 16, 30)).toBe(0);
  });

  it("eases through the band, half way at its middle, never rising", () => {
    expect(nameTagFade(23, 16, 30)).toBeCloseTo(0.5, 10);
    let previous = 1;
    for (let distance = 16; distance <= 30; distance += 0.25) {
      const fade = nameTagFade(distance, 16, 30);
      expect(fade).toBeLessThanOrEqual(previous);
      expect(fade).toBeGreaterThanOrEqual(0);
      previous = fade;
    }
    // Eased, not linear: the band's edges are flat, so a tag neither pops
    // at the start nor lingers as a faint smear at the end.
    expect(nameTagFade(17, 16, 30)).toBeGreaterThan(1 - 1 / 14);
    expect(nameTagFade(29, 16, 30)).toBeLessThan(1 / 14);
  });

  it("keeps a tag with no fade end at every distance", () => {
    expect(nameTagFade(10_000, Infinity, Infinity)).toBe(1);
    expect(nameTagFade(10_000, 16, Infinity)).toBe(1);
  });
});

describe("NameTag distance behaviour", () => {
  const profile: NameTagDistance = {
    fadeStart: 16,
    fadeEnd: 30,
    seeThroughDistance: 16,
  };
  const scene = new Scene();
  let camera: PerspectiveCamera;
  let saved: NameTagDistance;

  beforeEach(() => {
    saved = NameTag.distanceDefaults;
    NameTag.distanceDefaults = { ...profile };
    NameTag.distanceFade = true;
    camera = new PerspectiveCamera();
  });

  afterEach(() => {
    NameTag.distanceDefaults = saved;
    NameTag.distanceFade = true;
  });

  /** One frame: the scene's matrix pass, then the draw (if still drawn). */
  function frame(tag: NameTag, distance: number) {
    camera.position.set(distance, 0, 0);
    camera.updateMatrixWorld(true);
    tag.updateMatrixWorld(true);
    const drawn = tag.layers.test(camera.layers);
    if (drawn) tag.onBeforeRender(null as never, scene, camera);
    return drawn;
  }

  function overlayCamera() {
    camera.layers.enable(SCENE_OVERLAY_LAYER);
  }

  it("is a label, not world geometry: no fog, no shadow", () => {
    const tag = new NameTag("Ada");
    expect(tag.material.fog).toBe(false);
    expect(tag.material.userData.skipShadow).toBe(true);
  });

  it("takes the scene's fog again when made with the switch off", () => {
    NameTag.distanceFade = false;
    expect(new NameTag("Ada").material.fog).toBe(true);
  });

  it("draws near tags at full strength over everything", () => {
    overlayCamera();
    const tag = new NameTag("Ada");
    expect(frame(tag, 10)).toBe(true);
    expect(tag.material.opacity).toBe(1);
    expect(tag.material.depthTest).toBe(false);
  });

  it("fades and depth tests a tag inside the band", () => {
    overlayCamera();
    const tag = new NameTag("Ada");
    frame(tag, 23);
    expect(tag.material.opacity).toBeCloseTo(0.5, 5);
    expect(tag.material.depthTest).toBe(true);
  });

  it("stops drawing a tag past its fade end, and draws it again once the camera is back", () => {
    overlayCamera();
    const tag = new NameTag("Ada");
    expect(frame(tag, 31)).toBe(true);
    expect(tag.material.opacity).toBe(0);
    // Off the camera's layers: three skips it before any draw work.
    expect(frame(tag, 60)).toBe(false);
    expect(frame(tag, 31)).toBe(false);
    // The matrix pass notices the camera is back in range.
    expect(frame(tag, 20)).toBe(true);
    expect(tag.material.opacity).toBeCloseTo(nameTagFade(20, 16, 30), 10);
  });

  it("lets one tag reach further than the defaults", () => {
    overlayCamera();
    const player = new NameTag("friend", { fadeStart: 24, fadeEnd: 48 });
    expect(frame(player, 40)).toBe(true);
    expect(player.material.opacity).toBeGreaterThan(0);
    const resident = new NameTag("Ada");
    frame(resident, 40);
    expect(frame(resident, 40)).toBe(false);
  });

  it("multiplies the owner's own opacity instead of overwriting it", () => {
    overlayCamera();
    const tag = new NameTag("→ home");
    tag.opacity = 0.5;
    frame(tag, 10);
    expect(tag.material.opacity).toBe(0.5);
    frame(tag, 23);
    expect(tag.material.opacity).toBeCloseTo(0.25, 5);
  });

  it("draws every tag at every distance, over everything, with the switch off", () => {
    overlayCamera();
    const tag = new NameTag("Ada");
    frame(tag, 31);
    expect(frame(tag, 100)).toBe(false);
    NameTag.distanceFade = false;
    expect(frame(tag, 100)).toBe(true);
    expect(tag.material.opacity).toBe(1);
    expect(tag.material.depthTest).toBe(false);
  });

  it("keeps the engine's classic tag when an app sets no distances", () => {
    overlayCamera();
    NameTag.distanceDefaults = {
      fadeStart: Infinity,
      fadeEnd: Infinity,
      seeThroughDistance: Infinity,
    };
    const tag = new NameTag("Ada");
    expect(frame(tag, 1000)).toBe(true);
    expect(tag.material.opacity).toBe(1);
    expect(tag.material.depthTest).toBe(false);
  });
});
