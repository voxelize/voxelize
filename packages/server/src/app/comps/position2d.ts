import { Vector2 } from "@math.gl/core";
import { Component } from "@voxelize/common";

/**
 * ECS component that keeps track of entities' position in 2D coordinates
 */
export const Position2DComponent = Component.register<Vector2>();
