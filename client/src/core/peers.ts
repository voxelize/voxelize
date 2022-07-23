import { MessageProtocol, PeerProtocol } from "@voxelize/transport/src/types";
import { Matrix4, Vector3, Quaternion, Object3D } from "three";

import { NetIntercept } from "./network";

/**
 * A **built-in** manager for the peer clients in the same Voxelize world.
 *
 * @noInheritDoc
 * @category Core
 */
export class Peers<T = { direction: number[]; position: number[] }>
  implements NetIntercept
{
  public ownID = "";
  public ownUsername = "";

  public packets: MessageProtocol<any, any, any, any>[] = [];

  constructor(public object: Object3D) {}

  public onPeerJoin: (id: string) => void;
  public onPeerUpdate: (peer: PeerProtocol<T>) => void;
  public onPeerLeave: (id: string) => void;

  public onMessage = (
    message: MessageProtocol<{ id: string }, T>,
    { username }: { username: string }
  ) => {
    this.ownUsername = username;

    switch (message.type) {
      case "INIT": {
        const { id } = message.json;
        this.ownID = id;
        break;
      }
      case "JOIN": {
        const { text: id } = message;
        if (!this.ownID || this.ownID === id) return;
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
        if (!this.ownID || peer.id === this.ownID) return;
        if (message.type === "INIT") this.onPeerJoin?.(peer.id);
        this.onPeerUpdate?.(peer);
      });
    }
  };

  public packInfo = () => {
    const {
      x: dx,
      y: dy,
      z: dz,
    } = new Vector3(0, 0, -1)
      .applyQuaternion(this.object.quaternion)
      .normalize();
    const { x: px, y: py, z: pz } = this.object.position;

    return {
      id: this.ownID,
      username: this.ownUsername,
      metadata: {
        position: [px, py, pz],
        direction: [dx, dy, dz],
      } as any as T,
    } as PeerProtocol<T>;
  };

  public update = () => {
    const event: MessageProtocol = {
      type: "PEER",
      peers: [this.packInfo()],
    };

    this.packets.push(event);
  };

  static directionToQuaternion = (dx: number, dy: number, dz: number) => {
    const toQuaternion = (() => {
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

    return toQuaternion();
  };
}
