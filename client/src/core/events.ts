import { MessageProtocol } from "@voxelize/transport/src/types";

import { NetIntercept } from "./network";

/**
 * A Voxelize event.
 */
export type Event = {
  /**
   * The name to identify the event.
   */
  name: string;

  /**
   * Additional information of the event.
   */
  payload?: any;
};

/**
 * The handler for an event sent from the Voxelize server.
 */
export type EventHandler = (payload: any | null) => void;

/**
 * A **built-in** manager for the events sent from the Voxelize server. Keep in
 * mind that one event can only have one listener!
 */
export class Events extends Map<string, EventHandler> implements NetIntercept {
  public onMessage = (message: MessageProtocol) => {
    switch (message.type) {
      case "EVENT": {
        const { events } = message;

        events.forEach((e: any) => {
          this.handle(e.name, e.payload);
        });

        return;
      }
    }
  };

  /**
   * Synonym for {@link on}, adds a listener to a Voxelize server event.
   * If the payload cannot be parsed by JSON, `null` is set.
   *
   * @param name - The name of the event to listen on. Case sensitive.
   * @param handler - What to do when this event is received?
   */
  public addEventListener = (name: string, handler: EventHandler) => {
    this.on(name, handler);
  };

  /**
   * Synonym for {@link addEventListener}, adds a listener to a Voxelize server event.
   * If the payload cannot be parsed by JSON, `null` is set.
   *
   * @param name - The name of the event to listen on. Case sensitive.
   * @param handler - What to do when this event is received?
   */
  public on = (name: string, handler: EventHandler) => {
    if (this.has(name)) {
      console.warn(
        `Registering handler for ${name} canceled: handler already exists.`
      );
      return;
    }

    this.set(name, handler);
  };

  /**
   * The handler for network packages to distribute to the event handlers.
   *
   * @internal
   * @hidden
   */
  public handle = (name: string, payload: string) => {
    const handler = this.get(name);

    if (!handler) {
      console.warn(
        `Received Voxelize event of "${name}", but no handlers are registered!`
      );
      return;
    }

    let deserialized: any;
    try {
      deserialized = JSON.parse(payload);
    } catch {
      console.error(`Could not serialize event payload of ${name}: ${payload}`);
      return;
    }

    handler(deserialized);
  };
}
