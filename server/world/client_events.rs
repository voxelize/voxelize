use std::time::Instant;

use hashbrown::{HashMap, HashSet};
use log::warn;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specs::WorldExt;

use super::{
    ChunkUtils, ClientFilter, CurrentChunkComp, Event, PositionComp, World,
    VOXELIZE_BUILTIN_SOUND_EFFECT_EVENT,
};

/// A peer's arm swing: cosmetic, and relayed with the sender's own id.
pub const VOXELIZE_BUILTIN_ARM_SWING_EVENT: &str = "vox-builtin:arm-swing";

/// The lane for peer effects a game opens with `relay_client_event`: the
/// client sends `{ name, payload, position? }` under this name, and peers
/// receive `{ name, payload, senderId, position? }` with the sender id
/// stamped by the server (a payload cannot claim to be someone else), the
/// sender left out (it drew its own effect already), and delivery limited
/// to the clients interested in the chunk the effect happens in.
pub const VOXELIZE_BUILTIN_RELAY_EVENT: &str = "vox-builtin:relay";

/// How far from its sender, in blocks, a relayed effect may claim to be.
/// Further than this it is refused: an effect is something its sender is
/// near enough to cause.
pub const RELAY_POSITION_REACH: f32 = 64.0;

/// A client's relay allowance: this many at once, refilled at
/// [`RELAY_PER_SECOND`]. Effects are cosmetic, and a client that floods
/// them is refused rather than handed every peer's frame budget.
pub const RELAY_BURST: f64 = 40.0;
pub const RELAY_PER_SECOND: f64 = 20.0;

/// Each client's remaining relay allowance and when it was last topped up.
#[derive(Default)]
pub(crate) struct RelayBudgets(HashMap<String, (f64, Instant)>);

impl RelayBudgets {
    /// Spends one relay for `client_id`, or refuses when it has none left.
    fn spend(&mut self, client_id: &str, now: Instant) -> bool {
        if self.0.len() > 1024 {
            // Clients that left keep no allowance past a minute of silence.
            self.0
                .retain(|_, (_, at)| now.duration_since(*at).as_secs_f64() < 60.0);
        }
        let (tokens, at) = self
            .0
            .entry(client_id.to_owned())
            .or_insert((RELAY_BURST, now));
        let refilled = *tokens + now.duration_since(*at).as_secs_f64() * RELAY_PER_SECOND;
        *at = now;
        if refilled < 1.0 {
            *tokens = refilled;
            return false;
        }
        *tokens = (refilled - 1.0).min(RELAY_BURST - 1.0);
        true
    }
}

#[derive(Deserialize)]
struct RelayRequest {
    name: String,
    #[serde(default)]
    payload: Value,
    #[serde(default)]
    position: Option<[f32; 3]>,
}

