---
sidebar_position: 4
---

# Entity Component System

Now that we have a server running, it is time to learn about the entity component system of Voxelize. Voxelize servers run on the [Specs ECS crate](https://specs.amethyst.rs/docs/tutorials/). It is recommended to read through the Specs ECS tutorial before continuing.

## Components

Essentially, ECS allows Voxelize to decouple in-game objects into separate components. For instance, an entity that simply moves up and down could have a `Position` component and a `Velocity` component. In other words, entities in an ECS world is just a component holder.

By default, Voxelize comes with these components added to the ECS world:

### Null-storage Flags

These flags take up no space on disk, and is simply used to distinguish clients to non-client entities.

- `ClientFlag`
  - A component indicating if an entity is a client.
- `EntityFlag`
  - A component indicating if an entity is a non-client.

### Entity Information Components

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
  - A string storing what the type name of the entity, such as `"Cow"`.
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

- `AddrComp`: Client's Actix actor address.

## Systems

Developers can then write **systems** that operate on specific **components**. An example could be `PositionUpdateSystem` that operates on all entities with a `Position` and a `Velocity` component, and this system simply adds `Velocity` to `Position` to move the entity accordingly.

In the Voxelize backend, each world has its own inner ECS world with no systems setup. Voxelize instead provides a lot of built-in systems to be added as custom features.

Moreover, specifically from the Specs ECS crate, we introduce a new idea of [resources](https://specs.amethyst.rs/docs/tutorials/04_resources.html), which are essentially stateful structs that we share across all systems. In Voxelize, the server comes with these built-in resources:

-
