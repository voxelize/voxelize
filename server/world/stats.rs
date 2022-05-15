use std::time::{Duration, Instant, SystemTime};

/// A general statistical manager of Voxelize.
pub struct Stats {
    /// The time this server started.
    pub start_time: Instant,

    /// Delta time of the voxelize world, in seconds.
    pub delta: f32,

    /// Tick of the game
    pub tick: u64,

    /// The time of the last tick.
    pub prev_time: SystemTime,
}

impl Stats {
    /// Create a new statistics instance.
    pub fn new() -> Self {
        Self {
            delta: 0.0,
            tick: 0,
            start_time: Instant::now(),
            prev_time: SystemTime::now(),
        }
    }

    /// Get how long this server has been running.
    pub fn elapsed(&self) -> Duration {
        self.start_time.elapsed()
    }
}
