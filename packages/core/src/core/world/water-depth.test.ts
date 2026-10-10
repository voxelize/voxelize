import {
  BoxGeometry,
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

/** Just what the pass asks of a renderer, counting the renders it makes. */
const fakeRenderer = () => {
  const renderer = {
    renders: 0,
    autoClear: true,
    info: { render: { frame: 0 } },
    state: { buffers: { depth: { setMask: () => {} } } },
    getRenderTarget: () => null,
    setRenderTarget: () => {},
    clear: () => {},
    getDrawingBufferSize: (target: Vector2) => target.set(64, 32),
    render: () => {
      renderer.renders++;
      renderer.info.render.frame++;
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
