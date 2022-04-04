import { DeepPartial } from "@voxelize/common";

import { RoomParams } from "./app/room";
import { Network, Rooms } from "./core";

/**
 * Server parameters
 */
type ServerParams = {
  port: number;
};

const defaultParams: ServerParams = {
  port: 5000,
};

/**
 * A voxelize server.
 *
 * @param options - Server parameters to run a server
 */
class Server {
  public params: ServerParams;
  public network: Network;
  public rooms: Rooms;

  constructor(options: DeepPartial<ServerParams>) {
    this.params = {
      ...defaultParams,
      ...options,
    };

    this.network = new Network(this);
    this.rooms = new Rooms(this);
  }

  /**
   * Start listening on the specified port.
   *
   * @returns A promise to the server listening
   */
  listen = async () => {
    const { port } = this.params;

    return new Promise<ServerParams>((resolve) => {
      this.network.listen(port);
      resolve(this.params);
    });
  };

  /**
   * Create a room to play in.
   *
   * @param name - Name of the room
   * @param params - Parameters to create a room
   * @returns A new room instance.
   */
  createRoom = (name: string, params: Partial<RoomParams> = {}) => {
    const room = this.rooms.createRoom(name, params);
    console.log(`🚪  Room created: ${room.name}`);
    return room;
  };
}

export { Server };

export * from "./app";
export * from "./core";
