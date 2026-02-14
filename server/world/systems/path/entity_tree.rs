use crate::{ClientFlag, EntityFlag, KdTree, PositionComp, WorldTimingContext};
use hashbrown::HashSet;
use specs::{Entities, ReadExpect, ReadStorage, System, Write};

const POSITION_THRESHOLD_SQ: f32 = 0.01;

pub struct EntityTreeSystem;

#[inline]
fn should_update_position(dx: f32, dy: f32, dz: f32) -> bool {
    let dist_sq = dx * dx + dy * dy + dz * dz;
    !dist_sq.is_finite() || dist_sq > POSITION_THRESHOLD_SQ
}

impl<'a> System<'a> for EntityTreeSystem {
    type SystemData = (
        Entities<'a>,
        Write<'a, KdTree>,
        ReadStorage<'a, EntityFlag>,
        ReadStorage<'a, ClientFlag>,
        ReadStorage<'a, PositionComp>,
        ReadExpect<'a, WorldTimingContext>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use specs::Join;

        let (entities, mut tree, entity_flags, client_flags, positions, timing) = data;
        let _t = timing.timer("entity-tree");

        let mut current_ids: HashSet<u32> = HashSet::new();

        for (ent, pos, _) in (&entities, &positions, &entity_flags).join() {
            current_ids.insert(ent.id());

            if tree.contains_entity(ent) {
                if let Some(old_pos) = tree.get_position(ent) {
                    let dx = pos.0 .0 - old_pos[0];
                    let dy = pos.0 .1 - old_pos[1];
                    let dz = pos.0 .2 - old_pos[2];
                    if should_update_position(dx, dy, dz) {
                        tree.update_entity(ent, pos.0.clone());
                    }
                }
            } else {
                tree.add_entity(ent, pos.0.clone());
            }
        }

        for (ent, pos, _) in (&entities, &positions, &client_flags).join() {
            current_ids.insert(ent.id());

            if tree.contains_player(ent) {
                if let Some(old_pos) = tree.get_position(ent) {
                    let dx = pos.0 .0 - old_pos[0];
                    let dy = pos.0 .1 - old_pos[1];
                    let dz = pos.0 .2 - old_pos[2];
                    if should_update_position(dx, dy, dz) {
                        tree.update_player(ent, pos.0.clone());
                    }
                }
            } else {
                tree.add_player(ent, pos.0.clone());
            }
        }

        tree.retain(|ent_id| current_ids.contains(&ent_id));
    }
}

#[cfg(test)]
mod tests {
    use super::should_update_position;

    #[test]
    fn should_update_position_rejects_non_finite_distances() {
        assert!(!should_update_position(0.05, 0.0, 0.0));
        assert!(should_update_position(0.2, 0.0, 0.0));
        assert!(should_update_position(f32::NAN, 0.0, 0.0));
        assert!(should_update_position(f32::INFINITY, 0.0, 0.0));
    }
}
