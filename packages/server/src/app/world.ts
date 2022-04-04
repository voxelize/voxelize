import { ECS, System, Block, BaseWorldParams } from "@voxelize/common";

import { Chunks } from "./chunks";
import { BaseEntity, Entities } from "./entities";
import { Client } from "./ents";
import { ChunkStage, Pipeline } from "./pipeline";
import { Registry } from "./registry";
import { Room } from "./room";
import { Sender } from "./sender";
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

/**
 * World of the game, where the magic happens. The world consists of several
 * essential managers to the game: `Chunks`, `Entities`, `Registry`, `Pipeline`.
 * Each manager serves their own purpose to the game. `world.ecs` is an ECS
 * (Entity Component System) world that stores all entities and components and
 * runs the systems periodically.
 *
 * By default, these ECS systems are added:
 * - `BroadcastEntitiesSystem`: Used to broadcast entities to all clients
 * - `CurrentChunkSystem`: Used to calculate what chunks entities are in
 * - `GenerateChunkSystem`: Used to generate the chunks clients requested for
 *
 * @param room - `Room` that the world exists in
 * @param params - Parameters of the world
 */
class World {
  public chunks: Chunks;
  public sender: Sender;
  public entities: Entities;
  public registry: Registry;
  public pipeline: Pipeline;

  public ecs: ECS;

  constructor(public room: Room, public params: WorldParams) {
    const { chunkSize } = params;

    this.chunks = new Chunks(this);
    this.sender = new Sender(this);
    this.entities = new Entities(this);
    this.registry = new Registry(this);
    this.pipeline = new Pipeline(this);

    this.ecs = new ECS();
    this.ecs.timeScale = 0;

    this.ecs.addSystem(new BroadcastEntitiesSystem(this.entities));
    this.ecs.addSystem(new CurrentChunkSystem(chunkSize));
    this.ecs.addSystem(new GenerateChunksSystem(this.chunks));
  }

  /**
   * Register a new type of entity. Entities must be extended from
   * `BaseEntity` in order to be recorded into the ECS world.
   *
   * @param type - What the new entity type is called
   * @param protocol - A class of the new entity
   */
  registerEntity = <T extends BaseEntity>(
    type: string,
    protocol: Constructor<T>
  ) => {
    this.entities.registerEntity(type, protocol);
  };

  /**
   * Register a new type of block.
   *
   * @param name - What the new block type is called
   * @param block - Options describing the block
   * @returns The configured block type
   */
  registerBlock = (name: string, block: Omit<Partial<Block>, "id"> = {}) => {
    return this.registry.registerBlock(name, block);
  };

  /**
   * Instantiate a new entity of type.
   *
   * @param type - The type of entity to instantiate
   * @returns A new entity instance of the specific type
   */
  addEntity = (type: string) => {
    const entity = this.entities.addEntity(type);
    this.ecs.addEntity(entity);
    return entity;
  };

  /**
   * Register a ECS system. Systems must be implemented from `System`
   * exported in `@voxelize/common`.
   *
   * @param system - The new system to add to the world
   */
  addSystem = (system: System) => {
    this.ecs.addSystem(system);
  };

  /**
   * Add a chunk pipeline stage. Pipeline stages are stages that do something
   * to all chunks, for example populating them with block data.
   *
   * @param stage - new stage to add to the pipeline
   */
  addStage = (stage: ChunkStage) => {
    this.pipeline.addStage(stage);
  };

  /**
   * Start the world, called by the room, simply sets the time scale of the ECS
   * world to one. This also generates the UV mappings.
   */
  start = () => {
    this.ecs.timeScale = 1;
    this.registry.generate();
  };

  /**
   * Stop the world from running, setting the ECS time scale to 0
   */
  stop = () => {
    this.ecs.timeScale = 0;
  };

  /**
   * Disconnection handler for world.
   *
   * DO NOT CALL THIS DIRECTLY! THINGS MAY BREAK!
   *
   * @param client - Client that disconnected
   */
  onDisconnect = (client: Client) => {
    this.ecs.removeEntity(client);
    this.chunks.onDisconnect(client);
  };

  /**
   * Updater of the world. Calls the updaters of the followings:
   * - `ECS`
   * - `Entities`
   * - `Pipeline`
   * - `Chunks`
   *
   * DO NOT CALL DIRECTLY! THINGS MAY BREAK!
   */
  update = () => {
    this.ecs.update();
    this.entities.update();
    this.pipeline.update();
    this.chunks.update();
    this.sender.update();
  };
}

export type { WorldParams };

export { World };
