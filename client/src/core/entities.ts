import { EntityProtocol, MessageProtocol } from "@voxelize/transport/src/types";

import { NetIntercept } from "./network";

/**
 * A **built-in** map representing living entities on the server.
 *
 * @noInheritDoc
 */
export class Entities<T> implements NetIntercept {
  public onEntity: (entity: EntityProtocol<T>) => void;

  public onMessage = (message: MessageProtocol<any, any, T>) => {
    const { entities } = message;

    if (entities && entities.length) {
      entities.forEach((entity) => {
        this.onEntity?.(entity);
      });
    }
  };
}
