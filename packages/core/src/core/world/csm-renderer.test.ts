import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { describe, expect, it } from "vitest";

import { CSMRenderer } from "./csm-renderer";
import { BorrowedCasterScene, isNonCasterEffect } from "./shadow-casters";

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

type DrawnMesh = { object: Object3D; material: Material };
type RenderCall = { target: WebGLRenderTarget | null; drawn: DrawnMesh[] };

// A renderer stub that resolves each render call the way three does: walk
// the visible graph from the rendered root and, for a Scene root, replace
// every overridable material with the scene's override material.
const makeRecordingRenderer = () => {
  let target: WebGLRenderTarget | null = null;
  const calls: RenderCall[] = [];
  const stub = {
    setRenderTarget: (next: WebGLRenderTarget | null) => {
      target = next;
    },
    clear: () => undefined,
    render: (root: Object3D) => {
      const override = (root as Scene).isScene
        ? (root as Scene).overrideMaterial
        : null;
      const drawn: DrawnMesh[] = [];
      const visit = (object: Object3D) => {
        if (!object.visible) return;
        const { material } = object as Mesh;
        if ((object as Mesh).isMesh && material && !Array.isArray(material)) {
          drawn.push({
            object,
            material: override && material.allowOverride ? override : material,
          });
        }
        for (const child of object.children) visit(child);
      };
      visit(root);
      calls.push({ target, drawn });
    },
  };
  return {
    renderer: stub as Partial<WebGLRenderer> as WebGLRenderer,
    calls,
  };
};

const makeCasterScene = () => {
  const scene = new Scene();
  const terrain = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  scene.add(terrain);

  const entities = new Group();
  scene.add(entities);
  const nearEntity = new Group();
  nearEntity.position.set(2, 40, 1);
  const nearBody = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  nearEntity.add(nearBody);
  const farEntity = new Group();
  farEntity.position.set(45, 40, 0);
  const farBody = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  farEntity.add(farBody);
  entities.add(nearEntity, farEntity);

  const poolRoot = new Group();
  scene.add(poolRoot);
  const pool = new Group();
  poolRoot.add(pool);
  const creatures = new InstancedMesh(
    new BoxGeometry(),
    new MeshBasicMaterial(),
    4,
  );
  creatures.count = 1;
  creatures.setMatrixAt(0, new Matrix4().makeTranslation(3, 40, -2));
  const skinnedDepth = new ShaderMaterial();
  creatures.customDepthMaterial = skinnedDepth;
  pool.add(creatures);

  const rain = new Mesh(
    new BoxGeometry(),
    new MeshBasicMaterial({ transparent: true, depthWrite: false }),
  );
  scene.add(rain);

  return {
    scene,
    terrain,
    entities,
    nearEntity,
    nearBody,
    farEntity,
    farBody,
    poolRoot,
    pool,
    creatures,
    skinnedDepth,
    rain,
  };
};

const drawsOf = (calls: RenderCall[], object: Object3D) =>
  calls.flatMap((call) => call.drawn.filter((d) => d.object === object));

const cascadeCalls = (csm: CSMRenderer, calls: RenderCall[], cascade: number) =>
  calls.filter(
    (call) => call.target?.depthTexture === csm.getShadowMap(cascade),
  );

const renderShadowFrame = (
  csm: CSMRenderer,
  fixture: ReturnType<typeof makeCasterScene>,
  renderer: WebGLRenderer,
) => {
  const position = new Vector3(0, 40, 0);
  const camera = makeCamera(position, new Vector3(10, 40, 0));
  csm.update(camera, SUN, position);
  csm.markCascadesForEntityRender();
  csm.hideNonCasters(fixture.scene);
  try {
    csm.render(
      renderer,
      fixture.scene,
      [fixture.nearEntity, fixture.farEntity],
      32,
      [fixture.pool],
    );
  } finally {
    csm.restoreNonCasters();
  }
};

