import { Vector3 } from "@math.gl/core";
import { Component } from "@voxelize/common";

/**
 * ECS component that keeps track of entities' moving direction. In other
 * words where the entities are "heading" towards.
 */
export const HeadingComponent = Component.register<Vector3>();
