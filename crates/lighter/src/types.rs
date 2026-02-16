use std::sync::OnceLock;

use hashbrown::HashMap;
use serde::{Deserialize, Serialize};
use voxelize_core::{BlockRotation, BlockRule, BlockRuleLogic, LightColor, LightUtils};

const DENSE_LOOKUP_MAX_GROWTH_FACTOR: usize = 8;
const ROTATION_VARIANT_COUNT: usize = 6;
const Y_ROTATION_SEGMENT_COUNT: usize = 16;
const TRANSPARENCY_ROTATION_MAP_COUNT: usize = ROTATION_VARIANT_COUNT * Y_ROTATION_SEGMENT_COUNT;
const RED_TORCH_MASK: u8 = 1 << 0;
const GREEN_TORCH_MASK: u8 = 1 << 1;
const BLUE_TORCH_MASK: u8 = 1 << 2;
const ALL_TORCH_MASKS: u8 = RED_TORCH_MASK | GREEN_TORCH_MASK | BLUE_TORCH_MASK;
const MAX_I64_USIZE: usize = i64::MAX as usize;
static TRANSPARENCY_ROTATION_MAPS: OnceLock<
    [[usize; 6]; TRANSPARENCY_ROTATION_MAP_COUNT],
> = OnceLock::new();

#[inline]
fn transparency_source_index(marker: f32) -> usize {
    if !marker.is_finite() {
        5
    } else {
        let rounded = marker.round();
        if rounded <= 1.0 {
            0
        } else if rounded >= 6.0 {
            5
        } else {
            rounded as usize - 1
        }
    }
}

#[cfg(test)]
mod transparency_source_index_tests {
    use super::transparency_source_index;

    #[test]
    fn transparency_source_index_rounds_close_markers() {
        assert_eq!(transparency_source_index(0.999_999_94), 0);
        assert_eq!(transparency_source_index(2.000_000_2), 1);
        assert_eq!(transparency_source_index(3.49), 2);
        assert_eq!(transparency_source_index(4.51), 4);
    }

    #[test]
    fn transparency_source_index_clamps_non_finite_and_out_of_bounds_values() {
        assert_eq!(transparency_source_index(f32::NAN), 5);
        assert_eq!(transparency_source_index(f32::INFINITY), 5);
        assert_eq!(transparency_source_index(-10.0), 0);
        assert_eq!(transparency_source_index(100.0), 5);
    }
}

fn build_transparency_rotation_maps() -> [[usize; 6]; TRANSPARENCY_ROTATION_MAP_COUNT] {
    let mut maps = [[0usize; 6]; TRANSPARENCY_ROTATION_MAP_COUNT];
    for rotation_value in 0..ROTATION_VARIANT_COUNT {
        for y_rotation in 0..Y_ROTATION_SEGMENT_COUNT {
            let rotation = BlockRotation::encode(rotation_value as u32, y_rotation as u32);
            let mut positive = [1.0, 2.0, 3.0];
            let mut negative = [4.0, 5.0, 6.0];
            rotation.rotate_node(&mut positive, true, false);
            rotation.rotate_node(&mut negative, true, false);
            maps[rotation_value * Y_ROTATION_SEGMENT_COUNT + y_rotation] = [
                transparency_source_index(positive[0]),
                transparency_source_index(positive[1]),
                transparency_source_index(positive[2]),
                transparency_source_index(negative[0]),
                transparency_source_index(negative[1]),
                transparency_source_index(negative[2]),
            ];
        }
    }
    maps
}

