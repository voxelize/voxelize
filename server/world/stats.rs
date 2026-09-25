use std::{
    fs,
    io::Write,
    path::PathBuf,
    time::{Duration, Instant, SystemTime},
};

use log::{info, warn};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StatsJson {
    pub tick: u64,
    pub time: f32,
    pub delta: f32,
    /// Days completed since the world's clock began. Absent from stats files
    /// written before it existed, which count as day zero.
    #[serde(default)]
    pub day: u64,
}

/// A general statistical manager of Voxelize.
pub struct Stats {
    /// The time this server started.
    pub start_time: Instant,

    /// Delta time of the voxelize world, in seconds.
    pub delta: f32,

    /// Tick of the game
    pub tick: u64,

    /// Monotonic dispatch counter. Unlike `tick`, this advances every
    /// dispatch UNCONDITIONALLY (even when `does_tick_time` is false and the
    /// game tick is frozen). Used solely for networking bookkeeping
    /// (keep-alive cadence and outbound message tick stamps); it is NOT
    /// persisted and is NOT part of game time.
    pub dispatch_count: u64,

    /// A number between 0 to config.time_per_day
    pub time: f32,

    /// How many times `time` has wrapped past `time_per_day`. Together they
    /// give clients a clock that never runs backwards, which is what lets
    /// every client agree on cosmetic motion that must look the same to all
    /// of them: cloud drift, shooting stars, a moon phase. `set_time` moves
    /// `time` alone, so a `/time` jump is a jump within the current day.
    pub day: u64,

    /// The time of the last tick.
    pub prev_time: SystemTime,

    /// Whether the world is currently preloading chunks.
    pub preloading: bool,

    /// How many world steps (`WorldConfig::world_step_ms` each) the last
    /// dispatch stood for, and so how far `tick` advanced. 1 at full rate; more
    /// when dispatches are slower than a step (a loaded host, or a hibernating
    /// world), so tick-counted timers keep real time. Countdowns subtract it.
    pub steps: u64,

    /// World time the last dispatch covered, in seconds: `steps` steps. The
    /// clock for timers that accumulate seconds (growth, cooldowns, regrowth);
    /// physics keeps the clamped `delta`.
    pub world_delta: f32,

    /// Real time not yet turned into steps, carried across dispatches so a
    /// stall pays back over several of them instead of in one.
    catch_up_debt: f64,

    path: PathBuf,

    saving: bool,
}

/// One dispatch's share of world time, from [`plan_world_steps`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WorldSteps {
    pub steps: u64,
    /// Real time still owed after these steps. It can be slightly negative
    /// (at most one step): a dispatch always advances at least one step.
    pub debt: f64,
}

/// Turn the real time since the last dispatch (plus what earlier dispatches
/// still owe) into whole world steps: at least one, at most `max_steps`,
/// with the rest carried and the carry capped at `max_debt_secs`.
pub fn plan_world_steps(
    debt: f64,
    elapsed_secs: f64,
    step_secs: f64,
    max_steps: u64,
    max_debt_secs: f64,
) -> WorldSteps {
    if step_secs <= 0.0 {
        return WorldSteps { steps: 1, debt: 0.0 };
    }
    let owed = (debt + elapsed_secs.max(0.0)).min(max_debt_secs.max(step_secs));
    let whole = (owed / step_secs).floor().max(0.0) as u64;
    let steps = whole.clamp(1, max_steps.max(1));
    let debt = (owed - steps as f64 * step_secs).max(-step_secs);
    WorldSteps { steps, debt }
}

impl Stats {
    /// Create a new statistics instance.
    pub fn new(saving: bool, directory: &str, default_time: f32) -> Self {
        let mut path = PathBuf::from(&directory);
        path.push("stats.json");

        // Try to load existing stats if saving is enabled and file exists
        let (loaded_tick, loaded_time, loaded_day) = if saving && path.exists() {
            match fs::read_to_string(&path) {
                Ok(contents) => match serde_json::from_str::<StatsJson>(&contents) {
                    Ok(stats_json) => (stats_json.tick, stats_json.time, stats_json.day),
                    Err(e) => {
                        warn!("Failed to parse stats.json: {}", e);
                        (0, default_time, 0)
                    }
                },
                Err(e) => {
                    warn!("Failed to read stats.json: {}", e);
                    (0, default_time, 0)
                }
            }
        } else {
            (0, default_time, 0)
        };

        Self {
            delta: 0.0,
            tick: loaded_tick,
            dispatch_count: 0,
            start_time: Instant::now(),
            prev_time: SystemTime::now(),
            time: loaded_time,
            day: loaded_day,
            preloading: false,
            steps: 1,
            world_delta: 0.0,
            catch_up_debt: 0.0,
            path,
            saving,
        }
    }

    /// Advance `tick` by the world steps the real time since the last
    /// dispatch stands for (see [`plan_world_steps`]), and set `steps` and
    /// `world_delta` to match.
    pub fn advance_world_steps(
        &mut self,
        elapsed_secs: f64,
        step_secs: f64,
        max_steps: u64,
        max_debt_secs: f64,
    ) {
        let plan = plan_world_steps(
            self.catch_up_debt,
            elapsed_secs,
            step_secs,
            max_steps,
            max_debt_secs,
        );
        self.catch_up_debt = plan.debt;
        self.steps = plan.steps;
        self.world_delta = (plan.steps as f64 * step_secs) as f32;
        self.tick += plan.steps;
    }

