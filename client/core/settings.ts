import { Client } from "..";

type SettingsField = number | boolean;

class Settings {
  public fields = new Map<string, SettingsField>();

  [key: string]: any;

  constructor(public client: Client) {
    this.add(
      "renderRadius",
      Math.min(Math.max(navigator.hardwareConcurrency || 0, 4), 16)
    );
  }

  add = (property: string, value: SettingsField) => {
    const funcName = `set${property
      .substring(0, 1)
      .toUpperCase()}${property.substring(1)}`;

    if (property.startsWith("set")) {
      throw new Error("Settings property cannot start with `set`.");
    }

    this[funcName] = (val: SettingsField) => {
      this.set(property, val);
    };

    this[funcName](value);
  };

  get = (property: string) => {
    return this[property];
  };

  set = (property: string, value: SettingsField) => {
    this[property] = value;
  };
}

export { Settings };
