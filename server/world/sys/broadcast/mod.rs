use log::info;
use message_io::node::NodeHandler;
use specs::{ReadExpect, System, WriteExpect};

use crate::{
    common::ClientFilter,
    server::models::encode_message,
    world::{messages::MessageQueue, Clients},
};

pub mod entities;

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

            clients.iter().for_each(|(endpoint, client)| {
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
                };

                handler.network().send(*endpoint, &encoded);
            })
        }
    }
}
