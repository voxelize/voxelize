import { Vector3 } from "@math.gl/core";
import { Component } from "@voxelize/common";

/**
 * ECS component that keeps track of entities' current target. In
 * other words where the entities' looking at.
 */
export const TargetComponent = Component.register<Vector3>();
