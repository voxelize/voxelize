use specs::{ReadExpect, System, WriteExpect};

use crate::{
    common::ClientFilter,
    server::encode_message,
    world::{profiler::Profiler, Clients, MessageQueue},
    EncodedMessage, EncodedMessageQueue, MessageType, Transports,
};

pub struct BroadcastSystem;

impl<'a> System<'a> for BroadcastSystem {
    type SystemData = (
        ReadExpect<'a, Transports>,
        ReadExpect<'a, Clients>,
        WriteExpect<'a, MessageQueue>,
        WriteExpect<'a, EncodedMessageQueue>,
        WriteExpect<'a, Profiler>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (transports, clients, mut queue, mut encoded_queue, mut profiler) = data;

        encoded_queue.append(queue.drain(..).collect());
        encoded_queue.process();

        let done_messages = encoded_queue.receive();

        if done_messages.is_empty() {
            return;
        }

        for (encoded, filter) in done_messages {
            transports.values().for_each(|recipient| {
                recipient.do_send(encoded.to_owned());
            });

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
