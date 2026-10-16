import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  DoubleSide,
  Mesh,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Vector2,
  type WebGLRenderer,
} from "three";
import { describe, expect, it } from "vitest";

import { TRANSPARENT_OVER_FLUID_RENDER_ORDER } from "../../common";

import {
  SHADER_LIGHTING_CHUNK_SHADERS,
  SHADER_LIGHTING_FLUID_CHUNK_SHADERS,
  SHADER_LIGHTING_SEE_THROUGH_CHUNK_SHADERS,
  WATER_DEPTH_DRAWN,
  WATER_DEPTH_DRY,
  WATER_DEPTH_SIDE_BEHIND,
  WATER_DEPTH_SIDE_FRONT,
  WATER_DEPTH_SIDE_OFF,
  WATER_DEPTH_UNKNOWN,
} from "./shaders";
import {
  holdsPaneFaces,
  paneDrawCounts,
  sectionsAround,
  WaterDepthPass,
  type WaterDepthUniforms,
} from "./water-depth";

const SECTION = { width: 32, height: 64 };

const uniforms = (): WaterDepthUniforms => ({
  waterDepth: { value: null },
  waterDepthState: { value: WATER_DEPTH_UNKNOWN },
  waterDepthViewport: { value: new Vector2(1, 1) },
  waterDepthClip: { value: new Vector2(0.1, 1000) },
  waterExitDepth: { value: null },
  waterExitReady: { value: 0 },
});

const chunkMaterial = (vertexShader = "void main() {}") => {
  const material = new ShaderMaterial({
    vertexShader,
    uniforms: {
      uWaterDepthSide: { value: WATER_DEPTH_SIDE_OFF },
      uTime: { value: 0 },
    },
  });
  (material as unknown as { map: null }).map = null;
  return material;
};

/** A section mesh the way chunk meshes stand: at its section's corner. */
const sectionMesh = (scene: Scene, cx: number, level: number, cz: number) => {
  const geometry = new BoxGeometry(SECTION.width, 8, SECTION.width);
  geometry.translate(SECTION.width / 2, 4, SECTION.width / 2);
  const mesh = new Mesh(geometry, chunkMaterial());
  mesh.position.set(
    cx * SECTION.width,
    level * SECTION.height,
    cz * SECTION.width,
  );
  scene.add(mesh);
  mesh.updateMatrixWorld(true);
  return mesh;
};

const passOver = (state = uniforms()) =>
  new WaterDepthPass(state, (mesh) => [
    Math.round(mesh.position.x / SECTION.width),
    Math.round(mesh.position.y / SECTION.height),
    Math.round(mesh.position.z / SECTION.width),
  ]);

const FLUID_BIT = 1 << 18;
const FLUID_PANE_BIT = 1 << 19;

/** Gives every vertex of `mesh` the packed light `light`. */
const lit = (mesh: Mesh, light: number) => {
  const count = mesh.geometry.getAttribute("position").count;
  mesh.geometry.setAttribute(
    "light",
    new BufferAttribute(new Int32Array(count).fill(light), 1),
  );
  return mesh;
};

/**
 * Just what the pass asks of a renderer, counting the renders it makes and
 * the faces each one drew of the stand-ins it showed.
 */
const fakeRenderer = () => {
  const renderer = {
    renders: 0,
    sides: [] as number[][],
    autoClear: true,
    info: { render: { frame: 0 } },
    state: { buffers: { depth: { setMask: () => {} } } },
    getRenderTarget: () => null,
    setRenderTarget: () => {},
    clear: () => {},
    getDrawingBufferSize: (target: Vector2) => target.set(64, 32),
    render: (scene: Scene) => {
      renderer.renders++;
      renderer.info.render.frame++;
      renderer.sides.push(
        scene.children
          .filter((child) => child.visible)
          .map((child) => ((child as Mesh).material as ShaderMaterial).side),
      );
    },
  };
  return renderer;
};

