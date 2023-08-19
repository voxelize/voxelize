use serde::{Deserialize, Serialize};

use super::UV;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CornerData {
    pub pos: [f32; 3],
    pub uv: [f32; 2],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockFace {
    pub name: String,
    pub independent: bool,
    pub dir: [i32; 3],
    pub corners: [CornerData; 4],
    pub range: UV,
}

impl BlockFace {
    pub fn new(name: String, independent: bool, dir: [i32; 3], corners: [CornerData; 4]) -> Self {
        Self {
            name,
            independent,
            dir,
            corners,
            range: UV::default(),
        }
    }

    pub fn into_independent(&mut self) {
        self.independent = true;
    }
}
