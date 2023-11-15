# Custom Dispatcher

The Voxelize server is built on top of the [specs](https://specs.amethyst.rs/docs/tutorials/) ECS framework. This means that the server is made up of a series of systems that are running in parallel. By default, Voxelize has a list of systems that are used to handle things like chunk generation, network packet handling, and more. These systems come together and define what happens every game tick.

In order to customize this behavior, you can define your own dispatcher. This allows you to define your own systems, and to control the order in which they are executed. This can be useful for creating custom game logic, or for optimizing the server.

## The Default Dispatcher

The default dispatcher consists of the following systems:
- `UpdateStatsSystem` ("update-stats")
  - 0 dependencies
  - Updates the game tick counter, and the time since the last tick
  - The details are within the `Stats` resource in the ECS world 
- `EntitiesMetaSystem` ("entities-meta")
  - 0 dependencies
  - Updates the metadata of entities
- `PeersMetaSystem` ("peers-meta")
  - 0 dependencies
  - Updates the metadata of peers
- `CurrentChunkSystem` ("current-chunks")
  - 0 dependencies
  - Based on each entity's position, determines which chunks they are currently in
  - This updates the `CurrentChunkComp`
- `ChunkUpdatingSystem` ("chunk-updating")
  - 1 dependency: "current-chunks"
  - Processes the voxel updates that have been queued by the clients
  - This is where the voxel updates are actually applied to the chunks
- `ChunkRequestsSystem` ("chunk-requests")
  - 1 dependency: "current_chunk"
  - Processes the chunks requested by the clients
- `ChunkGenerationSystem` ("chunk-generation")
  - 1 dependency: "chunk-requests"
  - Generates chunks that have not been generated yet
  - Meshes are generated here for the chunks
- `ChunkSendingSystem` ("chunk-sending")
  - 1 dependency: "chunk-generation"
  - Sends the chunks that are generated and meshed to the clients
- `ChunkSavingSystem` ("chunk-saving")
  - 1 dependency: "chunk-generation"
  - Saves the chunks that are generated to the disk
- `PhysicsSystem` ("physics)
  - 2 dependencies: "current-chunk", "update-stats"
  - Ticks the rigid bodies in the voxel world
  - Detects any interactions/collisions between `InteractorComp`s
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
  - 2 dependencies: "peers-sending", "entities-sending"
  - All the above systems will queue up packets to be sent to the clients. This system will actually send the packets to the clients
- `CleanupSystem` ("cleanup")
  - 1 dependency: "peers-sending", "entities-sending"
  - Cleans up the ECS world by clearing the collisions and interactions that have been processed
- `EventsSystem` ("events")
  - 1 dependency: "broadcast"
  - Processes the events that have been queued by the clients by broadcasting them to the other clients that are interested

