import { Vector3 } from "@math.gl/core";
import {
  Entity,
  IDComponent,
  NameComponent,
  ClientFlag,
} from "@voxelize/common";
import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";

import {
  Position3DComponent,
  DirectionComponent,
  ChunkRequestsComponent,
  CurrentChunkComponent,
  CurrentChunk,
} from "../comps";

/**
 * Entity for clients.
 *
 * Contains the following components by default:
 * - `ClientFlag`
 * - `IDComponent`
 * - `NameComponent`
 * - `Position3DComponent`
 * - `DirectionComponent`
 * - `ChunkRequestsComponent`
 * - `CurrentChunkComponent`
 *
 * @extends {Entity}
 */
class Client extends Entity {
  public id: string;
  public isAlive = true;

  constructor(public socket: WebSocket) {
    super();

    this.id = uuidv4();

    this.add(new ClientFlag());

    this.add(new IDComponent(this.id));
    this.add(new NameComponent(""));

    this.add(new Position3DComponent(new Vector3()));
    this.add(new DirectionComponent(new Vector3()));
    this.add(new ChunkRequestsComponent([]));

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

  /**
   * Setter for the `NameComponent` of client.
   *
   * @param n - Value for new name
   */
  set name(n: string) {
    NameComponent.get(this).data = n;
  }

  /**
   * Getter for the `NameComponent` of client.
   *
   * @readonly
   */
  get name() {
    return NameComponent.get(this).data;
  }

  /**
   * Setter for the `Position3DComponent` of client.
   *
   * @param p - `Vector3` of new position
   */
  set position(p: Vector3) {
    Position3DComponent.get(this).data.set(p.x, p.y, p.z);
  }

  /**
   * Getter for the `Position3DComponent` of client.
   *
   * @readonly
   */
  get position() {
    return Position3DComponent.get(this).data;
  }

  /**
   * Setter for the `DirectionComponent` of client.
   *
   * @param d - `Vector3` of new direction
   */
  set direction(d: Vector3) {
    DirectionComponent.get(this).data.set(d.x, d.y, d.z);
  }

  /**
   * Getter for the `DirectionComponent` of client.
   *
   * @readonly
   */
  get direction() {
    return DirectionComponent.get(this).data;
  }

  /**
   * Setter for the `CurrentChunkComponent` of client.
   *
   * @param c - `CurrentChunk` for new current chunk
   */
  set currentChunk(c: CurrentChunk) {
    CurrentChunkComponent.get(this).data = c;
  }

  /**
   * Getter for the `CurrentChunkComponent` of client.
   *
   * @readonly
   */
  get currentChunk() {
    return CurrentChunkComponent.get(this).data;
  }

  /**
   * Send an encoded message to the client's web socket.
   *
   * @param encoded - Anything to send to client, needs
   *  to be encoded to protocol buffers (with `Network.encode`).
   */
  send = (encoded: any) => {
    this.socket.send(encoded);
  };
}

export { Client };
