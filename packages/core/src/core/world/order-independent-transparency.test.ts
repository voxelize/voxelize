import {
  AdditiveBlending,
  CustomBlending,
  DepthTexture,
  GLSL3,
  Material,
  Mesh,
  MeshBasicMaterial,
  MultiplyBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SrcAlphaFactor,
  WebGLRenderTarget,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";
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
  orderIndependentFragment,
} from "./order-independent-transparency";

const blended = (
  options: ConstructorParameters<typeof MeshBasicMaterial>[0] = {},
) =>
  new MeshBasicMaterial({ transparent: true, depthWrite: false, ...options });

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
    expect(blendedKindOf(new MeshBasicMaterial())).toBeNull();
    const glsl3 = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      glslVersion: GLSL3,
    });
    expect(blendedKindOf(glsl3)).toBeNull();
    const optedOut = blended();
    optedOut.userData[ORDER_INDEPENDENT_KEY] = false;
    expect(blendedKindOf(optedOut)).toBeNull();
  });
});

describe("orderIndependentFragment", () => {
  const source =
    "uniform float x;\nvoid main() {\n  gl_FragColor = vec4(x);\n}\n";

  it("renames the material's main by the preprocessor and wraps it", () => {
    const wrapped = orderIndependentFragment(source, "straight");
    expect(wrapped.startsWith("#define main orderIndependentShade\n")).toBe(
      true,
    );
    expect(wrapped).toContain(source);
    expect(wrapped.indexOf("#undef main")).toBeGreaterThan(
      wrapped.indexOf(source),
    );
    expect(wrapped).toContain(
      "layout(location = 1) out highp vec4 pc_fragOitWeight;",
    );
    expect(wrapped).toContain("gl_FragColor.rgb * oitAlpha");
    expect(orderIndependentFragment(source, "premultiplied")).not.toContain(
      "gl_FragColor.rgb * oitAlpha",
    );
  });

  it("drops the other side of the separating surface before shading", () => {
    const blendedSource = orderIndependentFragment(source, "straight");
    const keepBeforeShade =
      blendedSource.indexOf("if (oitIsBehind != (uOitPhase < 1.5)) discard;") <
      blendedSource.lastIndexOf("orderIndependentShade();");
    expect(keepBeforeShade).toBe(true);
  });

  it("leaves the material's own main first for hooks that edit it later", () => {
    const wrapped = orderIndependentFragment(source, "straight");
    const edited = wrapped.replace("void main() {", "void main() {\n  EDIT;");
    expect(edited.indexOf("EDIT;")).toBeLessThan(edited.indexOf("#undef main"));
  });
});

type FakeTarget = WebGLRenderTarget;

function fakeRenderer(target: FakeTarget | null) {
  let bound: FakeTarget | null = target;
  const setBlending = vi.fn();
  const setMaterial = vi.fn();
  const clearBufferfv = vi.fn();
  const properties = new WeakMap<object, Record<string, unknown>>();
  const transparent: unknown[] = [];
  const draws: { material: Material; target: FakeTarget | null }[] = [];
  const renderer = {
    renderLists: { get: () => ({ transparent }) },
    renderBufferDirect: vi.fn(
      (_c: unknown, _s: unknown, _g: unknown, material: Material) => {
        draws.push({ material, target: bound });
      },
    ),
    getRenderTarget: () => bound,
    setRenderTarget: vi.fn((next: FakeTarget | null) => {
      bound = next;
    }),
    getContext: () => ({ COLOR: 0x1800, clearBufferfv }),
    state: {
      setBlending,
      setMaterial,
      buffers: { color: { setMask: vi.fn() } },
    },
    properties: {
      get: (object: object) => {
        let entry = properties.get(object);
        if (!entry) {
          entry = {};
          properties.set(object, entry);
        }
        return entry;
      },
      has: (object: object) => properties.has(object),
    },
    capabilities: { logarithmicDepthBuffer: false, reversedDepthBuffer: false },
  };
  return {
    renderer: renderer as unknown as WebGLRenderer,
    setBlending,
    setMaterial,
    clearBufferfv,
    transparent,
    draws,
    bound: () => bound,
  };
}

