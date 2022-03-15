import { Vector3 } from "@math.gl/core";
import {
  Entity,
  IDComponent,
  NameComponent,
  ClientComponent,
} from "@voxelize/common";
import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";

import {
  Position3DComponent,
  DirectionComponent,
  CurrentChunkComponent,
  CurrentChunk,
} from "../comps";

class ClientEntity extends Entity {
  public id: string;
  public isAlive = true;

  constructor(public socket: WebSocket) {
    super();

    this.id = uuidv4();

    this.add(new ClientComponent());

    this.add(new IDComponent(this.id));
    this.add(new NameComponent(""));

    this.add(new Position3DComponent(new Vector3()));
    this.add(new DirectionComponent(new Vector3()));

    this.add(
      new CurrentChunkComponent({
        changed: true,
        chunk: {
          x: 0,
          z: 0,
        },
      })
    );
  }

  set name(n: string) {
    NameComponent.get(this).data = n;
  }

  get name() {
    return NameComponent.get(this).data;
  }

  set position(p: Vector3) {
    Position3DComponent.get(this).data.set(p.x, p.y, p.z);
  }

  get position() {
    return Position3DComponent.get(this).data;
  }

  set direction(d: Vector3) {
    DirectionComponent.get(this).data.set(d.x, d.y, d.z);
  }

  get direction() {
    return DirectionComponent.get(this).data;
  }

  set currentChunk(c: CurrentChunk) {
    CurrentChunkComponent.get(this).data = c;
  }

  get currentChunk() {
    return CurrentChunkComponent.get(this).data;
  }

  send = (encoded: any) => {
    this.socket.send(encoded);
  };
}

export { ClientEntity };
