use specs::{ReadStorage, System, WriteStorage};
use voxelize::MetadataComp;

use crate::worlds::shared::components::VariantComp;

pub struct VariantMetadataSystem;

impl<'a> System<'a> for VariantMetadataSystem {
    type SystemData = (ReadStorage<'a, VariantComp>, WriteStorage<'a, MetadataComp>);

    fn run(&mut self, data: Self::SystemData) {
        use specs::Join;

        let (variants, mut metadatas) = data;

        for (variant, metadata) in (&variants, &mut metadatas).join() {
            // A newtype serializes as its string: `"variant": "moss"`.
            metadata.set("variant", variant);
        }
    }
}
