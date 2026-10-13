import { Mesh, ShaderMaterial } from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import SkyFragmentShader from "../../shaders/sky/fragment.glsl?raw";

import { SHADER_LIGHTING_CHUNK_SHADERS } from "./shaders";
import { composeSkyFragmentShader, createSkyGlowUniforms, Sky } from "./sky";
import {
  createSkyAtmosphereFragment,
  createSkyDiscStatements,
  createSkyGlowStatements,
  SKY_FOG_COMMON_UNIFORM_DECLARATIONS,
  SKY_FOG_FRAGMENT,
  SKY_GLOW_UNIFORM_DECLARATIONS,
} from "./sky-fog";

describe("camera-relative sky sampling", () => {
  it("removes camera translation before sampling the sky gradient", () => {
    expect(SkyFragmentShader).toContain(
      "vec3 skyPosition = vWorldPosition - cameraPosition;",
    );
    expect(SkyFragmentShader).not.toContain(
      "normalize(vWorldPosition + uSkyOffset)",
    );
  });

  it("samples terrain fog along the view ray instead of in world space", () => {
    expect(SKY_FOG_FRAGMENT).toContain(
      "vec3 skyDomePos = fogRay * uSkyFogDimension;",
    );
    expect(SKY_FOG_FRAGMENT).not.toContain(
      "cameraPosition + fogRay * uSkyFogDimension",
    );
  });
});

describe("the sky's glow in the haze", () => {
  it("is the beam's: every fog shader gates it by the weather's direct sunlight", () => {
    expect(SKY_FOG_COMMON_UNIFORM_DECLARATIONS).toContain(
      "uniform float uDirectSunlight;",
    );
    expect(createSkyGlowStatements("ray", "glow")).toMatch(
      /\) \* uDirectSunlight;/,
    );
    for (const fragment of [SKY_FOG_FRAGMENT, createSkyAtmosphereFragment()]) {
      expect(fragment).toContain(createSkyGlowStatements("fogRay", "fogGlow"));
      expect(fragment).toContain(createSkyDiscStatements("fogRay", "fogDiscs"));
      expect(fragment).toContain(
        "fogTint += (fogGlow + fogDiscs) * uSkyFogStrength * (1.0 - uFogVerticalBlend);",
      );
    }
  });

  it("is the same light the dome draws, along the same ray", () => {
    const dome = composeSkyFragmentShader();
    expect(dome).toContain(SKY_GLOW_UNIFORM_DECLARATIONS);
    expect(dome).toContain(
      createSkyGlowStatements("normalize(skyPosition)", "skyGlow"),
    );
    expect(dome).toContain("color += skyGlow;");
    expect(dome).not.toContain("#include <sky_glow>");
  });

  it("centres on the drawn disc, not the tilted shading light", () => {
    const glow = createSkyGlowStatements("ray", "glow");
    expect(glow).toContain("dot(skyGlowRay, uSkyGlowSunDirection)");
    expect(glow).not.toContain("uSunDirection");
  });

  it("carries the discs only in the fog: the host draws them in the sky", () => {
    const discs = createSkyDiscStatements("ray", "discs");
    expect(discs).toContain("uSkySunDiscColor * skyDiscCover.x");
    expect(discs).toContain("uSkyMoonDiscColor * skyDiscCover.y");
    expect(discs).toMatch(/\* skyDiscHorizon \* uDirectSunlight;/);
    expect(composeSkyFragmentShader()).not.toContain("skyDiscCover");
  });

  it("adds nothing to additive effects, which only attenuate", () => {
    expect(
      createSkyAtmosphereFragment(undefined, undefined, true),
    ).not.toContain("fogGlow");
  });

  it("is declared once in the chunk shader, with the fog's uniforms", () => {
    const chunk = SHADER_LIGHTING_CHUNK_SHADERS.fragment;
    expect(chunk.split("uniform float uDirectSunlight;")).toHaveLength(2);
  });
});

describe("the sky from under water", () => {
  it("shows the sky only through the Snell window, refracted, with the in-scatter elsewhere", () => {
    expect(SkyFragmentShader).toContain(
      "vec3 airDir = refract(viewDir, vec3(0.0, -1.0, 0.0), 1.333);",
    );
    expect(SkyFragmentShader).toContain(
      "vec3 inScatter = uUnderwaterAmbient * (1.0 + uUnderwaterInScatterTilt * viewDir.y);",
    );
    expect(SkyFragmentShader).toContain(
      "color = mix(underColor, inScatter, uUnderwaterFade);",
    );
  });

  it("draws the refracted sun as the same glowing disc inside the window", () => {
    expect(SkyFragmentShader).toContain(
      "float sunAngle = sqrt(max(2.0 - 2.0 * sunCos, 0.0));",
    );
    expect(SkyFragmentShader).not.toContain("SNELL_SUN_PIXEL");
    expect(SkyFragmentShader).not.toContain("outsideWindow");
  });
});

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

  it("draws the refracted disc only as bright as the beam the sky lets through", () => {
    expect(SkyFragmentShader).toContain("uniform float uDirectSunlight;");
    expect(SkyFragmentShader).toContain(
      "windowSky += uSunColor * uSunlightIntensity * uDirectSunlight",
    );
    // Bound on the dome, clear by default: a host without weather keeps
    // the disc it always had.
    const sky = new Sky();
    const bound: { value: number }[] = [];
    sky.traverse((object) => {
      const material = (object as Mesh).material;
      if (
        material instanceof ShaderMaterial &&
        material.uniforms.uDirectSunlight
      )
        bound.push(material.uniforms.uDirectSunlight);
    });
    expect(bound).toHaveLength(1);
    expect(bound[0]).toBe(sky.uDirectSunlight);
    expect(sky.uDirectSunlight.value).toBe(1);
  });

  it("is one set of uniform objects for the dome and the world's fog", () => {
    const glow = createSkyGlowUniforms();
    const sky = new Sky({}, glow);
    const dome = sky.children.find(
      (object) =>
        (object as Mesh).material instanceof ShaderMaterial &&
        ((object as Mesh).material as ShaderMaterial).uniforms.uSkyGlowColor,
    ) as Mesh<never, ShaderMaterial>;
    expect(dome.material.uniforms.uSkyGlowColor).toBe(glow.color);
    expect(dome.material.uniforms.uSkyGlowSunDirection).toBe(glow.sunDirection);
    expect(dome.material.uniforms.uSkySunHaloColor).toBe(glow.sunHaloColor);
    expect(dome.material.uniforms.uSkyMoonHaloColor).toBe(glow.moonHaloColor);
    expect(dome.material.uniforms.uSkyDiscRadii).toBe(glow.discRadii);
    // Black by default: a host that paints no glow keeps the sky it had.
    expect(glow.color.value.getHex()).toBe(0);
    expect(glow.sunHaloColor.value.getHex()).toBe(0);
  });
});
