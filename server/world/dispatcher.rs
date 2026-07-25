use super::*;

pub(super) fn dispatcher() -> TimedDispatcherBuilder<'static, 'static> {
    // Note: shred requires a system's dependencies to be registered before
    // the system that names them, so "physics" must precede "entities-meta".
    TimedDispatcherBuilder::new()
        .with(UpdateStatsSystem, "update-stats", &[])
        .with(PeersMetaSystem, "peers-meta", &[])
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
        .with(
            PhysicsSystem,
            "physics",
            &["current-chunk", "update-stats", "chunk-updating"],
        )
        .with(EntitiesMetaSystem, "entities-meta", &["physics"])
        .with(DataSavingSystem, "entities-saving", &["entities-meta"])
        .with(
            EntitiesSendingSystem::default(),
            "entities-sending",
            &["entities-meta"],
        )
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
        .with(EntityObserveSystem, "entity-observe", &[])
        .with(PathFindingSystem, "path-finding", &["entity-observe"])
        .with(TargetMetadataSystem, "target-meta", &[])
        .with(PathMetadataSystem, "path-meta", &[])
        .with(EntityTreeSystem, "entity-tree", &[])
        .with(WalkTowardsSystem, "walk-towards", &["path-finding"])
}
