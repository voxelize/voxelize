use serde::Serialize;
use specs::{Component, VecStorage};

#[derive(Default, Component, Serialize)]
#[storage(VecStorage)]
pub struct NameComp(pub String);

impl NameComp {
    pub fn new(name: &str) -> Self {
        Self(name.to_owned())
    }
}
