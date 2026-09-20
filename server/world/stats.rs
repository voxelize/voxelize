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

    path: PathBuf,

    saving: bool,
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
            path,
            saving,
        }
    }

    /// Advance the clock by `delta` seconds, wrapping `time` at `time_per_day`
    /// and counting the wrap as a completed day.
    pub fn advance_time(&mut self, delta: f32, time_per_day: f32) {
        let next = self.time + delta;
        if next >= time_per_day {
            self.day += 1;
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
