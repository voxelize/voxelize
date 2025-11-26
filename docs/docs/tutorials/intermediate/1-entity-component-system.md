---
sidebar_position: 1
---

# Entity Component System

Voxelize servers run on the [Specs ECS crate](https://specs.amethyst.rs/docs/tutorials/). It is recommended to read through the Specs ECS tutorial before continuing.

## Components

Essentially, ECS allows Voxelize to decouple in-game objects into separate components. For instance, an entity that simply moves up and down could have a `Position` component and a `Velocity` component. An entity would simply be a holder of a set of components.

By default, Voxelize registers these components to the ECS world:

### Null-storage Flags

These flags take up no space on disk, and are used to distinguish clients from non-client entities.

- `ClientFlag`
  - A component indicating if an entity is a client.
- `EntityFlag`
  - A component indicating if an entity is a non-client.

### Informational Components

These components add additional information about an entity, whether a client or not.

- `IDComp`
  - All entities have their Voxelize-given ID.
- `NameComp`
  - A name given to the entity.
- `ChunkRequestsComp`
  - A list of chunks requested by entity (client).
- `CurrentChunkComp`
  - Which chunk the entity is in, updated each frame.
- `PositionComp`
  - A set of 3D coordinates describing the position of an entity.
- `DirectionComp`
  - A set of 3D coordinates indicating the direction the entity is looking.
- `ETypeComp`
  - A string to differentiate the type of entity, such as `"Cow"`.
- `MetadataComp`
  - A JSON-compatible object to store data sent to the client-side or saved to disk.

### Physical Components

The components below make an entity physical in the Voxelize world.

- `RigidBodyComp`
  - A collision box that can collide with voxel blocks.
- `InteractorComp`
  - A collision box that can collide with other collision boxes.
- `CollisionsComp`
  - A vector storing all collisions this entity has per frame.

### AI & Pathfinding Components

These components enable AI behaviors and pathfinding for entities.

- `BrainComp`
  - Controls entity movement behavior including walking, jumping, and sprinting. Contains configurable physics parameters like `max_speed`, `jump_impulse`, and `responsiveness`.
- `TargetComp`
  - Allows an entity to scan nearby and track the closest target. Supports filtering by `TargetType::All`, `TargetType::Players`, or `TargetType::Entities`.
- `PathComp`
  - Stores a computed A\* path and pathfinding parameters like `max_nodes`, `max_distance`, and `max_pathfinding_time`.

### Block Entity Components

These components are used for entities attached to specific voxel positions (block entities).

- `VoxelComp`
  - Stores the voxel position an entity is attached to.
- `JsonComp`
  - Stores arbitrary JSON data for block entities.

### Miscellaneous Components

- `AddrComp`
  - Client's Actix actor address.

To register new components to the Voxelize world, we do the following:

```rust title="Registering a Custom Component"
use specs::{Component, VecStorage};

#[derive(Component, Debug)]
#[storage(VecStorage)]
struct CustomComp {
    a: f32,
    b: f32,
}

world.ecs().register::<CustomComp>();
```

We can then create entities with this `CustomComp`:

```rust title="Creating an Entity with Custom Component"
let custom_entity = world
    .create_entity("custom-id", "Custom Entity")
    .with(CustomComp { a: 1.0, b: 3.0 })
    .build();
```

:::info
`world.create_entity(id, etype)` calls `world.ecs().create_entity()` internally, and adds these components by default to integrate with Voxelize:

- `IDComp`
- `EntityFlag`
- `ETypeComp`
- `MetadataComp`
- `CurrentChunkComp`
- `CollisionsComp`
  :::

## Resources

Another building block of a Voxelize world is a set of **resources** built-in. Resources are stateful structs that can be shared across all systems.

### Informational

These are the static resources that shouldn't be modified.

- `String`
  - A string of the name of the world.
- `WorldConfig`
  - The configurations of the world. Can be accessed through `world.config()`.

### Managers

These are the structs that manage and pass around the data stored in the world.

- `Chunks`
  - The chunking manager of the world.
- `EntitiesSaver`
  - A manager that can handle the spawning and saving of entities.
- `Pipeline`
  - The chunking pipeline that takes care of generating chunks in parallel.
- `Clients`
  - A hash map of all clients that have joined this world.
- `MessageQueue`
  - A list of encoded protobuf messages that gets sent to the client each tick.
- `Events`
  - Managing all events that can be emitted to the clients.
- `ChunkInterests`
  - Tracks which clients are interested in which chunks.
- `EntityIDs`
  - Maps entity IDs to their ECS entity handles.

The manager resources can be accessed through the world directly. For instance, `world.chunks()` or `world.chunks_mut()` or `world.clients_mut()`.

### Utilities

These are the utility resources that can be used as helpers.

- `Stats`
  - The world stats such as delta time.
- `Mesher`
  - A manager that takes care of all the chunk 3D meshing in parallel.
- `Search`
  - A 3-dimensional tree that has all the clients and entities to search for.
- `Physics`
  - Manages the Rapier physics simulation for entity collisions.
- `KdTree`
  - A spatial index for fast entity lookups, used by the targeting system.

You can add your own resources to the ECS world in order to be used in an ECS system too by doing so:

```rust title="Inserting a Custom Resource"
struct CustomResource {
    a: f32,
}

world.ecs().insert(CustomResource { a: 1.0 });
```

## Systems

Developers can then write **systems** that operate on specific **components**. An example could be a `PositionUpdateSystem` that operates on all entities with a `Position` and a `Velocity` component, and this system could simply add each entity's `Velocity` to `Position` to move the entity accordingly.

Voxelize by default comes with a [Specs dispatcher](https://specs.amethyst.rs/docs/tutorials/03_dispatcher.html) that runs these systems:

### Core Systems

- `UpdateStatsSystem`
  - **Should run at the start of the dispatcher**
  - Updates the `Stats` resource to the latest delta time which can be used by systems in the `PhysicsSystem`.
- `EntitiesMetaSystem`
  - **Should run at the start of the dispatcher**
  - Adds the `PositionComp` of all non-client entities into their respective `MetadataComp` to be sent to the client side.
- `PeersMetaSystem`
  - **Should run at the start of the dispatcher**
  - Adds the `PositionComp`, `DirectionComp`, and `NameComp` into all client entities' `MetadataComp` to update peers.
- `CurrentChunkSystem`
  - **Should run at the start of the dispatcher**
  - Calculates the current chunks of all entities.

### Chunk Systems

- `ChunkUpdatingSystem`
  - **Depends on:** `CurrentChunkSystem`
  - Handles the voxel updates by updating `config.max_updates_per_tick` of received updates per tick.
- `ChunkRequestsSystem`
  - **Depends on:** `CurrentChunkSystem`
  - Queues all chunks from any `ChunkRequestsComp` into the chunk pipeline to be processed.
  - Adds any chunks that are ready to `world.chunks().to_send` to be sent to the clients.
- `ChunkGeneratingSystem`
  - **Depends on:** `ChunkRequestsSystem`
  - Pushes `config.max_chunks_per_tick` of chunks per tick into a list of chunk phases to populate them with chunk data.
- `ChunkSendingSystem`
  - **Depends on:** `ChunkGeneratingSystem`
  - Packs the chunks from `world.chunks().to_send` along with clients that had requested for those chunks into the `MessageQueue` resource.
- `ChunkSavingSystem`
  - **Depends on:** `ChunkGeneratingSystem`
  - Every `config.save_interval` ticks, saves the chunk data into `config.save_dir` if `config.saving` is set true.

### Physics & Collision Systems

- `PhysicsSystem`
  - **Depends on:** `CurrentChunkSystem`, `UpdateStatsSystem`
  - Updates `RigidBodyComp` according to chunk data.
  - Calculates `CollisionsComp` through `InteractorComp` by calculating the physics collisions through [Rapier physics](https://rapier.rs/).

### AI & Pathfinding Systems

- `EntityTreeSystem`
  - Builds a KdTree spatial index of all entities and players for fast lookups.
- `EntityObserveSystem`
  - Uses the KdTree to find and track the closest target for entities with `TargetComp`.
- `TargetMetadataSystem`
  - Syncs `TargetComp` data to the entity's metadata for client-side access.
- `PathFindingSystem`
  - **Depends on:** `EntityObserveSystem`
  - Runs A\* pathfinding for entities with both `PathComp` and `TargetComp`. Computes paths with configurable constraints and path smoothing.
- `PathMetadataSystem`
  - Syncs computed paths to the entity's metadata.
- `WalkTowardsSystem`
  - **Depends on:** `PathFindingSystem`
  - Operates the `BrainComp` to make entities walk along their computed paths, handling jumping, cornering, and target approach.

### Network & Persistence Systems

- `DataSavingSystem`
  - **Depends on:** `EntitiesMetaSystem`
  - Every `config.save_interval`, saves the entities data into `config.save_dir` if `config.saving` is set true.
- `EntitiesSendingSystem`
  - **Depends on:** `EntitiesMetaSystem`
  - If any entities have changed their metadata, the metadata is packed and pushed to the `MessageQueue` resource.
- `PeersSendingSystem`
  - **Depends on:** `PeersMetaSystem`
  - If any clients have changed their metadata, the metadata is packed and pushed to the `MessageQueue` resource.
- `BroadcastSystem`
  - **Depends on:** `ChunkSendingSystem`, `EntitiesSendingSystem`, `PeersSendingSystem`
  - Actually sends the packed messages in the `MessageQueue` to the specified clients.
- `CleanupSystem`
  - **Depends on:** `EntitiesSendingSystem`, `PeersSendingSystem`
  - Clears the collisions generated by `PhysicsSystem` and other per-frame data.
- `EventsSystem`
  - **Depends on:** `BroadcastSystem`
  - Packs all events in the `Events` resource and sends them to the specified clients.

To customize the dispatcher, checkout [this tutorial](./customizing-the-ecs).

## Creating AI Entities

To create an entity with AI behavior, combine the AI components:

```rust title="Creating an Entity with AI"
use std::time::Duration;

world.set_entity_loader("mob", |world, metadata| {
    let body = RigidBody::new(&AABB::new().scale_x(0.6).scale_y(1.8).scale_z(0.6).build());
    let interactor = world.physics_mut().register(&body);

    world
        .create_entity(&nanoid!(), "mob")
        .with(PositionComp::default())
        .with(RigidBodyComp::new(&body))
        .with(InteractorComp::new(&interactor))
        .with(BrainComp::new(BrainOptions::default()))
        .with(TargetComp::players())
        .with(PathComp::new(
            100,                           // max_nodes
            32.0,                          // max_distance
            10000,                         // max_depth_search
            Duration::from_millis(50),     // max_pathfinding_time
        ))
});
```

The AI systems will automatically:

1. Build a spatial index of all entities (`EntityTreeSystem`)
2. Find the closest player (`EntityObserveSystem`)
3. Compute a path to the target (`PathFindingSystem`)
4. Move the entity along the path (`WalkTowardsSystem`)
