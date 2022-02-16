import { Instance as PeerInstance } from "simple-peer";
import { Matrix4, Quaternion, Vector3 } from "three";

import { Network } from "../core";

import { Head } from "./head";
import { NameTag } from "./nametag";

type PeerParams = {
  lerpFactor: number;
  headColor: string;
  headDimension: number;
  maxNameDistance: number;
  fontFace: string;
};

class Peer {
  public head: Head;

  public connected = false;

  public name = "testtesttest";
  public newPosition: Vector3;
  public newQuaternion: Quaternion;
  public nameMesh: NameTag;

  constructor(
    public id: string,
    public connection: PeerInstance,
    public params: PeerParams
  ) {
    const { fontFace, headDimension } = params;

    this.head = new Head({ headDimension });

    this.newPosition = this.head.mesh.position;
    this.newQuaternion = this.head.mesh.quaternion;

    this.nameMesh = new NameTag(this.name, {
      fontFace,
      fontSize: headDimension / 3,
      backgroundColor: "#00000077",
      yOffset: headDimension,
    });

    this.head.mesh.add(this.nameMesh);

    connection.on("data", (data) => {
      const decoded = Network.decode(data);
      this.onData(decoded);
    });
  }

  update = (name: string, position: Vector3, quaternion: Quaternion) => {
    this.name = name;
    this.nameMesh.text = name;
    this.newPosition = position;
    this.newQuaternion = quaternion;
  };

  tick = (camPos?: Vector3) => {
    const { lerpFactor, maxNameDistance } = this.params;

    this.head.mesh.position.lerp(this.newPosition, lerpFactor);
    this.head.mesh.quaternion.slerp(this.newQuaternion, lerpFactor);

    if (camPos) {
      this.nameMesh.visible =
        this.head.mesh.position.distanceTo(camPos) < maxNameDistance;
    }
  };

  private onData = (data: any) => {
    const { type } = data;

    switch (type) {
      case "PEER": {
        const { peer } = data;
        if (peer) {
          const {
            name,
            position: { x: px, y: py, z: pz },
            direction: { x: dx, y: dy, z: dz },
          } = peer;

          const position = new Vector3(px, py, pz);

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

          this.update(name, position, quaternion);
        }
        break;
      }
    }
  };

  get mesh() {
    return this.head.mesh;
  }
}

export type { PeerParams };

export { Peer };
