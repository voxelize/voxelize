use specs::{ReadExpect, ReadStorage, System, WriteStorage};
use voxelize::{DirectionComp, PositionComp, Stats, Vec3};

use super::super::components::FaunaComp;

/// Moves every fauna along its deterministic orbit as a pure function of
/// wall-clock time, so a 150+ mover replication stress scene has smooth,
/// reproducible, physics-free motion at a few blocks per second.
pub struct FaunaWanderSystem;

impl<'a> System<'a> for FaunaWanderSystem {
    type SystemData = (
        ReadExpect<'a, Stats>,
        ReadStorage<'a, FaunaComp>,
        WriteStorage<'a, PositionComp>,
        WriteStorage<'a, DirectionComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use specs::Join;

        let (stats, faunas, mut positions, mut directions) = data;
        let t = stats.elapsed().as_secs_f32();

        for (fauna, position, direction) in (&faunas, &mut positions, &mut directions).join() {
            let ax = fauna.angular_speed_x * t + fauna.phase;
            let az = fauna.angular_speed_z * t + fauna.phase * 1.7;

            position.0 = Vec3(
                fauna.center.0 + fauna.radius_x * ax.sin(),
                fauna.center.1 + fauna.bob_amplitude * (0.8 * t + fauna.phase).sin(),
                fauna.center.2 + fauna.radius_z * az.cos(),
            );

            let velocity_x = fauna.radius_x * fauna.angular_speed_x * ax.cos();
            let velocity_z = -fauna.radius_z * fauna.angular_speed_z * az.sin();
            let speed = (velocity_x * velocity_x + velocity_z * velocity_z).sqrt();
            if speed > f32::EPSILON {
                direction.0 = Vec3(velocity_x / speed, 0.0, velocity_z / speed);
            }
        }
    }
}
