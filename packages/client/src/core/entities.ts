import {
  Entity,
  EntityComponent,
  IDComponent,
  MetadataComponent,
  TypeComponent,
} from "@voxelize/common";
import { Object3D, Vector3 } from "three";

import { Client } from "..";

import {
  HeadingComponent,
  MeshComponent,
  Position3DComponent,
  TargetComponent,
} from "./comps";

type NewEntity = new () => BaseEntity;

type EntitiesParams = {
  lerpFactor: number;
};

const defaultParams: EntitiesParams = {
  lerpFactor: 0.7,
};

class BaseEntity extends Entity {
  static LERP_FACTOR = 1;

  public id: string;
  public type: string;

  constructor() {
    super();

    this.add(new EntityComponent());
    this.add(new MeshComponent());
    this.add(new Position3DComponent(new Vector3()));
    this.add(new HeadingComponent(new Vector3()));
    this.add(new TargetComponent(new Vector3()));
    this.add(new MetadataComponent({}));
  }

  set position(p: Vector3) {
    Position3DComponent.get(this).data.set(p.x, p.y, p.z);
  }

  get position() {
    return Position3DComponent.get(this).data;
  }

  set target(t: Vector3) {
    TargetComponent.get(this).data.set(t.x, t.y, t.z);
  }

  get target() {
    return TargetComponent.get(this).data;
  }

  set heading(h: Vector3) {
    HeadingComponent.get(this).data.set(h.x, h.y, h.z);
  }

  get heading() {
    return HeadingComponent.get(this).data;
  }

  set mesh(mesh: Object3D) {
    MeshComponent.get(this).data = mesh;
  }

  get mesh() {
    return MeshComponent.get(this).data;
  }

  onEvent?: (e: any) => void;
  onCreation?: (client: Client) => void;
  onDeletion?: (client: Client) => void;
}

class Entities extends Map<string, BaseEntity> {
  params: EntitiesParams;

  knownTypes: Map<string, NewEntity> = new Map();

  constructor(public client: Client, params: Partial<EntitiesParams> = {}) {
    super();

    const { lerpFactor } = (this.params = {
      ...defaultParams,
      ...params,
    });

    BaseEntity.LERP_FACTOR = lerpFactor;
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

    entity.position = position;
    entity.target = target;
    entity.heading = heading;

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
        this.client.ecs.removeEntity(entity);
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

    entity.add(new IDComponent(id));
    entity.add(new TypeComponent(type));

    entity.id = id;
    entity.type = type;

    if (entity.onCreation) {
      entity.onCreation(this.client);
    }

    this.client.ecs.addEntity(entity);

    this.set(id, entity);

    return entity;
  };
}

export type { NewEntity, EntitiesParams };

export { BaseEntity, Entities };
