import { GifReader } from "omggif";
import { AudioLoader, LoadingManager, Texture, TextureLoader } from "three";

/**
 * An asset loader that can load textures and audio files. This class is used internally by the world
 * and can be accessed via {@link World.loader}.
 *
 * @category Core
 */
class Loader {
  /**
   * A map of all textures loaded by Voxelize.
   */
  public textures = new Map<string, Texture>();

  public images = new Map<string, HTMLImageElement | HTMLImageElement[]>();

  /**
   * A map of all audios loaded by Voxelize.
   */
  public audioBuffers = new Map<string, AudioBuffer>();

  /**
   * The progress at which Loader has loaded, zero to one.
   */
  public progress = 0;

  /**
   * The internal loading manager used by the loader.
   */
  private manager = new LoadingManager();

  /**
   * The internal texture loader used by the loader.
   */
  textureLoader = new TextureLoader(this.manager);

  /**
   * The internal audio loader used by the loader.
   */
  private audioLoader = new AudioLoader(this.manager);

  /**
   * A map of promises to load assets.
   */
  private assetPromises = new Map<string, Promise<any>>();

  /**
   * A map of callbacks to load audios.
   */
  private audioCallbacks = new Map<string, () => Promise<AudioBuffer>>();

  /**
   * Construct a Voxelize loader.
   *
   * @hidden
   */
  constructor() {
    this.manager.onProgress = (_, loaded, total) => {
      this.progress = loaded / total;
    };

    const listenerCallback = () => {
      this.loadAudios();
      window.removeEventListener("click", listenerCallback);
    };

    window.addEventListener("click", listenerCallback);
  }

  loadGifImages = (
    source: string,
    onLoaded?: (images: HTMLImageElement[]) => void
  ) => {
    const promise = new Promise<HTMLImageElement[]>((resolve) => {
      const run = async () => {
        const response = await fetch(source);
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const intArray = new Uint8Array(arrayBuffer);

        const reader = new GifReader(intArray);

        const info = reader.frameInfo(0);

        const images = new Array(reader.numFrames()).fill(0).map((_, k) => {
          const image = new ImageData(info.width, info.height);
          reader.decodeAndBlitFrameRGBA(k, image.data as any);

          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          canvas.width = image.width;
          canvas.height = image.height;
          ctx.putImageData(image, 0, 0);

          const actual = new Image();
          actual.src = canvas.toDataURL();

          return actual;
        });

        this.images.set(source, images);
        this.assetPromises.delete(source);

        onLoaded?.(images);

        resolve(images);
      };

      run();
    });

    this.assetPromises.set(source, promise);

    return promise;
  };

  loadTexture = (source: string, onLoaded?: (texture: Texture) => void) => {
    const promise = new Promise<Texture>((resolve) => {
      this.textureLoader.load(source, (texture) => {
        this.textures.set(source, texture);
        this.assetPromises.delete(source);

        onLoaded?.(texture);

        resolve(texture);
      });
    });

    this.assetPromises.set(source, promise);

    return promise;
  };

  loadImage = (
    source: string,
    onLoaded?: (image: HTMLImageElement) => void
  ): Promise<HTMLImageElement> => {
    const cached = this.images.get(source);
    if (cached && !Array.isArray(cached)) {
      onLoaded?.(cached);
      return Promise.resolve(cached);
    }

    const existing = this.assetPromises.get(source);
    if (existing) {
      return existing.then((img: HTMLImageElement) => {
        onLoaded?.(img);
        return img;
      });
    }

    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.src = source;

      image.onerror = reject;
      image.onload = () => {
        this.images.set(source, image);
        this.assetPromises.delete(source);

        onLoaded?.(image);

        resolve(image);
      };
    });

    this.assetPromises.set(source, promise);

    return promise;
  };

  /**
   * Get a loaded texture by its source.
   *
   * @param source The source to the texture file to load from.
   * @returns A texture instance loaded from the source.
   */
  getTexture = (source: string): Texture => {
    const texture = this.textures.get(source);

    if (Array.isArray(texture)) {
      throw new Error(
        "`getTexture` was called on a gif texture. Use `getGifTexture` instead."
      );
    }

    return texture;
  };

  /**
   * Get a loaded gif texture with this function.
   *
   * @param source The source to the texture file loaded from.
   * @returns A list of textures for each frame of the gif.
   */
  getGifTexture = (source: string): Texture[] => {
    const texture = this.textures.get(source);

    if (!Array.isArray(texture)) {
      throw new Error(
        "`getGifTexture` was called on a non-gif texture. Use `getTexture` instead."
      );
    }

    return texture;
  };

  /**
   * Add an audio file to be loaded from.
   *
   * @param source The source to the audio file to load from.
   * @param onLoaded A callback to run when the audio is loaded.
   */
  loadAudioBuffer = (
    source: string,
    onLoaded?: (buffer: AudioBuffer) => void
  ) => {
    return new Promise<AudioBuffer>((resolveOuter) => {
      const callback = async () => {
        return new Promise<AudioBuffer>((resolve) => {
          this.audioLoader.load(source, (buffer) => {
            onLoaded?.(buffer);

            resolve(buffer);
            resolveOuter(buffer);
          });
        });
      };

      this.audioCallbacks.set(source, callback);
    });
  };

  /**
   * Load all assets other than the textures. Called internally by the world.
   * This can be used to ensure that a function runs after all assets are loaded.
   *
   * @example
   * ```ts
   * world.loader.load().then(() => {});
   * ```
   *
   * @returns A promise that resolves when all assets are loaded.
   */
  load = async () => {
    await Promise.all(Array.from(this.assetPromises.values()));

    this.assetPromises.clear();
  };

  /**
   * Load all audio loader callbacks.
   */
  private loadAudios = async () => {
    for (const [source, callback] of this.audioCallbacks) {
      const buffer = await callback();
      this.audioBuffers.set(source, buffer);
    }

    this.audioCallbacks.clear();
  };
}

export { Loader };
