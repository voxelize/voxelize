let NOW: () => number;

// Include a performance.now polyfill.
// In node.js, use process.hrtime.
if (
  typeof self === "undefined" &&
  // @ts-ignore
  typeof process !== "undefined" &&
  // @ts-ignore
  process.hrtime
) {
  NOW = function () {
    // @ts-ignore
    const time = process.hrtime();

    // Convert [seconds, nanoseconds] to milliseconds.
    return time[0] * 1000 + time[1] / 1000000;
  };
}
// In a browser, use self.performance.now if it is available.
else if (
  typeof self !== "undefined" &&
  self.performance !== undefined &&
  self.performance.now !== undefined
) {
  // This must be bound, because directly assigning this function
  // leads to an invocation exception in Chrome.
  NOW = self.performance.now.bind(self.performance);
}
// Use Date.now if it is available.
else if (Date.now !== undefined) {
  NOW = Date.now;
}
// Otherwise, use 'new Date().getTime()'.
else {
  NOW = function () {
    return new Date().getTime();
  };
}

let SEQ_SYSTEM = 1;

let SEQ_ENTITY = 1;

let SEQ_COMPONENT = 1;

/**
 * Utility class for asynchronous access to a list
 */
export class Iterator<T> {
  private end = false;

  private cache: T[] = [];

  private next: (i: number) => T | void;

  constructor(next: (i: number) => T | void) {
    this.next = next;
  }

  /**
   * Allows iterate across all items
   *
   * @param cb
   */
  each(cb: (item: T) => boolean | void) {
    let index = 0;
    while (true) {
      let value: T | void;
      if (this.cache.length <= index) {
        if (this.end) {
          break;
        }

        value = this.next(index++);
        if (value === undefined) {
          this.end = true;
          break;
        }
        if (value) {
          this.cache.push(value);
        }
      } else {
        value = this.cache[index++];
      }

      if (!value || cb(value) === false) {
        break;
      }
    }
  }

  /**
   * returns the value of the first element that satisfies the provided testing function.
   *
   * @param test
   */
  find(test: (item: T) => boolean): T | undefined {
    let out = undefined;
    this.each((item) => {
      if (test(item)) {
        out = item;
        // break
        return false;
      }
    });
    return out;
  }

  /**
   * creates a array with all elements that pass the test implemented by the provided function.
   *
   * @param test
   */
  filter(test: (item: T) => boolean): T[] {
    const list: T[] = [];
    this.each((item) => {
      if (test(item)) {
        list.push(item);
      }
    });
    return list;
  }

  /**
   * creates a new array with the results of calling a provided function on every element in this iterator.
   *
   * @param cb
   */
  map<P>(cb: (item: T) => P): P[] {
    const list: P[] = [];
    this.each((item) => {
      list.push(cb(item));
    });
    return list;
  }
}

export type Susbcription = (
  entity: Entity,
  added?: Component<any>,
  removed?: Component<any>
) => void;

/**
 * Representation of an entity in ECS
 */
export abstract class Entity {
  /**
   * Lista de interessados sobre a atualiação dos componentes
   */
  private subscriptions: Array<Susbcription> = [];

  /**
   * Components by type
   */
  private components: {
    [key: number]: Component<any>[];
  } = {};

  public entId: number;

  /**
   * Informs if the entity is active
   */
  public active = true;

  constructor() {
    this.entId = SEQ_ENTITY++;
  }

  /**
   * Allows interested parties to receive information when this entity's component list is updated
   *
   * @param handler
   */
  public subscribe(handler: Susbcription): () => Entity {
    this.subscriptions.push(handler);

    return () => {
      const idx = this.subscriptions.indexOf(handler);
      if (idx >= 0) {
        this.subscriptions.splice(idx, 1);
      }
      return this;
    };
  }

  /**
   * Add a component to this entity
   *
   * @param component
   */
  public add(component: Component<any>) {
    const type = component.type;
    if (!this.components[type]) {
      this.components[type] = [];
    }

    if (this.components[type].indexOf(component) >= 0) {
      return;
    }

    this.components[type].push(component);

    // Informa aos interessados sobre a atualização
    this.subscriptions.forEach((cb) => cb(this, component, undefined));
  }

