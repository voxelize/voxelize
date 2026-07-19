//! Opt-in fixed-step deterministic simulation for a Voxelize world.
//!
//! This module is a *generic engine capability* — it contains no game logic.
//! It provides three orthogonal pieces that together let a world run a
//! reproducible simulation and be covered by golden desync tests:
//!
//! 1. [`FixedStepClock`] — the accumulator that decouples how *far* the sim
//!    advances (fixed [`FixedStepConfig::hz`] steps of exactly `DT = 1/hz`)
//!    from *when* the `Server` actor happens to deliver ticks. A stall batches
//!    steps; a bounded `max_catchup_steps` clamp drops backlog so a slow host
//!    never enters the "spiral of death". Sim time is `step_count * DT` — the
//!    wall clock never enters the sim.
//! 2. [`DetRng`] — a single seeded, deterministic PRNG (mulberry32) that is the
//!    sole source of randomness on the sim path. The seed is documented and
//!    carried in sim state; content sub-rolls derive from `seed ^ salt + floor`
//!    via [`DetRng::sub_stream`].
//! 3. [`check_protocol`] — the fail-closed, strict-equality join-time protocol
//!    assert. A deterministic sim makes a silently-skipped wire field
//!    catastrophic (it desyncs every downstream step), so a version mismatch
//!    refuses the client outright rather than letting it desync.
//!
//! Everything above the `// __SIM_PATH_END__` marker is the deterministic sim
//! path and is held to the determinism rules by `determinism_lint` below: no
//! wall clock, no unseeded RNG, no unordered-map iteration.

use serde::{Deserialize, Serialize};

/// Wire protocol version. Snapshot + delta replication and the deterministic
/// join handshake are pinned to this. Bump it in lockstep on client + server
/// whenever the wire shape or the deterministic sim contract changes; a
/// deterministic world rejects any client that does not match exactly.
pub const PROTOCOL_VERSION: u32 = 1;

/// WebSocket close code sent when a client is refused for a protocol mismatch.
/// In the 4000–4999 application range. The client treats it as terminal
/// (`client_outdated`): it never retries and never burns reconnect grace.
pub const PROTOCOL_MISMATCH_CLOSE_CODE: u16 = 4001;

/// Machine-readable reason attached to the terminal reject so the client can
/// distinguish an outdated build from a transient error.
pub const PROTOCOL_MISMATCH_REASON: &str = "client_outdated";

/// Per-world knob enabling the deterministic fixed-step tick. `None` on a
/// [`crate::WorldConfig`] (the default) means the world keeps today's exact
/// wall-clock cadence and pays nothing; `Some` opts the world into the
/// accumulator + determinism rules and makes it eligible for golden tests.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixedStepConfig {
    /// Simulation frequency in steps per second. `DT = 1 / hz`. Must be > 0.
    pub hz: u32,

    /// Upper bound on catch-up steps executed for a single delivered tick.
    /// After a stall the sim runs at most this many steps and drops the rest of
    /// the backlog, so catch-up can never cost more than it recovers. Must be
    /// > 0.
    pub max_catchup_steps: u32,

    /// Seed for the sim's single PRNG. Recorded by golden tests; identical
    /// seeds + identical inputs must produce byte-identical state every step.
    pub seed: u64,
}

impl FixedStepConfig {
    /// Fixed simulation timestep in seconds (`1 / hz`).
    pub fn dt_secs(&self) -> f64 {
        1.0 / self.hz as f64
    }

    /// Validate the tunables. Called at world-config build time so a nonsense
    /// config fails loudly at startup rather than dividing by zero mid-tick.
    pub fn validate(&self) -> Result<(), String> {
        if self.hz == 0 {
            return Err("FixedStepConfig.hz must be greater than 0".to_owned());
        }
        if self.max_catchup_steps == 0 {
            return Err("FixedStepConfig.max_catchup_steps must be greater than 0".to_owned());
        }
        Ok(())
    }
}

