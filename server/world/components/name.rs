use specs::{Component, VecStorage};

#[derive(Default, Component)]
#[storage(VecStorage)]
pub struct NameComp(pub String);

impl NameComp {
    pub fn new(id: &str) -> Self {
        Self(id.to_owned())
    }
}
