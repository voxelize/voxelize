use std::{
    fs,
    io::Write,
    path::PathBuf,
    time::{Duration, Instant, SystemTime},
};

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StatsJson {
    pub tick: u64,
    pub time: f32,
    pub delta: f32,

    // Performance metrics (optional for backward compatibility)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunk_collider_ops_ns: Option<u128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunk_collision_count: Option<u64>,
}

/// A general statistical manager of Voxelize.
pub struct Stats {
    /// The time this server started.
    pub start_time: Instant,

    /// Delta time of the voxelize world, in seconds.
    pub delta: f32,

    /// Tick of the game
    pub tick: u64,

    /// A number between 0 to config.time_per_day
    pub time: f32,

    /// The time of the last tick.
    pub prev_time: SystemTime,

    /// Nanoseconds spent registering/unregistering chunk colliders in the last tick.
    pub chunk_collider_ops_ns: u128,

    /// Number of collisions detected between entities and chunk colliders in the last tick.
    pub chunk_collision_count: u64,

    path: PathBuf,

    saving: bool,
}

impl Stats {
    /// Create a new statistics instance.
    pub fn new(saving: bool, directory: &str, default_time: f32) -> Self {
        let mut path = PathBuf::from(&directory);
        path.push("stats.json");

        Self {
            delta: 0.0,
            tick: 0,
            start_time: Instant::now(),
            prev_time: SystemTime::now(),
            time: default_time,
            path,
            saving,
            chunk_collider_ops_ns: 0,
            chunk_collision_count: 0,
        }
    }

    /// Get how long this server has been running.
    pub fn elapsed(&self) -> Duration {
        self.start_time.elapsed()
    }

    pub fn get_stats(&self) -> StatsJson {
        StatsJson {
            tick: self.tick,
            time: self.time,
            delta: self.delta,
            chunk_collider_ops_ns: Some(self.chunk_collider_ops_ns),
            chunk_collision_count: Some(self.chunk_collision_count),
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
