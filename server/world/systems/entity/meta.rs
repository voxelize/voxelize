use specs::{ReadStorage, System, WriteStorage};

use crate::{
    world::components::{EntityFlag, MetadataComp, PositionComp},
    VoxelComp,
};

pub struct EntitiesMetaSystem;

impl<'a> System<'a> for EntitiesMetaSystem {
    type SystemData = (
        ReadStorage<'a, EntityFlag>,
        ReadStorage<'a, PositionComp>,
        ReadStorage<'a, VoxelComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (flag, positions, voxels, mut metadatas) = data;

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
    }
}
