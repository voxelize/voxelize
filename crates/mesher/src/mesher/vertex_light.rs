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
//! bit  19       emitted by the greedy path — OR, under bit 18, a fluid pane:
//!               a vertical fluid face pressed against a see-through solid
//!               (a Barrier or glass tank wall) rather than open air. A
//!               fluid never comes off the greedy path, so the bit is free
//!               there, the same way the AO bits are free under bit 30.
//! bit  20       surface that should wave
//! bit  21       in contact with fluid
//! bits 22..=25  stack index: like blocks below this one in its vertical run
//! bits 26..=29  stack count: length of that run, minus one
//!               (a plant's run is its stack group read from the root; a
//!                fluid's is its own column read from the surface) — OR,
//!               under bits 18 and 20 together, the surface flow direction
//!               at this vertex: a vertex that waves has no fluid above it,
//!               so its count is its index plus one and the field is free.
//!               0 is still water; 1..=15 is a direction in 24° steps from
//!               +x toward +z.
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
/// A vertical fluid face whose neighbour is a see-through solid instead of
/// air: the water pressed against a Barrier or glass tank wall. The shader
/// draws a pane as a window — faded, matte, and dropped entirely when looked
/// at head-on — and a wall against air as the water's own surface. Only
/// meaningful under `FLUID_BIT`; on any other face this bit is `GREEDY_BIT`.
pub const FLUID_PANE_BIT: i32 = GREEDY_BIT;
pub const WAVE_BIT: i32 = 1 << 20;
pub const WATER_EXPOSED_BIT: i32 = 1 << 21;

/// A vertex's position within a non-fluid vertical run, or a fluid voxel's
/// position within its column, plus the run length. Non-fluid upper-boundary
/// vertices advance one step so full-height quads bend instead of mapping
/// both y=0 and y=1 to the same `fract(y)` value in the shader.
///
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

/// The surface flow direction rides the stack-count field on a fluid vertex
/// that waves. Such a vertex belongs to a voxel with none of its fluid above
/// it, so the column count it would carry is the index plus one and the
/// shader reconstructs it; the four bits carry the flow at that vertex
/// instead, which the shader interpolates across the face. That per-vertex
/// interpolation is what makes the flow field smooth: a slope read per face
/// left a visible seam wherever two faces disagreed on direction.
pub const FLOW_SHIFT: i32 = STACK_COUNT_SHIFT;
pub const FLOW_FIELD_BITS: i32 = STACK_FIELD_BITS;
/// Code for still water.
pub const FLOW_STILL: u32 = 0;
/// Directions the field can name besides still, in equal steps around the
/// circle from +x toward +z. 15 gives 24° steps, which interpolation across
/// a face smooths well below anything the eye reads on moving water.
pub const FLOW_DIRECTIONS: u32 = 15;

/// Quantize a downhill direction into a flow code. `None` is still water.
#[inline]
pub fn flow_code(direction: Option<[f32; 2]>) -> u32 {
    let Some([dx, dz]) = direction else {
        return FLOW_STILL;
    };
    let turn = dz.atan2(dx) / std::f32::consts::TAU;
    let step = (turn * FLOW_DIRECTIONS as f32).round() as i32;
    let step = step.rem_euclid(FLOW_DIRECTIONS as i32) as u32;
    1 + step
}

/// The direction a flow code names, as a unit vector `[x, z]`; `None` for
/// still water. The shader performs the same decode.
#[inline]
pub fn flow_direction(code: u32) -> Option<[f32; 2]> {
    if code == FLOW_STILL || code > FLOW_DIRECTIONS {
        return None;
    }
    let angle = (code - 1) as f32 * std::f32::consts::TAU / FLOW_DIRECTIONS as f32;
    Some([angle.cos(), angle.sin()])
}

/// Pack a fluid surface vertex: its column index, and the flow code in place
/// of the redundant count.
#[inline]
pub fn with_surface_flow(light: i32, index: u32, code: u32) -> i32 {
    let index = index.min(STACK_MAX - 1) as i32;
    let code = code.min(FLOW_DIRECTIONS) as i32;
    light | (index << STACK_INDEX_SHIFT) | (code << FLOW_SHIFT)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The point of this module: every allocated field occupies its own bits.
    /// Two reuses are deliberately absent: the emissive strength index rides
    /// the AO bits under `EMISSIVE_BIT`, and the fluid pane flag rides the
    /// greedy bit under `FLUID_BIT`. Each is legal only because the field it
    /// borrows is meaningless on the face that borrows it.
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

    /// The pane flag may only ever alias the greedy bit: the shader decodes
    /// bit 19 as "pane" on a fluid vertex and "greedy" on everything else,
    /// so giving the pane its own bit would silently leave the shader
    /// reading the wrong one.
    #[test]
    fn the_fluid_pane_flag_rides_the_greedy_bit() {
        assert_eq!(FLUID_PANE_BIT, GREEDY_BIT);
        assert_eq!(FLUID_PANE_BIT & FLUID_BIT, 0);
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

    /// The flow field may only ever alias the count field: the shader
    /// reconstructs a waving fluid vertex's count from its index and reads
    /// these bits as flow, so giving flow its own bits would leave the
    /// shader reading the wrong ones.
    #[test]
    fn the_flow_field_rides_the_stack_count() {
        assert_eq!(FLOW_SHIFT, STACK_COUNT_SHIFT);
        assert_eq!(FLOW_FIELD_BITS, STACK_FIELD_BITS);
        assert!(FLOW_DIRECTIONS as i32 <= FLOW_FIELD_BITS);
        assert_eq!(FLOW_STILL, 0);
    }

    /// Every direction round-trips through its code to within half a step,
    /// still water is the zero code, and the packed word keeps the index
    /// and the other fields intact.
    #[test]
    fn flow_codes_round_trip_and_pack_beside_the_index() {
        assert_eq!(flow_code(None), FLOW_STILL);
        assert_eq!(flow_direction(FLOW_STILL), None);
        assert_eq!(flow_direction(FLOW_DIRECTIONS + 1), None);

        let half_step = std::f32::consts::TAU / FLOW_DIRECTIONS as f32 / 2.0;
        for degrees in (0..360).step_by(7) {
            let angle = (degrees as f32).to_radians();
            let direction = [angle.cos(), angle.sin()];
            let code = flow_code(Some(direction));
            assert!((1..=FLOW_DIRECTIONS).contains(&code), "{degrees}°");
            let [x, z] = flow_direction(code).expect("a direction");
            let error = (z.atan2(x) - angle).sin().abs();
            assert!(
                error <= half_step.sin() + 1e-4,
                "{degrees}° drifted {error}"
            );
        }
        // Exactly +x is code 1; a hair below the seam wraps to it too.
        assert_eq!(flow_code(Some([1.0, 0.0])), 1);
        assert_eq!(flow_code(Some([1.0, -1e-4])), 1);

        let light = with_surface_flow(0x1234 | FLUID_BIT | WAVE_BIT, 9, 7);
        assert_eq!((light >> STACK_INDEX_SHIFT) & STACK_FIELD_BITS, 9);
        assert_eq!((light >> FLOW_SHIFT) & FLOW_FIELD_BITS, 7);
        assert_eq!(light & LIGHT_MASK, 0x1234);
        assert_ne!(light & FLUID_BIT, 0);
        assert_ne!(light & WAVE_BIT, 0);
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
