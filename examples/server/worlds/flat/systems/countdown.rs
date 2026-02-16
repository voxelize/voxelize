use log::warn;
use specs::{Entities, Join, System, WriteStorage};

use crate::worlds::flat::comps::CountdownComp;

pub struct CountdownSystem;

impl<'a> System<'a> for CountdownSystem {
    type SystemData = (Entities<'a>, WriteStorage<'a, CountdownComp>);

    fn run(&mut self, data: Self::SystemData) {
        let (entities, mut countdowns) = data;

        for (countdown, entity) in (&mut countdowns, &entities).join() {
            countdown.tick();

            if countdown.finished {
                if let Err(error) = entities.delete(entity) {
                    warn!(
                        "Failed to delete countdown entity {:?}: {:?}",
                        entity, error
                    );
                }
            }
        }
    }
}
