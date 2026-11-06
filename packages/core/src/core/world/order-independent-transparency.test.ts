import {
  AdditiveBlending,
  type Camera,
  CustomBlending,
  DepthTexture,
  DoubleSide,
  FloatType,
  type Material,
  Mesh,
  MeshBasicNodeMaterial,
  MultiplyBlending,
  type Object3D,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  type Renderer,
  RenderTarget,
  Scene,
  SrcAlphaFactor,
} from "three/webgpu";
import { renderGroup, vec4 } from "three/tsl";
import { describe, expect, it, vi } from "vitest";

import {
  blendedKindOf,
  defaultOrderIndependentTransparencyOptions,
  OIT_AFTER_RENDER_ORDER,
  OIT_BLENDED_RENDER_ORDER,
  OIT_CLOSE_RENDER_ORDER,
  OIT_DEPTH_WRITING_RENDER_ORDER,
  OIT_OPEN_RENDER_ORDER,
  OIT_PHASE_ALL,
  OIT_PHASE_BEHIND,
  OIT_PHASE_FRONT,
  OIT_SPLIT_RENDER_ORDER,
  ORDER_INDEPENDENT_KEY,
  OrderIndependentTransparency,
} from "./order-independent-transparency";

const blended = (
  options: ConstructorParameters<typeof MeshBasicNodeMaterial>[0] = {},
) =>
  new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, ...options });

describe("blendedKindOf", () => {
  it("accumulates normal blending, straight or premultiplied", () => {
    expect(blendedKindOf(blended())).toBe("straight");
    expect(blendedKindOf(blended({ premultipliedAlpha: true }))).toBe(
      "premultiplied",
    );
  });

  it("reads custom blending that equals normal blending", () => {
    const custom = (blendSrc: number) =>
      blended({
        blending: CustomBlending,
        blendSrc: blendSrc as typeof OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
      });
    expect(blendedKindOf(custom(SrcAlphaFactor))).toBe("straight");
    expect(blendedKindOf(custom(OneFactor))).toBe("premultiplied");
  });

  it("leaves out what cannot accumulate", () => {
    expect(blendedKindOf(blended({ blending: AdditiveBlending }))).toBeNull();
    expect(blendedKindOf(blended({ blending: MultiplyBlending }))).toBeNull();
    expect(blendedKindOf(blended({ depthWrite: true }))).toBeNull();
    expect(blendedKindOf(blended({ colorWrite: false }))).toBeNull();
    expect(blendedKindOf(new MeshBasicNodeMaterial())).toBeNull();
    // A `fragmentNode` material gets no render-target outputs from three.
    const ownFragment = blended();
    ownFragment.fragmentNode = vec4(1);
    expect(blendedKindOf(ownFragment)).toBeNull();
    const optedOut = blended();
    optedOut.userData[ORDER_INDEPENDENT_KEY] = false;
    expect(blendedKindOf(optedOut)).toBeNull();
  });
});

type Draw = {
  object: Object3D;
  material: Material;
  target: RenderTarget | null;
  mrt: unknown;
  phase: number;
};

type RenderObjectFunction = NonNullable<
  ReturnType<Renderer["getRenderObjectFunction"]>
>;

/**
 * Just what the pass asks of a renderer, resolving `render` the way three
 * does: every visible mesh of the rendered root goes through the render
 * object function when one is set (three's own `renderObject` otherwise),
 * a double-sided transparent one twice (back faces, then front).
 */
function fakeRenderer(oit: () => OrderIndependentTransparency) {
  let target: RenderTarget | null = null;
  let renderObjectFunction: RenderObjectFunction | null = null;
  let mrt: unknown = null;
  const draws: Draw[] = [];
  const renderer = {
    autoClear: true,
    logarithmicDepthBuffer: false,
    reversedDepthBuffer: false,
    setRenderTarget: (next: RenderTarget | null) => {
      target = next;
    },
    getRenderTarget: () => target,
    getRenderObjectFunction: () => renderObjectFunction,
    setRenderObjectFunction: (next: RenderObjectFunction | null) => {
      renderObjectFunction = next;
    },
    setMRT: (next: unknown) => {
      mrt = next;
    },
    getMRT: () => mrt,
    getClearColor: <T>(color: T) => color,
    getClearAlpha: () => 1,
    setClearColor: () => undefined,
    clear: () => undefined,
    renderObject: (object: Object3D, _scene: Scene, _camera: Camera, _geometry: unknown, material: Material) => {
      draws.push({
        object,
        material,
        target,
        mrt,
        phase: oit().uniforms.phase.value,
      });
    },
    render: (root: Object3D, camera: Camera) => {
      const scene = root as Scene;
      root.traverseVisible((object) => {
        const mesh = object as Mesh;
        if (!mesh.isMesh) return;
        const material = mesh.material as Material;
        const passes =
          material.transparent && material.side === DoubleSide ? 2 : 1;
        for (let i = 0; i < passes; i++) {
          const call = (renderObjectFunction ??
            renderer.renderObject) as unknown as (
            ...args: unknown[]
          ) => void;
          call.call(
            renderer,
            mesh,
            scene,
            camera,
            mesh.geometry,
            material,
            null,
            null,
            null,
            null,
          );
        }
      });
    },
  };
  return {
    renderer: renderer as unknown as Renderer,
    draws,
    renderObjectFunction: () => renderObjectFunction,
    mrt: () => mrt,
  };
}

