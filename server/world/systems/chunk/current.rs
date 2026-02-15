use specs::{ReadExpect, ReadStorage, System, WriteStorage};

use crate::{ChunkUtils, CurrentChunkComp, PositionComp, Vec3, WorldConfig, WorldTimingContext};

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

        let chunk_size = config.chunk_size;

        (&positions, &mut curr_chunks)
            .par_join()
            .for_each(|(position, curr_chunk)| {
                let Vec3(vx, _, vz) = position.0;
                let (Some(voxel_x), Some(voxel_z)) = (floor_f32_to_i32(vx), floor_f32_to_i32(vz))
                else {
                    return;
                };
                let coords = ChunkUtils::map_voxel_to_chunk(voxel_x, 0, voxel_z, chunk_size);

                if coords != curr_chunk.coords {
                    curr_chunk.coords = coords;
                    curr_chunk.changed = true;
                }
            });
    }
}

#[cfg(test)]
mod tests {
    use super::floor_f32_to_i32;

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
}
