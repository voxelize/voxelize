import { DeepPartial } from "@voxelize/common";

import { RoomParams } from "./app/room";
import { Network, Rooms } from "./core";

type ServerParams = {
  port: number;
};

const defaultParams: ServerParams = {
  port: 5000,
};

class Server {
  public params: ServerParams;
  public network: Network;
  public rooms: Rooms;

  constructor(options: DeepPartial<ServerParams>) {
    this.params = {
      ...defaultParams,
      ...options,
    };

    this.network = new Network(this, {
      test: "test",
    });

    this.rooms = new Rooms(this);
  }

  listen = async () => {
    const { port } = this.params;

    return new Promise<ServerParams>((resolve) => {
      this.network.listen(port);
      resolve(this.params);
    });
  };

  createRoom = (name: string, params: Partial<RoomParams> = {}) => {
    const room = this.rooms.createRoom(name, params);
    console.log(`🚪  Room created: ${room.name}`);
    return room;
  };
}

export { Server };

export * from "./app";
export * from "./core";