  /**
   * Removes a component's reference from this entity
   *
   * @param component
   */
  public remove(component: Component<any>) {
    const type = component.type;
    if (!this.components[type]) {
      return;
    }

    const idx = this.components[type].indexOf(component);
    if (idx >= 0) {
      this.components[type].splice(idx, 1);

      if (this.components[type].length < 1) {
        delete this.components[type];
      }

      // Informa aos interessados sobre a atualização
      this.subscriptions.forEach((cb) => cb(this, undefined, component));
    }
  }
}

/**
 * Force typing
 */
export type ComponentClassType<P> = (new (data?: P) => Component<P>) & {
  /**
   * Static reference to type id
   */
  type: number;

  /**
   * Get all instances of this component from entity
   *
   * @param entity
   */
  getAll(entity: Entity): Component<P>[];

  /**
   * Get one instance of this component from entity
   *
   * @param entity
   */
  get(entity: Entity): Component<P>;
};

/**
 * Representation of a component in ECS
 */
export abstract class Component<T> {
  /**
   * Register a new component class
   */
  public static register<P>(): ComponentClassType<P> {
    const typeID = SEQ_COMPONENT++;

    class ComponentImpl extends Component<P> {
      static type = typeID;

      static getAll(entity: Entity): ComponentImpl[] {
        const components: ComponentImpl[] = (entity as any).components[typeID];
        return components || [];
      }

      static get(entity: Entity): ComponentImpl | undefined {
        const components = ComponentImpl.getAll(entity);
        if (components && components.length > 0) {
          return components[0];
        }
      }

      /**
       * Create a new instance of this custom component
       *
       * @param data
       */
      constructor(data?: P) {
        super(typeID, data);
      }
    }

    return ComponentImpl as any as ComponentClassType<P>;
  }

  public type: number;

  public data: T;

  /**
   * A component can have attributes. Attributes are secondary values used to save miscellaneous data required by some
   * specialized systems.
   */
  public attr: {
    [key: string]: any;
  } = {};

  constructor(type: number, data: T) {
    this.type = type;
    this.data = data;
  }
}

/**
 * System callback
 */
export type EventCallback = (data: any, entities: Iterator<Entity>) => void;

/**
 * Represents the logic that transforms component data of an entity from its current state to its next state. A system
 * runs on entities that have a specific set of component types.
 */
export abstract class System {
  /**
   * IDs of the types of components this system expects the entity to have before it can act on. If you want to
   * create a system that acts on all entities, enter [-1]
   */
  private readonly componentTypes: number[] = [];

  private readonly callbacks: { [key: string]: Array<EventCallback> } = {};

  /**
   * Unique identifier of an instance of this system
   */
  public readonly sysId: number;

  /**
   * The maximum times per second this system should be updated
   */
  public frequence: number;

  /**
   * Reference to the world, changed at runtime during interactions.
   */
  protected world: ECS = undefined as any;

  /**
   * Allows to trigger any event. Systems interested in this event will be notified immediately
   *
   * Injected by ECS at runtime
   *
   * @param event
   * @param data
   */
  protected trigger: (event: string, data: any) => void = undefined as any;

  /**
   * Invoked before updating entities available for this system. It is only invoked when there are entities with the
   * characteristics expected by this system.
   *
   * @param time
   */
  public beforeUpdateAll?(time: number): void;

  /**
   * Invoked in updates, limited to the value set in the "frequency" attribute
   *
   * @param entity
   * @param time
   * @param delta
   */
  public update?(entity: Entity, time: number, delta: number): void;

  /**
   * Invoked after performing update of entities available for this system. It is only invoked when there are entities
   * with the characteristics expected by this system.
   *
   * @param time
   */
  public afterUpdateAll?(time: number, entities: Entity[]): void;

  /**
   * Invoked when an expected feature of this system is added or removed from the entity
   *
   * @param entity
   * @param added
   * @param removed
   */
  public change?(
    entity: Entity,
    added?: Component<any>,
    removed?: Component<any>
  ): void;

