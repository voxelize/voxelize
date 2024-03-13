use specs::{ReadStorage, System, WriteStorage};

use crate::{
    world::components::{EntityFlag, MetadataComp, PositionComp}, JsonComp, VoxelComp
};

pub struct EntitiesMetaSystem;

impl<'a> System<'a> for EntitiesMetaSystem {
    type SystemData = (
        ReadStorage<'a, EntityFlag>,
        ReadStorage<'a, PositionComp>,
        ReadStorage<'a, VoxelComp>,
        ReadStorage<'a, JsonComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (flag, positions, voxels, jsons,mut metadatas) = data;

        (&positions, &mut metadatas, &flag)
            .par_join()
            .for_each(|(position, metadata, _)| {
                metadata.set("position", position);
            });

        (&voxels, &mut metadatas, &flag)
            .par_join()
            .for_each(|(voxel, metadata, _)| {
                metadata.set("voxel", voxel);
            });

        (&jsons, &mut metadatas, &flag)
            .par_join()
            .for_each(|(json, metadata, _)| {
                metadata.set("json", json);
            });
    }
}
