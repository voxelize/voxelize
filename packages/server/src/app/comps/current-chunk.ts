import { Component } from "@voxelize/common";

/**
 * Object to keep track of entities' current chunk.
 */
export type CurrentChunk = {
  changed: boolean;
  chunk: {
    x: number;
    z: number;
  };
};

/**
 * ECS component that keeps track of entities' current chunks.
 */
export const CurrentChunkComponent = Component.register<CurrentChunk>();
