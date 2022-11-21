import {
  Texture,
  CompressedTexture,
  CanvasTexture,
  ClampToEdgeWrapping,
  NearestFilter,
  MeshBasicMaterial,
  DoubleSide,
  Color,
  sRGBEncoding,
} from "three";

import { TextureRange } from "./registry";

/**
 * Parameters to create a new {@link TextureAtlas} instance.
 */
export type TextureAtlasParams = {
  /**
   * The number of block textures on each side of the this.
   */
  countPerSide: number;

  /**
   * The dimension of each block texture.
   */
  dimension: number;
};

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
 */
export class TextureAtlas {
  /**
   * The parameters used to create the texture this.
   */
  public params: TextureAtlasParams;

  /**
   * The THREE.JS canvas texture that has been generated.
   */
  public texture: CanvasTexture;

  /**
   * A basic mesh material that can be used to visualize the texture this.
   */
  public material: MeshBasicMaterial;

  /**
   * The loaded set of base64 data URIs for each block-face texture.
   */
  public dataURLs: Map<string, string> = new Map();

  /**
   * The canvas that is used to generate the texture this.
   */
  public canvas = document.createElement("canvas");

  /**
   * The margin between each block texture in the this.
   */
  public margin = 0;

  /**
   * The offset of each block's texture to the end of its border.
   */
  public offset = 0;

  /**
   * The ratio of the texture on the atlas to the original texture.
   */
  public ratio = 0;

  /**
   * The list of block animations that are being used by this texture atlas.
   */
  public animations: { animation: FaceAnimation; timer: any }[] = [];

  /**
   * Create a texture atlas with only one texture.
   *
   * @param name The name of that single block on this atlas.
   * @param data The data passed to create this texture atlas.
   * @param fadeFrames The fading frames between each keyframe.
   * @param params The parameters to create this single texture.
   * @returns A new texture atlas instance with only one texture.
   */
  static createSingle = (
    name: string,
    content:
      | Texture
      | Color
      | {
          data: [number, Texture | Color][];
          fadeFrames: number;
        },
    params: Omit<TextureAtlasParams, "countPerSide">
  ) => {
    const textureMap = new Map();
    textureMap.set(name, content);

    const ranges = new Map();
    ranges.set(name, {
      startU: 0.0,
      endU: 1.0,
      startV: 0.0,
      endV: 1.0,
    });

    const atlas = new TextureAtlas(textureMap, ranges, {
      ...params,
      countPerSide: 1,
    });

    atlas.texture.name = name;

    return atlas;
  };