/// The result of intaking real elapsed time into the accumulator: how many
/// fixed steps to run this delivered tick, and whether the catch-up clamp
/// fired (backlog was dropped).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StepPlan {
    /// Number of `sim_step(DT)` calls the caller should execute now. In
    /// `0..=max_catchup_steps`.
    pub steps: u32,

    /// True when `steps == max_catchup_steps`, i.e. the accumulator was clamped
    /// and any remaining backlog was intentionally dropped.
    pub is_clamped: bool,
}

/// Fixed-timestep accumulator. Decouples sim advancement from wall-clock
/// delivery: real elapsed time is intaken, whole `DT` slices are peeled off as
/// steps (bounded by `max_catchup_steps`), and the leftover fraction becomes
/// `alpha` — a client render-interpolation factor that never feeds back into
/// the sim.
///
/// The clock is the sole time source for the sim: [`Self::sim_time_secs`] is
/// `step_count * DT`, computed purely from committed steps and never from the
/// wall clock.
#[derive(Clone, Debug)]
pub struct FixedStepClock {
    dt_secs: f64,
    max_catchup_steps: u32,
    accumulator: f64,
    step_count: u64,
    alpha: f64,
}

impl FixedStepClock {
    /// Create a clock from a validated config.
    pub fn new(config: &FixedStepConfig) -> Self {
        Self {
            dt_secs: config.dt_secs(),
            max_catchup_steps: config.max_catchup_steps,
            accumulator: 0.0,
            step_count: 0,
            alpha: 0.0,
        }
    }

    /// Intake wall-clock elapsed seconds and plan this tick's steps.
    ///
    /// Mirrors the design spec's accumulator exactly:
    ///
    /// ```text
    /// accumulator += real_elapsed
    /// while accumulator >= DT and steps < MAX_CATCHUP_STEPS:
    ///     accumulator -= DT; steps += 1
    /// if steps == MAX_CATCHUP_STEPS:            # clamp: no spiral of death
    ///     accumulator = min(accumulator, DT)    # drop backlog
    /// alpha = accumulator / DT
    /// ```
    ///
    /// Non-finite or non-positive elapsed values are ignored (a paused or
    /// backwards clock must not corrupt the accumulator). This method does not
    /// advance `step_count`; the caller commits each executed step via
    /// [`Self::commit_step`], so systems can read the correct per-step
    /// `sim_time`.
    pub fn intake(&mut self, real_elapsed_secs: f64) -> StepPlan {
        if real_elapsed_secs.is_finite() && real_elapsed_secs > 0.0 {
            self.accumulator += real_elapsed_secs;
        }

        let mut steps = 0u32;
        while self.accumulator >= self.dt_secs && steps < self.max_catchup_steps {
            self.accumulator -= self.dt_secs;
            steps += 1;
        }

        let is_clamped = steps == self.max_catchup_steps;
        if is_clamped {
            self.accumulator = self.accumulator.min(self.dt_secs);
        }

        self.alpha = self.accumulator / self.dt_secs;

        StepPlan { steps, is_clamped }
    }

    /// Commit one executed sim step, advancing the sole time source. Returns
    /// the new (1-based) step count.
    pub fn commit_step(&mut self) -> u64 {
        self.step_count += 1;
        self.step_count
    }

    /// Fixed timestep in seconds (`DT`).
    pub fn dt_secs(&self) -> f64 {
        self.dt_secs
    }

    /// Total committed sim steps. This, times `DT`, is sim time.
    pub fn step_count(&self) -> u64 {
        self.step_count
    }

    /// Sim time in seconds: `step_count * DT`. The only time the sim may read.
    pub fn sim_time_secs(&self) -> f64 {
        self.step_count as f64 * self.dt_secs
    }

    /// Render interpolation factor in `[0, 1]`: the fraction of a step the
    /// accumulator currently holds. A client-side render input only; it must
    /// never feed back into the sim.
    pub fn alpha(&self) -> f64 {
        self.alpha
    }
}

/// A single seeded, deterministic PRNG (mulberry32). This is the *only*
/// randomness allowed on the sim path — the server is the single roller, and
/// its state is carried in sim state so a replay from the same seed reproduces
/// every roll.
///
/// The generator matches the canonical 32-bit mulberry32 reference so the same
/// seed produces the same stream on the client (for pure cosmetic sinks) and
/// the server.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DetRng {
    state: u32,
}

