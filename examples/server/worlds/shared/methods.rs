use nanoid::nanoid;
use serde::{Deserialize, Serialize};
use specs::{Builder, Join, WorldExt};
use voxelize::{
    CollisionsComp, CurrentChunkComp, DirectionComp, DoNotPersistComp, ETypeComp, EntityFlag,
    IDComp, MetadataComp, PositionComp, Vec3, World,
};

use super::components::{BotFlag, FaunaComp, TextComp};

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

#[derive(Serialize, Deserialize, Debug)]
struct SpawnFaunaPayload {
    position: Vec3<f32>,
    count: usize,
}

#[derive(Serialize, Deserialize, Debug)]
struct BenchLightsPayload {
    scene: String,
    block: String,
    origin: Vec3<i32>,
    #[serde(default)]
    count: u32,
}

#[derive(Serialize, Deserialize, Debug)]
struct BreakWithDropPayload {
    voxel: Vec3<i32>,
}

#[derive(Serialize, Deserialize, Debug)]
struct PickupDropPayload {
    id: String,
}

pub fn setup_methods(world: &mut World) {
    world.set_method_handle("time", |world, _, payload| {
        let time_per_day = world.config().time_per_day as f32;
        let new_time: TimeMethodPayload = serde_json::from_str(&payload).unwrap();
        world.stats_mut().set_time(new_time.time % time_per_day);
    });

    // Deterministic emitter layouts for the local-lights benchmark scenes.
    // Every scene is a pure function of (origin, count), so a run on this
    // branch and a run on main see byte-identical worlds.
    world.set_method_handle("bench-lights", |world, _, payload| {
        let data: BenchLightsPayload = serde_json::from_str(&payload).unwrap();
        let Some(block_id) = world
            .registry()
            .try_get_block_by_name(&data.block)
            .map(|block| block.id)
        else {
            return;
        };
        let Vec3(ox, oy, oz) = data.origin;
        let count = data.count.min(20_000) as i32;

        match data.scene.as_str() {
            // `count` emitters in a square grid, 4-block spacing.
            "grid" => {
                let side = (count as f32).sqrt().ceil() as i32;
                let mut placed = 0;
                'grid: for gx in 0..side {
                    for gz in 0..side {
                        if placed >= count {
                            break 'grid;
                        }
                        world
                            .chunks_mut()
                            .update_voxel(&Vec3(ox + gx * 4, oy, oz + gz * 4), block_id);
                        placed += 1;
                    }
                }
            }
            // `count` emitters packed side by side: the aggregation stress.
            "field" => {
                let side = (count as f32).sqrt().ceil() as i32;
                let mut placed = 0;
                'field: for gx in 0..side {
                    for gz in 0..side {
                        if placed >= count {
                            break 'field;
                        }
                        world
                            .chunks_mut()
                            .update_voxel(&Vec3(ox + gx, oy, oz + gz), block_id);
                        placed += 1;
                    }
                }
            }
            // A roofed corridor along +x with `count` emitters alternating
            // between its walls every 4 blocks.
            "tunnel" => {
                let stone_id = world
                    .registry()
                    .try_get_block_by_name("Stone")
                    .map(|stone| stone.id)
                    .unwrap_or(block_id);
                let length = (count / 2).max(1) * 4 + 4;
                for gx in 0..length {
                    for gy in 0..5 {
                        world
                            .chunks_mut()
                            .update_voxel(&Vec3(ox + gx, oy + gy, oz - 3), stone_id);
                        world
                            .chunks_mut()
                            .update_voxel(&Vec3(ox + gx, oy + gy, oz + 3), stone_id);
                    }
                    for gz in -3..=3 {
                        world
                            .chunks_mut()
                            .update_voxel(&Vec3(ox + gx, oy - 1, oz + gz), stone_id);
                        world
                            .chunks_mut()
                            .update_voxel(&Vec3(ox + gx, oy + 5, oz + gz), stone_id);
                    }
                }
                for n in 0..count {
                    let gx = 2 + (n / 2) * 4;
                    let gz = if n % 2 == 0 { -2 } else { 2 };
                    world
                        .chunks_mut()
                        .update_voxel(&Vec3(ox + gx, oy + 2, oz + gz), block_id);
                }
            }
            // Clear the single emitter layer of a `count`-sided square —
            // exactly what "grid" and "field" wrote, so a clear never floods
            // the update queue.
            "clear" => {
                let side = count.max(1);
                for gx in -2..side + 2 {
                    for gz in -2..side + 2 {
                        world
                            .chunks_mut()
                            .update_voxel(&Vec3(ox + gx, oy, oz + gz), 0);
                    }
                }
            }
            // Clear the box a `count`-emitter tunnel occupies.
            "clear-tunnel" => {
                let length = (count / 2).max(1) * 4 + 6;
                for gx in -1..length {
                    for gz in -4..=4 {
                        for gy in -1..=6 {
                            world
                                .chunks_mut()
                                .update_voxel(&Vec3(ox + gx, oy + gy, oz + gz), 0);
                        }
                    }
                }
            }
            _ => {}
        }
    });

    world.set_method_handle("spawn-bot", |world, _, payload| {
        let data: SpawnMethodPayload = serde_json::from_str(&payload).unwrap();
        world.spawn_entity_at("bot", &data.position);
    });

    // The replication stress scenario: `count` deterministic wanderers
    // orbiting around the given position, moving smoothly every tick with
    // zero physics cost. Each carries ~700 bytes of static text metadata to
    // mirror the incident shape (Town fauna carry heavy game JSON that the
    // whole-map staging used to resend on every position change).
    // Non-persistent by design so stress runs are repeatable.
    world.set_method_handle("spawn-fauna", |world, _, payload| {
        let data: SpawnFaunaPayload = serde_json::from_str(&payload).unwrap();
        let count = data.count.clamp(1, 1000);

        for i in 0..count {
            let golden_angle = i as f32 * 2.399963;
            let ring_radius = 6.0 + (i % 40) as f32 * 0.9;
            let center = Vec3(
                data.position.0 + ring_radius * golden_angle.cos(),
                data.position.1 + 1.5 + (i % 5) as f32 * 0.8,
                data.position.2 + ring_radius * golden_angle.sin(),
            );
            let fauna = FaunaComp {
                center: center.clone(),
                radius_x: 2.0 + (i % 7) as f32 * 0.8,
                radius_z: 2.0 + (i % 5) as f32 * 1.0,
                angular_speed_x: 0.6 + (i % 9) as f32 * 0.15,
                angular_speed_z: 0.5 + (i % 11) as f32 * 0.12,
                bob_amplitude: 0.4,
                phase: golden_angle,
            };
            let dressing = format!("fauna-{:03} {}", i, "lorem-metadata-weight ".repeat(32));
            world
                .create_entity(&nanoid!(), "fauna")
                .with(PositionComp::new(center.0, center.1, center.2))
                .with(DirectionComp::default())
                .with(DoNotPersistComp)
                .with(TextComp::new(&dressing))
                .with(fauna)
                .build();
        }
    });

    // The survival-loop acceptance path: an authoritative break that clears
    // the voxel AND spawns a reliable "drop" entity at it, echoed to every
    // interested client. Models break -> drop CREATE -> pickup causality
    // without any client-local granting.
    world.set_method_handle("break-with-drop", |world, _, payload| {
        let data: BreakWithDropPayload = serde_json::from_str(&payload).unwrap();
        let Vec3(vx, vy, vz) = data.voxel;

        world.chunks_mut().update_voxel(&data.voxel, 0);

        // Hover the drop above the broken voxel so it is visible from any
        // camera angle instead of being occluded by the hole's walls.
        world
            .create_entity(&nanoid!(), "drop")
            .with(PositionComp::new(
                vx as f32 + 0.5,
                vy as f32 + 1.4,
                vz as f32 + 0.5,
            ))
            .with(DoNotPersistComp)
            .build();
    });

    // Authoritative pickup: deleting the drop emits its reliable DELETE
    // lifecycle to every client that streams it.
    world.set_method_handle("pickup-drop", |world, _, payload| {
        let data: PickupDropPayload = serde_json::from_str(&payload).unwrap();
        let entities = world.ecs().entities();
        let ids = world.ecs().read_storage::<IDComp>();

        let mut to_delete = None;
        for (entity, id_comp) in (&entities, &ids).join() {
            if id_comp.0 == data.id {
                to_delete = Some(entity);
                break;
            }
        }
        drop((entities, ids));

        if let Some(entity) = to_delete {
            world
                .ecs_mut()
                .delete_entity(entity)
                .expect("Failed to delete drop entity");
        }
    });

    world.set_method_handle("clear-fauna", |world, _, _| {
        let entities = world.ecs().entities();
        let faunas = world.ecs().read_storage::<FaunaComp>();

        let mut to_delete = vec![];
        for (entity, _) in (&entities, &faunas).join() {
            to_delete.push(entity);
        }
        drop((entities, faunas));

        for entity in to_delete {
            world
                .ecs_mut()
                .delete_entity(entity)
                .expect("Failed to delete fauna entity");
        }
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
