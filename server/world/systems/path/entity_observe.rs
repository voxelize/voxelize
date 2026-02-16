use crate::{IDComp, KdTree, PositionComp, TargetComp, TargetType, WorldTimingContext};
use specs::{Read, ReadExpect, ReadStorage, System, WriteStorage};

pub struct EntityObserveSystem;

#[inline]
fn clear_target_if_set(target: &mut TargetComp) {
    if target.position.is_some() || target.id.is_some() {
        target.position = None;
        target.id = None;
        target.dirty = true;
    }
}

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
        if tree.len() == 0 {
            (&positions, &mut targets)
                .par_join()
                .for_each(|(_, target)| clear_target_if_set(target));
            return;
        }

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
                        let next_position = target_position.0;
                        let next_id = id.0.as_str();
                        let position_changed = match target.position.as_ref() {
                            Some(current_position) => *current_position != next_position,
                            None => true,
                        };
                        let mut changed = false;
                        if target.id.as_deref() != Some(next_id) {
                            target.id = Some(id.0.clone());
                            changed = true;
                        }
                        if position_changed {
                            target.position = Some(next_position);
                            changed = true;
                        }
                        if changed {
                            target.dirty = true;
                        }
                    } else {
                        clear_target_if_set(target);
                    }
                } else {
                    clear_target_if_set(target);
                }
            });
    }
}
