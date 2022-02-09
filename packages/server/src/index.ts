import { DeepPartial } from "@voxelize/common";
import merge from "deepmerge";

import { Network, Rooms } from "./core";

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
  public rooms: Rooms;

  constructor(options: DeepPartial<ServerOptions>) {
    const { maxClients, pingInterval } = (this.options = merge(
      defaultOptions,
      options
    ));

    this.network = new Network(this, {
      test: "test",
    });

    this.rooms = new Rooms(this, {
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

  createRoom = (name: string) => {
    const room = this.rooms.createRoom(name);
    console.log(`🚪  Room created: ${room.name}`);
    return room;
  };
}

export { Server };
