import { MessageProtocol } from "@voxelize/protocol";

/**
 * An interceptor for the network layer. When registered to a network
 * instance, the network instance will run through all network packets
 * through the interceptor, and also allowing the interceptor to send
 * packets to the server.
 */
export interface NetIntercept {
  /**
   * A listener to be implemented to handle incoming packets.
   *
   * @param message The message received from the server.
   * @param clientInfo The client information.
   */
  onMessage?: (
    message: MessageProtocol,
    clientInfo: {
      /**
       * The client's username.
       */
      username: string;
      /**
       * The client's ID.
       */
      id: string;
      /**
       * The client's metadata (device info, etc.).
       */
      metadata?: Record<string, any>;
    }
  ) => void;

  /**
   * An array of packets to be sent to the server. These packets will be
   * sent to the server after every `network.flush()` call.
   */
  packets?: MessageProtocol[];
}
