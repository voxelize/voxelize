import {
  Texture,
  CompressedTexture,
  CanvasTexture,
  ClampToEdgeWrapping,
  NearestFilter,
  TextureLoader,
} from "three";

type TextureAtlasOptionsType = {
  textureDimension: number;
};

const defaultTextureAtlasOptions = {
  textureDimension: 16,
};

class TextureAtlas {
  public options: TextureAtlasOptionsType;
  public mergedTexture: CanvasTexture;

  public ranges: {
    [key: string]: {
      startV: number;
      endV: number;
      startU: number;
      endU: number;
    };
  } = {};
  public dataURLs: { [key: string]: string } = {};
  public canvas = document.createElement("canvas");

  static create = async (
    textureSources: { [key: string]: string },
    options: Partial<TextureAtlasOptionsType> = {}
  ) => {
    const atlas = new TextureAtlas();

    const { textureDimension } = (atlas.options = {
      ...defaultTextureAtlasOptions,
      ...options,
    });

    const loader = new TextureLoader();
    const textureMap: { [key: string]: Texture } = {};
    for (const key of Object.keys(textureSources)) {
      textureMap[key] = await loader.loadAsync(textureSources[key]);
    }

    const countPerSide = Math.ceil(Math.sqrt(Object.keys(textureMap).length));
    const canvasWidth = countPerSide * textureDimension;
    const canvasHeight = countPerSide * textureDimension;
    atlas.canvas.width = canvasWidth;
    atlas.canvas.height = canvasHeight;

    let row = 0;
    let col = 0;
    for (const textureName in textureMap) {
      if (col >= countPerSide) {
        col = 0;
        row++;
      }

      const texture = textureMap[textureName];

      if (texture instanceof CompressedTexture) {
        throw new Error("CompressedTextures are not supported.");
      }

      // saving the textures
      if (typeof texture.image.toDataURL === "undefined") {
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = texture.image.naturalWidth;
        tempCanvas.height = texture.image.naturalHeight;
        tempCanvas.getContext("2d")?.drawImage(texture.image, 0, 0);
        atlas.dataURLs[textureName] = tempCanvas.toDataURL();
      } else {
        atlas.dataURLs[textureName] = texture.image.toDataURL();
      }

      const context = atlas.canvas.getContext("2d");
      if (context) {
        const startX = col * textureDimension;
        const startY = row * textureDimension;

        context.drawImage(
          texture.image,
          startX,
          startY,
          textureDimension,
          textureDimension
        );

        const startU = startX / canvasWidth;
        const endU = (startX + textureDimension) / canvasWidth;
        const startV = 1 - startY / canvasHeight;
        const endV = 1 - (startY + textureDimension) / canvasHeight;

        atlas.ranges[textureName] = {
          startU,
          endU,
          startV,
          endV,
        };

        atlas.makeCanvasPowerOfTwo(atlas.canvas);
        atlas.mergedTexture = new CanvasTexture(atlas.canvas);
        atlas.mergedTexture.wrapS = ClampToEdgeWrapping;
        atlas.mergedTexture.wrapT = ClampToEdgeWrapping;
        atlas.mergedTexture.minFilter = NearestFilter;
        atlas.mergedTexture.magFilter = NearestFilter;
        atlas.mergedTexture.generateMipmaps = false;
        atlas.mergedTexture.needsUpdate = true;
      }

      col++;
    }

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
}

export { TextureAtlas };
