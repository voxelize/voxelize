import { Instance as PeerInstance } from "simple-peer";
import { Matrix4, Quaternion, Vector3 } from "three";

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

  constructor(public id: string, public params: PeerParams) {
    const { fontFace, headDimension, headColor } = params;

    this.head = new Head({ headDimension, headColor });

    this.newPosition = this.head.mesh.position;
    this.newQuaternion = this.head.mesh.quaternion;

    this.nameMesh = new NameTag(this.name, {
      fontFace,
      fontSize: headDimension / 3,
      backgroundColor: "#00000077",
      yOffset: headDimension,
    });

    this.head.mesh.add(this.nameMesh);
  }

  set = (name: string, position: Vector3, quaternion: Quaternion) => {
    this.name = name;
    this.nameMesh.text = name;
    this.newPosition = position;
    this.newQuaternion = quaternion;
  };

  update = (camPos?: Vector3) => {
    const { lerpFactor, maxNameDistance } = this.params;

    this.head.mesh.position.lerp(this.newPosition, lerpFactor);
    this.head.mesh.quaternion.slerp(this.newQuaternion, lerpFactor);

    if (camPos) {
      this.nameMesh.visible =
        this.head.mesh.position.distanceTo(camPos) < maxNameDistance;
    }
  };

  get mesh() {
    return this.head.mesh;
  }
}

export type { PeerParams };

export { Peer };
