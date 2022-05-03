use std::time::{Duration, Instant};

/// A general statistical manager of Voxelize.
pub struct Stats {
    /// The time this server started.
    pub start_time: Instant,

    /// Tick of the game
    pub tick: u64,
}

impl Stats {
    /// Create a new statistics instance.
    pub fn new() -> Self {
        Self {
            start_time: Instant::now(),
            tick: 0,
        }
    }

    /// Get how long this server has been running.
    pub fn elapsed(&self) -> Duration {
        self.start_time.elapsed()
    }
}
