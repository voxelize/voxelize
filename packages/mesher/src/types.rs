use serde::{Deserialize, Serialize};
use std::f32::consts::PI;

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

impl AABB {
    pub fn new(min_x: f32, min_y: f32, min_z: f32, max_x: f32, max_y: f32, max_z: f32) -> Self {
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

    pub fn union(all: &[AABB]) -> AABB {
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

    pub fn intersects(&self, other: &AABB) -> bool {
        self.min_x < other.max_x
            && self.max_x > other.min_x
            && self.min_y < other.max_y
            && self.max_y > other.min_y
            && self.min_z < other.max_z
            && self.max_z > other.min_z
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

    pub fn translate(&mut self, dx: f32, dy: f32, dz: f32) {
        self.min_x += dx;
        self.min_y += dy;
        self.min_z += dz;
        self.max_x += dx;
        self.max_y += dy;
        self.max_z += dz;
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

pub const Y_ROT_SEGMENTS: u32 = 16;

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

const PI_2: f32 = PI / 2.0;

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
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockDynamicPattern {
    pub parts: Vec<BlockConditionalPart>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub id: u32,
    pub name: String,
    #[serde(skip)]
    pub name_lower: String,
    pub rotatable: bool,
    pub y_rotatable: bool,
    pub is_empty: bool,
    pub is_fluid: bool,
    pub is_opaque: bool,
    pub is_see_through: bool,
    pub is_transparent: [bool; 6],
    pub transparent_standalone: bool,
    pub faces: Vec<BlockFace>,
    pub aabbs: Vec<AABB>,
    pub dynamic_patterns: Option<Vec<BlockDynamicPattern>>,
}

impl Block {
    pub fn compute_name_lower(&mut self) {
        self.name_lower = self.name.to_lowercase();
        for face in &mut self.faces {
            face.compute_name_lower();
        }
        if let Some(patterns) = &mut self.dynamic_patterns {
            for pattern in patterns {
                for part in &mut pattern.parts {
                    for face in &mut part.faces {
                        face.compute_name_lower();
                    }
                }
            }
        }
    }
}

impl Block {
    pub fn is_full_cube(&self) -> bool {
        self.aabbs.len() == 1
            && (self.aabbs[0].min_x - 0.0).abs() < f32::EPSILON
            && (self.aabbs[0].min_y - 0.0).abs() < f32::EPSILON
            && (self.aabbs[0].min_z - 0.0).abs() < f32::EPSILON
            && (self.aabbs[0].max_x - 1.0).abs() < f32::EPSILON
            && (self.aabbs[0].max_y - 1.0).abs() < f32::EPSILON
            && (self.aabbs[0].max_z - 1.0).abs() < f32::EPSILON
    }

    pub fn get_name_lower(&self) -> &str {
        if self.name_lower.is_empty() {
            &self.name
        } else {
            &self.name_lower
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Registry {
    pub blocks_by_id: Vec<(u32, Block)>,
    #[serde(skip)]
    lookup_cache: Option<hashbrown::HashMap<u32, usize>>,
}

impl Registry {
    pub fn new(blocks_by_id: Vec<(u32, Block)>) -> Self {
        Self {
            blocks_by_id,
            lookup_cache: None,
        }
    }

    pub fn build_cache(&mut self) {
        let mut cache = hashbrown::HashMap::with_capacity(self.blocks_by_id.len());
        for (idx, (id, block)) in self.blocks_by_id.iter_mut().enumerate() {
            cache.insert(*id, idx);
            block.compute_name_lower();
        }
        self.lookup_cache = Some(cache);
    }

    pub fn get_block_by_id(&self, id: u32) -> Option<&Block> {
        if let Some(cache) = &self.lookup_cache {
            cache.get(&id).map(|&idx| &self.blocks_by_id[idx].1)
        } else {
            self.blocks_by_id
                .iter()
                .find(|(block_id, _)| *block_id == id)
                .map(|(_, block)| block)
        }
    }

    pub fn has_type(&self, id: u32) -> bool {
        if let Some(cache) = &self.lookup_cache {
            cache.contains_key(&id)
        } else {
            self.blocks_by_id.iter().any(|(block_id, _)| *block_id == id)
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryProtocol {
    pub voxel: u32,
    pub at: Option<[i32; 3]>,
    pub face_name: Option<String>,
    pub positions: Vec<f32>,
    pub indices: Vec<i32>,
    pub uvs: Vec<f32>,
    pub lights: Vec<i32>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshConfig {
    pub chunk_size: i32,
    pub greedy_meshing: bool,
}

impl Default for MeshConfig {
    fn default() -> Self {
        Self {
            chunk_size: 16,
            greedy_meshing: true,
        }
    }
}
