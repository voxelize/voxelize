import { LoadingManager, Texture, TextureLoader } from "three";

import { Client } from "..";

class Loader {
  public textures = new Map<string, Texture>();

  public progress = 0;

  private manager = new LoadingManager();
  private textureLoader = new TextureLoader(this.manager);
  private promises = new Map<string, Promise<void>>();

  constructor(public client: Client) {
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
