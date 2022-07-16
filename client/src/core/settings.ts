import { Client } from "..";

type SettingsField = number | boolean;

type SettingsChangeHandler = (client: Client, newVal: SettingsField) => void;

/**
 * The **built-in** Voxelize settings.
 *
 * @category Core
 */
class Settings {
  /**
   * Settings' fields, `string` to `any`.
   */
  [key: string]: any;

  private listeners: Map<string, SettingsChangeHandler> = new Map();

  constructor(public client: Client) {
    this.add("renderRadius", 8);

    client.on("ready", () => {
      this.listen("renderRadius", (client, value) => {
        client.world.setFogDistance(value as number);
      });
    });
  }

  add = (
    property: string,
    value: SettingsField,
    onChange?: SettingsChangeHandler
  ) => {
    const getter = this.makeGetterName(property);
    const setter = this.makeSetterName(property);

    if (property.startsWith("set") || property.startsWith("get")) {
      throw new Error("Settings property cannot start with `set` or `get`.");
    }

    const innerProperty = this.makeInnerName(property);

    this[getter] = () => {
      return this.get(innerProperty);
    };

    this[setter] = (val: SettingsField) => {
      this.set(innerProperty, val);

      const onChange = this.listeners.get(innerProperty);

      if (onChange) {
        onChange(this.client, val);
      }
    };

    this[innerProperty] = value;

    if (onChange) {
      this.listeners.set(innerProperty, onChange);
    }
  };

  listen = (property: string, onChange: SettingsChangeHandler) => {
    const innerProperty = this.makeInnerName(property);
    this.listeners.set(innerProperty, onChange);
  };

  private makeInnerName = (property: string) => {
    return `_${property}`;
  };

  private makeGetterName = (property: string) => {
    return `get${property.substring(0, 1).toUpperCase()}${property.substring(
      1
    )}`;
  };

  private makeSetterName = (property: string) => {
    return `set${property.substring(0, 1).toUpperCase()}${property.substring(
      1
    )}`;
  };

  private get = (property: string) => {
    return this[property];
  };

  private set = (property: string, value: SettingsField) => {
    this[property] = value;
  };
}

export type { SettingsField };

export { Settings };
