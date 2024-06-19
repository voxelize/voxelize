use fern::meta;
use serde::Deserialize;
use specs::Entity;
use voxelize::{default_client_parser, World};

use super::components::{HoldingObjectIdComp, RoleComp};

#[derive(Deserialize, Default)]
struct ClientJSON {
    // role: String,
    holding_object_id: u32,
}

fn client_modifier(world: &mut World, ent: Entity) {
    world.add(ent, RoleComp::default());
    world.add(ent, HoldingObjectIdComp::default());
}

fn client_parser(world: &mut World, metadata: &str, ent: Entity) {
    default_client_parser(world, metadata, ent.to_owned());

    let metadata = serde_json::from_str::<ClientJSON>(metadata).unwrap_or_default();

    // {
    //     let mut roles = world.write_component::<RoleComp>();
    //     if let Some(role) = roles.get_mut(ent) {
    //         role.0 = metadata.role.to_owned();
    //     }
    // }

    {
        let mut holding_object_ids = world.write_component::<HoldingObjectIdComp>();
        if let Some(holding_object_id) = holding_object_ids.get_mut(ent) {
            holding_object_id.0 = metadata.holding_object_id;
        }
    }
}

pub fn setup_client(world: &mut World) {
    world.set_client_parser(client_parser);
    world.set_client_modifier(client_modifier);
}
