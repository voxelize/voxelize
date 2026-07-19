//! Opt-in server-side lag-compensation for a Voxelize world.
//!
//! This module is a *generic engine capability* — it contains no game logic and
//! knows nothing about shots, projectiles, health bars, or any specific game.
//! It provides exactly two engine services and the primitives they are built
//! from:
//!
//! 1. **A per-world position-history ring** ([`PositionHistory`]) — records the
//!    pose of every rewind-eligible entity at the *start* of each fixed
//!    simulation tick, before the sim mutates positions, and answers the
//!    question "where was entity `E` at tick `T`?" cheaply. This is the net-new
//!    capability the deadline scheduler does not give for free.
//! 2. **Rewound spatial queries** ([`PositionHistory::resolve_ray_at_tick`],
//!    [`PositionHistory::resolve_volume_at_tick`]) — resolve a ray or a volume
//!    against the *historical* positions at an anchored tick, so an
//!    authoritative server can register a hit against where a target actually
//!    was at fire time (favor-the-shooter) rather than where it has since moved.
//!
//! Everything the caller needs to size and anchor a rewind is here too, and it
//! is all bounded and cheat-resistant by construction:
//!
//! - [`RttEwma`] — the server's own smoothed estimate of a client's round trip.
//!   The client never reports this; the server measures it.
//! - [`rewind_ticks`] — the server-side depth formula
//!   `clamp(round((rtt/2 + interp)/tickMs), 0, MAX)`.
//! - [`clamp_dly_ms`] — the *first* of the two clamps applied to the only value
//!   a client contributes (its reported render delay `dly`): clamp on receipt to
//!   `[floor, ceil]`. The *second* clamp (by the retained history window) is
//!   applied by [`LagComp::rewind_depth_for`] so a fabricated `dly` can never
//!   rewind past the ring or conjure an impossible hit.
//! - [`RewindAnchor`] — a fire-time anchor (`born_tick` + `lag_rewind`) whose
//!   effective rewind *decays one tick per tick* as time passes, so hitscan
//!   (resolved at fire time) takes full rewind while a slow projectile's rewind
//!   bleeds off as it travels.
//! - [`DamageGate`] — the single choke-point damage predicate every damage path
//!   must funnel through: a fraction-of-max-HP per-tick cap (survives damage
//!   retuning), spawn grace + break-on-first-hit spawn shield, post-hit invuln,
//!   and dash i-frames. Anti-instagib from day one.
//!
//! What is rewind-eligible, what a "shot" is, and every damage number are
//! **game code**. The engine only stores poses and answers rewound queries.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Default smoothing factor for the server's per-client RTT EWMA. Passed as a
/// constructor parameter to [`LagComp::new`] so it can be overridden per world;
/// this documented default is used by the world wiring. A moderate value tracks
/// genuine latency shifts without letting a single spiky sample swing the
/// rewind depth.
pub const DEFAULT_RTT_EWMA_ALPHA: f64 = 0.1;

/// Per-world knob enabling server-side lag-compensation. `None` on a
/// [`crate::WorldConfig`] (the default) means the world keeps no history ring
/// and pays nothing; `Some` opts the world into recording poses and answering
/// rewound queries. Requires the fixed-step tick (rewind is tick-anchored), so
/// `Some(..)` without a `fixed_timestep` is rejected at config-build time.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LagCompConfig {
    /// Target rewind window in milliseconds, e.g. `300` (~18 ticks @ 60Hz).
    /// The ring is sized from this and the sim rate, so the retained tick count
    /// follows the rate rather than being hard-coded. Must be > 0.
    pub window_ms: u32,

    /// Hard upper bound on rewind depth in ticks. Bounds the server-side depth
    /// formula (§2.3) independently of the window so a mis-sized window can
    /// never grant an unbounded rewind. Must be > 0.
    pub max_ticks: u32,

    /// Lower clamp (ms) applied to the client-reported render delay `dly` on
    /// receipt. The first of the two `dly` clamps.
    pub dly_floor_ms: u32,

    /// Upper clamp (ms) applied to the client-reported render delay `dly` on
    /// receipt. Must be `>= dly_floor_ms`.
    pub dly_ceil_ms: u32,
}

impl LagCompConfig {
    /// Validate the tunables. Called at world-config build time so a nonsense
    /// config fails loudly at startup rather than silently mis-sizing the ring.
    pub fn validate(&self) -> Result<(), String> {
        if self.window_ms == 0 {
            return Err("LagCompConfig.window_ms must be greater than 0".to_owned());
        }
        if self.max_ticks == 0 {
            return Err("LagCompConfig.max_ticks must be greater than 0".to_owned());
        }
        if self.dly_ceil_ms < self.dly_floor_ms {
            return Err("LagCompConfig.dly_ceil_ms must be >= dly_floor_ms".to_owned());
        }
        Ok(())
    }

    /// Ring capacity in ticks for a given sim rate. Sized from the ms window
    /// (`ceil(window_ms * hz / 1000)`), but never smaller than `max_ticks + 1`
    /// so the hard depth clamp can always be satisfied by a retained frame
    /// (rewinding by `d` ticks needs the frame `d` ticks back to still exist).
    pub fn capacity_ticks(&self, hz: u32) -> usize {
        let window_frames = ((self.window_ms as u64 * hz as u64) + 999) / 1000;
        let floor = self.max_ticks as u64 + 1;
        window_frames.max(floor).max(1) as usize
    }
}

/// A recorded pose: position plus a look direction (orientation as needed). The
/// engine stores whatever the recorder hands it; the meaning of the vectors is
/// the game's, not the engine's.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pose {
    /// World-space position at record time.
    pub position: [f32; 3],
    /// Look/orientation vector at record time.
    pub direction: [f32; 3],
}

impl Pose {
    /// A pose with position only; direction defaults to zero.
    pub fn at(position: [f32; 3]) -> Self {
        Self {
            position,
            direction: [0.0, 0.0, 0.0],
        }
    }
}

/// One slot of an entity's history ring.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Frame {
    tick: u64,
    pose: Pose,
    occupied: bool,
}

impl Frame {
    const EMPTY: Frame = Frame {
        tick: 0,
        pose: Pose {
            position: [0.0; 3],
            direction: [0.0; 3],
        },
        occupied: false,
    };
}

