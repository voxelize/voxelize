import { Client } from "..";

type WorldParams = {
  chunkSize: number;
  maxHeight: number;
  maxLightLevel: number;
  dimension: number;
  minChunk: [number, number];
  maxChunk: [number, number];
};

class World {
  public params: WorldParams;

  constructor(public client: Client) {}

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
}

export { World };
