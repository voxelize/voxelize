import merge from "deepmerge";

import { Inputs } from "../core/inputs";

import { ItemSlots } from "./item-slots";

export type HUDOptions = {
  visible: boolean;
};

const defaultOptions: HUDOptions = {
  visible: true,
};

export class HUD {
  public options: HUDOptions;

  constructor(options: Partial<HUDOptions> = {}) {
    this.options = merge(defaultOptions, options);
  }

  connect = (inputs: Inputs, itemSlots: ItemSlots, namespace = "*") => {};
}
