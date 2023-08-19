use voxelize::{BlockId, BlockIdentity};

#[derive(Clone)]
pub struct Block {
    pub id: BlockId,
    pub name: String,
    pub is_solid: bool,
}

impl Block {
    pub fn new(id: BlockId, name: &str) -> BlockBuilder {
        BlockBuilder::new(id, name)
    }
}

#[derive(Default)]
pub struct BlockBuilder {
    id: BlockId,
    name: String,
    is_solid: bool,
}

impl BlockBuilder {
    pub fn new(id: BlockId, name: &str) -> Self {
        Self {
            id,
            name: name.to_owned(),
            ..Default::default()
        }
    }

    pub fn is_solid(mut self, is_solid: bool) -> Self {
        self.is_solid = is_solid;
        self
    }

    pub fn build(self) -> Block {
        Block {
            id: self.id,
            name: self.name,
            is_solid: self.is_solid,
        }
    }
}

impl BlockIdentity for Block {
    fn id(&self) -> BlockId {
        self.id
    }

    fn name(&self) -> &str {
        &self.name
    }
}
