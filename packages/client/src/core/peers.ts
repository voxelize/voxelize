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
      this.removePeer(peer);
    });
  };

  broadcast = (event: any) => {
    const encoded = Network.encode(event);

    this.forEach((peer) => {
      if (peer.connected && peer.connection.connected) {
        peer.connection.send(encoded);
      }
    });
  };

  tick = () => {
    const { name, controls, peers } = this.client;

    if (peers.size > 0) {
      const { object } = controls;
      const {
        position: { x: px, y: py, z: pz },
      } = object;
      const { x: dx, y: dy, z: dz } = controls.getDirection();

      peers.broadcast({
        type: "PEER",
        peer: {
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
      });
    }

    this.forEach((peer) => {
      peer.tick();
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
