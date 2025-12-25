use serde::{Deserialize, Serialize};
use std::f32::consts::PI;

use crate::block::Y_ROT_SEGMENTS;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct UV {
    pub start_u: f32,
    pub end_u: f32,
    pub start_v: f32,
    pub end_v: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AABB {
    pub min_x: f32,
    pub min_y: f32,
    pub min_z: f32,
    pub max_x: f32,
    pub max_y: f32,
    pub max_z: f32,
}

#[derive(Debug, Clone, Default)]
pub struct AABBBuilder {
    scale_x: f32,
    scale_y: f32,
    scale_z: f32,
    offset_x: f32,
    offset_y: f32,
    offset_z: f32,
}

impl AABBBuilder {
    pub fn scale_x(mut self, scale_x: f32) -> Self {
        self.scale_x = scale_x;
        self
    }

    pub fn scale_y(mut self, scale_y: f32) -> Self {
        self.scale_y = scale_y;
        self
    }

    pub fn scale_z(mut self, scale_z: f32) -> Self {
        self.scale_z = scale_z;
        self
    }

    pub fn offset_x(mut self, offset_x: f32) -> Self {
        self.offset_x = offset_x;
        self
    }

    pub fn offset_y(mut self, offset_y: f32) -> Self {
        self.offset_y = offset_y;
        self
    }

    pub fn offset_z(mut self, offset_z: f32) -> Self {
        self.offset_z = offset_z;
        self
    }

    pub fn build(self) -> AABB {
        AABB {
            min_x: self.offset_x,
            min_y: self.offset_y,
            min_z: self.offset_z,
            max_x: self.offset_x + self.scale_x,
            max_y: self.offset_y + self.scale_y,
            max_z: self.offset_z + self.scale_z,
        }
    }
}

impl AABB {
    pub fn new() -> AABBBuilder {
        AABBBuilder {
            scale_x: 1.0,
            scale_y: 1.0,
            scale_z: 1.0,
            offset_x: 0.0,
            offset_y: 0.0,
            offset_z: 0.0,
        }
    }

    pub fn create(min_x: f32, min_y: f32, min_z: f32, max_x: f32, max_y: f32, max_z: f32) -> Self {
        Self {
            min_x,
            min_y,
            min_z,
            max_x,
            max_y,
            max_z,
        }
    }

    pub fn empty() -> Self {
        Self::default()
    }

    pub fn union_all(all: &[AABB]) -> AABB {
        if all.is_empty() {
            return AABB::empty();
        }

        let mut min_x = all[0].min_x;
        let mut min_y = all[0].min_y;
        let mut min_z = all[0].min_z;
        let mut max_x = all[0].max_x;
        let mut max_y = all[0].max_y;
        let mut max_z = all[0].max_z;

        for aabb in all {
            if aabb.min_x < min_x {
                min_x = aabb.min_x;
            }
            if aabb.min_y < min_y {
                min_y = aabb.min_y;
            }
            if aabb.min_z < min_z {
                min_z = aabb.min_z;
            }
            if aabb.max_x > max_x {
                max_x = aabb.max_x;
            }
            if aabb.max_y > max_y {
                max_y = aabb.max_y;
            }
            if aabb.max_z > max_z {
                max_z = aabb.max_z;
            }
        }

        AABB {
            min_x,
            min_y,
            min_z,
            max_x,
            max_y,
            max_z,
        }
    }

    pub fn union(&self, other: &AABB) -> AABB {
        AABB {
            min_x: self.min_x.min(other.min_x),
            min_y: self.min_y.min(other.min_y),
            min_z: self.min_z.min(other.min_z),
            max_x: self.max_x.max(other.max_x),
            max_y: self.max_y.max(other.max_y),
            max_z: self.max_z.max(other.max_z),
        }
    }

    #[inline]
    pub fn width(&self) -> f32 {
        self.max_x - self.min_x
    }

    #[inline]
    pub fn height(&self) -> f32 {
        self.max_y - self.min_y
    }

    #[inline]
    pub fn depth(&self) -> f32 {
        self.max_z - self.min_z
    }

    #[inline]
    pub fn mag(&self) -> f32 {
        (self.width() * self.width() + self.height() * self.height() + self.depth() * self.depth())
            .sqrt()
    }

    pub fn translate(&mut self, dx: f32, dy: f32, dz: f32) {
        self.min_x += dx;
        self.min_y += dy;
        self.min_z += dz;
        self.max_x += dx;
        self.max_y += dy;
        self.max_z += dz;
    }

    pub fn set_position(&mut self, px: f32, py: f32, pz: f32) {
        self.max_x = px + self.width();
        self.max_y = py + self.height();
        self.max_z = pz + self.depth();
        self.min_x = px;
        self.min_y = py;
        self.min_z = pz;
    }

    pub fn copy(&mut self, other: &AABB) {
        self.min_x = other.min_x;
        self.min_y = other.min_y;
        self.min_z = other.min_z;
        self.max_x = other.max_x;
        self.max_y = other.max_y;
        self.max_z = other.max_z;
    }

    pub fn intersection(&self, other: &AABB) -> AABB {
        AABB {
            min_x: self.min_x.max(other.min_x),
            min_y: self.min_y.max(other.min_y),
            min_z: self.min_z.max(other.min_z),
            max_x: self.max_x.min(other.max_x),
            max_y: self.max_y.min(other.max_y),
            max_z: self.max_z.min(other.max_z),
        }
    }

    pub fn touches(&self, other: &AABB) -> bool {
        let epsilon = 0.0001;
        (self.max_x - other.min_x).abs() < epsilon
            || (self.min_x - other.max_x).abs() < epsilon
            || (self.max_y - other.min_y).abs() < epsilon
            || (self.min_y - other.max_y).abs() < epsilon
            || (self.max_z - other.min_z).abs() < epsilon
            || (self.min_z - other.max_z).abs() < epsilon
    }

    pub fn intersects(&self, other: &AABB) -> bool {
        self.min_x < other.max_x
            && self.max_x > other.min_x
            && self.min_y < other.max_y
            && self.max_y > other.min_y
            && self.min_z < other.max_z
            && self.max_z > other.min_z
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct CornerData {
    pub pos: [f32; 3],
    pub uv: [f32; 2],
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct BlockFace {
    pub name: String,
    #[serde(skip, default)]
    pub name_lower: String,
    pub independent: bool,
    pub isolated: bool,
    #[serde(default)]
    pub texture_group: Option<String>,
    #[serde(default)]
    pub dir: [i32; 3],
    #[serde(default = "default_corners")]
    pub corners: [CornerData; 4],
    #[serde(default)]
    pub range: UV,
}

fn default_corners() -> [CornerData; 4] {
    [
        CornerData::default(),
        CornerData::default(),
        CornerData::default(),
        CornerData::default(),
    ]
}

impl BlockFace {
    pub fn new(
        name: String,
        independent: bool,
        isolated: bool,
        dir: [i32; 3],
        corners: [CornerData; 4],
    ) -> Self {
        Self {
            name: name.clone(),
            name_lower: name.to_lowercase(),
            independent,
            isolated,
            texture_group: None,
            dir,
            corners,
            range: UV::default(),
        }
    }

    pub fn compute_name_lower(&mut self) {
        self.name_lower = self.name.to_lowercase();
    }

    pub fn get_name_lower(&self) -> &str {
        if self.name_lower.is_empty() {
            &self.name
        } else {
            &self.name_lower
        }
    }
}

const PI_2: f32 = PI / 2.0;

#[derive(Debug, PartialEq, Serialize, Deserialize, Clone)]
pub enum BlockRotation {
    PX(f32),
    NX(f32),
    PY(f32),
    NY(f32),
    PZ(f32),
    NZ(f32),
}

impl Default for BlockRotation {
    fn default() -> Self {
        BlockRotation::PY(0.0)
    }
}

impl BlockRotation {
    pub fn encode(value: u32, y_rotation: u32) -> Self {
        let y_rotation = y_rotation as f32 * PI * 2.0 / Y_ROT_SEGMENTS as f32;

        match value {
            2 => BlockRotation::PX(y_rotation),
            3 => BlockRotation::NX(y_rotation),
            0 => BlockRotation::PY(y_rotation),
            1 => BlockRotation::NY(y_rotation),
            4 => BlockRotation::PZ(y_rotation),
            5 => BlockRotation::NZ(y_rotation),
            _ => BlockRotation::PY(y_rotation),
        }
    }

    pub fn decode(rotation: &Self) -> (u32, u32) {
        let convert_y_rot = |val: f32| {
            let val = val * Y_ROT_SEGMENTS as f32 / (PI * 2.0);
            (val.round() as u32) % Y_ROT_SEGMENTS
        };

        match rotation {
            BlockRotation::PX(rot) => (2, convert_y_rot(*rot)),
            BlockRotation::NX(rot) => (3, convert_y_rot(*rot)),
            BlockRotation::PY(rot) => (0, convert_y_rot(*rot)),
            BlockRotation::NY(rot) => (1, convert_y_rot(*rot)),
            BlockRotation::PZ(rot) => (4, convert_y_rot(*rot)),
            BlockRotation::NZ(rot) => (5, convert_y_rot(*rot)),
        }
    }

    pub fn rotate_node(&self, node: &mut [f32; 3], y_rotate: bool, translate: bool) {
        let rot = match self {
            BlockRotation::PX(rot) => rot,
            BlockRotation::NX(rot) => rot,
            BlockRotation::PY(rot) => rot,
            BlockRotation::NY(rot) => rot,
            BlockRotation::PZ(rot) => rot,
            BlockRotation::NZ(rot) => rot,
        };

        if y_rotate && (*rot).abs() > f32::EPSILON {
            node[0] -= 0.5;
            node[2] -= 0.5;
            self.rotate_y(node, *rot);
            node[0] += 0.5;
            node[2] += 0.5;
        }

        match self {
            BlockRotation::PX(_) => {
                self.rotate_z(node, -PI_2);
                if translate {
                    node[1] += 1.0;
                }
            }
            BlockRotation::NX(_) => {
                self.rotate_z(node, PI_2);
                if translate {
                    node[0] += 1.0;
                }
            }
            BlockRotation::PY(_) => {}
            BlockRotation::NY(_) => {
                self.rotate_x(node, PI_2 * 2.0);
                if translate {
                    node[1] += 1.0;
                    node[2] += 1.0;
                }
            }
            BlockRotation::PZ(_) => {
                self.rotate_x(node, PI_2);
                if translate {
                    node[1] += 1.0;
                }
            }
            BlockRotation::NZ(_) => {
                self.rotate_x(node, -PI_2);
                if translate {
                    node[2] += 1.0;
                }
            }
        }
    }

    pub fn rotate_aabb(&self, aabb: &AABB, y_rotate: bool, translate: bool) -> AABB {
        let mut min = [aabb.min_x, aabb.min_y, aabb.min_z];
        let mut max = [aabb.max_x, aabb.max_y, aabb.max_z];

        let mut min_x = None;
        let mut min_z = None;
        let mut max_x = None;
        let mut max_z = None;

        if y_rotate
            && (matches!(self, BlockRotation::PY(_)) || matches!(self, BlockRotation::NY(_)))
        {
            let min1 = [aabb.min_x, aabb.min_y, aabb.min_z];
            let min2 = [aabb.min_x, aabb.min_y, aabb.max_z];
            let min3 = [aabb.max_x, aabb.min_y, aabb.min_z];
            let min4 = [aabb.max_x, aabb.min_y, aabb.max_z];

            [min1, min2, min3, min4].into_iter().for_each(|mut node| {
                self.rotate_node(&mut node, true, true);

                if min_x.is_none() || node[0] < min_x.unwrap() {
                    min_x = Some(node[0]);
                }

                if min_z.is_none() || node[2] < min_z.unwrap() {
                    min_z = Some(node[2]);
                }
            });

            let max1 = [aabb.min_x, aabb.max_y, aabb.min_z];
            let max2 = [aabb.min_x, aabb.max_y, aabb.max_z];
            let max3 = [aabb.max_x, aabb.max_y, aabb.min_z];
            let max4 = [aabb.max_x, aabb.max_y, aabb.max_z];

            [max1, max2, max3, max4].into_iter().for_each(|mut node| {
                self.rotate_node(&mut node, true, true);

                if max_x.is_none() || node[0] > max_x.unwrap() {
                    max_x = Some(node[0]);
                }

                if max_z.is_none() || node[2] > max_z.unwrap() {
                    max_z = Some(node[2]);
                }
            });
        }

        self.rotate_node(&mut min, false, translate);
        self.rotate_node(&mut max, false, translate);

        AABB {
            min_x: min_x.unwrap_or(min[0].min(max[0])),
            min_y: min[1].min(max[1]),
            min_z: min_z.unwrap_or(min[2].min(max[2])),
            max_x: max_x.unwrap_or(min[0].max(max[0])),
            max_y: max[1].max(min[1]),
            max_z: max_z.unwrap_or(min[2].max(max[2])),
        }
    }

    pub fn rotate_transparency(&self, [px, py, pz, nx, ny, nz]: [bool; 6]) -> [bool; 6] {
        if let BlockRotation::PY(rot) = self {
            if rot.abs() < f32::EPSILON {
                return [px, py, pz, nx, ny, nz];
            }
        }

        let mut positive = [1.0, 2.0, 3.0];
        let mut negative = [4.0, 5.0, 6.0];

        self.rotate_node(&mut positive, true, false);
        self.rotate_node(&mut negative, true, false);

        let p: Vec<bool> = positive
            .into_iter()
            .map(|n| {
                if n == 1.0 {
                    px
                } else if n == 2.0 {
                    py
                } else if n == 3.0 {
                    pz
                } else if n == 4.0 {
                    nx
                } else if n == 5.0 {
                    ny
                } else {
                    nz
                }
            })
            .collect();

        let n: Vec<bool> = negative
            .into_iter()
            .map(|n| {
                if n == 1.0 {
                    px
                } else if n == 2.0 {
                    py
                } else if n == 3.0 {
                    pz
                } else if n == 4.0 {
                    nx
                } else if n == 5.0 {
                    ny
                } else {
                    nz
                }
            })
            .collect();

        [p[0], p[1], p[2], n[0], n[1], n[2]]
    }

    fn rotate_x(&self, node: &mut [f32; 3], theta: f32) {
        let sin_theta = theta.sin();
        let cos_theta = theta.cos();
        let y = node[1];
        let z = node[2];
        node[1] = y * cos_theta - z * sin_theta;
        node[2] = z * cos_theta + y * sin_theta;
    }

    fn rotate_y(&self, node: &mut [f32; 3], theta: f32) {
        let sin_theta = theta.sin();
        let cos_theta = theta.cos();
        let x = node[0];
        let z = node[2];
        node[0] = z * sin_theta + x * cos_theta;
        node[2] = z * cos_theta - x * sin_theta;
    }

    fn rotate_z(&self, node: &mut [f32; 3], theta: f32) {
        let sin_theta = theta.sin();
        let cos_theta = theta.cos();
        let x = node[0];
        let y = node[1];
        node[0] = x * cos_theta - y * sin_theta;
        node[1] = y * cos_theta + x * sin_theta;
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockSimpleRule {
    pub offset: [i32; 3],
    pub id: Option<u32>,
    pub rotation: Option<BlockRotation>,
    pub stage: Option<u32>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum BlockRule {
    #[default]
    None,
    Simple(BlockSimpleRule),
    Combination {
        logic: BlockRuleLogic,
        rules: Vec<BlockRule>,
    },
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BlockRuleLogic {
    And,
    Or,
    Not,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BlockConditionalPart {
    #[serde(default)]
    pub rule: BlockRule,
    #[serde(default)]
    pub faces: Vec<BlockFace>,
    #[serde(default)]
    pub aabbs: Vec<AABB>,
    #[serde(default)]
    pub is_transparent: [bool; 6],
    #[serde(default)]
    pub world_space: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockDynamicPattern {
    pub parts: Vec<BlockConditionalPart>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_aabb_union() {
        let aabbs = vec![
            AABB::create(0.0, 0.0, 0.0, 1.0, 1.0, 1.0),
            AABB::create(0.5, 0.5, 0.5, 2.0, 2.0, 2.0),
        ];
        let union = AABB::union_all(&aabbs);
        assert_eq!(union.min_x, 0.0);
        assert_eq!(union.min_y, 0.0);
        assert_eq!(union.min_z, 0.0);
        assert_eq!(union.max_x, 2.0);
        assert_eq!(union.max_y, 2.0);
        assert_eq!(union.max_z, 2.0);
    }

    #[test]
    fn test_aabb_intersects() {
        let a = AABB::create(0.0, 0.0, 0.0, 1.0, 1.0, 1.0);
        let b = AABB::create(0.5, 0.5, 0.5, 1.5, 1.5, 1.5);
        let c = AABB::create(2.0, 2.0, 2.0, 3.0, 3.0, 3.0);

        assert!(a.intersects(&b));
        assert!(!a.intersects(&c));
    }

    #[test]
    fn test_block_rotation_encode_decode() {
        let rotation = BlockRotation::PY(0.0);
        let (val, y_rot) = BlockRotation::decode(&rotation);
        let decoded = BlockRotation::encode(val, y_rot);
        assert_eq!(rotation, decoded);
    }
}
