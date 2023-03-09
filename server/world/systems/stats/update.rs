use std::time::SystemTime;

use specs::{ReadExpect, System, WriteExpect};

use crate::{world::stats::Stats, WorldConfig};

pub struct UpdateStatsSystem;

impl<'a> System<'a> for UpdateStatsSystem {
    type SystemData = (ReadExpect<'a, WorldConfig>, WriteExpect<'a, Stats>);

    fn run(&mut self, data: Self::SystemData) {
        let (config, mut stats) = data;

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

        stats.time_tick = (stats.time_tick + 1) % config.ticks_per_day;
    }
}
