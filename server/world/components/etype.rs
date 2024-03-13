use specs::{Component, VecStorage};

#[derive(Default, Component)]
#[storage(VecStorage)]
pub struct ETypeComp(pub String, pub bool);

impl ETypeComp {
    pub fn new(etype: &str, is_block: bool) -> Self {
        Self(etype.to_owned(), is_block)
    }
}
