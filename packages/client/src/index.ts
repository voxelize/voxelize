import { Network } from "./core";

type ClientOptions = {
  network: Network;
};

class Client {
  public network: Network;

  constructor({ network }: ClientOptions) {
    this.network = network;
  }

  connect = async (room: string) => {
    const hasRoom = await this.network.fetch("has-room", { room });

    if (!hasRoom) {
      console.error("Room not found.");
      return false;
    }

    this.network.connect(room);
    return true;
  };
}

export { Client };

export * from "./core";
