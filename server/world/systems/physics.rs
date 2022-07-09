use std::sync::Arc;

use hashbrown::HashMap;
use log::info;
use rapier3d::prelude::CollisionEvent;
use specs::{Entities, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};

use crate::{
    world::{
        components::{CurrentChunkComp, PositionComp, RigidBodyComp},
        physics::Physics,
        registry::Registry,
        stats::Stats,
        voxels::{Chunks, VoxelAccess},
        WorldConfig,
    },
    ClientFlag, CollisionsComp, InteractorComp, Vec3,
};

pub struct PhysicsSystem;

impl<'a> System<'a> for PhysicsSystem {
    type SystemData = (
        Entities<'a>,
        ReadExpect<'a, Stats>,
        ReadExpect<'a, Registry>,
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, Chunks>,
        WriteExpect<'a, Physics>,
        ReadStorage<'a, CurrentChunkComp>,
        ReadStorage<'a, InteractorComp>,
        ReadStorage<'a, ClientFlag>,
        WriteStorage<'a, CollisionsComp>,
        WriteStorage<'a, RigidBodyComp>,
        WriteStorage<'a, PositionComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::{Join, ParJoin};

        let (
            entities,
            stats,
            registry,
            config,
            chunks,
            mut physics,
            curr_chunks,
            interactors,
            client_flag,
            mut collisions,
            mut bodies,
            mut positions,
        ) = data;

        let get_voxel = |vx: i32, vy: i32, vz: i32| {
            (
                chunks.get_voxel(vx, vy, vz),
                chunks.get_voxel_rotation(vx, vy, vz),
            )
        };
        let mut collision_map = HashMap::new();

        // Tick the voxel physics of all entities (non-clients).
        for (ent, curr_chunk, interactor, body, position, _) in (
            &entities,
            &curr_chunks,
            &interactors,
            &mut bodies,
            &mut positions,
            !&client_flag,
        )
            .join()
        {
            if !chunks.is_chunk_ready(&curr_chunk.coords) {
                continue;
            }

            Physics::iterate_body(&mut body.0, stats.delta, &get_voxel, &registry, &config);

            let body_pos = body.0.get_position();
            let Vec3(px, py, pz) = body_pos;

            position.0.set(px, py, pz);
            physics.move_rapier_body(interactor.body_handle(), &body_pos);
            collision_map.insert(interactor.collider_handle().clone(), ent);
        }

        // Move the clients' rigid bodies to their positions
        (&entities, &interactors, &positions, &client_flag)
            .join()
            .for_each(|(ent, interactor, position, _)| {
                physics.move_rapier_body(interactor.body_handle(), &position.0);
                collision_map.insert(interactor.collider_handle().clone(), ent);
            });

        // Tick the rapier physics engine, and add the collisions to individual entities.
        physics
            .step(stats.delta)
            .into_iter()
            .for_each(|event| match event {
                CollisionEvent::Started(ch1, ch2, _) => {
                    let ent1 = if let Some(ent) = collision_map.get(&ch1) {
                        ent
                    } else {
                        return;
                    };
                    let ent2 = if let Some(ent) = collision_map.get(&ch2) {
                        ent
                    } else {
                        return;
                    };

                    if let Some(collision_comp) = collisions.get_mut(*ent1) {
                        collision_comp.0.push((event, *ent2))
                    }
                    if let Some(collision_comp) = collisions.get_mut(*ent2) {
                        collision_comp.0.push((event, *ent1))
                    }
                }
                CollisionEvent::Stopped(ch1, ch2, _) => {
                    let ent1 = if let Some(ent) = collision_map.get(&ch1) {
                        ent
                    } else {
                        return;
                    };
                    let ent2 = if let Some(ent) = collision_map.get(&ch2) {
                        ent
                    } else {
                        return;
                    };

                    if let Some(collision_comp) = collisions.get_mut(*ent1) {
                        collision_comp.0.push((event, *ent2))
                    }
                    if let Some(collision_comp) = collisions.get_mut(*ent2) {
                        collision_comp.0.push((event, *ent1))
                    }
                }
            });

        let physics = Arc::new(physics);
        let chunks = Arc::new(chunks);

        if config.collision_repulsion <= f32::EPSILON {
            return;
        }

        // Collision detection, push bodies away from one another.
        (&curr_chunks, &mut bodies, &interactors, !&client_flag)
            .par_join()
            .for_each(|(curr_chunk, body, interactor, _)| {
                if !chunks.is_chunk_ready(&curr_chunk.coords) {
                    return;
                }

                let rapier_body = physics.get(&interactor.0);
                let after = rapier_body.translation();

                let Vec3(px, py, pz) = body.0.get_position();

                let dx = after.x - px;
                let dy = after.y - py;
                let dz = after.z - pz;

                let dx = if dx.abs() < 0.001 { 0.0 } else { dx };
                let dy = if dy.abs() < 0.001 { 0.0 } else { dy };
                let dz = if dz.abs() < 0.001 { 0.0 } else { dz };

                let len = (dx * dx + dy * dy + dz * dz).sqrt();

                if len <= 0.0001 {
                    return;
                }

                let dx = dx / len;
                let dy = dy / len;
                let dz = dz / len;

                body.0.apply_impulse(
                    (dx * config.collision_repulsion).min(3.0),
                    (dy * config.collision_repulsion).min(3.0),
                    (dz * config.collision_repulsion).min(3.0),
                );
            });
    }
}