impl DetRng {
    /// Seed the generator. The 64-bit seed is folded into mulberry32's 32-bit
    /// state deterministically (xor of the high and low halves), so the full
    /// `FixedStepConfig::seed` participates.
    pub fn from_seed(seed: u64) -> Self {
        Self {
            state: (seed ^ (seed >> 32)) as u32,
        }
    }

    /// Derive an independent sub-stream for a content roll. Following the spec,
    /// sub-rolls derive from `seed ^ salt + floor`, giving each content domain
    /// (and each floor/tier) its own reproducible stream without consuming the
    /// primary stream.
    pub fn sub_stream(seed: u64, salt: u64, floor: u64) -> Self {
        Self::from_seed((seed ^ salt).wrapping_add(floor))
    }

    /// Advance the state and return the next 32-bit value.
    pub fn next_u32(&mut self) -> u32 {
        self.state = self.state.wrapping_add(0x6D2B_79F5);
        let a = self.state;
        let mut t = (a ^ (a >> 15)).wrapping_mul(1 | a);
        t = (t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t))) ^ t;
        t ^ (t >> 14)
    }

    /// Next float in `[0, 1)`, matching the mulberry32 reference
    /// (`next_u32 / 2^32`).
    pub fn next_f64(&mut self) -> f64 {
        self.next_u32() as f64 / 4_294_967_296.0
    }

    /// Uniform integer in `[0, bound)` for `bound > 0`. Uses the modulo of a
    /// fresh draw; determinism, not bias-freeness, is the contract here.
    pub fn next_below(&mut self, bound: u32) -> u32 {
        debug_assert!(bound > 0, "DetRng::next_below requires bound > 0");
        self.next_u32() % bound
    }
}

/// Why a protocol handshake was refused. The engine turns this into a terminal
/// close ([`PROTOCOL_MISMATCH_CLOSE_CODE`]) so the client can treat it as
/// non-retryable.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProtocolReject {
    /// The client sent no protocol version. There is no `0`/missing bypass on
    /// the deterministic path.
    Missing,
    /// The client sent a version that is not exactly [`PROTOCOL_VERSION`].
    Mismatch { client: u32 },
}

impl ProtocolReject {
    /// Human- and machine-readable terminal message. Prefixed with
    /// [`PROTOCOL_MISMATCH_REASON`] so the client can key off it.
    pub fn message(&self) -> String {
        match self {
            ProtocolReject::Missing => format!(
                "{}: client sent no protocol version; server requires {}",
                PROTOCOL_MISMATCH_REASON, PROTOCOL_VERSION
            ),
            ProtocolReject::Mismatch { client } => format!(
                "{}: protocol {} != server {}",
                PROTOCOL_MISMATCH_REASON, client, PROTOCOL_VERSION
            ),
        }
    }
}

/// Fail-closed, strict-equality protocol assert for a deterministic world's
/// join. There is deliberately **no** `0`/missing bypass: an absent version is
/// a reject, not a pass. This is the load-bearing lesson of the motion field-5
/// silent-skip incident — never silently accept an unknown/absent field on the
/// deterministic path.
pub fn check_protocol(client_protocol: Option<u32>) -> Result<(), ProtocolReject> {
    match client_protocol {
        None => Err(ProtocolReject::Missing),
        Some(v) if v == PROTOCOL_VERSION => Ok(()),
        Some(client) => Err(ProtocolReject::Mismatch { client }),
    }
}

/// Deterministic sim state carried on an opted-in world as an ECS resource.
/// Bundles the authoritative clock and the single seeded roller so every
/// system on the sim path reads sim time and randomness from one place.
#[derive(Clone, Debug)]
pub struct FixedStepState {
    /// The authoritative accumulator / clock.
    pub clock: FixedStepClock,
    /// The single seeded PRNG for the sim.
    pub rng: DetRng,
    /// The config this state was built from (seed, hz, clamp).
    pub config: FixedStepConfig,
}

impl FixedStepState {
    /// Build sim state from a validated config.
    pub fn new(config: FixedStepConfig) -> Self {
        Self {
            clock: FixedStepClock::new(&config),
            rng: DetRng::from_seed(config.seed),
            config,
        }
    }
}

