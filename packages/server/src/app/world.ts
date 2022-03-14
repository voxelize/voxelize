import { ECS, System, Block } from "@voxelize/common";

import { BaseEntity, Entities } from "./entities";
import { Pipeline } from "./pipeline";
import { Registry } from "./registry";
import { Room } from "./room";
import { Constructor } from "./shared";
import { BroadcastEntitiesSystem, CurrentChunkSystem } from "./systems";

type WorldParams = {
  chunkSize: number;
};

class World {
  public entities: Entities;
  public registry: Registry;
  public pipeline: Pipeline;

  public ecs: ECS;

  constructor(public room: Room, public params: WorldParams) {
    const { chunkSize } = params;

    this.entities = new Entities(this);
    this.registry = new Registry(this);

    this.ecs = new ECS();
    this.ecs.timeScale = 0;

    this.ecs.addSystem(new BroadcastEntitiesSystem(this.entities));
    this.ecs.addSystem(new CurrentChunkSystem(chunkSize));
  }

  registerEntity = <T extends BaseEntity>(
    type: string,
    protocol: Constructor<T>
  ) => {
    return this.entities.registerEntity(type, protocol);
  };

  registerBlock = (name: string, block: Partial<Block> = {}) => {
    return this.registry.registerBlock(name, block);
  };

  addEntity = (type: string) => {
    const entity = this.entities.addEntity(type);
    this.ecs.addEntity(entity);
    return entity;
  };

  addSystem = (system: System) => {
    this.ecs.addSystem(system);
  };

  start = () => {
    this.ecs.timeScale = 1;
    this.registry.generate();
  };

  stop = () => {
    this.ecs.timeScale = 0;
  };

  update = () => {
    this.ecs.update();
    this.entities.update();
  };
}

export { World };
