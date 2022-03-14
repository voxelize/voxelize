import { Client } from "..";
import { Entity } from "../libs";

type NewEntity = new () => Entity;

type EntitiesParams = {
  lerpFactor: number;
};

const defaultParams: EntitiesParams = {
  lerpFactor: 0.7,
};

class Entities extends Map<string, Entity> {
  params: EntitiesParams;

  knownTypes: Map<string, NewEntity> = new Map();

  constructor(public client: Client, params: Partial<EntitiesParams> = {}) {
    super();

    const { lerpFactor } = (this.params = {
      ...defaultParams,
      ...params,
    });

    Entity.LERP_FACTOR = lerpFactor;
  }

  onEvent = ({ id, type, position, target, heading, ...other }: any) => {
    const knownType = this.knownTypes.get(type.toLowerCase());

    if (!knownType) {
      console.warn(`Received packet for unregistered entity type: ${type}`);
      return;
    }

    let entity = this.get(id);

    if (!entity) {
      const newEntity = this.addEntity(id, type);

      if (!newEntity) return;

      entity = newEntity;
    }

    if (!entity) {
      console.warn(`Received empty packet for entity id: ${id}`);
      return;
    }

    entity.update(position, target, heading);

    if (entity.onEvent) {
      entity.onEvent(other);
    }
  };

  registerEntity = (type: string, protocol: NewEntity) => {
    this.knownTypes.set(type.toLowerCase(), protocol);
  };

  reset = () => {
    this.forEach((entity, key) => {
      if (entity.onDeletion) {
        entity.onDeletion(this.client);
        this.delete(key);
      }
    });
  };

  update = () => {
    // TODO
  };

  private addEntity = (id: string, type: string) => {
    const Protocol = this.knownTypes.get(type.toLowerCase());

    if (!Protocol) {
      console.error(`Tried to add non-existent entity: ${type}`);
      return null;
    }

    const entity = new Protocol();

    entity.id = id;
    entity.type = type;

    if (entity.onCreation) {
      entity.onCreation(this.client);
    }

    this.set(id, entity);

    return entity;
  };
}

export type { NewEntity, EntitiesParams };

export { Entities };