/// A single entity's fixed-capacity ring of past poses.
///
/// Recording is contiguous (once per tick while the entity is eligible), so a
/// tick maps directly to a slot via `tick % capacity`. Eviction is implicit:
/// the newest write to a slot overwrites the frame `capacity` ticks older. Every
/// read re-checks the stored tick, so a slot that has been overwritten (or was
/// never written for a gap tick) is reported as a miss rather than returning a
/// stale pose.
#[derive(Clone, Debug)]
struct EntityRing {
    frames: Vec<Frame>,
    newest_tick: Option<u64>,
    first_tick: Option<u64>,
}

impl EntityRing {
    fn new(capacity: usize) -> Self {
        Self {
            frames: vec![Frame::EMPTY; capacity.max(1)],
            newest_tick: None,
            first_tick: None,
        }
    }

    fn capacity(&self) -> usize {
        self.frames.len()
    }

    fn record(&mut self, tick: u64, pose: Pose) {
        let slot = (tick % self.capacity() as u64) as usize;
        self.frames[slot] = Frame {
            tick,
            pose,
            occupied: true,
        };
        self.newest_tick = Some(match self.newest_tick {
            Some(prev) => prev.max(tick),
            None => tick,
        });
        self.first_tick = Some(match self.first_tick {
            Some(prev) => prev.min(tick),
            None => tick,
        });
    }

    /// The oldest tick still retrievable: bounded below by the ring capacity and
    /// by the first tick ever recorded.
    fn oldest_retained_tick(&self) -> Option<u64> {
        let newest = self.newest_tick?;
        let first = self.first_tick?;
        let window_floor = newest.saturating_sub(self.capacity() as u64 - 1);
        Some(first.max(window_floor))
    }

    fn get(&self, tick: u64) -> Option<Pose> {
        let slot = (tick % self.capacity() as u64) as usize;
        let frame = self.frames[slot];
        if frame.occupied && frame.tick == tick {
            Some(frame.pose)
        } else {
            None
        }
    }
}

/// A hit resolved against historical positions: which entity, the tick its pose
/// was read from, and the distance along the query (ray parameter or center
/// distance).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RewindHit {
    pub entity: u64,
    pub tick: u64,
    pub distance: f32,
}

/// A ray for rewound resolution. `direction` need not be normalized; the
/// returned [`RewindHit::distance`] is in units of `direction`'s length.
#[derive(Clone, Copy, Debug)]
pub struct Ray {
    pub origin: [f32; 3],
    pub direction: [f32; 3],
}

/// The per-world position-history ring: a set of per-entity rings, all sharing
/// one capacity, plus the rewound spatial queries over them.
#[derive(Clone, Debug)]
pub struct PositionHistory {
    capacity: usize,
    rings: BTreeMap<u64, EntityRing>,
}

impl PositionHistory {
    /// Create a history ring with a fixed per-entity capacity in ticks.
    pub fn new(capacity_ticks: usize) -> Self {
        Self {
            capacity: capacity_ticks.max(1),
            rings: BTreeMap::new(),
        }
    }

    /// Per-entity ring capacity in ticks.
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// Record a pose for a rewind-eligible entity at `tick`. Called once per
    /// entity at the start of each fixed sim step, before the sim mutates
    /// positions.
    pub fn record(&mut self, entity: u64, tick: u64, pose: Pose) {
        let capacity = self.capacity;
        self.rings
            .entry(entity)
            .or_insert_with(|| EntityRing::new(capacity))
            .record(tick, pose);
    }

    /// Drop an entity's history entirely (e.g. it stopped being eligible or was
    /// removed). Keeps the ring set from growing without bound.
    pub fn forget(&mut self, entity: u64) {
        self.rings.remove(&entity);
    }

    /// The rewound pose of `entity` at `tick`, or `None` if that tick is no
    /// longer retained (evicted past the window) or the entity was never
    /// recorded there.
    pub fn pose_at(&self, entity: u64, tick: u64) -> Option<Pose> {
        self.rings.get(&entity)?.get(tick)
    }

    /// The greatest rewind depth (in ticks) that still lands on a retained
    /// frame for `entity` at `current_tick`. This is the *window* clamp — the
    /// second of the two `dly` clamps (§2.3). `0` if the entity is unknown.
    pub fn max_rewind_ticks(&self, entity: u64, current_tick: u64) -> u32 {
        let Some(ring) = self.rings.get(&entity) else {
            return 0;
        };
        let Some(oldest) = ring.oldest_retained_tick() else {
            return 0;
        };
        current_tick.saturating_sub(oldest).min(u32::MAX as u64) as u32
    }

    /// Resolve a ray against every recorded entity's pose at `tick`, treating
    /// each entity as an axis-aligned box of `half_extents` centered on its
    /// rewound position. Returns the nearest hit within `max_distance` (in units
    /// of `ray.direction`'s length), skipping `exclude` (typically the shooter).
    ///
    /// This is the engine's whole "hit" contribution: a spatial query against
    /// historical positions. It does not know what a shot is or what a hit
    /// means — only whether the ray crosses a box at tick `T`.
    pub fn resolve_ray_at_tick(
        &self,
        ray: &Ray,
        half_extents: [f32; 3],
        tick: u64,
        max_distance: f32,
        exclude: Option<u64>,
    ) -> Option<RewindHit> {
        let mut best: Option<RewindHit> = None;
        for (&entity, ring) in self.rings.iter() {
            if exclude == Some(entity) {
                continue;
            }
            let Some(pose) = ring.get(tick) else {
                continue;
            };
            let Some(distance) = ray_box_entry(ray, pose.position, half_extents) else {
                continue;
            };
            if distance < 0.0 || distance > max_distance {
                continue;
            }
            if best.map_or(true, |b| distance < b.distance) {
                best = Some(RewindHit {
                    entity,
                    tick,
                    distance,
                });
            }
        }
        best
    }

