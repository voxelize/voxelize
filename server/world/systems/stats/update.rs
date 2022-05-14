use specs::{System, WriteExpect};

use crate::world::stats::Stats;

pub struct UpdateStatsSystem;

impl<'a> System<'a> for UpdateStatsSystem {
    type SystemData = (WriteExpect<'a, Stats>,);

    fn run(&mut self, data: Self::SystemData) {
        let (mut stats,) = data;

        stats.tick += 1;
    }
}
