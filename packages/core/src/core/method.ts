import { MessageProtocol } from "@voxelize/protocol";

import { NetIntercept } from "./network";

/**
 * A caller for a method on the server.
 *
 * TODO-DOC
 *
 * # Example
 * ```ts
 * const method = new VOXELIZE.Method();
 *
 * // Register the method caller with the network.
 * network.register(method);
 *
 * // Call a method on the server.
 * method.call("my-method", { hello: "world" });
 * ```
 */
export class Method implements NetIntercept {
  public packets: MessageProtocol<any, any, any, any>[] = [];

  /**
   * Create a method caller that can be used to call a method on the server.
   *
   * @hidden
   */
  constructor() {
    // NOTHING
  }

  /**
   * Call a defined method on the server.
   *
   * @param name The name of the method to call.
   * @param payload The JSON serializable payload to send to the server.
   * @returns The queued packet. Callers that must know whether the command
   *   actually left the client can flush the network and then check the
   *   packet's absence from both this intercept's `packets` queue and
   *   `Network.isPacketPendingSend`.
   */
  call = (
    name: string,
    payload: any = {},
  ): MessageProtocol<any, any, any, any> => {
    const packet: MessageProtocol<any, any, any, any> = {
      type: "METHOD",
      method: {
        name,
        payload: JSON.stringify(payload),
      },
    };
    this.packets.push(packet);
    return packet;
  };
}