    /// Resolve a spherical volume (center + radius) against every recorded
    /// entity's pose at `tick`. Returns the nearest entity whose rewound
    /// position lies within `radius`, skipping `exclude`. Used for melee, where
    /// both actors are evaluated at the same anchored tick: the caller passes
    /// the attacker's swing-start position as `center` and this answers against
    /// the target's rewound position.
    pub fn resolve_volume_at_tick(
        &self,
        center: [f32; 3],
        radius: f32,
        tick: u64,
        exclude: Option<u64>,
    ) -> Option<RewindHit> {
        let radius_sq = radius * radius;
        let mut best: Option<RewindHit> = None;
        for (&entity, ring) in self.rings.iter() {
            if exclude == Some(entity) {
                continue;
            }
            let Some(pose) = ring.get(tick) else {
                continue;
            };
            let d_sq = distance_sq(center, pose.position);
            if d_sq > radius_sq {
                continue;
            }
            let distance = d_sq.sqrt();
            if best.map_or(true, |b| distance < b.distance) {
                best = Some(RewindHit {
                    entity,
                    tick,
                    distance,
                });
            }
        }
        best
    }
}

/// Slab-method ray/AABB intersection. Returns the ray parameter `t >= 0` at
/// which the ray first enters the box centered at `center` with the given
/// half-extents, or `None` if it misses. `t` is in units of `ray.direction`'s
/// length. If the origin is inside the box, returns `0.0`.
fn ray_box_entry(ray: &Ray, center: [f32; 3], half_extents: [f32; 3]) -> Option<f32> {
    let mut t_min = f32::NEG_INFINITY;
    let mut t_max = f32::INFINITY;
    for axis in 0..3 {
        let min = center[axis] - half_extents[axis];
        let max = center[axis] + half_extents[axis];
        let origin = ray.origin[axis];
        let dir = ray.direction[axis];
        if dir.abs() < f32::EPSILON {
            // Ray parallel to this slab: miss unless the origin is between the
            // planes.
            if origin < min || origin > max {
                return None;
            }
        } else {
            let inv = 1.0 / dir;
            let mut t1 = (min - origin) * inv;
            let mut t2 = (max - origin) * inv;
            if t1 > t2 {
                std::mem::swap(&mut t1, &mut t2);
            }
            t_min = t_min.max(t1);
            t_max = t_max.min(t2);
            if t_min > t_max {
                return None;
            }
        }
    }
    if t_max < 0.0 {
        return None;
    }
    Some(t_min.max(0.0))
}

fn distance_sq(a: [f32; 3], b: [f32; 3]) -> f32 {
    let dx = a[0] - b[0];
    let dy = a[1] - b[1];
    let dz = a[2] - b[2];
    dx * dx + dy * dy + dz * dz
}

/// The server's exponentially-weighted moving average of a client's measured
/// round-trip time, in milliseconds. This is the load-bearing anti-cheat input:
/// rewind depth is sized from *this* (server-measured), never from anything the
/// client asserts. Non-finite or negative samples are ignored.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RttEwma {
    alpha: f64,
    value_ms: Option<f64>,
}

impl RttEwma {
    /// Create a tracker with smoothing factor `alpha` in `(0, 1]` (higher =
    /// more responsive to the latest sample). Out-of-range alpha is clamped.
    pub fn new(alpha: f64) -> Self {
        Self {
            alpha: alpha.clamp(f64::MIN_POSITIVE, 1.0),
            value_ms: None,
        }
    }

    /// Fold a new RTT sample (ms) into the average. The first valid sample seeds
    /// the value directly.
    pub fn observe(&mut self, sample_ms: f64) {
        if !sample_ms.is_finite() || sample_ms < 0.0 {
            return;
        }
        self.value_ms = Some(match self.value_ms {
            Some(prev) => prev + self.alpha * (sample_ms - prev),
            None => sample_ms,
        });
    }

    /// The current estimate in ms (`0.0` before any sample).
    pub fn value_ms(&self) -> f64 {
        self.value_ms.unwrap_or(0.0)
    }
}

/// The server-side rewind-depth formula (§2.3):
/// `clamp(round((rtt/2 + interp) / tickMs), 0, max_ticks)`, in ticks.
///
/// `rtt_ms` is the server's EWMA round trip; `interp_ms` is the *already
/// receipt-clamped* client render delay ([`clamp_dly_ms`]); `tick_ms` is the
/// fixed step in ms. The result is still clamped a second time by the retained
/// window at query time ([`LagComp::rewind_depth_for`]).
pub fn rewind_ticks(rtt_ms: f64, interp_ms: f64, tick_ms: f64, max_ticks: u32) -> u32 {
    if !tick_ms.is_finite() || tick_ms <= 0.0 {
        return 0;
    }
    let rtt = if rtt_ms.is_finite() { rtt_ms.max(0.0) } else { 0.0 };
    let interp = if interp_ms.is_finite() {
        interp_ms.max(0.0)
    } else {
        0.0
    };
    let raw = ((rtt / 2.0 + interp) / tick_ms).round();
    if raw <= 0.0 {
        return 0;
    }
    (raw as u64).min(max_ticks as u64) as u32
}

/// The first `dly` clamp (§2.3): clamp a client-reported render delay to
/// `[floor_ms, ceil_ms]` on receipt. Non-finite input clamps to the floor. This
/// bounds the *only* value a client contributes to lag comp before it is used;
/// the window clamp then bounds it again.
pub fn clamp_dly_ms(reported_ms: f64, floor_ms: u32, ceil_ms: u32) -> f64 {
    let floor = floor_ms as f64;
    let ceil = (ceil_ms.max(floor_ms)) as f64;
    if !reported_ms.is_finite() {
        return floor;
    }
    reported_ms.clamp(floor, ceil)
}

/// A fire-time rewind anchor: the tick a shot was created and the rewind depth
/// to apply for the shooter who fired it (already double-clamped when built via
/// [`LagComp::anchor`]).
///
/// The effective rewind *decays one tick per tick* as the shot travels, so a
/// hitscan resolved at fire time takes the full rewind while a slow projectile's
/// rewind bleeds off — by the time it arrives the world has caught back up.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RewindAnchor {
    pub born_tick: u64,
    pub lag_rewind: u32,
}