function sceneTarget(width = 64, height = 32) {
  return new RenderTarget(width, height, {
    depthTexture: new DepthTexture(width, height, FloatType),
  });
}

function harness(separatorDepth: DepthTexture | null = null) {
  const scene = new Scene();
  const opened: RenderTarget[] = [];
  const beforeComposite = vi.fn();
  const oit: OrderIndependentTransparency = new OrderIndependentTransparency(
    scene,
    defaultOrderIndependentTransparencyOptions,
    {
      onOpen: (_renderer, target) => opened.push(target),
      beforeComposite,
      separator: { depth: () => separatorDepth, bias: 0.02 },
    },
  );
  const camera = new PerspectiveCamera(70, 2, 0.5, 400);
  const fake = fakeRenderer(() => oit);
  const item = (material: Material, renderOrder = 0) => {
    const mesh = new Mesh(new PlaneGeometry(), material);
    mesh.renderOrder = renderOrder;
    scene.add(mesh);
    return mesh;
  };
  return { oit, scene, camera, fake, item, opened, beforeComposite };
}

/** A scene of one of each: opaque ground, a cutout, glass and a spark. */
function populated(separatorDepth: DepthTexture | null = null) {
  const h = harness(separatorDepth);
  const ground = h.item(new MeshBasicNodeMaterial());
  const cutout = h.item(new MeshBasicNodeMaterial({ transparent: true }));
  const glassMaterial = blended();
  const glass = h.item(glassMaterial);
  const sparkMaterial = blended({ blending: AdditiveBlending });
  const spark = h.item(sparkMaterial);
  return { ...h, ground, cutout, glass, glassMaterial, spark, sparkMaterial };
}

const silence = () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
};

describe("OrderIndependentTransparency bands", () => {
  it("places the scene's transparent items by what they write", () => {
    const { oit, item } = harness();
    const glass = blended();
    const cutout = new MeshBasicNodeMaterial({ transparent: true });
    const spark = blended({ blending: AdditiveBlending });

    expect(oit.bandOf(item(glass, 100001), glass)).toBe(
      OIT_BLENDED_RENDER_ORDER,
    );
    expect(oit.bandOf(item(cutout, 99999), cutout)).toBe(
      OIT_DEPTH_WRITING_RENDER_ORDER,
    );
    expect(oit.bandOf(item(spark), spark)).toBe(OIT_AFTER_RENDER_ORDER);
    expect(oit.bandOf(item(glass, -1), glass)).toBeUndefined();
    expect(
      oit.bandOf(item(glass, OIT_CLOSE_RENDER_ORDER), glass),
    ).toBeUndefined();
    expect(oit.bandOf(item(glass), undefined)).toBeUndefined();
  });

  it("leaves items of other scenes to their own order", () => {
    const { oit } = harness();
    const material = blended();
    const elsewhere = new Mesh(new PlaneGeometry(), material);
    new Scene().add(elsewhere);
    expect(oit.bandOf(elsewhere, material)).toBeUndefined();
  });

  it("orders the bands open, depth writers before it, after-band past close", () => {
    expect(OIT_DEPTH_WRITING_RENDER_ORDER).toBeGreaterThan(-1);
    expect(OIT_DEPTH_WRITING_RENDER_ORDER).toBeLessThan(OIT_OPEN_RENDER_ORDER);
    expect(OIT_OPEN_RENDER_ORDER).toBeLessThan(OIT_BLENDED_RENDER_ORDER);
    expect(OIT_BLENDED_RENDER_ORDER).toBeLessThan(OIT_SPLIT_RENDER_ORDER);
    expect(OIT_SPLIT_RENDER_ORDER).toBeLessThan(OIT_CLOSE_RENDER_ORDER);
    expect(OIT_CLOSE_RENDER_ORDER).toBeLessThan(OIT_AFTER_RENDER_ORDER);
    expect(OIT_AFTER_RENDER_ORDER).toBeLessThan(1e6);
  });
});