  /**
   * Invoked when:
   * a) An entity with the characteristics (components) expected by this system is added in the world;
   * b) This system is added in the world and this world has one or more entities with the characteristics expected by
   * this system;
   * c) An existing entity in the same world receives a new component at runtime and all of its new components match
   * the standard expected by this system.
   *
   * @param entity
   */
  public enter?(entity: Entity): void;

  /**
   * Invoked when:
   * a) An entity with the characteristics (components) expected by this system is removed from the world;
   * b) This system is removed from the world and this world has one or more entities with the characteristics
   * expected by this system;
   * c) An existing entity in the same world loses a component at runtime and its new component set no longer matches
   * the standard expected by this system
   *
   * @param entity
   */
  public exit?(entity: Entity): void;

  /**
   * @param componentTypes IDs of the types of components this system expects the entity to have before it can act on.
   * If you want to create a system that acts on all entities, enter [-1]
   * @param frequence The maximum times per second this system should be updated. Defaults 0
   */
  constructor(componentTypes: number[], frequence = 0) {
    this.sysId = SEQ_SYSTEM++;
    this.componentTypes = componentTypes;
    this.frequence = frequence;
  }

  /**
   * Allows you to search in the world for all entities that have a specific set of components.
   *
   * @param componentTypes Enter [-1] to list all entities
   */
  protected query(componentTypes: number[]): Iterator<Entity> {
    return this.world.query(componentTypes);
  }

  /**
   * Allows the system to listen for a specific event that occurred during any update.
   *
   * In callback, the system has access to the existing entities in the world that are processed by this system, in
   * the form of an Iterator, and the raw data sent by the event trigger.
   *
   * ATTENTION! The callback method will be invoked immediately after the event fires, avoid heavy processing.
   *
   * @param event
   * @param callback
   * @param once Allows you to perform the callback only once
   */
  protected listenTo(event: string, callback: EventCallback, once?: boolean) {
    if (!this.callbacks.hasOwnProperty(event)) {
      this.callbacks[event] = [];
    }

    if (once) {
      const tmp = callback.bind(this);

      callback = (data: any, entities: Iterator<Entity>) => {
        tmp(data, entities);

        const idx = this.callbacks[event].indexOf(callback);
        if (idx >= 0) {
          this.callbacks[event].splice(idx, 1);
        }
        if (this.callbacks[event].length === 0) {
          delete this.callbacks[event];
        }
      };
    }

    this.callbacks[event].push(callback);
  }
}

/**
 * The very definition of the ECS. Also called Admin or Manager in other implementations.
 */
export default class ECS {
  public static System = System;

  public static Entity = Entity;

  public static Component = Component;

  /**
   * All systems in this world
   */
  private systems: System[] = [];

  /**
   * All entities in this world
   */
  private entities: Entity[] = [];

  /**
   * Indexes the systems that must be run for each entity
   */
  private entitySystems: { [key: number]: System[] } = {};

  /**
   * Records the last instant a system was run in this world for an entity, using real time
   */
  private entitySystemLastUpdate: { [key: number]: { [key: number]: number } } =
    {};

  /**
   * Records the last instant a system was run in this world for an entity, using game time
   */
  private entitySystemLastUpdateGame: {
    [key: number]: { [key: number]: number };
  } = {};

  /**
   * Saves subscriptions made to entities
   */
  private entitySubscription: { [key: number]: () => void } = {};

  /**
   * Injection for the system trigger method
   *
   * @param event
   * @param data
   */
  private systemTrigger = (event: string, data: any) => {
    this.systems.forEach((system) => {
      const callbacks: {
        [key: string]: Array<EventCallback>;
      } = (system as any).callbacks;

      if (callbacks.hasOwnProperty(event) && callbacks[event].length > 0) {
        this.inject(system);
        const entitiesIterator = this.query((system as any).componentTypes);
        callbacks[event].forEach((callback) => {
          callback(data, entitiesIterator);
        });
      }
    });
  };

