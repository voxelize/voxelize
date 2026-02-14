use hashbrown::HashMap;
use serde::{Deserialize, Serialize};
use voxelize_core::{BlockRotation, BlockRule, BlockRuleLogic, LightColor, LightUtils};

const DENSE_LOOKUP_MAX_GROWTH_FACTOR: usize = 8;
const RED_TORCH_MASK: u8 = 1 << 0;
const GREEN_TORCH_MASK: u8 = 1 << 1;
const BLUE_TORCH_MASK: u8 = 1 << 2;
const ALL_TORCH_MASKS: u8 = RED_TORCH_MASK | GREEN_TORCH_MASK | BLUE_TORCH_MASK;

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
    #[serde(skip, default)]
    static_torch_mask: u8,
    #[serde(skip, default)]
    dynamic_torch_mask: u8,
    #[serde(skip, default)]
    has_uniform_transparency: bool,
}

impl Default for LightBlock {
    fn default() -> Self {
        Self::default_air()
    }
}

impl LightBlock {
    pub fn new(
        id: u32,
        is_transparent: [bool; 6],
        light_reduce: bool,
        red_light_level: u32,
        green_light_level: u32,
        blue_light_level: u32,
        dynamic_patterns: Option<Vec<LightDynamicPattern>>,
    ) -> Self {
        let mut block = Self {
            id,
            is_transparent,
            is_opaque: false,
            is_light: false,
            light_reduce,
            red_light_level,
            green_light_level,
            blue_light_level,
            dynamic_patterns,
            static_torch_mask: 0,
            dynamic_torch_mask: 0,
            has_uniform_transparency: false,
        };
        block.recompute_flags();
        block
    }

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
            static_torch_mask: 0,
            dynamic_torch_mask: 0,
            has_uniform_transparency: true,
        }
    }

    #[inline]
    fn color_mask(color: &LightColor) -> u8 {
        match color {
            LightColor::Red => RED_TORCH_MASK,
            LightColor::Green => GREEN_TORCH_MASK,
            LightColor::Blue => BLUE_TORCH_MASK,
            LightColor::Sunlight => 0,
        }
    }

    #[inline]
    pub(crate) fn has_static_torch_mask(&self, color_mask: u8) -> bool {
        (self.static_torch_mask & color_mask) != 0
    }

    #[inline]
    pub(crate) fn has_dynamic_torch_mask(&self, color_mask: u8) -> bool {
        (self.dynamic_torch_mask & color_mask) != 0
    }

    #[inline]
    pub fn has_static_torch_color(&self, color: &LightColor) -> bool {
        self.has_static_torch_mask(Self::color_mask(color))
    }

    #[inline]
    pub fn has_dynamic_torch_color(&self, color: &LightColor) -> bool {
        self.has_dynamic_torch_mask(Self::color_mask(color))
    }

    pub fn recompute_flags(&mut self) {
        self.is_opaque = self.is_transparent.iter().all(|value| !value);
        let [t0, t1, t2, t3, t4, t5] = self.is_transparent;
        self.has_uniform_transparency = t0 == t1 && t0 == t2 && t0 == t3 && t0 == t4 && t0 == t5;

        let mut static_torch_mask = 0;
        if self.red_light_level > 0 {
            static_torch_mask |= RED_TORCH_MASK;
        }
        if self.green_light_level > 0 {
            static_torch_mask |= GREEN_TORCH_MASK;
        }
        if self.blue_light_level > 0 {
            static_torch_mask |= BLUE_TORCH_MASK;
        }

        let mut dynamic_torch_mask = 0;
        if let Some(patterns) = &self.dynamic_patterns {
            for pattern in patterns {
                for part in &pattern.parts {
                    if part.red_light_level.unwrap_or(0) > 0 {
                        dynamic_torch_mask |= RED_TORCH_MASK;
                    }
                    if part.green_light_level.unwrap_or(0) > 0 {
                        dynamic_torch_mask |= GREEN_TORCH_MASK;
                    }
                    if part.blue_light_level.unwrap_or(0) > 0 {
                        dynamic_torch_mask |= BLUE_TORCH_MASK;
                    }

                    if dynamic_torch_mask == ALL_TORCH_MASKS {
                        break;
                    }
                }

                if dynamic_torch_mask == ALL_TORCH_MASKS {
                    break;
                }
            }
        }

        self.static_torch_mask = static_torch_mask;
        self.dynamic_torch_mask = dynamic_torch_mask;
        self.is_light = (static_torch_mask | dynamic_torch_mask) != 0;
    }

    #[inline]
    pub fn get_rotated_transparency(&self, rotation: &BlockRotation) -> [bool; 6] {
        if self.has_uniform_transparency {
            self.is_transparent
        } else {
            rotation.rotate_transparency(self.is_transparent)
        }
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
        self.get_torch_light_level_at_xyz(pos[0], pos[1], pos[2], space, color)
    }

    pub fn get_torch_light_level_at_xyz(
        &self,
        vx: i32,
        vy: i32,
        vz: i32,
        space: &dyn LightVoxelAccess,
        color: &LightColor,
    ) -> u32 {
        match color {
            LightColor::Red => {
                if !self.has_dynamic_torch_color(&LightColor::Red) {
                    return self.red_light_level;
                }

                if let Some(patterns) = &self.dynamic_patterns {
                    for pattern in patterns {
                        for part in &pattern.parts {
                            if let Some(level) = part.red_light_level {
                                if Self::evaluate_rule(&part.rule, vx, vy, vz, space) {
                                    return level;
                                }
                            }
                        }
                    }
                }

                self.red_light_level
            }
            LightColor::Green => {
                if !self.has_dynamic_torch_color(&LightColor::Green) {
                    return self.green_light_level;
                }

                if let Some(patterns) = &self.dynamic_patterns {
                    for pattern in patterns {
                        for part in &pattern.parts {
                            if let Some(level) = part.green_light_level {
                                if Self::evaluate_rule(&part.rule, vx, vy, vz, space) {
                                    return level;
                                }
                            }
                        }
                    }
                }

                self.green_light_level
            }
            LightColor::Blue => {
                if !self.has_dynamic_torch_color(&LightColor::Blue) {
                    return self.blue_light_level;
                }

                if let Some(patterns) = &self.dynamic_patterns {
                    for pattern in patterns {
                        for part in &pattern.parts {
                            if let Some(level) = part.blue_light_level {
                                if Self::evaluate_rule(&part.rule, vx, vy, vz, space) {
                                    return level;
                                }
                            }
                        }
                    }
                }

                self.blue_light_level
            }
            LightColor::Sunlight => 0,
        }
    }

    fn evaluate_rule(
        rule: &BlockRule,
        vx: i32,
        vy: i32,
        vz: i32,
        space: &dyn LightVoxelAccess,
    ) -> bool {
        match rule {
            BlockRule::None => true,
            BlockRule::Simple(simple_rule) => {
                let vx = simple_rule.offset[0] + vx;
                let vy = simple_rule.offset[1] + vy;
                let vz = simple_rule.offset[2] + vz;
                let raw_voxel = space.get_raw_voxel(vx, vy, vz);

                if let Some(expected_id) = simple_rule.id {
                    if (raw_voxel & 0xFFFF) != expected_id {
                        return false;
                    }
                }

                if let Some(expected_rotation) = simple_rule.rotation.as_ref() {
                    let (expected_rotation_value, expected_y_rotation) =
                        BlockRotation::decode(expected_rotation);
                    let actual_rotation_value = (raw_voxel >> 16) & 0xF;
                    let actual_y_rotation = (raw_voxel >> 20) & 0xF;
                    if actual_rotation_value != expected_rotation_value
                        || actual_y_rotation != expected_y_rotation
                    {
                        return false;
                    }
                }

                if let Some(expected_stage) = simple_rule.stage {
                    return ((raw_voxel >> 24) & 0xF) == expected_stage;
                }

                true
            }
            BlockRule::Combination { logic, rules } => match logic {
                BlockRuleLogic::And => {
                    for sub_rule in rules {
                        if !Self::evaluate_rule(sub_rule, vx, vy, vz, space) {
                            return false;
                        }
                    }
                    true
                }
                BlockRuleLogic::Or => {
                    for sub_rule in rules {
                        if Self::evaluate_rule(sub_rule, vx, vy, vz, space) {
                            return true;
                        }
                    }
                    false
                }
                BlockRuleLogic::Not => {
                    for sub_rule in rules {
                        if Self::evaluate_rule(sub_rule, vx, vy, vz, space) {
                            return false;
                        }
                    }
                    true
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

        let dense_limit = self
            .blocks_by_id
            .len()
            .saturating_mul(DENSE_LOOKUP_MAX_GROWTH_FACTOR)
            .max(64);
        if max_id <= dense_limit {
            let mut dense = vec![usize::MAX; max_id.saturating_add(1)];
            for (index, (id, _)) in self.blocks_by_id.iter().enumerate() {
                let id_usize = *id as usize;
                if id_usize < dense.len() {
                    dense[id_usize] = index;
                }
            }
            self.lookup_dense = Some(dense);
            self.lookup_sparse = None;
        } else {
            let mut sparse = HashMap::with_capacity(self.blocks_by_id.len());
            for (index, (id, _)) in self.blocks_by_id.iter().enumerate() {
                sparse.insert(*id, index);
            }
            self.lookup_dense = None;
            self.lookup_sparse = Some(sparse);
        }
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
    use voxelize_core::{BlockRule, BlockRuleLogic, BlockSimpleRule, LightColor};

    use super::{LightBlock, LightConditionalPart, LightDynamicPattern, LightRegistry};

    #[test]
    fn registry_uses_tuple_id_for_air_fallback() {
        let mut mismatched_air = LightBlock::default_air();
        mismatched_air.id = 42;

        let registry = LightRegistry::new(vec![(0, mismatched_air)]);
        assert_eq!(registry.blocks_by_id[0].1.id, 0);

        let fallback = registry.get_block_by_id(999_999);
        assert_eq!(fallback.id, 0);
    }

    #[test]
    fn registry_uses_sparse_lookup_for_large_id_gaps() {
        let mut air = LightBlock::default_air();
        air.id = 0;

        let mut distant = LightBlock::default_air();
        distant.id = 1_000_000;

        let registry = LightRegistry::new(vec![(0, air), (1_000_000, distant)]);
        assert!(registry.lookup_dense.is_none());
        assert_eq!(registry.get_block_by_id(1_000_000).id, 1_000_000);
        assert!(registry.has_type(1_000_000));
    }

    #[test]
    fn registry_uses_dense_lookup_without_sparse_map_when_compact() {
        let mut air = LightBlock::default_air();
        air.id = 0;
        let mut solid = LightBlock::default_air();
        solid.id = 1;

        let registry = LightRegistry::new(vec![(0, air), (1, solid)]);
        assert!(registry.lookup_dense.is_some());
        assert!(registry.lookup_sparse.is_none());
        assert!(registry.has_type(1));
        assert!(!registry.has_type(999));
    }

    #[test]
    fn recompute_flags_tracks_dynamic_torch_color_masks() {
        let mut block = LightBlock {
            id: 10,
            is_transparent: [true, true, true, true, true, true],
            is_opaque: false,
            is_light: false,
            light_reduce: false,
            red_light_level: 0,
            green_light_level: 0,
            blue_light_level: 0,
            dynamic_patterns: Some(vec![LightDynamicPattern {
                parts: vec![LightConditionalPart {
                    rule: BlockRule::None,
                    red_light_level: None,
                    green_light_level: Some(7),
                    blue_light_level: None,
                }],
            }]),
            static_torch_mask: 0,
            dynamic_torch_mask: 0,
            has_uniform_transparency: true,
        };

        block.recompute_flags();
        assert!(!block.has_static_torch_color(&LightColor::Green));
        assert!(block.has_dynamic_torch_color(&LightColor::Green));
        assert!(!block.has_dynamic_torch_color(&LightColor::Red));
        assert_eq!(
            block.get_torch_light_level_at(
                &[0, 0, 0],
                &NoopAccess,
                &LightColor::Green
            ),
            7
        );
    }

    #[test]
    fn constructor_recomputes_opaque_and_light_flags() {
        let block = LightBlock::new(9, [false, false, false, false, false, false], true, 0, 0, 3, None);
        assert!(block.is_opaque);
        assert!(block.is_light);
        assert!(block.has_static_torch_color(&LightColor::Blue));
    }

    #[test]
    fn dynamic_not_rules_require_all_subrules_to_be_false() {
        let mut block = LightBlock::default_air();
        block.dynamic_patterns = Some(vec![LightDynamicPattern {
            parts: vec![LightConditionalPart {
                rule: BlockRule::Combination {
                    logic: BlockRuleLogic::Not,
                    rules: vec![
                        BlockRule::Simple(BlockSimpleRule {
                            offset: [1, 0, 0],
                            id: Some(1),
                            rotation: None,
                            stage: None,
                        }),
                        BlockRule::Simple(BlockSimpleRule {
                            offset: [2, 0, 0],
                            id: Some(2),
                            rotation: None,
                            stage: None,
                        }),
                    ],
                },
                red_light_level: Some(9),
                green_light_level: None,
                blue_light_level: None,
            }],
        }]);
        block.recompute_flags();

        let level = block.get_torch_light_level_at_xyz(0, 0, 0, &NotRuleAccess, &LightColor::Red);
        assert_eq!(level, 0);
    }

    struct NoopAccess;
    struct NotRuleAccess;

    impl super::LightVoxelAccess for NoopAccess {
        fn get_raw_voxel(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
            0
        }

        fn get_voxel_rotation(&self, _vx: i32, _vy: i32, _vz: i32) -> voxelize_core::BlockRotation {
            voxelize_core::BlockRotation::default()
        }

        fn get_voxel_stage(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
            0
        }

        fn get_raw_light(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
            0
        }

        fn set_raw_light(&mut self, _vx: i32, _vy: i32, _vz: i32, _level: u32) -> bool {
            false
        }

        fn get_max_height(&self, _vx: i32, _vz: i32) -> u32 {
            0
        }

        fn contains(&self, _vx: i32, _vy: i32, _vz: i32) -> bool {
            false
        }
    }

    impl super::LightVoxelAccess for NotRuleAccess {
        fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
            if vx == 2 && vy == 0 && vz == 0 {
                return 2;
            }
            0
        }

        fn get_voxel_rotation(&self, _vx: i32, _vy: i32, _vz: i32) -> voxelize_core::BlockRotation {
            voxelize_core::BlockRotation::default()
        }

        fn get_voxel_stage(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
            0
        }

        fn get_raw_light(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
            0
        }

        fn set_raw_light(&mut self, _vx: i32, _vy: i32, _vz: i32, _level: u32) -> bool {
            false
        }

        fn get_max_height(&self, _vx: i32, _vz: i32) -> u32 {
            0
        }

        fn contains(&self, _vx: i32, _vy: i32, _vz: i32) -> bool {
            true
        }
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
