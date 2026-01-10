use std::time::SystemTime;

use specs::{ReadExpect, System, WriteExpect};

use crate::{world::stats::Stats, WorldConfig, WorldTimingContext};

pub struct UpdateStatsSystem;

impl<'a> System<'a> for UpdateStatsSystem {
    type SystemData = (ReadExpect<'a, WorldConfig>, WriteExpect<'a, Stats>, ReadExpect<'a, WorldTimingContext>);

    fn run(&mut self, data: Self::SystemData) {
        let (config, mut stats, timing) = data;
        let _t = timing.timer("update-stats");

        let now = SystemTime::now();

        stats.delta = now
            .duration_since(stats.prev_time)
            .unwrap_or_default()
            .as_nanos() as f32
            / 1000000000.0;

        // Clamp delta to a reasonable range to prevent extremely large physics steps.
        if stats.delta > 0.05 {
            stats.delta = 0.05; // corresponds to a minimum of ~20 FPS
        }

        if config.does_tick_time {
            stats.prev_time = now;

            stats.tick += 1;

            if config.time_per_day > 0 {
                stats.time = (stats.time + stats.delta) % (config.time_per_day as f32);
            }
        }
    }
}