  /**
   * Allows you to apply slow motion effect on systems execution. When timeScale is 1, the timestamp and delta
   * parameters received by the systems are consistent with the actual timestamp. When timeScale is 0.5, the values
   * received by systems will be half of the actual value.
   *
   * ATTENTION! The systems continue to be invoked obeying their normal frequencies, what changes is only the values
   * received in the timestamp and delta parameters.
   */
  public timeScale = 1;

  /**
   * Last execution of update method
   */
  private lastUpdate: number = NOW();

  /**
   * The timestamp of the game, different from the real world, is updated according to timeScale. If at no time does
   * the timeScale change, the value is the same as the current timestamp.
   *
   * This value is sent to the systems update method.
   */
  private gameTime = 0;

  constructor(systems?: System[]) {
    if (systems) {
      systems.forEach((system) => {
        this.addSystem(system);
      });
    }
  }

  /**
   * Remove all entities and systems
   */
  public destroy() {
    this.entities.forEach((entity) => {
      this.removeEntity(entity);
    });

    this.systems.forEach((system) => {
      this.removeSystem(system);
    });
  }

  /**
   * Get an entity by id
   *
   * @param entId
   */
  public getEntity(entId: number): Entity | undefined {
    return this.entities.find((entity) => entity.entId === entId);
  }

  /**
   * Add an entity to this world
   *
   * @param entity
   */
  public addEntity(entity: Entity) {
    if (!entity || this.entities.indexOf(entity) >= 0) {
      return;
    }

    this.entities.push(entity);
    this.entitySystemLastUpdate[entity.entId] = {};
    this.entitySystemLastUpdateGame[entity.entId] = {};

    // Remove subscription
    if (this.entitySubscription[entity.entId]) {
      this.entitySubscription[entity.entId]();
    }

    // Add new subscription
    this.entitySubscription[entity.entId] = entity.subscribe(
      (entity, added, removed) => {
        this.onEntityUpdate(entity, added, removed);
        this.indexEntity(entity);
      }
    );

    this.indexEntity(entity);
  }

  /**
   * Remove an entity from this world
   *
   * @param idOrInstance
   */
  public removeEntity(idOrInstance: number | Entity) {
    let entity: Entity = idOrInstance as Entity;
    if (typeof idOrInstance === "number") {
      entity = this.getEntity(idOrInstance) as Entity;
    }

    if (!entity) {
      return;
    }

    const idx = this.entities.indexOf(entity);
    if (idx >= 0) {
      this.entities.splice(idx, 1);
    }

    // Remove subscription, if any
    if (this.entitySubscription[entity.entId]) {
      this.entitySubscription[entity.entId]();
    }

    // Invoke system exit
    const systems = this.entitySystems[entity.entId];
    if (systems) {
      systems.forEach((system) => {
        if (system.exit) {
          this.inject(system);
          system.exit(entity as Entity);
        }
      });
    }

    // Remove associative indexes
    delete this.entitySystems[entity.entId];
    delete this.entitySystemLastUpdate[entity.entId];
    delete this.entitySystemLastUpdateGame[entity.entId];
  }

  /**
   * Add a system in this world
   *
   * @param system
   */
  public addSystem(system: System) {
    if (!system) {
      return;
    }

    if (this.systems.indexOf(system) >= 0) {
      return;
    }

    this.systems.push(system);

    // Indexes entities
    this.entities.forEach((entity) => {
      this.indexEntity(entity, system);
    });

    // Invokes system enter
    this.entities.forEach((entity) => {
      if (entity.active) {
        const systems = this.entitySystems[entity.entId];
        if (systems && systems.indexOf(system) >= 0) {
          if (system.enter) {
            this.inject(system);
            system.enter(entity);
          }
        }
      }
    });
  }

