import { Client } from "..";
import { Sky } from "../libs";

type WorldParams = {
  chunkSize: number;
  maxHeight: number;
  maxLightLevel: number;
  dimension: number;
  minChunk: [number, number];
  maxChunk: [number, number];
};

type WorldInitParams = {
  skyDimension: number;
};

const defaultParams: WorldInitParams = {
  skyDimension: 1000,
};

class World {
  public params: WorldParams;

  public sky: Sky;

  constructor(public client: Client, params: Partial<WorldInitParams> = {}) {
    const { skyDimension } = { ...defaultParams, ...params };

    this.sky = new Sky(skyDimension);

    this.client.rendering.scene.add(this.sky.mesh);
  }

  /**
   * Applies the server settings onto this world.
   * Caution: do not call this after game started!
   *
   * @memberof World
   */
  setParams = (data: Omit<WorldParams, "dimension">) => {
    this.params = {
      ...data,
      dimension: 1,
    };

    this.client.emit("ready");
    this.client.ready = true;
  };

  setDimension = (value: number) => {
    this.params.dimension = value;

    // TODO: scale the chunks
  };

  update = () => {
    const [px, , pz] = this.client.controls.position;
    this.sky.mesh.position.set(px, 0, pz);
  };
}

export type { WorldInitParams };

export { World };
