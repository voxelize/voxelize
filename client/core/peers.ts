import { Instance as PeerInstance } from "simple-peer";

import { Client } from "..";
import { Peer, PeerParams } from "../libs";

import { Network } from "./network";

/**
 * Parameters to initialize the {@link Peers} manager for Voxelize.
 */
type PeersParams = {
  /**
   * The interpolation factor between each peer update. Defaults to 0.6.
   */
  lerpFactor: number;

  /**
   * The background color of the peer head mesh. Defaults to `#94d0cc`.
   */
  headColor: string;

  /**
   * The dimension of the peer head mesh. Defaults to 0.4.
   */
  headDimension: number;

  /**
   * The maximum distance, in blocks, at which the peer's nametag will still be rendered. Defaults to 50 voxels.
   */
  maxNameDistance: number;

  /**
   * The font for the peer's nametag. Defaults to `monospace`.
   */
  fontFace: string;
};

const defaultParams: PeersParams = {
  lerpFactor: 0.6,
  headColor: "#94d0cc",
  headDimension: 0.4,
  maxNameDistance: 50,
  fontFace: `monospace`,
};

/**
 * A **built-in** manager for the peer clients in the same Voxelize world.
 *
 * @noInheritDoc
 */
class Peers extends Map<string, Peer> {
  /**
   * Reference linking back to the Voxelize client instance.
   */
  public client: Client;

  /**
   * Parameters to initialize the Peers manager.
   */
  public params: PeerParams;

  /**
   * Initialize a Peers manager for Voxelize.
   *
   * @hidden
   */
  constructor(client: Client, params: Partial<PeersParams> = {}) {
    super();

    this.client = client;

    this.params = {
      ...defaultParams,
      ...params,
    };
  }

  /**
   * Send a protocol buffer event to all peers.
   *
   * @param event - A protocol buffer object.
   */
  broadcast = (event: any) => {
    const encoded = Network.encode(event);
    this.forEach((peer) => {
      if (peer.connected && peer.connection.connected) {
        peer.connection.send(encoded);
      }
    });
  };

  /**
   * Reset the peers map.
   *
   * @internal
   * @hidden
   */
  reset = () => {
    this.forEach((peer) => {
      this.removePeer(peer);
    });
  };

  /**
   * Add a Voxelize peer, initializing its mesh and network connection.
   *
   * @internal
   * @hidden
   */
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

    const disconnection = () => {
      console.log(`disconnected from peer ${id}`);
      this.removePeer(peer);
    };

    // disconnected
    connection.on("end", disconnection);
    connection.on("error", disconnection);
    connection.on("close", disconnection);

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

    // updating
    connection.on("data", (data) => {
      this.client.network.decode(data).then((decoded) => {
        peer.onData(decoded);
      });
    });

    this.set(id, peer);
  };

  update = () => {
    const { name, controls, network, id } = this.client;

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

    network.send(event);

    if (this.size > 0) {
      this.broadcast(event);
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
