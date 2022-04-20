use specs::{Component, VecStorage};

#[derive(Default, Component)]
#[storage(VecStorage)]
pub struct IDComp(pub String);

impl IDComp {
    pub fn new(id: &str) -> Self {
        Self(id.to_owned())
    }
}
