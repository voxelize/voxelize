import { EntityProtocol, MessageProtocol } from "@voxelize/transport/src/types";

import { Client } from "..";

import { NetIntercept } from "./network";

/**
 * A **built-in** map representing living entities on the server.
 *
 * @noInheritDoc
 */
class Entities<T> implements NetIntercept {
  /**
   * Reference linking back to the Voxelize client instance.
   */
  public client: Client;

  public packets: MessageProtocol<any, any, T>[] = [];

  /**
   * Construct a Voxelize entities map.
   *
   * @hidden
   */
  constructor(client: Client) {
    this.client = client;
  }

  onEntity: (entity: EntityProtocol<T>) => void;

  onMessage = (message: MessageProtocol<any, any, T>) => {
    const { entities } = message;

    if (entities && entities.length) {
      entities.forEach((entity) => {
        this.onEntity?.(entity);
      });
    }
  };
}

export { Entities };
