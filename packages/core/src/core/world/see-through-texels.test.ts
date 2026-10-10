import {
  BoxGeometry,
  DataTexture,
  type Material,
  Mesh,
  MeshBasicMaterial,
  RGBAFormat,
  ShaderLib,
  ShaderMaterial,
  UnsignedByteType,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";
import { describe, expect, it } from "vitest";

import {
  canCutSolidTexels,
  classifyTexels,
  SeeThroughTexelSplit,
  texelPlanOf,
  textureTexelClasses,
} from "./see-through-texels";

const CUTS = { hole: 0.1, solid: 0.99 };

const pixels = (...alphas: number[]) =>
  Uint8ClampedArray.from(alphas.flatMap((alpha) => [255, 255, 255, alpha]));

describe("classifyTexels", () => {
  it("sorts texels into holes, tints and solids by alpha", () => {
    expect(classifyTexels(pixels(0, 25), CUTS)).toEqual({
      solid: false,
      translucent: false,
    });
    expect(classifyTexels(pixels(0, 26, 150), CUTS)).toEqual({
      solid: false,
      translucent: true,
    });
    expect(classifyTexels(pixels(0, 253, 255), CUTS)).toEqual({
      solid: true,
      translucent: false,
    });
    expect(classifyTexels(pixels(150, 255), CUTS)).toEqual({
      solid: true,
      translucent: true,
    });
  });

  it("reads an RGBA8 data texture, and takes anything else to hold both", () => {
    const texture = new DataTexture(pixels(0, 255), 2, 1);
    texture.format = RGBAFormat;
    texture.type = UnsignedByteType;
    texture.needsUpdate = true;
    expect(textureTexelClasses(texture, CUTS)).toEqual({
      solid: true,
      translucent: false,
    });
    expect(textureTexelClasses(null, CUTS)).toEqual({
      solid: true,
      translucent: true,
    });
  });
});

describe("texelPlanOf", () => {
  const cutout = { depthWrite: true };
  const pane = { depthWrite: false };
  const both = { solid: true, translucent: true };
  const solid = { solid: true, translucent: false };
  const tint = { solid: false, translucent: true };

  it("keeps a cutout whose kept texels are all solid as it is", () => {
    expect(texelPlanOf(cutout, solid, true)).toBe("as-is");
    expect(texelPlanOf(cutout, both, true)).toBe("split");
    expect(texelPlanOf(cutout, tint, true)).toBe("translucent");
    expect(texelPlanOf(cutout, both, false)).toBe("as-is");
  });

  it("keeps a pane whose kept texels all tint as it is", () => {
    expect(texelPlanOf(pane, tint, true)).toBe("as-is");
    expect(texelPlanOf(pane, both, true)).toBe("split");
    expect(texelPlanOf(pane, solid, true)).toBe("solid");
    expect(texelPlanOf(pane, solid, false)).toBe("solid");
    expect(texelPlanOf(pane, both, false)).toBe("as-is");
  });
});

const chunkLike = () =>
  new ShaderMaterial({
    vertexShader: ShaderLib.basic.vertexShader,
    fragmentShader: ShaderLib.basic.fragmentShader,
    uniforms: { alphaTest: { value: 0.1 }, shared: { value: 1 } },
    transparent: true,
    depthWrite: false,
    alphaTest: 0.1,
  });

const forkKeepingUniforms = (material: Material) => {
  const fork = material.clone();
  if ((material as ShaderMaterial).isShaderMaterial) {
    (fork as ShaderMaterial).uniforms = {
      ...(material as ShaderMaterial).uniforms,
    };
  }
  return fork;
};

describe("SeeThroughTexelSplit", () => {
  it("forks a solid draw with depth and a translucent one without", () => {
    const split = new SeeThroughTexelSplit(CUTS, forkKeepingUniforms);
    const base = chunkLike();
    const { solid, translucent } = split.forksOf(base);
    expect(split.forksOf(base).solid).toBe(solid);

    expect(solid.depthWrite).toBe(true);
    expect(solid.alphaTest).toBe(0.99);
    const solidUniforms = (solid as ShaderMaterial).uniforms;
    expect(solidUniforms.alphaTest.value).toBe(0.99);
    expect(base.uniforms.alphaTest.value).toBe(0.1);
    expect(solidUniforms.shared).toBe(base.uniforms.shared);

    expect(translucent.depthWrite).toBe(false);
    expect(translucent.customProgramCacheKey()).toContain(
      "|translucent-texels",
    );
    const shader = {
      fragmentShader: base.fragmentShader,
      vertexShader: base.vertexShader,
      uniforms: {},
    } as unknown as WebGLProgramParametersWithUniforms;
    translucent.onBeforeCompile(shader, {} as WebGLRenderer);
    expect(shader.fragmentShader).toMatch(
      /#include <alphatest_fragment>\nif \(diffuseColor\.a >= uSolidTexelCut\) discard;/,
    );
    expect(shader.uniforms.uSolidTexelCut.value).toBe(0.99);
  });

  it("draws each plan from the mesh's own buffers", () => {
    const split = new SeeThroughTexelSplit(CUTS, forkKeepingUniforms);
    const base = chunkLike();
    const mesh = new Mesh(new BoxGeometry(), base);
    const forks = split.forksOf(base);

    const layer = split.apply(mesh, base, "split");
    expect(mesh.material).toBe(forks.solid);
    expect(layer?.material).toBe(forks.translucent);
    expect(layer?.parent).toBe(mesh);
    expect(layer?.geometry.getAttribute("position")).toBe(
      mesh.geometry.getAttribute("position"),
    );
    expect(layer?.geometry.index).toBe(mesh.geometry.index);
    expect(split.layerOf(mesh)).toBe(layer);

    expect(split.apply(mesh, base, "solid")).toBeNull();
    expect(mesh.material).toBe(forks.solid);
    expect(layer?.visible).toBe(false);

    expect(split.apply(mesh, base, "split")).toBe(layer);
    expect(layer?.visible).toBe(true);

    split.apply(mesh, base, "as-is");
    expect(mesh.material).toBe(base);
    expect(mesh.userData.texelPlan).toBe("as-is");

    const cutout = new MeshBasicMaterial({ transparent: true });
    const copy = new Mesh(new BoxGeometry(), cutout);
    split.apply(copy, cutout, "translucent");
    expect((copy.material as Material).depthWrite).toBe(false);
  });

  it("forgets a material's forks once its shader changed", () => {
    const split = new SeeThroughTexelSplit(CUTS, forkKeepingUniforms);
    const base = chunkLike();
    const before = split.forksOf(base);
    split.forget(base);
    expect(split.forksOf(base).solid).not.toBe(before.solid);
  });

  it("only cuts a shader that has three's alpha test", () => {
    expect(canCutSolidTexels(chunkLike())).toBe(true);
    expect(canCutSolidTexels(new MeshBasicMaterial())).toBe(true);
    expect(
      canCutSolidTexels(
        new ShaderMaterial({ fragmentShader: "void main() {}" }),
      ),
    ).toBe(false);
  });
});
