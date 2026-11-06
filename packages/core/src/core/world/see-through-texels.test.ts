import {
  BoxGeometry,
  DataTexture,
  type Material,
  Mesh,
  MeshBasicNodeMaterial,
  RGBAFormat,
  UnsignedByteType,
} from "three/webgpu";
import { describe, expect, it } from "vitest";

import { ChunkMaterial, type ChunkShadingInputs } from "./shading/chunk-material";

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

// Shading inputs are only read when a program builds.
const shading = { id: 1 } as unknown as ChunkShadingInputs;

const chunkLike = () => {
  const material = new ChunkMaterial(shading, { kind: "seeThrough" });
  material.transparent = true;
  material.depthWrite = false;
  material.alphaTest = 0.1;
  return material;
};

const forkKeepingUniforms = (material: Material) =>
  material instanceof ChunkMaterial ? material.fork() : material.clone();

describe("SeeThroughTexelSplit", () => {
  it("forks a solid draw with depth and a translucent one without", () => {
    const split = new SeeThroughTexelSplit(CUTS, forkKeepingUniforms);
    const base = chunkLike();
    const { solid, translucent } = split.forksOf(base);
    expect(split.forksOf(base).solid).toBe(solid);

    expect(solid.depthWrite).toBe(true);
    expect(solid.alphaTest).toBe(0.99);
    expect(base.alphaTest).toBe(0.1);
    // The forks read the base's world inputs: the same live uniforms.
    expect((solid as ChunkMaterial).shading).toBe(base.shading);
    expect((solid as ChunkMaterial).cutsSolidTexels).toBe(false);

    expect(translucent.depthWrite).toBe(false);
    const cut = translucent as ChunkMaterial;
    expect(cut.cutsSolidTexels).toBe(true);
    expect(cut.solidTexelCut).toBe(0.99);
    expect(base.cutsSolidTexels).toBe(false);
    // The cut is its own program.
    expect(cut.customProgramCacheKey()).toContain(":cut");
    expect(base.customProgramCacheKey()).not.toContain(":cut");
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

    const cutout = new MeshBasicNodeMaterial({ transparent: true });
    const copy = new Mesh(new BoxGeometry(), cutout);
    split.apply(copy, cutout, "translucent");
    expect((copy.material as Material).depthWrite).toBe(false);
  });

  it("draws a GPU bucket's split from the bucket's own culled geometry", () => {
    const split = new SeeThroughTexelSplit(CUTS, forkKeepingUniforms);
    const base = chunkLike();
    const mesh = new Mesh(new BoxGeometry(), base);
    const culls: unknown[] = [];
    const bucket = { mesh, cullFor: (_r: unknown, camera: unknown) => culls.push(camera) };
    mesh.userData.gpuTerrain = bucket;

    const layer = split.apply(mesh, base, "split")!;
    expect(layer.geometry).toBe(mesh.geometry);
    expect(layer.userData.gpuTerrain).toBe(bucket);
    // Before its draw it culls for the pass and follows a grown geometry.
    const grown = new BoxGeometry();
    mesh.geometry = grown;
    const camera = {};
    layer.onBeforeRender({} as never, {} as never, camera as never, layer.geometry, layer.material as Material, null as never);
    expect(culls).toEqual([camera]);
    expect(layer.geometry).toBe(grown);
  });

  it("forgets a material's forks once its shader changed", () => {
    const split = new SeeThroughTexelSplit(CUTS, forkKeepingUniforms);
    const base = chunkLike();
    const before = split.forksOf(base);
    split.forget(base);
    expect(split.forksOf(base).solid).not.toBe(before.solid);
  });

  it("only cuts a chunk material, which carries the cut", () => {
    expect(canCutSolidTexels(chunkLike())).toBe(true);
    expect(canCutSolidTexels(new MeshBasicNodeMaterial())).toBe(false);
  });
});