const cameraOver = (x: number, y: number, z: number) => {
  const camera = new PerspectiveCamera(70, 2, 0.1, 500);
  camera.position.set(x, y, z);
  camera.lookAt(x, 0, z + 1);
  camera.updateMatrixWorld(true);
  return camera;
};

describe("the see-through shader's side of the water", () => {
  it("drops the other side's fragments before any shading, in see-through materials only", () => {
    const seeThrough = SHADER_LIGHTING_SEE_THROUGH_CHUNK_SHADERS.fragment;
    const sideTest = seeThrough.indexOf("if (uWaterDepthSide >");
    expect(sideTest).toBeGreaterThan(-1);
    expect(sideTest).toBeLessThan(seeThrough.indexOf("if (uFarSeam > 0.0"));
    expect(seeThrough).toContain("uniform sampler2D uWaterDepth;");
    for (const fragment of [
      SHADER_LIGHTING_CHUNK_SHADERS.fragment,
      SHADER_LIGHTING_FLUID_CHUNK_SHADERS.fragment,
    ]) {
      expect(fragment).not.toContain("uWaterDepthSide");
    }
  });
});

describe("WaterDepthPass", () => {
  it("gives a pane the fork that keeps what is behind the water, and a lifted child that keeps the rest", () => {
    const scene = new Scene();
    const pass = passOver();
    const pane = sectionMesh(scene, 0, 1, 0);
    const original = pane.material as ShaderMaterial;
    const lifted = pass.addPane(pane);

    const behind = pane.material as ShaderMaterial;
    const front = lifted.material as ShaderMaterial;
    expect(behind).not.toBe(original);
    expect(behind.uniforms.uWaterDepthSide.value).toBe(WATER_DEPTH_SIDE_BEHIND);
    expect(front.uniforms.uWaterDepthSide.value).toBe(WATER_DEPTH_SIDE_FRONT);
    expect(original.uniforms.uWaterDepthSide.value).toBe(WATER_DEPTH_SIDE_OFF);
    // Everything else stays the original's, uniform object for object.
    expect(behind.uniforms.uTime).toBe(original.uniforms.uTime);
    expect(front.uniforms.uTime).toBe(original.uniforms.uTime);
    expect(lifted.parent).toBe(pane);
    expect(lifted.renderOrder).toBe(TRANSPARENT_OVER_FLUID_RENDER_ORDER);
    expect(lifted.geometry.index).toBe(pane.geometry.index);

    // A second pane of the same block shares the two forks.
    const other = sectionMesh(scene, 1, 1, 0);
    other.material = original;
    const otherLifted = pass.addPane(other);
    expect(other.material).toBe(behind);
    expect(otherLifted.material).toBe(front);
  });

  it("draws no depth while no water is near a pane in view, and puts every pane in front", () => {
    const scene = new Scene();
    const state = uniforms();
    const pass = passOver(state);
    const pane = sectionMesh(scene, 0, 1, 0);
    const lifted = pass.addPane(pane);
    pass.addWater(sectionMesh(scene, 3, 1, 0));
    const renderer = fakeRenderer();
    const camera = cameraOver(16, 100, -20);

    pass.render(renderer as unknown as WebGLRenderer, camera);
    expect(state.waterDepthState.value).toBe(WATER_DEPTH_DRY);
    expect(renderer.renders).toBe(0);

    pass.prepareDraw(
      renderer as unknown as WebGLRenderer,
      camera,
      pane,
      lifted,
    );
    expect(pane.geometry.drawRange.count).toBe(0);
    expect(lifted.geometry.drawRange.count).toBe(Infinity);
  });

  it("draws the depth of the water beside a pane in view, and both of the pane's draws", () => {
    const scene = new Scene();
    const state = uniforms();
    const pass = passOver(state);
    const pane = sectionMesh(scene, 0, 1, 0);
    const lifted = pass.addPane(pane);
    pass.addWater(sectionMesh(scene, 1, 1, 0));
    const renderer = fakeRenderer();
    const camera = cameraOver(16, 100, -20);

    pass.render(renderer as unknown as WebGLRenderer, camera);
    expect(state.waterDepthState.value).toBe(WATER_DEPTH_DRAWN);
    expect(renderer.renders).toBe(1);
    expect(state.waterDepth.value).not.toBeNull();
    expect(state.waterDepthClip.value.toArray()).toEqual([0.1, 500]);

    pass.prepareDraw(
      renderer as unknown as WebGLRenderer,
      camera,
      pane,
      lifted,
    );
    expect(pane.geometry.drawRange.count).toBe(Infinity);
    expect(lifted.geometry.drawRange.count).toBe(Infinity);
    expect(state.waterDepthViewport.value.toArray()).toEqual([64, 32]);
  });

  it("puts every pane before the water for a camera the depth was not drawn for", () => {
    const scene = new Scene();
    const state = uniforms();
    const pass = passOver(state);
    const pane = sectionMesh(scene, 0, 1, 0);
    const lifted = pass.addPane(pane);
    pass.addWater(sectionMesh(scene, 0, 1, 1));
    const renderer = fakeRenderer();
    const camera = cameraOver(16, 100, -20);
    pass.render(renderer as unknown as WebGLRenderer, camera);

    const other = cameraOver(16, 100, -20);
    pass.prepareDraw(renderer as unknown as WebGLRenderer, other, pane, lifted);
    expect(state.waterDepthState.value).toBe(WATER_DEPTH_UNKNOWN);
    expect(pane.geometry.drawRange.count).toBe(Infinity);
    expect(lifted.geometry.drawRange.count).toBe(0);
  });

  it("forgets a water mesh and a pane once their geometry is gone", () => {
    const scene = new Scene();
    const state = uniforms();
    const pass = passOver(state);
    const pane = sectionMesh(scene, 0, 1, 0);
    pass.addPane(pane);
    const water = sectionMesh(scene, 1, 1, 0);
    pass.addWater(water);
    water.geometry.dispose();
    const renderer = fakeRenderer();
    pass.render(renderer as unknown as WebGLRenderer, cameraOver(16, 100, -20));
    expect(state.waterDepthState.value).toBe(WATER_DEPTH_DRY);

    pane.geometry.dispose();
    pass.render(renderer as unknown as WebGLRenderer, cameraOver(16, 100, -20));
    expect(state.waterDepthState.value).toBe(WATER_DEPTH_DRY);
    expect(renderer.renders).toBe(0);
  });
});

