use hashbrown::HashMap;
use specs::Entity;

#[derive(Default)]
pub struct Bookkeeping {
    pub(crate) entities: HashMap<String, Entity>,
}

impl Bookkeeping {
    pub fn new() -> Self {
        Self::default()
    }
}