/// A cheap, copyable snapshot of the deterministic clock for observation /
/// replication sampling (see design §6: the snapshot accumulator samples the
/// sim clock). Contains only render/observability inputs, never anything the
/// sim reads back.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FixedStepSample {
    pub step_count: u64,
    pub sim_time_secs: f64,
    pub alpha: f64,
    pub dt_secs: f64,
}

// __SIM_PATH_END__
//
// Nothing below is on the deterministic sim path. Tests may use the wall clock,
// standard collections, and inline pattern strings freely.

#[cfg(test)]
mod accumulator_tests {
    use super::*;

    fn cfg(hz: u32, max_catchup_steps: u32) -> FixedStepConfig {
        FixedStepConfig {
            hz,
            max_catchup_steps,
            seed: 0,
        }
    }

    #[test]
    fn exact_dt_delivery_runs_one_step() {
        let mut clock = FixedStepClock::new(&cfg(60, 5));
        let dt = clock.dt_secs();
        let plan = clock.intake(dt);
        assert_eq!(plan.steps, 1);
        assert!(!plan.is_clamped);
        assert!(clock.alpha() < 1e-9, "alpha ~0 after exact consumption");
    }

    #[test]
    fn sub_dt_delivery_accrues_then_steps() {
        let mut clock = FixedStepClock::new(&cfg(60, 5));
        let dt = clock.dt_secs();
        let first = clock.intake(dt * 0.5);
        assert_eq!(first.steps, 0);
        assert!((clock.alpha() - 0.5).abs() < 1e-9);
        let second = clock.intake(dt * 0.5);
        assert_eq!(second.steps, 1);
        assert!(clock.alpha() < 1e-9);
    }

    #[test]
    fn alpha_is_leftover_fraction() {
        let mut clock = FixedStepClock::new(&cfg(60, 5));
        let dt = clock.dt_secs();
        let plan = clock.intake(dt * 1.5);
        assert_eq!(plan.steps, 1);
        assert!(!plan.is_clamped);
        assert!((clock.alpha() - 0.5).abs() < 1e-9);
    }

    #[test]
    fn long_delivery_is_bounded_by_max_catchup() {
        let mut clock = FixedStepClock::new(&cfg(60, 5));
        let dt = clock.dt_secs();
        // Ten steps' worth arrives in one delivery; only max=5 may run.
        let plan = clock.intake(dt * 10.0);
        assert_eq!(plan.steps, 5);
        assert!(plan.is_clamped, "hitting the max must report a clamp");
        // Backlog dropped: accumulator clamped to at most DT, so alpha <= 1.
        assert!(clock.alpha() <= 1.0 + 1e-9);
    }

    #[test]
    fn sustained_overload_never_spirals() {
        // Feed a huge elapsed every tick forever; the accumulator must stay
        // bounded (<= DT after each clamp) instead of growing without bound.
        let mut clock = FixedStepClock::new(&cfg(60, 5));
        let dt = clock.dt_secs();
        let mut total_steps = 0u64;
        for _ in 0..1000 {
            let plan = clock.intake(dt * 100.0);
            total_steps += plan.steps as u64;
            assert!(plan.steps <= 5);
            assert!(
                clock.alpha() <= 1.0 + 1e-9,
                "clamp keeps leftover within one DT"
            );
        }
        // 1000 ticks * at most 5 steps: never the ~100k an unclamped loop
        // would have attempted.
        assert_eq!(total_steps, 5000);
    }

    #[test]
    fn irregular_delivery_conserves_steps() {
        // Irregular real deltas summing to N*DT must yield about N steps over
        // time (no steps invented or lost beyond the sub-DT remainder), as
        // long as no single delivery exceeds the catch-up clamp.
        let mut clock = FixedStepClock::new(&cfg(60, 16));
        let dt = clock.dt_secs();
        let deltas = [
            dt * 0.2,
            dt * 2.7,
            dt * 0.1,
            dt * 1.0,
            dt * 3.3,
            dt * 0.4,
            dt * 0.3,
        ];
        let total: f64 = deltas.iter().sum();
        let mut steps = 0u64;
        for d in deltas {
            steps += clock.intake(d).steps as u64;
        }
        let expected_whole = total.div_euclid(dt) as u64;
        assert_eq!(steps, expected_whole);
    }

