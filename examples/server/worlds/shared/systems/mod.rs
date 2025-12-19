mod extra_peer_meta;
mod text_metadata;
mod void_kill;

use specs::DispatcherBuilder;
use voxelize::{
    BroadcastSystem, ChunkGeneratingSystem, ChunkRequestsSystem, ChunkSavingSystem,
    ChunkSendingSystem, ChunkUpdatingSystem, CleanupSystem, CurrentChunkSystem, DataSavingSystem,
    EntitiesMetaSystem, EntitiesSendingSystem, EntityObserveSystem, EntityTreeSystem, EventsSystem,
    PathFindingSystem, PathMetadataSystem, PeersMetaSystem, PeersSendingSystem, PhysicsSystem,
    TargetMetadataSystem, UpdateStatsSystem, WalkTowardsSystem, World,
};

use self::{
    extra_peer_meta::ExtraPeerMetaSystem, text_metadata::TextMetadataSystem,
    void_kill::VoidKillSystem,
};

pub fn setup_dispatcher(world: &mut World) {
    world.set_dispatcher(|| {
        DispatcherBuilder::new()
            .with(VoidKillSystem, "void-kill", &[])
            .with(UpdateStatsSystem, "update-stats", &[])
            .with(EntityObserveSystem, "entity-observe", &[])
            .with(PathFindingSystem, "path-finding", &["entity-observe"])
            .with(TextMetadataSystem, "text-meta", &[])
            .with(TargetMetadataSystem, "target-meta", &[])
            .with(PathMetadataSystem, "path-meta", &[])
            .with(EntityTreeSystem, "entity-tree", &[])
            .with(WalkTowardsSystem, "walk-towards", &["path-finding"])
            .with(
                EntitiesMetaSystem,
                "entities-meta",
                &[
                    "text-meta",
                    "target-meta",
                    "path-meta",
                    "entity-observe",
                    "entity-tree",
                    "walk-towards",
                ],
            )
            .with(PeersMetaSystem, "peers-meta", &[])
            .with(ExtraPeerMetaSystem, "peers-extra-meta", &[])
            .with(CurrentChunkSystem, "current-chunk", &[])
            .with(ChunkUpdatingSystem, "chunk-updating", &["current-chunk"])
            .with(ChunkRequestsSystem, "chunk-requests", &["current-chunk"])
            .with(
                ChunkGeneratingSystem,
                "chunk-generation",
                &["chunk-requests"],
            )
            .with(ChunkSendingSystem, "chunk-sending", &["chunk-generation"])
            .with(ChunkSavingSystem, "chunk-saving", &["chunk-generation"])
            .with(PhysicsSystem, "physics", &["current-chunk", "update-stats"])
            .with(DataSavingSystem, "entities-saving", &["entities-meta"])
            .with(
                EntitiesSendingSystem::default(),
                "entities-sending",
                &["entities-meta"],
            )
            .with(
                PeersSendingSystem,
                "peers-sending",
                &["peers-meta", "peers-extra-meta"],
            )
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
    });
}
