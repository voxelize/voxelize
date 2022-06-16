import { LoadingManager, Texture, TextureLoader } from "three";

import { Client } from "..";

/**
 * A **built-in** loader for Voxelize.
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
   * The progress at which Loader has loaded, zero to one.
   */
  public progress = 0;

  private manager = new LoadingManager();
  private textureLoader = new TextureLoader(this.manager);
  private promises = new Map<string, Promise<void>>();

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

    this.promises.set(
      source,
      new Promise((resolve) => {
        this.textureLoader.load(source, (texture) => {
          this.textures.set(source, texture);
          this.promises.delete(source);

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
   * Load all loader promises.
   *
   * @hidden
   */
  load = async () => {
    await Promise.all(Array.from(this.promises.values()));
  };
}

export { Loader };