    #[test]
    fn negative_and_nonfinite_elapsed_ignored() {
        let mut clock = FixedStepClock::new(&cfg(60, 5));
        assert_eq!(clock.intake(-1.0).steps, 0);
        assert_eq!(clock.intake(f64::NAN).steps, 0);
        assert_eq!(clock.intake(f64::INFINITY).steps, 0);
        assert_eq!(clock.step_count(), 0);
    }

    #[test]
    fn sim_time_is_step_count_times_dt() {
        let mut clock = FixedStepClock::new(&cfg(50, 5));
        let dt = clock.dt_secs();
        for _ in 0..7 {
            clock.commit_step();
        }
        assert_eq!(clock.step_count(), 7);
        assert!((clock.sim_time_secs() - 7.0 * dt).abs() < 1e-12);
    }
}

#[cfg(test)]
mod rng_tests {
    use super::*;

    #[test]
    fn same_seed_same_stream() {
        let mut a = DetRng::from_seed(0xDEAD_BEEF);
        let mut b = DetRng::from_seed(0xDEAD_BEEF);
        for _ in 0..1000 {
            assert_eq!(a.next_u32(), b.next_u32());
        }
    }

    #[test]
    fn different_seed_diverges() {
        let mut a = DetRng::from_seed(1);
        let mut b = DetRng::from_seed(2);
        let a_seq: Vec<u32> = (0..8).map(|_| a.next_u32()).collect();
        let b_seq: Vec<u32> = (0..8).map(|_| b.next_u32()).collect();
        assert_ne!(a_seq, b_seq);
    }

    #[test]
    fn next_f64_in_unit_interval() {
        let mut r = DetRng::from_seed(42);
        for _ in 0..10_000 {
            let v = r.next_f64();
            assert!((0.0..1.0).contains(&v));
        }
    }

    #[test]
    fn sub_stream_is_reproducible_and_distinct() {
        let seed = 777;
        let mut s0 = DetRng::sub_stream(seed, 0xABCD, 0);
        let mut s0_again = DetRng::sub_stream(seed, 0xABCD, 0);
        let mut s1 = DetRng::sub_stream(seed, 0xABCD, 1);
        assert_eq!(s0.next_u32(), s0_again.next_u32());
        assert_ne!(
            DetRng::sub_stream(seed, 0xABCD, 0).next_u32(),
            s1.next_u32()
        );
    }

    #[test]
    fn mulberry32_matches_reference_vector() {
        // Reference values produced by the canonical mulberry32(seed=0)
        // JS implementation, first four u32 draws. Pins the algorithm so a
        // client cosmetic sink and the server sim agree bit-for-bit.
        let mut r = DetRng::from_seed(0);
        let got: Vec<u32> = (0..4).map(|_| r.next_u32()).collect();
        assert_eq!(got, vec![1_144_304_738, 1_416_247, 958_946_056, 627_933_444]);
    }
}

#[cfg(test)]
mod protocol_tests {
    use super::*;

    #[test]
    fn exact_match_accepts() {
        assert!(check_protocol(Some(PROTOCOL_VERSION)).is_ok());
    }

    #[test]
    fn missing_is_rejected_no_bypass() {
        assert_eq!(check_protocol(None), Err(ProtocolReject::Missing));
    }

    #[test]
    fn zero_is_rejected_no_bypass() {
        // The classic backdoor: treat 0 as "unset, allow". Forbidden here.
        assert_eq!(
            check_protocol(Some(0)),
            Err(ProtocolReject::Mismatch { client: 0 })
        );
    }

    #[test]
    fn newer_or_older_rejected() {
        assert_eq!(
            check_protocol(Some(PROTOCOL_VERSION + 1)),
            Err(ProtocolReject::Mismatch {
                client: PROTOCOL_VERSION + 1
            })
        );
    }

    #[test]
    fn reject_message_is_terminal_keyed() {
        assert!(ProtocolReject::Missing
            .message()
            .starts_with(PROTOCOL_MISMATCH_REASON));
        assert!(ProtocolReject::Mismatch { client: 9 }
            .message()
            .starts_with(PROTOCOL_MISMATCH_REASON));
    }
}

