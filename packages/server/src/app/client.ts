import { Vector2, Vector3 } from "@math.gl/core";
import {
  Entity,
  IDComponent,
  NameComponent,
  ClientComponent,
} from "@voxelize/common";
import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";

import { Network } from "../core/network";

import {
  PositionComponent,
  DirectionComponent,
  CurrentChunkComponent,
} from "./comps";

class ClientEntity extends Entity {
  public id: string;
  public isAlive = true;

  constructor(public socket: WebSocket) {
    super();

    this.id = uuidv4();

    this.add(new ClientComponent());
    this.add(new IDComponent(this.id));
    this.add(new NameComponent(""));
    this.add(new PositionComponent(new Vector3()));
    this.add(new DirectionComponent(new Vector3()));
    this.add(new CurrentChunkComponent(new Vector2()));
  }

  set name(n: string) {
    NameComponent.get(this).data = n;
  }

  get name() {
    return NameComponent.get(this).data;
  }

  set position(p: Vector3) {
    PositionComponent.get(this).data.set(p.x, p.y, p.z);
  }

  get position() {
    return PositionComponent.get(this).data;
  }

  set direction(d: Vector3) {
    DirectionComponent.get(this).data.set(d.x, d.y, d.z);
  }

  get direction() {
    return DirectionComponent.get(this).data;
  }

  set currentChunk(c: Vector2) {
    CurrentChunkComponent.get(this).data.copy(c);
  }

  get currentChunk() {
    return CurrentChunkComponent.get(this).data;
  }

  send = (data: any) => {
    this.socket.send(Network.encode(data));
  };
}

export { ClientEntity };
