import { describe, expect, it } from "vitest";

import SkyFragmentShader from "../../shaders/sky/fragment.glsl?raw";

import { SKY_FOG_FRAGMENT } from "./sky-fog";

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
