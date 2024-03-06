use crate::{ClientFlag, EntityFlag, KdTree, RigidBodyComp};
use specs::{Entities, ReadStorage, System, WriteExpect};

pub struct EntityTreeSystem;

impl<'a> System<'a> for EntityTreeSystem {
    type SystemData = (
        Entities<'a>,
        WriteExpect<'a, KdTree>,
        ReadStorage<'a, EntityFlag>,
        ReadStorage<'a, ClientFlag>,
        ReadStorage<'a, RigidBodyComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use specs::Join;

        let (entities, mut tree, entity_flags, client_flags, bodies) = data;

        tree.reset();

        for (ent, body, _) in (&*entities, &bodies, &entity_flags).join() {
            let pos = body.0.get_position();
            tree.add_entity(ent, pos);
        }

        for (ent, body, _) in (&*entities, &bodies, &client_flags).join() {
            let pos = body.0.get_position();
            tree.add_player(ent, pos);
        }
    }
}
