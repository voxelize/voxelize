import {
  DepthTexture,
  type NodeMaterial,
  type Renderer,
  type RenderTarget,
} from "three/webgpu";
import { describe, expect, it, vi } from "vitest";

import { EffectComposer, ScenePass } from "./composer";
import {
  blurDivisor,
  blurShare,
  bokehKernel,
  DEFAULT_DEPTH_OF_FIELD,
  DepthOfFieldPass,
  easeShare,
} from "./depth-of-field";
import { Pass } from "./pass";

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

/** A 70 degree perspective camera's planes and projection. */
const PROJECTION_SCALE = 1 / Math.tan((70 * Math.PI) / 360);
const camera = {
  near: 0.1,
  far: 3000,
  projectionMatrix: {
    elements: [
      0.8,
      0,
      0,
      0,
      0,
      PROJECTION_SCALE,
      0,
      0,
      0,
      0,
      -1,
      -1,
      0,
      0,
      -0.2,
      0,
    ],
  },
};

function frame(leftOut?: Set<string>) {
  const fake = fakeRenderer(leftOut);
  const composer = new EffectComposer(fake.renderer);
  const pass = new DepthOfFieldPass(camera);
  pass.setSize(1920, 1080);
  const context = { depth: new DepthTexture(1, 1), delta: 1 / 60 };
  return { ...fake, composer, pass, context, input: composer.sceneTarget };
}

/** A pass that says what it read. */
class Probe extends Pass {
  readonly reads: string[] = [];

  render(_renderer: Renderer, input: RenderTarget) {
    this.reads.push(input.texture.name);
  }
}

describe("bokehKernel", () => {
  it("has 7, 14, 21... taps a ring, all inside the unit disc", () => {
    for (const rings of [2, 3, 4]) {
      const taps = bokehKernel(rings);
      expect(taps).toHaveLength((7 * rings * (rings + 1)) / 2);
      for (const tap of taps) {
        expect(Math.hypot(tap.x, tap.y)).toBeCloseTo(tap.reach, 10);
        expect(tap.reach).toBeLessThan(1);
      }
    }
  });

  it("gives every tap the same share of the disc", () => {
    // A ring `n` spacings out with 7n taps: each tap stands for 2/7 of a
    // spacing squared (in units of pi), and with the centre's quarter the
    // taps add up to the unit disc.
    for (const rings of [2, 3, 4]) {
      const spacing = 1 / (rings + 0.5);
      const taps = bokehKernel(rings);
      const perRing = new Map<number, number>();
      for (const tap of taps) {
        const ring = Math.round(tap.reach / spacing);
        perRing.set(ring, (perRing.get(ring) ?? 0) + 1);
      }
      for (const [ring, count] of perRing) expect(count).toBe(7 * ring);
      const area = (taps.length * 2 * spacing ** 2) / 7 + spacing ** 2 / 4;
      expect(area).toBeCloseTo(1, 10);
    }
  });
});

describe("blurDivisor", () => {
  it("halves the frame at the least, and more to stay under the row cap", () => {
    expect(blurDivisor(720, 540)).toBe(2);
    expect(blurDivisor(1080, 540)).toBe(2);
    expect(blurDivisor(1440, 540)).toBe(3);
    expect(blurDivisor(2160, 540)).toBe(4);
    expect(blurDivisor(200, 540)).toBe(2);
  });
});

describe("easeShare", () => {
  it("closes two thirds of the way in its time, whatever the frame time", () => {
    expect(easeShare(0.45, 0.45)).toBeCloseTo(1 - 1 / Math.E, 12);
    // Sixty small steps land where one large one does.
    const step = easeShare(0.45 / 60, 0.45);
    expect(1 - (1 - step) ** 60).toBeCloseTo(easeShare(0.45, 0.45), 12);
  });

  it("never overshoots, and stands still when no time passes", () => {
    for (const delta of [0.001, 0.016, 0.1, 5]) {
      const share = easeShare(delta, 0.16);
      expect(share).toBeGreaterThan(0);
      expect(share).toBeLessThan(1);
    }
    expect(easeShare(0, 0.16)).toBe(0);
    expect(easeShare(-1, 0.16)).toBe(0);
    expect(easeShare(0.016, 0)).toBe(1);
  });
});

