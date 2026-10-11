import {
  Group,
  Matrix3,
  Matrix4,
  ShaderMaterial,
  Texture,
  Uniform,
  Vector3,
  WebGLRenderTarget,
} from "three";
import { describe, expect, it, vi } from "vitest";

import type { Coords3 } from "../../types";

import {
  type CustomChunkShaderMaterial,
  forkVoxelBoxMaterial,
} from "./chunk-materials";
import { SHADER_LIGHTING_CHUNK_SHADERS } from "./shaders";
import { VoxelBoxTexelFrame, voxelBoxTexelFrame } from "./voxel-box";

const ORIGIN: Coords3 = [37, 4, -12];
/** Where the box hangs from, as a felled tree hangs from its cut. */
const PIVOT = new Vector3(40, 6, -9);

/** The box's group under a hinge at `PIVOT`, posed as a falling tree poses
 * its piece: turned about `axis`, dropped, and (a crown wave crumpling)
 * scaled. */
function boxAt({
  angle,
  axis = new Vector3(0, 0, 1),
  drop = 0,
  scale = 1,
}: {
  angle: number;
  axis?: Vector3;
  drop?: number;
  scale?: number;
}) {
  const hinge = new Group();
  hinge.position.copy(PIVOT).add(new Vector3(0, -drop, 0));
  hinge.quaternion.setFromAxisAngle(axis.clone().normalize(), angle);
  const box = new Group();
  box.position.set(...ORIGIN).sub(PIVOT);
  box.scale.setScalar(scale);
  hinge.add(box);
  hinge.updateMatrixWorld(true);
  return { hinge, box };
}

const POINTS: Vector3[] = [
  new Vector3(0, 0, 0),
  new Vector3(0.25, 0.5, 0.75),
  new Vector3(3.5, 7.125, 1),
  new Vector3(5, 11.0625, 4.9375),
];
const FACES: Vector3[] = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
];

const expectClose = (actual: Vector3, expected: Vector3) => {
  expect(actual.distanceTo(expected)).toBeLessThan(1e-9);
};

describe("a voxel box's texel frame", () => {
  it("is the identity where the box was meshed", () => {
    const { box } = boxAt({ angle: 0 });
    const frame = voxelBoxTexelFrame(ORIGIN, box.matrixWorld, new Matrix4());
    const identity = new Matrix4().elements;
    frame.elements.forEach((value, i) =>
      expect(value).toBeCloseTo(identity[i], 12),
    );
  });

  it("takes every point and face of the box back to where it was meshed, at any pose", () => {
    const poses = [
      { angle: 0.3 },
      // Past 45 degrees, where a face drawn from the world turns its texels.
      { angle: Math.PI / 4 + 0.05 },
      { angle: 1.2, drop: 1.75 },
      { angle: Math.PI / 2, axis: new Vector3(0.6, 0, -0.8), drop: 0.5 },
      { angle: 1.4, drop: 2, scale: 0.35 },
    ];
    for (const pose of poses) {
      const { box } = boxAt(pose);
      const frame = voxelBoxTexelFrame(ORIGIN, box.matrixWorld, new Matrix4());
      const turn = new Matrix3().setFromMatrix4(frame);
      for (const point of POINTS) {
        const world = point.clone().applyMatrix4(box.matrixWorld);
        expectClose(
          world.applyMatrix4(frame),
          point.clone().add(new Vector3(...ORIGIN)),
        );
      }
      for (const face of FACES) {
        const drawn = face.clone().transformDirection(box.matrixWorld);
        expectClose(drawn.applyMatrix3(turn).normalize(), face);
      }
    }
  });

  it("follows the group's matrices as they stand whenever it is read", () => {
    const { hinge, box } = boxAt({ angle: 0 });
    const uniform = new VoxelBoxTexelFrame(ORIGIN, box);
    const point = POINTS[2];
    const meshed = point.clone().add(new Vector3(...ORIGIN));
    expectClose(
      point.clone().applyMatrix4(box.matrixWorld).applyMatrix4(uniform.value),
      meshed,
    );
    hinge.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), 1.1);
    hinge.position.y -= 0.8;
    hinge.updateMatrixWorld(true);
    expectClose(
      point.clone().applyMatrix4(box.matrixWorld).applyMatrix4(uniform.value),
      meshed,
    );
  });
});

describe("a voxel box's materials", () => {
  it("share every live uniform and the atlas with the chunks and turn the frame on", () => {
    const source = new ShaderMaterial({
      fragmentShader: SHADER_LIGHTING_CHUNK_SHADERS.fragment,
      vertexShader: SHADER_LIGHTING_CHUNK_SHADERS.vertex,
      uniforms: {
        uTime: new Uniform(1),
        map: new Uniform(new Texture()),
        uGreedyFrame: new Uniform(new Matrix4()),
        uHasGreedyFrame: new Uniform(0),
      },
    }) as CustomChunkShaderMaterial;
    source.map = source.uniforms.map.value;
    const frame = new VoxelBoxTexelFrame(ORIGIN, new Group());
    const own = forkVoxelBoxMaterial(source, frame);

    expect(own.uniforms.uTime).toBe(source.uniforms.uTime);
    expect(own.uniforms.map).toBe(source.uniforms.map);
    expect(own.map).toBe(source.map);
    expect(own.fragmentShader).toBe(source.fragmentShader);
    expect(own.vertexShader).toBe(source.vertexShader);
    expect(own.uniforms.uGreedyFrame).toBe(frame);
    expect(own.uniforms.uHasGreedyFrame.value).toBe(1);
    expect(source.uniforms.uHasGreedyFrame.value).toBe(0);
  });

  it("are forked without copying the uniforms they share", () => {
    const shadowMap = new WebGLRenderTarget(4, 4).texture;
    const source = new ShaderMaterial({
      uniforms: {
        uShadowMap0: new Uniform(shadowMap),
        map: new Uniform(new Texture()),
      },
    }) as CustomChunkShaderMaterial;
    source.map = source.uniforms.map.value;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const own = forkVoxelBoxMaterial(
        source,
        new VoxelBoxTexelFrame(ORIGIN, new Group()),
      );
      expect(own.uniforms.uShadowMap0).toBe(source.uniforms.uShadowMap0);
      expect(source.uniforms.uShadowMap0.value).toBe(shadowMap);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("read a greedy face's texels through the frame in the chunk shader", () => {
    const fragment = SHADER_LIGHTING_CHUNK_SHADERS.fragment;
    expect(fragment).toContain("uniform mat4 uGreedyFrame;");
    expect(fragment).toContain("uniform float uHasGreedyFrame;");
    expect(fragment).toContain(
      "greedyFaceUv(greedyNormal, fract(greedyPosition))",
    );
    expect(fragment).toContain("greedyFaceUv(greedyNormal, greedyPosition)");
    expect(fragment).not.toMatch(/greedyFaceUv\(vWorldNormal/);
  });
});
