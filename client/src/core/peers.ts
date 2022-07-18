import { MessageProtocol, PeerProtocol } from "@voxelize/transport/src/types";
import { Matrix4, Vector3, Quaternion } from "three";

import { Client } from "..";

import { NetIntercept } from "./network";

/**
 * A **built-in** manager for the peer clients in the same Voxelize world.
 *
 * @noInheritDoc
 * @category Core
 */
class Peers<T> implements NetIntercept {
  /**
   * Reference linking back to the Voxelize client instance.
   */
  public client: Client;

  /**
   * Initialize a Peers manager for Voxelize.
   *
   * @hidden
   */
  constructor(client: Client) {
    this.client = client;
  }

  onPeerJoin: (id: string) => void;
  onPeerUpdate: (peer: PeerProtocol<T>) => void;
  onPeerLeave: (id: string) => void;

  onMessage = (message: MessageProtocol<any, T>) => {
    switch (message.type) {
      case "JOIN": {
        const { text: id } = message;
        if (!this.client.id || this.client.id === id) return;
        this.onPeerJoin?.(id);
        break;
      }
      case "LEAVE": {
        const { text: id } = message;
        this.onPeerLeave?.(id);
        break;
      }
      default: {
        break;
      }
    }

    const { peers } = message;

    if (peers) {
      peers.forEach((peer: any) => {
        if (!this.client.id || peer.id === this.client.id) return;
        this.onPeerUpdate?.(peer);
      });
    }
  };

  update = () => {
    const { username, controls, network, id } = this.client;

    const { body } = controls;
    const [px, py, pz] = body.getPosition();
    const { x: dx, y: dy, z: dz } = controls.getDirection();

    const event = {
      type: "PEER",
      peers: [
        {
          id,
          username,
          metadata: {
            position: [px, py, pz],
            direction: [dx, dy, dz],
          },
        },
      ],
    };

    network.send(event);
  };

  static directionToQuaternion = (dx: number, dy: number, dz: number) => {
    const updateQuaternion = (() => {
      const m = new Matrix4();
      const q = new Quaternion();
      const zero = new Vector3(0, 0, 0);
      const one = new Vector3(0, 1, 0);

      return () => {
        return q.setFromRotationMatrix(
          m.lookAt(new Vector3(dx, dy, dz), zero, one)
        );
      };
    })();

    return updateQuaternion();
  };
}

export { Peers };
