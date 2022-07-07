use specs::{ReadExpect, System, WriteExpect};

use crate::{
    common::ClientFilter,
    server::encode_message,
    world::{Clients, MessageQueue},
    EncodedMessage,
};

pub struct BroadcastSystem;

impl<'a> System<'a> for BroadcastSystem {
    type SystemData = (ReadExpect<'a, Clients>, WriteExpect<'a, MessageQueue>);

    fn run(&mut self, data: Self::SystemData) {
        let (clients, mut queue) = data;

        if queue.is_empty() {
            return;
        }

        for (message, filter) in queue.drain(..) {
            let encoded = EncodedMessage(encode_message(&message));

            if let ClientFilter::Direct(id) = &filter {
                if let Some(client) = clients.get(id) {
                    client.addr.do_send(encoded);
                }

                continue;
            }

            clients.iter().for_each(|(id, client)| {
                match &filter {
                    ClientFilter::All => {}
                    ClientFilter::Include(ids) => {
                        if !ids.iter().any(|i| *i == *id) {
                            return;
                        }
                    }
                    ClientFilter::Exclude(ids) => {
                        if ids.iter().any(|i| *i == *id) {
                            return;
                        }
                    }
                    _ => {}
                };

                client.addr.do_send(encoded.to_owned());
            })
        }
    }
}
