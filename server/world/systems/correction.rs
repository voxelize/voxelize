use serde_json::json;
use specs::{Entities, Join, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::{
    world::components::{ClientFlag, IDComp, LastSentPos, PositionComp},
    ClientFilter, EventProtocol, Message, MessageType, WorldConfig, MessageQueue,
};

/// System that checks each client entity's current position against the last
/// authoritative position the server sent. When the squared distance exceeds
/// the `position_tolerance_sq` configured in `WorldConfig`, a corrective
/// `vox-builtin:position` event is queued to that specific client and the
/// stored `LastSentPos` is updated.
#[derive(Default)]
pub struct PositionCorrectionSystem;

impl<'a> System<'a> for PositionCorrectionSystem {
    type SystemData = (
        ReadExpect<'a, WorldConfig>,
        WriteExpect<'a, MessageQueue>,
        Entities<'a>,
        ReadStorage<'a, ClientFlag>,
        ReadStorage<'a, PositionComp>,
        ReadStorage<'a, IDComp>,
        WriteStorage<'a, LastSentPos>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (config, mut queue, entities, client_flag, positions, ids, mut last_sent) = data;

        // If tolerance <= 0, corrections are disabled.
        if config.position_tolerance_sq <= 0.0 {
            return;
        }

        for (ent, pos, id, _flag) in (&entities, &positions, &ids, &client_flag).join() {
            let send_component = last_sent.get(ent).cloned();
            let current = &pos.0;

            let need_send = if let Some(ref last) = send_component {
                let dx = current.0 - (last.0).0;
                let dy = current.1 - (last.0).1;
                let dz = current.2 - (last.0).2;
                (dx * dx + dy * dy + dz * dz) > config.position_tolerance_sq
            } else {
                // No record yet, initialise but do not send.
                false
            };

            if need_send {
                // Build event for this client; include server timestamp (ms)
                let ts = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis();

                let payload_str =
                    json!([current.0, current.1, current.2, ts]).to_string();
                let evt = EventProtocol {
                    name: "vox-builtin:position".to_owned(),
                    payload: payload_str,
                };

                queue.push((
                    Message::new(&MessageType::Event).events(&[evt]).build(),
                    ClientFilter::Direct(id.0.to_owned()),
                ));
            }

            // Update / insert last sent component
            if let Some(last) = last_sent.get_mut(ent) {
                last.0.set(current.0, current.1, current.2);
            } else {
                last_sent
                    .insert(ent, LastSentPos(current.clone()))
                    .ok();
            }
        }
    }
}