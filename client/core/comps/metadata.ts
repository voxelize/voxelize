import { Component } from "../../libs/ecs";

export const MetadataComponent = Component.register<{ [key: string]: any }>();
