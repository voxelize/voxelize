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
  public textures = new Map<string, Texture | Texture[]>();

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
  private textureLoader = new TextureLoader(this.manager);

  /**
   * The internal audio loader used by the loader.
   */
  private audioLoader = new AudioLoader(this.manager);

  /**
   * A map of promises to load assets.
   */
  private assetPromises = new Map<string, Promise<void>>();

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

  addGifTexture = (source: string, onLoaded?: (texture: Texture[]) => void) => {
    this.assetPromises.set(
      source,
      new Promise((resolve) => {
        const run = async () => {
          const response = await fetch(source);
          const blob = await response.blob();
          const arrayBuffer = await blob.arrayBuffer();
          const intArray = new Uint8Array(arrayBuffer);

          const reader = new GifReader(intArray);

          const info = reader.frameInfo(0);

          const textures = new Array(reader.numFrames()).fill(0).map((_, k) => {
            const image = new ImageData(info.width, info.height);
            reader.decodeAndBlitFrameRGBA(k, image.data as any);

            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            canvas.width = image.width;
            canvas.height = image.height;
            ctx.putImageData(image, 0, 0);

            const actual = new Image();
            actual.src = canvas.toDataURL();

            const texture = new Texture();
            texture.image = actual;

            return texture;
          });

          this.textures.set(source, textures);
          this.assetPromises.delete(source);

          onLoaded?.(textures);

          resolve();
        };

        run();
      })
    );
  };

  /**
   * Add a texture source to load from. Must be called before `client.connect`.
   *
   * @param source - The source to the texture file to load from.
   */
  addTexture = (source: string, onLoaded?: (texture: Texture) => void) => {
    this.assetPromises.set(
      source,
      new Promise((resolve) => {
        this.textureLoader.load(source, (texture) => {
          this.textures.set(source, texture);
          this.assetPromises.delete(source);

          onLoaded?.(texture);

          resolve();
        });
      })
    );
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
  addAudioBuffer = (
    source: string,
    onLoaded?: (buffer: AudioBuffer) => void
  ) => {
    const callback = async () => {
      return new Promise<AudioBuffer>((resolve) => {
        this.audioLoader.load(source, (buffer) => {
          onLoaded?.(buffer);

          resolve(buffer);
        });
      });
    };

    this.audioCallbacks.set(source, callback);
  };

  /**
   * Get an audio buffer by its source.
   *
   * @param source The source to the audio file to load from.
   * @returns The audio buffer loaded from the source.
   */
  getAudioBuffer = (source: string) => {
    return this.audioBuffers.get(source);
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
