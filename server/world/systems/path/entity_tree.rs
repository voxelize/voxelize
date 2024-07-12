use crate::{ClientFlag, EntityFlag, KdTree, PositionComp, RigidBodyComp};
use specs::{Entities, ReadStorage, System, Write};

pub struct EntityTreeSystem;

impl<'a> System<'a> for EntityTreeSystem {
    type SystemData = (
        Entities<'a>,
        Write<'a, KdTree>,
        ReadStorage<'a, EntityFlag>,
        ReadStorage<'a, ClientFlag>,
        ReadStorage<'a, PositionComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use specs::Join;

        let (entities, mut tree, entity_flags, client_flags, positions) = data;

        tree.reset();

        for (ent, pos, _) in (&entities, &positions, &entity_flags).join() {
            tree.add_entity(ent, pos.0.clone());
        }

        for (ent, pos, _) in (&entities, &positions, &client_flags).join() {
            tree.add_player(ent, pos.0.clone());
        }
    }
}