impl RewindAnchor {
    /// Effective rewind at the tick the query is resolved. `resolve_tick ==
    /// born_tick` (hitscan) yields the full `lag_rewind`; each tick of travel
    /// bleeds off one tick of rewind, saturating at zero.
    pub fn effective_rewind(&self, resolve_tick: u64) -> u32 {
        let elapsed = resolve_tick.saturating_sub(self.born_tick);
        self.lag_rewind.saturating_sub(elapsed.min(u32::MAX as u64) as u32)
    }

    /// The historical tick to look up: `born_tick - effective_rewind`. As the
    /// rewind decays, the anchored tick advances back toward `born_tick`
    /// (real-time catch-up), never past it.
    pub fn anchored_tick(&self, resolve_tick: u64) -> u64 {
        self.born_tick
            .saturating_sub(self.effective_rewind(resolve_tick) as u64)
    }
}

/// The lag-compensation resource carried on an opted-in world: the config, the
/// derived tick length, the position-history ring, and the per-client server-
/// measured RTT trackers. This is the one place a game asks "how far do I rewind
/// this client's shot?" and "where was this target then?".
#[derive(Clone, Debug)]
pub struct LagComp {
    config: LagCompConfig,
    tick_ms: f64,
    rtt_alpha: f64,
    history: PositionHistory,
    rtt: BTreeMap<u64, RttEwma>,
}

impl LagComp {
    /// Build from a validated config and the sim rate `hz`. The ring capacity is
    /// derived from the ms window and the rate.
    pub fn new(config: LagCompConfig, hz: u32, rtt_alpha: f64) -> Self {
        Self {
            config,
            tick_ms: 1000.0 / hz.max(1) as f64,
            rtt_alpha,
            history: PositionHistory::new(config.capacity_ticks(hz)),
            rtt: BTreeMap::new(),
        }
    }

    /// The config this resource was built from.
    pub fn config(&self) -> LagCompConfig {
        self.config
    }

    /// Fixed step length in milliseconds.
    pub fn tick_ms(&self) -> f64 {
        self.tick_ms
    }

    /// The position-history ring (read-only).
    pub fn history(&self) -> &PositionHistory {
        &self.history
    }

    /// The position-history ring (mutable) — the recorder writes through this.
    pub fn history_mut(&mut self) -> &mut PositionHistory {
        &mut self.history
    }

    /// Fold a server-measured RTT sample (ms) for a client into its EWMA.
    pub fn observe_rtt(&mut self, client: u64, sample_ms: f64) {
        let alpha = self.rtt_alpha;
        self.rtt
            .entry(client)
            .or_insert_with(|| RttEwma::new(alpha))
            .observe(sample_ms);
    }

    /// The current server-side RTT estimate (ms) for a client (`0.0` if none).
    pub fn rtt_ms(&self, client: u64) -> f64 {
        self.rtt.get(&client).map_or(0.0, RttEwma::value_ms)
    }

    /// Drop a client's RTT tracker (on disconnect).
    pub fn forget_client(&mut self, client: u64) {
        self.rtt.remove(&client);
    }

    /// The fully clamped rewind depth for a shot: the server-side formula from
    /// the shooter's EWMA RTT and the *receipt-clamped* reported `dly`, then
    /// clamped again by the target's retained window. This is the whole §2.3
    /// double-clamp: a lying client can only mis-rewind its own shots within a
    /// bounded window and can never rewind past the ring.
    pub fn rewind_depth_for(
        &self,
        shooter: u64,
        target: u64,
        current_tick: u64,
        reported_dly_ms: f64,
    ) -> u32 {
        let interp = clamp_dly_ms(
            reported_dly_ms,
            self.config.dly_floor_ms,
            self.config.dly_ceil_ms,
        );
        let by_formula = rewind_ticks(
            self.rtt_ms(shooter),
            interp,
            self.tick_ms,
            self.config.max_ticks,
        );
        let by_window = self.history.max_rewind_ticks(target, current_tick);
        by_formula.min(by_window)
    }

    /// Build a fire-time anchor for a shot fired at `born_tick` by `shooter` at
    /// `target`, applying the double-clamped rewind depth.
    pub fn anchor(
        &self,
        shooter: u64,
        target: u64,
        born_tick: u64,
        reported_dly_ms: f64,
    ) -> RewindAnchor {
        RewindAnchor {
            born_tick,
            lag_rewind: self.rewind_depth_for(shooter, target, born_tick, reported_dly_ms),
        }
    }
}

/// The immutable damage rules a [`DamageGate`] enforces. All windows are in
/// ticks and the cap is a *fraction of max HP* so it survives damage retuning:
/// change any damage number and a single tick still cannot remove more than
/// `per_tick_cap_frac` of a target's max HP.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DamageRules {
    /// Maximum fraction of max HP any single tick may remove (e.g. `0.35`).
    pub per_tick_cap_frac: f32,
    /// Ticks of full invulnerability after (re)spawn.
    pub spawn_grace_ticks: u32,
    /// Ticks of invulnerability after taking a hit.
    pub post_hit_invuln_ticks: u32,
}

/// Why a damage attempt was blocked or capped, reported by the single predicate
/// so callers (and tests) can see exactly which guard fired.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DamageBlock {
    /// Within the post-(re)spawn grace window.
    SpawnGrace,
    /// The spawn shield absorbed the hit and is now broken.
    SpawnShieldBroken,
    /// Within the post-hit invulnerability window.
    PostHitInvuln,
    /// Within a dash i-frame window.
    DashIFrame,
    /// The per-tick damage cap was already exhausted this tick.
    TickCapExhausted,
    /// The target is already at zero HP.
    Dead,
}

/// The outcome of a damage attempt through the single predicate.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum DamageOutcome {
    /// Damage applied; `amount` is what actually landed (possibly capped) and
    /// `remaining_hp` is the target's HP afterward.
    Applied { amount: f32, remaining_hp: f32 },
    /// No damage applied; `reason` says which guard fired.
    Blocked { reason: DamageBlock },
}

