import { EventEmitter } from "events";

import { v4 as uuidv4 } from "uuid";

/**
 * Three types of clicking for mouse input listening.
 */
export type ClickType = "left" | "middle" | "right";

/**
 * The occasion that the input should be fired.
 */
export type InputOccasion = "keydown" | "keypress" | "keyup";

/**
 * The specific options of the key to listen to.
 */
export type InputSpecifics = {
  /**
   * A special identifier to tag this input with. This is useful for removing specific
   * inputs from the input listener later on.
   */
  identifier?: string;

  /**
   * The occasion that the input should be fired. Defaults to `keydown`.
   */
  occasion?: InputOccasion;

  /**
   * The type of key to check for. Defaults to `key`.
   */
  checkType?: "key" | "code";
};

type ClickCallbacks = Map<
  string,
  { callback: (event: MouseEvent) => boolean | void; namespace: string }
>;
type ScrollCallbacks = Map<
  string,
  {
    up: (delta?: number, event?: WheelEvent) => boolean | void;
    down: (delta?: number, event?: WheelEvent) => boolean | void;
    namespace: string;
  }
>;

type KeyBoundItem<T extends string> = {
  unbind: () => void;
  callback: (event: KeyboardEvent) => boolean | void;
  namespaces: T | T[] | "*";
  identifier: string;
};

const normalizeKeyIfNeeded = (key: string): string => {
  const length = key.length;
  for (let index = 0; index < length; index++) {
    const code = key.charCodeAt(index);
    if ((code >= 65 && code <= 90) || code > 127) {
      return key.toLowerCase();
    }
  }
  return key;
};

/**
 * A key and mouse binding manager for Voxelize.
 *
 * Inputs allow you to bind keys and mouse buttons to functions
 * and also gives an organized way to manage keyboard and mouse inputs using namespaces. Namespaces are used to
 * separate groups of inputs. For example, you can have a namespace for the main menu
 * and another namespace for the game. You can then bind keys and mouse buttons to functions for each namespace.
 *
 * Another use of inputs is to bind keys and mouse buttons for some built-in functionality. As of now, the following
 * requires inputs to be bound:
 * - [RigidControls.connect](/api/client/classes/RigidControls#connect): <kbd>WASD</kbd> and <kbd>Space</kbd> for movement, <kbd>Shift</kbd> for going down and <kbd>R</kbd> for sprinting.
 * - [Perspective.connect](/api/client/classes/Perspective#connect): <kbd>C</kbd> for switching between perspectives.
 *
 * You can change the above bindings by calling {@link Inputs.remap} with the corresponding input identifiers, namely
 * `RigidControls.INPUT_IDENTIFIER` and `Perspectives.INPUT_IDENTIFIER`.
 *
 * ## Example
 * ```typescript
 * // Create a new inputs manager.
 * const inputs = new VOXELIZE.Inputs();
 *
 * // Bind the space bar to a function.
 * inputs.bind(" ", (event) => {
 *   console.log("Space bar pressed!", event);
 * });
 *
 * // Bind rigid controls to the inputs manager.
 * rigidControls.connect(inputs);
 * ```
 *
 * @noInheritDoc
 * @param T The list of input namespaces. For instance, `T` could be "menu" and "game".
 * @category Core
 */
export class Inputs<T extends string = string> extends EventEmitter {
  /**
   * The namespace that the Voxelize inputs is in. Use `setNamespace` to
   * set the namespace to something else.
   */
  public namespace: T | "*";

  /**
   * A map for click callbacks.
   */
  private clickCallbacks: Map<ClickType, ClickCallbacks> = new Map();

  /**
   * A map for scroll callbacks.
   */
  private scrollCallbacks: ScrollCallbacks = new Map();

  /**
   * A map for keydown callbacks.
   */
  private keyDownCallbacks: Map<
    string,
    ((event: KeyboardEvent) => boolean | void)[]
  > = new Map();

  /**
   * A map for keyup callbacks.
   */
  private keyUpCallbacks: Map<
    string,
    ((event: KeyboardEvent) => boolean | void)[]
  > = new Map();

  /**
   * A map for key press callbacks.
   */
  private keyPressCallbacks: Map<
    string,
    ((event: KeyboardEvent) => boolean | void)[]
  > = new Map();

  /**
   * A map for key binds.
   */
  private keyBounds = new Map<string, KeyBoundItem<T>[]>();

  /**
   * A list of functions to unbind all inputs.
   */
  private unbinds: (() => void)[] = [];
  private normalizedKeyCache = new Map<string, string>();