describe("blurShare", () => {
  const share = (defocus: number, sharpZone = 0.35) =>
    blurShare(defocus, 0.04, sharpZone, PROJECTION_SCALE);

  it("is the thin lens's blur well out of focus: half the aperture a dioptre", () => {
    // 10 dioptres out, the sharp zone is nothing: 0.02 rad a dioptre, over
    // a frame 2 * tan(35 degrees) tall.
    const perDioptre = (0.04 / 2) * (PROJECTION_SCALE / 2);
    expect(share(10, 0) / 10).toBeCloseTo(perDioptre, 12);
    expect(share(10) / 10).toBeGreaterThan(perDioptre * 0.96);
  });

  it("comes in from nothing with no edge to where it starts", () => {
    expect(share(0)).toBe(0);
    // Flat at the focal plane: a tenth of the sharp zone out, a hundredth
    // of what a plain lens would show.
    expect(share(0.035) / share(0.035, 0)).toBeLessThan(0.06);
    // And the same either side of it.
    expect(share(-0.8)).toBe(share(0.8));
    let last = 0;
    for (let defocus = 0.05; defocus < 3; defocus += 0.05) {
      const now = share(defocus);
      expect(now).toBeGreaterThan(last);
      last = now;
    }
  });

  it("leaves the distance sharp behind a focus a few units out", () => {
    // Focused five units away, the horizon is a fifth of a dioptre off:
    // under a tenth of a percent of the frame's height, a pixel at 1080p.
    expect(share(1 / 5)).toBeLessThan(0.001);
    // Three units away, two pixels: the first softness the eye can find.
    expect(share(1 / 3)).toBeLessThan(0.002);
    // Focused on something at arm's length, it is clearly soft.
    expect(share(1 / 0.9)).toBeGreaterThan(0.01);
  });

  it("grows with a narrower view, as through a lens", () => {
    const wide = blurShare(1, 0.04, 0.35, 1 / Math.tan((100 * Math.PI) / 360));
    const narrow = blurShare(1, 0.04, 0.35, 1 / Math.tan((40 * Math.PI) / 360));
    expect(narrow / wide).toBeCloseTo(
      Math.tan((100 * Math.PI) / 360) / Math.tan((40 * Math.PI) / 360),
      12,
    );
  });
});

