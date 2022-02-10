import { Instance as PeerInstance } from "simple-peer";

import { Client } from "..";
import { Peer, PeerParams } from "../libs";

import { Network } from "./network";

type PeersParams = {
  lerpFactor: number;
  headColor: string;
  headDimension: number;
  maxNameDistance: number;
};

const defaultParams: PeersParams = {
  lerpFactor: 0.6,
  headColor: "#94d0cc",
  headDimension: 0.4,
  maxNameDistance: 50,
};

class Peers extends Map<string, Peer> {
  public params: PeerParams;

  constructor(public client: Client, params: Partial<PeersParams> = {}) {
    super();

    this.params = {
      ...defaultParams,
      ...params,
    };
  }

  addPeer = (id: string, connection: PeerInstance) => {
    const { headColor, headDimension, lerpFactor, maxNameDistance } =
      this.params;

    const peer = new Peer(connection, {
      headColor,
      headDimension,
      lerpFactor,
      maxNameDistance,
    });

    // connection made
    connection.on("connect", () => {
      console.log(`connected to peer ${id}`);
    });

    // disconnected
    connection.on("error", () => {
      connection.destroy();
      this.delete(id);
    });

    // signaling
    connection.on("signal", (signal) => {
      this.client.network?.ws.sendEvent({
        type: "SIGNAL",
        json: {
          id,
          signal,
        },
      });
    });

    this.set(id, peer);
  };

  dispose = () => {
    this.forEach((peer) => {
      peer.connection.destroy();
    });
  };

  broadcast = (event: any) => {
    const encoded = Network.encode(event);

    this.forEach((peer) => {
      peer.connection.send(encoded);
    });
  };
}

export type { PeersParams };

export { Peers };
