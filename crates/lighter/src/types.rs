use hashbrown::HashMap;
use serde::{Deserialize, Serialize};
use voxelize_core::{BlockRotation, BlockRule, BlockRuleLogic, LightColor, LightUtils};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LightNode {
    pub voxel: [i32; 3],
    pub level: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LightBounds {
    pub min: [i32; 3],
    pub shape: [usize; 3],
}

impl LightBounds {
    #[inline]
    pub fn contains_xz(&self, vx: i32, vz: i32) -> bool {
        let [start_x, _, start_z] = self.min;
        let [shape_x, _, shape_z] = self.shape;

        let end_x = i64::from(start_x).saturating_add(
            i64::try_from(shape_x).unwrap_or(i64::MAX),
        );
        let end_z = i64::from(start_z).saturating_add(
            i64::try_from(shape_z).unwrap_or(i64::MAX),
        );

        let vx = i64::from(vx);
        let vz = i64::from(vz);

        vx >= i64::from(start_x) && vz >= i64::from(start_z) && vx < end_x && vz < end_z
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LightConfig {
    pub chunk_size: i32,
    pub max_height: i32,
    pub max_light_level: u32,
    pub min_chunk: [i32; 2],
    pub max_chunk: [i32; 2],
}

impl Default for LightConfig {
    fn default() -> Self {
        Self {
            chunk_size: 16,
            max_height: 256,
            max_light_level: 15,
            min_chunk: [i32::MIN + 1, i32::MIN + 1],
            max_chunk: [i32::MAX - 1, i32::MAX - 1],
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LightConditionalPart {
    #[serde(default)]
    pub rule: BlockRule,
    #[serde(default)]
    pub red_light_level: Option<u32>,
    #[serde(default)]
    pub green_light_level: Option<u32>,
    #[serde(default)]
    pub blue_light_level: Option<u32>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LightDynamicPattern {
    pub parts: Vec<LightConditionalPart>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LightBlock {
    pub id: u32,
    pub is_transparent: [bool; 6],
    pub is_opaque: bool,
    pub is_light: bool,
    pub light_reduce: bool,
    pub red_light_level: u32,
    pub green_light_level: u32,
    pub blue_light_level: u32,
    #[serde(default)]
    pub dynamic_patterns: Option<Vec<LightDynamicPattern>>,
}

impl Default for LightBlock {
    fn default() -> Self {
        Self::default_air()
    }
}

impl LightBlock {
    pub fn default_air() -> Self {
        Self {
            id: 0,
            is_transparent: [true, true, true, true, true, true],
            is_opaque: false,
            is_light: false,
            light_reduce: false,
            red_light_level: 0,
            green_light_level: 0,
            blue_light_level: 0,
            dynamic_patterns: None,
        }
    }

    pub fn recompute_flags(&mut self) {
        self.is_opaque = self.is_transparent.iter().all(|value| !value);
        self.is_light =
            self.red_light_level > 0 || self.green_light_level > 0 || self.blue_light_level > 0;
    }

    #[inline]
    pub fn get_rotated_transparency(&self, rotation: &BlockRotation) -> [bool; 6] {
        rotation.rotate_transparency(self.is_transparent)
    }

    #[inline]
    pub fn get_torch_light_level(&self, color: &LightColor) -> u32 {
        match color {
            LightColor::Red => self.red_light_level,
            LightColor::Green => self.green_light_level,
            LightColor::Blue => self.blue_light_level,
            LightColor::Sunlight => 0,
        }
    }

    pub fn get_torch_light_level_at(
        &self,
        pos: &[i32; 3],
        space: &dyn LightVoxelAccess,
        color: &LightColor,
    ) -> u32 {
        if let Some(patterns) = &self.dynamic_patterns {
            for pattern in patterns {
                for part in &pattern.parts {
                    if Self::evaluate_rule(&part.rule, pos, space) {
                        match color {
                            LightColor::Red => {
                                if let Some(level) = part.red_light_level {
                                    return level;
                                }
                            }
                            LightColor::Green => {
                                if let Some(level) = part.green_light_level {
                                    return level;
                                }
                            }
                            LightColor::Blue => {
                                if let Some(level) = part.blue_light_level {
                                    return level;
                                }
                            }
                            LightColor::Sunlight => return 0,
                        }
                    }
                }
            }
        }

        self.get_torch_light_level(color)
    }

    fn evaluate_rule(rule: &BlockRule, pos: &[i32; 3], space: &dyn LightVoxelAccess) -> bool {
        match rule {
            BlockRule::None => true,
            BlockRule::Simple(simple_rule) => {
                let vx = simple_rule.offset[0] + pos[0];
                let vy = simple_rule.offset[1] + pos[1];
                let vz = simple_rule.offset[2] + pos[2];

                let id_match = simple_rule
                    .id
                    .is_none_or(|expected_id| space.get_voxel(vx, vy, vz) == expected_id);
                if !id_match {
                    return false;
                }

                let rotation_match = simple_rule.rotation.as_ref().is_none_or(|expected| {
                    space.get_voxel_rotation(vx, vy, vz) == *expected
                });
                if !rotation_match {
                    return false;
                }

                simple_rule
                    .stage
                    .is_none_or(|expected_stage| space.get_voxel_stage(vx, vy, vz) == expected_stage)
            }
            BlockRule::Combination { logic, rules } => match logic {
                BlockRuleLogic::And => rules.iter().all(|r| Self::evaluate_rule(r, pos, space)),
                BlockRuleLogic::Or => rules.iter().any(|r| Self::evaluate_rule(r, pos, space)),
                BlockRuleLogic::Not => {
                    if let Some(first_rule) = rules.first() {
                        !Self::evaluate_rule(first_rule, pos, space)
                    } else {
                        true
                    }
                }
            },
        }
    }
}

pub trait LightVoxelAccess {
    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32;
    fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation;
    fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32;
    fn get_raw_light(&self, vx: i32, vy: i32, vz: i32) -> u32;
    fn set_raw_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool;
    fn get_max_height(&self, vx: i32, vz: i32) -> u32;
    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool;

    #[inline]
    fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        self.get_raw_voxel(vx, vy, vz) & 0xFFFF
    }

    #[inline]
    fn get_sunlight(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_sunlight(self.get_raw_light(vx, vy, vz))
    }

    #[inline]
    fn set_sunlight(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        let raw = self.get_raw_light(vx, vy, vz);
        self.set_raw_light(vx, vy, vz, LightUtils::insert_sunlight(raw, level))
    }

    #[inline]
    fn get_red_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_red_light(self.get_raw_light(vx, vy, vz))
    }

    #[inline]
    fn set_red_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        let raw = self.get_raw_light(vx, vy, vz);
        self.set_raw_light(vx, vy, vz, LightUtils::insert_red_light(raw, level))
    }

    #[inline]
    fn get_green_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_green_light(self.get_raw_light(vx, vy, vz))
    }

    #[inline]
    fn set_green_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        let raw = self.get_raw_light(vx, vy, vz);
        self.set_raw_light(vx, vy, vz, LightUtils::insert_green_light(raw, level))
    }

    #[inline]
    fn get_blue_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_blue_light(self.get_raw_light(vx, vy, vz))
    }

    #[inline]
    fn set_blue_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        let raw = self.get_raw_light(vx, vy, vz);
        self.set_raw_light(vx, vy, vz, LightUtils::insert_blue_light(raw, level))
    }

    #[inline]
    fn get_torch_light(&self, vx: i32, vy: i32, vz: i32, color: &LightColor) -> u32 {
        match color {
            LightColor::Red => self.get_red_light(vx, vy, vz),
            LightColor::Green => self.get_green_light(vx, vy, vz),
            LightColor::Blue => self.get_blue_light(vx, vy, vz),
            LightColor::Sunlight => panic!("Getting torch light for sunlight channel."),
        }
    }

    #[inline]
    fn set_torch_light(
        &mut self,
        vx: i32,
        vy: i32,
        vz: i32,
        level: u32,
        color: &LightColor,
    ) -> bool {
        match color {
            LightColor::Red => self.set_red_light(vx, vy, vz, level),
            LightColor::Green => self.set_green_light(vx, vy, vz, level),
            LightColor::Blue => self.set_blue_light(vx, vy, vz, level),
            LightColor::Sunlight => panic!("Setting torch light for sunlight channel."),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LightRegistry {
    pub blocks_by_id: Vec<(u32, LightBlock)>,
    #[serde(skip, default)]
    lookup_dense: Option<Vec<usize>>,
    #[serde(skip, default)]
    lookup_sparse: Option<HashMap<u32, usize>>,
    #[serde(skip, default)]
    air_index: Option<usize>,
    #[serde(skip, default = "LightBlock::default_air")]
    default_block: LightBlock,
}

impl LightRegistry {
    pub fn new(blocks_by_id: Vec<(u32, LightBlock)>) -> Self {
        let mut registry = Self {
            blocks_by_id,
            lookup_dense: None,
            lookup_sparse: None,
            air_index: None,
            default_block: LightBlock::default_air(),
        };
        registry.build_cache();
        registry
    }

    pub fn build_cache(&mut self) {
        if self.blocks_by_id.is_empty() {
            self.lookup_dense = Some(vec![]);
            self.lookup_sparse = Some(HashMap::new());
            self.air_index = None;
            return;
        }

        for (index, (id, block)) in self.blocks_by_id.iter_mut().enumerate() {
            if block.id != *id {
                block.id = *id;
            }
            block.recompute_flags();
            if *id == 0 {
                self.air_index = Some(index);
            }
        }

        let max_id = self
            .blocks_by_id
            .iter()
            .map(|(id, _)| *id as usize)
            .max()
            .unwrap_or(0);

        let mut dense = vec![usize::MAX; max_id.saturating_add(1)];
        let mut sparse = HashMap::with_capacity(self.blocks_by_id.len());

        for (index, (id, _)) in self.blocks_by_id.iter().enumerate() {
            let id_usize = *id as usize;
            if id_usize < dense.len() {
                dense[id_usize] = index;
            }
            sparse.insert(*id, index);
        }

        self.lookup_dense = Some(dense);
        self.lookup_sparse = Some(sparse);
    }

    pub fn get_block_by_id(&self, id: u32) -> &LightBlock {
        if let Some(dense) = &self.lookup_dense {
            let idx = id as usize;
            if idx < dense.len() {
                let dense_index = dense[idx];
                if dense_index != usize::MAX {
                    return &self.blocks_by_id[dense_index].1;
                }
            }
        }

        if let Some(sparse) = &self.lookup_sparse {
            if let Some(index) = sparse.get(&id) {
                return &self.blocks_by_id[*index].1;
            }
        }

        if let Some(index) = self.air_index {
            return &self.blocks_by_id[index].1;
        }

        &self.default_block
    }

    pub fn has_type(&self, id: u32) -> bool {
        if let Some(dense) = &self.lookup_dense {
            let idx = id as usize;
            return idx < dense.len() && dense[idx] != usize::MAX;
        }

        if let Some(sparse) = &self.lookup_sparse {
            return sparse.contains_key(&id);
        }

        self.blocks_by_id.iter().any(|(block_id, _)| *block_id == id)
    }
}

#[cfg(test)]
mod tests {
    use super::{LightBlock, LightRegistry};

    #[test]
    fn registry_uses_tuple_id_for_air_fallback() {
        let mut mismatched_air = LightBlock::default_air();
        mismatched_air.id = 42;

        let registry = LightRegistry::new(vec![(0, mismatched_air)]);
        assert_eq!(registry.blocks_by_id[0].1.id, 0);

        let fallback = registry.get_block_by_id(999_999);
        assert_eq!(fallback.id, 0);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LightColorMap<T> {
    pub sunlight: T,
    pub red: T,
    pub green: T,
    pub blue: T,
}
