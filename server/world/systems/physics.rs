use specs::{ReadExpect, ReadStorage, System, WriteStorage};

use crate::world::{
    components::{CurrentChunkComp, PositionComp, RigidBodyComp},
    physics::Physics,
    registry::Registry,
    stats::Stats,
    voxels::{Chunks, VoxelAccess},
    WorldConfig,
};

pub struct PhysicsSystem;

impl<'a> System<'a> for PhysicsSystem {
    type SystemData = (
        ReadExpect<'a, Stats>,
        ReadExpect<'a, Registry>,
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, Chunks>,
        ReadStorage<'a, CurrentChunkComp>,
        WriteStorage<'a, RigidBodyComp>,
        WriteStorage<'a, PositionComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use specs::Join;

        let (stats, registry, config, chunks, curr_chunks, mut bodies, mut positions) = data;

        let get_voxel = |vx: i32, vy: i32, vz: i32| chunks.get_voxel(vx, vy, vz);

        for (curr_chunk, body, position) in (&curr_chunks, &mut bodies, &mut positions).join() {
            if !chunks.is_chunk_ready(&curr_chunk.coords) {
                continue;
            }

            Physics::iterate_body(&mut body.0, stats.delta, &get_voxel, &registry, &config);
            position.0.copy(&body.0.get_position());
        }
    }
}
