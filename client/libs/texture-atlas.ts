import {
  Texture,
  CompressedTexture,
  CanvasTexture,
  ClampToEdgeWrapping,
  NearestFilter,
  TextureLoader,
  MeshBasicMaterial,
  DoubleSide,
  Color,
} from "three";

import { TextureRange } from "../types";

type TextureAtlasParams = {
  countPerSide: number;
  dimension: number;
};

class TextureAtlas {
  public params: TextureAtlasParams;
  public texture: CanvasTexture;
  public material: MeshBasicMaterial;
  public dataURLs: Map<string, string> = new Map();
  public canvas = document.createElement("canvas");

  static create = async (
    textureSources: Map<string, string | Color>,
    ranges: Map<string, TextureRange>,
    params: TextureAtlasParams
  ) => {
    const atlas = new TextureAtlas();
    atlas.params = params;

    const { countPerSide, dimension } = params;

    const loader = new TextureLoader();
    const textureMap: Map<string, Texture | Color> = new Map();

    for (const [key, source] of textureSources) {
      if (source instanceof Color) {
        textureMap.set(key, source);
        continue;
      }

      try {
        if (!source) throw new Error();
        textureMap.set(key, await loader.loadAsync(source));
      } catch (e) {
        textureMap.set(key, TextureAtlas.makeUnknownTexture(dimension));
      }
    }

    const offset = 1 / 64;

    let margin = 1;
    let r = (margin / offset / countPerSide - 2 * margin) / dimension;

    while (r !== Math.floor(r)) {
      r *= 2;
      margin *= 2;
    }

    const canvasWidth = (dimension * r + margin * 2) * countPerSide;
    const canvasHeight = (dimension * r + margin * 2) * countPerSide;
    atlas.canvas.width = canvasWidth;
    atlas.canvas.height = canvasHeight;

    const context = atlas.canvas.getContext("2d");
    context.imageSmoothingEnabled = false;

    ranges.forEach((range, textureName) => {
      const { startU, endV } = range;
      const texture = textureMap.get(textureName);

      if (texture instanceof Color) {
        context.fillStyle = `#${texture.getHexString()}`;
        context.fillRect(
          (startU - offset) * canvasWidth,
          (1 - endV - offset) * canvasHeight,
          dimension * r + 2 * margin,
          dimension * r + 2 * margin
        );
        context.fillRect(
          (startU - offset) * canvasWidth + margin,
          (1 - endV - offset) * canvasHeight + margin,
          dimension * r,
          dimension * r
        );
        return;
      }

      if (texture instanceof CompressedTexture) {
        throw new Error("CompressedTextures are not supported.");
      }

      // saving the textures
      if (typeof texture.image.toDataURL === "undefined") {
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = texture.image.naturalWidth;
        tempCanvas.height = texture.image.naturalHeight;
        tempCanvas.getContext("2d")?.drawImage(texture.image, 0, 0);
        atlas.dataURLs.set(textureName, tempCanvas.toDataURL());
      } else {
        atlas.dataURLs.set(textureName, texture.image.toDataURL());
      }

      if (context) {
        context.drawImage(
          texture.image,
          (startU - offset) * canvasWidth,
          (1 - endV - offset) * canvasHeight,
          dimension * r + 2 * margin,
          dimension * r + 2 * margin
        );
        context.drawImage(
          texture.image,
          (startU - offset) * canvasWidth + margin,
          (1 - endV - offset) * canvasHeight + margin,
          dimension * r,
          dimension * r
        );
      }
    });

    atlas.makeCanvasPowerOfTwo(atlas.canvas);
    atlas.texture = new CanvasTexture(atlas.canvas);
    atlas.texture.wrapS = ClampToEdgeWrapping;
    atlas.texture.wrapT = ClampToEdgeWrapping;
    atlas.texture.minFilter = NearestFilter;
    atlas.texture.magFilter = NearestFilter;
    atlas.texture.generateMipmaps = false;
    atlas.texture.needsUpdate = true;

    atlas.material = new MeshBasicMaterial({
      map: atlas.texture,
      side: DoubleSide,
    });

    return atlas;
  };

  makeCanvasPowerOfTwo(canvas?: HTMLCanvasElement | undefined) {
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

export { TextureAtlas };
