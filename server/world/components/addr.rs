use actix::Recipient;
use specs::{Component, VecStorage};

use crate::EncodedMessage;

/// An endpoint to a client's connection.
#[derive(Component)]
#[storage(VecStorage)]
pub struct AddrComp(pub Recipient<EncodedMessage>);

impl AddrComp {
    /// Create a component of an endpoint to a client's connection.
    pub fn new(endpoint: &Recipient<EncodedMessage>) -> Self {
        Self(endpoint.to_owned())
    }
}
