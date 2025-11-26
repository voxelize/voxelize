---
sidebar_position: 4
---

# Custom Dispatcher

The Voxelize server is built on top of the [specs](https://specs.amethyst.rs/docs/tutorials/) ECS framework. This means that the server is made up of a series of systems that are running in parallel. By default, Voxelize has a list of systems that are used to handle things like chunk generation, network packet handling, and more. These systems come together and define what happens every game tick.

In order to customize this behavior, you can define your own dispatcher. This allows you to define your own systems, and to control the order in which they are executed. This can be useful for creating custom game logic, or for optimizing the server.

## The Default Dispatcher

The default dispatcher consists of the following systems:

### Core Systems

- `UpdateStatsSystem` ("update-stats")
  - 0 dependencies
  - Updates the game tick counter and the time since the last tick
  - The details are within the `Stats` resource in the ECS world
- `EntitiesMetaSystem` ("entities-meta")
  - 0 dependencies
  - Updates the metadata of entities
- `PeersMetaSystem` ("peers-meta")
  - 0 dependencies
  - Updates the metadata of peers
- `CurrentChunkSystem` ("current-chunk")
  - 0 dependencies
  - Based on each entity's position, determines which chunks they are currently in
  - This updates the `CurrentChunkComp`

### Chunk Systems

- `ChunkUpdatingSystem` ("chunk-updating")
  - 1 dependency: "current-chunk"
  - Processes the voxel updates that have been queued by the clients
  - This is where the voxel updates are actually applied to the chunks
- `ChunkRequestsSystem` ("chunk-requests")
  - 1 dependency: "current-chunk"
  - Processes the chunks requested by the clients
- `ChunkGeneratingSystem` ("chunk-generation")
  - 1 dependency: "chunk-requests"
  - Generates chunks that have not been generated yet
  - Meshes are generated here for the chunks
- `ChunkSendingSystem` ("chunk-sending")
  - 1 dependency: "chunk-generation"
  - Sends the chunks that are generated and meshed to the clients
- `ChunkSavingSystem` ("chunk-saving")
  - 1 dependency: "chunk-generation"
  - Saves the chunks that are generated to the disk

### Physics System

- `PhysicsSystem` ("physics")
  - 2 dependencies: "current-chunk", "update-stats"
  - Ticks the rigid bodies in the voxel world
  - Detects any interactions/collisions between `InteractorComp`s

### AI & Pathfinding Systems

- `EntityTreeSystem` ("entity-tree")
  - 0 dependencies
  - Builds a KdTree spatial index of all entities and players for fast nearest-neighbor lookups
- `EntityObserveSystem` ("entity-observe")
  - 0 dependencies
  - Uses the KdTree to find and update the closest target for entities with `TargetComp`
- `TargetMetadataSystem` ("target-meta")
  - 0 dependencies
  - Syncs `TargetComp` data to the entity's metadata
- `PathFindingSystem` ("path-finding")
  - 1 dependency: "entity-observe"
  - Runs A\* pathfinding for entities with both `PathComp` and `TargetComp`
  - Computes paths with configurable constraints and path smoothing
- `PathMetadataSystem` ("path-meta")
  - 0 dependencies
  - Syncs computed paths to the entity's metadata
- `WalkTowardsSystem` ("walk-towards")
  - 1 dependency: "path-finding"
  - Operates the `BrainComp` to make entities walk along their computed paths

### Network & Persistence Systems

- `DataSavingSystem` ("entities-saving")
  - 1 dependency: "entities-meta"
  - Saves the entities' metadata that have been modified to the disk
- `EntitiesSendingSystem` ("entities-sending")
  - 1 dependency: "entities-meta"
  - Sends the entities' metadata that have been modified to the clients
- `PeersSendingSystem` ("peers-sending")
  - 1 dependency: "peers-meta"
  - Sends the peers' metadata that have been modified to the clients
- `BroadcastSystem` ("broadcast")
  - 3 dependencies: "chunk-sending", "entities-sending", "peers-sending"
  - All the above systems will queue up packets to be sent to the clients. This system will actually send the packets to the clients
- `CleanupSystem` ("cleanup")
  - 2 dependencies: "entities-sending", "peers-sending"
  - Cleans up the ECS world by clearing the collisions and interactions that have been processed
- `EventsSystem` ("events")
  - 1 dependency: "broadcast"
  - Processes the events that have been queued by the clients by broadcasting them to the other clients that are interested

## Customizing the Dispatcher

To customize the dispatcher, use `world.set_dispatcher()`:

```rust title="Custom Dispatcher"
use specs::DispatcherBuilder;

world.set_dispatcher(|| {
    DispatcherBuilder::new()
        .with(UpdateStatsSystem, "update-stats", &[])
        .with(EntitiesMetaSystem, "entities-meta", &[])
        .with(PeersMetaSystem, "peers-meta", &[])
        .with(CurrentChunkSystem, "current-chunk", &[])
        .with(ChunkUpdatingSystem, "chunk-updating", &["current-chunk"])
        .with(ChunkRequestsSystem, "chunk-requests", &["current-chunk"])
        .with(ChunkGeneratingSystem, "chunk-generation", &["chunk-requests"])
        .with(ChunkSendingSystem, "chunk-sending", &["chunk-generation"])
        .with(ChunkSavingSystem, "chunk-saving", &["chunk-generation"])
        .with(PhysicsSystem, "physics", &["current-chunk", "update-stats"])
        .with(DataSavingSystem, "entities-saving", &["entities-meta"])
        .with(EntitiesSendingSystem, "entities-sending", &["entities-meta"])
        .with(PeersSendingSystem, "peers-sending", &["peers-meta"])
        .with(
            BroadcastSystem,
            "broadcast",
            &["chunk-sending", "entities-sending", "peers-sending"],
        )
        .with(
            CleanupSystem,
            "cleanup",
            &["entities-sending", "peers-sending"],
        )
        .with(EventsSystem, "events", &["broadcast"])
        // Add AI systems if needed
        .with(EntityObserveSystem, "entity-observe", &[])
        .with(PathFindingSystem, "path-finding", &["entity-observe"])
        .with(WalkTowardsSystem, "walk-towards", &["path-finding"])
        .with(EntityTreeSystem, "entity-tree", &[])
        // Add your custom systems here
        .with(MyCustomSystem, "my-custom", &["entities-meta"])
});
```

## Adding Custom Systems

You can add your own systems to extend the server behavior. Here's an example of a custom system that makes entities take damage when they collide:

```rust title="Custom Damage System"
use specs::{System, ReadStorage, WriteStorage, Join};

struct DamageOnCollisionSystem;

impl<'a> System<'a> for DamageOnCollisionSystem {
    type SystemData = (
        ReadStorage<'a, CollisionsComp>,
        WriteStorage<'a, HealthComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, (collisions, mut healths, mut metadatas): Self::SystemData) {
        for (collision, health, metadata) in (&collisions, &mut healths, &mut metadatas).join() {
            if !collision.0.is_empty() {
                health.0 = health.0.saturating_sub(1);
                metadata.set::<HealthComp>("health", health);
            }
        }
    }
}
```