#[inline]
fn transparency_rotation_maps() -> &'static [[usize; 6]; TRANSPARENCY_ROTATION_MAP_COUNT] {
    TRANSPARENCY_ROTATION_MAPS.get_or_init(build_transparency_rotation_maps)
}

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
        if shape_x == 0 || shape_z == 0 {
            return false;
        }
        if vx < start_x || vz < start_z {
            return false;
        }
        if shape_x <= i32::MAX as usize && shape_z <= i32::MAX as usize {
            let shape_x_i32 = shape_x as i32;
            let shape_z_i32 = shape_z as i32;
            if start_x <= i32::MAX - shape_x_i32 && start_z <= i32::MAX - shape_z_i32 {
                let end_x = start_x + shape_x_i32;
                let end_z = start_z + shape_z_i32;
                return vx < end_x && vz < end_z;
            }
        }

        let start_x_i64 = i64::from(start_x);
        let start_z_i64 = i64::from(start_z);
        let shape_x_i64 = if shape_x > MAX_I64_USIZE {
            i64::MAX
        } else {
            shape_x as i64
        };
        let shape_z_i64 = if shape_z > MAX_I64_USIZE {
            i64::MAX
        } else {
            shape_z as i64
        };
        let end_x = start_x_i64.saturating_add(shape_x_i64);
        let end_z = start_z_i64.saturating_add(shape_z_i64);

        let vx = i64::from(vx);
        let vz = i64::from(vz);

        vx < end_x && vz < end_z
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
    #[inline]
    fn normalize_rotation_value(rotation_value: u32) -> usize {
        if rotation_value < ROTATION_VARIANT_COUNT as u32 {
            rotation_value as usize
        } else {
            0
        }
    }

    #[inline]
    fn transparency_rotation_index(rotation_value: u32, y_rotation: u32) -> usize {
        Self::normalize_rotation_value(rotation_value) * Y_ROTATION_SEGMENT_COUNT
            + (y_rotation as usize & (Y_ROTATION_SEGMENT_COUNT - 1))
    }

    #[inline]
    fn apply_transparency_rotation_map(
        transparency: [bool; 6],
        map: &[usize; 6],
    ) -> [bool; 6] {
        [
            transparency[map[0]],
            transparency[map[1]],
            transparency[map[2]],
            transparency[map[3]],
            transparency[map[4]],
            transparency[map[5]],
        ]
    }

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
        let [t0, t1, t2, t3, t4, t5] = self.is_transparent;
        self.is_opaque = !t0 && !t1 && !t2 && !t3 && !t4 && !t5;
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
                    if let Some(red_level) = part.red_light_level {
                        if red_level > 0 {
                            dynamic_torch_mask |= RED_TORCH_MASK;
                        }
                    }
                    if let Some(green_level) = part.green_light_level {
                        if green_level > 0 {
                            dynamic_torch_mask |= GREEN_TORCH_MASK;
                        }
                    }
                    if let Some(blue_level) = part.blue_light_level {
                        if blue_level > 0 {
                            dynamic_torch_mask |= BLUE_TORCH_MASK;
                        }
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
            let (rotation_value, y_rotation) = BlockRotation::decode(rotation);
            let map_index = Self::transparency_rotation_index(rotation_value, y_rotation);
            let map = &transparency_rotation_maps()[map_index];
            Self::apply_transparency_rotation_map(self.is_transparent, map)
        }
    }

    #[inline]
    pub fn get_transparency_from_raw_voxel(&self, raw_voxel: u32) -> [bool; 6] {
        if self.has_uniform_transparency {
            self.is_transparent
        } else {
            let map_index =
                Self::transparency_rotation_index((raw_voxel >> 16) & 0xF, (raw_voxel >> 20) & 0xF);
            let map = &transparency_rotation_maps()[map_index];
            Self::apply_transparency_rotation_map(self.is_transparent, map)
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

    pub(crate) fn get_torch_light_levels_at_xyz(
        &self,
        vx: i32,
        vy: i32,
        vz: i32,
        space: &dyn LightVoxelAccess,
    ) -> (u32, u32, u32) {
        let mut red = self.red_light_level;
        let mut green = self.green_light_level;
        let mut blue = self.blue_light_level;
        let mut unresolved = self.dynamic_torch_mask;
        if unresolved == 0 {
            return (red, green, blue);
        }

        if let Some(patterns) = &self.dynamic_patterns {
            'patterns: for pattern in patterns {
                for part in &pattern.parts {
                    let red_level = part.red_light_level;
                    let green_level = part.green_light_level;
                    let blue_level = part.blue_light_level;
                    let mut part_mask = 0;
                    if unresolved & RED_TORCH_MASK != 0 && red_level.is_some() {
                        part_mask |= RED_TORCH_MASK;
                    }
                    if unresolved & GREEN_TORCH_MASK != 0 && green_level.is_some() {
                        part_mask |= GREEN_TORCH_MASK;
                    }
                    if unresolved & BLUE_TORCH_MASK != 0 && blue_level.is_some() {
                        part_mask |= BLUE_TORCH_MASK;
                    }
                    if part_mask == 0 {
                        continue;
                    }
                    if !Self::evaluate_rule(&part.rule, vx, vy, vz, space) {
                        continue;
                    }
                    if part_mask & RED_TORCH_MASK != 0 {
                        if let Some(level) = red_level {
                            red = level;
                            unresolved &= !RED_TORCH_MASK;
                        }
                    }
                    if part_mask & GREEN_TORCH_MASK != 0 {
                        if let Some(level) = green_level {
                            green = level;
                            unresolved &= !GREEN_TORCH_MASK;
                        }
                    }
                    if part_mask & BLUE_TORCH_MASK != 0 {
                        if let Some(level) = blue_level {
                            blue = level;
                            unresolved &= !BLUE_TORCH_MASK;
                        }
                    }
                    if unresolved == 0 {
                        break 'patterns;
                    }
                }
            }
        }

        (red, green, blue)
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
                if self.dynamic_torch_mask & RED_TORCH_MASK == 0 {
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
                if self.dynamic_torch_mask & GREEN_TORCH_MASK == 0 {
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
                if self.dynamic_torch_mask & BLUE_TORCH_MASK == 0 {
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
                let expected_id = simple_rule.id;
                let expected_rotation = simple_rule.rotation.as_ref();
                let expected_stage = simple_rule.stage;
                if expected_id.is_none() && expected_rotation.is_none() && expected_stage.is_none()
                {
                    return true;
                }
                let [offset_x, offset_y, offset_z] = simple_rule.offset;
                let (vx, vy, vz) = if offset_x == 0 && offset_y == 0 && offset_z == 0 {
                    (vx, vy, vz)
                } else {
                    let Some(vx) = vx.checked_add(offset_x) else {
                        return false;
                    };
                    let Some(vy) = vy.checked_add(offset_y) else {
                        return false;
                    };
                    let Some(vz) = vz.checked_add(offset_z) else {
                        return false;
                    };
                    (vx, vy, vz)
                };
                let raw_voxel = space.get_raw_voxel(vx, vy, vz);

                if let Some(expected_id) = expected_id {
                    if (raw_voxel & 0xFFFF) != expected_id {
                        return false;
                    }
                }

                if let Some(expected_rotation) = expected_rotation {
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

                if let Some(expected_stage) = expected_stage {
                    return ((raw_voxel >> 24) & 0xF) == expected_stage;
                }

                true
            }
            BlockRule::Combination { logic, rules } => {
                let rules_len = rules.len();
                match logic {
                    BlockRuleLogic::And => {
                        if rules_len == 0 {
                            return true;
                        }
                        if rules_len == 1 {
                            return Self::evaluate_rule(&rules[0], vx, vy, vz, space);
                        }
                        for sub_rule in rules {
                            if !Self::evaluate_rule(sub_rule, vx, vy, vz, space) {
                                return false;
                            }
                        }
                        true
                    }
                    BlockRuleLogic::Or => {
                        if rules_len == 0 {
                            return false;
                        }
                        if rules_len == 1 {
                            return Self::evaluate_rule(&rules[0], vx, vy, vz, space);
                        }
                        for sub_rule in rules {
                            if Self::evaluate_rule(sub_rule, vx, vy, vz, space) {
                                return true;
                            }
                        }
                        false
                    }
                    BlockRuleLogic::Not => {
                        if rules_len == 0 {
                            return true;
                        }
                        if rules_len == 1 {
                            return !Self::evaluate_rule(&rules[0], vx, vy, vz, space);
                        }
                        for sub_rule in rules {
                            if Self::evaluate_rule(sub_rule, vx, vy, vz, space) {
                                return false;
                            }
                        }
                        true
                    }
                }
            }
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
        if level > 15 {
            return false;
        }
        let raw = self.get_raw_light(vx, vy, vz);
        let inserted = LightUtils::insert_sunlight(raw, level);
        if inserted == raw {
            return self.contains(vx, vy, vz);
        }
        self.set_raw_light(vx, vy, vz, inserted)
    }

    #[inline]
    fn get_red_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_red_light(self.get_raw_light(vx, vy, vz))
    }

    #[inline]
    fn set_red_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        if level > 15 {
            return false;
        }
        let raw = self.get_raw_light(vx, vy, vz);
        let inserted = LightUtils::insert_red_light(raw, level);
        if inserted == raw {
            return self.contains(vx, vy, vz);
        }
        self.set_raw_light(vx, vy, vz, inserted)
    }

    #[inline]
    fn get_green_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_green_light(self.get_raw_light(vx, vy, vz))
    }

    #[inline]
    fn set_green_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        if level > 15 {
            return false;
        }
        let raw = self.get_raw_light(vx, vy, vz);
        let inserted = LightUtils::insert_green_light(raw, level);
        if inserted == raw {
            return self.contains(vx, vy, vz);
        }
        self.set_raw_light(vx, vy, vz, inserted)
    }

    #[inline]
    fn get_blue_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_blue_light(self.get_raw_light(vx, vy, vz))
    }

    #[inline]
    fn set_blue_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        if level > 15 {
            return false;
        }
        let raw = self.get_raw_light(vx, vy, vz);
        let inserted = LightUtils::insert_blue_light(raw, level);
        if inserted == raw {
            return self.contains(vx, vy, vz);
        }
        self.set_raw_light(vx, vy, vz, inserted)
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
            self.lookup_sparse = None;
            self.air_index = None;
            return;
        }

        self.air_index = None;
        let mut max_id = 0usize;
        for (index, (id, block)) in self.blocks_by_id.iter_mut().enumerate() {
            if block.id != *id {
                block.id = *id;
            }
            block.recompute_flags();
            let id_usize = *id as usize;
            if id_usize > max_id {
                max_id = id_usize;
            }
            if *id == 0 {
                self.air_index = Some(index);
            }
        }

        let dense_limit = self
            .blocks_by_id
            .len()
            .saturating_mul(DENSE_LOOKUP_MAX_GROWTH_FACTOR)
            .max(64);
        if max_id <= dense_limit {
            let mut dense = vec![usize::MAX; max_id.saturating_add(1)];
            for (index, (id, _)) in self.blocks_by_id.iter().enumerate() {
                dense[*id as usize] = index;
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
        if id == 0 {
            if let Some(index) = self.air_index {
                if index < self.blocks_by_id.len() {
                    return &self.blocks_by_id[index].1;
                }
            }
        }

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
            if index < self.blocks_by_id.len() {
                return &self.blocks_by_id[index].1;
            }
        }

        &self.default_block
    }

    pub fn has_type(&self, id: u32) -> bool {
        if id == 0 {
            if let Some(index) = self.air_index {
                if index < self.blocks_by_id.len() {
                    return true;
                }
            }
        }

        if let Some(dense) = &self.lookup_dense {
            let idx = id as usize;
            return idx < dense.len() && dense[idx] != usize::MAX;
        }

        if let Some(sparse) = &self.lookup_sparse {
            return sparse.contains_key(&id);
        }

        for (block_id, _) in &self.blocks_by_id {
            if *block_id == id {
                return true;
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use voxelize_core::{BlockRotation, BlockRule, BlockRuleLogic, BlockSimpleRule, LightColor, LightUtils};

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
    fn build_cache_clears_stale_air_index_after_blocks_replaced() {
        let mut air = LightBlock::default_air();
        air.id = 0;
        let mut solid = LightBlock::default_air();
        solid.id = 1;

        let mut registry = LightRegistry::new(vec![(0, air), (1, solid.clone())]);
        assert_eq!(registry.get_block_by_id(99).id, 0);

        registry.blocks_by_id = vec![(1, solid)];
        registry.build_cache();

        assert_eq!(registry.get_block_by_id(99).id, 0);
        assert!(!registry.has_type(0));
    }

    #[test]
    fn get_block_by_id_ignores_out_of_bounds_air_index() {
        let mut solid = LightBlock::default_air();
        solid.id = 1;

        let mut registry = LightRegistry::new(vec![(1, solid)]);
        registry.air_index = Some(99);

        assert_eq!(registry.get_block_by_id(99).id, 0);
    }

    #[test]
    fn recompute_flags_tracks_dynamic_torch_color_masks() {
        let block = LightBlock::new(
            10,
            [true, true, true, true, true, true],
            false,
            0,
            0,
            0,
            Some(vec![LightDynamicPattern {
                parts: vec![LightConditionalPart {
                    rule: BlockRule::None,
                    red_light_level: None,
                    green_light_level: Some(7),
                    blue_light_level: None,
                }],
            }]),
        );
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
    fn combined_torch_level_lookup_matches_per_color_dynamic_resolution() {
        let block = LightBlock::new(
            12,
            [true, true, true, true, true, true],
            false,
            2,
            3,
            4,
            Some(vec![LightDynamicPattern {
                parts: vec![
                    LightConditionalPart {
                        rule: BlockRule::None,
                        red_light_level: Some(5),
                        green_light_level: None,
                        blue_light_level: Some(1),
                    },
                    LightConditionalPart {
                        rule: BlockRule::None,
                        red_light_level: Some(8),
                        green_light_level: Some(7),
                        blue_light_level: Some(9),
                    },
                ],
            }]),
        );

        let levels = block.get_torch_light_levels_at_xyz(0, 0, 0, &NoopAccess);
        assert_eq!(levels, (5, 7, 1));
        assert_eq!(
            levels.0,
            block.get_torch_light_level_at_xyz(0, 0, 0, &NoopAccess, &LightColor::Red)
        );
        assert_eq!(
            levels.1,
            block.get_torch_light_level_at_xyz(0, 0, 0, &NoopAccess, &LightColor::Green)
        );
        assert_eq!(
            levels.2,
            block.get_torch_light_level_at_xyz(0, 0, 0, &NoopAccess, &LightColor::Blue)
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
    fn rotated_transparency_matches_core_rotation_logic() {
        let block = LightBlock::new(
            11,
            [true, false, true, false, true, false],
            false,
            0,
            0,
            0,
            None,
        );

        let rotations = [
            BlockRotation::encode(0, 0),
            BlockRotation::encode(0, 1),
            BlockRotation::encode(0, 4),
            BlockRotation::encode(1, 0),
            BlockRotation::encode(2, 7),
            BlockRotation::encode(3, 3),
            BlockRotation::encode(4, 0),
            BlockRotation::encode(5, 0),
        ];

        for rotation in rotations {
            assert_eq!(
                block.get_rotated_transparency(&rotation),
                rotation.rotate_transparency(block.is_transparent)
            );
        }
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

    #[test]
    fn dynamic_not_rule_with_single_subrule_inverts_result() {
        let mut block = LightBlock::default_air();
        block.dynamic_patterns = Some(vec![LightDynamicPattern {
            parts: vec![LightConditionalPart {
                rule: BlockRule::Combination {
                    logic: BlockRuleLogic::Not,
                    rules: vec![BlockRule::Simple(BlockSimpleRule {
                        offset: [0, 0, 0],
                        id: Some(1),
                        rotation: None,
                        stage: None,
                    })],
                },
                red_light_level: Some(9),
                green_light_level: None,
                blue_light_level: None,
            }],
        }]);
        block.recompute_flags();

        let matched_level =
            block.get_torch_light_level_at_xyz(0, 0, 0, &SingleNotAccess, &LightColor::Red);
        assert_eq!(matched_level, 0);

        let unmatched_level =
            block.get_torch_light_level_at_xyz(0, 0, 0, &NoopAccess, &LightColor::Red);
        assert_eq!(unmatched_level, 9);
    }

    #[test]
    fn dynamic_single_subrule_and_or_rules_match_subrule_result() {
        let mut and_block = LightBlock::default_air();
        and_block.dynamic_patterns = Some(vec![LightDynamicPattern {
            parts: vec![LightConditionalPart {
                rule: BlockRule::Combination {
                    logic: BlockRuleLogic::And,
                    rules: vec![BlockRule::Simple(BlockSimpleRule {
                        offset: [0, 0, 0],
                        id: Some(1),
                        rotation: None,
                        stage: None,
                    })],
                },
                red_light_level: Some(7),
                green_light_level: None,
                blue_light_level: None,
            }],
        }]);
        and_block.recompute_flags();
        assert_eq!(
            and_block.get_torch_light_level_at_xyz(0, 0, 0, &SingleNotAccess, &LightColor::Red),
            7
        );
        assert_eq!(
            and_block.get_torch_light_level_at_xyz(0, 0, 0, &NoopAccess, &LightColor::Red),
            0
        );

        let mut or_block = LightBlock::default_air();
        or_block.dynamic_patterns = Some(vec![LightDynamicPattern {
            parts: vec![LightConditionalPart {
                rule: BlockRule::Combination {
                    logic: BlockRuleLogic::Or,
                    rules: vec![BlockRule::Simple(BlockSimpleRule {
                        offset: [0, 0, 0],
                        id: Some(1),
                        rotation: None,
                        stage: None,
                    })],
                },
                red_light_level: Some(11),
                green_light_level: None,
                blue_light_level: None,
            }],
        }]);
        or_block.recompute_flags();
        assert_eq!(
            or_block.get_torch_light_level_at_xyz(0, 0, 0, &SingleNotAccess, &LightColor::Red),
            11
        );
        assert_eq!(
            or_block.get_torch_light_level_at_xyz(0, 0, 0, &NoopAccess, &LightColor::Red),
            0
        );
    }

    #[test]
    fn dynamic_empty_combination_rules_follow_logic_identities() {
        let mut and_block = LightBlock::default_air();
        and_block.dynamic_patterns = Some(vec![LightDynamicPattern {
            parts: vec![LightConditionalPart {
                rule: BlockRule::Combination {
                    logic: BlockRuleLogic::And,
                    rules: vec![],
                },
                red_light_level: Some(6),
                green_light_level: None,
                blue_light_level: None,
            }],
        }]);
        and_block.recompute_flags();
        assert_eq!(
            and_block.get_torch_light_level_at_xyz(0, 0, 0, &NoopAccess, &LightColor::Red),
            6
        );

        let mut or_block = LightBlock::default_air();
        or_block.dynamic_patterns = Some(vec![LightDynamicPattern {
            parts: vec![LightConditionalPart {
                rule: BlockRule::Combination {
                    logic: BlockRuleLogic::Or,
                    rules: vec![],
                },
                red_light_level: Some(6),
                green_light_level: None,
                blue_light_level: None,
            }],
        }]);
        or_block.recompute_flags();
        assert_eq!(
            or_block.get_torch_light_level_at_xyz(0, 0, 0, &NoopAccess, &LightColor::Red),
            0
        );

        let mut not_block = LightBlock::default_air();
        not_block.dynamic_patterns = Some(vec![LightDynamicPattern {
            parts: vec![LightConditionalPart {
                rule: BlockRule::Combination {
                    logic: BlockRuleLogic::Not,
                    rules: vec![],
                },
                red_light_level: Some(6),
                green_light_level: None,
                blue_light_level: None,
            }],
        }]);
        not_block.recompute_flags();
        assert_eq!(
            not_block.get_torch_light_level_at_xyz(0, 0, 0, &NoopAccess, &LightColor::Red),
            6
        );
    }

    #[test]
    fn dynamic_simple_rule_overflow_offsets_return_false() {
        let mut block = LightBlock::default_air();
        block.dynamic_patterns = Some(vec![LightDynamicPattern {
            parts: vec![LightConditionalPart {
                rule: BlockRule::Simple(BlockSimpleRule {
                    offset: [1, 0, 0],
                    id: Some(1),
                    rotation: None,
                    stage: None,
                }),
                red_light_level: Some(9),
                green_light_level: None,
                blue_light_level: None,
            }],
        }]);
        block.recompute_flags();

        let level =
            block.get_torch_light_level_at_xyz(i32::MAX, 0, 0, &NoopAccess, &LightColor::Red);
        assert_eq!(level, 0);
    }

    #[test]
    fn dynamic_simple_rule_without_conditions_ignores_overflowed_offsets() {
        let mut block = LightBlock::default_air();
        block.dynamic_patterns = Some(vec![LightDynamicPattern {
            parts: vec![LightConditionalPart {
                rule: BlockRule::Simple(BlockSimpleRule {
                    offset: [1, 0, 0],
                    id: None,
                    rotation: None,
                    stage: None,
                }),
                red_light_level: Some(9),
                green_light_level: None,
                blue_light_level: None,
            }],
        }]);
        block.recompute_flags();

        let level =
            block.get_torch_light_level_at_xyz(i32::MAX, 0, 0, &NoopAccess, &LightColor::Red);
        assert_eq!(level, 9);
    }

    #[test]
    fn default_light_setters_skip_unchanged_writes_and_preserve_contains_result() {
        let initial_raw = LightUtils::insert_red_light(0, 7);
        let mut present = SetterProbeAccess {
            raw_light: initial_raw,
            contains: true,
            set_calls: 0,
        };
        assert!(super::LightVoxelAccess::set_red_light(&mut present, 0, 0, 0, 7));
        assert_eq!(present.set_calls, 0);
        assert_eq!(present.raw_light, initial_raw);

        let mut missing = SetterProbeAccess {
            raw_light: initial_raw,
            contains: false,
            set_calls: 0,
        };
        assert!(!super::LightVoxelAccess::set_red_light(&mut missing, 0, 0, 0, 7));
        assert_eq!(missing.set_calls, 0);
        assert_eq!(missing.raw_light, initial_raw);

        assert!(super::LightVoxelAccess::set_red_light(&mut present, 0, 0, 0, 3));
        assert_eq!(present.set_calls, 1);
        assert_eq!(LightUtils::extract_red_light(present.raw_light), 3);
    }

    #[test]
    fn default_light_setters_reject_out_of_range_levels_without_writes() {
        let mut probe = SetterProbeAccess {
            raw_light: 0,
            contains: true,
            set_calls: 0,
        };

        assert!(!super::LightVoxelAccess::set_sunlight(
            &mut probe, 0, 0, 0, 16
        ));
        assert!(!super::LightVoxelAccess::set_red_light(
            &mut probe, 0, 0, 0, 16
        ));
        assert!(!super::LightVoxelAccess::set_green_light(
            &mut probe, 0, 0, 0, 16
        ));
        assert!(!super::LightVoxelAccess::set_blue_light(
            &mut probe, 0, 0, 0, 16
        ));
        assert_eq!(probe.set_calls, 0);
        assert_eq!(probe.raw_light, 0);
    }

    struct SetterProbeAccess {
        raw_light: u32,
        contains: bool,
        set_calls: usize,
    }

    struct NoopAccess;
    struct NotRuleAccess;
    struct SingleNotAccess;

    impl super::LightVoxelAccess for SetterProbeAccess {
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
            self.raw_light
        }

        fn set_raw_light(&mut self, _vx: i32, _vy: i32, _vz: i32, level: u32) -> bool {
            self.set_calls += 1;
            self.raw_light = level;
            self.contains
        }

        fn get_max_height(&self, _vx: i32, _vz: i32) -> u32 {
            0
        }

        fn contains(&self, _vx: i32, _vy: i32, _vz: i32) -> bool {
            self.contains
        }
    }

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

    impl super::LightVoxelAccess for SingleNotAccess {
        fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
            if vx == 0 && vy == 0 && vz == 0 {
                return 1;
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
