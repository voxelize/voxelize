use log::warn;
use specs::{Entities, ReadStorage, System};
use voxelize::RigidBodyComp;

pub struct VoidKillSystem;

impl<'a> System<'a> for VoidKillSystem {
    type SystemData = (Entities<'a>, ReadStorage<'a, RigidBodyComp>);

    fn run(&mut self, data: Self::SystemData) {
        use specs::Join;

        let (entities, bodies) = data;

        for (ent, body) in (&*entities, &bodies).join() {
            let pos = body.0.get_position();

            if pos.1 < -100.0 {
                if let Err(error) = entities.delete(ent) {
                    warn!("Failed to delete voided entity {:?}: {:?}", ent, error);
                }
            }
        }
    }
}