  /**
   * Create a new texture this.
   *
   * @param textureMap A map that points a side name to a texture or color.
   * @param ranges The ranges on the texture atlas generated by the server.
   * @param params The parameters used to create the texture this.
   * @returns The texture atlas generated.
   */
  constructor(
    textureMap: Map<
      string,
      | Texture
      | Color
      | {
          data: [number, Texture | Color][];
          fadeFrames: number;
        }
    >,
    ranges: Map<string, TextureRange>,
    params: TextureAtlasParams
  ) {
    this.params = params;

    const { countPerSide, dimension } = params;

    textureMap.forEach((texture, key) => {
      if (!texture) {
        textureMap.set(key, TextureAtlas.makeUnknownTexture(dimension));
      }
    });

    if (countPerSide === 1) {
      this.offset = 0;
      this.ratio = 1;
      this.margin = 0;
    } else {
      this.offset = 1 / (countPerSide * 4);

      this.margin = 1;
      this.ratio =
        (this.margin / this.offset / countPerSide - 2 * this.margin) /
        dimension;

      while (this.ratio !== Math.floor(this.ratio)) {
        this.ratio *= 2;
        this.margin *= 2;
      }
    }

    const canvasWidth =
      (dimension * this.ratio + this.margin * 2) * countPerSide;
    const canvasHeight =
      (dimension * this.ratio + this.margin * 2) * countPerSide;
    this.canvas.width = canvasWidth;
    this.canvas.height = canvasHeight;

    const context = this.canvas.getContext("2d");
    context.imageSmoothingEnabled = false;

    ranges.forEach((range, textureName) => {
      const { startU, endV } = range;

      let texture = textureMap.get(textureName);

      if ((texture as any as Color).isColor) {
        context.fillStyle = `#${(texture as any).getHexString()}`;
        context.fillRect(
          (startU - this.offset) * canvasWidth,
          (1 - endV - this.offset) * canvasHeight,
          dimension * this.ratio + 2 * this.margin,
          dimension * this.ratio + 2 * this.margin
        );
        context.fillRect(
          (startU - this.offset) * canvasWidth + this.margin,
          (1 - endV - this.offset) * canvasHeight + this.margin,
          dimension * this.ratio,
          dimension * this.ratio
        );
        return;
      }

      if (texture instanceof CompressedTexture) {
        throw new Error("CompressedTextures are not supported.");
      }

      if (typeof texture === "string") {
        throw new Error("TextureAtlas does not support string textures.");
      }

      if (
        !!texture &&
        !(texture instanceof Color) &&
        !(texture instanceof Texture)
      ) {
        this.registerAnimation(range, texture.data as any, texture.fadeFrames);
        return;
      }

      texture = texture as Texture;

      // saving the textures
      if (typeof texture.image.toDataURL === "undefined") {
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = texture.image.naturalWidth;
        tempCanvas.height = texture.image.naturalHeight;
        tempCanvas.getContext("2d")?.drawImage(texture.image, 0, 0);
        this.dataURLs.set(textureName, tempCanvas.toDataURL());
      } else {
        this.dataURLs.set(textureName, texture.image.toDataURL());
      }

      if (context) {
        this.drawImageToRange(range, texture.image);
      }
    });

    this.makeCanvasPowerOfTwo(this.canvas);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.minFilter = NearestFilter;
    this.texture.magFilter = NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.premultiplyAlpha = false;
    this.texture.needsUpdate = true;
    this.texture.encoding = sRGBEncoding;

    this.material = new MeshBasicMaterial({
      map: this.texture,
      side: DoubleSide,
    });
  }

  /**
   * Draw a texture to a range on the texture atlas.
   *
   * @param range The range on the texture atlas to draw the texture to.
   * @param image The texture to draw to the range.
   */
  drawImageToRange = (
    range: TextureRange,
    image: typeof Image | Color,
    clearRect = true,
    opacity = 1.0
  ) => {
    const { startU, endV } = range;
    const { dimension } = this.params;

    const context = this.canvas.getContext("2d");

    context.save();

    const canvasWidth = this.canvas.width;
    const canvasHeight = this.canvas.height;

    context.globalAlpha = opacity;
    context.globalCompositeOperation = "lighter";

    if (clearRect) {
      context.clearRect(
        (startU - this.offset) * canvasWidth,
        (1 - endV - this.offset) * canvasHeight,
        dimension * this.ratio + 2 * this.margin,
        dimension * this.ratio + 2 * this.margin
      );
    }

    if ((image as any as Color).isColor) {
      context.fillStyle = `#${(image as any).getHexString()}`;
      context.fillRect(
        (startU - this.offset) * canvasWidth + this.margin,
        (1 - endV - this.offset) * canvasHeight + this.margin,
        dimension * this.ratio,
        dimension * this.ratio
      );

      return;
    }

    const image2 = image as any as HTMLImageElement;

    // Draw a background first.

    if (clearRect) {
      context.drawImage(
        image2,
        (startU - this.offset) * canvasWidth,
        (1 - endV - this.offset) * canvasHeight,
        dimension * this.ratio + 2 * this.margin,
        dimension * this.ratio + 2 * this.margin
      );

      // Carve out the middle.
      context.clearRect(
        (startU - this.offset) * canvasWidth + this.margin,
        (1 - endV - this.offset) * canvasHeight + this.margin,
        dimension * this.ratio,
        dimension * this.ratio
      );
    }

    // Draw the actual texture.
    context.drawImage(
      image2,
      (startU - this.offset) * canvasWidth + this.margin,
      (1 - endV - this.offset) * canvasHeight + this.margin,
      dimension * this.ratio,
      dimension * this.ratio
    );

    context.restore();
  };

