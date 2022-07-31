import { EventEmitter } from "events";

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

  private clickCallbacks: Map<ClickType, ClickCallbacks> = new Map();
  private scrollCallbacks: ScrollCallbacks = [];
  private keyDownCallbacks: Map<string, (() => void)[]> = new Map();
  private keyUpCallbacks: Map<string, (() => void)[]> = new Map();
  private keyPressCallbacks: Map<string, (() => void)[]> = new Map();

  private keyBounds = new Map<
    string,
    {
      [key: string]: {
        unbind: () => void;
        callback: () => void;
        namespace: T | "*";
      };
    }
  >();
  private unbinds: (() => void)[] = [];

  /**
   * Construct a Voxelize inputs instance.
   *
   * @hidden
   */
  constructor() {
    super();

    this.initKeyListener();
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
   * @param key - The key to listen on.
   * @param callback - What to do when the key/combo is pressed.
   * @param namespace - The namespace in which the to fire this event.
   * @param specifics - Used to specify in more details when/where the press occurs.
   * @param specifics.occasion - Which pressing occasion should the event be fired. Defaults to "keydown".
   * @param specifics.identifier - Whether or not should this be a special key event. Defaults to "".
   */
  bind = (
    key: string,
    callback: () => void,
    namespace: T | "*",
    specifics: {
      occasion?: InputOccasion;
      identifier?: string;
    } = {}
  ) => {
    key = this.modifyKey(key);

    const { occasion = "keydown", identifier = "default" } = specifics;

    const name = key + occasion;

    const existing = this.keyBounds.get(name);
    if (existing) {
      if (existing[identifier])
        throw new Error(`Error registering input, key ${key}: already bound.`);
    }

    switch (occasion) {
      case "keydown": {
        this.keyDownCallbacks.set(name, [
          ...(this.keyDownCallbacks.get(name) || []),
          callback,
        ]);
        break;
      }
      case "keyup": {
        this.keyUpCallbacks.set(name, [
          ...(this.keyUpCallbacks.get(name) || []),
          callback,
        ]);
        break;
      }
      case "keypress": {
        this.keyPressCallbacks.set(name, [
          ...(this.keyPressCallbacks.get(name) || []),
          callback,
        ]);
        break;
      }
    }

    const bounds = this.keyBounds.get(name) || {};

    bounds[identifier] = {
      unbind: () => {
        (
          [
            ["keydown", this.keyDownCallbacks],
            ["keyup", this.keyUpCallbacks],
            ["keypress", this.keyPressCallbacks],
          ] as [string, Map<string, (() => void)[]>][]
        ).forEach(([o, map]) => {
          if (o !== occasion) return;

          const callbacks = map.get(name);
          if (callbacks) {
            const index = callbacks.indexOf(callback);
            if (index !== -1) callbacks.splice(index, 1);
          }

          // Remove key from keydown callbacks if it is empty.
          if (map.get(name)?.length === 0) map.delete(name);
        });

        delete bounds[identifier];
      },
      callback,
      namespace,
    };

    this.keyBounds.set(name, bounds);
  };

  unbind = (
    key: string,
    specifics: { occasion?: InputOccasion; identifier?: string } = {}
  ) => {
    key = this.modifyKey(key);

    const { occasion = "keydown", identifier = "default" } = specifics;

    const name = key + occasion;
    const bounds = (this.keyBounds.get(name) || {})[identifier];

    if (bounds) {
      const { unbind } = bounds;
      unbind();
      return true;
    }

    return false;
  };

  remap = (
    key: string,
    newName: string,
    specifics: { occasion?: InputOccasion; identifier?: string } = {}
  ) => {
    key = this.modifyKey(key);

    const { occasion = "keydown", identifier = "default" } = specifics;

    const name = key + occasion;
    const bounds = (this.keyBounds.get(name) || {})[identifier];

    if (!bounds) {
      throw new Error(`Key ${name} is not bound.`);
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
    this.keyBounds.forEach((b) => Object.values(b).forEach((e) => e.unbind()));
    this.unbinds.forEach((fn) => fn());
  };

  private modifyKey = (key: string) => {
    // Make first character upper case
    return key.length > 1 ? key.charAt(0).toUpperCase() + key.slice(1) : key;
  };

  private initKeyListener = () => {
    // Handle all three types of key events while checking namespace.
    const keyListener = (occasion: InputOccasion) => (e: KeyboardEvent) => {
      const { key, code } = e;
      const keyName = key || code;
      const keyCombo = keyName + occasion;

      const bounds = this.keyBounds.get(keyCombo);

      if (bounds) {
        Object.values(bounds).forEach((bound) => {
          const { callback, namespace } = bound;

          if (namespace === "*" || namespace === this.namespace) {
            callback();
          }
        });
      }
    };

    document.addEventListener("keydown", keyListener("keydown"));
    document.addEventListener("keyup", keyListener("keyup"));
    document.addEventListener("keypress", keyListener("keypress"));
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
    this.unbinds.push(() =>
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
    this.unbinds.push(() => document.removeEventListener("wheel", listener));
  };
}
