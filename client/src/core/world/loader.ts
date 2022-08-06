import { AudioLoader, LoadingManager, Texture, TextureLoader } from "three";

/**
 * A **built-in** loader for Voxelize.
 *
 * @category Core
 */
class Loader {
  /**
   * A map of all textures loaded by Voxelize.
   */
  public textures = new Map<string, Texture>();

  /**
   * A map of all audios loaded by Voxelize.
   */
  public audioBuffers = new Map<string, AudioBuffer>();

  /**
   * The progress at which Loader has loaded, zero to one.
   */
  public progress = 0;

  private manager = new LoadingManager();
  private textureLoader = new TextureLoader(this.manager);
  private audioLoader = new AudioLoader(this.manager);

  private assetPromises = new Map<string, Promise<void>>();
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
   * Get the loaded texture with this function.
   *
   * @param source - The source to the texture file loaded from.
   */
  getTexture = (source: string) => {
    return this.textures.get(source);
  };

  /**
   * Add an audio buffer to load. Must be called before `client.connect`. Keep in mind this
   * only loads the audio buffer. The `Sound` or `PositionalSound` instances need to be constructed in separated.
   *
   * @param source - The source to the audio file to load from.
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
   * Get the loaded audio buffer with this function.
   *
   * @param source - The source to the audio file loaded from.
   */
  getAudioBuffer = (source: string) => {
    return this.audioBuffers.get(source);
  };

  /**
   * Load all assets other than the textures.
   *
   * @hidden
   */
  load = async () => {
    await Promise.all(Array.from(this.assetPromises.values()));

    this.assetPromises.clear();
  };

  /**
   * Load all audio loader callbacks.
   *
   * @hidden
   */
  loadAudios = async () => {
    for (const [source, callback] of this.audioCallbacks) {
      const buffer = await callback();
      this.audioBuffers.set(source, buffer);
    }

    this.audioCallbacks.clear();
  };
}

export { Loader };
