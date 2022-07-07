use log::info;
use specs::{ReadExpect, ReadStorage, System, WriteExpect};

use crate::{
    ClientFilter, ClientFlag, DirectionComp, IDComp, Message, MessageQueue, MessageType, NameComp,
    PeerProtocol, PositionComp, Stats,
};

pub struct PeersSendingSystem;

impl<'a> System<'a> for PeersSendingSystem {
    type SystemData = (
        ReadExpect<'a, Stats>,
        WriteExpect<'a, MessageQueue>,
        ReadStorage<'a, ClientFlag>,
        ReadStorage<'a, IDComp>,
        ReadStorage<'a, NameComp>,
        ReadStorage<'a, PositionComp>,
        ReadStorage<'a, DirectionComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use specs::Join;

        let (stats, mut queue, flag, ids, names, positions, directions) = data;

        if stats.tick % 2 == 0 {
            return;
        }

        let mut peers = vec![];
        for (id, name, position, direction, _) in
            (&ids, &names, &positions, &directions, &flag).join()
        {
            peers.push(PeerProtocol {
                id: id.0.to_owned(),
                username: name.0.to_owned(),
                position: Some(position.0.to_owned()),
                direction: Some(direction.0.to_owned()),
            });
        }

        if peers.is_empty() || peers.len() == 1 {
            return;
        }

        queue.push((
            Message::new(&MessageType::Peer).peers(&peers).build(),
            ClientFilter::All,
        ));
    }
}
