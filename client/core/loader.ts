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

  addTexture = (source: string) => {
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

  getTexture = (source: string) => {
    return this.textures.get(source);
  };

  load = async () => {
    await Promise.all(Array.from(this.promises.values()));

    this.client.emit("loaded");
  };
}

export { Loader };