describe("OrderIndependentTransparency adoption", () => {
  it("decides once per material, and never changes it", () => {
    const { oit } = harness();
    const material = blended();
    const version = material.version;
    expect(oit.adopt(material)).toBe(true);
    expect(oit.adopt(material)).toBe(true);
    expect(oit.adoptBeforeCompile(material)).toBe(true);
    expect(oit.stats.adopted).toBe(1);
    expect(material.version).toBe(version);
    expect(material.fragmentNode).toBeNull();
  });

  it("counts what cannot accumulate, except additive light", () => {
    const { oit } = harness();
    expect(oit.adopt(blended({ blending: MultiplyBlending }))).toBe(false);
    expect(oit.adopt(blended({ blending: AdditiveBlending }))).toBe(false);
    expect(oit.stats.drawnAfter).toEqual(["MeshBasicNodeMaterial"]);
  });
});

describe("OrderIndependentTransparency render", () => {
  it("keeps the blended band out of the scene pass and accumulates it against the scene's depth", () => {
    const { oit, scene, camera, fake, opened, ground, cutout, glass, spark } =
      populated();
    const target = sceneTarget();
    oit.render(fake.renderer, scene, camera, target);

    const drawsOf = (object: Object3D) =>
      fake.draws.filter((draw) => draw.object === object);
    // The scene pass draws everything but the blended and after bands.
    for (const object of [ground, cutout]) {
      expect(drawsOf(object)).toHaveLength(1);
      expect(drawsOf(object)[0].target).toBe(target);
      expect(drawsOf(object)[0].mrt).toBeNull();
    }
    // The glass accumulates once, into a target sharing the scene's depth,
    // through the encoder's outputs.
    const [accumulated] = drawsOf(glass);
    expect(drawsOf(glass)).toHaveLength(1);
    const accumulation = accumulated.target as RenderTarget;
    expect(accumulation).not.toBe(target);
    expect(accumulation.textures).toHaveLength(2);
    expect(accumulation.depthTexture).toBe(target.depthTexture);
    expect(accumulated.mrt).toBe(oit.accumulationPass(target).mrt);
    expect(accumulated.phase).toBe(OIT_PHASE_ALL);
    // Additive light draws after, over the scene, without the outputs.
    expect(drawsOf(spark)).toHaveLength(1);
    expect(drawsOf(spark)[0].target).toBe(target);
    expect(drawsOf(spark)[0].mrt).toBeNull();
    expect(fake.draws.indexOf(drawsOf(spark)[0])).toBeGreaterThan(
      fake.draws.indexOf(accumulated),
    );
    expect(opened).toEqual([target]);
    expect(oit.stats.opened).toBe(1);
    expect(oit.isOpen).toBe(false);
  });

  it("composites the accumulation over the scene target", () => {
    const { oit, scene, camera, fake, beforeComposite } = populated();
    const target = sceneTarget();
    oit.render(fake.renderer, scene, camera, target);
    const composite = fake.draws.filter(
      (draw) => draw.material.name === "OrderIndependent.composite",
    );
    expect(composite).toHaveLength(1);
    expect(composite[0].target).toBe(target);
    expect(beforeComposite).toHaveBeenCalledTimes(1);
  });

  it("hands the renderer back as it found it, and lets go of the kept draws", () => {
    const { oit, scene, camera, fake, glass } = populated();
    const target = sceneTarget();
    oit.render(fake.renderer, scene, camera, target);
    expect(fake.renderObjectFunction()).toBeNull();
    expect(fake.mrt()).toBeNull();
    expect(fake.renderer.autoClear).toBe(true);
    expect(fake.renderer.getRenderTarget()).toBe(target);
    const kept = (
      oit as unknown as { blended: { object: Object3D }[] }
    ).blended;
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.some((draw) => draw.object === glass)).toBe(false);
  });

  it("accumulates a double-sided item once a pass", () => {
    const { oit, scene, camera, fake, item } = harness();
    const pane = item(blended({ side: DoubleSide }));
    oit.render(fake.renderer, scene, camera, sceneTarget());
    expect(fake.draws.filter((draw) => draw.object === pane)).toHaveLength(1);
  });

  it("keeps the scene's depth texture when the accumulation is rebuilt", () => {
    const { oit, scene, camera, fake } = populated();
    const target = sceneTarget();
    const depthTexture = target.depthTexture as DepthTexture;
    const dispose = vi.spyOn(depthTexture, "dispose");
    oit.render(fake.renderer, scene, camera, target);
    const first = oit.accumulationPass(target).target;
    target.setSize(128, 64);
    oit.render(fake.renderer, scene, camera, target);
    const second = oit.accumulationPass(target).target;
    expect(second).not.toBe(first);
    expect(second.width).toBe(128);
    expect(second.depthTexture).toBe(depthTexture);
    oit.dispose();
    expect(dispose).not.toHaveBeenCalled();
  });

  it("draws in list order, and says why once, when it cannot accumulate", () => {
    silence();
    const cases: [string, RenderTarget, Camera][] = [];
    const noDepth = new RenderTarget(4, 4);
    cases.push(["no-depth-texture", noDepth, new PerspectiveCamera()]);
    const multisampled = sceneTarget();
    multisampled.samples = 4;
    cases.push(["multisampled", multisampled, new PerspectiveCamera()]);
    cases.push(["not-perspective", sceneTarget(), new OrthographicCamera()]);
    for (const [reason, target, camera] of cases) {
      const { oit, scene, fake, glass } = populated();
      oit.render(fake.renderer, scene, camera, target);
      oit.render(fake.renderer, scene, camera, target);
      expect(oit.stats.skipped).toEqual({ [reason]: 2 });
      expect(oit.stats.opened).toBe(0);
      // Drawn normally, straight into the scene's target.
      const drawn = fake.draws.filter((draw) => draw.object === glass);
      expect(drawn).toHaveLength(2);
      expect(drawn.every((draw) => draw.target === target)).toBe(true);
    }
    const special = populated();
    (
      special.fake.renderer as unknown as { logarithmicDepthBuffer: boolean }
    ).logarithmicDepthBuffer = true;
    special.oit.render(
      special.fake.renderer,
      special.scene,
      special.camera,
      sceneTarget(),
    );
    expect(special.oit.stats.skipped).toEqual({ "special-depth": 1 });
    expect(console.error).toHaveBeenCalledTimes(4);
    vi.restoreAllMocks();
  });

  it("opens nothing for a frame without blended layers", () => {
    const { oit, scene, camera, fake, item } = harness();
    item(new MeshBasicNodeMaterial());
    oit.render(fake.renderer, scene, camera, sceneTarget());
    expect(oit.stats.opened).toBe(0);
    expect(fake.draws.every((draw) => draw.mrt === null)).toBe(true);
  });

  it("accumulates what lies behind the water before the rest, with it", () => {
    const depth = new DepthTexture(64, 32, FloatType);
    const { oit, scene, camera, fake, opened, glass, item } = populated(depth);
    const waterMaterial = blended();
    waterMaterial.userData.isFluid = true;
    const water = item(waterMaterial);
    const target = sceneTarget();
    oit.render(fake.renderer, scene, camera, target);

    expect(oit.uniforms.separatorDepth.value).toBe(depth);
    const phases = (object: Object3D) =>
      fake.draws
        .filter((draw) => draw.object === object)
        .map((draw) => draw.phase);
    expect(phases(glass)).toEqual([OIT_PHASE_BEHIND, OIT_PHASE_FRONT]);
    expect(phases(water)).toEqual([OIT_PHASE_BEHIND, OIT_PHASE_FRONT]);
    // The scene is handed over again once what lies behind is in it.
    expect(opened).toEqual([target, target]);
    // And the phase is back for every other render.
    expect(oit.uniforms.phase.value).toBe(OIT_PHASE_ALL);
  });

  it("keeps the pass-wide values in the render's shared group, moved on per phase", () => {
    const depth = new DepthTexture(64, 32, FloatType);
    const { oit, scene, camera, fake, item } = populated(depth);
    const waterMaterial = blended();
    waterMaterial.userData.isFluid = true;
    item(waterMaterial);
    for (const node of [
      oit.uniforms.phase,
      oit.uniforms.weight,
      oit.uniforms.weightRange,
      oit.uniforms.separatorBias,
    ]) {
      // In an object's own group, each blended draw rewrote its buffer
      // whenever the phase moved: twice a frame per draw.
      expect(node.groupNode).toBe(renderGroup);
    }
    const before = renderGroup.version;
    oit.render(fake.renderer, scene, camera, sceneTarget());
    // Behind, front, and back to all.
    expect(renderGroup.version - before).toBe(3);
  });
});
