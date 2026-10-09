import { Mesh, ShaderMaterial } from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import SkyFragmentShader from "../../shaders/sky/fragment.glsl?raw";

import { SHADER_LIGHTING_CHUNK_SHADERS } from "./shaders";
import { Sky } from "./sky";
import {
  createSkyAtmosphereFragment,
  SKY_FOG_COMMON_UNIFORM_DECLARATIONS,
  SKY_FOG_FRAGMENT,
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

describe("the sun's halo in the haze", () => {
  it("is the beam's: every fog shader gates it by the weather's direct sunlight", () => {
    expect(SKY_FOG_COMMON_UNIFORM_DECLARATIONS).toContain(
      "uniform float uDirectSunlight;",
    );
    for (const fragment of [SKY_FOG_FRAGMENT, createSkyAtmosphereFragment()]) {
      expect(fragment).toMatch(
        /fogTint \+= uSunColor \* sunAlignment \* uSunlightIntensity \* uDirectSunlight/,
      );
    }
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

  it("draws the refracted sun as a pixel disc inside the window", () => {
    expect(SkyFragmentShader).toContain(
      "floor(vec2(dot(airDir, sunSide), dot(airDir, sunUp)) / SNELL_SUN_PIXEL)",
    );
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
});
