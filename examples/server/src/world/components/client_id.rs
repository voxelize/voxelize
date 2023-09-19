use specs::{Component, VecStorage};

#[derive(Component)]
#[storage(VecStorage)]
pub struct ClientId(pub String);
