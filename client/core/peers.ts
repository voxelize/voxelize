import { Matrix4, Vector3, Quaternion } from "three";

import { Client } from "..";
import { Peer, PeerParams } from "../libs";

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
   * Add a Voxelize peer, initializing its mesh and network connection.
   *
   * @internal
   * @hidden
   */
  addPeer = (id: string) => {
    const { headColor, headDimension, lerpFactor, maxNameDistance, fontFace } =
      this.params;
    const { scene } = this.client.rendering;

    const peer = new Peer(id, {
      headColor,
      headDimension,
      lerpFactor,
      maxNameDistance,
      fontFace,
    });
    scene.add(peer.mesh);

    this.set(id, peer);
  };

  /**
   * Update a peer instance to server data.
   *
   * @internal
   * @hidden
   */
  updatePeer = (peer: any) => {
    const { id } = peer;
    const instance = this.get(id);

    if (instance) {
      const {
        name,
        position: { x: px, y: py, z: pz },
        direction: { x: dx, y: dy, z: dz },
      } = peer;

      const { bodyHeight, eyeHeight } = this.client.controls.params;

      const position = new Vector3(px, py - bodyHeight / 2 + eyeHeight, pz);

      // using closure to reuse objects
      // reference: https://stackoverflow.com/questions/32849600/direction-vector-to-a-rotation-three-js
      const updateQuaternion = () => {
        const m = new Matrix4();
        const q = new Quaternion();
        const zero = new Vector3(0, 0, 0);
        const one = new Vector3(0, 1, 0);

        return () => {
          return q.setFromRotationMatrix(
            m.lookAt(new Vector3(dx, dy, dz), zero, one)
          );
        };
      };

      const quaternion = updateQuaternion()();

      instance.set(name, position, quaternion);
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
    const { name, controls, network, id } = this.client;

    const { body } = controls;
    const [px, py, pz] = body.getPosition();
    const { x: dx, y: dy, z: dz } = controls.getDirection();

    const event = {
      type: "PEER",
      peers: [
        {
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
      ],
    };

    network.send(event);

    this.forEach((peer) => {
      peer.update();
    });
  };
}

export type { PeersParams };

export { Peers };
