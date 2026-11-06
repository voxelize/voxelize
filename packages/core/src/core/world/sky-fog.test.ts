import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createSkyGlowUniforms, Sky, skyGlowInputsOf } from "./sky";
import { ownUniform } from "./shading/uniforms";

// The fog and dome shading are TSL graphs; their compiled shape is checked
// by the browser shading probe. What stays here is the plumbing: one set of
// glow uniforms for the dome and every fog, veiled by the weather's beam.

describe("the sun through the window under a veiled sky", () => {
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

  it("starts clear: a host without weather keeps the disc it always had", () => {
    const sky = new Sky();
    expect(sky.uDirectSunlight.value).toBe(1);
  });

  it("is one set of uniform objects for the dome and the world's fog", () => {
    const glow = createSkyGlowUniforms();
    const sky = new Sky({}, glow);
    expect(sky.glow).toBe(glow);
    // Black by default: a host that paints no glow keeps the sky it had.
    expect(glow.color.value.getHex()).toBe(0);
    expect(glow.sunHaloColor.value.getHex()).toBe(0);
    expect(glow.moonHaloColor.value.getHex()).toBe(0);
    expect(glow.sunDiscColor.value.getHex()).toBe(0);
    expect(glow.moonDiscColor.value.getHex()).toBe(0);
  });

  it("hands the fog the very nodes the dome reads, gated by the beam", () => {
    const glow = createSkyGlowUniforms();
    const beam = ownUniform(1);
    const inputs = skyGlowInputsOf(glow, beam) as unknown as Record<
      string,
      unknown
    >;
    expect(inputs.skyGlowSunDirection).toBe(glow.sunDirection);
    expect(inputs.skyGlowColor).toBe(glow.color);
    expect(inputs.skySunHaloColor).toBe(glow.sunHaloColor);
    expect(inputs.skyMoonHaloColor).toBe(glow.moonHaloColor);
    expect(inputs.skySunDiscColor).toBe(glow.sunDiscColor);
    expect(inputs.skyMoonDiscColor).toBe(glow.moonDiscColor);
    expect(inputs.skyDiscRadii).toBe(glow.discRadii);
    expect(inputs.directSunlight).toBe(beam);
  });
});
