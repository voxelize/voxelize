use hashbrown::HashMap;

use crate::Block;

pub struct Registry<T: Block + Clone> {
    blocks_by_id: HashMap<u32, Box<T>>,
    blocks_by_name: HashMap<String, Box<T>>,
}

impl<T: Block + Clone> Registry<T> {
    pub fn new() -> Self {
        Self {
            blocks_by_id: HashMap::new(),
            blocks_by_name: HashMap::new(),
        }
    }

    pub fn register(&mut self, block: T) {
        self.blocks_by_id
            .insert(block.id(), Box::new(block.clone()));
        self.blocks_by_name
            .insert(block.name().to_owned(), Box::new(block));
    }

    pub fn get_block_by_id(&self, id: u32) -> Option<&Box<T>> {
        self.blocks_by_id.get(&id)
    }

    pub fn get_block_by_name(&self, name: &str) -> Option<&Box<T>> {
        self.blocks_by_name.get(name)
    }
}
