---
sidebar_position: 4
---

# Entity Component System

Now that we have a server running, it is time to learn about the entity component system of Voxelize. Voxelize servers run on the [Specs ECS crate](https://specs.amethyst.rs/docs/tutorials/). It is recommended to read through the Specs ECS tutorial before continuing.

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
- [`Terrain`](https://docs.rs/voxelize/0.8.7/voxelize/struct.SeededTerrain.html)
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

Developers can then write **systems** that operate on specific **components**. An example could be `PositionUpdateSystem` that operates on all entities with a `Position` and a `Velocity` component, and this system simply adds `Velocity` to `Position` to move the entity accordingly.

In the Voxelize backend, each world has its own inner ECS world with no systems setup. Voxelize instead provides a lot of built-in systems to be added as custom features.

In order to customize the system dispatcher of the Voxelize world, we need to use `world.set_dispatcher` and pass in a dispatcher modifier like this:

```rust server/main.rs
use specs::DispatcherBuilder;
// highlight-start
use voxelize::{
    Block, BroadcastSystem, ChunkMeshingSystem, ChunkPipeliningSystem, ChunkRequestsSystem,
    ChunkSavingSystem, ChunkSendingSystem, ChunkUpdatingSystem, ClearCollisionsSystem,
    CurrentChunkSystem, EntitiesSavingSystem, EntitiesSendingSystem, EntityMetaSystem,
    EventsBroadcastSystem, PeersMetaSystem, PeersSendingSystem, PhysicsSystem, Registry, Server,
    UpdateStatsSystem, Voxelize, World, WorldConfig,
};
// highlight-end

fn dispatcher(builder: DispatcherBuilder<'static, 'static>) -> DispatcherBuilder<'static, 'static> {
    builder
        .with(UpdateStatsSystem, "update-stats", &[])
        .with(EntityMetaSystem, "entity-meta", &[])
        .with(PeersMetaSystem, "peers-meta", &[])
        .with(CurrentChunkSystem, "current-chunking", &[])
        .with(ChunkUpdatingSystem, "chunk-updating", &["current-chunking"])
        .with(ChunkRequestsSystem, "chunk-requests", &["current-chunking"])
        .with(
            ChunkPipeliningSystem,
            "chunk-pipelining",
            &["chunk-requests"],
        )
        .with(ChunkMeshingSystem, "chunk-meshing", &["chunk-pipelining"])
        .with(ChunkSendingSystem, "chunk-sending", &["chunk-meshing"])
        .with(ChunkSavingSystem, "chunk-saving", &["chunk-pipelining"])
        .with(PhysicsSystem, "physics", &["update-stats"])
        .with(EntitiesSavingSystem, "entities-saving", &["entity-meta"])
        .with(
            EntitiesSendingSystem,
            "entities-sending",
            &["entities-saving"],
        )
        .with(PeersSendingSystem, "peers-sending", &["peers-meta"])
        .with(
            BroadcastSystem,
            "broadcast",
            &["entities-sending", "peers-sending", "chunk-sending"],
        )
        .with(
            ClearCollisionsSystem,
            "clear-collisions",
            &["entities-sending"],
        )
        .with(
            EventsBroadcastSystem,
            "events-broadcasting",
            &["chunk-requests", "broadcast"],
        )
}

// ... Creating the Server/World

world.set_dispatcher(dispatcher);

// ... Running the server
```