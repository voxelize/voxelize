import { Component } from "@voxelize/common";

export type CurrentChunk = {
  changed: boolean;
  chunk: {
    x: number;
    z: number;
  };
};

export const CurrentChunkComponent = Component.register<CurrentChunk>();
