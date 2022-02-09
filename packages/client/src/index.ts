import { Network } from "./core";

type ClientOptions = {
  network: Network;
};

class Client {
  public network: Network;

  constructor({ network }: ClientOptions) {
    this.network = network;
  }

  connect = () => {
    this.network.connect();
  };
}

export { Client };

export * from "./core";
