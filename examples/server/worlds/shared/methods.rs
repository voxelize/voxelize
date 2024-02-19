use nanoid::nanoid;
use serde::{Deserialize, Serialize};
use specs::{Builder, Join, WorldExt};
use voxelize::{
    CollisionsComp, CurrentChunkComp, ETypeComp, EntityFlag, IDComp, MetadataComp, PositionComp,
    Vec3, World,
};

use super::components::{BotFlag, TextComp};

#[derive(Serialize, Deserialize, Debug)]
struct TimeMethodPayload {
    time: f32,
}

#[derive(Serialize, Deserialize, Debug)]
struct AddFloatingTextPayload {
    text: String,
    position: Vec3<f32>,
}

#[derive(Serialize, Deserialize, Debug)]
struct RemoveFloatingTextPayload {
    id: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct SpawnMethodPayload {
    position: Vec3<f32>,
}

pub fn setup_methods(world: &mut World) {
    world.set_method_handle("time", |world, _, payload| {
        let time_per_day = world.config().time_per_day as f32;
        let new_time: TimeMethodPayload = serde_json::from_str(&payload).unwrap();
        world.stats_mut().set_time(new_time.time % time_per_day);
    });

    world.set_method_handle("spawn-bot", |world, _, payload| {
        let data: SpawnMethodPayload = serde_json::from_str(&payload).unwrap();
        world.spawn_entity_at("bot", &data.position);
    });

    world.set_method_handle("kill-all-bots", |world, _, _| {
        let bot_entities = world
            .ecs()
            .entities()
            .join()
            .filter(|entity| {
                world
                    .ecs()
                    .read_storage::<EntityFlag>()
                    .get(*entity)
                    .is_some()
            })
            .collect::<Vec<_>>();

        for entity in bot_entities {
            world
                .ecs_mut()
                .delete_entity(entity)
                .expect("Failed to delete entity");
        }
    });

    world.set_method_handle("add-floating-text", |world, _, payload| {
        let data: AddFloatingTextPayload = serde_json::from_str(&payload).unwrap();
        let text = data.text;

        if let Some(entity) = world.spawn_entity_at("floating-text", &data.position) {
            world
                .ecs_mut()
                .write_storage::<TextComp>()
                .insert(entity, TextComp::new(&text))
                .unwrap();
        }
    });

    world.set_method_handle("remove-floating-text", |world, _, payload| {
        let data: RemoveFloatingTextPayload = serde_json::from_str(&payload).unwrap();
        let id = data.id;
        let entities = world.ecs().entities();
        let ids = world.ecs().read_storage::<IDComp>();

        let mut to_delete = vec![];

        for (entity, id_comp) in (&entities, &ids).join() {
            if id_comp.0 == id {
                to_delete.push(entity);
            }
        }

        drop((entities, ids));

        for entity in to_delete {
            world
                .ecs_mut()
                .delete_entity(entity)
                .expect("Failed to delete entity");
        }
    });
}
