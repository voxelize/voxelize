import {
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  NearestFilter,
  NearestMipmapNearestFilter,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";

import { ThreeUtils } from "../../utils";

import {
  type FaceAnimationFrame,
  faceAnimationFrameAt,
} from "./face-animation-frame";
import {
  classifyTexels,
  mergeTexelClasses,
  readImagePixels,
  type TexelAlphaCuts,
  type TexelClasses,
  UNREADABLE_TEXELS,
} from "./see-through-texels";
import { UV } from "./uv";

type AtlasAnimationPatch = {
  scratch: HTMLCanvasElement;
  x: number;
  y: number;
  size: number;
  dstPosition: Vector3;
};

/** See `WorldOptions.blockTextureFiltering`. */
export type AtlasFilteringMode = "nearest" | "mip-aniso";

/** The glancing-angle fix's anisotropy: enough to kill the streak without
 * paying for the GPU's full max (8 or 16 on most hardware). */
const MIP_ANISO_LEVEL = 4;

/**
 * The filter/mip/anisotropy settings for a mode, pulled out of
 * `AtlasTexture.applyFiltering` so the mapping is testable without a
 * canvas or a GL context.
 */
export function resolveAtlasFiltering(mode: AtlasFilteringMode): {
  minFilter: typeof NearestFilter | typeof NearestMipmapNearestFilter;
  magFilter: typeof NearestFilter;
  generateMipmaps: boolean;
  anisotropy: number;
} {
  const isMipAniso = mode === "mip-aniso";
  return {
    minFilter: isMipAniso ? NearestMipmapNearestFilter : NearestFilter,
    // Magnification (up close) is untouched either way: nearest-only, so a
    // texel stays a hard-edged square right in front of the camera. Only
    // minification (a wall far off axis) ever reaches a lower mip level.
    magFilter: NearestFilter,
    generateMipmaps: isMipAniso,
    anisotropy: isMipAniso ? MIP_ANISO_LEVEL : 1,
  };
}

/**
 * A texture atlas is a collection of textures that are packed into a single texture.
 * This is useful for reducing the number of draw calls required to render a scene, since
 * all block textures can be rendered with a single draw call.
 *
 * By default, the texture atlas creates an additional border around each texture to prevent
 * texture bleeding.
 *
 * ![Texture bleeding](/img/docs/texture-bleeding.png)
 *
 * @noInheritDoc
 */
export class AtlasTexture extends CanvasTexture {
  private static sharedUnknownTexture: AtlasTexture | null = null;

  /**
   * The number of textures per side of the texture atlas
   */
  public countPerSide: number;

  /**
   * Since the texture atlas is a square, the dimension is the length of one side.
   */
  public dimension: number;

  /**
   * The canvas that is used to generate the texture this.
   */
  public canvas: HTMLCanvasElement;

  /**
   * The margin between each block texture in the this.
   */
  public atlasMargin = 0;

  /**
   * The offset of each block's texture to the end of its border.
   */
  public atlasOffset = 0;

  /**
   * The ratio of the texture on the atlas to the original texture.
   */
  public atlasRatio = 0;

  /**
   * The list of block animations that are being used by this texture atlas.
   */
  public animations: {
    animation: FaceAnimation;
    /** Unused: frames come from {@link animationClock}, not timers. */
    timer: null;
    patch: AtlasAnimationPatch;
    durationsMs: number[];
    /** The frame last drawn, as index * (fades + 1) + step; -1 for none. */
    drawnFrame: number;
  }[] = [];

  /**
   * Seconds the animated faces read their frame from. The world points it
   * at its shared shader clock, so every client shows the same frame of the
   * same water at the same moment; on its own it runs on local time.
   */
  public animationClock: () => number = () => performance.now() / 1000;

  private readonly scratchFrame: FaceAnimationFrame = {
    index: 0,
    next: 0,
    fadeStep: 0,
  };

  private pendingAnimationPatches = new Map<
    FaceAnimation,
    AtlasAnimationPatch
  >();

  /**
   * Ranges something has drawn into since the atlas was built. Every slot
   * starts as the unknown checker; a slot missing from this set is still
   * wearing it, which is what {@link isRangePainted} answers for the texture
   * census. Shared with clones, which share the pixels too.
   */
  private paintedRangeKeys = new Set<string>();

  /**
   * Ranges painted by a fallback fill rather than by their own art. Kept
   * apart from {@link paintedRangeKeys} so the census can still report them
   * as missing their real texture; a real draw clears the mark.
   */
  private fallbackRangeKeys = new Set<string>();

  /**
   * {@link rangeTexelClasses} answers by range and cuts, dropped for a range
   * whenever something draws into it. Shared with clones, like the pixels.
   */
  private texelClassCache = new Map<string, TexelClasses>();

  private static rangeKey(range: UV) {
    return `${range.startU}|${range.startV}|${range.endU}|${range.endV}`;
  }

  /** Whether anything has been drawn into `range` since the atlas was built. */
  isRangePainted(range: UV) {
    return this.paintedRangeKeys.has(AtlasTexture.rangeKey(range));
  }

  /** Whether `range` wears a fallback fill instead of its own texture. */
  isRangeFallback(range: UV) {
    return this.fallbackRangeKeys.has(AtlasTexture.rangeKey(range));
  }

  /**
   * The RGBA8 pixels painted inside `range` (its texture, without the
   * margin around it), or null while nothing has been painted there. One
   * small read of the atlas canvas.
   */
  readRangePixels(range: UV): Uint8ClampedArray | null {
    if (!this.isRangePainted(range)) return null;
    const context = this.canvas.getContext("2d");
    if (!context) return null;
    const size = Math.max(1, Math.round(this.dimension * this.atlasRatio));
    const x = Math.round(
      (range.startU - this.atlasOffset) * this.canvas.width + this.atlasMargin,
    );
    const y = Math.round(
      (1 - range.endV - this.atlasOffset) * this.canvas.height +
        this.atlasMargin,
    );
    return context.getImageData(x, y, size, size).data;
  }

  /**
   * Whether `range` holds solid or translucent texels (see
   * `classifyTexels`): its painted pixels, every keyframe of an animation
   * playing there, or the opaque unknown checker while nothing is painted.
   */
  rangeTexelClasses(range: UV, cuts: TexelAlphaCuts): TexelClasses {
    const key = `${AtlasTexture.rangeKey(range)}|${cuts.hole}|${cuts.solid}`;
    const cached = this.texelClassCache.get(key);
    if (cached) return { ...cached };

    const rangeKey = AtlasTexture.rangeKey(range);
    const animation = this.animations.find(
      (entry) => AtlasTexture.rangeKey(entry.animation.range) === rangeKey,
    );
    let classes: TexelClasses;
    if (animation) {
      classes = { solid: false, translucent: false };
      for (const [, frame] of animation.animation.keyframes) {
        if ((frame as Color).isColor) {
          classes.solid = true;
          continue;
        }
        const pixels = readImagePixels(frame);
        mergeTexelClasses(
          classes,
          pixels ? classifyTexels(pixels, cuts) : UNREADABLE_TEXELS,
        );
      }
    } else if (!this.isRangePainted(range)) {
      classes = { solid: true, translucent: false };
    } else {
      const pixels = this.readRangePixels(range);
      classes = pixels
        ? classifyTexels(pixels, cuts)
        : { ...UNREADABLE_TEXELS };
    }
    this.texelClassCache.set(key, classes);
    return { ...classes };
  }

  private forgetTexelClasses(range?: UV) {
    if (!range) {
      this.texelClassCache.clear();
      return;
    }
    const prefix = `${AtlasTexture.rangeKey(range)}|`;
    for (const key of this.texelClassCache.keys()) {
      if (key.startsWith(prefix)) this.texelClassCache.delete(key);
    }
  }

  /**
   * Paint `range` with a stand-in colour and remember that it is one, so a
   * later census still lists the slot as unpainted by its own art.
   */
  fillRangeAsFallback(range: UV, color: Color) {
    this.drawImageToRange(range, color);
    this.fallbackRangeKeys.add(AtlasTexture.rangeKey(range));
    this.needsUpdate = true;
  }

  /**
   * Create a new texture this.
   *
   * @param textureMap A map that points a side name to a texture or color.
   * @param ranges The ranges on the texture atlas generated by the server.
   * @param options The options used to create the texture this.
   * @returns The texture atlas generated.
   */
  // Defaults exist because three.js constructs textures with no arguments:
  // `Texture.clone()` is `new this.constructor().copy(source)`, so a clone
  // passes through here before `copy` installs the real atlas state. With
  // required arguments that path fed NaN into the power-of-two loop below,
  // which can never converge on NaN — a held torch cloning its flame strip
  // froze the whole tab.
  constructor(
    countPerSide = 1,
    dimension = 1,
    canvas = document.createElement("canvas"),
    filtering: AtlasFilteringMode = "nearest",
  ) {
    super(canvas);

    this.canvas = canvas;

    this.countPerSide = countPerSide;
    this.dimension = dimension;

    if (countPerSide === 1) {
      this.atlasOffset = 0;
      this.atlasRatio = 1;
      this.atlasMargin = 0;
    } else {
      this.atlasOffset = 1 / (countPerSide * 4);

      this.atlasMargin = 1;
      this.atlasRatio =
        (this.atlasMargin / this.atlasOffset / countPerSide -
          2 * this.atlasMargin) /
        dimension;

      if (!Number.isFinite(this.atlasRatio)) {
        // The doubling loop below cannot converge on NaN or Infinity; it
        // would spin the main thread forever. Refuse loudly instead.
        throw new Error(
          `AtlasTexture cannot be built from countPerSide=${countPerSide}, ` +
            `dimension=${dimension}: the atlas ratio is not finite`,
        );
      }

      while (this.atlasRatio !== Math.floor(this.atlasRatio)) {
        this.atlasRatio *= 2;
        this.atlasMargin *= 2;
      }
    }

    const canvasWidth =
      (dimension * this.atlasRatio + this.atlasMargin * 2) * countPerSide;
    const canvasHeight =
      (dimension * this.atlasRatio + this.atlasMargin * 2) * countPerSide;
    this.canvas.width = canvasWidth;
    this.canvas.height = canvasHeight;

    const context = this.canvas.getContext("2d");
    context.imageSmoothingEnabled = false;

    this.makeCanvasPowerOfTwo(this.canvas);
    this.wrapS = ClampToEdgeWrapping;
    this.wrapT = ClampToEdgeWrapping;
    this.applyFiltering(filtering);
    this.needsUpdate = true;
    this.colorSpace = SRGBColorSpace;

    const unknown = AtlasTexture.makeUnknownImage(canvasWidth / countPerSide);

    for (let x = 0; x < countPerSide; x++) {
      for (let y = 0; y < countPerSide; y++) {
        context.drawImage(
          unknown,
          (x / countPerSide) * canvasWidth,
          (y / countPerSide) * canvasHeight,
          canvasWidth / countPerSide,
          canvasHeight / countPerSide,
        );
      }
    }
  }

  /**
   * Switches how this atlas samples at glancing angles. Safe to call on a
   * live atlas already bound to chunk materials (sets `needsUpdate` so the
   * next upload carries the new filter/mip settings) — an A/B run can flip
   * this without rebuilding the world. See `WorldOptions.blockTextureFiltering`.
   */
  applyFiltering(mode: AtlasFilteringMode): void {
    const settings = resolveAtlasFiltering(mode);
    this.minFilter = settings.minFilter;
    this.magFilter = settings.magFilter;
    this.generateMipmaps = settings.generateMipmaps;
    this.anisotropy = settings.anisotropy;
    this.needsUpdate = true;
  }

  /**
   * Carries the atlas geometry so `clone()` yields a faithful atlas view
   * sharing the source's pixels, with independently settable repeat/offset
   * (how the held torch windows its flame strip). Animations deliberately do
   * not transfer: their timers drive the source's own offsets, and a clone
   * inheriting them would be fought over by two drivers.
   */
  copy(source: this): this {
    super.copy(source);
    this.canvas = source.canvas;
    this.countPerSide = source.countPerSide;
    this.dimension = source.dimension;
    this.atlasMargin = source.atlasMargin;
    this.atlasOffset = source.atlasOffset;
    this.atlasRatio = source.atlasRatio;
    this.paintedRangeKeys = source.paintedRangeKeys;
    this.fallbackRangeKeys = source.fallbackRangeKeys;
    this.texelClassCache = source.texelClassCache;
    return this;
  }

  /**
   * Paints the entire canvas with a specified color using Three.js Color.
   *
   * @param color A Three.js Color instance to use for painting.
   */
  paintColor(color: Color) {
    this.drawImageToRange(
      {
        startU: 0,
        endU: 1,
        startV: 0,
        endV: 1,
      },
      color,
    );
  }

  /**
   * Draw a texture to a range on the texture atlas.
   *
   * @param range The range on the texture atlas to draw the texture to.
   * @param image The texture to draw to the range.
   */
  drawImageToRange(
    range: UV,
    image:
      | typeof Image
      | HTMLImageElement
      | HTMLCanvasElement
      | Color
      | Texture,
    clearRect = true,
    opacity = 1.0,
  ) {
    const { startU, endV } = range;

    const image2 = ThreeUtils.isTexture(image)
      ? (image.image as CanvasImageSource)
      : (image as HTMLImageElement);

    if (!image2) {
      return;
    }

    const rangeKey = AtlasTexture.rangeKey(range);
    this.paintedRangeKeys.add(rangeKey);
    this.fallbackRangeKeys.delete(rangeKey);
    if (range.startU === 0 && range.endU === 1) this.forgetTexelClasses();
    else this.forgetTexelClasses(range);

    const context = this.canvas.getContext("2d");

    context.save();

    const canvasWidth = this.canvas.width;
    const canvasHeight = this.canvas.height;

    context.globalAlpha = opacity;

    if (opacity !== 1) context.globalCompositeOperation = "lighter";

    if (clearRect) {
      context.clearRect(
        (startU - this.atlasOffset) * canvasWidth,
        (1 - endV - this.atlasOffset) * canvasHeight,
        this.dimension * this.atlasRatio + 2 * this.atlasMargin,
        this.dimension * this.atlasRatio + 2 * this.atlasMargin,
      );
    }

    if ((image as any as Color).isColor) {
      const originalColor = image as any as Color;
      // Use getHexString() directly - it returns the sRGB hex that was originally passed in
      // Do NOT use convertLinearToSRGB() as that would double-convert and wash out colors
      // When Color is created from hex string like "#9be9a8", getHexString() returns "9be9a8"
      context.fillStyle = `#${originalColor.getHexString()}`;
      context.fillRect(
        (startU - this.atlasOffset) * canvasWidth,
        (1 - endV - this.atlasOffset) * canvasHeight,
        this.dimension * this.atlasRatio + 2 * this.atlasMargin,
        this.dimension * this.atlasRatio + 2 * this.atlasMargin,
      );

      return;
    }

    // Draw a background first.

    if (clearRect) {
      context.drawImage(
        image2,
        (startU - this.atlasOffset) * canvasWidth,
        (1 - endV - this.atlasOffset) * canvasHeight,
        this.dimension * this.atlasRatio + 2 * this.atlasMargin,
        this.dimension * this.atlasRatio + 2 * this.atlasMargin,
      );

      // Carve out the middle.
      context.clearRect(
        (startU - this.atlasOffset) * canvasWidth + this.atlasMargin,
        (1 - endV - this.atlasOffset) * canvasHeight + this.atlasMargin,
        this.dimension * this.atlasRatio,
        this.dimension * this.atlasRatio,
      );
    }

    // Draw the actual texture.
    context.drawImage(
      image2,
      (startU - this.atlasOffset) * canvasWidth + this.atlasMargin,
      (1 - endV - this.atlasOffset) * canvasHeight + this.atlasMargin,
      this.dimension * this.atlasRatio,
      this.dimension * this.atlasRatio,
    );

    context.restore();

    this.needsUpdate = true;
  }

  registerAnimation(
    range: UV,
    keyframes: [number, Color | HTMLImageElement][],
    fadeFrames = 0,
  ) {
    const animation = new FaceAnimation(range, keyframes, fadeFrames);

    // Animation frames never set `needsUpdate` on this texture: doing so
    // re-uploads the entire atlas canvas to the GPU every frame change,
    // which for a fading animation means a multi-megabyte texSubImage2D
    // stall on nearly every frame. Frames are composited on a per-animation
    // scratch canvas instead, mirrored onto the atlas canvas (so full
    // uploads stay coherent), and queued as a small sub-rectangle GPU patch
    // that the world flushes before rendering.
    const entry = {
      animation,
      timer: null as null,
      patch: this.makeAnimationPatch(animation),
      durationsMs: animation.keyframes.map(([duration]) => duration),
      drawnFrame: -1,
    };
    this.animations.push(entry);
    this.forgetTexelClasses(range);
    this.tickAnimation(entry, this.animationClock());
  }

  /**
   * Draws whichever animated faces changed frame since the last call, read
   * off {@link animationClock}. Called once a frame by the world; a face
   * whose frame has not changed costs a lookup and nothing else.
   */
  tickAnimations(seconds = this.animationClock()) {
    for (const entry of this.animations) this.tickAnimation(entry, seconds);
  }

  private tickAnimation(
    entry: AtlasTexture["animations"][number],
    seconds: number,
  ) {
    const { animation, patch } = entry;
    const fades = animation.fadeFrames;
    const frame = faceAnimationFrameAt(
      entry.durationsMs,
      fades,
      seconds * 1000,
      this.scratchFrame,
    );
    const drawn = frame.index * (fades + 1) + frame.fadeStep;
    if (drawn === entry.drawnFrame) return;
    entry.drawnFrame = drawn;

    const current = animation.keyframes[frame.index][1];
    if (frame.fadeStep === 0) {
      this.drawAnimationKeyframe(patch, current, this.countPerSide !== 1, 1);
    } else {
      const fraction = frame.fadeStep / (fades + 1);
      this.drawAnimationKeyframe(
        patch,
        animation.keyframes[frame.next][1],
        true,
        fraction,
      );
      this.drawAnimationKeyframe(patch, current, false, 1 - fraction);
    }
    this.commitAnimationPatch(animation, patch);
  }

  private makeAnimationPatch(animation: FaceAnimation): AtlasAnimationPatch {
    const { startU, endV } = animation.range;
    const canvasWidth = this.canvas.width;
    const canvasHeight = this.canvas.height;
    const size = Math.round(
      this.dimension * this.atlasRatio + 2 * this.atlasMargin,
    );
    const x = Math.round((startU - this.atlasOffset) * canvasWidth);
    const y = Math.round((1 - endV - this.atlasOffset) * canvasHeight);

    const scratch = document.createElement("canvas");
    scratch.width = size;
    scratch.height = size;
    scratch.getContext("2d").imageSmoothingEnabled = false;

    return {
      scratch,
      x,
      y,
      size,
      // texSubImage2D destinations are addressed from the texture's bottom
      // row; the atlas uploads with flipY, so the canvas-space rect flips.
      dstPosition: new Vector3(x, canvasHeight - y - size, 0),
    };
  }

  private drawAnimationKeyframe(
    patch: AtlasAnimationPatch,
    image: Color | HTMLImageElement,
    clearRect: boolean,
    opacity: number,
  ) {
    const context = patch.scratch.getContext("2d");
    const size = patch.size;
    const inner = this.dimension * this.atlasRatio;

    context.save();
    context.globalAlpha = opacity;
    if (opacity !== 1) context.globalCompositeOperation = "lighter";

    if (clearRect) {
      context.clearRect(0, 0, size, size);
    }

    if ((image as Color).isColor) {
      context.fillStyle = `#${(image as Color).getHexString()}`;
      context.fillRect(0, 0, size, size);
      context.restore();
      return;
    }

    const source = image as HTMLImageElement;

    // Same margin-bleed layout as drawImageToRange: a padded backdrop, a
    // carved center, then the actual texture in the center.
    if (clearRect) {
      context.drawImage(source, 0, 0, size, size);
      context.clearRect(this.atlasMargin, this.atlasMargin, inner, inner);
    }

    context.drawImage(source, this.atlasMargin, this.atlasMargin, inner, inner);

    context.restore();
  }

  private commitAnimationPatch(
    animation: FaceAnimation,
    patch: AtlasAnimationPatch,
  ) {
    // Keep the CPU-side atlas canvas coherent so any later full upload
    // (context loss, needsUpdate from static texture edits) stays correct.
    const context = this.canvas.getContext("2d");
    context.clearRect(patch.x, patch.y, patch.size, patch.size);
    context.drawImage(patch.scratch, patch.x, patch.y);

    // An animated slot is painted by its keyframes, never by
    // drawImageToRange; the census must count it as dressed all the same.
    const rangeKey = AtlasTexture.rangeKey(animation.range);
    this.paintedRangeKeys.add(rangeKey);
    this.fallbackRangeKeys.delete(rangeKey);

    this.pendingAnimationPatches.set(animation, patch);
  }

  flushAnimationPatches(renderer: WebGLRenderer) {
    // Called by the world right before rendering: queued animation frames
    // upload as sub-rectangle patches of the GPU texture. No-op when no
    // animation ticked since the last flush.
    if (this.pendingAnimationPatches.size === 0) return;

    const textureProperties = renderer.properties.get(this) as {
      __webglTexture?: WebGLTexture;
    };
    if (!textureProperties.__webglTexture) {
      // Not GPU-resident yet: the atlas canvas already mirrors every patch,
      // so a full upload on the next bind covers them.
      this.pendingAnimationPatches.clear();
      this.needsUpdate = true;
      return;
    }

    // Raw texSubImage2D instead of renderer.copyTextureToTexture: the three
    // helper brackets every copy with five synchronous gl.getParameter
    // round-trips to the GPU process (to save/restore unpack state), which
    // stall the main thread for longer than the upload itself. Unpack state
    // is instead set to the defaults three's own uploads assume.
    const gl = renderer.getContext();
    renderer.state.bindTexture(gl.TEXTURE_2D, textureProperties.__webglTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, this.flipY);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, this.premultiplyAlpha);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, this.unpackAlignment);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);

    this.pendingAnimationPatches.forEach((patch) => {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        patch.dstPosition.x,
        patch.dstPosition.y,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        patch.scratch,
      );
    });
    this.pendingAnimationPatches.clear();

    // texSubImage2D only ever touches mip level 0. With mips on
    // (`mip-aniso`), every level above it would otherwise keep whatever
    // frame was baked in at the last full upload forever — a flowing lava
    // or water tile the moment it is more than a few blocks off would show
    // a stuck frame while everything up close animated normally. The whole
    // point of the sub-rect patch is to skip a full re-upload, so this
    // regenerates the chain only when one is actually in use.
    if (this.generateMipmaps) {
      gl.generateMipmap(gl.TEXTURE_2D);
    }

    renderer.state.unbindTexture();
  }

  private makeCanvasPowerOfTwo(canvas?: HTMLCanvasElement | undefined) {
    let setCanvas = false;
    if (!canvas) {
      canvas = this.canvas;
      setCanvas = true;
    }
    const oldWidth = canvas.width;
    const oldHeight = canvas.height;
    const newWidth = Math.pow(2, Math.round(Math.log(oldWidth) / Math.log(2)));
    const newHeight = Math.pow(
      2,
      Math.round(Math.log(oldHeight) / Math.log(2)),
    );
    const newCanvas = document.createElement("canvas");
    newCanvas.width = newWidth;
    newCanvas.height = newHeight;
    newCanvas.getContext("2d")?.drawImage(canvas, 0, 0, newWidth, newHeight);
    if (setCanvas) {
      this.canvas = newCanvas;
    }
  }

  static makeUnknownImage(
    dimension: number,
    color1 = "#FF00FF",
    color2 = "#000000",
  ) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    context.imageSmoothingEnabled = false;
    context.canvas.width = dimension;
    context.canvas.height = dimension;

    const halfDim = dimension / 2;

    context.fillStyle = color1;
    context.fillRect(0, 0, halfDim, halfDim);
    context.fillRect(halfDim, halfDim, halfDim, halfDim);

    context.fillStyle = color2;
    context.fillRect(halfDim, 0, halfDim, halfDim);
    context.fillRect(0, halfDim, halfDim, halfDim);

    return canvas;
  }

  /**
   * The magenta-and-black checker every surface with no texture yet is given.
   * One instance serves all of them, so treat it as read-only: painting into
   * it or disposing it reaches every one of those surfaces at once.
   */
  static makeUnknownTexture(dimension: number) {
    if (AtlasTexture.sharedUnknownTexture) {
      return AtlasTexture.sharedUnknownTexture;
    }

    const newAtlas = new AtlasTexture(1, dimension);
    const image = AtlasTexture.makeUnknownImage(dimension);

    newAtlas.drawImageToRange(
      {
        startU: 0,
        endU: 0,
        startV: 0,
        endV: 0,
      },
      image,
    );

    newAtlas.minFilter = NearestFilter;
    newAtlas.magFilter = NearestFilter;
    newAtlas.generateMipmaps = false;
    newAtlas.needsUpdate = true;
    newAtlas.colorSpace = SRGBColorSpace;

    AtlasTexture.sharedUnknownTexture = newAtlas;
    return newAtlas;
  }
}

/**
 * The animation data that is used internally in an atlas texture. This holds the data and will be used to draw on the texture atlas.
 */
export class FaceAnimation {
  /**
   * The range of the texture atlas that this animation uses.
   */
  public range: UV;

  /**
   * The keyframes of the animation. This will be queried and drawn to the
   * texture atlas.
   */
  public keyframes: [number, HTMLImageElement | Color][];

  /**
   * The fading duration between each keyframe in milliseconds.
   */
  public fadeFrames: number;

  /**
   * Create a new face animation. This holds the data and will be used to draw on the texture atlas.
   *
   * @param range The range of the texture atlas that this animation uses.
   * @param keyframes The keyframes of the animation. This will be queried and drawn to the texture atlas.
   * @param fadeFrames The fading duration between each keyframe in milliseconds.
   */
  constructor(
    range: UV,
    keyframes: [number, HTMLImageElement | Color][],
    fadeFrames = 0,
  ) {
    if (!range) {
      throw new Error("Texture range is required for FaceAnimation.");
    }

    if (keyframes.length <= 1) {
      throw new Error("FaceAnimation must have at least two keyframe.");
    }

    this.range = range;
    this.keyframes = keyframes as any;
    this.fadeFrames = fadeFrames;
  }
}
