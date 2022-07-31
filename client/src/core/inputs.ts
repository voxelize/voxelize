import { EventEmitter } from "events";

import Mousetrap from "mousetrap";

/**
 * Three types of clicking for mouse input listening.
 */
export type ClickType = "left" | "middle" | "right";

/**
 * The occasion that the input should be fired.
 */
export type InputOccasion = "keydown" | "keypress" | "keyup";

type ClickCallbacks = { callback: () => void; namespace: string }[];
type ScrollCallbacks = {
  up: (delta?: number) => void;
  down: (delta?: number) => void;
  namespace: string;
}[];

export declare interface Inputs<T extends string> {
  on(event: "namespace", listener: (namespace: string) => void): this;
}

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
 *
 * @category Core
 */
export class Inputs<T extends string> extends EventEmitter {
  /**
   * The namespace that the Voxelize inputs is in. Use `setNamespace` to
   * set the namespace for namespace checking.
   */
  public namespace: T | "*";

  private combos: Map<string, string> = new Map();
  private clickCallbacks: Map<ClickType, ClickCallbacks> = new Map();
  private scrollCallbacks: ScrollCallbacks = [];

  private keyBounds = new Map<
    string,
    {
      unbind: () => void;
      callback: () => void;
      namespace: T | "*";
    }
  >();
  private mouseUnbinds: (() => void)[] = [];

  /**
   * Construct a Voxelize inputs instance.
   *
   * @hidden
   */
  constructor() {
    super();

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
    this.add("shift", "shift");

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
  click = (type: ClickType, callback: () => void, namespace: T | "*") => {
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
    namespace: T | "*"
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
    namespace: T | "*",
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

    if (this.keyBounds.get(combo + occasion)) {
      console.error(
        `${combo} is already bounded. Please unbind it before rebinding.`
      );
      return;
    }

    this.keyBounds.set(combo + occasion, {
      unbind: () => {
        if (combo) mousetrap.unbind(combo, occasion);
      },
      callback,
      namespace,
    });
  };

  unbind = (name: string, specifics: { occasion?: InputOccasion } = {}) => {
    const { occasion = "keydown" } = specifics;
    const combo = this.combos.get(name);

    const bounds = this.keyBounds.get(combo + occasion);

    if (bounds) {
      const { unbind } = bounds;
      unbind();
      this.keyBounds.delete(combo + occasion);
      return true;
    }

    return false;
  };

  remap = (
    name: string,
    newName: string,
    specifics: { occasion?: InputOccasion } = {}
  ) => {
    const { occasion = "keydown" } = specifics;
    const combo = this.combos.get(name);

    const bounds = this.keyBounds.get(combo + occasion);

    if (!bounds) {
      console.error(`Key ${name} is not bound.`);
      return;
    }

    const { unbind, callback, namespace } = bounds;

    unbind();

    this.bind(newName, callback, namespace, specifics);
  };

  /**
   * Set the namespace of the inputs instance, also checks if the namespace is valid.
   *
   * @param namespace - The namespace to set to.
   */
  setNamespace = (namespace: T) => {
    this.namespace = namespace;
    this.emit("namespace", namespace);
  };

  /**
   * Reset and dispose all event listeners.
   *
   * @internal
   */
  reset = () => {
    this.keyBounds.forEach((b) => b.unbind());
    this.mouseUnbinds.forEach((fn) => fn());
  };

  private initClickListener = () => {
    (["left", "middle", "right"] as ClickType[]).forEach((type) =>
      this.clickCallbacks.set(type, [])
    );

    const listener = ({ button }: MouseEvent) => {
      let callbacks: ClickCallbacks = [];

      if (button === 0) callbacks = this.clickCallbacks.get("left") as any;
      else if (button === 1)
        callbacks = this.clickCallbacks.get("middle") as any;
      else if (button === 2)
        callbacks = this.clickCallbacks.get("right") as any;

      callbacks.forEach(({ namespace, callback }) => {
        if (this.namespace === namespace || namespace === "*") callback();
      });
    };

    document.addEventListener("mousedown", listener, false);
    this.mouseUnbinds.push(() =>
      document.removeEventListener("mousedown", listener, false)
    );
  };

  private initScrollListener = () => {
    const listener = ({ deltaY }: any) => {
      this.scrollCallbacks.forEach(({ up, down, namespace }) => {
        if (this.namespace === namespace || namespace === "*") {
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
