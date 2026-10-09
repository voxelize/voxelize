import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { Clouds } from "./clouds";
import { CSMRenderer } from "./csm-renderer";
import { isMarkedNeverCaster, markNeverCaster } from "./shadow-casters";
import { Sky } from "./sky";

vi.mock("./workers/clouds-worker.ts?worker&inline", () => ({
  default: class {},
}));
vi.mock("../../libs/worker-pool", () => ({
  WorkerPool: class {
    addJob() {}
    terminate() {}
  },
}));

beforeAll(() => {
  const context = new Proxy(
    {},
    { get: (_target, key) => (key === "canvas" ? undefined : () => ({})) },
  );
  vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const SUN = new Vector3(-0.6, 0.7, 0.3).normalize();

/** Which of `watched` each depth pass of one shadow frame could see. */
function visibleDuringDepthPasses(
  scene: Scene,
  watched: Record<string, { visible: boolean }>,
  isExcludingEffects: boolean,
) {
  const csm = new CSMRenderer({ entityShadowFrameInterval: 1 });
  csm.setNonCasterExclusion(isExcludingEffects);
  const seen: Record<string, boolean[]> = {};
  for (const name of Object.keys(watched)) seen[name] = [];
  const stub = {
    setRenderTarget: () => undefined,
    clear: () => undefined,
    render: () => {
      for (const [name, object] of Object.entries(watched)) {
        seen[name].push(object.visible);
      }
    },
  } as Partial<WebGLRenderer> as WebGLRenderer;

  // A flier at the owner's TV1 pose: the deck sits inside the far cascade.
  const position = new Vector3(0.5, 150, 16.5);
  const camera = new PerspectiveCamera(70, 16 / 10, 0.1, 2000);
  camera.position.copy(position);
  camera.lookAt(651.5, 170, -530.5);
  camera.updateMatrixWorld();
  csm.update(camera, SUN, position);
  csm.hideNonCasters(scene);
  try {
    csm.render(stub, scene);
  } finally {
    csm.restoreNonCasters();
  }
  return seen;
}

describe("the sky and the cloud deck in the sun's shadow maps", () => {
  it("are marked never-casters by their own constructors", () => {
    expect(isMarkedNeverCaster(new Sky())).toBe(true);
    expect(isMarkedNeverCaster(new Clouds())).toBe(true);
    expect(isMarkedNeverCaster(new Mesh())).toBe(false);
  });

  it("sit out of every depth pass while the ground still casts, whatever the effect switch", () => {
    for (const isExcludingEffects of [true, false]) {
      const scene = new Scene();
      const sky = new Sky();
      const clouds = new Clouds();
      clouds.position.y = 300;
      const ground = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
      ground.position.y = 70;
      scene.add(ground, sky, clouds);

      const seen = visibleDuringDepthPasses(
        scene,
        { sky, clouds, ground },
        isExcludingEffects,
      );

      expect(seen.ground.length).toBeGreaterThan(0);
      expect(seen.ground.every(Boolean)).toBe(true);
      expect(seen.clouds.some(Boolean)).toBe(false);
      expect(seen.sky.some(Boolean)).toBe(false);
      expect(clouds.visible && sky.visible && ground.visible).toBe(true);
    }
  });

  it("leaves an unmarked group that reaches the cascade drawn, as the deck was", () => {
    const scene = new Scene();
    const deck = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    deck.position.y = 300;
    const marked = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    markNeverCaster(marked);
    scene.add(deck, marked);

    const seen = visibleDuringDepthPasses(scene, { deck, marked }, true);
    expect(seen.deck.every(Boolean)).toBe(true);
    expect(seen.marked.some(Boolean)).toBe(false);
  });
});
