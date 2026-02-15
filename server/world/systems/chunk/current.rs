use specs::{ReadExpect, ReadStorage, System, WriteStorage};

use crate::{CurrentChunkComp, PositionComp, Vec3, WorldConfig, WorldTimingContext};

pub struct CurrentChunkSystem;

#[inline]
fn floor_f32_to_i32(value: f32) -> Option<i32> {
    if !value.is_finite() {
        return None;
    }
    let floored = f64::from(value).floor();
    if floored < f64::from(i32::MIN) || floored > f64::from(i32::MAX) {
        return None;
    }
    Some(floored as i32)
}

#[inline]
fn normalized_chunk_size(chunk_size: usize) -> i32 {
    if chunk_size == 0 {
        1
    } else if chunk_size > i32::MAX as usize {
        i32::MAX
    } else {
        chunk_size as i32
    }
}

#[inline]
fn update_current_chunk(curr_chunk: &mut CurrentChunkComp, coords: crate::Vec2<i32>) {
    if coords != curr_chunk.coords {
        curr_chunk.coords = coords;
        curr_chunk.changed = true;
    }
}

impl<'a> System<'a> for CurrentChunkSystem {
    type SystemData = (
        ReadExpect<'a, WorldConfig>,
        ReadStorage<'a, PositionComp>,
        WriteStorage<'a, CurrentChunkComp>,
        ReadExpect<'a, WorldTimingContext>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (config, positions, mut curr_chunks, timing) = data;
        let _t = timing.timer("current-chunk");

        let chunk_size = normalized_chunk_size(config.chunk_size);
        let chunk_shift = if (chunk_size as u32).is_power_of_two() {
            Some(chunk_size.trailing_zeros())
        } else {
            None
        };

        if chunk_size == 1 {
            (&positions, &mut curr_chunks)
                .par_join()
                .for_each(|(position, curr_chunk)| {
                    let Vec3(vx, _, vz) = position.0;
                    let (Some(voxel_x), Some(voxel_z)) =
                        (floor_f32_to_i32(vx), floor_f32_to_i32(vz))
                    else {
                        return;
                    };
                    update_current_chunk(curr_chunk, crate::Vec2(voxel_x, voxel_z));
                });
        } else if let Some(shift) = chunk_shift {
            (&positions, &mut curr_chunks)
                .par_join()
                .for_each(|(position, curr_chunk)| {
                    let Vec3(vx, _, vz) = position.0;
                    let (Some(voxel_x), Some(voxel_z)) =
                        (floor_f32_to_i32(vx), floor_f32_to_i32(vz))
                    else {
                        return;
                    };
                    update_current_chunk(curr_chunk, crate::Vec2(voxel_x >> shift, voxel_z >> shift));
                });
        } else {
            (&positions, &mut curr_chunks)
                .par_join()
                .for_each(|(position, curr_chunk)| {
                    let Vec3(vx, _, vz) = position.0;
                    let (Some(voxel_x), Some(voxel_z)) =
                        (floor_f32_to_i32(vx), floor_f32_to_i32(vz))
                    else {
                        return;
                    };
                    update_current_chunk(
                        curr_chunk,
                        crate::Vec2(voxel_x.div_euclid(chunk_size), voxel_z.div_euclid(chunk_size)),
                    );
                });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{floor_f32_to_i32, normalized_chunk_size};

    #[test]
    fn floor_f32_to_i32_handles_negative_fractional_values() {
        assert_eq!(floor_f32_to_i32(-0.2), Some(-1));
        assert_eq!(floor_f32_to_i32(-16.9), Some(-17));
    }

    #[test]
    fn floor_f32_to_i32_rejects_non_finite_inputs() {
        assert_eq!(floor_f32_to_i32(f32::NAN), None);
        assert_eq!(floor_f32_to_i32(f32::INFINITY), None);
        assert_eq!(floor_f32_to_i32(f32::NEG_INFINITY), None);
    }

    #[test]
    fn normalized_chunk_size_clamps_zero_and_oversized_values() {
        assert_eq!(normalized_chunk_size(0), 1);
        assert_eq!(normalized_chunk_size(1), 1);
        assert_eq!(normalized_chunk_size(16), 16);
        assert_eq!(normalized_chunk_size(usize::MAX), i32::MAX);
    }
}