/// The per-target damage state the single predicate reads and updates. Engine-
/// generic: it is just HP plus the timing windows every guard needs. There is
/// deliberately no second way to mutate HP — all damage flows through
/// [`DamageGate::try_apply`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DamageState {
    pub max_hp: f32,
    pub hp: f32,
    /// Tick of the most recent (re)spawn.
    pub spawn_tick: u64,
    /// Whether the break-on-first-hit spawn shield is still up.
    pub spawn_shield_up: bool,
    /// Tick of the most recent hit taken (`None` if never hit).
    pub last_hit_tick: Option<u64>,
    /// Exclusive tick until which dash i-frames are active.
    pub dash_iframe_until_tick: u64,
    /// Damage accumulated within [`Self::accum_tick`], for the per-tick cap.
    accum_damage: f32,
    accum_tick: Option<u64>,
}

impl DamageState {
    /// A fresh, full-HP target spawned at `spawn_tick` with its shield up.
    pub fn spawn(max_hp: f32, spawn_tick: u64) -> Self {
        Self {
            max_hp,
            hp: max_hp,
            spawn_tick,
            spawn_shield_up: true,
            last_hit_tick: None,
            dash_iframe_until_tick: 0,
            accum_damage: 0.0,
            accum_tick: None,
        }
    }

    /// Re-arm the state as freshly (re)spawned: full HP, shield up, windows
    /// cleared.
    pub fn respawn(&mut self, spawn_tick: u64) {
        self.hp = self.max_hp;
        self.spawn_tick = spawn_tick;
        self.spawn_shield_up = true;
        self.last_hit_tick = None;
        self.dash_iframe_until_tick = 0;
        self.accum_damage = 0.0;
        self.accum_tick = None;
    }

    /// Open a dash i-frame window lasting `ticks` from `now` (exclusive end).
    pub fn start_dash_iframe(&mut self, now: u64, ticks: u32) {
        self.dash_iframe_until_tick = now.saturating_add(ticks as u64);
    }

    fn damage_this_tick(&self, tick: u64) -> f32 {
        if self.accum_tick == Some(tick) {
            self.accum_damage
        } else {
            0.0
        }
    }
}

/// The single choke-point damage predicate. Every damage path — hitscan,
/// projectile, melee, contact — must call [`Self::try_apply`]; there is no other
/// way to reduce HP. Each guard (spawn grace/shield, post-hit invuln, dash
/// i-frames, per-tick cap) is enforced here exactly once, so anti-instagib holds
/// no matter how many attackers cluster into one tick.
#[derive(Clone, Copy, Debug)]
pub struct DamageGate {
    rules: DamageRules,
}

impl DamageGate {
    pub fn new(rules: DamageRules) -> Self {
        Self { rules }
    }

    pub fn rules(&self) -> DamageRules {
        self.rules
    }

    /// Attempt to apply `amount` damage to `state` at `tick`. Returns whether it
    /// landed (and how much, after the per-tick cap) or which guard blocked it.
    /// `amount <= 0` is a no-op reported as `TickCapExhausted`-free `Applied {0}`.
    pub fn try_apply(&self, state: &mut DamageState, amount: f32, tick: u64) -> DamageOutcome {
        if state.hp <= 0.0 {
            return DamageOutcome::Blocked {
                reason: DamageBlock::Dead,
            };
        }

        // Spawn grace: full invulnerability for a brief window after (re)spawn.
        // The shield is untouched here — it exists to absorb the first hit of
        // real combat *after* grace, so it cannot be camped into active play.
        if tick < state.spawn_tick.saturating_add(self.rules.spawn_grace_ticks as u64) {
            return DamageOutcome::Blocked {
                reason: DamageBlock::SpawnGrace,
            };
        }

        // Spawn shield: absorbs the first hit after grace, then breaks.
        if state.spawn_shield_up {
            state.spawn_shield_up = false;
            return DamageOutcome::Blocked {
                reason: DamageBlock::SpawnShieldBroken,
            };
        }

        // Dash i-frames.
        if tick < state.dash_iframe_until_tick {
            return DamageOutcome::Blocked {
                reason: DamageBlock::DashIFrame,
            };
        }

        // Post-hit invulnerability. This is the *cross-tick* guard: a hit at
        // tick T grants invulnerability for the following ticks. Hits within the
        // same tick T are governed by the per-tick cap below, not blocked here —
        // the two guards compose (cap within a tick, invuln across ticks).
        if let Some(last) = state.last_hit_tick {
            if tick != last && tick < last.saturating_add(self.rules.post_hit_invuln_ticks as u64) {
                return DamageOutcome::Blocked {
                    reason: DamageBlock::PostHitInvuln,
                };
            }
        }

        if amount <= 0.0 {
            return DamageOutcome::Applied {
                amount: 0.0,
                remaining_hp: state.hp,
            };
        }

        // Per-tick cap, expressed as a fraction of max HP so it survives damage
        // retuning: the sum of all damage in a single tick cannot exceed it.
        let cap = (self.rules.per_tick_cap_frac.max(0.0) * state.max_hp).max(0.0);
        let already = state.damage_this_tick(tick);
        let remaining_cap = (cap - already).max(0.0);
        if remaining_cap <= 0.0 {
            return DamageOutcome::Blocked {
                reason: DamageBlock::TickCapExhausted,
            };
        }

        let applied = amount.min(remaining_cap).min(state.hp);
        state.hp -= applied;
        state.accum_tick = Some(tick);
        state.accum_damage = already + applied;
        state.last_hit_tick = Some(tick);

        DamageOutcome::Applied {
            amount: applied,
            remaining_hp: state.hp,
        }
    }
}

// __ENGINE_NEUTRAL_END__
//
// Nothing below is engine code. Tests may use std collections and the wall
// clock freely.

#[cfg(test)]
mod config_tests {
    use super::*;

    #[test]
    fn rejects_zero_window_and_zero_max_ticks() {
        assert!(LagCompConfig {
            window_ms: 0,
            max_ticks: 18,
            dly_floor_ms: 0,
            dly_ceil_ms: 250,
        }
        .validate()
        .is_err());
        assert!(LagCompConfig {
            window_ms: 300,
            max_ticks: 0,
            dly_floor_ms: 0,
            dly_ceil_ms: 250,
        }
        .validate()
        .is_err());
    }

    #[test]
    fn rejects_inverted_dly_clamp() {
        assert!(LagCompConfig {
            window_ms: 300,
            max_ticks: 18,
            dly_floor_ms: 250,
            dly_ceil_ms: 0,
        }
        .validate()
        .is_err());
    }

