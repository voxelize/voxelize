//! Layout of the packed per-vertex `light` attribute.
//!
//! Every bit the mesher writes into that attribute is allocated here, and
//! nowhere else. It used to be a handful of bare `1 << 20`s spread across
//! `faces.rs` and `greedy.rs` with the matching shifts hand-copied into the
//! client's shader, which is exactly the arrangement in which two features
//! quietly claim one bit.
//!
//! The client mirrors this map in `shaders.ts`; `VERTEX_LIGHT_LAYOUT_DOC`
//! below is the shared reference both sides are written against.
//!
//! ```text
//! bits  0..=15  light, four nibbles: red, green, blue, sunlight
//! bits 16..=17  ambient occlusion, 0..=3
//! bit  18       fluid
//! bit  19       emitted by the greedy path
//! bit  20       surface that should wave
//! bit  21       in contact with fluid
//! bits 22..=25  stack index: like blocks below this one in its vertical run
//! bits 26..=29  stack count: length of that run, minus one
//! bit  30       unallocated
//! bit  31       sign; the attribute is read as a signed int, keep it clear
//! ```

/// Mask of the light nibbles.
pub const LIGHT_MASK: i32 = 0xFFFF;

pub const AO_SHIFT: i32 = 16;
pub const AO_BITS: i32 = 0x3;

pub const FLUID_BIT: i32 = 1 << 18;
pub const GREEDY_BIT: i32 = 1 << 19;
pub const WAVE_BIT: i32 = 1 << 20;
pub const WATER_EXPOSED_BIT: i32 = 1 << 21;

/// A voxel's position within a vertical run of blocks sharing a stack group,
/// and how long that run is. Four bits each caps a run at 16, which is longer
/// than any stack the shader needs to shade as one object.
pub const STACK_INDEX_SHIFT: i32 = 22;
pub const STACK_COUNT_SHIFT: i32 = 26;
pub const STACK_FIELD_BITS: i32 = 0xF;
pub const STACK_MAX: u32 = 16;

/// Highest bit any field above may touch. Bit 31 is the sign of the signed
/// int the attribute is uploaded as, so it stays clear.
pub const HIGHEST_ALLOCATED_BIT: i32 = 29;

/// Pack a stack position into an already-assembled light word.
#[inline]
pub fn with_stack(light: i32, index: u32, count: u32) -> i32 {
    let index = index.min(STACK_MAX - 1) as i32;
    let count = count.clamp(1, STACK_MAX) as i32 - 1;
    light | (index << STACK_INDEX_SHIFT) | (count << STACK_COUNT_SHIFT)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The point of this module: every allocated field occupies its own bits.
    #[test]
    fn no_field_overlaps_another() {
        let fields: [(&str, i32); 8] = [
            ("light", LIGHT_MASK),
            ("ao", AO_BITS << AO_SHIFT),
            ("fluid", FLUID_BIT),
            ("greedy", GREEDY_BIT),
            ("wave", WAVE_BIT),
            ("water_exposed", WATER_EXPOSED_BIT),
            ("stack_index", STACK_FIELD_BITS << STACK_INDEX_SHIFT),
            ("stack_count", STACK_FIELD_BITS << STACK_COUNT_SHIFT),
        ];

        let mut claimed = 0i32;
        for (name, mask) in fields {
            assert_eq!(
                claimed & mask,
                0,
                "{name} overlaps a field allocated before it",
            );
            claimed |= mask;
        }

        assert_eq!(
            claimed >> (HIGHEST_ALLOCATED_BIT + 1),
            0,
            "a field reaches past the highest allocated bit",
        );
        assert!(claimed >= 0, "the sign bit must stay clear");
    }

    #[test]
    fn stack_packs_and_survives_the_other_fields() {
        for (index, count) in [(0u32, 1u32), (3, 4), (15, 16), (7, 9)] {
            let light = with_stack(
                0x1234 | (2 << AO_SHIFT) | FLUID_BIT | WATER_EXPOSED_BIT,
                index,
                count,
            );
            assert_eq!(
                (light >> STACK_INDEX_SHIFT) & STACK_FIELD_BITS,
                index as i32,
            );
            assert_eq!(
                ((light >> STACK_COUNT_SHIFT) & STACK_FIELD_BITS) + 1,
                count as i32,
            );
            assert_eq!(light & LIGHT_MASK, 0x1234);
            assert_eq!((light >> AO_SHIFT) & AO_BITS, 2);
            assert_ne!(light & FLUID_BIT, 0);
        }
    }

    /// A run longer than the field can hold must saturate, not wrap into the
    /// neighbouring field.
    #[test]
    fn oversized_stacks_saturate() {
        let light = with_stack(0, 99, 99);
        assert_eq!(
            (light >> STACK_INDEX_SHIFT) & STACK_FIELD_BITS,
            STACK_MAX as i32 - 1,
        );
        assert_eq!(
            ((light >> STACK_COUNT_SHIFT) & STACK_FIELD_BITS) + 1,
            STACK_MAX as i32,
        );
        assert_eq!(light >> (HIGHEST_ALLOCATED_BIT + 1), 0);
    }
}
