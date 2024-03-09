use hashbrown::HashMap;
use specs::Entity;

use crate::MetadataComp;

#[derive(Default)]
pub struct Bookkeeping {
    //  id -> (etype, entity, metadata)
    pub(crate) entities: HashMap<String, (String, Entity, MetadataComp)>,
}

impl Bookkeeping {
    pub fn new() -> Self {
        Self::default()
    }
}
