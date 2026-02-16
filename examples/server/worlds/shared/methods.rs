use log::warn;
use serde::{Deserialize, Serialize};
use specs::{Join, WorldExt};
use voxelize::{EntityFlag, IDComp, Vec3, World};

use super::components::TextComp;

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
        if !time_per_day.is_finite() || time_per_day <= 0.0 {
            warn!(
                "Ignoring time update because time_per_day is invalid: {}",
                time_per_day
            );
            return;
        }
        let parsed_time: TimeMethodPayload = match serde_json::from_str(payload) {
            Ok(parsed_time) => parsed_time,
            Err(error) => {
                warn!("Ignoring invalid time payload '{}': {}", payload, error);
                return;
            }
        };
        if !parsed_time.time.is_finite() {
            warn!(
                "Ignoring time update because payload time is invalid: {}",
                parsed_time.time
            );
            return;
        }
        world
            .stats_mut()
            .set_time(parsed_time.time.rem_euclid(time_per_day));
    });

    world.set_method_handle("spawn-bot", |world, _, payload| {
        let data: SpawnMethodPayload = match serde_json::from_str(payload) {
            Ok(data) => data,
            Err(error) => {
                warn!("Ignoring invalid spawn-bot payload '{}': {}", payload, error);
                return;
            }
        };
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
            if let Err(error) = world.ecs_mut().delete_entity(entity) {
                warn!("Failed to delete bot entity {:?}: {:?}", entity, error);
            }
        }
    });

    world.set_method_handle("add-floating-text", |world, _, payload| {
        let data: AddFloatingTextPayload = match serde_json::from_str(payload) {
            Ok(data) => data,
            Err(error) => {
                warn!(
                    "Ignoring invalid add-floating-text payload '{}': {}",
                    payload, error
                );
                return;
            }
        };
        let text = data.text;

        if let Some(entity) = world.spawn_entity_at("floating-text", &data.position) {
            if let Err(error) = world
                .ecs_mut()
                .write_storage::<TextComp>()
                .insert(entity, TextComp::new(&text))
            {
                warn!(
                    "Failed to insert TextComp for floating text entity {:?}: {:?}",
                    entity, error
                );
            }
        }
    });

    world.set_method_handle("remove-floating-text", |world, _, payload| {
        let data: RemoveFloatingTextPayload = match serde_json::from_str(payload) {
            Ok(data) => data,
            Err(error) => {
                warn!(
                    "Ignoring invalid remove-floating-text payload '{}': {}",
                    payload, error
                );
                return;
            }
        };
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
            if let Err(error) = world.ecs_mut().delete_entity(entity) {
                warn!(
                    "Failed to delete floating text entity {:?}: {:?}",
                    entity, error
                );
            }
        }
    });
}
