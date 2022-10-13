import { MessageProtocol, PeerProtocol } from "@voxelize/transport/src/types";
import { Matrix4, Vector3, Quaternion, Object3D, Group } from "three";

import { Character } from "../libs";

import { NetIntercept } from "./network";

const emptyQ = new Quaternion();
const emptyP = new Vector3();

/**
 * A **built-in** manager for the peer clients in the same Voxelize world.
 *
 * @noInheritDoc
 * @category Core
 */
export class Peers<
    C extends Object3D = Object3D,
    T = { direction: number[]; position: number[] }
  >
  extends Group
  implements NetIntercept
{
  public ownID = "";
  public ownUsername = "";

  public packets: MessageProtocol<any, any, any, any>[] = [];

  constructor(
    public object?: Object3D,
    public params: { countSelf: boolean } = { countSelf: false }
  ) {
    super();
  }

  public createPeer: (id: string) => C;

  public onPeerJoin = (id: string) => {
    if (!this.createPeer) {
      console.warn("Peers.createPeer is not defined, skipping peer join.");
      return;
    }

    const peer = this.createPeer(id);
    peer.name = id;
    this.add(peer);
  };

  public onPeerUpdate: (object: C, data: T) => void;

  public onPeerLeave = (id: string) => {
    const peer = this.getObjectByName(id);
    if (peer) this.remove(peer);
  };

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
        if (!this.params.countSelf && (!this.ownID || this.ownID === id))
          return;
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
        if (!this.params.countSelf && (!this.ownID || peer.id === this.ownID))
          return;
        if (message.type === "INIT") this.onPeerJoin?.(peer.id);
        this.onPeerUpdate?.(
          this.getObjectByName(peer.id) as any,
          peer.metadata
        );
      });
    }
  };

  public packInfo = () => {
    if (!this.object) return;

    const {
      x: dx,
      y: dy,
      z: dz,
    } = new Vector3(0, 0, -1)
      .applyQuaternion(this.object.getWorldQuaternion(emptyQ))
      .normalize();
    const { x: px, y: py, z: pz } = this.object.getWorldPosition(emptyP);

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
    if (!this.object) return;

    const event: MessageProtocol = {
      type: "PEER",
      peers: [this.packInfo()],
    };

    this.packets.push(event);

    this.children.forEach((child) => {
      if (child instanceof Character) {
        // @ts-ignore
        child.update();
      }
    });
  };

  static directionToQuaternion = (dx: number, dy: number, dz: number) => {
    const toQuaternion = (() => {
      const m = new Matrix4();
      const q = new Quaternion();
      const zero = new Vector3(0, 0, 0);
      const one = new Vector3(0, 1, 0);

      return () => {
        return q.setFromRotationMatrix(
          m.lookAt(new Vector3(-dx, -dy, -dz), zero, one)
        );
      };
    })();

    return toQuaternion();
  };
}
