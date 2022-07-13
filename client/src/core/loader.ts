import {
  AudioLoader,
  LoadingManager,
  Texture,
  TextureLoader,
  Audio,
  PositionalAudio,
} from "three";

import { Client } from "..";

/**
 * A **built-in** loader for Voxelize.
 *
 * @category Core
 */
class Loader {
  /**
   * Reference linking back to the Voxelize client instance.
   */
  public client: Client;

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
  private texturePromises = new Map<string, Promise<void>>();
  private audioLoader = new AudioLoader(this.manager);
  private audioCallbacks = new Map<string, () => Promise<AudioBuffer>>();

  /**
   * Construct a Voxelize loader.
   *
   * @hidden
   */
  constructor(client: Client) {
    this.client = client;

    this.manager.onProgress = (_, loaded, total) => {
      this.progress = loaded / total;
    };
  }

  /**
   * Add a texture source to load from. Must be called before `client.connect`.
   *
   * @param source - The source to the texture file to load from.
   */
  addTexture = (source: string) => {
    if (this.client.ready) {
      throw new Error("Cannot add texture after client has started!");
    }

    this.texturePromises.set(
      source,
      new Promise((resolve) => {
        this.textureLoader.load(source, (texture) => {
          this.textures.set(source, texture);
          this.texturePromises.delete(source);

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
   * Add an audio source to load from. Must be called before `client.connect`. Keep in mind this
   * only loads the audio buffer. The `Sound` or `PositionalSound` instances need to be constructed in separated.
   *
   * @param source - The source to the audio file to load from.
   */
  addAudioSource = (source: string) => {
    if (this.client.ready) {
      throw new Error("Cannot add audio after client has started!");
    }

    const callback = async () => {
      return new Promise<AudioBuffer>((resolve) => {
        this.audioLoader.load(source, (buffer) => {
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
   * Load all texture loader promises.
   *
   * @hidden
   */
  loadTextures = async () => {
    await Promise.all(Array.from(this.texturePromises.values()));

    this.texturePromises.clear();
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
