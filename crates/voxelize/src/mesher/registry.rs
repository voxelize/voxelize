use std::sync::Arc;

use crate::BlockIdentity;

use super::Mesher;

#[derive(Clone)]
pub struct MesherRegistry<T: BlockIdentity> {
    meshers: Vec<Arc<dyn Mesher<T>>>,
}

impl<T: BlockIdentity> MesherRegistry<T> {
    pub fn new() -> Self {
        Self { meshers: vec![] }
    }

    pub fn register<M: Mesher<T>>(&mut self, mesher: M) {
        self.meshers.push(Arc::new(mesher));
    }

    pub fn get_mesher_by_block_id(&self, block_id: u32) -> Option<&dyn Mesher<T>> {
        for mesher in &self.meshers {
            if mesher.is_applicable(block_id) {
                return Some(&**mesher);
            }
        }

        None
    }
}
