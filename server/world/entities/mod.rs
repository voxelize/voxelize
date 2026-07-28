mod background_saver;
mod saver;

use crate::MetadataComp;

/// Metadata key that marks an entity as owned by a test scenario (stamped by
/// `test:spawn`-style methods). Scenario entities are live-only: they spawn
/// and despawn normally, but persisting them would litter the world save
/// with one orphaned JSON file per test run, so `spawn_entity_with_metadata`
/// hands them a `DoNotPersistComp` and the saving system never sees them.
pub const SCENARIO_ID_METADATA_KEY: &str = "scenarioId";

pub fn is_scenario_owned(metadata: &MetadataComp) -> bool {
    metadata.map.contains_key(SCENARIO_ID_METADATA_KEY)
}

pub use background_saver::*;
pub use saver::*;
