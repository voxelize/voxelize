use message_io::network::Endpoint;
use specs::{Component, VecStorage};

#[derive(Component)]
#[storage(VecStorage)]
pub struct EndpointComp(pub Endpoint);

impl EndpointComp {
    pub fn new(endpoint: &Endpoint) -> Self {
        Self(endpoint.to_owned())
    }
}
