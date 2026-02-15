import { MessageProtocol } from "@voxelize/protocol";

import { JsonValue } from "../types";
import { NetIntercept } from "./network";

/**
 * A Voxelize event from the server.
 */
export type Event = {
  /**
   * The name to identify the event.
   */
  name: string;

  /**
   * Additional information of the event.
   */
  payload?: JsonValue;
};

/**
 * The handler for an event sent from the Voxelize server.
 */
export type EventHandler = (payload: JsonValue | null) => void;

/**
 * A manager for any events interacting with the Voxelize server. This is useful
 * for any defined game events that are sent from or needs to be broadcasted to
 * the server.
 *
 * # Example
 * ```ts
 * const events = new VOXELIZE.Events();
 *
 * // Define the behavior to handle a game-over event. Keep in mind that this
 * // event is most likely sent from the server, so check out the documentations
 * // for creating and emitting custom events fullstack.
 * events.on("game-over", (payload) => {
 *   // Do something about the game over event.
 * });
 *
 * // Register the interceptor with the network.
 * network.register(events);
 * ```
 *
 * TODO-DOC
 *
 * @noInheritDoc
 */
export class Events extends Map<string, EventHandler> implements NetIntercept {
  private static readonly EMPTY_PAYLOAD_JSON = "{}";
  /**
   * A list of packets that will be sent to the server.
   *
   * @hidden
   */
  public packets: MessageProtocol[] = [];

  /**
   * The network intercept implementation for events.
   *
   * DO NOT CALL THIS METHOD OR CHANGE IT UNLESS YOU KNOW WHAT YOU ARE DOING.
   *
   * @hidden
   * @param message The message to intercept.
   */
  onMessage = (message: MessageProtocol) => {
    switch (message.type) {
      case "EVENT": {
        const events = message.events;
        const eventCount = events?.length ?? 0;
        if (eventCount === 0) {
          return;
        }

        for (let eventIndex = 0; eventIndex < eventCount; eventIndex++) {
          const event = events[eventIndex];
          this.handle(event.name, event.payload);
        }

        return;
      }
    }
  };

  /**
   * Synonym for {@link on}, adds a listener to a Voxelize server event.
   * If the payload cannot be parsed by JSON, `null` is set.
   *
   * @param name The name of the event to listen on. Case sensitive.
   * @param handler What to do when this event is received?
   */
  addEventListener = (name: string, handler: EventHandler) => {
    this.on(name, handler);
  };

  /**
   * Synonym for {@link addEventListener}, adds a listener to a Voxelize server event.
   * If the payload cannot be parsed by JSON, `null` is set.
   *
   * @param name The name of the event to listen on. Case sensitive.
   * @param handler What to do when this event is received?
   */
  on = (name: string, handler: EventHandler) => {
    if (this.get(name) !== undefined) {
      console.warn(
        `Registering handler for ${name} canceled: handler already exists.`
      );
      return;
    }

    this.set(name, handler);
  };

  /**
   * Emit an event to the server.
   *
   * @param name The name of the event to emit.
   * @param payload The payload to send with the event.
   */
  emit = (name: string, payload?: JsonValue) => {
    const payloadJson =
      payload === undefined
        ? Events.EMPTY_PAYLOAD_JSON
        : JSON.stringify(payload);
    this.packets.push({
      type: "EVENT",
      events: [
        {
          name,
          payload: payloadJson,
        },
      ],
    });
  };

  /**
   * The handler for network packages to distribute to the event handlers.
   *
   * @hidden
   */
  handle = (name: string, payload: JsonValue | null) => {
    const handler = this.get(name);

    if (!handler) {
      return;
    }

    handler(payload);
  };

  /**
   * Creates a new instance of the Voxelize event manager.
   */
  constructor() {
    super();
  }
}
