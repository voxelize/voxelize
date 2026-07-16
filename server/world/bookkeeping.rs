use hashbrown::HashMap;
use specs::Entity;

use crate::{EntityInterests, QuantizedMotion, Vec3};

#[derive(Default)]
pub struct Bookkeeping {
    // id -> (etype, entity, serialized_metadata, persisted)
    pub(crate) entities: HashMap<String, (String, Entity, String, bool)>,
    // entity_id -> position, refreshed by the entities-sending system each tick
    pub(crate) entity_positions: HashMap<String, Vec3<f32>>,
    // entity_id -> last quantized motion sample, the motion lane's change
    // detector: motion below wire resolution never stages an update
    pub(crate) motion: HashMap<String, QuantizedMotion>,
    // per-client sets of entity ids currently streaming to that client
    pub(crate) interests: EntityInterests,
}

impl Bookkeeping {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn remove_client(&mut self, client_id: &str) {
        self.interests.remove_client(client_id);
    }
}
