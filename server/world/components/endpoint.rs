use message_io::network::Endpoint;
use specs::{Component, VecStorage};

/// An endpoint to a client's connection.
#[derive(Component)]
#[storage(VecStorage)]
pub struct EndpointComp(pub Endpoint);

impl EndpointComp {
    /// Create a component of an endpoint to a client's connection.
    pub fn new(endpoint: &Endpoint) -> Self {
        Self(endpoint.to_owned())
    }
}
