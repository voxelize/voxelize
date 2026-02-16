use specs::{ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};

use crate::{
    world::system_profiler::WorldTimingContext, ClientFilter, ClientFlag, Clients, IDComp,
    Message, MessageQueues, MessageType, MetadataComp, NameComp, PeerProtocol,
};

#[derive(Default)]
pub struct PeersSendingSystem {
    peers_buffer: Vec<PeerProtocol>,
}

impl<'a> System<'a> for PeersSendingSystem {
    type SystemData = (
        ReadExpect<'a, Clients>,
        WriteExpect<'a, MessageQueues>,
        ReadStorage<'a, ClientFlag>,
        ReadStorage<'a, IDComp>,
        ReadStorage<'a, NameComp>,
        WriteStorage<'a, MetadataComp>,
        ReadExpect<'a, WorldTimingContext>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use specs::Join;

        let (clients, mut queue, flag, ids, names, mut metadatas, timing) = data;
        let _t = timing.timer("peers-sending");

        let peers = &mut self.peers_buffer;
        peers.clear();
        if clients.is_empty() {
            return;
        }
        if peers.capacity() < clients.len() {
            peers.reserve(clients.len() - peers.len());
        }
        for (id, name, metadata, _) in (&ids, &names, &mut metadatas, &flag).join() {
            if metadata.is_empty() {
                continue;
            }
            let Some(json_str) = metadata.to_cached_str_if_updated() else {
                continue;
            };

            peers.push(PeerProtocol {
                id: id.0.to_owned(),
                username: name.0.to_owned(),
                metadata: json_str,
            });

            metadata.reset();
        }

        if peers.is_empty() {
            return;
        }
        let next_capacity = peers.capacity();
        let peers_to_send = std::mem::replace(peers, Vec::with_capacity(next_capacity));

        queue.push((
            Message::new(&MessageType::Peer)
                .peers_owned(peers_to_send)
                .build(),
            ClientFilter::All,
        ));
    }
}
