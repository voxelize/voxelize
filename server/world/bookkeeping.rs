use hashbrown::{HashMap, HashSet};
use specs::Entity;

use crate::{MetadataComp, Vec2};

#[derive(Default)]
pub struct Bookkeeping {
    // id -> (etype, entity, metadata, persisted)
    pub(crate) entities: HashMap<String, (String, Entity, MetadataComp, bool)>,
    // Track entity chunk positions for interest-based sending
    // entity_id -> chunk coords
    pub(crate) entity_chunks: HashMap<String, Vec2<i32>>,
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
