use serde_json::json;
use specs::{ReadExpect, ReadStorage, System, WriteStorage};

use crate::world::{
    components::{
        DirectionComp, EntityFlag, JsonComp, MetadataComp, PositionComp, RigidBodyComp, VoxelComp,
    },
    system_profiler::WorldTimingContext,
};

pub struct EntitiesMetaSystem;

impl<'a> System<'a> for EntitiesMetaSystem {
    type SystemData = (
        ReadStorage<'a, EntityFlag>,
        ReadStorage<'a, PositionComp>,
        ReadStorage<'a, DirectionComp>,
        ReadStorage<'a, RigidBodyComp>,
        ReadStorage<'a, VoxelComp>,
        ReadStorage<'a, JsonComp>,
        WriteStorage<'a, MetadataComp>,
        ReadExpect<'a, WorldTimingContext>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (flag, positions, directions, rigid_bodies, voxels, jsons, mut metadatas, timing) =
            data;
        let _t = timing.timer("entities-meta");

        (&positions, &mut metadatas, &flag)
            .par_join()
            .for_each(|(position, metadata, _)| {
                metadata.set("position", position);
            });

        (&directions, &mut metadatas, &flag)
            .par_join()
            .for_each(|(direction, metadata, _)| {
                metadata.set("direction", direction);
            });

        (&rigid_bodies, &mut metadatas, &flag)
            .par_join()
            .for_each(|(body, metadata, _)| {
                metadata.set_value(
                    "rigidBody",
                    json!({
                        "isInFluid": body.0.in_fluid,
                        "fluidRatio": body.0.ratio_in_fluid,
                    }),
                );
            });

        (&voxels, &jsons, &mut metadatas, &flag)
            .par_join()
            .for_each(|(voxel, json, metadata, _)| {
                metadata.set("voxel", voxel);
                metadata.set("json", json);
            });
    }
}
