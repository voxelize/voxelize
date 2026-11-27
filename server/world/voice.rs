//! Proximity voice: a client's encoded voice, relayed to the clients near it.
//!
//! A world turns it on by naming a range ([`WorldConfig::voice_range`]). A
//! client then uploads its microphone as `VOICE` messages, one encoded packet
//! (Opus) per [`crate::protocols::Voice`] frame, and the world hands each
//! frame to the clients whose body stands within that range of the speaker
//! (plus [`VOICE_RELAY_MARGIN`]), stamped with the speaker's id. The server
//! never decodes the audio: it decides who hears whom, which is the part a
//! client must not decide for itself (a modified client would otherwise
//! hear the whole world).
//!
//! Nothing reaches a client that did not ask for it. A `VOICE` message with
//! no frames carries the client's own state as JSON,
//! `{"mic": "off" | "muted" | "live", "deafened": bool, "ignored": [ids]}`:
//!
//! - `mic` is `off` until the client turns voice on. Only a `live` mic may
//!   send frames; `muted` listens without speaking.
//! - `deafened` stops delivery to this client while leaving its voice on.
//! - `ignored` names the speakers this client muted. Their frames are not
//!   sent to it at all, so a mute is kept by the server, not by the muted
//!   player's client and not by a local volume of zero.
//!
//! `mic` and `deafened` are replicated to peers as the `voice` metadata key
//! ([`VoiceStateComp`]), so a game can draw a muted or deafened mark on a
//! player; who is speaking needs no replication, because the frames
//! themselves say so to exactly the clients that hear them.
//!
//! Frames are an unreliable stream: they ride the WebRTC data channel when
//! the client has one (no retransmits, so a lost frame costs 20 ms of sound
//! instead of stalling everything behind it) and the WebSocket otherwise.
//! Inbound, they wait in [`InboundVoiceBuffer`] for the next tick instead of
//! the world's actor mailbox: fifty packets a second from each speaker would
//! fill a bounded mailbox during one long tick, and a full mailbox refuses
//! every other request the client makes.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use hashbrown::{HashMap, HashSet};
use log::warn;
use serde::{Deserialize, Serialize};
use specs::{Component, VecStorage, WorldExt};

use super::{ClientFilter, PositionComp, World, WorldConfig};
use crate::{protocols::Voice, LogRateLimiter, Message, MessageType};

/// The largest frame the world relays. An Opus packet holding one frame is
/// at most 1275 bytes (RFC 6716, section 3.2.1); anything larger is not one.
pub const VOICE_MAX_FRAME_BYTES: usize = 1275;

/// A speaker's allowance: this many frames at once, refilled at
/// [`VOICE_FRAMES_PER_SECOND`]. A 20 ms codec frame is 50 a second; the
/// headroom covers a client catching up after a stalled main thread.
pub const VOICE_FRAME_BURST: f64 = 40.0;
pub const VOICE_FRAMES_PER_SECOND: f64 = 60.0;

/// How far past [`WorldConfig::voice_range`] a frame is still delivered. The
/// range is where a listener's falloff reaches silence; the two ends know
/// each other's position a few ticks late, and a voice whose delivery
/// stopped exactly there would be cut off mid-fade for a listener walking
/// away.
pub const VOICE_RELAY_MARGIN: f32 = 4.0;

/// How many speakers one client may ignore. More than a world holds players;
/// a list longer than this is cut, not refused.
pub const VOICE_MAX_IGNORED: usize = 512;

/// Frames a client may have waiting for the next tick. At 20 ms a frame this
/// is 640 ms of sound: voice older than that is not worth relaying, so a
/// world that stalls longer drops the oldest.
pub const MAX_PENDING_VOICE_PER_CLIENT: usize = 32;

/// What a client's microphone is doing, as it told the world.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VoiceMic {
    /// Voice is off for this client: it neither sends nor receives.
    #[default]
    Off,
    /// Voice is on and the microphone is closed: it listens.
    Muted,
    /// Voice is on and the microphone may send.
    Live,
}

/// A client's voice state, replicated to its peers as the `voice` metadata
/// key (`{"mic": "live", "deafened": false}`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Component)]
#[storage(VecStorage)]
pub struct VoiceStateComp {
    pub mic: VoiceMic,
    pub deafened: bool,
}

impl VoiceStateComp {
    /// Whether frames are delivered to this client at all.
    pub fn is_listening(&self) -> bool {
        self.mic != VoiceMic::Off && !self.deafened
    }
}

/// The JSON a client sends in a frameless `VOICE` message.
#[derive(Deserialize, Default)]
#[serde(default)]
struct VoiceControl {
    mic: VoiceMic,
    deafened: bool,
    ignored: Vec<String>,
}

struct VoiceMember {
    state: VoiceStateComp,
    ignored: HashSet<String>,
    tokens: f64,
    refilled_at: Instant,
}

