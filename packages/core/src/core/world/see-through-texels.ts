import {
  BufferGeometry,
  type Material,
  Mesh,
  RGBAFormat,
  type ShaderMaterial,
  type Texture,
  UnsignedByteType,
} from "three";

/** Which kinds of texel a see-through surface's textures hold. */
export type TexelClasses = {
  /** Texels at or above the solid alpha: they hide what is behind them. */
  solid: boolean;
  /** Texels between the hole and solid alphas: they tint what is behind. */
  translucent: boolean;
};

/** The two alphas that sort a texel into a hole, a tint or a solid. */
export type TexelAlphaCuts = {
  /** Below this a texel is a hole: the see-through materials' alpha test. */
  hole: number;
  /** At or above this a texel is solid. */
  solid: number;
};

/** What a surface whose pixels cannot be read is taken to hold: both. */
export const UNREADABLE_TEXELS: Readonly<TexelClasses> = {
  solid: true,
  translucent: true,
};

export function classifyTexels(
  pixels: ArrayLike<number>,
  cuts: TexelAlphaCuts,
): TexelClasses {
  const hole = cuts.hole * 255;
  const solid = cuts.solid * 255;
  const classes: TexelClasses = { solid: false, translucent: false };
  for (let index = 3; index < pixels.length; index += 4) {
    const alpha = pixels[index];
    if (alpha >= solid) classes.solid = true;
    else if (alpha >= hole) classes.translucent = true;
    if (classes.solid && classes.translucent) break;
  }
  return classes;
}

export function mergeTexelClasses(into: TexelClasses, from: TexelClasses) {
  into.solid ||= from.solid;
  into.translucent ||= from.translucent;
  return into;
}

let scratch: CanvasRenderingContext2D | null = null;

/**
 * The RGBA8 pixels of an image a texture (or a keyframe) draws from, or null
 * when they cannot be read on the CPU: a video, an image still loading.
 */
export function readImagePixels(image: unknown): Uint8ClampedArray | null {
  if (!image || typeof document === "undefined") return null;
  const isDrawable =
    (typeof HTMLImageElement !== "undefined" &&
      image instanceof HTMLImageElement &&
      image.complete &&
      image.naturalWidth > 0) ||
    (typeof HTMLCanvasElement !== "undefined" &&
      image instanceof HTMLCanvasElement) ||
    (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) ||
    (typeof OffscreenCanvas !== "undefined" &&
      image instanceof OffscreenCanvas);
  if (!isDrawable) return null;
  const source = image as CanvasImageSource & { width: number; height: number };
  const width = Math.max(1, Math.floor(source.width));
  const height = Math.max(1, Math.floor(source.height));
  if (!scratch) {
    scratch = document
      .createElement("canvas")
      .getContext("2d", { willReadFrequently: true });
    if (!scratch) return null;
  }
  const canvas = scratch.canvas;
  if (canvas.width < width) canvas.width = width;
  if (canvas.height < height) canvas.height = height;
  scratch.clearRect(0, 0, width, height);
  scratch.drawImage(source, 0, 0, width, height);
  return scratch.getImageData(0, 0, width, height).data;
}

/** A data texture's bytes when they are RGBA8, else its image's pixels. */
function readTexturePixels(texture: Texture): ArrayLike<number> | null {
  const data = (texture.image as { data?: unknown } | null)?.data;
  if (!data) return readImagePixels(texture.image);
  const isRgba8 =
    texture.format === RGBAFormat && texture.type === UnsignedByteType;
  return isRgba8 &&
    (data instanceof Uint8Array || data instanceof Uint8ClampedArray)
    ? data
    : null;
}

const textureClasses = new WeakMap<
  Texture,
  { version: number; key: string; classes: TexelClasses }
>();

/** {@link classifyTexels} over a whole texture, cached per texture version. */
export function textureTexelClasses(
  texture: Texture | null | undefined,
  cuts: TexelAlphaCuts,
): TexelClasses {
  if (!texture) return { ...UNREADABLE_TEXELS };
  const key = `${cuts.hole}|${cuts.solid}`;
  const cached = textureClasses.get(texture);
  if (cached && cached.version === texture.version && cached.key === key) {
    return { ...cached.classes };
  }
  const pixels = readTexturePixels(texture);
  const classes = pixels
    ? classifyTexels(pixels, cuts)
    : { ...UNREADABLE_TEXELS };
  textureClasses.set(texture, { version: texture.version, key, classes });
  return { ...classes };
}

/**
 * How a see-through mesh draws its texels when blended layers do not depend
 * on draw order:
 * - `as-is`: its material already draws every texel the right way: a cutout
 *   with no translucent texels writes depth for all of them, a blended
 *   surface with no solid ones blends all of them.
 * - `solid`: a blended surface whose texels are all solid draws as a cutout.
 * - `translucent`: a cutout whose kept texels are all translucent blends.
 * - `split`: solid texels draw with depth, translucent ones blend, from the
 *   same buffers in two draws.
 */
export type TexelPlan = "as-is" | "solid" | "translucent" | "split";

export function texelPlanOf(
  material: Pick<Material, "depthWrite">,
  classes: TexelClasses,
  canCut: boolean,
): TexelPlan {
  if (material.depthWrite) {
    if (!classes.translucent || !canCut) return "as-is";
    return classes.solid ? "split" : "translucent";
  }
  if (!classes.solid) return "as-is";
  if (!classes.translucent) return "solid";
  return canCut ? "split" : "as-is";
}

