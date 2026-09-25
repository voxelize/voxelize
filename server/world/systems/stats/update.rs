use std::time::SystemTime;

use specs::{ReadExpect, System, WriteExpect};

use crate::{perf_toggle, world::stats::Stats, PerfToggle, WorldConfig};

pub struct UpdateStatsSystem;

impl<'a> System<'a> for UpdateStatsSystem {
    type SystemData = (ReadExpect<'a, WorldConfig>, WriteExpect<'a, Stats>);

    fn run(&mut self, data: Self::SystemData) {
        let (config, mut stats) = data;

        let now = SystemTime::now();

        let elapsed = now
            .duration_since(stats.prev_time)
            .unwrap_or_default()
            .as_nanos() as f32
            / 1000000000.0;

        // Clamp delta to a reasonable range to prevent extremely large physics steps.
        stats.delta = elapsed.min(0.05); // corresponds to a minimum of ~20 FPS

        // Advance the monotonic dispatch counter UNCONDITIONALLY, every run,
        // regardless of `does_tick_time`. Permanent-night worlds freeze
        // `stats.tick`/`stats.time` on purpose, but the networking layer needs
        // a counter that always moves forward for keep-alive cadence and
        // out-of-order message watermarks.
        stats.advance_dispatch();

        if config.does_tick_time {
            stats.prev_time = now;

            // Fixed-step worlds own their clock; everyone else advances by
            // the world steps the real time since the last dispatch covers.
            if config.fixed_timestep.is_none() && perf_toggle(PerfToggle::CatchUpWorldTime) {
                stats.advance_world_steps(
                    elapsed as f64,
                    config.world_step_ms as f64 / 1000.0,
                    config.max_catch_up_steps,
                    config.max_catch_up_debt_secs as f64,
                );
            } else {
                stats.tick += 1;
                stats.steps = 1;
                stats.world_delta = stats.delta;
            }

            if config.time_per_day > 0 {
                // The day clock follows the wall clock, not the clamped
                // physics step: a world dispatching slowly (a loaded host, or
                // hibernating with nobody in it) keeps its day length.
                stats.advance_time(elapsed, config.time_per_day as f32);
            }
        } else {
            // A frozen-clock world keeps per-dispatch timers on the physics step.
            stats.steps = 1;
            stats.world_delta = stats.delta;
        }
    }
}
