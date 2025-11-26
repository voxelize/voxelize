---
sidebar_position: 5
---

# Customizing the ECS

Voxelize's server runs on [Specs ECS](https://specs.amethyst.rs/docs/tutorials/), which executes systems in parallel each game tick. You can customize the dispatcher to add your own systems, modify execution order, or extend built-in behaviors.

## Setting a Custom Dispatcher

Use `world.set_dispatcher()` to define which systems run and their dependencies:

```rust title="Custom Dispatcher Setup"
use specs::DispatcherBuilder;

world.set_dispatcher(|| {
    DispatcherBuilder::new()
        // Core systems
        .with(UpdateStatsSystem, "update-stats", &[])
        .with(EntitiesMetaSystem, "entities-meta", &[])
        .with(PeersMetaSystem, "peers-meta", &[])
        .with(CurrentChunkSystem, "current-chunk", &[])
        // Chunk systems
        .with(ChunkUpdatingSystem, "chunk-updating", &["current-chunk"])
        .with(ChunkRequestsSystem, "chunk-requests", &["current-chunk"])
        .with(ChunkGeneratingSystem, "chunk-generation", &["chunk-requests"])
        .with(ChunkSendingSystem, "chunk-sending", &["chunk-generation"])
        .with(ChunkSavingSystem, "chunk-saving", &["chunk-generation"])
        // Physics
        .with(PhysicsSystem, "physics", &["current-chunk", "update-stats"])
        // Persistence & network
        .with(DataSavingSystem, "entities-saving", &["entities-meta"])
        .with(EntitiesSendingSystem, "entities-sending", &["entities-meta"])
        .with(PeersSendingSystem, "peers-sending", &["peers-meta"])
        .with(
            BroadcastSystem,
            "broadcast",
            &["chunk-sending", "entities-sending", "peers-sending"],
        )
        .with(CleanupSystem, "cleanup", &["entities-sending", "peers-sending"])
        .with(EventsSystem, "events", &["broadcast"])
        // AI systems (optional)
        .with(EntityTreeSystem, "entity-tree", &[])
        .with(EntityObserveSystem, "entity-observe", &[])
        .with(PathFindingSystem, "path-finding", &["entity-observe"])
        .with(WalkTowardsSystem, "walk-towards", &["path-finding"])
        .with(TargetMetadataSystem, "target-meta", &[])
        .with(PathMetadataSystem, "path-meta", &[])
        // Your custom systems
        .with(MyCustomSystem, "my-custom", &["entities-meta"])
});
```

The third argument to `.with()` lists dependencies. A system only runs after all its dependencies complete.

## Creating Custom Systems

Systems operate on components each tick. Here's a system that applies gravity to entities with a custom `VelocityComp`:

```rust title="Custom Velocity System"
use specs::{System, ReadExpect, WriteStorage, Join};

#[derive(Component, Default)]
#[storage(VecStorage)]
struct VelocityComp(pub Vec3<f32>);

struct GravitySystem;

impl<'a> System<'a> for GravitySystem {
    type SystemData = (
        ReadExpect<'a, Stats>,
        WriteStorage<'a, VelocityComp>,
    );

    fn run(&mut self, (stats, mut velocities): Self::SystemData) {
        let delta = stats.delta;

        for velocity in (&mut velocities).join() {
            velocity.0.1 -= 9.8 * delta;
        }
    }
}
```

Register the component and add the system to your dispatcher:

```rust title="Registering Custom Components"
world.ecs().register::<VelocityComp>();

world.set_dispatcher(|| {
    // ... other systems ...
    DispatcherBuilder::new()
        .with(GravitySystem, "gravity", &["update-stats"])
        // ... rest of dispatcher ...
});
```

## Syncing to Metadata

To send custom component data to clients, sync it to `MetadataComp`:

```rust title="Metadata Sync System"
struct VelocityMetaSystem;

impl<'a> System<'a> for VelocityMetaSystem {
    type SystemData = (
        ReadStorage<'a, VelocityComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, (velocities, mut metadatas): Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        (&velocities, &mut metadatas)
            .par_join()
            .for_each(|(velocity, metadata)| {
                metadata.set::<VelocityComp>("velocity", velocity);
            });
    }
}
```

Add this system before `EntitiesSendingSystem`:

```rust title="Adding Metadata Sync to Dispatcher"
.with(VelocityMetaSystem, "velocity-meta", &[])
.with(EntitiesSendingSystem, "entities-sending", &["entities-meta", "velocity-meta"])
```

## Parallel Execution

Specs runs systems in parallel when their dependencies allow. Use `ParJoin` for parallel iteration within a system:

```rust title="Parallel System Execution"
fn run(&mut self, (read_a, mut write_b): Self::SystemData) {
    use rayon::prelude::*;
    use specs::ParJoin;

    (&read_a, &mut write_b)
        .par_join()
        .for_each(|(a, b)| {
            // Process each entity in parallel
        });
}
```

## Accessing World Resources

Systems can access shared resources:

```rust title="Accessing Resources in Systems"
impl<'a> System<'a> for MySystem {
    type SystemData = (
        ReadExpect<'a, Stats>,
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, Chunks>,
        Write<'a, Events>,
    );

    fn run(&mut self, (stats, config, chunks, mut events): Self::SystemData) {
        let delta = stats.delta;
        let chunk_size = config.chunk_size;

        // Use chunks.get_voxel() to read voxel data
        let voxel = chunks.get_voxel(0, 64, 0);

        // Dispatch events to clients
        events.dispatch(Event::new("my-event").payload("data").build());
    }
}
```

## System Dependencies Graph

When designing your dispatcher, consider the data flow:

1. **Stats & Positions first** - Other systems depend on updated positions and delta time
2. **Chunk systems** - Generate and mesh chunks based on requests
3. **Physics** - Needs current positions and stats
4. **AI systems** - Build spatial index, find targets, compute paths, execute movement
5. **Metadata sync** - Sync component changes before sending
6. **Network** - Send updates to clients
7. **Cleanup** - Clear per-frame data

For more details on the default systems, see the [Entity Component System](/tutorials/intermediate/entity-component-system) tutorial.