    #[test]
    fn capacity_follows_ms_window_at_rate() {
        let cfg = LagCompConfig {
            window_ms: 300,
            max_ticks: 18,
            dly_floor_ms: 0,
            dly_ceil_ms: 250,
        };
        // 300ms @ 60Hz => 18 frames; must retain at least max_ticks + 1.
        assert_eq!(cfg.capacity_ticks(60), 19);
        // Same time window at 20Hz => 6 frames, but max_ticks + 1 dominates.
        assert_eq!(cfg.capacity_ticks(20), 19);
    }
}

#[cfg(test)]
mod ring_tests {
    use super::*;

    fn pose(x: f32) -> Pose {
        Pose::at([x, 0.0, 0.0])
    }

    // §8.1 — ring records at tick start, honors capacity, evicts oldest, and
    // the newest slot is the last pre-mutation pose.
    #[test]
    fn records_evicts_and_keeps_newest() {
        let mut history = PositionHistory::new(4);
        for tick in 0..10u64 {
            history.record(1, tick, pose(tick as f32));
        }
        // Capacity 4 => only ticks 6..=9 retained.
        assert_eq!(history.pose_at(1, 9), Some(pose(9.0)));
        assert_eq!(history.pose_at(1, 6), Some(pose(6.0)));
        assert_eq!(history.pose_at(1, 5), None, "oldest evicted");
        assert_eq!(history.pose_at(1, 2), None, "long-evicted");
        // Newest slot reflects the last recorded (pre-mutation) pose.
        assert_eq!(history.pose_at(1, 9).unwrap().position[0], 9.0);
    }

    #[test]
    fn independent_entities_do_not_alias() {
        let mut history = PositionHistory::new(8);
        for tick in 0..8u64 {
            history.record(1, tick, pose(tick as f32));
            history.record(2, tick, pose(100.0 + tick as f32));
        }
        assert_eq!(history.pose_at(1, 5), Some(pose(5.0)));
        assert_eq!(history.pose_at(2, 5), Some(pose(105.0)));
    }

    #[test]
    fn gap_tick_is_a_miss_not_a_stale_pose() {
        // Record contiguously, skip a tick, keep going: the skipped tick must
        // read as a miss (never a stale slot from a wrapped-around tick).
        let mut history = PositionHistory::new(4);
        for tick in [0u64, 1, 2, /* skip 3 */ 4, 5, 6] {
            history.record(1, tick, pose(tick as f32));
        }
        assert_eq!(history.pose_at(1, 3), None);
        assert_eq!(history.pose_at(1, 4), Some(pose(4.0)));
    }
}

#[cfg(test)]
mod depth_tests {
    use super::*;

    fn cfg() -> LagCompConfig {
        LagCompConfig {
            window_ms: 300,
            max_ticks: 18,
            dly_floor_ms: 0,
            dly_ceil_ms: 250,
        }
    }

    // §8.2 — rewind depth never exceeds max_ticks or the oldest retained frame,
    // at any RTT.
    #[test]
    fn depth_clamps_to_max_ticks_at_any_rtt() {
        let tick_ms = 1000.0 / 60.0;
        for rtt in [0.0, 50.0, 200.0, 1000.0, 60_000.0, f64::INFINITY] {
            let ticks = rewind_ticks(rtt, 250.0, tick_ms, 18);
            assert!(ticks <= 18, "rtt={rtt} gave {ticks} > max");
        }
    }

    #[test]
    fn depth_clamps_to_window_when_ring_is_short() {
        let mut lag = LagComp::new(cfg(), 60, 0.2);
        // Only 5 ticks of history exist for the target so far.
        for tick in 0..5u64 {
            lag.history_mut().record(2, tick, Pose::at([0.0, 0.0, 0.0]));
        }
        lag.observe_rtt(1, 10_000.0); // absurd RTT
        let depth = lag.rewind_depth_for(1, 2, 4, 250.0);
        // current_tick 4, oldest retained tick 0 => window allows at most 4.
        assert!(depth <= 4, "window clamp failed: {depth}");
    }

    #[test]
    fn zero_rtt_zero_interp_is_zero_depth() {
        assert_eq!(rewind_ticks(0.0, 0.0, 1000.0 / 60.0, 18), 0);
    }

    // §8.3 — a fabricated `dly` is double-clamped and can never conjure an
    // impossible hit, nor affect other clients' shots.
    #[test]
    fn fabricated_dly_is_double_clamped_and_cannot_conjure_a_hit() {
        let mut lag = LagComp::new(cfg(), 60, 0.2);
        // Build a full window of history for the target at a fixed spot.
        let capacity = lag.history().capacity() as u64;
        for tick in 0..(capacity + 40) {
            lag.history_mut().record(2, tick, Pose::at([0.0, 0.0, 0.0]));
        }
        let current = capacity + 39;
        lag.observe_rtt(1, 40.0); // modest, honest RTT

        // Honest client.
        let honest = lag.rewind_depth_for(1, 2, current, 100.0);
        // Liar reports an absurd render delay.
        let liar = lag.rewind_depth_for(1, 2, current, 10_000_000.0);

        // Both are clamped to max_ticks; the liar cannot exceed the honest cap.
        assert!(liar <= cfg().max_ticks);
        assert!(honest <= cfg().max_ticks);
        assert!(liar <= cfg().max_ticks && liar >= honest);

        // The anchored tick the liar reaches is still inside the retained
        // window: it can never look up a frame that does not exist (no
        // impossible hit / no rewind past the ring).
        let anchor = lag.anchor(1, 2, current, 10_000_000.0);
        let anchored = anchor.anchored_tick(current);
        assert!(
            lag.history().pose_at(2, anchored).is_some(),
            "liar's anchored tick must resolve within the window, never past it"
        );

        // A different client's shot is computed from its own RTT and is
        // unaffected by client 1's lie.
        lag.observe_rtt(3, 8.0);
        let other = lag.rewind_depth_for(3, 2, current, 0.0);
        assert!(other <= cfg().max_ticks);
        assert_ne!(other, liar, "one client's lie must not change another's depth");
    }

