use message_io::node::NodeHandler;
use specs::{ReadExpect, System, WriteExpect};

use crate::{
    common::ClientFilter,
    server::encode_message,
    world::{Clients, MessageQueue},
};

mod entities;

pub use entities::BroadcastEntitiesSystem;

pub struct BroadcastSystem;

impl<'a> System<'a> for BroadcastSystem {
    type SystemData = (
        ReadExpect<'a, NodeHandler<()>>,
        ReadExpect<'a, Clients>,
        WriteExpect<'a, MessageQueue>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (handler, clients, mut queue) = data;

        if queue.is_empty() {
            return;
        }

        for (message, filter) in queue.drain(..) {
            let encoded = encode_message(&message);

            if let ClientFilter::Direct(id) = &filter {
                if let Some(endpoint) = clients.id_to_endpoint(id) {
                    handler.network().send(*endpoint, &encoded);
                }

                continue;
            }

            clients.list.iter().for_each(|(endpoint, client)| {
                match &filter {
                    ClientFilter::All => {}
                    ClientFilter::Include(ids) => {
                        if !ids.iter().any(|i| *i == *client.id) {
                            return;
                        }
                    }
                    ClientFilter::Exclude(ids) => {
                        if ids.iter().any(|i| *i == *client.id) {
                            return;
                        }
                    }
                    _ => {}
                };

                handler.network().send(*endpoint, &encoded);
            })
        }
    }
}
