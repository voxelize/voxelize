import { DeepPartial } from "@voxelize/common";
import merge from "deepmerge";

import { Network } from "./core";

type ServerOptions = {
  port: number;
  maxClients: number;
  pingInterval: number;
};

const defaultOptions: ServerOptions = {
  port: 5000,
  maxClients: 100,
  pingInterval: 50000,
};

class Server {
  public options: ServerOptions;
  public network: Network;

  constructor(options: DeepPartial<ServerOptions>) {
    const { maxClients, pingInterval } = (this.options = merge(
      defaultOptions,
      options
    ));

    this.network = new Network({
      maxClients,
      pingInterval,
    });
  }

  listen = () => {
    const { port } = this.options;
    return new Promise<ServerOptions>((resolve) => {
      this.network.listen(port);
      resolve(this.options);
    });
  };
}

export { Server };
