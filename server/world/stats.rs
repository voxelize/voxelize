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
        let (loaded_tick, loaded_time) = if saving && path.exists() {
            match fs::read_to_string(&path) {
                Ok(contents) => match serde_json::from_str::<StatsJson>(&contents) {
                    Ok(stats_json) => (stats_json.tick, stats_json.time),
                    Err(e) => {
                        warn!("Failed to parse stats.json: {}", e);
                        (0, default_time)
                    }
                },
                Err(e) => {
                    warn!("Failed to read stats.json: {}", e);
                    (0, default_time)
                }
            }
        } else {
            (0, default_time)
        };

        Self {
            delta: 0.0,
            tick: loaded_tick,
            dispatch_count: 0,
            start_time: Instant::now(),
            prev_time: SystemTime::now(),
            time: loaded_time,
            preloading: false,
            path,
            saving,
        }
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
