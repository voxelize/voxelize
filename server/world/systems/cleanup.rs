use specs::{Join, System, WriteStorage};

use crate::CollisionsComp;

pub struct CleanupSystem;

impl<'a> System<'a> for CleanupSystem {
    type SystemData = WriteStorage<'a, CollisionsComp>;

    fn run(&mut self, mut collisions: Self::SystemData) {
        (&mut collisions).join().for_each(|col| col.0.clear());
    }
}
