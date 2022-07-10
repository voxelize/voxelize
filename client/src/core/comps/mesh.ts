import { Object3D } from "three";

import { Component } from "../../libs/ecs";

export const MeshComponent = Component.register<Object3D>();