const ALPHA_TEST_FRAGMENT = "#include <alphatest_fragment>";
const SOLID_TEXEL_CUT_UNIFORM = "uSolidTexelCut";

/**
 * Whether a material's fragment stage has three's alpha test to cut solid
 * texels after: every built-in material does, a shader material only if its
 * source includes the chunk.
 */
export function canCutSolidTexels(material: Material) {
  const shader = material as ShaderMaterial;
  if (!shader.isShaderMaterial) return true;
  return shader.fragmentShader.includes(ALPHA_TEST_FRAGMENT);
}

/** Drops every texel at or above `solidAlpha` after the alpha test. */
function cutSolidTexels(material: Material, solidAlpha: number) {
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  const cut = { value: solidAlpha };
  const compile: Material["onBeforeCompile"] = function (
    this: Material,
    shader,
    renderer,
  ) {
    previousCompile.call(this, shader, renderer);
    shader.uniforms[SOLID_TEXEL_CUT_UNIFORM] = cut;
    shader.fragmentShader = `uniform float ${SOLID_TEXEL_CUT_UNIFORM};\n${shader.fragmentShader.replace(
      ALPHA_TEST_FRAGMENT,
      `${ALPHA_TEST_FRAGMENT}\nif (diffuseColor.a >= ${SOLID_TEXEL_CUT_UNIFORM}) discard;`,
    )}`;
  };
  compile.toString = () => previousCompile.toString();
  material.onBeforeCompile = compile;
  material.customProgramCacheKey = function (this: Material) {
    return `${previousKey.call(this)}|translucent-texels`;
  };
}

export type TexelForks = { solid: Material; translucent: Material };

/**
 * A geometry drawing `source`'s buffers under a draw range of its own, with
 * the bounds the culling reads. Never dispose it on its own while `source`
 * lives: disposing a geometry frees its attributes' buffers, and these are
 * `source`'s.
 */
export function shareBuffers(source: BufferGeometry) {
  const geometry = new BufferGeometry();
  geometry.setIndex(source.index);
  for (const name of Object.keys(source.attributes)) {
    geometry.setAttribute(name, source.getAttribute(name));
  }
  if (!source.boundingSphere) source.computeBoundingSphere();
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  return geometry;
}

/**
 * Splits a see-through mesh's texels by their alpha (see {@link TexelPlan}).
 * Solid texels hide what is behind them, so they draw with the depth
 * writers, and the depth they leave hides the blended layers behind them;
 * translucent texels tint what is behind, so they blend and write nothing.
 * One material fork per side carries the cut, made once per material.
 */
export class SeeThroughTexelSplit {
  private readonly forks = new WeakMap<Material, TexelForks>();
  private readonly layers = new WeakMap<Mesh, Mesh>();

  constructor(
    readonly cuts: TexelAlphaCuts,
    /** A copy of a material that keeps its live uniforms and textures. */
    private readonly fork: (material: Material) => Material,
  ) {}

  forksOf(material: Material): TexelForks {
    let forks = this.forks.get(material);
    if (forks) return forks;
    const solid = this.fork(material);
    solid.alphaTest = this.cuts.solid;
    const solidShader = solid as ShaderMaterial;
    if (solidShader.isShaderMaterial && solidShader.uniforms.alphaTest) {
      solidShader.uniforms.alphaTest = { value: this.cuts.solid };
    }
    solid.depthWrite = true;
    solid.forceSinglePass = true;
    const translucent = this.fork(material);
    translucent.depthWrite = false;
    translucent.forceSinglePass = true;
    cutSolidTexels(translucent, this.cuts.solid);
    forks = { solid, translucent };
    this.forks.set(material, forks);
    return forks;
  }

  /**
   * Points `mesh` at the draws `plan` asks for, `base` being the material it
   * was built with. The child that draws translucent texels is made the
   * first time a split needs it and hidden, never disposed, when a later
   * plan does not: it draws from the mesh's own buffers.
   */
  apply(mesh: Mesh, base: Material, plan: TexelPlan): Mesh | null {
    let layer = this.layers.get(mesh) ?? null;
    if (plan === "as-is") {
      mesh.material = base;
    } else {
      const forks = this.forksOf(base);
      mesh.material = plan === "translucent" ? forks.translucent : forks.solid;
      if (plan === "split") {
        if (!layer) {
          layer = makeLayer(mesh);
          this.layers.set(mesh, layer);
        }
        layer.material = forks.translucent;
      }
    }
    if (layer) layer.visible = plan === "split";
    mesh.userData.texelPlan = plan;
    return plan === "split" ? layer : null;
  }

  /** Drops `material`'s forks: its shader changed, and they copied the old. */
  forget(material: Material) {
    this.forks.delete(material);
  }

  /** The child that draws `mesh`'s translucent texels, once one was made. */
  layerOf(mesh: Mesh): Mesh | null {
    return this.layers.get(mesh) ?? null;
  }
}

function makeLayer(mesh: Mesh) {
  const source = mesh.geometry;
  const geometry = shareBuffers(source);
  const layer = new Mesh(geometry);
  layer.renderOrder = mesh.renderOrder;
  layer.matrixAutoUpdate = false;
  layer.userData = { isSeeThroughLayer: true };
  mesh.add(layer);
  source.addEventListener("dispose", () => geometry.dispose());
  return layer;
}