impl VoiceMember {
    fn new(now: Instant) -> Self {
        Self {
            state: VoiceStateComp::default(),
            ignored: HashSet::new(),
            tokens: VOICE_FRAME_BURST,
            refilled_at: now,
        }
    }

    /// Spends one frame of the allowance, or refuses when none is left.
    fn spend(&mut self, now: Instant) -> bool {
        let refilled = (self.tokens
            + now.duration_since(self.refilled_at).as_secs_f64() * VOICE_FRAMES_PER_SECOND)
            .min(VOICE_FRAME_BURST);
        self.refilled_at = now;
        if refilled < 1.0 {
            self.tokens = refilled;
            return false;
        }
        self.tokens = refilled - 1.0;
        true
    }
}

/// Why a frame was not relayed, for [`VoiceStats`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Refusal {
    /// The world has no voice range.
    VoiceOff,
    /// The sender never said its mic is live.
    MicNotLive,
    /// Empty without being an end mark, or larger than
    /// [`VOICE_MAX_FRAME_BYTES`].
    BadFrame,
    /// Over the sender's allowance.
    OverBudget,
    /// The game's guard refused the speaker.
    Guarded,
}

/// Counters of the world's voice relay since it started.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStats {
    /// Frames handed to at least one listener.
    pub relayed_frames: u64,
    /// Frame deliveries: one per frame per listener it went to.
    pub deliveries: u64,
    /// Encoded bytes relayed, counted once per frame.
    pub relayed_bytes: u64,
    /// Frames nobody was in range (or willing) to hear.
    pub unheard_frames: u64,
    /// Frames refused: voice off, mic not live, malformed, over budget, or
    /// refused by the game.
    pub refused_frames: u64,
}

/// World resource: every client's voice state and the relay's counters.
#[derive(Default)]
pub struct VoiceRoom {
    members: HashMap<String, VoiceMember>,
    stats: VoiceStats,
}

impl VoiceRoom {
    /// What `client_id` last told the world, if it ever did.
    pub fn state(&self, client_id: &str) -> Option<VoiceStateComp> {
        self.members.get(client_id).map(|member| member.state)
    }

    /// Whether `listener` asked not to hear `speaker`.
    pub fn is_ignoring(&self, listener: &str, speaker: &str) -> bool {
        self.members
            .get(listener)
            .is_some_and(|member| member.ignored.contains(speaker))
    }

    pub fn stats(&self) -> VoiceStats {
        self.stats
    }

    pub(crate) fn remove_client(&mut self, client_id: &str) {
        self.members.remove(client_id);
    }
}

/// A game's say over who may speak, set with [`World::set_voice_guard`].
pub(crate) struct VoiceGuard(pub(crate) Arc<dyn Fn(&World, &str) -> bool + Send + Sync>);

/// `VOICE` messages staged by the network layer for the world's next tick,
/// per client in arrival order (see the module docs for why they do not ride
/// the actor mailbox). It lives inside the world's
/// [`crate::InboundStateBuffer`], whose handle the server already holds, with
/// its own cap: voice can never push a position packet out, nor the other
/// way round.
#[derive(Default)]
pub struct InboundVoiceBuffer {
    pending: Mutex<InboundVoicePending>,
}

#[derive(Default)]
struct InboundVoicePending {
    per_client: HashMap<String, VecDeque<Message>>,
    dropped: u64,
}

impl InboundVoiceBuffer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Stage a `VOICE` message. Callable from any thread. Past
    /// [`MAX_PENDING_VOICE_PER_CLIENT`] the oldest waiting frames are dropped;
    /// a state message (no frames) is never the one dropped.
    pub fn push(&self, client_id: &str, message: Message) {
        let mut pending = self.pending.lock().unwrap();
        let pending = &mut *pending;
        let queue = pending.per_client.entry(client_id.to_owned()).or_default();
        if queue.len() >= MAX_PENDING_VOICE_PER_CLIENT {
            if let Some(oldest) = queue.iter().position(|queued| !queued.voices.is_empty()) {
                queue.remove(oldest);
                pending.dropped += 1;
            }
        }
        queue.push_back(message);
    }

    /// Take everything staged, grouped per client in arrival order.
    pub fn drain(&self) -> Vec<(String, VecDeque<Message>)> {
        let mut pending = self.pending.lock().unwrap();
        if pending.per_client.is_empty() {
            return Vec::new();
        }
        pending.per_client.drain().collect()
    }

    pub fn is_empty(&self) -> bool {
        self.pending.lock().unwrap().per_client.is_empty()
    }

    /// Messages dropped by the per-client cap since the last reset.
    pub fn dropped_total(&self) -> u64 {
        self.pending.lock().unwrap().dropped
    }

    pub fn remove_client(&self, client_id: &str) {
        self.pending.lock().unwrap().per_client.remove(client_id);
    }

    pub fn reset(&self) {
        let mut pending = self.pending.lock().unwrap();
        pending.per_client.clear();
        pending.dropped = 0;
    }
}

