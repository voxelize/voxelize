import { Instance as PeerInstance } from "simple-peer";
import { NearestFilter, Quaternion, Vector3 } from "three";
import SpriteText from "three-spritetext";

import { Network } from "../core";

import { Head } from "./head";

type PeerParams = {
  lerpFactor: number;
  headColor: string;
  headDimension: number;
  maxNameDistance: number;
};

class Peer {
  public head: Head;

  public name = "testtesttest";
  public newPosition: Vector3;
  public newQuaternion: Quaternion;
  public nameMesh: SpriteText;

  constructor(public connection: PeerInstance, public params: PeerParams) {
    const { headDimension } = params;

    this.head = new Head({ headDimension });

    this.newPosition = this.head.mesh.position;
    this.newQuaternion = this.head.mesh.quaternion;

    this.nameMesh = new SpriteText(this.name, headDimension / 3);
    this.nameMesh.fontFace = "Ponderosa";
    this.nameMesh.position.y += headDimension * 1;
    this.nameMesh.backgroundColor = "#00000077";
    this.nameMesh.material.depthTest = false;
    this.nameMesh.renderOrder = 1000000;

    const image = this.nameMesh.material.map;

    if (image) {
      image.minFilter = NearestFilter;
      image.magFilter = NearestFilter;
    }

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

  tick = (camPos: Vector3) => {
    const { lerpFactor, maxNameDistance } = this.params;

    this.head.mesh.position.lerp(this.newPosition, lerpFactor);
    this.head.mesh.quaternion.slerp(this.newQuaternion, lerpFactor);

    this.nameMesh.visible =
      this.head.mesh.position.distanceTo(camPos) < maxNameDistance;
  };

  private onData = (data: any) => {
    console.log(data);
  };

  get mesh() {
    return this.head.mesh;
  }
}

export type { PeerParams };

export { Peer };