function sceneTarget() {
  const target = new WebGLRenderTarget(64, 32, {
    depthTexture: new DepthTexture(64, 32),
  });
  return target;
}

function harness(
  target: FakeTarget | null = sceneTarget(),
  separatorDepth: DepthTexture | null = null,
) {
  const scene = new Scene();
  const opened: FakeTarget[] = [];
  const oit = new OrderIndependentTransparency(
    scene,
    defaultOrderIndependentTransparencyOptions,
    {
      onOpen: (_renderer, sceneTarget) => opened.push(sceneTarget),
      separator: {
        depth: () => separatorDepth,
        bias: 0.02,
      },
    },
  );
  scene.add(oit.open, oit.split, oit.close);
  const camera = new PerspectiveCamera(70, 2, 0.5, 400);
  const fake = fakeRenderer(target);
  oit.arm(fake.renderer, camera);
  const open = () =>
    oit.open.onBeforeRender(
      fake.renderer,
      scene,
      camera,
      oit.open.geometry,
      oit.open.material as Material,
      null,
    );
  const close = () =>
    oit.close.onBeforeRender(
      fake.renderer,
      scene,
      camera,
      oit.close.geometry,
      oit.close.material as Material,
      null,
    );
  const split = () =>
    oit.split.onBeforeRender(
      fake.renderer,
      scene,
      camera,
      oit.split.geometry,
      oit.split.material as Material,
      null,
    );
  return { oit, scene, camera, fake, open, split, close, opened };
}

const silence = () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
};

