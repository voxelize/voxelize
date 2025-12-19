use hashbrown::HashMap;
use specs::Entity;

use crate::MetadataComp;

#[derive(Default)]
pub struct Bookkeeping {
    // id -> (etype, entity, metadata, persisted)
    pub(crate) entities: HashMap<String, (String, Entity, MetadataComp, bool)>,
}

impl Bookkeeping {
    pub fn new() -> Self {
        Self::default()
    }
}
