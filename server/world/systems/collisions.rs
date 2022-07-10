use specs::{Join, System, WriteStorage};

use crate::CollisionsComp;

pub struct ClearCollisionsSystem;

impl<'a> System<'a> for ClearCollisionsSystem {
    type SystemData = WriteStorage<'a, CollisionsComp>;

    fn run(&mut self, mut collisions: Self::SystemData) {
        (&mut collisions).join().for_each(|col| col.0.clear());
    }
}
