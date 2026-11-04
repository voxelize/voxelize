import {
  AdditiveBlending,
  BoxGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Scene,
  ShaderMaterial,
} from "three";
import { describe, expect, it } from "vitest";

import {
  auditLightCones,
  exemptFromLightCones,
  injectLightCones,
  markLightConesCovered,
  LIGHT_CONE_SCATTER_STYLE,
  LIGHT_CONES,
  LIGHT_CONES_FUNCTIONS,
  LIGHT_CONES_UNIFORM_DECLARATIONS,
  LightCones,
  styleLightConeScatter,
} from "./light-cones";

const LEGACY = { x: 0, y: 0, z: 0 };
const DEFAULT = {
  x: LIGHT_CONES.scatterTexelsPerBlock,
  y: LIGHT_CONES.scatterBands,
  z: LIGHT_CONES.scatterCeiling,
};
/** The banded look, still available live: four flat levels. */
const VOXEL = { ...DEFAULT, y: 4 };

describe("light cone scatter style", () => {
  it("defaults to snapped and capped, unbanded, and flips back to smooth", () => {
    expect(LIGHT_CONE_SCATTER_STYLE.value.toArray()).toEqual([
      DEFAULT.x,
      0,
      DEFAULT.z,
    ]);
    // Unbanded: a beam's glow ramps smoothly up to the ceiling.
    expect(styleLightConeScatter(0.12, DEFAULT)).toBeCloseTo(0.12, 12);
    expect(styleLightConeScatter(0.9, DEFAULT)).toBeCloseTo(DEFAULT.z, 12);
    for (const scatter of [0, 0.004, 0.05, 0.3, 1.4]) {
      expect(styleLightConeScatter(scatter, LEGACY)).toBe(scatter);
    }
  });

  it("rounds to a few flat levels capped at the ceiling", () => {
    const levels = new Set<number>();
    for (let i = 0; i <= 2000; i++) {
      levels.add(styleLightConeScatter(i / 1000, VOXEL));
    }
    // Zero plus one level per band, the top band being the ceiling.
    expect(levels.size).toBe(VOXEL.y + 1);
    expect(Math.max(...levels)).toBeCloseTo(VOXEL.z, 12);
    // A submerged beam that used to add more than its own colour is held
    // to the ceiling instead of whiting out.
    expect(styleLightConeScatter(1.4, VOXEL)).toBeCloseTo(VOXEL.z, 12);
    // The faintest tail rounds to a clean zero, not a sliver.
    expect(styleLightConeScatter(VOXEL.z / 100, VOXEL)).toBe(0);
    // A dry flashlight's few-percent shaft still lands on a visible step.
    expect(styleLightConeScatter(0.05, VOXEL)).toBeGreaterThan(0.03);
    expect(styleLightConeScatter(0.05, VOXEL)).toBeLessThan(0.1);
  });

  it("caps without banding when only the ceiling is set", () => {
    const capOnly = { x: 0, y: 0, z: 0.3 };
    expect(styleLightConeScatter(0.12, capOnly)).toBeCloseTo(0.12, 12);
    expect(styleLightConeScatter(0.9, capOnly)).toBeCloseTo(0.3, 12);
  });

  it("is one switch every material binding shares", () => {
    const a = new LightCones();
    const b = new LightCones();
    expect(a.uniformBindings.uConeScatterStyle).toBe(LIGHT_CONE_SCATTER_STYLE);
    expect(b.uniformBindings.uConeScatterStyle).toBe(LIGHT_CONE_SCATTER_STYLE);
    expect(a.uniforms.coneScatterStyle).toBe(LIGHT_CONE_SCATTER_STYLE);
  });

  it("declares and uses the style uniform in the shader chunks", () => {
    expect(LIGHT_CONES_UNIFORM_DECLARATIONS).toContain(
      "uniform vec3 uConeScatterStyle;",
    );
    expect(LIGHT_CONES_FUNCTIONS).toContain(
      "floor((lcCam + lcRayDir * lcT) * lcSnap) * lcSnapInv + lcSnapOffset",
    );
    expect(LIGHT_CONES_FUNCTIONS).toContain(
      "lightConeScatterStyled(lcSum * (lcStrength * lcStep), lcSubmersion)",
    );
    // Dry air is never banded or snapped: the style is underwater's.
    expect(LIGHT_CONES_FUNCTIONS).toContain(
      "if (lcSubmersion <= 0.0) return lcScatter;",
    );
    expect(LIGHT_CONES_FUNCTIONS).toContain(
      "lcSubmersion > 0.5 ? uConeScatterStyle.x : 0.0",
    );
    // Samples are spent only on the stretch of the ray inside the cone.
    expect(LIGHT_CONES_FUNCTIONS).toContain(
      "vec2 lcSeg = lightConeSegment(i, lcCam, lcRayDir, lcMax);",
    );
    // The surface term is not styled: only the scattered shaft is.
    const start = LIGHT_CONES_FUNCTIONS.indexOf("vec3 lightConeSurface");
    const surface = LIGHT_CONES_FUNCTIONS.slice(
      start,
      LIGHT_CONES_FUNCTIONS.indexOf("\n}\n", start),
    );
    expect(surface).toContain("lcTotal +=");
    expect(surface).not.toContain("uConeScatterStyle");
  });
});

describe("light cone coverage", () => {
  const builtIn = () => ({
    uniforms: {} as Record<string, unknown>,
    vertexShader: "#include <common>\nvoid main() {\n#include <project_vertex>\n}",
    fragmentShader:
      "#include <common>\nvoid main() {\n#include <color_fragment>\ngl_FragColor = vec4(1.0);\n}",
  });

  it("injects the cones into a built-in shader, the glow last in main", () => {
    const cones = new LightCones();
    const shader = builtIn();
    injectLightCones(shader, cones.uniformBindings);
    expect(shader.uniforms.uConeCount).toBe(cones.uniforms.coneCount);
    expect(shader.vertexShader).toContain("varying vec3 vLightConeWorld;");
    expect(shader.vertexShader.indexOf("vLightConeWorld =")).toBeGreaterThan(
      shader.vertexShader.indexOf("#include <project_vertex>"),
    );
    expect(shader.fragmentShader).toContain("vec3 lightConeLit(vec3 lcLight)");
    const glow = shader.fragmentShader.indexOf("lightConeScatter(cameraPosition");
    expect(glow).toBeGreaterThan(shader.fragmentShader.indexOf("gl_FragColor ="));
    expect(shader.fragmentShader.trimEnd().endsWith("}")).toBe(true);
  });

  it("reports a drawn mesh whose material skips the cones", () => {
    const scene = new Scene();
    const lit = new MeshBasicMaterial();
    const missed = new MeshBasicMaterial({ name: "forgot" });
    const lamp = new MeshBasicMaterial();
    const glow = new MeshBasicMaterial({ blending: AdditiveBlending });
    const chunk = new ShaderMaterial({
      uniforms: { ...new LightCones().uniformBindings },
    });
    markLightConesCovered(lit);
    exemptFromLightCones(lamp, "an emitter");
    for (const material of [lit, missed, lamp, glow, chunk]) {
      scene.add(new Mesh(new BoxGeometry(), material));
    }
    const hidden = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    hidden.visible = false;
    scene.add(hidden);
    const sky = new Group();
    sky.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    exemptFromLightCones(sky, "the sky");
    scene.add(sky);
    const empty = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 4);
    empty.count = 0;
    scene.add(empty);

    const missing = auditLightCones(scene);
    expect(missing.map((entry) => entry.material)).toEqual(["forgot"]);
  });
});
