use specs::{Component, VecStorage};

#[derive(Default, Component)]
#[storage(VecStorage)]
pub struct ETypeComp(pub String);

impl ETypeComp {
    pub fn new(etype: &str) -> Self {
        Self(etype.to_owned())
    }
}
