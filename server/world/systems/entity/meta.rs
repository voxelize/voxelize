use specs::{ReadExpect, ReadStorage, System, WriteStorage};

use crate::world::{
    components::{DirectionComp, EntityFlag, JsonComp, MetadataComp, PositionComp, VoxelComp},
    system_profiler::WorldTimingContext,
};

pub struct EntitiesMetaSystem;

impl<'a> System<'a> for EntitiesMetaSystem {
    type SystemData = (
        ReadStorage<'a, EntityFlag>,
        ReadStorage<'a, PositionComp>,
        ReadStorage<'a, DirectionComp>,
        ReadStorage<'a, VoxelComp>,
        ReadStorage<'a, JsonComp>,
        WriteStorage<'a, MetadataComp>,
        ReadExpect<'a, WorldTimingContext>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::{LendJoin, ParJoin};

        let (flag, positions, directions, voxels, jsons, mut metadatas, timing) = data;
        let _t = timing.timer("entities-meta");

        (
            &mut metadatas,
            &flag,
            positions.maybe(),
            directions.maybe(),
            voxels.maybe(),
            jsons.maybe(),
        )
            .par_join()
            .for_each(|(metadata, _, position, direction, voxel, json)| {
                if let Some(position) = position {
                    metadata.set("position", position);
                }
                if let Some(direction) = direction {
                    metadata.set("direction", direction);
                }
                if let (Some(voxel), Some(json)) = (voxel, json) {
                    metadata.set("voxel", voxel);
                    metadata.set("json", json);
                }
            });
    }
}
