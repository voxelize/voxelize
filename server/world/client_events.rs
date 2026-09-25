use hashbrown::HashSet;
use specs::WorldExt;

use super::{World, VOXELIZE_BUILTIN_SOUND_EFFECT_EVENT};

/// A peer's arm swing: cosmetic, and relayed with the sender's own id.
pub const VOXELIZE_BUILTIN_ARM_SWING_EVENT: &str = "vox-builtin:arm-swing";

/// Event names a client may send that no handler claims, which the engine
/// forwards to nearby peers. Everything else a client sends unclaimed is
/// refused: peers obey server events (`vox-builtin:position` moves the body
/// that receives it), so a relayed forgery would act on every client near
/// the sender. Events from a transport are the server's own and always
/// pass.
pub(crate) struct RelayedClientEvents(HashSet<String>);

impl Default for RelayedClientEvents {
    fn default() -> Self {
        Self(
            [
                VOXELIZE_BUILTIN_SOUND_EFFECT_EVENT,
                VOXELIZE_BUILTIN_ARM_SWING_EVENT,
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
        )
    }
}

impl World {
    /// Lets clients relay `name` to their peers when no handler claims it.
    /// Only for events that are cosmetic on the receiving end.
    pub fn relay_client_event(&mut self, name: &str) {
        let key = name.to_lowercase();
        if self.ecs().try_fetch::<RelayedClientEvents>().is_none() {
            self.ecs_mut().insert(RelayedClientEvents::default());
        }
        self.ecs_mut()
            .write_resource::<RelayedClientEvents>()
            .0
            .insert(key);
    }

    /// Every event name clients may relay, lowercase, sorted.
    pub fn relayed_client_events(&self) -> Vec<String> {
        let mut names: Vec<String> = match self.ecs().try_fetch::<RelayedClientEvents>() {
            Some(relayed) => relayed.0.iter().cloned().collect(),
            None => RelayedClientEvents::default().0.into_iter().collect(),
        };
        names.sort();
        names
    }

    /// The handler registered for event `name`, if any.
    pub fn event_handle(
        &self,
        name: &str,
    ) -> Option<std::sync::Arc<dyn Fn(&mut World, &str, &str) + Send + Sync>> {
        self.event_handles.get(&name.to_lowercase()).cloned()
    }

    pub(crate) fn is_relayed_client_event(&self, key: &str) -> bool {
        match self.ecs().try_fetch::<RelayedClientEvents>() {
            Some(relayed) => relayed.0.contains(key),
            None => RelayedClientEvents::default().0.contains(key),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::{
        ClientFilter, EventProtocol, Events, Message, MessageType, Transports, WorldConfig,
        WsSender,
    };

    fn world(name: &str) -> World {
        World::new(name, &WorldConfig::new().saving(false).build())
    }

    fn send(world: &mut World, from: &str, events: &[(&str, &str)]) {
        let events: Vec<EventProtocol> = events
            .iter()
            .map(|(name, payload)| EventProtocol {
                name: (*name).to_owned(),
                payload: (*payload).to_owned(),
            })
            .collect();
        world.on_event(
            from,
            Message::new(&MessageType::Event).events(&events).build(),
        );
    }

    /// What the world queued for delivery to peers, as (name, payload, filter).
    fn queued(world: &mut World) -> Vec<(String, Option<String>, Option<ClientFilter>)> {
        world
            .ecs_mut()
            .write_resource::<Events>()
            .queue
            .drain(..)
            .map(|event| (event.name, event.payload, event.filter))
            .collect()
    }

    fn add_transport(world: &mut World, id: &str) {
        let (control, _) = tokio::sync::mpsc::unbounded_channel();
        let (bulk, _) = tokio::sync::mpsc::unbounded_channel();
        world
            .ecs_mut()
            .write_resource::<Transports>()
            .insert(id.to_owned(), WsSender::new(control, bulk));
    }

    #[test]
    fn a_forged_move_from_a_client_never_reaches_its_peers() {
        let mut world = world("client-events-forged");

        send(
            &mut world,
            "guest",
            &[
                ("vox-builtin:position", "[0,500,0]"),
                ("vox-builtin:force", "[0,900,0]"),
                ("vox-builtin:impulse", "[90,0,0]"),
                ("VOX-BUILTIN:POSITION", "[0,500,0]"),
                ("world-reset", "{\"chunks\":0}"),
            ],
        );

        let events = queued(&mut world);
        assert!(events.is_empty(), "{events:?}");
    }

    #[test]
    fn cosmetic_events_still_reach_peers_in_the_senders_name() {
        let mut world = world("client-events-cosmetic");

        send(
            &mut world,
            "guest",
            &[
                (
                    VOXELIZE_BUILTIN_SOUND_EFFECT_EVENT,
                    r#"{"id":"step","sourceClientId":"victim"}"#,
                ),
                (VOXELIZE_BUILTIN_ARM_SWING_EVENT, "victim"),
            ],
        );

        let events = queued(&mut world);
        assert_eq!(events.len(), 2, "{events:?}");
        let (name, payload, filter) = &events[0];
        assert_eq!(name, VOXELIZE_BUILTIN_SOUND_EFFECT_EVENT);
        assert!(
            payload
                .as_deref()
                .is_some_and(|p| p.contains("guest") && !p.contains("victim")),
            "{payload:?}"
        );
        assert!(matches!(filter, Some(ClientFilter::Exclude(ids)) if ids == &["guest"]));
        let (name, payload, _) = &events[1];
        assert_eq!(name, VOXELIZE_BUILTIN_ARM_SWING_EVENT);
        assert_eq!(
            payload.as_deref(),
            Some("\"guest\""),
            "swings only the sender's arm"
        );
    }

    #[test]
    fn the_servers_own_events_still_pass() {
        let mut world = world("client-events-transport");
        add_transport(&mut world, "transport");

        send(
            &mut world,
            "transport",
            &[("vox-builtin:position", "[0,70,0]")],
        );

        let events = queued(&mut world);
        assert_eq!(events.len(), 1, "{events:?}");
        assert_eq!(events[0].0, "vox-builtin:position");
    }

    #[test]
    fn a_game_can_open_a_cosmetic_name_and_a_handler_matches_any_casing() {
        let mut world = world("client-events-opt-in");
        world.relay_client_event("Emote");
        let handled: Arc<Mutex<Vec<String>>> = Arc::default();
        let seen = Arc::clone(&handled);
        world.set_event_handle("command_executed", move |_, client_id, _| {
            seen.lock().unwrap().push(client_id.to_owned());
        });

        send(
            &mut world,
            "guest",
            &[("emote", "{}"), ("Command_Executed", "{}")],
        );

        assert_eq!(*handled.lock().unwrap(), ["guest"]);
        let events = queued(&mut world);
        assert_eq!(events.len(), 1, "{events:?}");
        assert_eq!(events[0].0, "emote");
        assert!(world.relayed_client_events().contains(&"emote".to_owned()));
    }
}
