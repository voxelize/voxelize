import { DeepPartial } from "@voxelize/common";
import merge from "deepmerge";

import { Network, Rooms } from "./core";

type ServerParams = {
  port: number;
  maxClients: number;
  pingInterval: number;
};

const defaultParams: ServerParams = {
  port: 5000,
  maxClients: 100,
  pingInterval: 50000,
};

class Server {
  public params: ServerParams;
  public network: Network;
  public rooms: Rooms;

  constructor(options: DeepPartial<ServerParams>) {
    const { maxClients, pingInterval } = (this.params = merge(
      defaultParams,
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
    const { port } = this.params;
    return new Promise<ServerParams>((resolve) => {
      this.network.listen(port);
      resolve(this.params);
    });
  };

  createRoom = (name: string) => {
    const room = this.rooms.createRoom(name);
    console.log(`🚪  Room created: ${room.name}`);
    return room;
  };
}

export { Server };
