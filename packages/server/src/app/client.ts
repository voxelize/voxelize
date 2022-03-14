import { Vector3 } from "@math.gl/core";
import { Component, Entity } from "@voxelize/common";
import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";

import { Network } from "../core/network";

import {
  IDComponent,
  PositionComponent,
  NameComponent,
  DirectionComponent,
} from "./comps";

const ClientComponent = Component.register();

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
  }

  setName = (name: string) => {
    NameComponent.get(this).data = name;
  };

  setPosition = (x: number, y: number, z: number) => {
    PositionComponent.get(this).data.set(x, y, z);
  };

  setDirection = (x: number, y: number, z: number) => {
    DirectionComponent.get(this).data.set(x, y, z);
  };

  send = (data: any) => {
    this.socket.send(Network.encode(data));
  };
}

export { ClientEntity, ClientComponent, PositionComponent };
