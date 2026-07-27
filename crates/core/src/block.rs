use crate::BlockRotation;

pub const PY_ROTATION: u32 = 0;
pub const NY_ROTATION: u32 = 1;
pub const PX_ROTATION: u32 = 2;
pub const NX_ROTATION: u32 = 3;
pub const PZ_ROTATION: u32 = 4;
pub const NZ_ROTATION: u32 = 5;

pub const Y_ROT_SEGMENTS: u32 = 16;

pub const ROTATION_MASK: u32 = 0xFFF0FFFF;
pub const Y_ROTATION_MASK: u32 = 0xFF0FFFFF;
pub const STAGE_MASK: u32 = 0xF0FFFFFF;

/// Bit 28 of the voxel word: this voxel holds the world's waterlogging fluid
/// in addition to its block.
pub const WATERLOGGED_BIT: u32 = 1 << 28;
pub const WATERLOGGED_MASK: u32 = !WATERLOGGED_BIT;

/// Bits 29-31: the level of the fluid a waterlogged voxel holds, matching a
/// fluid block's `stage` range of 0-7.
///
/// The fluid gets its own field rather than borrowing `stage` so that a block
/// with state of its own — a door's open/closed, a crop's growth — can still
/// be waterlogged. Sharing the nibble made that combination silently corrupt
/// one or the other, which is exactly the kind of conflict that should be
/// unrepresentable rather than documented.
pub const WATERLOG_LEVEL_SHIFT: u32 = 29;
pub const WATERLOG_LEVEL_MASK: u32 = 0x7 << WATERLOG_LEVEL_SHIFT;

pub struct BlockUtils;

impl BlockUtils {
    #[inline]
    pub fn extract_id(voxel: u32) -> u32 {
        voxel & 0xFFFF
    }

    #[inline]
    pub fn insert_id(voxel: u32, id: u32) -> u32 {
        (voxel & 0xFFFF0000) | (id & 0xFFFF)
    }

    #[inline]
    pub fn extract_rotation(voxel: u32) -> BlockRotation {
        let rotation = (voxel >> 16) & 0xF;
        let y_rot = (voxel >> 20) & 0xF;
        BlockRotation::encode(rotation, y_rot)
    }

    #[inline]
    pub fn insert_rotation(voxel: u32, rotation: &BlockRotation) -> u32 {
        let (rotation_val, y_rot) = BlockRotation::decode(rotation);
        let value = (voxel & ROTATION_MASK) | ((rotation_val & 0xF) << 16);
        (value & Y_ROTATION_MASK) | ((y_rot & 0xF) << 20)
    }

    #[inline]
    pub fn extract_stage(voxel: u32) -> u32 {
        (voxel >> 24) & 0xF
    }

    #[inline]
    pub fn insert_stage(voxel: u32, stage: u32) -> u32 {
        assert!(stage <= 15, "Maximum stage is 15");
        (voxel & STAGE_MASK) | (stage << 24)
    }

    #[inline]
    pub fn extract_waterlogged(voxel: u32) -> bool {
        voxel & WATERLOGGED_BIT != 0
    }

    #[inline]
    pub fn insert_waterlogged(voxel: u32, is_waterlogged: bool) -> u32 {
        if is_waterlogged {
            voxel | WATERLOGGED_BIT
        } else {
            voxel & WATERLOGGED_MASK
        }
    }

    #[inline]
    pub fn extract_waterlog_level(voxel: u32) -> u32 {
        (voxel & WATERLOG_LEVEL_MASK) >> WATERLOG_LEVEL_SHIFT
    }

    #[inline]
    pub fn insert_waterlog_level(voxel: u32, level: u32) -> u32 {
        assert!(level <= 7, "Maximum waterlog level is 7");
        (voxel & !WATERLOG_LEVEL_MASK) | (level << WATERLOG_LEVEL_SHIFT)
    }

