import { Component } from "@voxelize/common";

export type Settings = {
  renderRadius: number;
};

export const SettingsComponent = Component.register<Settings>();
