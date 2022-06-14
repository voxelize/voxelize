use log::info;
use specs::{ReadExpect, ReadStorage, System, WriteExpect};

use crate::{
    ClientFilter, ClientFlag, DirectionComp, EntityProtocol, IDComp, Message, MessageQueue,
    MessageType, PeerProtocol, PositionComp, Stats,
};

pub struct BroadcastPeersSystem;

impl<'a> System<'a> for BroadcastPeersSystem {
    type SystemData = (
        ReadExpect<'a, Stats>,
        WriteExpect<'a, MessageQueue>,
        ReadStorage<'a, ClientFlag>,
        ReadStorage<'a, IDComp>,
        ReadStorage<'a, PositionComp>,
        ReadStorage<'a, DirectionComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use specs::Join;

        let (stats, mut queue, flag, ids, positions, directions) = data;

        if stats.tick % 2 == 0 {
            return;
        }

        let mut peers = vec![];
        for (id, position, direction, _) in (&ids, &positions, &directions, &flag).join() {
            peers.push(PeerProtocol {
                id: id.0.to_owned(),
                position: Some(position.0.to_owned()),
                direction: Some(direction.0.to_owned()),
                ..Default::default()
            });
        }

        if peers.is_empty() {
            return;
        }

        queue.push((
            Message::new(&MessageType::Peer).peers(&peers).build(),
            ClientFilter::All,
        ));
    }
}