describe("DepthOfFieldPass", () => {
  it("draws the focus, the three blur stages and the combine, in order", () => {
    const { renderer, pass, input, context, composer, draws } = frame();
    const output = (composer as unknown as { buffers: RenderTarget[] })
      .buffers[0];
    expect(pass.render(renderer, input, output, context)).toBe(true);
    expect(draws).toEqual([
      { material: "DepthOfField.focus", target: "DepthOfField.focus1" },
      {
        material: "DepthOfField.prefilter",
        target: "DepthOfField.prefiltered",
      },
      { material: "DepthOfField.tiles", target: "DepthOfField.tiles" },
      { material: "DepthOfField.gather", target: "DepthOfField.gathered" },
      { material: "DepthOfField.combine", target: "EffectComposer.buffer0" },
    ]);
  });

  it("writes the focus into the texel it did not read, turn about", () => {
    const { renderer, pass, input, context, draws } = frame();
    pass.render(renderer, input, null, context);
    pass.render(renderer, input, null, context);
    const focus = draws.filter(
      (draw) => draw.material === "DepthOfField.focus",
    );
    expect(focus.map((draw) => draw.target)).toEqual([
      "DepthOfField.focus1",
      "DepthOfField.focus0",
    ]);
  });

  it("encodes for the screen when it is the last pass", () => {
    const { renderer, pass, input, context, draws } = frame();
    expect(pass.render(renderer, input, null, context)).toBe(true);
    expect(draws.at(-1)).toEqual({
      material: "DepthOfField.combine → screen",
      target: "screen",
    });
  });

  it("says so, and draws nothing over the frame, when a stage was left out", () => {
    // A blur buffer nobody wrote, laid over the frame, is an empty frame.
    for (const stage of ["focus", "prefilter", "tiles", "gather"]) {
      const { renderer, pass, input, context, draws } = frame(
        new Set([`DepthOfField.${stage}`]),
      );
      expect(pass.render(renderer, input, null, context)).toBe(false);
      expect(
        draws.some((draw) => draw.material.startsWith("DepthOfField.combine")),
      ).toBe(false);
    }
    const { renderer, pass, input, context } = frame(
      new Set(["DepthOfField.combine → screen"]),
    );
    expect(pass.render(renderer, input, null, context)).toBe(false);
  });

  it("is passed over by the composer for the frames a stage is left out", () => {
    const leftOut = new Set(["DepthOfField.gather"]);
    const { renderer } = fakeRenderer(leftOut);
    const composer = new EffectComposer(renderer);
    composer.addPass(new ScenePass(() => {}));
    composer.addPass(new DepthOfFieldPass(camera));
    const last = composer.addPass(new Probe("last")) as Probe;
    composer.setSize(1280, 720);
    composer.render(1 / 60);
    expect(last.reads).toEqual(["EffectComposer.scene"]);
    leftOut.clear();
    composer.render(1 / 60);
    expect(last.reads[1]).toBe("EffectComposer.buffer0");
  });

  it("leaves the frame alone, with one warning, when there is no depth", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { renderer, pass, input, draws } = frame();
      const context = { depth: null, delta: 0 };
      expect(pass.render(renderer, input, null, context)).toBe(false);
      expect(pass.render(renderer, input, null, context)).toBe(false);
      expect(draws).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("says so once when no frame time ever reaches it", () => {
    // A composer rendered without its delta has a focus that never moves.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { renderer, pass, input, context } = frame();
      const still = { ...context, delta: 0 };
      // A capture draws a frame again, with no time passing: not a fault.
      for (let i = 0; i < 119; i++) pass.render(renderer, input, null, still);
      pass.render(renderer, input, null, context);
      for (let i = 0; i < 119; i++) pass.render(renderer, input, null, still);
      expect(warn).not.toHaveBeenCalled();
      for (let i = 0; i < 300; i++) pass.render(renderer, input, null, still);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("composer.render(delta)");
    } finally {
      warn.mockRestore();
    }
  });

  it("sizes its blur buffers by the row cap", () => {
    const pass = new DepthOfFieldPass(camera);
    pass.setSize(1920, 1080);
    expect(pass.blurSize).toEqual({ width: 960, height: 540, divisor: 2 });
    pass.setSize(3840, 2160);
    expect(pass.blurSize).toEqual({ width: 960, height: 540, divisor: 4 });
    pass.setSize(1280, 720);
    expect(pass.blurSize).toEqual({ width: 640, height: 360, divisor: 2 });
    const small = new DepthOfFieldPass(camera, { maxBlurRows: 360 });
    small.setSize(1920, 1080);
    expect(small.blurSize).toEqual({ width: 640, height: 360, divisor: 3 });
  });

  it("counts the kernel's taps, the centre included", () => {
    expect(new DepthOfFieldPass(camera, { rings: 2 }).tapCount).toBe(22);
    expect(new DepthOfFieldPass(camera).tapCount).toBe(43);
    expect(new DepthOfFieldPass(camera, { rings: 4 }).tapCount).toBe(71);
  });

  it("refuses a kernel it cannot build, naming the value", () => {
    expect(
      () => new DepthOfFieldPass(camera, { rings: 5 as unknown as 4 }),
    ).toThrow("2, 3 or 4 rings, not 5");
  });

  it("has no focus to read until it has drawn, or after a reset", async () => {
    const { renderer, pass, input, context } = frame();
    expect(await pass.readFocus(renderer)).toBeNull();
    pass.render(renderer, input, null, context);
    pass.resetFocus();
    expect(await pass.readFocus(renderer)).toBeNull();
  });

  it("keeps its defaults out of reach of one pass's settings", () => {
    const pass = new DepthOfFieldPass(camera, { strength: 0.5 });
    pass.options.sharpZone = 1;
    expect(pass.options.strength).toBe(0.5);
    expect(DEFAULT_DEPTH_OF_FIELD.strength).toBe(1);
    expect(DEFAULT_DEPTH_OF_FIELD.sharpZone).toBe(0.35);
  });
});
