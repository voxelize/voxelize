mod brain;
mod flags;
mod path;
mod role;
mod rotation;
mod target;
mod text;

use specs::WorldExt;

// pub use brain::BrainComp;
pub use flags::*;
// pub use path::PathComp;
pub use role::RoleComp;
pub use rotation::RotationComp;
// pub use target::TargetComp;
pub use text::TextComp;

use voxelize::World;

pub fn setup_components(world: &mut World) {
    world.ecs_mut().register::<TextComp>();
    // world.ecs_mut().register::<BrainComp>();
    // world.ecs_mut().register::<TargetComp>();
    world.ecs_mut().register::<RotationComp>();
    // world.ecs_mut().register::<PathComp>();
    world.ecs_mut().register::<BotFlag>();
    world.ecs_mut().register::<RoleComp>();
}
