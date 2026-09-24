use crate::{MetadataComp, PathComp};
use specs::{ReadStorage, System, WriteStorage};

pub struct PathMetadataSystem;

impl<'a> System<'a> for PathMetadataSystem {
    type SystemData = (ReadStorage<'a, PathComp>, WriteStorage<'a, MetadataComp>);

    fn run(&mut self, data: Self::SystemData) {
        use specs::Join;

        let (paths, mut metadatas) = data;

        (&paths, &mut metadatas)
            .join()
            .for_each(|(path, metadata)| {
                metadata.set("path", path);
            });
    }
}