fn distance_squared(a: [f32; 3], b: [f32; 3]) -> f32 {
    let dx = a[0] - b[0];
    let dy = a[1] - b[1];
    let dz = a[2] - b[2];
    dx * dx + dy * dy + dz * dz
}

impl World {
    /// Puts a check in front of every speaker. The guard is handed the
    /// speaker's client id and returns whether their voice is relayed at
    /// all: a game uses it for the speakers its own rules silence (a hidden
    /// observer, a player a moderator muted). It runs on the world thread
    /// for each message of frames, so it must be cheap.
    pub fn set_voice_guard<F: Fn(&World, &str) -> bool + Send + Sync + 'static>(
        &mut self,
        guard: F,
    ) {
        self.ecs_mut().insert(VoiceGuard(Arc::new(guard)));
    }

    /// Turns voice on with a range in blocks, or off with `None`, on a world
    /// that is already built: for a game that sets many worlds up through
    /// one shared function instead of in each one's [`WorldConfig`]. The
    /// same rules as [`crate::WorldConfigBuilder::voice_range`] apply. Call
    /// it before clients join; they read the range from their INIT.
    pub fn set_voice_range(&mut self, voice_range: Option<f32>) {
        if let Some(range) = voice_range {
            assert!(
                range.is_finite() && range > 0.0,
                "Voice range must be positive and finite (or None for no voice)."
            );
            assert!(
                self.config()
                    .peer_visible_radius
                    .is_none_or(|peer_visible_radius| range <= peer_visible_radius),
                "Voice range must not exceed the peer visible radius."
            );
        }
        self.write_resource::<WorldConfig>().voice_range = voice_range;
    }

    /// What `client_id` last told the world about its voice.
    pub fn voice_state(&self, client_id: &str) -> Option<VoiceStateComp> {
        self.read_resource::<VoiceRoom>().state(client_id)
    }

    /// The relay's counters since the world started.
    pub fn voice_stats(&self) -> VoiceStats {
        self.read_resource::<VoiceRoom>().stats()
    }

    /// The clients that hear a speaker standing at `at`: every other client
    /// that is listening, did not ignore the speaker, and stands within
    /// `reach` blocks. Sorted, so the answer does not depend on map order.
    pub fn voice_listeners_near(&self, speaker_id: &str, at: [f32; 3], reach: f32) -> Vec<String> {
        let room = self.read_resource::<VoiceRoom>();
        let positions = self.read_component::<PositionComp>();
        let range_squared = reach * reach;
        let mut listeners: Vec<String> = self
            .clients()
            .iter()
            .filter(|(id, _)| id.as_str() != speaker_id)
            .filter(|(id, _)| {
                room.members.get(id.as_str()).is_some_and(|member| {
                    member.state.is_listening() && !member.ignored.contains(speaker_id)
                })
            })
            .filter(|(_, client)| {
                positions.get(client.entity).is_some_and(|position| {
                    let d2 = distance_squared(at, [position.0 .0, position.0 .1, position.0 .2]);
                    d2.is_finite() && d2 <= range_squared
                })
            })
            .map(|(id, _)| id.clone())
            .collect();
        listeners.sort_unstable();
        listeners
    }

    /// Handler for `VOICE` messages: a client's voice state when the message
    /// carries no frames, its frames to relay otherwise.
    pub(crate) fn on_voice(&mut self, client_id: &str, data: Message) {
        if data.voices.is_empty() {
            self.on_voice_state(client_id, &data.json);
            return;
        }

        let frame_count = data.voices.len() as u64;
        let refuse = |world: &mut World, why: Refusal| {
            world.write_resource::<VoiceRoom>().stats.refused_frames += frame_count;
            static REFUSAL_LOG: LogRateLimiter = LogRateLimiter::new();
            if let Some(suppressed) = REFUSAL_LOG.allow(5000) {
                warn!(
                    "[voice] refused {} frame(s) from {} in world {}: {:?}; nothing relayed \
                     (+{} similar refusal(s) suppressed)",
                    frame_count, client_id, world.name, why, suppressed
                );
            }
        };

        let Some(range) = self.config().voice_range else {
            return refuse(self, Refusal::VoiceOff);
        };
        let Some(entity) = self.clients().get(client_id).map(|client| client.entity) else {
            return;
        };
        let is_live = self
            .read_resource::<VoiceRoom>()
            .state(client_id)
            .is_some_and(|state| state.mic == VoiceMic::Live);
        if !is_live {
            return refuse(self, Refusal::MicNotLive);
        }
        let guard = self
            .ecs()
            .try_fetch::<VoiceGuard>()
            .map(|guard| guard.0.clone());
        if guard.is_some_and(|guard| !guard(self, client_id)) {
            return refuse(self, Refusal::Guarded);
        }

        let now = Instant::now();
        let mut frames: Vec<Voice> = Vec::with_capacity(data.voices.len());
        let mut refused_bad = 0u64;
        let mut refused_budget = 0u64;
        {
            let mut room = self.write_resource::<VoiceRoom>();
            let Some(member) = room.members.get_mut(client_id) else {
                return;
            };
            for frame in data.voices {
                // Only the end mark of an utterance may come without sound.
                let is_empty = frame.data.is_empty() && !frame.end;
                if is_empty || frame.data.len() > VOICE_MAX_FRAME_BYTES {
                    refused_bad += 1;
                } else if !member.spend(now) {
                    refused_budget += 1;
                } else {
                    frames.push(Voice {
                        sender: client_id.to_owned(),
                        ..frame
                    });
                }
            }
            room.stats.refused_frames += refused_bad + refused_budget;
        }
        if refused_bad + refused_budget > 0 {
            static DROP_LOG: LogRateLimiter = LogRateLimiter::new();
            if let Some(suppressed) = DROP_LOG.allow(5000) {
                warn!(
                    "[voice] dropped {} frame(s) from {} in world {}: {} empty or over {} bytes \
                     ({:?}), {} over {} a second ({:?}) (+{} similar line(s) suppressed)",
                    refused_bad + refused_budget,
                    client_id,
                    self.name,
                    refused_bad,
                    VOICE_MAX_FRAME_BYTES,
                    Refusal::BadFrame,
                    refused_budget,
                    VOICE_FRAMES_PER_SECOND,
                    Refusal::OverBudget,
                    suppressed
                );
            }
        }
        if frames.is_empty() {
            return;
        }

        let Some(at) = self
            .read_component::<PositionComp>()
            .get(entity)
            .map(|position| [position.0 .0, position.0 .1, position.0 .2])
        else {
            return;
        };
        let listeners = self.voice_listeners_near(client_id, at, range + VOICE_RELAY_MARGIN);

        {
            let mut room = self.write_resource::<VoiceRoom>();
            let relayed = frames.len() as u64;
            if listeners.is_empty() {
                room.stats.unheard_frames += relayed;
                return;
            }
            room.stats.relayed_frames += relayed;
            room.stats.deliveries += relayed * listeners.len() as u64;
            room.stats.relayed_bytes += frames.iter().map(|f| f.data.len() as u64).sum::<u64>();
        }

        let mut message = Message::new(&MessageType::Voice).build();
        message.voices = frames;
        self.broadcast(message, ClientFilter::Include(listeners));
    }

    /// Takes a client's voice state: remembers who it ignores, and puts its
    /// mic and deafened flags on its entity for the peers to see.
    fn on_voice_state(&mut self, client_id: &str, json: &str) {
        let Some(entity) = self.clients().get(client_id).map(|client| client.entity) else {
            return;
        };
        let Ok(control) = serde_json::from_str::<VoiceControl>(json) else {
            warn!(
                "[voice] ignored a malformed voice state from {} in world {}",
                client_id, self.name
            );
            return;
        };
        // A world without voice keeps every client off, whatever it claims.
        let state = if self.config().voice_range.is_some() {
            VoiceStateComp {
                mic: control.mic,
                deafened: control.deafened,
            }
        } else {
            VoiceStateComp::default()
        };
        {
            let mut room = self.write_resource::<VoiceRoom>();
            let member = room
                .members
                .entry(client_id.to_owned())
                .or_insert_with(|| VoiceMember::new(Instant::now()));
            member.state = state;
            member.ignored = control
                .ignored
                .into_iter()
                .take(VOICE_MAX_IGNORED)
                .collect();
        }
        let _ = self.write_component::<VoiceStateComp>().insert(entity, state);
    }

    /// Relay every `VOICE` message staged since the last call, in each
    /// client's arrival order.
    pub(crate) fn apply_inbound_voice(&mut self) {
        let staged = self.inbound_state.voice();
        if staged.is_empty() {
            return;
        }
        for (client_id, messages) in staged.drain() {
            for message in messages {
                self.on_voice(&client_id, message);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use specs::Builder;

    use super::*;
    use crate::{Client, CurrentChunkComp, MessageQueues, MetadataComp, Vec3, WsSender};

    const RANGE: f32 = 32.0;

    fn world(name: &str) -> World {
        World::new(
            name,
            &WorldConfig::new()
                .saving(false)
                .voice_range(Some(RANGE))
                .build(),
        )
    }

    fn add_client_at(world: &mut World, id: &str, at: [f32; 3]) -> specs::Entity {
        let entity = world
            .ecs_mut()
            .create_entity()
            .with(PositionComp(Vec3(at[0], at[1], at[2])))
            .with(CurrentChunkComp::default())
            .with(MetadataComp::default())
            .build();
        let (control, _) = tokio::sync::mpsc::unbounded_channel();
        let (bulk, _) = tokio::sync::mpsc::unbounded_channel();
        world.clients_mut().insert(
            id.to_owned(),
            Client {
                id: id.to_owned(),
                entity,
                username: id.to_owned(),
                sender: WsSender::new(control, bulk),
                motion_protocol: Default::default(),
            },
        );
        entity
    }

    fn say(world: &mut World, id: &str, json: &str) {
        world.on_voice(id, Message::new(&MessageType::Voice).json(json).build());
    }

    fn frame(seq: u32, bytes: usize) -> Voice {
        Voice {
            sender: String::new(),
            seq,
            data: vec![7; bytes],
            end: false,
        }
    }

    fn speak(world: &mut World, id: &str, frames: Vec<Voice>) {
        let mut message = Message::new(&MessageType::Voice).build();
        message.voices = frames;
        world.on_voice(id, message);
    }

    /// What the world queued for delivery: each message's frames and who gets it.
    fn relayed(world: &mut World) -> Vec<(Vec<Voice>, Vec<String>)> {
        world
            .write_resource::<MessageQueues>()
            .drain_prioritized()
            .into_iter()
            .filter(|(message, _)| message.r#type == MessageType::Voice as i32)
            .map(|(message, filter)| {
                let ClientFilter::Include(ids) = filter else {
                    panic!("voice is only ever sent to named listeners");
                };
                (message.voices, ids)
            })
            .collect()
    }

    /// A speaker at the origin with a live mic, and a listener `distance` away.
    fn pair(name: &str, distance: f32) -> World {
        let mut world = world(name);
        add_client_at(&mut world, "speaker", [0.0, 64.0, 0.0]);
        add_client_at(&mut world, "listener", [distance, 64.0, 0.0]);
        say(&mut world, "speaker", r#"{"mic":"live"}"#);
        say(&mut world, "listener", r#"{"mic":"muted"}"#);
        world
    }

    #[test]
    fn a_frame_reaches_the_listeners_in_range_and_nobody_else() {
        let mut world = pair("voice-range", 10.0);
        add_client_at(&mut world, "far", [RANGE + VOICE_RELAY_MARGIN + 0.5, 64.0, 0.0]);
        say(&mut world, "far", r#"{"mic":"live"}"#);
        // Just past where the falloff reaches silence: still delivered, so a
        // fade is never cut short.
        add_client_at(&mut world, "edge", [0.0, 64.0, RANGE + VOICE_RELAY_MARGIN]);
        say(&mut world, "edge", r#"{"mic":"live"}"#);

        speak(&mut world, "speaker", vec![frame(1, 60), frame(2, 61)]);

        let sent = relayed(&mut world);
        assert_eq!(sent.len(), 1, "one message carries the frames");
        let (frames, listeners) = &sent[0];
        assert_eq!(listeners, &["edge".to_owned(), "listener".to_owned()]);
        assert_eq!(
            frames.iter().map(|f| f.seq).collect::<Vec<_>>(),
            vec![1, 2],
            "frames keep their order and their numbers"
        );
        assert_eq!(frames[1].data.len(), 61);
        assert_eq!(
            world.voice_stats(),
            VoiceStats {
                relayed_frames: 2,
                deliveries: 4,
                relayed_bytes: 121,
                ..Default::default()
            }
        );
    }

    #[test]
    fn the_distance_is_measured_in_all_three_axes() {
        let mut world = world("voice-height");
        add_client_at(&mut world, "speaker", [0.0, 64.0, 0.0]);
        add_client_at(
            &mut world,
            "above",
            [0.0, 64.0 + RANGE + VOICE_RELAY_MARGIN + 0.5, 0.0],
        );
        say(&mut world, "speaker", r#"{"mic":"live"}"#);
        say(&mut world, "above", r#"{"mic":"muted"}"#);

        speak(&mut world, "speaker", vec![frame(1, 40)]);

        assert!(relayed(&mut world).is_empty(), "straight up is out of range too");
        assert_eq!(world.voice_stats().unheard_frames, 1);
    }

    #[test]
    fn the_server_stamps_the_speaker_whatever_the_frame_claims() {
        let mut world = pair("voice-forged", 5.0);

        speak(
            &mut world,
            "speaker",
            vec![Voice {
                sender: "listener".to_owned(),
                seq: 9,
                data: vec![1, 2, 3],
                end: true,
            }],
        );

        let sent = relayed(&mut world);
        assert_eq!(sent[0].0[0].sender, "speaker");
        assert!(sent[0].0[0].end, "the end mark is passed on");
    }

    #[test]
    fn a_client_that_never_turned_voice_on_is_sent_nothing() {
        let mut world = world("voice-opt-in");
        add_client_at(&mut world, "speaker", [0.0, 64.0, 0.0]);
        add_client_at(&mut world, "bystander", [2.0, 64.0, 0.0]);
        say(&mut world, "speaker", r#"{"mic":"live"}"#);

        speak(&mut world, "speaker", vec![frame(1, 40)]);

        assert!(relayed(&mut world).is_empty());
        assert_eq!(world.voice_state("bystander"), None);
    }

    #[test]
    fn a_speaker_is_never_sent_its_own_voice() {
        let mut world = world("voice-echo");
        add_client_at(&mut world, "speaker", [0.0, 64.0, 0.0]);
        say(&mut world, "speaker", r#"{"mic":"live"}"#);

        speak(&mut world, "speaker", vec![frame(1, 40)]);

        assert!(relayed(&mut world).is_empty());
    }

    #[test]
    fn an_ignored_speaker_is_not_delivered_to_the_one_who_ignored_them() {
        let mut world = pair("voice-ignore", 5.0);
        add_client_at(&mut world, "other", [3.0, 64.0, 0.0]);
        say(&mut world, "other", r#"{"mic":"muted"}"#);
        say(&mut world, "listener", r#"{"mic":"muted","ignored":["speaker"]}"#);

        speak(&mut world, "speaker", vec![frame(1, 40)]);
        assert_eq!(relayed(&mut world)[0].1, vec!["other".to_owned()]);
        assert!(world
            .read_resource::<VoiceRoom>()
            .is_ignoring("listener", "speaker"));

        // The list is the whole truth each time: leaving a name out lifts it.
        say(&mut world, "listener", r#"{"mic":"muted","ignored":[]}"#);
        speak(&mut world, "speaker", vec![frame(2, 40)]);
        assert_eq!(
            relayed(&mut world)[0].1,
            vec!["listener".to_owned(), "other".to_owned()]
        );
    }

    #[test]
    fn a_deafened_client_hears_nothing_and_its_peers_can_see_that() {
        let mut world = pair("voice-deafen", 5.0);
        say(&mut world, "listener", r#"{"mic":"muted","deafened":true}"#);

        speak(&mut world, "speaker", vec![frame(1, 40)]);

        assert!(relayed(&mut world).is_empty());
        let entity = world.clients().get("listener").unwrap().entity;
        assert_eq!(
            world.read_component::<VoiceStateComp>().get(entity),
            Some(&VoiceStateComp {
                mic: VoiceMic::Muted,
                deafened: true
            })
        );
        assert_eq!(
            serde_json::to_string(&world.voice_state("listener").unwrap()).unwrap(),
            r#"{"mic":"muted","deafened":true}"#,
            "the shape peers read from the `voice` metadata key"
        );
    }

    #[test]
    fn peers_are_told_a_clients_voice_state_only_once_it_has_one() {
        use crate::{ClientFlag, DirectionComp, NameComp, PeersMetaSystem};
        use specs::RunNow;

        let mut world = world("voice-peer-meta");
        let mut entities = Vec::new();
        for id in ["quiet", "muted"] {
            let entity = add_client_at(&mut world, id, [0.0, 64.0, 0.0]);
            let _ = world.write_component::<ClientFlag>().insert(entity, ClientFlag::default());
            let _ = world
                .write_component::<DirectionComp>()
                .insert(entity, DirectionComp::default());
            let _ = world.write_component::<NameComp>().insert(entity, NameComp::new(id));
            entities.push(entity);
        }
        say(&mut world, "muted", r#"{"mic":"muted","deafened":true}"#);

        PeersMetaSystem.run_now(world.ecs());

        let metadata = world.read_component::<MetadataComp>();
        assert_eq!(metadata.get(entities[0]).unwrap().map.get("voice"), None);
        assert_eq!(
            metadata.get(entities[1]).unwrap().map.get("voice"),
            Some(&serde_json::json!({ "mic": "muted", "deafened": true }))
        );
    }

    #[test]
    fn only_a_live_mic_may_send() {
        let mut world = pair("voice-mic", 5.0);

        say(&mut world, "speaker", r#"{"mic":"muted"}"#);
        speak(&mut world, "speaker", vec![frame(1, 40)]);
        assert!(relayed(&mut world).is_empty(), "a muted mic sends nothing");

        say(&mut world, "speaker", r#"{"mic":"off"}"#);
        speak(&mut world, "speaker", vec![frame(2, 40)]);
        assert!(relayed(&mut world).is_empty(), "nor does voice turned off");

        // The listener never said its mic is live either.
        speak(&mut world, "listener", vec![frame(3, 40)]);
        assert!(relayed(&mut world).is_empty());
        assert_eq!(world.voice_stats().refused_frames, 3);

        say(&mut world, "speaker", r#"{"mic":"live"}"#);
        speak(&mut world, "speaker", vec![frame(4, 40)]);
        assert_eq!(relayed(&mut world).len(), 1);
    }

    #[test]
    fn a_world_without_a_voice_range_relays_nothing_and_keeps_everyone_off() {
        let mut world = World::new("voice-off", &WorldConfig::new().saving(false).build());
        add_client_at(&mut world, "speaker", [0.0, 64.0, 0.0]);
        add_client_at(&mut world, "listener", [2.0, 64.0, 0.0]);
        say(&mut world, "speaker", r#"{"mic":"live"}"#);
        say(&mut world, "listener", r#"{"mic":"live"}"#);

        speak(&mut world, "speaker", vec![frame(1, 40)]);

        assert!(relayed(&mut world).is_empty());
        assert_eq!(
            world.voice_state("speaker"),
            Some(VoiceStateComp::default()),
            "a claim of a live mic is not believed where there is no voice"
        );
    }

    #[test]
    fn empty_and_oversized_frames_are_dropped_and_the_rest_go_out() {
        let mut world = pair("voice-size", 5.0);

        speak(
            &mut world,
            "speaker",
            vec![
                frame(1, 0),
                frame(2, VOICE_MAX_FRAME_BYTES),
                frame(3, VOICE_MAX_FRAME_BYTES + 1),
            ],
        );

        let sent = relayed(&mut world);
        assert_eq!(sent[0].0.iter().map(|f| f.seq).collect::<Vec<_>>(), vec![2]);
        assert_eq!(world.voice_stats().refused_frames, 2);
    }

    #[test]
    fn the_end_of_an_utterance_is_relayed_without_sound() {
        let mut world = pair("voice-end", 5.0);

        speak(
            &mut world,
            "speaker",
            vec![
                frame(1, 40),
                Voice {
                    sender: String::new(),
                    seq: 2,
                    data: Vec::new(),
                    end: true,
                },
            ],
        );

        let sent = relayed(&mut world);
        let frames = &sent[0].0;
        assert_eq!(frames.len(), 2);
        assert!(frames[1].end && frames[1].data.is_empty());
        assert_eq!(world.voice_stats().refused_frames, 0);
    }

    #[test]
    fn a_flood_of_frames_is_cut_at_the_allowance() {
        let mut world = pair("voice-flood", 5.0);

        speak(&mut world, "speaker", (0..500).map(|seq| frame(seq, 40)).collect());

        let sent: usize = relayed(&mut world).iter().map(|(f, _)| f.len()).sum();
        assert!(
            sent as f64 >= VOICE_FRAME_BURST && sent as f64 <= VOICE_FRAME_BURST + 2.0,
            "{sent} of 500 frames went out"
        );
    }

    #[test]
    fn the_allowance_refills_at_the_frame_rate() {
        let start = Instant::now();
        let mut member = VoiceMember::new(start);
        let spent = (0..100).filter(|_| member.spend(start)).count();
        assert_eq!(spent as f64, VOICE_FRAME_BURST);

        let later = start + Duration::from_millis(500);
        let refilled = (0..100).filter(|_| member.spend(later)).count();
        assert_eq!(refilled as f64, VOICE_FRAMES_PER_SECOND / 2.0);

        // A real stream, one frame every 20 ms, never runs dry.
        let mut member = VoiceMember::new(start);
        assert!((0..500).all(|i| member.spend(start + Duration::from_millis(20 * i))));
    }

    #[test]
    fn the_games_guard_silences_a_speaker() {
        let mut world = pair("voice-guard", 5.0);
        world.set_voice_guard(|_, speaker| speaker != "speaker");

        speak(&mut world, "speaker", vec![frame(1, 40)]);
        assert!(relayed(&mut world).is_empty());

        say(&mut world, "listener", r#"{"mic":"live"}"#);
        say(&mut world, "speaker", r#"{"mic":"muted"}"#);
        speak(&mut world, "listener", vec![frame(1, 40)]);
        assert_eq!(relayed(&mut world).len(), 1, "everyone else still speaks");
    }

    #[test]
    fn a_malformed_state_changes_nothing() {
        let mut world = pair("voice-malformed", 5.0);

        say(&mut world, "speaker", "not json");
        say(&mut world, "speaker", r#"{"mic":"shouting"}"#);

        assert_eq!(
            world.voice_state("speaker").map(|state| state.mic),
            Some(VoiceMic::Live)
        );
    }

    #[test]
    fn a_long_ignore_list_is_cut_not_refused() {
        let mut world = pair("voice-ignore-cap", 5.0);
        let ids: Vec<String> = (0..VOICE_MAX_IGNORED + 50).map(|i| format!("p{i}")).collect();
        let json = serde_json::json!({ "mic": "muted", "ignored": ids }).to_string();

        say(&mut world, "listener", &json);

        let room = world.read_resource::<VoiceRoom>();
        assert_eq!(room.members["listener"].ignored.len(), VOICE_MAX_IGNORED);
        assert_eq!(room.state("listener").map(|s| s.mic), Some(VoiceMic::Muted));
    }

    #[test]
    fn a_client_that_left_is_forgotten() {
        let mut world = pair("voice-leave", 5.0);
        world.write_resource::<VoiceRoom>().remove_client("listener");

        speak(&mut world, "speaker", vec![frame(1, 40)]);

        assert!(relayed(&mut world).is_empty());
        assert_eq!(world.voice_state("listener"), None);
    }

    #[test]
    fn staged_voice_is_relayed_at_the_next_tick_start_in_arrival_order() {
        let mut world = world("voice-staged");
        add_client_at(&mut world, "speaker", [0.0, 64.0, 0.0]);
        add_client_at(&mut world, "listener", [4.0, 64.0, 0.0]);
        let staged = world.inbound_state_handle();

        // The state and the frames it allows arrive between two ticks.
        staged.voice().push(
            "listener",
            Message::new(&MessageType::Voice).json(r#"{"mic":"muted"}"#).build(),
        );
        staged.voice().push(
            "speaker",
            Message::new(&MessageType::Voice).json(r#"{"mic":"live"}"#).build(),
        );
        for seq in 1..=3 {
            let mut message = Message::new(&MessageType::Voice).build();
            message.voices = vec![frame(seq, 40)];
            staged.voice().push("speaker", message);
        }
        assert!(relayed(&mut world).is_empty(), "nothing moves before the tick");

        world.apply_inbound_voice();

        let seqs: Vec<u32> = relayed(&mut world)
            .iter()
            .flat_map(|(frames, _)| frames.iter().map(|f| f.seq))
            .collect();
        assert_eq!(seqs, vec![1, 2, 3]);
        assert!(staged.voice().is_empty());
    }

    #[test]
    fn a_stalled_world_drops_the_oldest_frames_and_never_the_state() {
        let buffer = InboundVoiceBuffer::new();
        buffer.push(
            "speaker",
            Message::new(&MessageType::Voice).json(r#"{"mic":"live"}"#).build(),
        );
        for seq in 0..(MAX_PENDING_VOICE_PER_CLIENT as u32 + 10) {
            let mut message = Message::new(&MessageType::Voice).build();
            message.voices = vec![frame(seq, 40)];
            buffer.push("speaker", message);
        }

        assert_eq!(buffer.dropped_total(), 11);
        let (_, queue) = buffer.drain().pop().unwrap();
        assert_eq!(queue.len(), MAX_PENDING_VOICE_PER_CLIENT);
        assert!(queue[0].voices.is_empty(), "the state message is still first");
        assert_eq!(queue[1].voices[0].seq, 11, "the oldest frames went");
        assert_eq!(
            queue.back().unwrap().voices[0].seq,
            MAX_PENDING_VOICE_PER_CLIENT as u32 + 9
        );
    }

    #[test]
    fn a_built_world_can_be_given_its_voice_range_afterwards() {
        let mut world = World::new("voice-late", &WorldConfig::new().saving(false).build());
        add_client_at(&mut world, "speaker", [0.0, 64.0, 0.0]);
        add_client_at(&mut world, "listener", [5.0, 64.0, 0.0]);

        world.set_voice_range(Some(16.0));
        assert_eq!(world.config().voice_range, Some(16.0));
        say(&mut world, "speaker", r#"{"mic":"live"}"#);
        say(&mut world, "listener", r#"{"mic":"muted"}"#);
        speak(&mut world, "speaker", vec![frame(1, 40)]);
        assert_eq!(relayed(&mut world).len(), 1);

        world.set_voice_range(None);
        speak(&mut world, "speaker", vec![frame(2, 40)]);
        assert!(relayed(&mut world).is_empty());
    }

    #[test]
    fn a_voice_range_must_be_positive_and_inside_the_peer_radius() {
        let build = |range: f32, peers: Option<f32>| {
            std::panic::catch_unwind(|| {
                WorldConfig::new()
                    .saving(false)
                    .peer_visible_radius(peers)
                    .voice_range(Some(range))
                    .build()
                    .voice_range
            })
        };
        assert_eq!(build(24.0, None).ok(), Some(Some(24.0)));
        assert_eq!(build(24.0, Some(64.0)).ok(), Some(Some(24.0)));
        assert!(build(0.0, None).is_err());
        assert!(build(f32::NAN, None).is_err());
        assert!(build(80.0, Some(64.0)).is_err(), "a voice with no body to come from");
    }
}
