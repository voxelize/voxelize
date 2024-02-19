use specs::{Component, NullStorage};

#[derive(Default, Component)]
#[storage(NullStorage)]
pub struct BotFlag;
