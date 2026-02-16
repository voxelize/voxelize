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

#[inline]
fn retain_tree_entities(tree: &mut KdTree, current_ids: &HashSet<u32>) {
    match current_ids.len() {
        0 => {
            if tree.len() != 0 {
                tree.reset();
            }
        }
        1 => {
            if let Some(current_id) = current_ids.iter().next().copied() {
                tree.retain_only(current_id);
            }
        }
        2 => {
            let mut ids = current_ids.iter().copied();
            if let (Some(first), Some(second)) = (ids.next(), ids.next()) {
                tree.retain(|ent_id| ent_id == first || ent_id == second);
            }
        }
        3 => {
            let mut ids = current_ids.iter().copied();
            if let (Some(first), Some(second), Some(third)) =
                (ids.next(), ids.next(), ids.next())
            {
                tree.retain(|ent_id| ent_id == first || ent_id == second || ent_id == third);
            }
        }
        4 => {
            let mut ids = current_ids.iter().copied();
            if let (Some(first), Some(second), Some(third), Some(fourth)) =
                (ids.next(), ids.next(), ids.next(), ids.next())
            {
                tree.retain(|ent_id| {
                    ent_id == first || ent_id == second || ent_id == third || ent_id == fourth
                });
            }
        }
        5 => {
            let mut ids = current_ids.iter().copied();
            if let (Some(first), Some(second), Some(third), Some(fourth), Some(fifth)) = (
                ids.next(),
                ids.next(),
                ids.next(),
                ids.next(),
                ids.next(),
            ) {
                tree.retain(|ent_id| {
                    ent_id == first
                        || ent_id == second
                        || ent_id == third
                        || ent_id == fourth
                        || ent_id == fifth
                });
            }
        }
        6 => {
            let mut ids = current_ids.iter().copied();
            if let (Some(first), Some(second), Some(third), Some(fourth), Some(fifth), Some(sixth)) = (
                ids.next(),
                ids.next(),
                ids.next(),
                ids.next(),
                ids.next(),
                ids.next(),
            ) {
                tree.retain(|ent_id| {
                    ent_id == first
                        || ent_id == second
                        || ent_id == third
                        || ent_id == fourth
                        || ent_id == fifth
                        || ent_id == sixth
                });
            }
        }
        7 => {
            let mut ids = current_ids.iter().copied();
            if let (
                Some(first),
                Some(second),
                Some(third),
                Some(fourth),
                Some(fifth),
                Some(sixth),
                Some(seventh),
            ) = (
                ids.next(),
                ids.next(),
                ids.next(),
                ids.next(),
                ids.next(),
                ids.next(),
                ids.next(),
            ) {
                tree.retain(|ent_id| {
                    ent_id == first
                        || ent_id == second
                        || ent_id == third
                        || ent_id == fourth
                        || ent_id == fifth
                        || ent_id == sixth
                        || ent_id == seventh
                });
            }
        }
        8 => {
            let mut ids = current_ids.iter().copied();
            if let (
                Some(first),
                Some(second),
                Some(third),
                Some(fourth),
                Some(fifth),
                Some(sixth),
                Some(seventh),
                Some(eighth),
            ) = (
                ids.next(),
                ids.next(),
                ids.next(),
                ids.next(),
                ids.next(),
                ids.next(),
                ids.next(),
                ids.next(),
            ) {
                tree.retain(|ent_id| {
                    ent_id == first
                        || ent_id == second
                        || ent_id == third
                        || ent_id == fourth
                        || ent_id == fifth
                        || ent_id == sixth
                        || ent_id == seventh
                        || ent_id == eighth
                });
            }
        }
        _ => {
            tree.retain(|ent_id| current_ids.contains(&ent_id));
        }
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

        self.current_ids_buffer.clear();
        let initial_tree_len = tree.len();
        if self.current_ids_buffer.capacity() < initial_tree_len {
            self.current_ids_buffer
                .reserve(initial_tree_len - self.current_ids_buffer.len());
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
            retain_tree_entities(&mut tree, current_ids);
        }
    }
}

#[cfg(test)]
mod tests {
    use specs::{Builder, RunNow, World, WorldExt};

    use super::{retain_tree_entities, should_update_position, EntityTreeSystem};
    use crate::{EntityFlag, KdTree, PositionComp, Vec3, WorldTimingContext};

    #[test]
    fn should_update_position_rejects_non_finite_distances() {
        assert!(!should_update_position(0.05, 0.0, 0.0));
        assert!(should_update_position(0.2, 0.0, 0.0));
        assert!(should_update_position(f32::NAN, 0.0, 0.0));
        assert!(should_update_position(f32::INFINITY, 0.0, 0.0));
    }

    #[test]
    fn unflagged_entities_are_removed_from_kdtree() {
        let mut world = World::new();
        world.register::<EntityFlag>();
        world.register::<crate::ClientFlag>();
        world.register::<PositionComp>();
        world.insert(WorldTimingContext::new("test-world"));

        let ent = world
            .create_entity()
            .with(PositionComp::new(1.0, 2.0, 3.0))
            .build();

        let mut tree = KdTree::new();
        tree.add_entity(ent, &Vec3(1.0, 2.0, 3.0));
        assert!(tree.contains(ent));
        world.insert(tree);

        let mut system = EntityTreeSystem::default();
        system.run_now(&world);
        world.maintain();

        let tree = world.read_resource::<KdTree>();
        assert!(!tree.contains(ent));
    }

