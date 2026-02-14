use crate::{ClientFlag, EntityFlag, KdTree, PositionComp, Vec3, WorldTimingContext};
use hashbrown::HashSet;
use specs::{Entities, LendJoin, ReadExpect, ReadStorage, System, Write};

const POSITION_THRESHOLD_SQ: f32 = 0.01;

pub struct EntityTreeSystem;

#[inline]
fn should_update_position(dx: f32, dy: f32, dz: f32) -> bool {
    let dist_sq = dx * dx + dy * dy + dz * dz;
    !dist_sq.is_finite() || dist_sq > POSITION_THRESHOLD_SQ
}

#[inline]
fn sync_position(tree: &mut KdTree, ent: specs::Entity, pos: &Vec3<f32>, is_player: bool) {
    let contains = if is_player {
        tree.contains_player(ent)
    } else {
        tree.contains_entity(ent)
    };

    if contains {
        if let Some(old_pos) = tree.get_position(ent) {
            let dx = pos.0 - old_pos[0];
            let dy = pos.1 - old_pos[1];
            let dz = pos.2 - old_pos[2];
            if should_update_position(dx, dy, dz) {
                if is_player {
                    tree.update_player(ent, pos);
                } else {
                    tree.update_entity(ent, pos);
                }
            }
            return;
        }
    }

    if is_player {
        tree.add_player(ent, pos);
    } else {
        tree.add_entity(ent, pos);
    }
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

        let mut current_ids: HashSet<u32> = HashSet::with_capacity(tree.len());

        for (ent, pos, entity_flag, client_flag) in (
            &entities,
            &positions,
            entity_flags.maybe(),
            client_flags.maybe(),
        )
            .join()
        {
            current_ids.insert(ent.id());

            if entity_flag.is_some() {
                sync_position(&mut tree, ent, &pos.0, false);
            }
            if client_flag.is_some() {
                sync_position(&mut tree, ent, &pos.0, true);
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