  /**
   * Register a block animation to this texture atlas. This animation starts automatically when this function is called.
   *
   * @param range The range on the texture atlas to draw the texture to.
   * @param keyframes The keyframes to draw to the range.
   * @param fadeFrames The number of frames to fade between keyframes.
   */
  registerAnimation = (
    range: TextureRange,
    keyframes: [number, Texture][],
    fadeFrames = 0
  ) => {
    const animation = new FaceAnimation(range, keyframes, fadeFrames);

    const entry = { animation, timer: null };

    const start = (index = 0) => {
      const keyframe = animation.keyframes[index];

      this.drawImageToRange(range, keyframe[1].image);

      entry.timer = setTimeout(() => {
        clearTimeout(entry.timer);

        const nextIndex = (index + 1) % animation.keyframes.length;

        if (fadeFrames > 0) {
          const nextKeyframe = animation.keyframes[nextIndex];

          const fade = (fraction = 0) => {
            if (fraction > fadeFrames) {
              start(nextIndex);
              return;
            }
            requestAnimationFrame(() => fade(fraction + 1));

            this.drawImageToRange(
              range,
              nextKeyframe[1].image,
              true,
              fraction / fadeFrames
            );

            this.drawImageToRange(
              range,
              keyframe[1].image,
              false,
              1 - fraction / fadeFrames
            );

            if (this.texture) {
              this.texture.needsUpdate = true;
            }
          };

          fade();
        } else {
          start(nextIndex);
        }

        if (this.texture) {
          this.texture.needsUpdate = true;
        }
      }, keyframe[0]);
    };

    this.animations.push(entry);

    start();
  };

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
      Math.round(Math.log(oldHeight) / Math.log(2))
    );
    const newCanvas = document.createElement("canvas");
    newCanvas.width = newWidth;
    newCanvas.height = newHeight;
    newCanvas.getContext("2d")?.drawImage(canvas, 0, 0, newWidth, newHeight);
    if (setCanvas) {
      this.canvas = newCanvas;
    }
  }

  private static makeUnknownTexture = (
    dimension: number,
    color1 = "#6A67CE",
    color2 = "#16003B",
    segments = 2
  ) => {
    const tempCanvas = document.createElement("canvas") as HTMLCanvasElement;
    const context = tempCanvas.getContext("2d");
    const blockSize = dimension / segments;

    context.canvas.width = dimension;
    context.canvas.height = dimension;
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < segments; j++) {
        context.fillStyle =
          (i % 2 === 0 && j % 2 === 1) || (i % 2 === 1 && j % 2 === 0)
            ? color1
            : color2;
        context.fillRect(i * blockSize, j * blockSize, blockSize, blockSize);
      }
    }

    return new CanvasTexture(context ? context.canvas : tempCanvas);
  };
}

export class FaceAnimation {
  /**
   * The range of the texture atlas that this animation uses.
   */
  public range: TextureRange;

  /**
   * The keyframes of the animation. This will be queried and drawn to the
   * texture atlas.
   */
  public keyframes: [number, Texture][];

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
    range: TextureRange,
    keyframes: [number, Texture][],
    fadeFrames = 0
  ) {
    if (!range) {
      throw new Error("Texture range is required for FaceAnimation.");
    }

    if (keyframes.length <= 1) {
      throw new Error("FaceAnimation must have at least two keyframe.");
    }

    this.range = range;
    this.keyframes = keyframes;
    this.fadeFrames = fadeFrames;
  }
}
