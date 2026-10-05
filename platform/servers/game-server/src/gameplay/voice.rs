//! Proximity voice. Browsers talk to each other directly over WebRTC; the
//! server only decides who may talk to whom and carries the connection
//! setup between them. Players who switched voice on (`platform.voice.join`)
//! are paired with the nearest others within [`VOICE_RANGE`] (kept until
//! [`VOICE_KEEP`], at most [`MAX_PEERS`] each, and only when both choose
//! each other); each gets its list in [`VOICE_PEERS_EVENT`] whenever it
//! changes. Offers, answers and ICE candidates (`platform.voice.signal`)
//! are relayed between paired players only, small and rate limited.

use std::collections::HashMap;
use std::time::Instant;

use serde::Deserialize;
use serde_json::{json, Value};
use specs::WorldExt;
use voxelize::{ClientFilter, Clients, Event, PositionComp, World};

use super::rules::IntentError;
use super::{parse, reply, Gameplay};

/// `{ "peers": [{ "id", "name" }] }`: whom to be connected to, to one player.
pub const VOICE_PEERS_EVENT: &str = "platform.voice.peers";
/// `{ "from", "kind": "offer" | "answer" | "ice", "data" }`, relayed.
pub const VOICE_SIGNAL_EVENT: &str = "platform.voice.signal";
/// Players this close (blocks) are paired up...
pub const VOICE_RANGE: f32 = 32.0;
/// ...and stay paired until this far apart (no flapping at the edge).
pub const VOICE_KEEP: f32 = 40.0;
/// Connections a player keeps at most (the nearest).
pub const MAX_PEERS: usize = 8;
/// Largest relayed message (JSON bytes).
pub const MAX_SIGNAL_BYTES: usize = 16 * 1024;
/// Relayed messages a player may send per second.
pub const SIGNALS_PER_SECOND: u32 = 60;

#[derive(Debug)]
struct Member {
    peers: Vec<String>,
    window: (Instant, u32),
}

/// Who has voice on in this world and whom they are paired with.
#[derive(Debug, Default)]
pub struct Voice {
    members: HashMap<String, Member>,
}

impl Voice {
    pub fn peers_of(&self, id: &str) -> Option<&[String]> {
        self.members.get(id).map(|m| m.peers.as_slice())
    }

    fn allow(&mut self, id: &str, now: Instant) -> bool {
        let Some(m) = self.members.get_mut(id) else {
            return false;
        };
        if now.duration_since(m.window.0).as_secs_f32() >= 1.0 {
            m.window = (now, 0);
        }
        m.window.1 += 1;
        m.window.1 <= SIGNALS_PER_SECOND
    }

    pub fn leave(&mut self, id: &str) {
        self.members.remove(id);
    }
}

fn distance(a: [f32; 3], b: [f32; 3]) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

/// Pairings for players with voice on: `current` holds each one's present
/// peers (for [`VOICE_KEEP`]). Each picks the nearest others in range, at
/// most [`MAX_PEERS`]; a pair stands only when both pick each other. Peer
/// lists come sorted by id.
pub fn pairings(
    positions: &[(String, [f32; 3])],
    current: &HashMap<String, Vec<String>>,
) -> HashMap<String, Vec<String>> {
    let mut chosen: HashMap<&str, Vec<&str>> = HashMap::new();
    for (me, at) in positions {
        let mine = current.get(me);
        let mut near: Vec<(f32, &str)> = positions
            .iter()
            .filter(|(other, _)| other != me)
            .filter_map(|(other, there)| {
                let d = distance(*at, *there);
                let keep = mine.is_some_and(|p| p.contains(other));
                (d <= VOICE_RANGE || (keep && d <= VOICE_KEEP)).then_some((d, other.as_str()))
            })
            .collect();
        near.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(b.1)));
        near.truncate(MAX_PEERS);
        chosen.insert(me.as_str(), near.into_iter().map(|(_, id)| id).collect());
    }
    chosen
        .iter()
        .map(|(me, picks)| {
            let mut mutual: Vec<String> = picks
                .iter()
                .filter(|other| chosen.get(*other).is_some_and(|theirs| theirs.contains(me)))
                .map(|s| (*s).to_owned())
                .collect();
            mutual.sort();
            ((*me).to_owned(), mutual)
        })
        .collect()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Empty {}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SignalPayload {
    to: String,
    kind: String,
    data: Value,
}

