import { Instance as PeerInstance } from "simple-peer";

import { Client } from "..";
import { Peer, PeerParams } from "../libs";

import { Network } from "./network";

type PeersParams = {
  lerpFactor: number;
  headColor: string;
  headDimension: number;
  maxNameDistance: number;
  fontFace: string;
};

const defaultParams: PeersParams = {
  lerpFactor: 0.6,
  headColor: "#94d0cc",
  headDimension: 0.4,
  maxNameDistance: 50,
  fontFace: `'Syne Mono', monospace`,
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
    const { headColor, headDimension, lerpFactor, maxNameDistance, fontFace } =
      this.params;
    const { scene } = this.client.rendering;

    const peer = new Peer(id, connection, {
      headColor,
      headDimension,
      lerpFactor,
      maxNameDistance,
      fontFace,
    });

    // connection made
    connection.on("connect", () => {
      console.log(`connected to peer ${id}`);
      peer.connected = true;
      scene.add(peer.mesh);
    });

    // disconnected
    connection.on("error", () => {
      console.log(`disconnected from peer ${id}`);
      this.removePeer(peer);
    });

    // signaling
    connection.on("signal", (signal) => {
      this.client.network?.send({
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
      this.removePeer(peer);
    });
  };

  broadcast = (encoded: any) => {
    this.forEach((peer) => {
      if (peer.connected && peer.connection.connected) {
        peer.connection.send(encoded);
      }
    });
  };

  update = () => {
    const { name, controls, network } = this.client;

    const { id } = network;
    const { object } = controls;
    const {
      position: { x: px, y: py, z: pz },
    } = object;
    const { x: dx, y: dy, z: dz } = controls.getDirection();

    const event = {
      type: "PEER",
      peer: {
        id,
        name,
        position: {
          x: px,
          y: py,
          z: pz,
        },
        direction: {
          x: dx,
          y: dy,
          z: dz,
        },
      },
    };

    const encoded = Network.encode(event);
    network.ws.send(encoded);

    if (this.size > 0) {
      this.broadcast(encoded);
    }

    this.forEach((peer) => {
      peer.update();
    });
  };

  private removePeer = (peer: Peer) => {
    peer.connected = false;
    peer.connection.destroy();
    this.client.rendering.scene.remove(peer.mesh);
    this.delete(peer.id);
  };
}

export type { PeersParams };

export { Peers };