  /**
   * Remove a system from this world
   *
   * @param system
   */
  public removeSystem(system: System) {
    if (!system) {
      return;
    }

    const idx = this.systems.indexOf(system);
    if (idx >= 0) {
      // Invoke system exit
      this.entities.forEach((entity) => {
        if (entity.active) {
          const systems = this.entitySystems[entity.entId];
          if (systems && systems.indexOf(system) >= 0) {
            if (system.exit) {
              this.inject(system);
              system.exit(entity);
            }
          }
        }
      });

      this.systems.splice(idx, 1);

      if ((system as any).world === this) {
        (system as any).world = undefined;
        (system as any).trigger = undefined;
      }

      // Indexes entities
      this.entities.forEach((entity) => {
        this.indexEntity(entity, system);
      });
    }
  }

  /**
   * Allows you to search for all entities that have a specific set of components.
   *
   * @param componentTypes Enter [-1] to list all entities
   */
  public query(componentTypes: number[]): Iterator<Entity> {
    let index = 0;
    const listAll = componentTypes.indexOf(-1) >= 0;

    return new Iterator<Entity>(() => {
      outside: for (let l = this.entities.length; index < l; index++) {
        const entity = this.entities[index];
        if (listAll) {
          // Prevents unnecessary processing
          return entity;
        }

        // -1 = All components. Allows to query for all entities in the world.
        const entityComponentIDs: number[] = [-1].concat(
          Object.keys((entity as any).components).map((v) =>
            Number.parseInt(v, 10)
          )
        );

        for (let a = 0, j = componentTypes.length; a < j; a++) {
          if (entityComponentIDs.indexOf(componentTypes[a]) < 0) {
            continue outside;
          }
        }

        // Entity has all the components
        return entity;
      }
    });
  }

  /**
   * Invokes the "update" method of the systems in this world.
   */
  public update() {
    const now = NOW();

    // adds scaledDelta
    this.gameTime += (now - this.lastUpdate) * this.timeScale;
    this.lastUpdate = now;

    let toCallAfterUpdateAll: {
      [key: string]: {
        system: System;
        entities: Entity[];
      };
    } = {};

    this.entities.forEach((entity) => {
      if (!entity.active) {
        // Entidade inativa
        return this.removeEntity(entity);
      }

      const systems = this.entitySystems[entity.entId];
      if (!systems) {
        return;
      }

      const entityLastUpdates = this.entitySystemLastUpdate[entity.entId];
      const entityLastUpdatesGame =
        this.entitySystemLastUpdateGame[entity.entId];
      let elapsed, elapsedScaled, interval;

      systems.forEach((system) => {
        if (system.update) {
          this.inject(system);

          elapsed = now - entityLastUpdates[system.sysId];
          elapsedScaled = this.gameTime - entityLastUpdatesGame[system.sysId];

          // Limit FPS
          if (system.frequence > 0) {
            interval = 1000 / system.frequence;
            if (elapsed < interval) {
              return;
            }

            // adjust for fpsInterval not being a multiple of RAF's interval (16.7ms)
            entityLastUpdates[system.sysId] = now - (elapsed % interval);
            entityLastUpdatesGame[system.sysId] = this.gameTime;
          } else {
            entityLastUpdates[system.sysId] = now;
            entityLastUpdatesGame[system.sysId] = this.gameTime;
          }

          const id = `_${system.sysId}`;
          if (!toCallAfterUpdateAll[id]) {
            // Call afterUpdateAll
            if (system.beforeUpdateAll) {
              system.beforeUpdateAll(this.gameTime);
            }

            // Save for afterUpdateAll
            toCallAfterUpdateAll[id] = {
              system: system,
              entities: [],
            };
          }
          toCallAfterUpdateAll[id].entities.push(entity);

          // Call update
          system.update(entity, this.gameTime, elapsedScaled);
        }
      });
    });

    // Call afterUpdateAll
    for (const attr in toCallAfterUpdateAll) {
      if (!toCallAfterUpdateAll.hasOwnProperty(attr)) {
        continue;
      }

      const system = toCallAfterUpdateAll[attr].system;
      if (system.afterUpdateAll) {
        this.inject(system);
        system.afterUpdateAll(
          this.gameTime,
          toCallAfterUpdateAll[attr].entities
        );
      }
    }
    toCallAfterUpdateAll = {};
  }

