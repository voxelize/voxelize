import { Vector3 } from "@math.gl/core";
import { Component } from "@voxelize/common";

/**
 * ECS component that keeps track of entities' position in 3D coordinates
 */
export const Position3DComponent = Component.register<Vector3>();