    /// How many multiples of `interval` the last advance of `tick` crossed.
    /// The stepping-safe form of `tick % interval == 0`: with one step per
    /// dispatch it is 1 exactly when that would be true, and a dispatch that
    /// jumps several steps never skips a window.
    pub fn multiples_crossed(&self, interval: u64) -> u64 {
        if interval == 0 {
            return 0;
        }
        let before = self.tick.saturating_sub(self.steps.max(1));
        self.tick / interval - before / interval
    }

    /// Whether the last advance of `tick` crossed a multiple of `interval`.
    pub fn crossed_multiple(&self, interval: u64) -> bool {
        self.multiples_crossed(interval) > 0
    }

    /// Advance the clock by `delta` seconds, wrapping `time` at `time_per_day`
    /// and counting the wrap as a completed day.
    pub fn advance_time(&mut self, delta: f32, time_per_day: f32) {
        let next = self.time + delta;
        if next >= time_per_day {
            self.day += (next / time_per_day).floor() as u64;
        }
        self.time = next % time_per_day;
    }

    /// Get how long this server has been running.
    pub fn elapsed(&self) -> Duration {
        self.start_time.elapsed()
    }

    /// The monotonic dispatch counter (advances every dispatch, even when the
    /// game tick is frozen). Used for networking bookkeeping only.
    pub fn dispatch_count(&self) -> u64 {
        self.dispatch_count
    }

    /// Advance the monotonic dispatch counter by one. Called unconditionally
    /// every dispatch, independent of `does_tick_time`.
    pub fn advance_dispatch(&mut self) {
        self.dispatch_count = self.dispatch_count.wrapping_add(1);
    }

    pub fn get_stats(&self) -> StatsJson {
        StatsJson {
            tick: self.tick,
            time: self.time,
            delta: self.delta,
            day: self.day,
        }
    }

    pub fn set_time(&mut self, time: f32) {
        self.time = time;
    }

    pub fn save(&self) {
        if !self.saving {
            return;
        }

        if let Ok(mut file) = fs::OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(&self.path)
        {
            let j = serde_json::to_string(&self.get_stats()).unwrap();
            file.write_all(j.as_bytes())
                .expect("Unable to write stats file.");
        } else {
            let mut file = fs::File::create(&self.path).expect("Unable to create stats file...");
            let j = serde_json::to_string(&self.get_stats()).unwrap();
            file.write_all(j.as_bytes())
                .expect("Unable to write stats file.");
        }
    }
}

#[cfg(test)]
mod world_step_tests {
    use super::*;

    const STEP: f64 = 0.016;

    #[test]
    fn a_hibernated_dispatch_stands_for_the_half_second_that_passed() {
        let plan = plan_world_steps(0.0, 0.5, STEP, 64, 600.0);
        assert_eq!(plan.steps, 31);
        assert!((plan.debt - 0.004).abs() < 1e-9, "the 4 ms remainder carries");
    }

    #[test]
    fn a_stall_pays_back_a_capped_amount_per_dispatch() {
        let mut stats = Stats::new(false, "", 0.0);
        // 10 s and half a step, clear of the float edge at exactly 625 steps.
        stats.advance_world_steps(10.0 + STEP / 2.0, STEP, 64, 600.0);
        assert_eq!(stats.steps, 64);
        let mut total = stats.steps;
        let mut dispatches = 1;
        while total < 625 {
            stats.advance_world_steps(0.0, STEP, 64, 600.0);
            total += stats.steps;
            dispatches += 1;
        }
        // 10 s is 625 steps; at 64 a dispatch that takes 10 dispatches.
        assert_eq!(dispatches, 10);
        assert_eq!(stats.tick, total);
        stats.advance_world_steps(0.0, STEP, 64, 600.0);
        assert_eq!(stats.steps, 1, "once repaid, a dispatch is one step again");
    }

    #[test]
    fn the_carry_is_capped_so_a_long_sleep_does_not_race_the_world_for_hours() {
        let plan = plan_world_steps(0.0, 8.0 * 3600.0, STEP, 64, 600.0);
        assert!(plan.debt <= 600.0);
    }

    #[test]
    fn full_rate_dispatches_track_real_time_within_one_step() {
        let mut stats = Stats::new(false, "", 0.0);
        // 1000 dispatches at 60 Hz: 16.67 s of real time.
        for _ in 0..1000 {
            stats.advance_world_steps(1.0 / 60.0, STEP, 64, 600.0);
        }
        let expected = (1000.0 / 60.0 / STEP) as i64;
        assert!((stats.tick as i64 - expected).abs() <= 1, "tick {} vs {expected}", stats.tick);
    }

    #[test]
    fn multiples_crossed_never_skips_a_window_when_ticks_jump() {
        let mut stats = Stats::new(false, "", 0.0);
        let mut fired = 0;
        for _ in 0..100 {
            stats.advance_world_steps(0.512, STEP, 64, 600.0);
            fired += stats.multiples_crossed(40);
        }
        assert_eq!(fired, stats.tick / 40);
        // One step per dispatch: identical to `tick % n == 0`.
        let mut single = Stats::new(false, "", 0.0);
        for _ in 0..200 {
            single.advance_world_steps(STEP, STEP, 64, 600.0);
            assert_eq!(single.crossed_multiple(40), single.tick % 40 == 0);
        }
    }
}
