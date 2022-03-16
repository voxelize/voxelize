import { Component } from "@voxelize/common";

export type ChunkRequests = {
  pending: Set<string>;
  finished: Set<string>;
};

export const ChunkRequestsComponent = Component.register<ChunkRequests>();
