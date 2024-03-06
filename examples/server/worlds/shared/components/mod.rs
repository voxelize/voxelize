mod flags;
mod role;
mod rotation;
mod text;

use specs::WorldExt;

pub use flags::*;
pub use role::RoleComp;
pub use rotation::RotationComp;
pub use text::TextComp;

use voxelize::World;

pub fn setup_components(world: &mut World) {
    world.ecs_mut().register::<TextComp>();
    world.ecs_mut().register::<RotationComp>();
    world.ecs_mut().register::<BotFlag>();
    world.ecs_mut().register::<RoleComp>();
}
