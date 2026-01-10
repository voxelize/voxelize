use crate::{ClientFlag, EntityFlag, KdTree, PositionComp, WorldTimingContext};
use hashbrown::HashSet;
use specs::{Entities, ReadExpect, ReadStorage, System, Write};

const POSITION_THRESHOLD_SQ: f32 = 0.01;

pub struct EntityTreeSystem;

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
                    let dist_sq = dx * dx + dy * dy + dz * dz;
                    if dist_sq > POSITION_THRESHOLD_SQ {
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
                    let dist_sq = dx * dx + dy * dy + dz * dz;
                    if dist_sq > POSITION_THRESHOLD_SQ {
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
