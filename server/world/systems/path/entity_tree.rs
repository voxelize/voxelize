use crate::{ClientFlag, EntityFlag, KdTree, PositionComp, Vec3, WorldTimingContext};
use hashbrown::HashSet;
use specs::{Entities, LendJoin, ReadExpect, ReadStorage, System, Write};

const POSITION_THRESHOLD_SQ: f32 = 0.01;

#[derive(Default)]
pub struct EntityTreeSystem {
    current_ids_buffer: HashSet<u32>,
}

#[inline]
fn should_update_position(dx: f32, dy: f32, dz: f32) -> bool {
    let dist_sq = dx * dx + dy * dy + dz * dz;
    !dist_sq.is_finite() || dist_sq > POSITION_THRESHOLD_SQ
}

#[inline]
fn sync_entity_position(tree: &mut KdTree, ent: specs::Entity, pos: &Vec3<f32>) {
    if let Some(old_pos) = tree.get_entity_position(ent) {
        let dx = pos.0 - old_pos[0];
        let dy = pos.1 - old_pos[1];
        let dz = pos.2 - old_pos[2];
        if should_update_position(dx, dy, dz) {
            tree.update_entity(ent, pos);
        }
        return;
    }
    tree.add_entity(ent, pos);
}

#[inline]
fn sync_player_position(tree: &mut KdTree, ent: specs::Entity, pos: &Vec3<f32>) {
    if let Some(old_pos) = tree.get_player_position(ent) {
        let dx = pos.0 - old_pos[0];
        let dy = pos.1 - old_pos[1];
        let dz = pos.2 - old_pos[2];
        if should_update_position(dx, dy, dz) {
            tree.update_player(ent, pos);
        }
        return;
    }
    tree.add_player(ent, pos);
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

        self.current_ids_buffer.clear();
        let initial_tree_len = tree.len();
        if self.current_ids_buffer.capacity() < initial_tree_len {
            self.current_ids_buffer
                .reserve(initial_tree_len - self.current_ids_buffer.capacity());
        }
        let current_ids = &mut self.current_ids_buffer;

        for (ent, pos, entity_flag, client_flag) in (
            &entities,
            &positions,
            entity_flags.maybe(),
            client_flags.maybe(),
        )
            .join()
        {
            if client_flag.is_some() {
                current_ids.insert(ent.id());
                sync_player_position(&mut tree, ent, &pos.0);
            } else if entity_flag.is_some() {
                current_ids.insert(ent.id());
                sync_entity_position(&mut tree, ent, &pos.0);
            }
        }

        if tree.len() > current_ids.len() {
            tree.retain(|ent_id| current_ids.contains(&ent_id));
        }
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
