mod flags;
mod holding_object_id;
mod role;
mod text;

use specs::WorldExt;

pub use flags::*;
pub use holding_object_id::HoldingObjectIdComp;
pub use role::RoleComp;
pub use text::TextComp;

use voxelize::World;

pub fn setup_components(world: &mut World) {
    world.ecs_mut().register::<TextComp>();
    world.ecs_mut().register::<BotFlag>();
    world.ecs_mut().register::<RoleComp>();
    world.ecs_mut().register::<HoldingObjectIdComp>();
}