pub(super) fn install(world: &mut World) {
    world.set_method_handle("platform.voice.join", |world, id, payload| {
        const INTENT: &str = "voice.join";
        if parse::<Empty>(world, id, INTENT, payload).is_none() {
            return;
        }
        let ice = {
            let mut g = world.ecs().write_resource::<Gameplay>();
            if !g.players.contains_key(id) {
                drop(g);
                return reply(world, id, INTENT, Err(IntentError::NoSession));
            }
            g.voice.members.entry(id.to_owned()).or_insert(Member {
                peers: Vec::new(),
                window: (Instant::now(), 0),
            });
            g.dimensions.voice_ice_servers.clone()
        };
        reply(
            world,
            id,
            INTENT,
            Ok(json!({ "ice_servers": *ice, "range": VOICE_RANGE })),
        );
    });

    world.set_method_handle("platform.voice.leave", |world, id, payload| {
        const INTENT: &str = "voice.leave";
        if parse::<Empty>(world, id, INTENT, payload).is_none() {
            return;
        }
        world.ecs().write_resource::<Gameplay>().voice.leave(id);
        reply(world, id, INTENT, Ok(json!({})));
    });

    world.set_method_handle("platform.voice.signal", |world, id, payload| {
        const INTENT: &str = "voice.signal";
        if payload.len() > MAX_SIGNAL_BYTES {
            return reply(world, id, INTENT, Err(IntentError::TooFast));
        }
        let Some(p) = parse::<SignalPayload>(world, id, INTENT, payload) else {
            return;
        };
        if !matches!(p.kind.as_str(), "offer" | "answer" | "ice") {
            return reply(world, id, INTENT, Err(IntentError::NothingThere));
        }
        let verdict = {
            let mut g = world.ecs().write_resource::<Gameplay>();
            let paired = g
                .voice
                .peers_of(id)
                .is_some_and(|peers| peers.contains(&p.to));
            if !paired {
                Err(IntentError::OutOfReach)
            } else if !g.voice.allow(id, Instant::now()) {
                Err(IntentError::TooFast)
            } else {
                Ok(())
            }
        };
        if let Err(e) = verdict {
            return reply(world, id, INTENT, Err(e));
        }
        world.events_mut().dispatch(
            Event::new(VOICE_SIGNAL_EVENT)
                .payload(json!({ "from": id, "kind": p.kind, "data": p.data }))
                .filter(ClientFilter::Direct(p.to))
                .build(),
        );
    });
}

/// Re-pairs players with voice on twice a second and tells those whose
/// peers changed.
#[derive(Default)]
pub struct VoiceSystem {
    since: f32,
    last: Option<Instant>,
}

impl<'a> specs::System<'a> for VoiceSystem {
    type SystemData = (
        specs::ReadExpect<'a, Clients>,
        specs::ReadStorage<'a, PositionComp>,
        specs::WriteExpect<'a, Gameplay>,
        specs::WriteExpect<'a, voxelize::Events>,
    );

