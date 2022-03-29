import { ECS, System, Block, BaseWorldParams } from "@voxelize/common";

import { Chunks } from "./chunks";
import { BaseEntity, Entities } from "./entities";
import { ChunkStage, Pipeline } from "./pipeline";
import { Registry } from "./registry";
import { Room } from "./room";
import { Constructor } from "./shared";
import {
  BroadcastEntitiesSystem,
  CurrentChunkSystem,
  GenerateChunksSystem,
} from "./systems";

type WorldParams = BaseWorldParams & {
  maxChunksPerTick: number;
  maxResponsePerTick: number;
};

class World {
  public chunks: Chunks;
  public entities: Entities;
  public registry: Registry;
  public pipeline: Pipeline;

  public ecs: ECS;

  constructor(public room: Room, public params: WorldParams) {
    const { chunkSize } = params;

    this.chunks = new Chunks(this);
    this.entities = new Entities(this);
    this.registry = new Registry(this);
    this.pipeline = new Pipeline(this);

    this.ecs = new ECS();
    this.ecs.timeScale = 0;

    this.ecs.addSystem(new BroadcastEntitiesSystem(this.entities));
    this.ecs.addSystem(new CurrentChunkSystem(chunkSize));
    this.ecs.addSystem(new GenerateChunksSystem(this.chunks));
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

  addStage = (
    stage: new (p: Pipeline, c: Chunks, r: Registry) => ChunkStage
  ) => {
    this.pipeline.addStage(stage);
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
    this.pipeline.update();
    this.chunks.update();
  };
}

export type { WorldParams };

export { World };
