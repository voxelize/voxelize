import { Component } from "@voxelize/common";

/**
 * An array of chunk names that an entity requests.
 */
export type ChunkRequests = string[];

/**
 * ECS component that keeps track of specific chunks that entities request.
 */
export const ChunkRequestsComponent = Component.register<ChunkRequests>();