    #[test]
    fn dly_receipt_clamp_bounds_reported_value() {
        assert_eq!(clamp_dly_ms(10_000.0, 0, 250), 250.0);
        assert_eq!(clamp_dly_ms(-5.0, 20, 250), 20.0);
        assert_eq!(clamp_dly_ms(f64::NAN, 20, 250), 20.0);
        assert_eq!(clamp_dly_ms(120.0, 0, 250), 120.0);
    }

    #[test]
    fn rtt_ewma_smooths_and_ignores_bad_samples() {
        let mut ewma = RttEwma::new(0.5);
        ewma.observe(100.0);
        assert!((ewma.value_ms() - 100.0).abs() < 1e-9);
        ewma.observe(200.0);
        assert!((ewma.value_ms() - 150.0).abs() < 1e-9);
        ewma.observe(f64::NAN);
        ewma.observe(-1.0);
        assert!((ewma.value_ms() - 150.0).abs() < 1e-9, "bad samples ignored");
    }
}

#[cfg(test)]
mod resolve_tests {
    use super::*;

    // §8.4 — favor-the-shooter: a shot fired at a target's past (rendered)
    // position registers a hit even though the target has since moved away.
    #[test]
    fn hit_resolves_against_historical_position() {
        let mut history = PositionHistory::new(32);
        // Target walks along +x, one block per tick.
        for tick in 0..20u64 {
            history.record(2, tick, Pose::at([tick as f32, 0.0, 0.0]));
        }
        // The shooter fired while the target was rendered at x=5 (tick 5), but
        // resolution happens "now" at tick 19 (target is at x=19).
        let anchor = RewindAnchor {
            born_tick: 19,
            lag_rewind: 14,
        }; // 19 - 14 = tick 5
        let anchored = anchor.anchored_tick(19);
        assert_eq!(anchored, 5);

        let ray = Ray {
            origin: [5.0, 0.0, -10.0],
            direction: [0.0, 0.0, 1.0],
        };
        let half = [0.5, 1.0, 0.5];

        // Rewound query hits the target where it was.
        let hit = history.resolve_ray_at_tick(&ray, half, anchored, 100.0, Some(1));
        assert!(hit.is_some(), "rewound shot must hit the past position");
        assert_eq!(hit.unwrap().entity, 2);

        // The same ray against the *current* tick misses (target moved to x=19).
        let now_miss = history.resolve_ray_at_tick(&ray, half, 19, 100.0, Some(1));
        assert!(now_miss.is_none(), "current-position resolve must miss");
    }

    #[test]
    fn resolve_skips_excluded_shooter() {
        let mut history = PositionHistory::new(8);
        history.record(1, 0, Pose::at([0.0, 0.0, 0.0]));
        let ray = Ray {
            origin: [0.0, 0.0, -5.0],
            direction: [0.0, 0.0, 1.0],
        };
        let hit = history.resolve_ray_at_tick(&ray, [1.0, 1.0, 1.0], 0, 100.0, Some(1));
        assert!(hit.is_none(), "the shooter must not hit itself");
    }

    #[test]
    fn resolve_picks_nearest_of_multiple() {
        let mut history = PositionHistory::new(8);
        history.record(2, 0, Pose::at([0.0, 0.0, 5.0]));
        history.record(3, 0, Pose::at([0.0, 0.0, 2.0]));
        let ray = Ray {
            origin: [0.0, 0.0, 0.0],
            direction: [0.0, 0.0, 1.0],
        };
        let hit = history
            .resolve_ray_at_tick(&ray, [0.5, 0.5, 0.5], 0, 100.0, None)
            .unwrap();
        assert_eq!(hit.entity, 3, "nearest target wins");
    }

    // §8.5 — rewind decay: hitscan takes full rewind; a slow projectile's
    // effective rewind decays one tick per tick of travel.
    #[test]
    fn hitscan_full_rewind_slow_projectile_decays() {
        let anchor = RewindAnchor {
            born_tick: 100,
            lag_rewind: 10,
        };
        // Hitscan: resolved at fire time => full rewind, anchored 100 - 10 = 90.
        assert_eq!(anchor.effective_rewind(100), 10);
        assert_eq!(anchor.anchored_tick(100), 90);
        // Slow projectile, 4 ticks of travel => rewind bled to 6, anchored 94.
        assert_eq!(anchor.effective_rewind(104), 6);
        assert_eq!(anchor.anchored_tick(104), 94);
        // Fully decayed after >= lag_rewind ticks => no rewind, anchored at
        // born tick (never past it).
        assert_eq!(anchor.effective_rewind(115), 0);
        assert_eq!(anchor.anchored_tick(115), 100);
        assert_eq!(anchor.anchored_tick(1_000), 100);
    }

    // §8.6 — melee evaluates both actors at the same anchored tick: attacker
    // swing-start pose vs the rewound target pose.
    #[test]
    fn melee_both_actors_at_fire_time() {
        let mut history = PositionHistory::new(32);
        // Attacker (id 1) and target (id 2) both historized.
        for tick in 0..20u64 {
            // Attacker lunges along +x.
            history.record(1, tick, Pose::at([tick as f32, 0.0, 0.0]));
            // Target flees along +x a bit ahead.
            history.record(2, tick, Pose::at([tick as f32 + 1.0, 0.0, 0.0]));
        }
        // Swing starts at tick 10; both are anchored to tick 10.
        let born = 10u64;
        let attacker_swing_pose = history.pose_at(1, born).unwrap();
        // Resolve the melee volume around the attacker's swing-start position
        // against the target's pose at the same tick.
        let hit = history.resolve_volume_at_tick(
            attacker_swing_pose.position,
            1.5,
            born,
            Some(1),
        );
        assert!(hit.is_some(), "reach at swing-start must connect");
        assert_eq!(hit.unwrap().entity, 2);

        // A reach that is too short at that same anchored tick misses — proving
        // both endpoints are the fire-time poses, not current ones.
        let short = history.resolve_volume_at_tick(
            attacker_swing_pose.position,
            0.5,
            born,
            Some(1),
        );
        assert!(short.is_none());
    }
}

#[cfg(test)]
mod damage_tests {
    use super::*;