  /**
   * Listen to an event emitted by the input instance. The following events are emitted:
   * - `namespace`: Emitted when the namespace is changed.
   *
   * @param event An event to listen on.
   * @param listener A listener to call when the event is emitted.
   * @returns The input instance for chaining.
   */
  on(event: "namespace", listener: (namespace: string) => void) {
    super.on(event, listener);
    return this;
  }

  /**
   * Construct a Voxelize inputs instance.
   */
  constructor() {
    super();

    this.initializeKeyListeners();
    this.initializeClickListeners();
    this.initializeScrollListeners();
  }

  /**
   * Add a mouse click event listener.
   *
   * @param type The type of click to listen for. Either "left", "middle" or "right".
   * @param callback The callback to call when the click is fired, passing the MouseEvent.
   * @param namespace The namespace to bind the click to. Defaults to "*", which means that the click will be fired regardless of the namespace.
   * @returns A function to unbind the click.
   */
  click = (
    type: ClickType,
    callback: (event: MouseEvent) => boolean | void,
    namespace: T | "*" = "*"
  ) => {
    const id = uuidv4();
    this.clickCallbacks.get(type)?.set(id, { namespace, callback });
    return () => this.clickCallbacks.get(type).delete(id);
  };

  /**
   * Add a scroll event listener.
   *
   * @param up The callback to call when the scroll wheel is scrolled up.
   * @param down The callback to call when the scroll wheel is scrolled down.
   * @param namespace The namespace to bind the scroll to. Defaults to "*", which means that the scroll will be fired regardless of the namespace.
   * @returns A function to unbind the scroll.
   */
  scroll = (
    up: (delta?: number) => boolean | void,
    down: (delta?: number) => boolean | void,
    namespace: T | "*" = "*"
  ) => {
    const id = uuidv4();
    this.scrollCallbacks.set(id, { up, down, namespace });
    return () => this.scrollCallbacks.delete(id);
  };

  /**
   * Bind a keyboard key to a callback.
   *
   * @param key The key to listen for. This checks the `event.key` or the `event.code` property.
   * @param callback The callback to call when the key is pressed.
   * @param namespace The namespace to bind the key to. Defaults to "*", which means that the key will be fired regardless of the namespace.
   * @param specifics The specific options of the key to listen for.
   * @returns A function to unbind the key.
   */
  bind = (
    key: string,
    callback: (event: KeyboardEvent) => boolean | void,
    namespaces: T | T[] | "*" = "*",
    specifics: InputSpecifics = {}
  ) => {
    key = this.modifyKey(key);

    const {
      occasion = "keydown",
      identifier = "default",
      checkType = "code",
    } = specifics;

    const name = key + occasion;

    const existing = this.keyBounds.get(name) || [];
    for (let existingIndex = 0; existingIndex < existing.length; existingIndex++) {
      if (existing[existingIndex].identifier === identifier) {
        throw new Error(
          `Error registering input, key ${key} with checkType ${checkType}: already bound.`
        );
      }
    }

    const callbackWrapper = (event: KeyboardEvent) => {
      const eventKey = checkType === "code" ? event.code : event.key;
      if (this.modifyKey(eventKey) === key) {
        return callback(event);
      }

      return false;
    };

    const callbackMap =
      occasion === "keydown"
        ? this.keyDownCallbacks
        : occasion === "keyup"
        ? this.keyUpCallbacks
        : this.keyPressCallbacks;
    const callbacks = callbackMap.get(name);
    if (callbacks) {
      callbacks.push(callbackWrapper);
    } else {
      callbackMap.set(name, [callbackWrapper]);
    }

    const unbind = () => {
      const callbacks = callbackMap.get(name);
      if (callbacks) {
        const index = callbacks.indexOf(callbackWrapper);
        if (index !== -1) callbacks.splice(index, 1);
      }

      // Remove key from callbacks if it is empty.
      if (callbackMap.get(name)?.length === 0) callbackMap.delete(name);

      const boundItems = this.keyBounds.get(name) || [];
      let index = -1;
      for (let boundItemIndex = 0; boundItemIndex < boundItems.length; boundItemIndex++) {
        if (boundItems[boundItemIndex].identifier === identifier) {
          index = boundItemIndex;
          break;
        }
      }
      if (index !== -1) {
        boundItems.splice(index, 1);
        if (boundItems.length === 0) {
          this.keyBounds.delete(name);
        } else {
          this.keyBounds.set(name, boundItems);
        }
      }
    };

    const newBound: KeyBoundItem<T> = {
      unbind,
      callback: callbackWrapper,
      namespaces,
      identifier,
    };

    existing.push(newBound);
    this.keyBounds.set(name, existing);

    return unbind;
  };

