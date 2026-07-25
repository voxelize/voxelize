use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::{
    BlockUtils, LightColor, LightUtils, Registry, Vec3, VoxelAccess, VoxelUpdate, AABB,
};

use super::{BlockFace, BlockRotation};

#[derive(Debug, Clone)]
pub struct Neighbors {
    pub center: Vec3<i32>,
    data: [[u32; 2]; 27],
}

impl Neighbors {
    #[inline]
    fn offset_to_index(x: i32, y: i32, z: i32) -> usize {
        // Mirrors crates/mesher NeighborCache::offset_to_index: face dirs on
        // custom blocks (authored or rotation-derived) can step outside the
        // cached 3x3x3 neighborhood; clamp instead of indexing out of
        // bounds.
        let x = x.clamp(-1, 1);
        let y = y.clamp(-1, 1);
        let z = z.clamp(-1, 1);
        ((x + 1) + (y + 1) * 3 + (z + 1) * 9) as usize
    }

    pub fn populate(center: Vec3<i32>, space: &dyn VoxelAccess) -> Self {
        let mut data = [[0u32; 2]; 27];
        let Vec3(vx, vy, vz) = center;

        for x in -1..=1 {
            for y in -1..=1 {
                for z in -1..=1 {
                    let idx = Self::offset_to_index(x, y, z);
                    data[idx][0] = space.get_raw_voxel(vx + x, vy + y, vz + z);
                    data[idx][1] = space.get_raw_light(vx + x, vy + y, vz + z);
                }
            }
        }

        Self { data, center }
    }

    #[inline]
    fn get_data(&self, offset: &Vec3<i32>) -> [u32; 2] {
        let idx = Self::offset_to_index(offset.0, offset.1, offset.2);
        self.data[idx]
    }

    pub fn get_voxel(&self, offset: &Vec3<i32>) -> u32 {
        BlockUtils::extract_id(self.get_data(offset)[0])
    }

    pub fn get_rotation(&self, offset: &Vec3<i32>) -> BlockRotation {
        BlockUtils::extract_rotation(self.get_data(offset)[0])
    }

    pub fn get_stage(&self, offset: &Vec3<i32>) -> u32 {
        BlockUtils::extract_stage(self.get_data(offset)[0])
    }

    pub fn get_sunlight(&self, offset: &Vec3<i32>) -> u32 {
        LightUtils::extract_sunlight(self.get_data(offset)[1])
    }

    pub fn get_torch_light(&self, offset: &Vec3<i32>, color: &LightColor) -> u32 {
        let light = self.get_data(offset)[1];
        match *color {
            LightColor::Red => LightUtils::extract_red_light(light),
            LightColor::Green => LightUtils::extract_green_light(light),
            LightColor::Blue => LightUtils::extract_blue_light(light),
            LightColor::Sunlight => panic!("Getting torch light of Sunlight!"),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockSimpleRule {
    pub offset: Vec3<i32>,
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
    // Extend with other logic types as needed
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
    pub is_passable: Option<bool>,
    #[serde(default)]
    pub red_light_level: Option<u32>,
    #[serde(default)]
    pub green_light_level: Option<u32>,
    #[serde(default)]
    pub blue_light_level: Option<u32>,
    #[serde(default)]
    pub world_space: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockDynamicPattern {
    pub parts: Vec<BlockConditionalPart>,
}

impl BlockDynamicPattern {
    pub fn to_mesher_pattern(&self) -> voxelize_mesher::BlockDynamicPattern {
        voxelize_mesher::BlockDynamicPattern {
            parts: self.parts.iter().map(|p| p.to_mesher_part()).collect(),
        }
    }
}

impl BlockConditionalPart {
    pub fn to_mesher_part(&self) -> voxelize_mesher::BlockConditionalPart {
        voxelize_mesher::BlockConditionalPart {
            rule: self.rule.to_mesher_rule(),
            faces: self.faces.iter().map(|f| f.to_mesher_face()).collect(),
            aabbs: self.aabbs.clone(),
            is_transparent: self.is_transparent,
            world_space: self.world_space,
        }
    }
}

impl BlockRule {
    pub fn to_mesher_rule(&self) -> voxelize_mesher::BlockRule {
        match self {
            BlockRule::None => voxelize_mesher::BlockRule::None,
            BlockRule::Simple(simple) => {
                voxelize_mesher::BlockRule::Simple(voxelize_mesher::BlockSimpleRule {
                    offset: [simple.offset.0, simple.offset.1, simple.offset.2],
                    id: simple.id,
                    rotation: simple.rotation.as_ref().map(|r| {
                        let (rot, y_rot) = BlockRotation::decode(r);
                        voxelize_mesher::BlockRotation::encode(rot, y_rot)
                    }),
                    stage: simple.stage,
                })
            }
            BlockRule::Combination { logic, rules } => voxelize_mesher::BlockRule::Combination {
                logic: match logic {
                    BlockRuleLogic::And => voxelize_mesher::BlockRuleLogic::And,
                    BlockRuleLogic::Or => voxelize_mesher::BlockRuleLogic::Or,
                    BlockRuleLogic::Not => voxelize_mesher::BlockRuleLogic::Not,
                },
                rules: rules.iter().map(|r| r.to_mesher_rule()).collect(),
            },
        }
    }
}

/// Serializable struct representing block data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SupportRequirement {
    /// No automatic support checks.
    #[default]
    None,
    /// Cleared (set to air) if the voxel immediately below is empty, passable, or fluid.
    /// Classic plant / carpet / snow-layer behavior. Uses the existing `active_fn`
    /// neighbor-activation path in `ChunkUpdatingSystem`.
    SolidBelow,
}

/// Shared support test used by [`SupportRequirement::SolidBelow`] and game code.
pub fn voxel_has_solid_support_below(
    pos: &Vec3<i32>,
    space: &dyn VoxelAccess,
    registry: &Registry,
) -> bool {
    let below_id = space.get_voxel(pos.0, pos.1 - 1, pos.2);
    if registry.is_air(below_id) {
        return false;
    }
    let below = registry.get_block_by_id(below_id);
    !(below.is_empty || below.is_passable || below.is_fluid)
}

pub(super) fn solid_below_support_fns() -> (
    Arc<dyn Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> u64 + Send + Sync>,
    Arc<dyn Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> Vec<VoxelUpdate> + Send + Sync>,
) {
    let ticker = Arc::new(
        |_pos: Vec3<i32>, _space: &dyn VoxelAccess, _reg: &Registry| -> u64 { 1 },
    );
    let updater = Arc::new(
        |pos: Vec3<i32>, space: &dyn VoxelAccess, reg: &Registry| -> Vec<VoxelUpdate> {
            if voxel_has_solid_support_below(&pos, space, reg) {
                Vec::new()
            } else {
                vec![(pos, 0)]
            }
        },
    );
    (ticker, updater)
}
