use crate::{MetadataComp, TargetComp};
use specs::{ReadStorage, System, WriteStorage};

pub struct TargetMetadataSystem;

impl<'a> System<'a> for TargetMetadataSystem {
    type SystemData = (ReadStorage<'a, TargetComp>, WriteStorage<'a, MetadataComp>);

    fn run(&mut self, data: Self::SystemData) {
        use specs::Join;

        let (targets, mut metadatas) = data;

        (&targets, &mut metadatas)
            .join()
            .for_each(|(target, metadata)| {
                metadata.set("target", target);
            });
    }
}
