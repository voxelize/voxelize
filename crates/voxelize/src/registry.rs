use hashbrown::HashMap;

use crate::BlockIdentity;

#[derive(Clone)]
pub struct Registry<T: BlockIdentity + Clone> {
    blocks_by_id: HashMap<u32, Box<T>>,
    blocks_by_name: HashMap<String, Box<T>>,
}

impl<T: BlockIdentity + Clone> Registry<T> {
    pub fn new() -> Registry<T> {
        Self {
            blocks_by_id: HashMap::new(),
            blocks_by_name: HashMap::new(),
        }
    }

    pub fn with_blocks(blocks: Vec<T>) -> Registry<T> {
        let mut registry = Self::new();

        for block in blocks {
            registry.register(block);
        }

        registry
    }

    pub fn register(&mut self, block: T) {
        if self.blocks_by_id.contains_key(&block.id()) {
            panic!(
                "Block with id {} already exists: {}",
                block.id(),
                block.name()
            );
        }

        if self
            .blocks_by_name
            .contains_key(&block.name().to_lowercase())
        {
            panic!("Block with name {} already exists", block.name());
        }

        self.blocks_by_id
            .insert(block.id(), Box::new(block.clone()));
        self.blocks_by_name
            .insert(block.name().to_lowercase(), Box::new(block));
    }

    pub fn get_block_by_id(&self, id: u32) -> Option<&Box<T>> {
        self.blocks_by_id.get(&id)
    }

    pub fn get_block_by_name(&self, name: &str) -> Option<&Box<T>> {
        self.blocks_by_name.get(&name.to_lowercase())
    }
}
