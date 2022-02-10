import { EventEmitter } from "events";

import { Container, Network } from "./core";

type ClientParams = {
  domElement?: HTMLElement;
  canvas?: HTMLCanvasElement;
};

class Client extends EventEmitter {
  public network: Network | undefined;

  public container: Container;

  constructor(params: ClientParams = {}) {
    super();

    const { canvas, domElement } = params;

    this.container = new Container(this, { canvas, domElement });
  }

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
    const network = new Network(this, { reconnectTimeout, serverURL });
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

  disconnect = async () => {
    if (this.network) {
      this.network.disconnect();
      console.log(`Left room "${this.network.room}"`);
    }

    this.network = undefined;
  };
}

export { Client };

export * from "./core";