    #[test]
    fn retain_tree_entities_keeps_only_requested_ids_for_small_sets() {
        let mut world = World::new();
        let ent_a = world.create_entity().build();
        let ent_b = world.create_entity().build();
        let ent_c = world.create_entity().build();
        let mut tree = KdTree::new();
        tree.add_entity(ent_a, &Vec3(1.0, 2.0, 3.0));
        tree.add_entity(ent_b, &Vec3(4.0, 5.0, 6.0));
        tree.add_entity(ent_c, &Vec3(7.0, 8.0, 9.0));

        let mut retained_ids = hashbrown::HashSet::with_capacity(2);
        retained_ids.insert(ent_a.id());
        retained_ids.insert(ent_c.id());

        retain_tree_entities(&mut tree, &retained_ids);

        assert_eq!(tree.len(), 2);
        assert!(tree.contains(ent_a));
        assert!(!tree.contains(ent_b));
        assert!(tree.contains(ent_c));
    }

    #[test]
    fn retain_tree_entities_keeps_only_requested_ids_for_six_item_set() {
        let mut world = World::new();
        let ent_a = world.create_entity().build();
        let ent_b = world.create_entity().build();
        let ent_c = world.create_entity().build();
        let ent_d = world.create_entity().build();
        let ent_e = world.create_entity().build();
        let ent_f = world.create_entity().build();
        let ent_g = world.create_entity().build();
        let mut tree = KdTree::new();
        tree.add_entity(ent_a, &Vec3(1.0, 0.0, 0.0));
        tree.add_entity(ent_b, &Vec3(2.0, 0.0, 0.0));
        tree.add_entity(ent_c, &Vec3(3.0, 0.0, 0.0));
        tree.add_entity(ent_d, &Vec3(4.0, 0.0, 0.0));
        tree.add_entity(ent_e, &Vec3(5.0, 0.0, 0.0));
        tree.add_entity(ent_f, &Vec3(6.0, 0.0, 0.0));
        tree.add_entity(ent_g, &Vec3(7.0, 0.0, 0.0));

        let mut retained_ids = hashbrown::HashSet::with_capacity(6);
        retained_ids.insert(ent_a.id());
        retained_ids.insert(ent_b.id());
        retained_ids.insert(ent_c.id());
        retained_ids.insert(ent_d.id());
        retained_ids.insert(ent_e.id());
        retained_ids.insert(ent_f.id());

        retain_tree_entities(&mut tree, &retained_ids);

        assert_eq!(tree.len(), 6);
        assert!(tree.contains(ent_a));
        assert!(tree.contains(ent_b));
        assert!(tree.contains(ent_c));
        assert!(tree.contains(ent_d));
        assert!(tree.contains(ent_e));
        assert!(tree.contains(ent_f));
        assert!(!tree.contains(ent_g));
    }

    #[test]
    fn retain_tree_entities_keeps_only_requested_ids_for_eight_item_set() {
        let mut world = World::new();
        let ent_a = world.create_entity().build();
        let ent_b = world.create_entity().build();
        let ent_c = world.create_entity().build();
        let ent_d = world.create_entity().build();
        let ent_e = world.create_entity().build();
        let ent_f = world.create_entity().build();
        let ent_g = world.create_entity().build();
        let ent_h = world.create_entity().build();
        let ent_i = world.create_entity().build();
        let mut tree = KdTree::new();
        tree.add_entity(ent_a, &Vec3(1.0, 0.0, 0.0));
        tree.add_entity(ent_b, &Vec3(2.0, 0.0, 0.0));
        tree.add_entity(ent_c, &Vec3(3.0, 0.0, 0.0));
        tree.add_entity(ent_d, &Vec3(4.0, 0.0, 0.0));
        tree.add_entity(ent_e, &Vec3(5.0, 0.0, 0.0));
        tree.add_entity(ent_f, &Vec3(6.0, 0.0, 0.0));
        tree.add_entity(ent_g, &Vec3(7.0, 0.0, 0.0));
        tree.add_entity(ent_h, &Vec3(8.0, 0.0, 0.0));
        tree.add_entity(ent_i, &Vec3(9.0, 0.0, 0.0));

        let mut retained_ids = hashbrown::HashSet::with_capacity(8);
        retained_ids.insert(ent_a.id());
        retained_ids.insert(ent_b.id());
        retained_ids.insert(ent_c.id());
        retained_ids.insert(ent_d.id());
        retained_ids.insert(ent_e.id());
        retained_ids.insert(ent_f.id());
        retained_ids.insert(ent_g.id());
        retained_ids.insert(ent_h.id());

        retain_tree_entities(&mut tree, &retained_ids);

        assert_eq!(tree.len(), 8);
        assert!(tree.contains(ent_a));
        assert!(tree.contains(ent_b));
        assert!(tree.contains(ent_c));
        assert!(tree.contains(ent_d));
        assert!(tree.contains(ent_e));
        assert!(tree.contains(ent_f));
        assert!(tree.contains(ent_g));
        assert!(tree.contains(ent_h));
        assert!(!tree.contains(ent_i));
    }
}