  /**
   * Unbind a keyboard key.
   *
   * @param key The key to unbind.
   * @param specifics The specifics of the key to unbind.
   * @returns Whether or not if the unbinding was successful.
   */
  unbind = (key: string, specifics: InputSpecifics = {}) => {
    key = this.modifyKey(key);

    const { occasion = "keydown", identifier = "default" } = specifics;

    const name = key + occasion;
    const bounds = this.keyBounds.get(name) || [];

    let index = -1;
    for (let boundIndex = 0; boundIndex < bounds.length; boundIndex++) {
      if (bounds[boundIndex].identifier === identifier) {
        index = boundIndex;
        break;
      }
    }
    if (index !== -1) {
      const { unbind } = bounds[index];
      unbind();
      return true;
    }

    return false;
  };

  /**
   * Swap two keys with each other.
   *
   * @param keyA The first key to swap.
   * @param keyB The second key to swap.
   * @param specifics The specifics of the keys to swap.
   */
  swap = (
    keyA: string,
    keyB: string,
    specifics: {
      occasion?: InputOccasion;
      identifier?: string;
      checkType?: "key" | "code";
    } = {}
  ) => {
    const originalKeyA = keyA;
    const originalKeyB = keyB;
    keyA = this.modifyKey(keyA);
    keyB = this.modifyKey(keyB);

    const {
      occasion = "keydown",
      identifier = "default",
      checkType = "code",
    } = specifics;

    const nameA = keyA + occasion;
    const nameB = keyB + occasion;
    const boundsA = this.keyBounds.get(nameA) || [];
    const boundsB = this.keyBounds.get(nameB) || [];

    let indexA = -1;
    for (let boundIndex = 0; boundIndex < boundsA.length; boundIndex++) {
      if (boundsA[boundIndex].identifier === identifier) {
        indexA = boundIndex;
        break;
      }
    }
    let indexB = -1;
    for (let boundIndex = 0; boundIndex < boundsB.length; boundIndex++) {
      if (boundsB[boundIndex].identifier === identifier) {
        indexB = boundIndex;
        break;
      }
    }

    if (indexA === -1) {
      throw new Error(`Key ${nameA} is not bound.`);
    } else if (indexB === -1) {
      throw new Error(`Key ${nameB} is not bound.`);
    }

    const {
      unbind: unbindA,
      callback: callbackA,
      namespaces: namespaceA,
    } = boundsA[indexA];
    const {
      unbind: unbindB,
      callback: callbackB,
      namespaces: namespaceB,
    } = boundsB[indexB];

    unbindA();
    unbindB();
    this.bind(originalKeyB, callbackA, namespaceA, {
      occasion,
      identifier,
      checkType,
    });
    this.bind(originalKeyA, callbackB, namespaceB, {
      occasion,
      identifier,
      checkType,
    });
  };

  /**
   * Remap a key to another key.
   *
   * @param oldKey The old key to replace.
   * @param newKey The new key to replace the old key with.
   * @param specifics The specifics of the keys to replace.
   */
  remap = (
    oldKey: string,
    newKey: string,
    specifics: {
      occasion?: InputOccasion;
      identifier?: string;
      checkType?: "key" | "code";
    } = {}
  ) => {
    const originalNewKey = newKey;
    oldKey = this.modifyKey(oldKey);
    newKey = this.modifyKey(newKey);

    const {
      occasion = "keydown",
      identifier = "default",
      checkType = "code",
    } = specifics;

    const name = oldKey + occasion;
    const bounds = this.keyBounds.get(name) || [];

    let index = -1;
    for (let boundIndex = 0; boundIndex < bounds.length; boundIndex++) {
      if (bounds[boundIndex].identifier === identifier) {
        index = boundIndex;
        break;
      }
    }
    if (index === -1) {
      throw new Error(`Key ${name} is not bound.`);
    }

    const { unbind, callback, namespaces } = bounds[index];
    unbind();

    this.bind(originalNewKey, callback, namespaces, {
      occasion,
      identifier,
      checkType,
    });
  };

  /**
   * Set the namespace of the input instance. This emits a "namespace" event.
   *
   * @param namespace The new namespace to set.
   */
  setNamespace = (namespace: T) => {
    this.namespace = namespace;
    this.emit("namespace", namespace);
  };

