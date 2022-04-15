use std::time::{Duration, Instant};

/// A general statistical manager of Voxelize.
pub struct Stats {
    /// The time this server started.
    pub start_time: Instant,
}

impl Stats {
    /// Create a new statistics instance.
    pub fn new() -> Self {
        Self {
            start_time: Instant::now(),
        }
    }

    /// Get how long this server has been running.
    pub fn elapsed(&self) -> Duration {
        self.start_time.elapsed()
    }
}