/// What peers receive on [`VOXELIZE_BUILTIN_RELAY_EVENT`].
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RelayedEvent {
    pub name: String,
    pub payload: Value,
    pub sender_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<[f32; 3]>,
}

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

    /// The peers' copy of a relay request from `client_id`, or `None` (with
    /// a warning) when the request is malformed, names an event the game
    /// never opened, or claims a spot too far from its sender.
    pub(crate) fn relay_request(&mut self, client_id: &str, raw: &str) -> Option<Event> {
        if self.ecs().try_fetch::<RelayBudgets>().is_none() {
            self.ecs_mut().insert(RelayBudgets::default());
        }
        if !self
            .ecs_mut()
            .write_resource::<RelayBudgets>()
            .spend(client_id, Instant::now())
        {
            warn!(
                "[event-relay] refused a relay from {} in world {}: over {} a second; nothing sent",
                client_id, self.name, RELAY_PER_SECOND
            );
            return None;
        }
        let Ok(request) = serde_json::from_str::<RelayRequest>(raw) else {
            warn!(
                "[event-relay] refused a malformed relay from {} in world {}: nothing sent",
                client_id, self.name
            );
            return None;
        };
        let key = request.name.to_lowercase();
        if key.starts_with("vox-builtin:") || !self.is_relayed_client_event(&key) {
            warn!(
                "[event-relay] refused relay of {} from {} in world {}: clients may only relay {:?}; nothing sent",
                request.name,
                client_id,
                self.name,
                self.relayed_client_events()
            );
            return None;
        }
        let entity = self.clients().get(client_id).map(|c| c.entity);
        let sender_at = entity.and_then(|ent| {
            self.read_component::<PositionComp>()
                .get(ent)
                .map(|p| [p.0 .0, p.0 .1, p.0 .2])
        });
        if let (Some(at), Some(from)) = (request.position, sender_at) {
            let reach = RELAY_POSITION_REACH;
            let d2 = (at[0] - from[0]).powi(2) + (at[1] - from[1]).powi(2) + (at[2] - from[2]).powi(2);
            if !d2.is_finite() || d2 > reach * reach {
                warn!(
                    "[event-relay] refused relay of {} from {} in world {}: its position {:?} is more than {} blocks from the sender; nothing sent",
                    request.name, client_id, self.name, at, reach
                );
                return None;
            }
        }
        let location = match request.position {
            Some(at) => Some(ChunkUtils::map_voxel_to_chunk(
                at[0].floor() as i32,
                at[1].floor() as i32,
                at[2].floor() as i32,
                self.config().chunk_size,
            )),
            None => entity.and_then(|ent| {
                self.read_component::<CurrentChunkComp>()
                    .get(ent)
                    .map(|c| c.coords.clone())
            }),
        };
        let mut event = Event::new(VOXELIZE_BUILTIN_RELAY_EVENT)
            .payload(RelayedEvent {
                name: key,
                payload: request.payload,
                sender_id: client_id.to_owned(),
                position: request.position,
            })
            .filter(ClientFilter::Exclude(vec![client_id.to_owned()]));
        if let Some(location) = location {
            event = event.location(location);
        }
        Some(event.build())
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

    fn add_client_at(world: &mut World, id: &str, at: [f32; 3]) -> specs::Entity {
        add_listening_client_at(world, id, at).0
    }

    /// A client whose control lane the test can read.
    fn add_listening_client_at(
        world: &mut World,
        id: &str,
        at: [f32; 3],
    ) -> (specs::Entity, tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>) {
        use crate::Client;
        use crate::Vec3;
        use specs::Builder;
        let ent = world
            .ecs_mut()
            .create_entity()
            .with(PositionComp(Vec3(at[0], at[1], at[2])))
            .with(CurrentChunkComp::default())
            .build();
        let (control, receiver) = tokio::sync::mpsc::unbounded_channel();
        let (bulk, _) = tokio::sync::mpsc::unbounded_channel();
        world.clients_mut().insert(
            id.to_owned(),
            Client {
                id: id.to_owned(),
                entity: ent,
                username: id.to_owned(),
                sender: WsSender::new(control, bulk),
                motion_protocol: Default::default(),
            },
        );
        world
            .ecs_mut()
            .write_storage::<crate::IDComp>()
            .insert(ent, crate::IDComp::new(id))
            .unwrap();
        (ent, receiver)
    }

    #[test]
    fn a_relayed_effect_reaches_peers_stamped_with_its_real_sender() {
        let mut world = world("client-events-relay");
        world.relay_client_event("crumbs");
        add_client_at(&mut world, "guest", [10.0, 64.0, 10.0]);

        send(
            &mut world,
            "guest",
            &[(
                VOXELIZE_BUILTIN_RELAY_EVENT,
                r#"{"name":"Crumbs","payload":{"item":7,"senderId":"victim"},"position":[11.0,65.5,9.0]}"#,
            )],
        );

        let events = queued(&mut world);
        assert_eq!(events.len(), 1, "{events:?}");
        let (name, payload, filter) = &events[0];
        assert_eq!(name, VOXELIZE_BUILTIN_RELAY_EVENT);
        let relayed: RelayedEvent = serde_json::from_str(payload.as_deref().unwrap()).unwrap();
        assert_eq!(relayed.name, "crumbs");
        assert_eq!(relayed.sender_id, "guest", "stamped by the server");
        assert_eq!(relayed.payload["item"], 7);
        assert_eq!(relayed.position, Some([11.0, 65.5, 9.0]));
        assert!(matches!(filter, Some(ClientFilter::Exclude(ids)) if ids == &["guest"]));
    }

    #[test]
    fn a_relay_is_refused_for_an_unopened_name_or_a_far_away_spot() {
        let mut world = world("client-events-relay-refused");
        world.relay_client_event("crumbs");
        add_client_at(&mut world, "guest", [0.0, 64.0, 0.0]);

        send(
            &mut world,
            "guest",
            &[
                (VOXELIZE_BUILTIN_RELAY_EVENT, r#"{"name":"world-reset","payload":{}}"#),
                (VOXELIZE_BUILTIN_RELAY_EVENT, r#"{"name":"vox-builtin:position","payload":[0,500,0]}"#),
                (
                    VOXELIZE_BUILTIN_RELAY_EVENT,
                    r#"{"name":"crumbs","payload":{},"position":[500.0,64.0,0.0]}"#,
                ),
                (VOXELIZE_BUILTIN_RELAY_EVENT, "not json"),
            ],
        );

        let events = queued(&mut world);
        assert!(events.is_empty(), "{events:?}");
    }

    #[test]
    fn an_opened_name_relays_to_peers_but_not_back_to_its_sender() {
        let mut world = world("client-events-exclude");
        world.relay_client_event("Emote");

        send(&mut world, "guest", &[("emote", "{}")]);

        let events = queued(&mut world);
        assert_eq!(events.len(), 1, "{events:?}");
        assert!(matches!(&events[0].2, Some(ClientFilter::Exclude(ids)) if ids == &["guest"]));
    }

    #[test]
    fn a_near_event_reaches_only_the_bodies_in_its_radius() {
        use crate::{EventNear, Events};
        let near = EventNear {
            position: [0.0, 64.0, 0.0],
            radius: 8.0,
        };
        assert!(near.reaches([3.0, 66.0, -4.0]));
        assert!(!near.reaches([9.0, 64.0, 0.0]));

        let mut events = Events::new();
        events.dispatch_near(Event::new("puff").build(), [1.0, 2.0, 3.0], 12.0);
        assert_eq!(
            events.queue[0].near,
            Some(EventNear {
                position: [1.0, 2.0, 3.0],
                radius: 12.0
            })
        );
    }

    #[test]
    fn the_events_system_delivers_a_near_event_only_within_its_radius() {
        use specs::RunNow;
        let mut world = world("client-events-near-delivery");
        let (_, mut close) = add_listening_client_at(&mut world, "close", [2.0, 64.0, 1.0]);
        let (_, mut far) = add_listening_client_at(&mut world, "far", [40.0, 64.0, 0.0]);

        world
            .events_mut()
            .dispatch(Event::new("puff").near([0.0, 64.0, 0.0], 8.0).build());
        crate::EventsSystem.run_now(world.ecs());

        assert!(close.try_recv().is_ok(), "the near client hears it");
        assert!(far.try_recv().is_err(), "the far client does not");
    }

    #[test]
    fn a_flood_of_relays_is_capped_at_the_burst() {
        let mut world = world("client-events-relay-flood");
        world.relay_client_event("crumbs");
        add_client_at(&mut world, "guest", [0.0, 64.0, 0.0]);
        let flood: Vec<(&str, &str)> = (0..100)
            .map(|_| (VOXELIZE_BUILTIN_RELAY_EVENT, r#"{"name":"crumbs","payload":{}}"#))
            .collect();

        send(&mut world, "guest", &flood);

        let sent = queued(&mut world).len();
        assert!(
            sent as f64 <= RELAY_BURST + 1.0 && sent >= 30,
            "{sent} of 100 relays went out"
        );
    }

    #[test]
    fn a_relay_allowance_refills_over_time() {
        let mut budgets = RelayBudgets::default();
        let start = Instant::now();
        let spent = (0..60).filter(|_| budgets.spend("guest", start)).count();
        assert_eq!(spent as f64, RELAY_BURST);
        let later = start + std::time::Duration::from_millis(500);
        let refilled = (0..60).filter(|_| budgets.spend("guest", later)).count();
        assert_eq!(refilled as f64, (RELAY_PER_SECOND * 0.5).floor());
        assert!(budgets.spend("other", start), "each client has its own");
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
