use serde::{Deserialize, Serialize};
use specs::{Component, VecStorage};

#[derive(Default, Component, Serialize, Deserialize)]
#[storage(VecStorage)]
pub struct TextComp(pub String);

impl TextComp {
    pub fn new(text: &str) -> Self {
        Self(text.to_owned())
    }
}
