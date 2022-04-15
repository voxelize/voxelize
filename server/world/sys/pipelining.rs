use specs::{ReadExpect, System, WriteExpect};

use crate::{
    chunks::Chunks,
    pipeline::Pipeline,
    world::{registry::Registry, WorldConfig},
};

pub struct PipeliningSystem;

impl<'a> System<'a> for PipeliningSystem {
    type SystemData = (
        ReadExpect<'a, Registry>,
        ReadExpect<'a, WorldConfig>,
        WriteExpect<'a, Pipeline>,
        WriteExpect<'a, Chunks>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (registry, config, mut pipeline, mut chunks) = data;
    }
}
