use super::{default::DefaultMesher, Mesher};

pub struct MesherRegistry {
    meshers: Vec<Box<dyn Mesher>>,
}

impl MesherRegistry {
    pub fn new() -> Self {
        Self {
            meshers: vec![Box::new(DefaultMesher)], // DefaultMesher is added first
        }
    }

    pub fn register<T: 'static + Mesher>(&mut self, mesher: T) {
        self.meshers.insert(0, Box::new(mesher));
    }

    pub fn get_mesher_by_block_id(&self, block_id: u32) -> &dyn Mesher {
        for mesher in &self.meshers {
            if mesher.is_applicable(block_id) {
                return &**mesher;
            }
        }

        panic!("No applicable mesher found, even though a default should always exist!");
    }
}
