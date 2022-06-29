use specs::{Entities, ReadStorage, System, WriteExpect};

use crate::{ClientFlag, EntityFlag, RigidBodyComp, Search};

pub struct SearchSystem;

impl<'a> System<'a> for SearchSystem {
    type SystemData = (
        Entities<'a>,
        WriteExpect<'a, Search>,
        ReadStorage<'a, EntityFlag>,
        ReadStorage<'a, ClientFlag>,
        ReadStorage<'a, RigidBodyComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use specs::Join;

        let (entities, mut tree, entity_flag, client_flag, bodies) = data;

        tree.reset();

        for (ent, body, _) in (&*entities, &bodies, &client_flag).join() {
            let pos = body.0.get_position();
            tree.add_client(ent, pos);
        }

        for (ent, body, _) in (&*entities, &bodies, &entity_flag).join() {
            let pos = body.0.get_position();
            tree.add_entity(ent, pos);
        }
    }
}