    /// The level of fluid standing in this voxel, wherever it is stored: a
    /// waterlogged block keeps its water's level in its own field, a fluid
    /// block keeps its own in `stage`.
    ///
    /// This is the only place the two layouts meet; every caller asking "how
    /// deep is the fluid here" should go through it rather than reaching for
    /// one field and being wrong about half the voxels.
    #[inline]
    pub fn extract_fluid_level(voxel: u32) -> u32 {
        if Self::extract_waterlogged(voxel) {
            Self::extract_waterlog_level(voxel)
        } else {
            Self::extract_stage(voxel)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_id_roundtrip() {
        for id in [0, 1, 100, 1000, 65535] {
            let voxel = BlockUtils::insert_id(0, id);
            assert_eq!(BlockUtils::extract_id(voxel), id);
        }
    }

    #[test]
    fn test_id_overflow() {
        let voxel = BlockUtils::insert_id(0, 65537);
        assert_eq!(BlockUtils::extract_id(voxel), 1);
    }

    #[test]
    fn test_stage_roundtrip() {
        for stage in 0..=15 {
            let voxel = BlockUtils::insert_stage(0, stage);
            assert_eq!(BlockUtils::extract_stage(voxel), stage);
        }
    }

    #[test]
    fn test_combined_voxel_data() {
        let mut voxel = 0u32;
        voxel = BlockUtils::insert_id(voxel, 42);
        voxel = BlockUtils::insert_stage(voxel, 7);

        assert_eq!(BlockUtils::extract_id(voxel), 42);
        assert_eq!(BlockUtils::extract_stage(voxel), 7);
    }

    #[test]
    fn test_waterlogged_roundtrip() {
        for is_waterlogged in [true, false] {
            let voxel = BlockUtils::insert_waterlogged(0, is_waterlogged);
            assert_eq!(BlockUtils::extract_waterlogged(voxel), is_waterlogged);
        }
    }

    #[test]
    fn test_waterlogged_does_not_disturb_other_fields() {
        let mut voxel = 0u32;
        voxel = BlockUtils::insert_id(voxel, 65535);
        voxel = BlockUtils::insert_rotation(voxel, &BlockRotation::NZ(0.0));
        voxel = BlockUtils::insert_stage(voxel, 15);

        let logged = BlockUtils::insert_waterlogged(voxel, true);
        assert!(BlockUtils::extract_waterlogged(logged));
        assert_eq!(BlockUtils::extract_id(logged), 65535);
        assert_eq!(BlockUtils::extract_stage(logged), 15);
        assert_eq!(
            BlockUtils::extract_rotation(logged),
            BlockRotation::NZ(0.0)
        );

        let unlogged = BlockUtils::insert_waterlogged(logged, false);
        assert_eq!(unlogged, voxel);
    }

    #[test]
    fn test_waterlog_level_roundtrip() {
        for level in 0..=7 {
            let voxel = BlockUtils::insert_waterlog_level(0, level);
            assert_eq!(BlockUtils::extract_waterlog_level(voxel), level);
        }
    }

    #[test]
    fn test_waterlog_level_is_independent_of_stage() {
        let mut voxel = BlockUtils::insert_id(0, 4242);
        voxel = BlockUtils::insert_stage(voxel, 9);
        voxel = BlockUtils::insert_waterlogged(voxel, true);
        voxel = BlockUtils::insert_waterlog_level(voxel, 5);

        // A waterlogged block keeps its own stage untouched; the two states
        // coexist so a door or crop can also hold water.
        assert_eq!(BlockUtils::extract_stage(voxel), 9);
        assert_eq!(BlockUtils::extract_waterlog_level(voxel), 5);
        assert_eq!(BlockUtils::extract_id(voxel), 4242);
    }

    #[test]
    fn test_fluid_level_reads_the_field_that_owns_it() {
        let fluid = BlockUtils::insert_stage(BlockUtils::insert_id(0, 30000), 3);
        assert_eq!(BlockUtils::extract_fluid_level(fluid), 3);

        let waterlogged = BlockUtils::insert_waterlog_level(
            BlockUtils::insert_waterlogged(BlockUtils::insert_stage(0, 3), true),
            6,
        );
        assert_eq!(BlockUtils::extract_fluid_level(waterlogged), 6);
    }

    #[test]
    fn test_other_fields_do_not_disturb_waterlogged() {
        let mut voxel = BlockUtils::insert_waterlogged(0, true);
        voxel = BlockUtils::insert_id(voxel, 1234);
        voxel = BlockUtils::insert_rotation(voxel, &BlockRotation::PX(0.0));
        voxel = BlockUtils::insert_stage(voxel, 3);

        assert!(BlockUtils::extract_waterlogged(voxel));
    }

    #[test]
    fn test_rotation_roundtrip() {
        let rotation = BlockRotation::PY(0.0);
        let voxel = BlockUtils::insert_rotation(0, &rotation);
        let extracted = BlockUtils::extract_rotation(voxel);
        assert_eq!(extracted, rotation);
    }
}
