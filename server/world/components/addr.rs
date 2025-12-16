use specs::{Component, VecStorage};

use crate::server::WsSender;

/// WebSocket sender component for a client's connection.
#[derive(Component)]
#[storage(VecStorage)]
pub struct AddrComp(pub WsSender);

impl AddrComp {
    pub fn new(sender: &WsSender) -> Self {
        Self(sender.clone())
    }
}
