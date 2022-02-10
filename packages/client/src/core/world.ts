import { Client } from "..";

type WorldParams = {
  maxHeight: number;
  chunkSize: number;
  dimension: number;
  renderRadius: number;
};

const defaultParams: WorldParams = {
  maxHeight: 256,
  chunkSize: 16,
  dimension: 5,
  renderRadius: 8,
};

class World {
  public params: WorldParams;

  constructor(public client: Client, params: Partial<WorldParams> = {}) {
    this.params = {
      ...defaultParams,
      ...params,
    };
  }
}

export type { WorldParams };

export { World };
