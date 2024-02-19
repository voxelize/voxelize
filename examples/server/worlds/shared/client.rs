use serde::Deserialize;
use specs::Entity;
use voxelize::{default_client_parser, World};

use super::components::RoleComp;

#[derive(Deserialize, Default)]
struct ClientJSON {
    role: String,
}

fn client_modifier(world: &mut World, ent: Entity) {
    world.add(ent, RoleComp::default());
}

fn client_parser(world: &mut World, metadata: &str, ent: Entity) {
    default_client_parser(world, metadata, ent.to_owned());

    let metadata = serde_json::from_str::<ClientJSON>(metadata).unwrap_or_default();

    {
        let mut roles = world.write_component::<RoleComp>();
        if let Some(role) = roles.get_mut(ent) {
            role.0 = metadata.role.to_owned();
        }
    }
}

pub fn setup_client(world: &mut World) {
    world.set_client_parser(client_parser);
    world.set_client_modifier(client_modifier);
}
