import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { describe, expect, it } from "vitest";

import { CSMRenderer } from "./csm-renderer";

const SUN = new Vector3(-0.4, -1, 0.3).normalize();

type DrawCounter = { count: number; renderer: WebGLRenderer };

const makeRenderer = (): DrawCounter => {
  const counter = { count: 0 };
  const stub = {
    setRenderTarget: () => undefined,
    clear: () => undefined,
    render: () => {
      counter.count += 1;
    },
  };
  return {
    get count() {
      return counter.count;
    },
    renderer: stub as Partial<WebGLRenderer> as WebGLRenderer,
  } as DrawCounter & { readonly count: number };
};

const makeCamera = (position: Vector3, lookAt: Vector3) => {
  const camera = new PerspectiveCamera(75, 16 / 9, 0.1, 1000);
  camera.position.copy(position);
  camera.lookAt(lookAt);
  camera.updateMatrixWorld();
  return camera;
};

const drain = (csm: CSMRenderer, scene: Scene, counter: DrawCounter) => {
  // One far cascade lands per frame, so a fresh renderer needs a few frames
  // before every map has been drawn once and the flags are quiet.
  const camera = makeCamera(new Vector3(0, 40, 0), new Vector3(10, 40, 0));
  for (let i = 0; i < 8; i++) {
    csm.update(camera, SUN, camera.position);
    csm.render(counter.renderer, scene);
  }
};

describe("CSMRenderer redraw policy", () => {
  it("does not redraw any cascade for camera rotation alone", () => {
    const csm = new CSMRenderer();
    const scene = new Scene();
    const counter = makeRenderer();
    drain(csm, scene, counter);
    const before = counter.count;

    const position = new Vector3(0, 40, 0);
    for (let frame = 0; frame < 30; frame++) {
      const angle = (frame / 30) * Math.PI * 2;
      const camera = makeCamera(
        position,
        new Vector3(Math.cos(angle) * 10, 40, Math.sin(angle) * 10),
      );
      csm.update(camera, SUN, position);
      csm.render(counter.renderer, scene);
    }

    expect(counter.count).toBe(before);
  });

  it("does not redraw for sub-texel player movement", () => {
    const csm = new CSMRenderer();
    const scene = new Scene();
    const counter = makeRenderer();
    drain(csm, scene, counter);
    const before = counter.count;

    for (let frame = 0; frame < 10; frame++) {
      const position = new Vector3(0.0002 * frame, 40, 0);
      const camera = makeCamera(position, new Vector3(10, 40, 0));
      csm.update(camera, SUN, position);
      csm.render(counter.renderer, scene);
    }

    expect(counter.count).toBe(before);
  });

  it("redraws when the player moves far enough to shift the snapped fit", () => {
    const csm = new CSMRenderer();
    const scene = new Scene();
    const counter = makeRenderer();
    drain(csm, scene, counter);
    const before = counter.count;

    const position = new Vector3(8, 40, 0);
    const camera = makeCamera(position, new Vector3(18, 40, 0));
    csm.update(camera, SUN, position);
    csm.render(counter.renderer, scene);

    expect(counter.count).toBeGreaterThan(before);
  });

  it("redraws every cascade after an accepted light step", () => {
    const csm = new CSMRenderer();
    const scene = new Scene();
    const counter = makeRenderer();
    drain(csm, scene, counter);
    const before = counter.count;

    const movedSun = new Vector3(-0.3, -1, 0.4).normalize();
    const position = new Vector3(0, 40, 0);
    for (let frame = 0; frame < 6; frame++) {
      const camera = makeCamera(position, new Vector3(10, 40, 0));
      csm.update(camera, movedSun, position);
      csm.render(counter.renderer, scene);
    }

    // Three cascades, at most one far map per frame: all of them land
    // within the window, none more than once.
    expect(counter.count).toBe(before + 3);
  });

  it("still honors explicit content marks while perfectly still", () => {
    const csm = new CSMRenderer();
    const scene = new Scene();
    const counter = makeRenderer();
    drain(csm, scene, counter);
    const before = counter.count;

    csm.markAllCascadesForRender();
    const position = new Vector3(0, 40, 0);
    for (let frame = 0; frame < 6; frame++) {
      const camera = makeCamera(position, new Vector3(10, 40, 0));
      csm.update(camera, SUN, position);
      csm.render(counter.renderer, scene);
    }

    expect(counter.count).toBe(before + 3);
  });

  it("keeps a deferred far cascade owed until it lands", () => {
    const csm = new CSMRenderer();
    const scene = new Scene();
    const counter = makeRenderer();
    drain(csm, scene, counter);

    // A big jump moves every cascade's fit at once; the one-far-per-frame
    // cap must spread the maps across frames without dropping any.
    const position = new Vector3(500, 40, 500);
    const perFrame: number[] = [];
    for (let frame = 0; frame < 4; frame++) {
      const start = counter.count;
      const camera = makeCamera(position, new Vector3(510, 40, 500));
      csm.update(camera, SUN, position);
      csm.render(counter.renderer, scene);
      perFrame.push(counter.count - start);
    }

    expect(perFrame[0]).toBe(2);
    expect(perFrame[1]).toBe(1);
    expect(perFrame[2]).toBe(0);
    expect(perFrame[3]).toBe(0);
  });
});
