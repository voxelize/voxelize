use specs::{Join, ReadExpect, System, WriteStorage};

use crate::{CollisionsComp, WorldTimingContext};

pub struct CleanupSystem;

impl<'a> System<'a> for CleanupSystem {
    type SystemData = (WriteStorage<'a, CollisionsComp>, ReadExpect<'a, WorldTimingContext>);

    fn run(&mut self, data: Self::SystemData) {
        let (mut collisions, timing) = data;
        let _t = timing.timer("cleanup");
        (&mut collisions).join().for_each(|col| col.0.clear());
    }
}
