use std::time::SystemTime;

use specs::{System, WriteExpect};

use crate::world::stats::Stats;

pub struct UpdateStatsSystem;

impl<'a> System<'a> for UpdateStatsSystem {
    type SystemData = (WriteExpect<'a, Stats>,);

    fn run(&mut self, data: Self::SystemData) {
        let (mut stats,) = data;

        let now = SystemTime::now();

        stats.delta = (now
            .duration_since(stats.prev_time)
            .unwrap_or_default()
            .as_millis() as f32
            / 1000.0)
            .max(0.008)
            .min(0.020);
        stats.prev_time = now;

        stats.tick += 1;
    }
}
