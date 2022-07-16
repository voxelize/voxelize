import { MessageProtocol } from "@voxelize/transport/src/types";
import { Matrix4, Vector3, Quaternion } from "three";

import { Client } from "..";
import { Head, NameTag } from "../libs";

import { NetIntercept } from "./network";

type PeerParams = {
  lerpFactor: number;
  headColor: string;
  headDimension: number;
  maxNameDistance: number;
  fontFace: string;
};

const defaultPeerParams: PeerParams = {
  lerpFactor: 0.6,
  headColor: "#94d0cc",
  headDimension: 0.4,
  maxNameDistance: 50,
  fontFace: `monospace`,
};

class Peer {
  public head: Head;
  public params: PeerParams;

  public connected = false;

  public username = "testtesttest";
  public newPosition: Vector3;
  public newQuaternion: Quaternion;
  public usernameMesh: NameTag;

  constructor(public id: string, params: Partial<PeerParams> = {}) {
    const { fontFace, headDimension, headColor } = (this.params = {
      ...defaultPeerParams,
      ...params,
    });

    this.head = new Head({ headDimension, headColor });

    this.newPosition = this.head.mesh.position;
    this.newQuaternion = this.head.mesh.quaternion;

    this.usernameMesh = new NameTag(this.username, {
      fontFace,
      fontSize: headDimension / 3,
      backgroundColor: "#00000077",
      yOffset: headDimension,
    });

    this.head.mesh.add(this.usernameMesh);
  }

  set = (username: string, position: Vector3, quaternion: Quaternion) => {
    this.username = username;
    this.usernameMesh.text = username;
    this.newPosition = position;
    this.newQuaternion = quaternion;
  };

  update = (camPos?: Vector3) => {
    const { lerpFactor, maxNameDistance } = this.params;

    this.head.mesh.position.lerp(this.newPosition, lerpFactor);
    this.head.mesh.quaternion.slerp(this.newQuaternion, lerpFactor);

    if (camPos) {
      this.usernameMesh.visible =
        this.head.mesh.position.distanceTo(camPos) < maxNameDistance;
    }
  };

  get mesh() {
    return this.head.mesh;
  }
}

/**
 * Parameters to initialize the {@link Peers} manager for Voxelize.
 */
type PeersParams = {
  /**
   * The interpolation factor between each peer update. Defaults to 0.6.
   */
  lerpFactor: number;

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
  maxNameDistance: 50,
  fontFace: `monospace`,
};

/**
 * A **built-in** manager for the peer clients in the same Voxelize world.
 *
 * @noInheritDoc
 * @category Core
 */
class Peers extends Map<string, Peer> implements NetIntercept {
  /**
   * Reference linking back to the Voxelize client instance.
   */
  public client: Client;

  /**
   * Parameters to initialize the Peers manager.
   */
  public params: PeersParams;

  /**
   * The prototype for the peer entity.
   */
  public prototype: new (id: string, ...args: any) => Peer = Peer;

  /**
   * A function called before every update per tick.
   */
  public onBeforeUpdate?: () => void;

  /**
   * A function called after every update per tick.
   */
  public onAfterUpdate?: () => void;

  /**
   * Initialize a Peers manager for Voxelize.
   *
   * @hidden
   */
  constructor(client: Client, params: Partial<PeersParams> = {}) {
    super();

    this.params = {
      ...defaultParams,
      ...params,
    };

    this.client = client;
  }

  onMessage = (message: MessageProtocol) => {
    switch (message.type) {
      case "JOIN": {
        const { text: id } = message;
        if (!this.client.id || this.client.id === id) return;
        this.addPeer(id);
        break;
      }
      case "LEAVE": {
        const { text: id } = message;
        this.removePeer(id);
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
        this.client.peers.updatePeer(peer);
      });
    }
  };

  /**
   * Reset the peers map.
   *
   * @internal
   * @hidden
   */
  reset = () => {
    this.forEach((peer) => {
      this.removePeer(peer.id);
    });
  };

  /**
   * Add a Voxelize peer, initializing its mesh.
   *
   * @param id - ID of the new peer.
   */
  addPeer = (id: string) => {
    if (!this.client.id || id === this.client.id) return;

    const { lerpFactor, maxNameDistance, fontFace } = this.params;
    const { scene } = this.client.rendering;

    const peer = new this.prototype(id, {
      lerpFactor,
      maxNameDistance,
      fontFace,
    });

    scene.add(peer.mesh);

    this.set(id, peer);

    return peer;
  };

  /**
   * Update a peer instance to server data.
   *
   * @internal
   * @hidden
   */
  updatePeer = (peer: any) => {
    if (peer.metadata.username === this.client.username) {
      return;
    }

    console.log(peer);

    const { id } = peer;
    const instance = this.get(id) || this.addPeer(id);

    if (instance) {
      const {
        username,
        metadata: {
          position: [px, py, pz],
          direction: [dx, dy, dz],
        },
      } = peer;

      const { bodyHeight, eyeHeight } = this.client.controls.params;

      const position = new Vector3(px, py + bodyHeight * (eyeHeight - 0.5), pz);

      // using closure to reuse objects
      // reference: https://stackoverflow.com/questions/32849600/direction-vector-to-a-rotation-three-js
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

      const quaternion = updateQuaternion();

      instance.set(username, position, quaternion);
    }
  };

  /**
   * Remove a peer from the Voxelize world.
   *
   * @param id - ID of the peer that left.
   */
  removePeer = (id: string) => {
    const peer = this.get(id);

    if (peer) {
      peer.connected = false;
      this.client.rendering.scene.remove(peer.mesh);
      this.delete(id);
    }
  };

  update = () => {
    this.onBeforeUpdate?.();

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

    this.forEach((peer) => {
      peer.update();
    });

    this.onAfterUpdate?.();
  };
}

export type { PeerParams, PeersParams };

export { Peer, Peers };
