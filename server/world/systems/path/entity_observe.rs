use crate::{IDComp, KdTree, PositionComp, TargetComp, TargetType, WorldTimingContext};
use specs::{Read, ReadExpect, ReadStorage, System, WriteStorage};

pub struct EntityObserveSystem;

impl<'a> System<'a> for EntityObserveSystem {
    #[allow(clippy::type_complexity)]
    type SystemData = (
        Read<'a, KdTree>,
        ReadStorage<'a, PositionComp>,
        ReadStorage<'a, IDComp>,
        WriteStorage<'a, TargetComp>,
        ReadExpect<'a, WorldTimingContext>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (tree, positions, ids, mut targets, timing) = data;
        let _t = timing.timer("entity-observe");

        (&positions, &mut targets)
            .par_join()
            .for_each(|(position, target)| {
                let closest_entity = match target.target_type {
                    TargetType::All => tree.search_first(&position.0),
                    TargetType::Players => tree.search_first_player(&position.0, false),
                    TargetType::Entities => tree.search_first_entity(&position.0, true),
                };

                if let Some(entity) = closest_entity {
                    if let (Some(target_position), Some(id)) = (positions.get(*entity), ids.get(*entity))
                    {
                        target.position = Some(target_position.0.clone());
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
