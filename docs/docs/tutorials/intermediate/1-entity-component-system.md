---
sidebar_position: 1
---

# Entity Component System

Voxelize servers run on the [Specs ECS crate](https://specs.amethyst.rs/docs/tutorials/). It is recommended to read through the Specs ECS tutorial before continuing.

## Components

Essentially, ECS allows Voxelize to decouple in-game objects into separate components. For instance, an entity that simply moves up and down could have a `Position` component and a `Velocity` component. An entity would simply be a holder of a set of components.

By default, Voxelize comes with [these components](https://github.com/voxelize/voxelize/blob/6f372f38b9bac4c454f4106286dc5256df79cb82/server/world/mod.rs#L186-L200) added to the ECS world:

### Null-storage Flags

These flags take up no space on disk, and is simply used to distinguish clients to non-client entities.

- `ClientFlag`
  - A component indicating if an entity is a client.
- `EntityFlag`
  - A component indicating if an entity is a non-client.

### Informational Components

These components adds additional information about an entity, whether a client or not.

- `IDComp`
  - All entities have their Voxelize given ID.
- `NameComp`
  - A name given to the entity.
- `ChunkRequestComp`
  - A list of chunks requested by entity (client).
- `CurrentChunkComp`
  - Which chunk the client is in, updated each frame.
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
  - A collision box that can collide with other collision blocks.
- `CollisionsComp`
  - A vector storing all collisions this entity has per frame.

### Miscellaneous Components

- `AddrComp`
  - Client's Actix actor address.

To register new components to the Voxelize world, we do the following:

```rust
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

```rust
let custom_entity = world
    .create_entity("Custom Entity")
    .with(CustomComp { a: 1.0, b: 3.0 })
    .build();
```

:::info
[`world.create_entity(<type name>)`](https://github.com/voxelize/voxelize/blob/6f372f38b9bac4c454f4106286dc5256df79cb82/server/world/mod.rs#L587-L596) calls `world.ecs().create_entity()` internally, and adds these components by default to integrate with Voxelize:

- `IDComp`
- `EntityFlag`
- `ETypeComp`
- `MetadataComp`
- `CurrentChunkComp`
- `CollisionsComp`
  :::

## Resources

Another building block of a Voxelize world is a set of **resources** built-in. Resources are stateful structs that can be shared across all systems. In Voxelize, a world comes with [these resources](https://github.com/voxelize/voxelize/blob/6f372f38b9bac4c454f4106286dc5256df79cb82/server/world/mod.rs#L202-L218):

### Informational

These are the static resources that shouldn't be modified.

- `String`
  - A string of the name of the world.
- [`WorldConfig`](https://docs.rs/voxelize/0.8.7/voxelize/struct.WorldConfig.html)
  - The configurations of the world. Can be accessed through `world.config()`.

### Managers

These are the structs that manage and pass around the data stored in the world.

- [`Chunks`](https://docs.rs/voxelize/0.8.7/voxelize/struct.Chunks.html)
  - The chunking manager of the world.
- [`Entities`](https://docs.rs/voxelize/0.8.7/voxelize/struct.Entities.html)
  - A manager that can handle the spawning and saving of entities.
- [`Pipeline`](https://docs.rs/voxelize/0.8.7/voxelize/struct.Pipeline.html)
  - The chunking pipeline that takes care of generating chunks in parallel.
- [`Clients`](https://docs.rs/voxelize/0.8.7/voxelize/type.Clients.html)
  - A hash map of all clients that has joined this world.
- [`MessageQueue`](https://docs.rs/voxelize/0.8.7/voxelize/type.MessageQueue.html)
  - A list of encoded protobuf messages that gets sent to the client each tick.
- [`Events`](https://docs.rs/voxelize/0.8.7/voxelize/struct.Events.html)
  - Managing all events that can be emitted to the clients.

The manager resources can be accessed through the world directly. For instance, `world.chunks()` or `world.chunks_mut()` or `world.clients_mut()`.

### Utilities

These are the utility resources that can be used as helpers.

- [`Stats`](https://docs.rs/voxelize/0.8.7/voxelize/struct.Stats.html)
  - The world stats such as delta time.
- [`Mesher`](https://docs.rs/voxelize/0.8.7/voxelize/struct.Mesher.html)
  - A manager that takes care of all the chunk 3D meshing in parallel.
- [`Search`](https://docs.rs/voxelize/0.8.7/voxelize/struct.Search.html)
  - A 3-dimensional tree that has all the clients and entities to search for.
- [`Terrain`](https://docs.rs/voxelize/0.8.7/voxelize/struct.Terrain.html)
  - A seeded terrain manager to generate terrain.
- [`Noise`](https://docs.rs/voxelize/0.8.7/voxelize/struct.SeededNoise.html)
  - A seeded noise manager to make 2D or 3D noise.

You can add your own resources to the ECS world in order to be used in an ECS system too by doing so:

```rust
struct CustomResource {
    a: f32,
}

world.ecs().insert(CustomResource { a: 1.0 }});
```

## Systems

Developers can then write **systems** that operate on specific **components**. An example could be a `PositionUpdateSystem` that operates on all entities with a `Position` and a `Velocity` component, and this system could simply add each entity's `Velocity` to `Position` to move the entity accordingly.

Voxelize by default comes with a [Specs dispatcher](https://specs.amethyst.rs/docs/tutorials/03_dispatcher.html) that runs [these set of systems](https://github.com/voxelize/voxelize/blob/02d05e9baf07529df0d7ce5d9d4e4efc600ec6f7/server/world/mod.rs#L132-L171):

- `UpdateStatsSystem`
  - **Should run at the start of the dispatcher**
  - Updates the `Stats` resources to the latest delta time which can be used by systems in the `PhysicsSystem`.
- `EntitiesMetaSystem`
  - **Should run at the start of the dispatcher**
  - Adds the `PositionComp` of all non-client entities into their respective `MetadataComp` to be sent to the client side.
- `PeersMetaSystem`
  - **Should run at the start of the dispatcher**
  - Adds the `PositionComp`, `DirectionComp`, and `NameComp` into all client entities' `MetadataComp` to update peers.
- `CurrentChunkSystem`
  - **Should run at the start of the dispatcher**
  - Calculates the current chunks of all entities.
- `ChunkUpdatingSystem`
  - **Should be dependent on `CurrentChunkSystem`.**
  - Handles the voxel updates by updating `config.max_updates_per_tick` of received updates per tick.
- `ChunkRequestsSystem`
  - **Should be dependent on `CurrentChunkSystem`.**
  - Queues all chunks from any `ChunkRequestComp` into the chunk pipeline to be processed.
  - Adds any chunks that are ready to `world.chunks().to_send` to be sent to the clients.
- `ChunkPipeliningSystem`
  - **Should be dependent on `ChunkRequestsSystem`.**
  - Pushes `config.max_chunks_per_tick` of chunks per tick into a list of chunk phases to populate them with chunk data.
- `ChunkMeshingSystem`
  - **Should be dependent on `ChunkUpdatingSystem` and `ChunkPipelineSystem`.**
  - Meshes `config.max_chunks_per_tick` of chunks per tick into `config.sub_chunks` amount of sub chunk 3D meshes.
- `ChunkSendingSystem`
  - **Should be dependent on `ChunkMeshingSystem`.**
  - Packs the chunks from `world.chunks().to_send` along with clients that had requested for those chunks into the `MessageQueue` resource.
- `ChunkSavingSystem`
  - **Should be dependent on `ChunkMeshingSystem`**
  - Every `config.save_interval` ticks, saves the chunk data into `config.save_dir` if `config.saving` is set true.
- `PhysicsSystem`
  - **Should be dependent on `CurrentChunkSystem` and `UpdateStatsSystem`.**
  - Updates `RigidBodyComp` according to chunk data.
  - Calculates `CollisionsComp` through `InteractorComp` by calculating the physics collisions through [rapier physics](https://rapier.rs/).
- `DataSavingSystem`
  - **Should be dependent on `EntitiesMetaSystem` and any non-client metadata systems.**
  - Every `config.save_interval`, saves the entities data into `config.save_dir` if `config.saving` is set true.
- `EntitiesSendingSystem`
  - **Should be dependent on `EntitiesMetaSystem` and **any non-client metadata systems**.**
  - If any entities have changed their metadata, the metadata is packed and pushed to the `MessageQueue` resource.
- `PeersSendingSystem`
  - **Should be dependent on `PeersMetaSystem` and **any client metadata systems**.**
  - If any clients have changed their metadata, the metadata is packed and pushed to the `MessageQueue` resource.
- `BroadcastSystem`
  - **Should be dependent on `EntitiesSendingSystem`, `PeersSendingSystem`, and `ChunkSendingSystem`.**
  - Actually sends the packed messages in the `MessageQueue` to the specified clients.
- `ClearCollisionSystem`
  - **Should be dependent on `EntitiesSendingSystem` and `PeersSendingSystem`.**
  - Clears the collisions generated by `PhysicsSystem`.
- `EventsSystem`
  - **Should be dependent on `BroadcastSystem`.**
  - Packs all events in the `Events` resource and send them to the specified clients.

To customize the dispatcher, checkout [this tutorial](./customizing-the-ecs).
