import { MessageProtocol } from "@voxelize/protocol";

import { NetIntercept } from "./network";

export const VOXELIZE_BUILTIN_SOUND_EFFECT_EVENT =
  "vox-builtin:sound-effect" as const;

type JsonPrimitive = string | number | boolean | null;
export type EventPayload =
  | JsonPrimitive
  | { [key: string]: EventPayload | undefined }
  | EventPayload[];

export type SoundEffectEventPayload = {
  id: string;
  position?: [number, number, number];
  volume?: number;
  pitch?: number;
  radius?: number;
  sourceClientId?: string;
};

export type SoundEffectEventHandler = (
  payload: SoundEffectEventPayload,
) => void;

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
  payload?: EventPayload;
};

/**
 * The handler for an event sent from the Voxelize server.
 */
export type EventHandler<TPayload = EventPayload> = (payload: TPayload) => void;

type EventMessage = MessageProtocol<
  EventPayload,
  EventPayload,
  EventPayload,
  EventPayload,
  EventPayload
>;

/**
 * A manager for events interacting with the Voxelize server. This is useful
 * for defined game events that are sent from or need to be broadcasted to
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
  /**
   * A list of packets that will be sent to the server.
   *
   * @hidden
   */
  public packets: EventMessage[] = [];

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
        const { events } = message;

        events?.forEach((event) => {
          this.handle(event.name, event.payload);
        });

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
  addEventListener = <TPayload = EventPayload>(
    name: string,
    handler: EventHandler<TPayload>,
  ) => {
    this.on(name, handler);
  };

  /**
   * Synonym for {@link addEventListener}, adds a listener to a Voxelize server event.
   * If the payload cannot be parsed by JSON, `null` is set.
   *
   * @param name The name of the event to listen on. Case sensitive.
   * @param handler What to do when this event is received?
   */
  on = <TPayload = EventPayload>(
    name: string,
    handler: EventHandler<TPayload>,
  ) => {
    if (this.has(name)) {
      console.warn(
        `Registering handler for ${name} canceled: handler already exists.`,
      );
      return;
    }

    this.set(name, handler as EventHandler);
  };

  onSoundEffect = (handler: SoundEffectEventHandler) => {
    this.on<SoundEffectEventPayload>(
      VOXELIZE_BUILTIN_SOUND_EFFECT_EVENT,
      (payload) => {
        handler(payload);
      },
    );
  };

  emitSoundEffect = (payload: SoundEffectEventPayload) => {
    this.emit(VOXELIZE_BUILTIN_SOUND_EFFECT_EVENT, payload);
  };

  /**
   * Emit an event to the server.
   *
   * @param name The name of the event to emit.
   * @param payload The payload to send with the event.
   */
  emit = (name: string, payload: EventPayload = {}) => {
    this.packets.push({
      type: "EVENT",
      events: [
        {
          name,
          payload: JSON.stringify(payload),
        },
      ],
    });
  };

  /**
   * The handler for network packages to distribute to the event handlers.
   *
   * @hidden
   */
  handle = (name: string, payload: EventPayload = {}) => {
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
