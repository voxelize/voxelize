use crate::{IDComp, KdTree, RigidBodyComp, TargetComp, TargetType};
use specs::{ReadExpect, ReadStorage, System, WriteStorage};

pub struct EntityObserveSystem;

impl<'a> System<'a> for EntityObserveSystem {
    #[allow(clippy::type_complexity)]
    type SystemData = (
        ReadExpect<'a, KdTree>,
        ReadStorage<'a, RigidBodyComp>,
        ReadStorage<'a, IDComp>,
        WriteStorage<'a, TargetComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (tree, bodies, ids, mut targets) = data;

        (&bodies, &mut targets)
            .par_join()
            .for_each(|(body, target)| {
                let position = body.0.get_position();
                let closest_arr = if target.target_type == TargetType::All {
                    tree.search(&position, 1)
                } else if target.target_type == TargetType::Players {
                    tree.search_player(&position, 1, false)
                } else {
                    tree.search_entity(&position, 1, true)
                };

                if closest_arr.len() > 0 {
                    let entity = closest_arr[0].1;

                    if let (Some(body), Some(id)) =
                        (bodies.get(entity.to_owned()), ids.get(entity.to_owned()))
                    {
                        let position = body.0.get_position();

                        target.position = Some(position);
                        target.id = Some(id.0.clone());
                    } else {
                        target.position = None;
                        target.id = None;
                    }
                } else {
                    target.position = None;
                    target.id = None;
                }
            });
    }
}
