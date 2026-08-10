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
//! bits 16..=17  ambient occlusion, 0..=3 — OR the emissive strength index
//!               when bit 30 is set (an emissive face bypasses the lighting
//!               model, so it has no use for an occlusion value)
//! bit  18       fluid
//! bit  19       emitted by the greedy path
//! bit  20       surface that should wave
//! bit  21       in contact with fluid
//! bits 22..=25  stack index: like blocks below this one in its vertical run
//! bits 26..=29  stack count: length of that run, minus one
//!               (a plant's run is its stack group read from the root; a
//!                fluid's is its own column read from the surface)
//! bit  30       emissive face; reinterprets bits 16..=17 as an index into
//!               EMISSIVE_LEVELS
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

/// A voxel's position within its vertical run, and how long that run is.
/// Four bits each caps a run at 16, which is longer than any stack the shader
/// needs to shade as one object, and deep enough that fluid past it is
/// already black.
pub const STACK_INDEX_SHIFT: i32 = 22;
pub const STACK_COUNT_SHIFT: i32 = 26;
pub const STACK_FIELD_BITS: i32 = 0xF;
pub const STACK_MAX: u32 = 16;

/// Marks the face emissive: the fragment shader bypasses the lighting model
/// and outputs the texture at the strength the AO bits index into
/// {@EMISSIVE_LEVELS}. The AO field is reusable because an emissive face
/// never shades, so an occlusion value would be dead weight.
pub const EMISSIVE_BIT: i32 = 1 << 30;

/// The four strengths an emissive face can render at, indexed by the two AO
/// bits under `EMISSIVE_BIT`. Mirrored by the client's `uEmissiveLevels`
/// uniform in `local-lights/shader.ts`; change neither side alone. Declared
/// strengths quantize to the nearest entry.
pub const EMISSIVE_LEVELS: [f32; 4] = [1.0, 1.75, 2.5, 3.5];

/// Highest bit any field above may touch. Bit 31 is the sign of the signed
/// int the attribute is uploaded as, so it stays clear.
pub const HIGHEST_ALLOCATED_BIT: i32 = 30;

/// The AO-field bits a face should carry: the emissive flag plus the
/// quantized strength index for an emissive face, or the plain occlusion
/// value for everything else.
#[inline]
pub fn ao_or_emissive_bits(ao: i32, emissive: f32) -> i32 {
    if emissive <= 0.0 {
        return ao << AO_SHIFT;
    }
    let mut index = 0usize;
    let mut best = f32::MAX;
    for (i, level) in EMISSIVE_LEVELS.iter().enumerate() {
        let distance = (emissive - level).abs();
        if distance < best {
            best = distance;
            index = i;
        }
    }
    EMISSIVE_BIT | ((index as i32) << AO_SHIFT)
}

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
    /// The emissive strength index is deliberately absent — it reuses the AO
    /// bits under `EMISSIVE_BIT`, which is the one sanctioned overlap.
    #[test]
    fn no_field_overlaps_another() {
        let fields: [(&str, i32); 9] = [
            ("light", LIGHT_MASK),
            ("ao", AO_BITS << AO_SHIFT),
            ("fluid", FLUID_BIT),
            ("greedy", GREEDY_BIT),
            ("wave", WAVE_BIT),
            ("water_exposed", WATER_EXPOSED_BIT),
            ("stack_index", STACK_FIELD_BITS << STACK_INDEX_SHIFT),
            ("stack_count", STACK_FIELD_BITS << STACK_COUNT_SHIFT),
            ("emissive", EMISSIVE_BIT),
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

    #[test]
    fn non_emissive_faces_keep_their_ao() {
        for ao in 0..=3 {
            let bits = ao_or_emissive_bits(ao, 0.0);
            assert_eq!(bits, ao << AO_SHIFT);
            assert_eq!(bits & EMISSIVE_BIT, 0);
        }
    }

    /// Strengths quantize to the nearest table entry, deterministically, and
    /// the packed word stays inside the allocated bits.
    #[test]
    fn emissive_strengths_quantize_to_the_level_table() {
        let cases = [
            (0.2, 0),
            (1.0, 0),
            (1.4, 1),
            (1.75, 1),
            (2.4, 2),
            (2.5, 2),
            // Equidistant between 2.5 and 3.5: the lower index wins the tie.
            (3.0, 2),
            (3.2, 3),
            (3.5, 3),
            (99.0, 3),
        ];
        for (strength, expected_index) in cases {
            let bits = ao_or_emissive_bits(1, strength);
            assert_ne!(bits & EMISSIVE_BIT, 0, "strength {strength}");
            assert_eq!(
                (bits >> AO_SHIFT) & AO_BITS,
                expected_index,
                "strength {strength}",
            );
            assert_eq!(bits >> (HIGHEST_ALLOCATED_BIT + 1), 0);
            assert!(bits >= 0, "the sign bit must stay clear");
        }
    }
}