describe("where the water held by a window ends", () => {
  it("tells a water mesh with a face against a window by its packed light", () => {
    const scene = new Scene();
    expect(
      holdsPaneFaces(
        lit(sectionMesh(scene, 0, 0, 0), FLUID_BIT | FLUID_PANE_BIT).geometry,
      ),
    ).toBe(true);
    // Open water, and the greedy flag that shares the pane's bit on solids.
    expect(
      holdsPaneFaces(lit(sectionMesh(scene, 0, 0, 0), FLUID_BIT).geometry),
    ).toBe(false);
    expect(
      holdsPaneFaces(lit(sectionMesh(scene, 0, 0, 0), FLUID_PANE_BIT).geometry),
    ).toBe(false);
    expect(holdsPaneFaces(sectionMesh(scene, 0, 0, 0).geometry)).toBe(false);
  });

  it("draws the back faces of the water around a window after the nearest water", () => {
    const scene = new Scene();
    const state = uniforms();
    const pass = passOver(state);
    pass.addPane(sectionMesh(scene, 0, 1, 0));
    pass.addWater(lit(sectionMesh(scene, 1, 1, 0), FLUID_BIT | FLUID_PANE_BIT));
    // Its neighbour holds the same tank's surface, with no window of its own.
    pass.addWater(lit(sectionMesh(scene, 2, 1, 0), FLUID_BIT));
    const renderer = fakeRenderer();

    pass.render(renderer as unknown as WebGLRenderer, cameraOver(16, 100, -20));
    expect(renderer.renders).toBe(2);
    // The nearest water is the water by the glass pane; the exit is every
    // section around the window's water, the surface next door included.
    expect(renderer.sides[0]).toEqual([DoubleSide]);
    expect(renderer.sides[1]).toEqual([BackSide, BackSide]);
    expect(state.waterExitReady.value).toBe(1);
    expect(state.waterExitDepth.value).not.toBeNull();
    expect(state.waterExitDepth.value).not.toBe(state.waterDepth.value);

    // The stand-ins are back to the nearest-water draw for the next frame.
    pass.render(renderer as unknown as WebGLRenderer, cameraOver(16, 100, -20));
    expect(renderer.sides[2]).toEqual([DoubleSide]);
  });

  it("draws no exit for water without a window, or once the window's water is gone", () => {
    const scene = new Scene();
    const state = uniforms();
    const pass = passOver(state);
    pass.addPane(sectionMesh(scene, 0, 1, 0));
    pass.addWater(lit(sectionMesh(scene, 1, 1, 0), FLUID_BIT));
    const windowed = lit(
      sectionMesh(scene, 0, 1, 1),
      FLUID_BIT | FLUID_PANE_BIT,
    );
    pass.addWater(windowed);
    const renderer = fakeRenderer();
    const camera = cameraOver(16, 100, -20);
    pass.render(renderer as unknown as WebGLRenderer, camera);
    expect(state.waterExitReady.value).toBe(1);

    windowed.geometry.dispose();
    renderer.renders = 0;
    pass.render(renderer as unknown as WebGLRenderer, camera);
    expect(renderer.renders).toBe(1);
    expect(state.waterDepthState.value).toBe(WATER_DEPTH_DRAWN);
    expect(state.waterExitReady.value).toBe(0);
  });

  it("forgets the exit for a camera it was not drawn for", () => {
    const scene = new Scene();
    const state = uniforms();
    const pass = passOver(state);
    const pane = sectionMesh(scene, 0, 1, 0);
    const lifted = pass.addPane(pane);
    pass.addWater(lit(sectionMesh(scene, 1, 1, 0), FLUID_BIT | FLUID_PANE_BIT));
    const renderer = fakeRenderer();
    pass.render(renderer as unknown as WebGLRenderer, cameraOver(16, 100, -20));
    expect(state.waterExitReady.value).toBe(1);

    pass.prepareDraw(
      renderer as unknown as WebGLRenderer,
      cameraOver(16, 100, -20),
      pane,
      lifted,
    );
    expect(state.waterExitReady.value).toBe(0);
  });
});

describe("paneDrawCounts", () => {
  it("keeps every fragment on one side until the depth is drawn", () => {
    expect(paneDrawCounts(WATER_DEPTH_UNKNOWN)).toEqual({
      pane: Infinity,
      lifted: 0,
    });
    expect(paneDrawCounts(WATER_DEPTH_DRY)).toEqual({
      pane: 0,
      lifted: Infinity,
    });
    expect(paneDrawCounts(WATER_DEPTH_DRAWN)).toEqual({
      pane: Infinity,
      lifted: Infinity,
    });
  });
});

describe("sectionsAround", () => {
  it("is a pane's own section and the 26 around it", () => {
    const keys = sectionsAround([2, 1, -3]);
    expect(keys).toHaveLength(27);
    expect(new Set(keys).size).toBe(27);
    expect(keys).toContain("2,1,-3");
    expect(keys).toContain("1,0,-4");
    expect(keys).toContain("3,2,-2");
    expect(keys).not.toContain("4,1,-3");
  });
});
