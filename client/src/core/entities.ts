import { Object3D, Vector3 } from "three";

import { Client } from "..";
import { Entity } from "../libs";

import {
  EntityFlag,
  HeadingComponent,
  IDComponent,
  MeshComponent,
  MetadataComponent,
  Position3DComponent,
  TargetComponent,
  TypeComponent,
} from "./comps";

/**
 * Creating a new {@link BaseEntity}.
 */
type NewEntity = new () => BaseEntity;

/**
 * Parameters to customizing the Voxelize {@link Entities} map.
 */
type EntitiesParams = {
  /**
   * The default interpolation factor for all entities. Defaults to `0.7`.
   */
  lerpFactor: number;
};

const defaultParams: EntitiesParams = {
  lerpFactor: 0.7,
};

/**
 * The base class of an entity in the ECS on the client-side. Entities are all
 * server based, meaning that other than the entity `mesh` field, mutating values
 * within does not affect the actual entities living on the server.
 *
 * @noInheritDoc
 */
class BaseEntity extends Entity {
  /**
   * The ID of the entity, used for data syncing.
   */
  public id: string;

  /**
   * The type of the entity, used to differentiate entities.
   */
  public type: string;

  /**
   * The **shared** interpolation factor of all entities.
   */
  static LERP_FACTOR = 1;

  /**
   * Construct a new entity with some preset ECS components:
   * - {@link EntityFlag}
   * - {@link MeshComponent}
   * - {@link Position3DComponent}
   * - {@link HeadingComponent}
   * - {@link TargetComponent}
   * - {@link MetadataComponent}
   */
  constructor() {
    super();

    this.add(new EntityFlag());
    this.add(new MeshComponent());
    this.add(new Position3DComponent(new Vector3()));
    this.add(new HeadingComponent(new Vector3()));
    this.add(new TargetComponent(new Vector3()));
    this.add(new MetadataComponent({}));
  }

  /**
   * Set the metadata of the entity.
   *
   * @hidden
   */
  set metadata(m: { [key: string]: any }) {
    MetadataComponent.get(this).data = m;
  }

  /**
   * Get the metadata of the entity.
   */
  get metadata() {
    return MetadataComponent.get(this).data;
  }

  /**
   * Set the position of the entity.
   *
   * @hidden
   */
  set position(p: Vector3) {
    Position3DComponent.get(this).data.set(p.x, p.y, p.z);
  }

  /**
   * Get the position of the entity.
   */
  get position() {
    return Position3DComponent.get(this).data;
  }

  /**
   * Set the target of the entity.
   *
   * @hidden
   */
  set target(t: Vector3) {
    TargetComponent.get(this).data.set(t.x, t.y, t.z);
  }

  /**
   * Get the target of the entity.
   */
  get target() {
    return TargetComponent.get(this).data;
  }

  /**
   * Set the heading of the entity.
   *
   * @hidden
   */
  set heading(h: Vector3) {
    HeadingComponent.get(this).data.set(h.x, h.y, h.z);
  }

  /**
   * Get the heading of the entity.
   */
  get heading() {
    return HeadingComponent.get(this).data;
  }

  /**
   * Set the position of the entity.
   */
  set mesh(mesh: Object3D) {
    MeshComponent.get(this).data = mesh;
  }

  /**
   * Get the position of the entity.
   */
  get mesh() {
    return MeshComponent.get(this).data;
  }

  /**
   * If implemented, gets called when a new entity of this type is created.
   */
  onCreation?: (client: Client) => void;

  /**
   * If implemented, gets called when a new entity of this type is deleted.
   */
  onDeletion?: (client: Client) => void;
}

/**
 * A **built-in** map representing living entities on the server.
 *
 * @noInheritDoc
 */
class Entities extends Map<string, BaseEntity> {
  /**
   * Reference linking back to the Voxelize client instance.
   */
  public client: Client;

  /**
   * Parameters to customize the Voxelize entities.
   */
  public params: EntitiesParams;

  /**
   * A function called before every update per tick.
   */
  public onBeforeUpdate?: () => void;

  /**
   * A function called after every update per tick.
   */
  public onAfterUpdate?: () => void;

  private knownTypes: Map<string, NewEntity> = new Map();

  /**
   * Construct a Voxelize entities map.
   *
   * @hidden
   */
  constructor(client: Client, params: Partial<EntitiesParams> = {}) {
    super();

    this.client = client;

    const { lerpFactor } = (this.params = {
      ...defaultParams,
      ...params,
    });

    BaseEntity.LERP_FACTOR = lerpFactor;
  }

  /**
   * Network handler for Voxelize entities.
   *
   * @hidden
   */
  onEvent = ({ id, type, metadata }: any) => {
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

    entity.metadata = metadata;
  };

  /**
   * Register a new entity to be rendered.
   *
   * Example: Register a plain entity called `Test`.
   * ```ts
   * class TestEntity extends BaseEntity {}
   *
   * client.entities.registerEntity("Test", TestEntity);
   * ```
   *
   * @param type - The name of the type of the new entity.
   * @param protocol - The class protocol to create a new entity.
   */
  registerEntity = (type: string, protocol: NewEntity) => {
    this.knownTypes.set(type.toLowerCase(), protocol);
  };

  /**
   * Reset the entities map.
   *
   * @internal
   * @hidden
   */
  reset = () => {
    this.forEach((entity, key) => {
      this.removeEntity(entity);
      this.delete(key);
    });
  };

  /**
   * Updater for entities.
   *
   * @hidden
   */
  update = () => {
    this.onBeforeUpdate?.();
    // TODO
    this.onAfterUpdate?.();
  };

  private removeEntity = (entity: BaseEntity) => {
    const { rendering, ecs } = this.client;

    if (entity.onDeletion) {
      entity.onDeletion(this.client);
    }

    const { mesh } = entity;
    if (mesh) {
      rendering.scene.remove(mesh);
    }

    ecs.removeEntity(entity);
  };

  private addEntity = (id: string, type: string) => {
    const { rendering, ecs } = this.client;
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

    const { mesh } = entity;
    if (mesh) {
      rendering.scene.add(mesh);
    }

    if (entity.onCreation) {
      entity.onCreation(this.client);
    }

    ecs.addEntity(entity);

    this.set(id, entity);

    return entity;
  };
}

export type { NewEntity, EntitiesParams };

export { BaseEntity, Entities };
