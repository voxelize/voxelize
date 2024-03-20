use crate::{KdTree, RigidBodyComp, TargetComp, TargetType};
use specs::{ReadExpect, ReadStorage, System, WriteStorage};

pub struct EntityObserveSystem;

impl<'a> System<'a> for EntityObserveSystem {
    #[allow(clippy::type_complexity)]
    type SystemData = (
        ReadExpect<'a, KdTree>,
        ReadStorage<'a, RigidBodyComp>,
        WriteStorage<'a, TargetComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (tree, bodies, mut targets) = data;

        (&bodies, &mut targets)
            .par_join()
            .for_each(|(body, target)| {
                let position = body.0.get_position();
                let closest_arr = if target.0 == TargetType::All {
                    tree.search(&position, 1)
                } else if target.0 == TargetType::Player {
                    tree.search_player(&position, 1, false)
                } else {
                    tree.search_entity(&position, 1, true)
                };

                if closest_arr.len() > 0 {
                    let entity = closest_arr[0].1;

                    if let Some(body) = bodies.get(entity.to_owned()) {
                        let position = body.0.get_position();

                        target.1 = Some(position);
                    } else {
                        target.1 = None;
                    }
                } else {
                    target.1 = None;
                }
            });
    }
}
