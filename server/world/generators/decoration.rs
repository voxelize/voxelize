use hashbrown::HashMap;

use crate::{common::BlockChange, vec::Vec3};

pub struct Decoration {
    pub blocks: Vec<BlockChange>,
}

impl Decoration {
    pub fn new() -> DecorationBuilder {
        DecorationBuilder::default()
    }
}

pub enum RectMode {
    Center,
    Corner,
}

pub struct DecorationBuilder {
    pub rect_mode: RectMode,
    pub changes: HashMap<Vec3<i32>, u32>,
}

impl Default for DecorationBuilder {
    fn default() -> Self {
        Self {
            rect_mode: RectMode::Center,
            ..Default::default()
        }
    }
}

impl DecorationBuilder {
    pub fn rect(mut self, base: &Vec3<i32>, width: usize, height: usize) -> Self {
        todo!()
    }

    pub fn rect_vert(mut self, base: &Vec3<i32>, width: usize, height: usize) -> Self {
        todo!()
    }
}
