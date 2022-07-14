use specs::{ReadStorage, System, WriteStorage};

use crate::{AnimationComp, MetadataComp};

pub struct AnimationMetaSystem;

impl<'a> System<'a> for AnimationMetaSystem {
    type SystemData = (
        ReadStorage<'a, AnimationComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (animations, mut metadatas) = data;

        (&animations, &mut metadatas)
            .par_join()
            .for_each(|(animation, metadata)| {
                if animation.0.is_none() {
                    return;
                }

                metadata.set("animation", animation);
            });
    }
}
