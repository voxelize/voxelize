import { TextureRange } from "@voxelize/common";
import {
  Texture,
  CompressedTexture,
  CanvasTexture,
  ClampToEdgeWrapping,
  NearestFilter,
  TextureLoader,
  MeshBasicMaterial,
  DoubleSide,
} from "three";

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
    textureSources: Map<string, string>,
    ranges: Map<string, TextureRange>,
    params: TextureAtlasParams
  ) => {
    const atlas = new TextureAtlas();
    atlas.params = params;

    const { countPerSide, dimension } = params;

    const loader = new TextureLoader();
    const textureMap: Map<string, Texture> = new Map();

    for (const [key, source] of textureSources) {
      try {
        if (!source) throw new Error();
        textureMap.set(key, await loader.loadAsync(source));
      } catch (e) {
        textureMap.set(key, TextureAtlas.makeUnknownTexture(dimension));
      }
    }

    const canvasWidth = countPerSide * dimension;
    const canvasHeight = countPerSide * dimension;
    atlas.canvas.width = canvasWidth;
    atlas.canvas.height = canvasHeight;

    console.log(ranges);

    ranges.forEach((range, textureName) => {
      const { startU, startV } = range;
      const texture = textureMap.get(textureName);

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

      const context = atlas.canvas.getContext("2d");
      if (context) {
        context.drawImage(
          texture.image,
          startU * canvasWidth,
          (1 - startV) * canvasHeight,
          dimension,
          dimension
        );

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
      }
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
    color1 = "purple",
    color2 = "black",
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
