import { Vector3 } from "@math.gl/core";
import { Component } from "@voxelize/common";

/**
 * ECS component that records the direction an entity is looking at.
 */
export const DirectionComponent = Component.register<Vector3>();