describe("OrderIndependentTransparency bands", () => {
  it("places the scene's transparent items by what they write", () => {
    const { oit, scene } = harness();
    const item = (material: Material, renderOrder = 0) => {
      const mesh = new Mesh(new PlaneGeometry(), material);
      mesh.renderOrder = renderOrder;
      scene.add(mesh);
      return mesh;
    };
    const glass = blended();
    const cutout = new MeshBasicMaterial({ transparent: true });
    const spark = blended({ blending: AdditiveBlending });

    expect(oit.bandOf(oit.open, oit.open.material as Material)).toBe(
      OIT_OPEN_RENDER_ORDER,
    );
    expect(oit.bandOf(oit.close, oit.close.material as Material)).toBe(
      OIT_CLOSE_RENDER_ORDER,
    );
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
  const compile = (material: Material) => {
    const shader = {
      fragmentShader: "void main() { gl_FragColor = vec4(1.0); }",
      vertexShader: "",
      uniforms: {},
    } as unknown as WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as WebGLRenderer);
    return shader;
  };

  it("wraps the compile hook and keys the program apart", () => {
    const { oit } = harness();
    const material = blended();
    const plainKey = material.customProgramCacheKey();
    expect(oit.adopt(material)).toBe(true);
    expect(material.customProgramCacheKey()).toBe(
      `${plainKey}|order-independent-straight`,
    );
    expect(material.onBeforeCompile.toString()).toBe(
      new MeshBasicMaterial().onBeforeCompile.toString(),
    );
    expect(material.forceSinglePass).toBe(true);
    const shader = compile(material);
    expect(shader.fragmentShader).toContain(
      "#define main orderIndependentShade",
    );
    expect(Object.keys(shader.uniforms)).toEqual(
      expect.arrayContaining(["uOitActive", "uOitClip", "uOitWeight"]),
    );
    expect(oit.adopt(material)).toBe(true);
    expect(
      compile(material).fragmentShader.match(/#define main/g),
    ).toHaveLength(1);
  });

  it("composes with a hook already on the material", () => {
    const { oit } = harness();
    const material = blended();
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = `// own hook\n${shader.fragmentShader}`;
    };
    oit.adopt(material);
    const { fragmentShader } = compile(material);
    expect(fragmentShader).toContain("// own hook");
    expect(fragmentShader).toContain("#undef main");
  });

  it("wraps again when a hook replaced the wrapper", () => {
    silence();
    const { oit } = harness();
    const material = blended();
    oit.adopt(material);
    material.onBeforeCompile = () => undefined;
    material.customProgramCacheKey = () => "replaced";
    material.needsUpdate = true;
    oit.adopt(material);
    expect(material.customProgramCacheKey()).toContain("|order-independent-");
    vi.restoreAllMocks();
  });

  it("counts what cannot accumulate, except additive light", () => {
    const { oit } = harness();
    expect(oit.adopt(blended({ blending: MultiplyBlending }))).toBe(false);
    expect(oit.adopt(blended({ blending: AdditiveBlending }))).toBe(false);
    expect(oit.stats.drawnAfter).toEqual(["MeshBasicMaterial"]);
  });
});

describe("OrderIndependentTransparency render", () => {
  it("accumulates against the scene's depth and composites back", () => {
    const { oit, fake, open, close, opened } = harness();
    const target = fake.bound() as FakeTarget;
    const adopted = blended();
    oit.adopt(adopted);

    open();
    expect(oit.isOpen).toBe(true);
    expect(opened).toEqual([target]);
    const accumulation = fake.bound() as FakeTarget;
    expect(accumulation).not.toBe(target);
    expect(accumulation.textures).toHaveLength(2);
    expect(accumulation.depthTexture).toBe(target.depthTexture);
    expect(fake.clearBufferfv).toHaveBeenCalledTimes(2);
    expect(oit.uniforms.uOitActive.value).toBe(1);
    expect(oit.uniforms.uOitClip.value.toArray()).toEqual([0.5, 400]);

    const state = fake.renderer.state;
    state.setMaterial(adopted, false, 0);
    expect(fake.setMaterial).toHaveBeenCalledWith(adopted, false, 0);
    expect(fake.setBlending).toHaveBeenCalledTimes(1);
    expect(fake.setBlending.mock.calls[0][0]).toBe(CustomBlending);
    state.setMaterial(new MeshBasicMaterial(), false, 0);
    expect(fake.setBlending).toHaveBeenCalledTimes(1);

    close();
    expect(oit.isOpen).toBe(false);
    expect(fake.bound()).toBe(target);
    expect(oit.uniforms.uOitActive.value).toBe(0);
    expect(oit.close.geometry.drawRange.count).toBe(3);
    state.setMaterial(adopted, false, 0);
    expect(fake.setBlending).toHaveBeenCalledTimes(1);
    oit.close.onAfterRender(
      fake.renderer,
      new Scene(),
      new PerspectiveCamera(),
      oit.close.geometry,
      oit.close.material as Material,
      null,
    );
    expect(oit.close.geometry.drawRange.count).toBe(0);
    expect(oit.stats.opened).toBe(1);
  });

  it("keeps the scene's depth texture when the accumulation is rebuilt", () => {
    const { oit, fake, open, close } = harness();
    const target = fake.bound() as FakeTarget;
    const depthTexture = target.depthTexture as DepthTexture;
    const dispose = vi.spyOn(depthTexture, "dispose");
    open();
    close();
    target.setSize(128, 64);
    oit.arm(
      fake.renderer,
      (oit as unknown as { camera: PerspectiveCamera }).camera,
    );
    open();
    expect((fake.bound() as FakeTarget).width).toBe(128);
    close();
    oit.dispose();
    expect(dispose).not.toHaveBeenCalled();
  });

  it("draws in list order, and says why, when it cannot accumulate", () => {
    silence();
    const canvas = harness(null);
    canvas.open();
    expect(canvas.oit.isOpen).toBe(false);
    expect(canvas.oit.stats.skipped.canvas).toBe(1);
    canvas.close();
    expect(canvas.oit.close.geometry.drawRange.count).toBe(0);

    const noDepth = harness(new WebGLRenderTarget(4, 4));
    noDepth.open();
    expect(noDepth.oit.stats.skipped["no-depth-texture"]).toBe(1);

    const multisampled = sceneTarget();
    multisampled.samples = 4;
    const msaa = harness(multisampled);
    msaa.open();
    expect(msaa.oit.stats.skipped.multisampled).toBe(1);

    const ortho = harness();
    ortho.oit.arm(ortho.fake.renderer, new OrthographicCamera());
    ortho.oit.open.onBeforeRender(
      ortho.fake.renderer,
      ortho.scene,
      (ortho.oit as unknown as { camera: OrthographicCamera }).camera,
      ortho.oit.open.geometry,
      ortho.oit.open.material as Material,
      null,
    );
    expect(ortho.oit.stats.skipped["not-perspective"]).toBe(1);
    expect(console.error).toHaveBeenCalledTimes(4);
    vi.restoreAllMocks();
  });

  it("accumulates in one pass with no separating surface in view", () => {
    const { oit, open, split, fake } = harness();
    open();
    expect(oit.uniforms.uOitPhase.value).toBe(OIT_PHASE_ALL);
    split();
    expect(fake.renderer.renderBufferDirect).not.toHaveBeenCalled();
  });

  it("composites what lies behind the water before drawing the rest with it", () => {
    const depth = new DepthTexture(64, 32);
    const { oit, scene, fake, open, split, close, opened } = harness(
      sceneTarget(),
      depth,
    );
    const target = fake.bound() as FakeTarget;
    const glassMaterial = blended();
    const waterMaterial = blended();
    waterMaterial.userData.isFluid = true;
    const cutoutMaterial = new MeshBasicMaterial({ transparent: true });
    const item = (material: Material) => {
      const mesh = new Mesh(new PlaneGeometry(), material);
      scene.add(mesh);
      return { object: mesh, geometry: mesh.geometry, material, group: null };
    };
    const glass = item(glassMaterial);
    const water = item(waterMaterial);
    const cutout = item(cutoutMaterial);
    const beforeRender = vi.spyOn(glass.object, "onBeforeRender");
    fake.transparent.push(
      cutout,
      {
        object: oit.open,
        geometry: oit.open.geometry,
        material: oit.open.material,
        group: null,
      },
      glass,
      water,
      {
        object: oit.split,
        geometry: oit.split.geometry,
        material: oit.split.material,
        group: null,
      },
    );
    oit.adopt(glassMaterial);
    oit.adopt(waterMaterial);

    open();
    expect(oit.uniforms.uOitPhase.value).toBe(OIT_PHASE_BEHIND);
    expect(oit.uniforms.uOitSeparatorDepth.value).toBe(depth);
    const accumulation = fake.bound();

    split();
    expect(fake.draws[0]).toEqual({
      material: oit.close.material,
      target,
    });
    expect(opened).toEqual([target, target]);
    expect(oit.uniforms.uOitPhase.value).toBe(OIT_PHASE_FRONT);
    expect(fake.bound()).toBe(accumulation);
    expect(fake.draws.slice(1).map((draw) => draw.material)).toEqual([
      glassMaterial,
      waterMaterial,
    ]);
    expect(
      fake.draws.slice(1).every((draw) => draw.target === accumulation),
    ).toBe(true);
    expect(beforeRender).toHaveBeenCalledTimes(1);

    close();
    expect(fake.bound()).toBe(target);
    expect(oit.uniforms.uOitPhase.value).toBe(OIT_PHASE_ALL);
  });

  it("draws one pass when the list being drawn is not the scene's own", () => {
    const { oit, open, split, fake } = harness(
      sceneTarget(),
      new DepthTexture(4, 4),
    );
    open();
    split();
    expect(oit.uniforms.uOitPhase.value).toBe(OIT_PHASE_ALL);
    expect(fake.renderer.renderBufferDirect).not.toHaveBeenCalled();
  });

  it("ignores renders with another camera or an override material", () => {
    const { oit, fake, scene, open } = harness();
    oit.open.onBeforeRender(
      fake.renderer,
      scene,
      new PerspectiveCamera(),
      oit.open.geometry,
      oit.open.material as Material,
      null,
    );
    expect(oit.isOpen).toBe(false);
    scene.overrideMaterial = new MeshBasicMaterial();
    open();
    expect(oit.isOpen).toBe(false);
    expect(oit.stats.skipped).toEqual({});
  });
});