    fn rules() -> DamageRules {
        DamageRules {
            per_tick_cap_frac: 0.35,
            spawn_grace_ticks: 6,
            post_hit_invuln_ticks: 6,
        }
    }

    // §8.7 — a clustered multi-attacker tick cannot remove more than the
    // fraction cap, and the cap holds after damage-number changes.
    #[test]
    fn per_tick_cap_survives_damage_retuning() {
        let gate = DamageGate::new(rules());
        // Past spawn grace so hits land.
        let tick = 100;
        for per_hit_damage in [10.0f32, 40.0, 999.0] {
            let mut state = DamageState::spawn(100.0, 0);
            // Five attackers all resolve into the same tick.
            let mut total_applied = 0.0;
            for _ in 0..5 {
                if let DamageOutcome::Applied { amount, .. } =
                    gate.try_apply(&mut state, per_hit_damage, tick)
                {
                    total_applied += amount;
                }
            }
            // No matter the per-hit damage number, one tick removes <= 35 HP.
            assert!(
                total_applied <= 35.0 + 1e-3,
                "cap breached with per_hit_damage={per_hit_damage}: {total_applied}"
            );
            assert!(state.hp >= 65.0 - 1e-3);
        }
    }

    #[test]
    fn cap_resets_next_tick() {
        let gate = DamageGate::new(rules());
        let mut state = DamageState::spawn(100.0, 0);
        state.spawn_shield_up = false;
        // Tick 100: exhaust the cap.
        let _ = gate.try_apply(&mut state, 999.0, 100);
        assert!((state.hp - 65.0).abs() < 1e-3);
        // Next tick (past post-hit invuln): cap refreshes.
        let _ = gate.try_apply(&mut state, 999.0, 110);
        assert!((state.hp - 30.0).abs() < 1e-3);
    }

    // §8.8 — i-frames, post-hit invuln and the spawn shield (break-on-first-hit)
    // all gate through the single predicate.
    #[test]
    fn spawn_grace_blocks_and_preserves_shield_for_real_combat() {
        let gate = DamageGate::new(rules());
        let mut state = DamageState::spawn(100.0, 0);
        // Within grace: blocked, no HP lost, and the shield survives (it defends
        // the first hit of real combat *after* grace).
        assert_eq!(
            gate.try_apply(&mut state, 50.0, 3),
            DamageOutcome::Blocked {
                reason: DamageBlock::SpawnGrace
            }
        );
        assert!(state.spawn_shield_up, "grace must not consume the shield");
        assert!((state.hp - 100.0).abs() < 1e-9, "no HP lost during grace");
    }

    #[test]
    fn shield_absorbs_first_post_grace_hit_then_breaks() {
        let gate = DamageGate::new(rules());
        let mut state = DamageState::spawn(100.0, 0);
        // First hit after grace: shield absorbs it and breaks (no HP lost).
        assert_eq!(
            gate.try_apply(&mut state, 20.0, 10),
            DamageOutcome::Blocked {
                reason: DamageBlock::SpawnShieldBroken
            }
        );
        assert!(!state.spawn_shield_up);
        assert!((state.hp - 100.0).abs() < 1e-9);
        // Next hit (past invuln) lands.
        let out = gate.try_apply(&mut state, 20.0, 20);
        assert!(matches!(out, DamageOutcome::Applied { .. }));
        assert!((state.hp - 80.0).abs() < 1e-3);
    }

    #[test]
    fn post_hit_invuln_blocks_rapid_followups() {
        let gate = DamageGate::new(rules());
        let mut state = DamageState::spawn(100.0, 0);
        state.spawn_shield_up = false; // ignore shield for this case
        let landed = gate.try_apply(&mut state, 10.0, 50);
        assert!(matches!(landed, DamageOutcome::Applied { .. }));
        // Within post_hit_invuln_ticks (6): blocked.
        assert_eq!(
            gate.try_apply(&mut state, 10.0, 53),
            DamageOutcome::Blocked {
                reason: DamageBlock::PostHitInvuln
            }
        );
        // After the window: lands again.
        assert!(matches!(
            gate.try_apply(&mut state, 10.0, 60),
            DamageOutcome::Applied { .. }
        ));
    }

    #[test]
    fn dash_iframe_blocks_through_the_gate() {
        let gate = DamageGate::new(rules());
        let mut state = DamageState::spawn(100.0, 0);
        state.spawn_shield_up = false;
        state.start_dash_iframe(50, 8); // i-frames [50, 58)
        assert_eq!(
            gate.try_apply(&mut state, 30.0, 52),
            DamageOutcome::Blocked {
                reason: DamageBlock::DashIFrame
            }
        );
        // After the dash window (and no prior hit to invuln): lands.
        assert!(matches!(
            gate.try_apply(&mut state, 30.0, 58),
            DamageOutcome::Applied { .. }
        ));
    }

    #[test]
    fn dead_target_takes_no_more_damage() {
        let gate = DamageGate::new(DamageRules {
            per_tick_cap_frac: 1.0,
            spawn_grace_ticks: 0,
            post_hit_invuln_ticks: 0,
        });
        let mut state = DamageState::spawn(30.0, 0);
        state.spawn_shield_up = false;
        let _ = gate.try_apply(&mut state, 30.0, 10);
        assert!(state.hp <= 0.0);
        assert_eq!(
            gate.try_apply(&mut state, 30.0, 11),
            DamageOutcome::Blocked {
                reason: DamageBlock::Dead
            }
        );
    }
}

/// Engine-neutral gate: this is a generic capability and must never name a game
/// concept. Scans the implementation region (before the marker); the test
/// modules below the marker are excluded so this gate does not flag its own
/// scenario vocabulary.
#[cfg(test)]
mod engine_neutral {
    #[test]
    fn module_names_no_game_concepts() {
        let src = include_str!("lag_comp.rs");
        let engine_code = src
            .split("// __ENGINE_NEUTRAL_END__")
            .next()
            .expect("marker present")
            .to_lowercase();
        for concept in [
            "nightfall",
            "zombie",
            "matchmaking",
            "wave",
            "room",
            "weapon",
        ] {
            assert!(
                !engine_code.contains(concept),
                "lag_comp must stay engine-neutral (found `{}`)",
                concept
            );
        }
    }
}
