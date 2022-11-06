import { EntityProtocol, MessageProtocol } from "@voxelize/transport/src/types";

import { NetIntercept } from "./network";

/**
 * A network interceptor that can be used to handle `ENTITY` messages. This is useful
 * for creating custom entities that can be sent over the network.
 *
 * TODO-DOCS
 *
 * # Example
 * ```ts
 * const entities = new VOXELIZE.Entities<{ position: VOXELIZE.Coords3 }>();
 *
 * // Define the behavior to handle an entity message.
 * entities.onEntity = ({ id, type, metadata }) => {
 *   // Do something about `metadata.position`.
 * };
 *
 * // Register the interceptor with the network.
 * network.register(entities);
 * ```
 *
 * @noInheritDoc
 * @param T The type of metadata to expect, needs to be serializable.
 * @category Core
 */
export class Entities<T> implements NetIntercept {
  /**
   * The handler for any incoming entity data from the server.
   */
  public onEntity: (entity: EntityProtocol<T>) => void;

  /**
   * The network intercept implementation for entities.
   *
   * DO NOT CALL THIS METHOD OR CHANGE IT UNLESS YOU KNOW WHAT YOU ARE DOING.
   *
   * @hidden
   * @param message The message to intercept.
   */
  public onMessage = (message: MessageProtocol<any, any, T>) => {
    const { entities } = message;

    if (entities && entities.length) {
      entities.forEach((entity) => {
        this.onEntity?.(entity);
      });
    }
  };
}