/// Determinism gate that runs in CI (via `cargo test`). Scans the sim-path
/// region of this file — everything before `// __SIM_PATH_END__` — and asserts
/// it is free of wall-clock reads, unseeded RNG, and unordered-map iteration.
/// The design forbids these on the sim path; this test is the enforcement.
#[cfg(test)]
mod determinism_lint {
    #[test]
    fn sim_path_has_no_wall_clock_unseeded_rng_or_unordered_maps() {
        let src = include_str!("fixed_step.rs");
        let sim_path = src
            .split("// __SIM_PATH_END__")
            .next()
            .expect("marker present");

        // Patterns are assembled at runtime so the literals do not appear in
        // the scanned region (which would make the test scan itself).
        let forbidden = [
            format!("{}::{}", "Instant", "now"),
            format!("{}", "SystemTime"),
            format!("{}::{}", "rand", "random"),
            format!("{}::{}", "rand", "thread_rng"),
            format!("{}.{}()", "Math", "random"),
            format!("{}<", "HashMap"),
            format!("{}<", "HashSet"),
        ];

        for pat in forbidden {
            assert!(
                !sim_path.contains(&pat),
                "sim path must not contain `{}` (determinism rule)",
                pat
            );
        }
    }

    #[test]
    fn module_is_engine_neutral() {
        // Engine-neutral gate: the deterministic tick is a generic capability
        // and must never name a game concept. Scans the implementation region
        // (before the sim-path marker); the test lists below are excluded so
        // this gate does not flag its own concept vocabulary.
        let src = include_str!("fixed_step.rs");
        let engine_code = src
            .split("// __SIM_PATH_END__")
            .next()
            .expect("marker present")
            .to_lowercase();
        for concept in ["nightfall", "matchmaking", "wave", "weapon", "enemy"] {
            assert!(
                !engine_code.contains(concept),
                "fixed_step must stay engine-neutral (found `{}`)",
                concept
            );
        }
    }
}

/// Golden desync test (design §5): record a run (seed + ordered per-step input
/// stream), replay it, and assert a byte-identical sim-state hash at every
/// step. This is the definition of "the sim is deterministic". The gate is
/// mastered across P = 1..N players + reconnect rebuild + same-seed replay.
///
/// The reference sim here is a genuine deterministic simulation built only from
/// the engine primitives ([`DetRng`], [`FixedStepClock`], ordered iteration,
/// fixed-point integer state) — not a mock. It exercises the exact rules a game
/// sim must follow so a green golden test proves the machinery, independent of
/// any game's systems.
#[cfg(test)]
mod golden_desync {
    use super::*;
    use std::collections::BTreeMap;

    /// Fixed-point scale: positions/velocities are integers in units of
    /// `1 / FP` blocks, so all math is exact and cross-platform (no float
    /// drift on the sim path).
    const FP: i64 = 1 << 16;

