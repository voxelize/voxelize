use crate::{KdTree, RigidBodyComp, TargetComp};
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
                let closest_arr = tree.search_player(&position, 1, false);

                if closest_arr.len() > 0 {
                    let entity = closest_arr[0].1;

                    if let Some(body) = bodies.get(entity.to_owned()) {
                        let position = body.0.get_position();

                        target.0 = Some(position);
                    } else {
                        target.0 = None;
                    }
                } else {
                    target.0 = None;
                }
            });
    }
}
