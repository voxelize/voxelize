import Mousetrap from "mousetrap";

import { Client } from "..";

/**
 * Three types of clicking for mouse input listening.
 */
type ClickType = "left" | "middle" | "right";

/**
 * Different namespaces that the {@link Inputs} is in.
 * - `in-game`: Keys registered in-game will be fired.
 * - `chat`: Keys registered for the chat will be fired.
 * - `menu`: Keys registered otherwise will be fired.
 * - `*`: Keys will be fired no matter what.
 */
type InputNamespace = "in-game" | "chat" | "inventory" | "menu" | "*";

/**
 * The occasion that the input should be fired.
 */
type InputOccasion = "keydown" | "keypress" | "keyup";

type ClickCallbacks = { callback: () => void; namespace: InputNamespace }[];
type ScrollCallbacks = {
  up: (delta?: number) => void;
  down: (delta?: number) => void;
  namespace: InputNamespace;
}[];

/**
 * A **built-in** key-bind manager for Voxelize. Uses the [mousetrap](https://github.com/ccampbell/mousetrap)
 * library internally.
 *
 * ## Example
 * Print "Hello world" on <kbd>p</kbd> presses:
 * ```typescript
 * client.inputs.bind(
 *   "p",
 *   () => {
 *     console.log("Hello world");
 *   },
 *   "*"
 * );
 * ```
 */
class Inputs {
  /**
   * Reference linking back to the Voxelize client instance.
   */
  public client: Client;

  /**
   * The namespace that the Voxelize inputs is in. Use `setNamespace` to
   * set the namespace for namespace checking.
   */
  public namespace: InputNamespace = "menu";

  private combos: Map<string, string> = new Map();
  private clickCallbacks: Map<ClickType, ClickCallbacks> = new Map();
  private scrollCallbacks: ScrollCallbacks = [];

  private unbinds = new Map<string, () => void>();
  private mouseUnbinds: (() => void)[] = [];

  /**
   * Construct a Voxelize inputs instance.
   *
   * @hidden
   */
  constructor(client: Client) {
    this.client = client;

    this.add("forward", "w");
    this.add("backward", "s");
    this.add("left", "a");
    this.add("right", "d");
    this.add("space", "space");
    this.add("dbl-space", "space space");
    this.add("esc", "esc");
    this.add("up", "up");
    this.add("down", "down");
    this.add("enter", "enter");
    this.add("tab", "tab");

    this.initClickListener();
    this.initScrollListener();
  }

  /**
   * Register a new click event listener.
   *
   * @param type - Which mouse button to register on.
   * @param callback - What to do when that button is clicked.
   * @param namespace - Which namespace should this event be fired?
   */
  click = (
    type: ClickType,
    callback: () => void,
    namespace: InputNamespace
  ) => {
    this.clickCallbacks.get(type)?.push({ namespace, callback });
  };

  /**
   * Register a new scroll event listener.
   *
   * @param up - What to do when scrolled upwards.
   * @param down - What to do when scrolled downwards.
   * @param namespace - Which namespace should this even be fired?
   */
  scroll = (
    up: (delta?: number) => void,
    down: (delta?: number) => void,
    namespace: InputNamespace
  ) => {
    this.scrollCallbacks.push({ up, down, namespace });
  };

  /**
   * Register a key-bind event listener.
   *
   * @param name - The name of the key or key combo to listen on.
   * @param callback - What to do when the key/combo is pressed.
   * @param namespace - The namespace in which the to fire this event.
   * @param specifics - Used to specify in more details when/where the press occurs.
   * @param specifics.occasion - Which pressing occasion should the event be fired. Defaults to "keydown".
   * @param specifics.element - Which element should the key binding be bound to. Defaults to "document".
   */
  bind = (
    name: string,
    callback: () => void,
    namespace: InputNamespace,
    specifics: { occasion?: InputOccasion; element?: HTMLElement } = {}
  ) => {
    const { occasion = "keydown", element } = specifics;
    let combo = this.combos.get(name);

    if (!combo) {
      if (name.length === 1) {
        // single keys
        this.add(name, name);
        combo = name;
      } else {
        throw new Error(`Error registering input, combo ${name}: not found.`);
      }
    }

    const mousetrap = element ? new Mousetrap(element) : Mousetrap;

    mousetrap.bind(
      combo,
      () => {
        if (this.namespace === namespace || namespace === "*") callback();
        return false;
      },
      occasion
    );

    if (this.unbinds.get(combo + occasion)) {
      console.warn(
        `Re-registering "${combo}" listener... If this is not intended, wrap the listener initialization under the "initialized" event to only run once.`
      );
    }

    this.unbinds.set(combo + occasion, () => {
      if (combo) mousetrap.unbind(combo, occasion);
    });
  };

  /**
   * Set the namespace of the inputs instance, also checks if the namespace is valid.
   *
   * @param namespace - The namespace to set to.
   */
  setNamespace = (namespace: InputNamespace) => {
    if (!["*", "in-game", "chat", "menu"].includes(namespace)) {
      throw new Error(
        `Set namespace to unknown namespace: ${namespace}. Known namespaces are: chat, in-game, menu, *.`
      );
    }

    this.namespace = namespace;
  };

  /**
   * Reset and dispose all event listeners.
   *
   * @internal
   */
  reset = () => {
    this.unbinds.forEach((fn) => fn());
    this.mouseUnbinds.forEach((fn) => fn());
  };

  private initClickListener = () => {
    (["left", "middle", "right"] as ClickType[]).forEach((type) =>
      this.clickCallbacks.set(type, [])
    );

    const listener = ({ button }: MouseEvent) => {
      if (!this.client.controls.isLocked) return;

      let callbacks: ClickCallbacks = [];

      if (button === 0) callbacks = this.clickCallbacks.get("left") as any;
      else if (button === 1)
        callbacks = this.clickCallbacks.get("middle") as any;
      else if (button === 2)
        callbacks = this.clickCallbacks.get("right") as any;

      callbacks.forEach(({ namespace, callback }) => {
        if (this.namespace === namespace) callback();
      });
    };

    document.addEventListener("mousedown", listener, false);
    this.mouseUnbinds.push(() =>
      document.removeEventListener("mousedown", listener, false)
    );
  };

  private initScrollListener = () => {
    const listener = ({ deltaY }: any) => {
      if (!this.client.controls.isLocked) return;

      this.scrollCallbacks.forEach(({ up, down, namespace }) => {
        if (this.namespace === namespace) {
          if (deltaY > 0) up(deltaY);
          else if (deltaY < 0) down(deltaY);
        }
      });
    };

    document.addEventListener("wheel", listener);
    this.mouseUnbinds.push(() =>
      document.removeEventListener("wheel", listener)
    );
  };

  private add = (name: string, combo: string) => {
    this.combos.set(name, combo);
  };
}

export type { ClickType, InputNamespace, InputOccasion };

export { Inputs };
