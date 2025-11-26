---
sidebar_position: 3
---

# Metadata Processing

In Voxelize, metadata is a way to keep entities and players in sync with the server. Essentially, metadata is a JSON serializable object that contains the individual components that the entity itself possesses. For example, a player entity might have a position component, a rotation component, and a health component. These components are stored in the metadata object, and whenever these individual components are changed, the metadata object is updated and sent to the client.

## Defining Metadata

Metadata uses the `MetadataComp` component on the server. This component internally has a map of `String` to `serde_json::Value`. The `String` is the name of the component, and the `serde_json::Value` is the value of the component. For example, the `PositionComp` might look like this:

```rust
let mut metadata = MetadataComp::new();

metadata.set::<PositionComp>("position", position);
```

By calling `set` and passing in a type that implements both `Component` from `specs` and `DeserializeOwned` from `serde`, the metadata will be updated with the new serialized value.

Similarly, you can call `get` to retrieve the value of a component:

```rust
let position = metadata.get::<PositionComp>("position").unwrap_or_default();
```

## Handling Metadata

Metadata is handled differently for peers and entities.

For peers, aka players, metadata is by default handled by the `PeersMetaSystem`, which automatically adds in these components to the players' metadata:

- `PositionComp`: This is added as `position` in the metadata
- `NameComp`: This is added as `username` in the metadata
- `DirectionComp`: This is added as `direction` in the metadata

For entities, metadata is handled by the `EntitiesMetaSystem`, which automatically adds in these components to the entities' metadata:

- `PositionComp`: This is added as `position` in the metadata

When a new component is defined and should be added to the metadata system, you can define your own system that handles this similar process. For example, if you wanted to add a `HealthComp` to the metadata, you could do something like this:

```rust
use specs::{System, ReadStorage, WriteStorage, Join, Component, VecStorage};
use serde::{Serialize, Deserialize};

#[derive(Component, Deserialize, Serialize)]
#[storage(VecStorage)]
struct HealthComp(pub u32);

struct HealthMetaSystem;

impl<'a> System<'a> for HealthMetaSystem {
    type SystemData = (
        ReadStorage<'a, HealthComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, (healths, mut metadatas): Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        (&healths, &mut metadatas).par_join().for_each(|(health, metadata)| {
            metadata.set::<HealthComp>("health", health);
        });
    }
}

let mut world = World::new();
world.register::<HealthComp>();
```

After these, read on how to [customize the ECS systems dispatcher](custom-dispatcher) in order to add in `HealthMetaSystem` to the dispatcher.
