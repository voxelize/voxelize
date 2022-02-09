import { Network } from "./core";

class Client {
  public network: Network;

  connect = async ({
    room,
    serverURL,
    reconnectTimeout,
  }: {
    room: string;
    serverURL: string;
    reconnectTimeout?: number;
  }) => {
    reconnectTimeout = reconnectTimeout || 5000;

    // re-instantiate networking instance
    const network = new Network({ reconnectTimeout, serverURL });
    const hasRoom = await network.fetch("has-room", { room });

    if (!hasRoom) {
      console.error("Room not found.");
      return false;
    }

    network.connect(room).then(() => {
      console.log(`Joined room "${room}"`);
    });

    this.network = network;

    return true;
  };
}

export { Client };

export * from "./core";