    /// A per-step input targeting one entity. The stream is ordered; the sim
    /// applies inputs in the exact recorded order.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    struct Input {
        entity: u32,
        impulse: [i64; 3],
    }

    /// One entity's authoritative state (fixed-point).
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    struct Body {
        pos: [i64; 3],
        vel: [i64; 3],
    }

    /// The whole reference world: entities in a `BTreeMap` for deterministic
    /// ordered iteration (never a `HashMap`), plus the fixed-step clock and the
    /// single seeded roller.
    struct RefSim {
        bodies: BTreeMap<u32, Body>,
        clock: FixedStepClock,
        rng: DetRng,
        gravity: i64,
    }

    impl RefSim {
        fn new(config: &FixedStepConfig, player_count: u32) -> Self {
            let mut bodies = BTreeMap::new();
            for id in 0..player_count {
                // Deterministic initial placement from the id alone.
                bodies.insert(
                    id,
                    Body {
                        pos: [id as i64 * FP, 4 * FP, id as i64 * FP],
                        vel: [0, 0, 0],
                    },
                );
            }
            Self {
                bodies,
                clock: FixedStepClock::new(config),
                rng: DetRng::from_seed(config.seed),
                gravity: FP / 32,
            }
        }

        /// Advance exactly one fixed step, applying the ordered input stream.
        fn step(&mut self, inputs: &[Input]) {
            let step_index = self.clock.commit_step();

            // Ordered iteration over entities: BTreeMap guarantees stable key
            // order, so the roll sequence is identical on every machine/run.
            for (&id, body) in self.bodies.iter_mut() {
                // A single seeded perturbation per entity per step, salted by
                // the entity id and floored by the step index — the spec's
                // `seed ^ salt + floor` sub-roll shape.
                let mut sub = DetRng::sub_stream(self.rng.next_u32() as u64, id as u64, step_index);
                let jitter = (sub.next_below(7) as i64) - 3;

                body.vel[1] -= self.gravity;
                body.vel[0] += jitter;

                body.pos[0] += body.vel[0];
                body.pos[1] += body.vel[1];
                body.pos[2] += body.vel[2];

                // Deterministic floor at y = 0.
                if body.pos[1] < 0 {
                    body.pos[1] = 0;
                    body.vel[1] = 0;
                }
            }

            // Apply the ordered input stream after integration.
            for input in inputs {
                if let Some(body) = self.bodies.get_mut(&input.entity) {
                    body.vel[0] += input.impulse[0];
                    body.vel[1] += input.impulse[1];
                    body.vel[2] += input.impulse[2];
                }
            }
        }

        /// Canonical serialization + hash: stable entity order, fixed field
        /// layout, little-endian. FNV-1a/64 over the exact bytes.
        fn state_hash(&self) -> u64 {
            let mut h: u64 = 0xcbf2_9ce4_8422_2325;
            let mut mix = |bytes: &[u8], h: &mut u64| {
                for &b in bytes {
                    *h ^= b as u64;
                    *h = h.wrapping_mul(0x0000_0100_0000_01b3);
                }
            };
            for (&id, body) in self.bodies.iter() {
                mix(&id.to_le_bytes(), &mut h);
                for c in body.pos {
                    mix(&c.to_le_bytes(), &mut h);
                }
                for c in body.vel {
                    mix(&c.to_le_bytes(), &mut h);
                }
            }
            h
        }
    }

    /// A recorded run: everything needed to reproduce it byte-for-byte.
    struct Recording {
        config: FixedStepConfig,
        player_count: u32,
        inputs: Vec<Vec<Input>>,
        hashes: Vec<u64>,
    }

    /// Generate a deterministic-but-varied ordered input stream for a run, so
    /// the test isn't just integrating zeros. Uses its own PRNG seeded from the
    /// sim seed so the *inputs* are reproducible too (they are recorded, but
    /// generating them deterministically keeps the test self-contained).
    fn make_inputs(config: &FixedStepConfig, player_count: u32, steps: usize) -> Vec<Vec<Input>> {
        let mut gen = DetRng::from_seed(config.seed ^ 0x1234_5678_9abc_def0);
        let mut per_step = Vec::with_capacity(steps);
        for _ in 0..steps {
            let mut this = Vec::new();
            for entity in 0..player_count {
                // Not every entity acts every step; ordering is preserved.
                if gen.next_below(2) == 0 {
                    this.push(Input {
                        entity,
                        impulse: [
                            (gen.next_below(9) as i64 - 4) * (FP / 8),
                            (gen.next_below(5) as i64) * (FP / 8),
                            (gen.next_below(9) as i64 - 4) * (FP / 8),
                        ],
                    });
                }
            }
            per_step.push(this);
        }
        per_step
    }

    fn record(config: FixedStepConfig, player_count: u32, steps: usize) -> Recording {
        let inputs = make_inputs(&config, player_count, steps);
        let mut sim = RefSim::new(&config, player_count);
        let mut hashes = Vec::with_capacity(steps);
        for step_inputs in &inputs {
            sim.step(step_inputs);
            hashes.push(sim.state_hash());
        }
        Recording {
            config,
            player_count,
            inputs,
            hashes,
        }
    }

    /// Replay a recording from its seed + inputs and assert byte-identical
    /// per-step hashes.
    fn assert_replay_identical(rec: &Recording) {
        let mut sim = RefSim::new(&rec.config, rec.player_count);
        for (i, step_inputs) in rec.inputs.iter().enumerate() {
            sim.step(step_inputs);
            assert_eq!(
                sim.state_hash(),
                rec.hashes[i],
                "replay diverged at step {} (P={})",
                i,
                rec.player_count
            );
        }
    }

    #[test]
    fn golden_mastered_across_p_1_to_n() {
        // P = 1..N players: each masters record -> replay byte-identical.
        for player_count in 1..=8u32 {
            let config = FixedStepConfig {
                hz: 60,
                max_catchup_steps: 5,
                seed: 0xA11CE ^ player_count as u64,
            };
            let rec = record(config, player_count, 240);
            assert_replay_identical(&rec);
        }
    }

    #[test]
    fn reconnect_rebuild_matches_at_every_step() {
        // A rejoining client rebuilds identical state from the recorded seed +
        // ordered inputs: rebuilding up to step K reproduces the original hash
        // at K, for every K.
        let config = FixedStepConfig {
            hz: 60,
            max_catchup_steps: 5,
            seed: 0xBEEF_CAFE,
        };
        let rec = record(config, 4, 180);

        for rejoin_at in [0usize, 1, 37, 90, 179] {
            let mut rebuilt = RefSim::new(&config, rec.player_count);
            for step in 0..=rejoin_at {
                rebuilt.step(&rec.inputs[step]);
            }
            assert_eq!(
                rebuilt.state_hash(),
                rec.hashes[rejoin_at],
                "reconnect rebuild mismatch at step {}",
                rejoin_at
            );
        }
    }

    #[test]
    fn same_seed_replay_is_identical_and_seed_matters() {
        let base = FixedStepConfig {
            hz: 60,
            max_catchup_steps: 5,
            seed: 12_345,
        };
        let a = record(base, 5, 120);
        let b = record(base, 5, 120);
        assert_eq!(a.hashes, b.hashes, "same seed must replay identically");

        let different = FixedStepConfig {
            seed: base.seed + 1,
            ..base
        };
        let c = record(different, 5, 120);
        assert_ne!(
            a.hashes.last(),
            c.hashes.last(),
            "a different seed must diverge (else the sim ignores its seed)"
        );
    }

    #[test]
    fn catchup_batching_does_not_change_sim_state() {
        // The sim advances by the same amount whether steps are delivered one
        // at a time or batched by the accumulator after a stall — the whole
        // point of the fixed step. We drive the *same* step count two ways and
        // require identical final hashes.
        let config = FixedStepConfig {
            hz: 60,
            max_catchup_steps: 16,
            seed: 0x5EED,
        };
        let inputs = make_inputs(&config, 3, 64);

        // Path A: exactly one step per delivered tick.
        let mut sim_a = RefSim::new(&config, 3);
        let mut clock_a = FixedStepClock::new(&config);
        let dt = clock_a.dt_secs();
        let mut idx_a = 0usize;
        while idx_a < inputs.len() {
            let plan = clock_a.intake(dt);
            for _ in 0..plan.steps {
                sim_a.step(&inputs[idx_a]);
                idx_a += 1;
                if idx_a >= inputs.len() {
                    break;
                }
            }
        }

        // Path B: a burst delivery worth several steps at once, then trickle.
        let mut sim_b = RefSim::new(&config, 3);
        let mut clock_b = FixedStepClock::new(&config);
        let mut idx_b = 0usize;
        let deliveries = [dt * 4.0, dt * 1.0, dt * 3.0, dt * 2.0];
        let mut d = 0usize;
        while idx_b < inputs.len() {
            let elapsed = deliveries[d % deliveries.len()];
            d += 1;
            let plan = clock_b.intake(elapsed);
            for _ in 0..plan.steps {
                sim_b.step(&inputs[idx_b]);
                idx_b += 1;
                if idx_b >= inputs.len() {
                    break;
                }
            }
        }

        assert_eq!(idx_a, inputs.len());
        assert_eq!(idx_b, inputs.len());
        assert_eq!(
            sim_a.state_hash(),
            sim_b.state_hash(),
            "batched catch-up must reach the same state as one-step delivery"
        );
    }
}
