import { NodeMaterial, type Renderer, type RenderTarget } from "three/webgpu";
import { describe, expect, it } from "vitest";

import { EffectComposer, ScenePass } from "./composer";
import { Effect } from "./effect";
import { EffectPass } from "./effect-pass";
import { drew, Pass } from "./pass";

/**
 * A renderer that counts a draw call for each quad it draws, except the
 * ones whose material is named in `leftOut` (a pipeline still compiling),
 * and remembers where each landed.
 */
function fakeRenderer(leftOut = new Set<string>()) {
  const draws: { material: string; target: string }[] = [];
  let target: RenderTarget | null = null;
  const renderer = {
    autoClear: true,
    outputColorSpace: "srgb",
    toneMapping: 0,
    info: { autoReset: false, render: { drawCalls: 0 } },
    setRenderTarget(next: RenderTarget | null) {
      target = next;
    },
    render(mesh: { material: NodeMaterial }) {
      const material = mesh.material.name;
      if (leftOut.has(material)) return;
      renderer.info.render.drawCalls += 1;
      draws.push({ material, target: target?.texture.name ?? "screen" });
    },
  };
  return { renderer: renderer as unknown as Renderer, draws, leftOut };
}

/** A pass that says what it read and where it drew, or leaves its draw out. */
class Probe extends Pass {
  isLeftOut = false;
  readonly reads: string[] = [];
  readonly writes: string[] = [];

  render(_renderer: Renderer, input: RenderTarget, output: RenderTarget | null) {
    if (this.isLeftOut) return false;
    this.reads.push(input.texture.name);
    this.writes.push(output?.texture.name ?? "screen");
  }
}

function chain(leftOut?: Set<string>) {
  const fake = fakeRenderer(leftOut);
  const composer = new EffectComposer(fake.renderer);
  composer.addPass(new ScenePass(() => {}));
  const first = composer.addPass(new Probe("first")) as Probe;
  const second = composer.addPass(new Probe("second")) as Probe;
  const last = composer.addPass(new Probe("last")) as Probe;
  return { ...fake, composer, first, second, last };
}

describe("EffectComposer", () => {
  it("hands each pass what the one before drew", () => {
    const { composer, first, second, last, draws } = chain();
    composer.render();
    expect(first.reads).toEqual(["EffectComposer.scene"]);
    expect(second.reads).toEqual(first.writes);
    expect(last.reads).toEqual(second.writes);
    expect(last.writes).toEqual(["screen"]);
    expect(draws).toEqual([]);
  });

  it("passes over a pass whose draw was left out", () => {
    // The buffer a left-out pass was to draw into holds nothing this frame:
    // read by the next pass, the screen went empty until the pipeline came.
    const { composer, first, second, last } = chain();
    second.isLeftOut = true;
    composer.render();
    expect(last.reads).toEqual(first.writes);
    second.isLeftOut = false;
    composer.render();
    expect(last.reads[1]).toEqual(second.writes[0]);
    expect(second.reads[0]).toEqual(first.writes[1]);
  });

  it("reads the scene when every pass before the last was left out", () => {
    const { composer, first, second, last } = chain();
    first.isLeftOut = true;
    second.isLeftOut = true;
    composer.render();
    expect(last.reads).toEqual(["EffectComposer.scene"]);
  });

  it("copies the frame to the screen when the last pass was left out", () => {
    const { composer, second, last, draws } = chain();
    last.isLeftOut = true;
    composer.render();
    expect(draws).toEqual([{ material: "EffectComposer.copy", target: "screen" }]);
    // What it copied is what the last pass would have read.
    expect(second.writes).toHaveLength(1);
  });

  it("draws disabled passes, and the copy, only while warming", () => {
    const { composer, second, last, draws } = chain();
    second.enabled = false;
    composer.render();
    expect(second.writes).toEqual([]);
    expect(draws).toEqual([]);

    composer.isWarming = true;
    composer.render();
    expect(second.writes).toHaveLength(1);
    expect(last.reads[1]).toEqual(second.writes[0]);
    // The copy lands under the last pass, which draws over all of it.
    expect(draws).toEqual([{ material: "EffectComposer.copy", target: "screen" }]);
    expect(last.writes).toEqual(["screen", "screen"]);

    composer.isWarming = false;
    composer.render();
    expect(second.writes).toHaveLength(1);
    expect(draws).toHaveLength(1);
  });

  it("restores the renderer's state when a pass throws", () => {
    const { composer, renderer, last } = chain();
    last.render = () => {
      throw new Error("pass failed");
    };
    expect(() => composer.render()).toThrow("pass failed");
    expect(renderer.autoClear).toBe(true);
    expect(renderer.outputColorSpace).toBe("srgb");
  });
});

class Tint extends Effect {
  constructor() {
    super("Tint");
  }

  fragment({ color }: Parameters<Effect["fragment"]>[0]) {
    return color;
  }
}

describe("EffectPass", () => {
  it("says so when the renderer left its draw out", () => {
    const { renderer, draws, leftOut } = fakeRenderer();
    const composer = new EffectComposer(renderer);
    const pass = new EffectPass(new Tint());
    const context = { depth: null, delta: 0 };
    const input = composer.sceneTarget;

    expect(pass.render(renderer, input, null, context)).toBe(true);
    expect(draws).toEqual([{ material: "EffectPass(Tint) → screen", target: "screen" }]);

    leftOut.add("EffectPass(Tint)");
    expect(pass.render(renderer, input, input, context)).toBe(false);
    leftOut.clear();
    expect(pass.render(renderer, input, input, context)).toBe(true);
  });
});

describe("drew", () => {
  it("counts draw calls, not render calls", () => {
    const { renderer } = fakeRenderer(new Set(["held"]));
    const held = { material: Object.assign(new NodeMaterial(), { name: "held" }) };
    const ready = { material: Object.assign(new NodeMaterial(), { name: "ready" }) };
    const render = renderer.render as unknown as (mesh: unknown) => void;
    expect(drew(renderer, () => render(held))).toBe(false);
    expect(drew(renderer, () => render(ready))).toBe(true);
    expect(drew(renderer, () => {})).toBe(false);
  });
});
