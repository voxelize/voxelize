import { EntityProtocol, MessageProtocol } from "@voxelize/transport/src/types";

import { NetIntercept } from "./network";

/**
 * A **built-in** map representing living entities on the server.
 *
 * @noInheritDoc
 */
class Entities<T> implements NetIntercept {
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