  /**
   * Injects the execution context into the system.
   *
   * A system can exist on several worlds at the same time, ECS ensures that global methods will always reference the
   * currently running world.
   *
   * @param system
   */
  private inject(system: System): System {
    (system as any).world = this;
    (system as any).trigger = this.systemTrigger;
    return system;
  }

  /**
   * When an entity receives or loses components, invoking the change method of the systems
   *
   * @param entity
   */
  private onEntityUpdate(
    entity: Entity,
    added?: Component<any>,
    removed?: Component<any>
  ) {
    if (!this.entitySystems[entity.entId]) {
      return;
    }

    const toNotify: System[] = this.entitySystems[entity.entId].slice(0);

    outside: for (let idx = toNotify.length - 1; idx >= 0; idx--) {
      const system = toNotify[idx];

      // System is listening to updates on entity?
      if (system.change) {
        const systemComponentTypes = (system as any).componentTypes;

        // Listen to all component type
        if (systemComponentTypes.indexOf(-1) >= 0) {
          continue;
        }

        if (added && systemComponentTypes.indexOf(added.type) >= 0) {
          continue outside;
        }

        if (removed && systemComponentTypes.indexOf(removed.type) >= 0) {
          continue outside;
        }
      }

      // dont match
      toNotify.splice(idx, 1);
    }

    // Notify systems
    toNotify.forEach((system) => {
      system = this.inject(system);
      const systemComponentTypes = (system as any).componentTypes;
      const all = systemComponentTypes.indexOf(-1) >= 0;
      (system.change as any)(
        entity,
        // Send only the list of components this system expects
        all
          ? added
          : added && systemComponentTypes.indexOf(added.type) >= 0
          ? added
          : undefined,
        all
          ? removed
          : removed && systemComponentTypes.indexOf(removed.type) >= 0
          ? removed
          : undefined
      );
    });
  }

  private indexEntitySystem = (entity: Entity, system: System) => {
    const idx = this.entitySystems[entity.entId].indexOf(system);

    // Sistema não existe neste mundo, remove indexação
    if (this.systems.indexOf(system) < 0) {
      if (idx >= 0) {
        this.entitySystems[entity.entId].splice(idx, 1);
        delete this.entitySystemLastUpdate[entity.entId][system.sysId];
        delete this.entitySystemLastUpdateGame[entity.entId][system.sysId];
      }
      return;
    }

    const systemComponentTypes = (system as any).componentTypes;

    for (let a = 0, l = systemComponentTypes.length; a < l; a++) {
      // -1 = All components. Allows a system to receive updates from all entities in the world.
      const entityComponentIDs: number[] = [-1].concat(
        Object.keys((entity as any).components).map((v) =>
          Number.parseInt(v, 10)
        )
      );
      if (entityComponentIDs.indexOf(systemComponentTypes[a]) < 0) {
        // remove
        if (idx >= 0) {
          // Informs the system of relationship removal
          if (system.exit) {
            this.inject(system);
            system.exit(entity);
          }

          this.entitySystems[entity.entId].splice(idx, 1);
          delete this.entitySystemLastUpdate[entity.entId][system.sysId];
          delete this.entitySystemLastUpdateGame[entity.entId][system.sysId];
        }
        return;
      }
    }

    // Entity has all the components this system needs
    if (idx < 0) {
      this.entitySystems[entity.entId].push(system);
      this.entitySystemLastUpdate[entity.entId][system.sysId] = NOW();
      this.entitySystemLastUpdateGame[entity.entId][system.sysId] =
        this.gameTime;

      // Informs the system about the new relationship
      if (system.enter) {
        this.inject(system);
        system.enter(entity);
      }
    }
  };

  /**
   * Indexes an entity
   *
   * @param entity
   */
  private indexEntity(entity: Entity, system?: System) {
    if (!this.entitySystems[entity.entId]) {
      this.entitySystems[entity.entId] = [];
    }

    if (system) {
      // Index entity for a specific system
      this.indexEntitySystem(entity, system);
    } else {
      // Indexes the entire entity
      this.systems.forEach((system) => {
        this.indexEntitySystem(entity, system);
      });
    }
  }
}
