use serde_json::{json, Value};
use specs::{ReadStorage, System, WriteStorage};

use crate::world::components::{
    CollidersComp, DirectionComp, EntityFlag, JsonComp, MetadataComp, PositionComp, RigidBodyComp,
    VoxelComp,
};

const COLLIDERS_KEY: &str = "colliders";

pub struct EntitiesMetaSystem;

impl<'a> System<'a> for EntitiesMetaSystem {
    type SystemData = (
        ReadStorage<'a, EntityFlag>,
        ReadStorage<'a, PositionComp>,
        ReadStorage<'a, DirectionComp>,
        ReadStorage<'a, RigidBodyComp>,
        ReadStorage<'a, CollidersComp>,
        ReadStorage<'a, VoxelComp>,
        ReadStorage<'a, JsonComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use specs::Join;

        let (flag, positions, directions, rigid_bodies, colliders, voxels, jsons, mut metadatas) =
            data;

        (&positions, &mut metadatas, &flag)
            .join()
            .for_each(|(position, metadata, _)| {
                metadata.set("position", position);
            });

        (&directions, &mut metadatas, &flag)
            .join()
            .for_each(|(direction, metadata, _)| {
                metadata.set("direction", direction);
            });

        (&rigid_bodies, &mut metadatas, &flag)
            .join()
            .for_each(|(body, metadata, _)| {
                metadata.set_value(
                    "rigidBody",
                    json!({
                        "isInFluid": body.0.in_fluid,
                        "fluidRatio": body.0.ratio_in_fluid,
                    }),
                );
            });

        (&colliders, &mut metadatas, &flag)
            .join()
            .for_each(|(colliders, metadata, _)| {
                metadata.set(COLLIDERS_KEY, colliders);
            });

        // A client keeps every metadata key it has seen, so an entity whose
        // colliders were taken away keeps the key, emptied; dropped, its
        // last boxes would stay solid on every client.
        (&mut metadatas, !&colliders, &flag)
            .join()
            .for_each(|(metadata, _, _)| {
                let has_boxes = metadata
                    .map
                    .get(COLLIDERS_KEY)
                    .and_then(Value::as_array)
                    .is_some_and(|boxes| !boxes.is_empty());
                if has_boxes {
                    metadata.set_value(COLLIDERS_KEY, json!([]));
                }
            });

        (&voxels, &jsons, &mut metadatas, &flag)
            .join()
            .for_each(|(voxel, json, metadata, _)| {
                metadata.set("voxel", voxel);
                metadata.set("json", json);
            });
    }
}

#[cfg(test)]
mod tests {
    use specs::{Builder, RunNow, World, WorldExt};

    use super::*;
    use crate::AABB;

    fn meta_world() -> World {
        let mut world = World::new();
        world.register::<EntityFlag>();
        world.register::<PositionComp>();
        world.register::<DirectionComp>();
        world.register::<RigidBodyComp>();
        world.register::<CollidersComp>();
        world.register::<VoxelComp>();
        world.register::<JsonComp>();
        world.register::<MetadataComp>();
        world
    }

    fn colliders_of(world: &World, entity: specs::Entity) -> Option<Value> {
        world
            .read_storage::<MetadataComp>()
            .get(entity)
            .unwrap()
            .map
            .get(COLLIDERS_KEY)
            .cloned()
    }

    #[test]
    fn colliders_ride_the_metadata_and_empty_when_taken_away() {
        let mut world = meta_world();
        let solid = world
            .create_entity()
            .with(EntityFlag)
            .with(PositionComp::new(4.0, 10.0, -2.0))
            .with(CollidersComp::new(&[AABB::new()
                .offset_x(-1.0)
                .offset_z(-1.0)
                .scale_x(2.0)
                .scale_y(3.0)
                .scale_z(2.0)
                .build()]))
            .with(MetadataComp::new())
            .build();
        let plain = world
            .create_entity()
            .with(EntityFlag)
            .with(PositionComp::new(0.0, 0.0, 0.0))
            .with(MetadataComp::new())
            .build();

        EntitiesMetaSystem.run_now(&world);
        assert_eq!(
            colliders_of(&world, solid),
            Some(json!([[-1.0, 0.0, -1.0, 1.0, 3.0, 1.0]]))
        );
        assert_eq!(colliders_of(&world, plain), None);

        world.write_storage::<CollidersComp>().remove(solid);
        EntitiesMetaSystem.run_now(&world);
        assert_eq!(colliders_of(&world, solid), Some(json!([])));
        assert_eq!(colliders_of(&world, plain), None);
    }
}
