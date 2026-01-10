use hashbrown::{HashMap, HashSet};
use specs::Entity;

use crate::{MetadataComp, Vec3};

#[derive(Default)]
pub struct Bookkeeping {
    // id -> (etype, entity, metadata, persisted)
    pub(crate) entities: HashMap<String, (String, Entity, MetadataComp, bool)>,
    // Track entity positions for distance-based visibility
    // entity_id -> position
    pub(crate) entity_positions: HashMap<String, Vec3<f32>>,
    // Track which entities each client knows about
    // client_id -> set of entity_ids
    pub(crate) client_known_entities: HashMap<String, HashSet<String>>,
}

impl Bookkeeping {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn remove_client(&mut self, client_id: &str) {
        self.client_known_entities.remove(client_id);
    }
}
