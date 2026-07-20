use specs::{ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};

use crate::{
    encode_message, is_peer_relevant, ClientFlag, Clients, IDComp, Message, MessageType,
    MetadataComp, NameComp, PeerProtocol, PositionComp, ReplicatedStateBuffer, Stats, Transports,
    WorldConfig,
};

pub struct PeersSendingSystem;

impl<'a> System<'a> for PeersSendingSystem {
    type SystemData = (
        ReadExpect<'a, Clients>,
        ReadExpect<'a, Transports>,
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, Stats>,
        WriteExpect<'a, ReplicatedStateBuffer>,
        ReadStorage<'a, ClientFlag>,
        ReadStorage<'a, IDComp>,
        ReadStorage<'a, NameComp>,
        ReadStorage<'a, PositionComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use specs::{Join, LendJoin};

        let (
            clients,
            transports,
            config,
            stats,
            mut replicated_state,
            flag,
            ids,
            names,
            positions,
            mut metadatas,
        ) = data;

        // Collect the peers whose metadata (position, direction, flags...)
        // changed this tick, along with their positions for relevance checks.
        let mut changed: Vec<(PeerProtocol, Option<[f32; 3]>)> = vec![];
        for (id, name, metadata, position, _) in
            (&ids, &names, &mut metadatas, positions.maybe(), &flag).join()
        {
            let (json_str, updated) = metadata.to_cached_str();

            if !updated {
                continue;
            }

            changed.push((
                PeerProtocol {
                    id: id.0.to_owned(),
                    username: name.0.to_owned(),
                    metadata: json_str,
                },
                position.map(|p| [p.0 .0, p.0 .1, p.0 .2]),
            ));

            metadata.reset();
        }

        if changed.is_empty() {
            return;
        }

        // Peer positions/metadata are latest-wins STATE (see
        // `world::replication`): each snapshot lands in a per-client,
        // per-peer slot where a newer value overwrites an undelivered older
        // one. Never append peer positions to a queue — a backlog of old
        // positions is what makes other players rubber-band.
        for (client_id, client) in clients.iter() {
            let client_pos = positions.get(client.entity).map(|p| [p.0 .0, p.0 .1, p.0 .2]);

            for (peer, peer_pos) in &changed {
                // A client is authoritative over its own pose; echoing it back
                // is wasted bandwidth and lets a buggy client create a
                // self-peer.
                if peer.id == *client_id {
                    continue;
                }

                let relevant = match (config.peer_visible_radius, client_pos, peer_pos) {
                    (Some(_), Some(client_pos), Some(peer_pos)) => {
                        let dx = peer_pos[0] - client_pos[0];
                        let dy = peer_pos[1] - client_pos[1];
                        let dz = peer_pos[2] - client_pos[2];
                        is_peer_relevant(
                            dx * dx + dy * dy + dz * dz,
                            config.peer_visible_radius,
                        )
                    }
                    // Unlimited radius, or a missing position on either side
                    // (never cull on missing data): always relevant.
                    _ => true,
                };

                if relevant {
                    replicated_state.stage_peer_update(client_id, peer.clone());
                }
            }
        }

        // Transports observe the whole world, so they receive the full
        // change set directly (no interest filtering, no coalescing).
        if !transports.is_empty() {
            let peers: Vec<PeerProtocol> = changed.into_iter().map(|(peer, _)| peer).collect();
            let message = Message::new(&MessageType::Peer)
                .peers(&peers)
                .tick(stats.dispatch_count())
                .build();
            let encoded = encode_message(&message);
            transports.values().for_each(|sender| {
                let _ = sender.send(encoded.clone());
            });
        }
    }
}
