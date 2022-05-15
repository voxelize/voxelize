use specs::{ReadExpect, System, WriteStorage};

use crate::{
    chunks::Chunks,
    world::{
        components::rigidbody::RigidBodyComp, physics::Physics, registry::Registry, stats::Stats,
        voxels::access::VoxelAccess, WorldConfig,
    },
};

pub struct PhysicsSystem;

impl<'a> System<'a> for PhysicsSystem {
    type SystemData = (
        ReadExpect<'a, Stats>,
        ReadExpect<'a, Registry>,
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, Chunks>,
        WriteStorage<'a, RigidBodyComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use specs::Join;

        let (stats, registry, config, chunks, mut bodies) = data;

        let get_voxel = |vx: i32, vy: i32, vz: i32| chunks.get_voxel(vx, vy, vz);

        for body in (&mut bodies).join() {
            Physics::iterate_body(&mut body.0, stats.delta, &get_voxel, &config, &registry);
        }
    }
}
