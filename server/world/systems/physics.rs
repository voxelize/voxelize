use std::sync::Arc;

use log::info;
use rapier3d::prelude::{vector, Isometry, RigidBodySet};
use specs::{ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};

use crate::{
    world::{
        components::{CurrentChunkComp, PositionComp, RigidBodyComp},
        physics::Physics,
        registry::Registry,
        stats::Stats,
        voxels::{Chunks, VoxelAccess},
        WorldConfig,
    },
    ClientFlag, InteractorComp, Vec3,
};

pub struct PhysicsSystem;

impl<'a> System<'a> for PhysicsSystem {
    type SystemData = (
        ReadExpect<'a, Stats>,
        ReadExpect<'a, Registry>,
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, Chunks>,
        WriteExpect<'a, Physics>,
        ReadStorage<'a, CurrentChunkComp>,
        ReadStorage<'a, InteractorComp>,
        ReadStorage<'a, ClientFlag>,
        WriteStorage<'a, RigidBodyComp>,
        WriteStorage<'a, PositionComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::{Join, ParJoin};

        let (
            stats,
            registry,
            config,
            chunks,
            mut physics,
            curr_chunks,
            interactors,
            client_flag,
            mut bodies,
            mut positions,
        ) = data;

        let get_voxel = |vx: i32, vy: i32, vz: i32| chunks.get_voxel(vx, vy, vz);

        for (curr_chunk, interactor, body, position) in
            (&curr_chunks, &interactors, &mut bodies, &mut positions).join()
        {
            if !chunks.is_chunk_ready(&curr_chunk.coords) {
                continue;
            }

            let (rapier_body, _) =
                physics.get_mut(&interactor.body_handle, &interactor.collider_handle);

            Physics::iterate_body(&mut body.0, stats.delta, &get_voxel, &registry, &config);

            let Vec3(px, py, pz) = body.0.get_position();

            position.0.set(px, py, pz);

            let wake_up = !Physics::is_body_asleep(
                &get_voxel,
                &registry,
                &config,
                &mut body.0,
                stats.delta,
                false,
            );
            rapier_body.set_translation(vector![px, py, pz], wake_up);
            rapier_body.set_linvel(vector![0.0, 0.0, 0.0], wake_up);
            rapier_body.set_angvel(vector![0.0, 0.0, 0.0], wake_up);
            rapier_body.reset_forces(wake_up);
            rapier_body.reset_torques(wake_up);
        }

        physics.step(stats.delta);

        let physics = Arc::new(physics);
        let chunks = Arc::new(chunks);

        // Collision detection, push bodies away from one another.
        (&curr_chunks, &mut bodies, &interactors, !&client_flag)
            .par_join()
            .for_each(|(curr_chunk, body, interactor, _)| {
                if !chunks.is_chunk_ready(&curr_chunk.coords) {
                    return;
                }

                let (rapier_body, _) =
                    physics.get(&interactor.body_handle, &interactor.collider_handle);

                let after = rapier_body.translation();

                let Vec3(px, py, pz) = body.0.get_position();

                let dx = after.x - px;
                let dy = after.y - py;
                let dz = after.z - pz;

                let dx = if dx.abs() < 0.0001 { 0.0 } else { dx };
                let dy = if dy.abs() < 0.0001 { 0.0 } else { dy };
                let dz = if dz.abs() < 0.0001 { 0.0 } else { dz };

                body.0.apply_impulse(
                    (dx * config.collision_repulsion).min(3.0),
                    (dy * config.collision_repulsion).min(3.0),
                    (dz * config.collision_repulsion).min(3.0),
                );
            });
    }
}