    fn run(&mut self, (clients, positions, mut g, mut events): Self::SystemData) {
        let now = Instant::now();
        self.since += self
            .last
            .map(|l| now.duration_since(l).as_secs_f32())
            .unwrap_or(0.0);
        self.last = Some(now);
        if self.since < 0.5 || g.voice.members.is_empty() {
            return;
        }
        self.since = 0.0;
        // Gone players leave voice.
        g.voice.members.retain(|id, _| clients.contains_key(id));
        let here: Vec<(String, [f32; 3])> = g
            .voice
            .members
            .keys()
            .filter(|id| g.players.get(*id).is_some_and(|p| !p.travel.departed))
            .filter_map(|id| {
                let p = positions.get(clients.get(id)?.entity)?;
                Some((id.clone(), [p.0 .0, p.0 .1, p.0 .2]))
            })
            .collect();
        let current: HashMap<String, Vec<String>> = g
            .voice
            .members
            .iter()
            .map(|(id, m)| (id.clone(), m.peers.clone()))
            .collect();
        let next = pairings(&here, &current);
        for (id, member) in g.voice.members.iter_mut() {
            let peers = next.get(id).cloned().unwrap_or_default();
            if peers == member.peers {
                continue;
            }
            member.peers = peers;
            let list: Vec<Value> = member
                .peers
                .iter()
                .map(|p| json!({ "id": p, "name": clients.get(p).map(|c| c.username.clone()) }))
                .collect();
            events.dispatch(
                Event::new(VOICE_PEERS_EVENT)
                    .payload(json!({ "peers": list }))
                    .filter(ClientFilter::Direct(id.clone()))
                    .build(),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(id: &str, x: f32) -> (String, [f32; 3]) {
        (id.to_owned(), [x, 64.0, 0.0])
    }

    #[test]
    fn players_in_range_are_paired_both_ways() {
        let none = HashMap::new();
        let p = pairings(&[at("a", 0.0), at("b", 10.0), at("c", 60.0)], &none);
        assert_eq!(p["a"], vec!["b".to_owned()]);
        assert_eq!(p["b"], vec!["a".to_owned()]);
        assert!(p["c"].is_empty(), "too far");
    }

    #[test]
    fn pairs_hold_a_little_past_the_range() {
        let none = HashMap::new();
        let apart = [at("a", 0.0), at("b", 36.0)];
        assert!(
            pairings(&apart, &none)["a"].is_empty(),
            "never paired at 36"
        );
        let current = HashMap::from([
            ("a".to_owned(), vec!["b".to_owned()]),
            ("b".to_owned(), vec!["a".to_owned()]),
        ]);
        assert_eq!(
            pairings(&apart, &current)["a"],
            vec!["b".to_owned()],
            "kept until 40"
        );
        assert!(pairings(&[at("a", 0.0), at("b", 45.0)], &current)["a"].is_empty());
    }

    #[test]
    fn a_crowd_keeps_the_nearest_and_only_mutual_pairs() {
        // Ten players in a line one block apart: each keeps its eight nearest.
        let crowd: Vec<_> = (0..10).map(|i| at(&format!("p{i}"), i as f32)).collect();
        let p = pairings(&crowd, &HashMap::new());
        for (id, peers) in &p {
            assert!(peers.len() <= MAX_PEERS, "{id} has {}", peers.len());
            for other in peers {
                assert!(p[other].contains(id), "{id}-{other} is not mutual");
            }
        }
        // p0 picks p1..p8, but p8 has eight nearer neighbours (p1..p7, p9):
        // only mutual picks stand.
        assert!(!p["p0"].contains(&"p9".to_owned()));
        assert!(!p["p0"].contains(&"p8".to_owned()));
        assert!(p["p0"].contains(&"p1".to_owned()));
        assert!(p["p4"].len() == MAX_PEERS, "the middle is full");
    }

    #[test]
    fn signals_are_rate_limited() {
        let mut v = Voice::default();
        let t = Instant::now();
        assert!(!v.allow("a", t), "not in voice");
        v.members.insert(
            "a".into(),
            Member {
                peers: vec![],
                window: (t, 0),
            },
        );
        for _ in 0..SIGNALS_PER_SECOND {
            assert!(v.allow("a", t));
        }
        assert!(!v.allow("a", t));
        assert!(v.allow("a", t + std::time::Duration::from_millis(1100)));
    }
}