  /**
   * Reset all keyboard keys by unbinding all keys.
   */
  reset = () => {
    let keyBoundLists = this.keyBounds.values();
    let keyBoundList = keyBoundLists.next();
    while (!keyBoundList.done) {
      const bounds = keyBoundList.value;
      for (let index = 0; index < bounds.length; index++) {
        bounds[index].unbind();
      }
      keyBoundList = keyBoundLists.next();
    }
    for (let index = 0; index < this.unbinds.length; index++) {
      this.unbinds[index]();
    }
  };

  /**
   * Make everything lower case.
   */
  private modifyKey = (key: string) => {
    if (!key) return key;
    const cached = this.normalizedKeyCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const normalized = normalizeKeyIfNeeded(key);
    if (this.normalizedKeyCache.size >= 256) {
      this.normalizedKeyCache.clear();
    }
    this.normalizedKeyCache.set(key, normalized);
    return normalized;
  };

  /**
   * Initialize the keyboard input listeners.
   */
  private initializeKeyListeners = () => {
    const matchesNamespace = (namespaces: T | T[] | "*") => {
      if (namespaces === "*") {
        return true;
      }

      if (Array.isArray(namespaces)) {
        for (let index = 0; index < namespaces.length; index++) {
          if (namespaces[index] === this.namespace) {
            return true;
          }
        }
        return false;
      }

      return namespaces === this.namespace;
    };

    const runBounds = (e: KeyboardEvent, bounds: KeyBoundItem<T>[]) => {
      for (let boundIndex = 0; boundIndex < bounds.length; boundIndex++) {
        const bound = bounds[boundIndex];
        const { callback, namespaces } = bound;

        if (matchesNamespace(namespaces)) {
          const result = callback(e);
          if (result) break;
        }
      }
    };

    // Handle all three types of key events while checking namespace and passing the KeyboardEvent.
    const keyListener = (occasion: InputOccasion) => (e: KeyboardEvent) => {
      const { key, code } = e;
      const keyName = this.modifyKey(key);
      const codeName = this.modifyKey(code);
      const keyCombo = keyName + occasion;
      const codeCombo = codeName + occasion;

      const keyBounds = this.keyBounds.get(keyCombo);
      const codeBounds = this.keyBounds.get(codeCombo);

      if (keyBounds) runBounds(e, keyBounds);
      if (codeBounds) runBounds(e, codeBounds);
    };

    document.addEventListener("keydown", keyListener("keydown"));
    document.addEventListener("keyup", keyListener("keyup"));
    document.addEventListener("keypress", keyListener("keypress"));
  };

  /**
   * Initialize the mouse input listeners.
   */
  private initializeClickListeners = () => {
    const clickTypes: ClickType[] = ["left", "middle", "right"];
    for (let index = 0; index < clickTypes.length; index++) {
      this.clickCallbacks.set(clickTypes[index], new Map());
    }

    const listener = (event: MouseEvent) => {
      let callbacks: ClickCallbacks | undefined;

      if (event.button === 0)
        callbacks = this.clickCallbacks.get("left");
      else if (event.button === 1)
        callbacks = this.clickCallbacks.get("middle");
      else if (event.button === 2)
        callbacks = this.clickCallbacks.get("right");
      else return;

      if (!callbacks) {
        return;
      }

      let callbackEntries = callbacks.values();
      let callbackEntry = callbackEntries.next();
      while (!callbackEntry.done) {
        const bound = callbackEntry.value;
        const { namespace, callback } = bound;
        if (this.namespace === namespace || namespace === "*") {
          const result = callback(event);
          if (result) {
            break;
          }
        }
        callbackEntry = callbackEntries.next();
      }
    };

    document.addEventListener("mousedown", listener, false);
    this.unbinds.push(() =>
      document.removeEventListener("mousedown", listener, false)
    );
  };

  /**
   * Initialize the mouse scroll listeners.
   */
  private initializeScrollListeners = () => {
    const listener = (event: WheelEvent) => {
      let scrollEntries = this.scrollCallbacks.values();
      let scrollEntry = scrollEntries.next();
      while (!scrollEntry.done) {
        const bound = scrollEntry.value;
        const { up, down, namespace } = bound;
        if (this.namespace === namespace || namespace === "*") {
          const result =
            event.deltaY > 0
              ? up(event.deltaY, event)
              : down(event.deltaY, event);
          if (result) {
            break;
          }
        }
        scrollEntry = scrollEntries.next();
      }
    };

    document.addEventListener("wheel", listener);
    this.unbinds.push(() => document.removeEventListener("wheel", listener));
  };
}