describe("CSMRenderer dynamic casters", () => {
  it("draws each near caster once per near cascade, pools posed", () => {
    const csm = new CSMRenderer({ entityShadowFrameInterval: 1 });
    const fixture = makeCasterScene();
    csm.addShadowExclusion(fixture.poolRoot);
    const recording = makeRecordingRenderer();

    let moves = 0;
    const count = () => (moves += 1);
    fixture.entities.addEventListener("childadded", count);
    fixture.entities.addEventListener("childremoved", count);

    renderShadowFrame(csm, fixture, recording.renderer);

    // The first frame draws the near cascade and the first far one.
    for (const cascade of [0, 1]) {
      const calls = cascadeCalls(csm, recording.calls, cascade);
      expect(drawsOf(calls, fixture.terrain)).toHaveLength(1);
      const near = drawsOf(calls, fixture.nearBody);
      expect(near).toHaveLength(1);
      expect(near[0].material).toBeInstanceOf(MeshDepthMaterial);
      const creatures = drawsOf(calls, fixture.creatures);
      expect(creatures).toHaveLength(1);
      expect(creatures[0].material).toBe(fixture.skinnedDepth);
      expect(drawsOf(calls, fixture.rain)).toHaveLength(0);
    }
    // Beyond the entity shadow distance: left to the scene pass as before.
    expect(
      drawsOf(cascadeCalls(csm, recording.calls, 0), fixture.farBody),
    ).toHaveLength(1);

    expect(moves).toBe(0);
    expect(fixture.nearEntity.parent).toBe(fixture.entities);
    expect(fixture.creatures.material).toBeInstanceOf(MeshBasicMaterial);
    expect(fixture.skinnedDepth.allowOverride).toBe(true);
    expect(fixture.poolRoot.visible).toBe(true);
    expect(fixture.pool.visible).toBe(true);
    expect(fixture.nearEntity.visible).toBe(true);
    expect(fixture.rain.visible).toBe(true);
  });

  it("never draws a pool with the generic depth material", () => {
    const csm = new CSMRenderer({ entityShadowFrameInterval: 1 });
    const fixture = makeCasterScene();
    csm.addShadowExclusion(fixture.poolRoot);
    const recording = makeRecordingRenderer();

    // No near caster: the frame loop passes no entities and no pools.
    const position = new Vector3(0, 40, 0);
    const camera = makeCamera(position, new Vector3(10, 40, 0));
    for (let frame = 0; frame < 4; frame++) {
      csm.update(camera, SUN, position);
      csm.hideNonCasters(fixture.scene);
      csm.render(recording.renderer, fixture.scene, [], 32, []);
      csm.restoreNonCasters();
    }

    // Every cascade was drawn, and no creature landed in any of them in
    // its bind pose (nor posed: nobody is near enough to cast).
    for (const cascade of [0, 1, 2]) {
      expect(
        cascadeCalls(csm, recording.calls, cascade).length,
      ).toBeGreaterThan(0);
    }
    expect(drawsOf(recording.calls, fixture.creatures)).toHaveLength(0);
  });

  it("keeps the old double draw behind the A/B switch", () => {
    const csm = new CSMRenderer({ entityShadowFrameInterval: 1 });
    csm.setSingleCasterPass(false);
    csm.setNonCasterExclusion(false);
    const fixture = makeCasterScene();
    csm.addShadowExclusion(fixture.poolRoot);
    const recording = makeRecordingRenderer();

    renderShadowFrame(csm, fixture, recording.renderer);

    const calls = cascadeCalls(csm, recording.calls, 0);
    expect(drawsOf(calls, fixture.nearBody)).toHaveLength(2);
    const creatureMaterials = drawsOf(calls, fixture.creatures).map(
      (d) => d.material,
    );
    expect(creatureMaterials).toHaveLength(2);
    expect(creatureMaterials[0]).toBeInstanceOf(MeshDepthMaterial);
    expect(creatureMaterials[1]).toBe(fixture.skinnedDepth);
    expect(drawsOf(calls, fixture.rain)).toHaveLength(1);
    expect(fixture.nearEntity.parent).toBe(fixture.entities);
  });
});

describe("isNonCasterEffect", () => {
  it("flags transparent, depth-less effects only", () => {
    const effect = new Mesh(
      new BoxGeometry(),
      new MeshBasicMaterial({ transparent: true, depthWrite: false }),
    );
    const solid = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    const optedIn = new Mesh(
      new BoxGeometry(),
      new MeshBasicMaterial({ transparent: true, depthWrite: false }),
    );
    (optedIn.material as Material).userData.castsShadow = true;
    const mixed = new Mesh(new BoxGeometry(), [
      new MeshBasicMaterial({ transparent: true, depthWrite: false }),
      new MeshBasicMaterial(),
    ]);

    expect(isNonCasterEffect(effect)).toBe(true);
    expect(isNonCasterEffect(solid)).toBe(false);
    expect(isNonCasterEffect(optedIn)).toBe(false);
    expect(isNonCasterEffect(mixed)).toBe(false);
    expect(isNonCasterEffect(new Group())).toBe(false);
  });
});

describe("BorrowedCasterScene", () => {
  it("draws casters where they live, with the override, and hands them back", () => {
    const world = new Scene();
    const parent = new Group();
    parent.position.set(10, 0, 0);
    world.add(parent);
    const body = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    parent.add(body);
    const posed = new Mesh(new BoxGeometry(), new ShaderMaterial());
    posed.material.allowOverride = false;
    world.add(posed);

    const { renderer, calls } = makeRecordingRenderer();
    const batch = new BorrowedCasterScene();
    const override = new MeshDepthMaterial();
    const listened: string[] = [];
    parent.addEventListener("childremoved", () => listened.push("removed"));
    batch.render(renderer, new PerspectiveCamera(), [body, posed], override);

    expect(calls).toHaveLength(1);
    expect(calls[0].drawn.map((d) => d.object)).toEqual([body, posed]);
    expect(calls[0].drawn[0].material).toBe(override);
    expect(calls[0].drawn[1].material).toBe(posed.material);
    expect(body.parent).toBe(parent);
    expect(posed.parent).toBe(world);
    expect(listened).toEqual([]);
    expect(batch.scene.children).toEqual([]);
    expect(batch.scene.overrideMaterial).toBeNull();
  });

  it("refreshes world matrices from the real parent only when asked", () => {
    const world = new Scene();
    const parent = new Group();
    parent.position.set(10, 0, 0);
    world.add(parent);
    world.updateMatrixWorld();
    const caster = new Object3D();
    parent.add(caster);
    caster.position.set(0, 5, 0);

    const { renderer } = makeRecordingRenderer();
    const batch = new BorrowedCasterScene();
    const eye = new PerspectiveCamera();
    const at = new Vector3();

    batch.render(renderer, eye, [caster], null);
    expect(at.setFromMatrixPosition(caster.matrixWorld).y).toBe(0);

    batch.render(renderer, eye, [caster], null, true);
    at.setFromMatrixPosition(caster.matrixWorld);
    expect([at.x, at.y, at.z]).toEqual([10, 5, 0]);
  });
});
