use std::{cell::RefCell, collections::VecDeque};

use js_sys::{Array, Reflect, Uint32Array};
use serde::Serialize;
use wasm_bindgen::prelude::*;
use voxelize_lighter::{
    flood_light, remove_lights, BlockRotation, LightBounds, LightColor, LightConfig, LightNode,
    LightRegistry, LightUtils, LightVoxelAccess,
};

thread_local! {
    static CACHED_REGISTRY: RefCell<Option<LightRegistry>> = const { RefCell::new(None) };
}

#[derive(Clone)]
struct ChunkData {
    voxels: Vec<u32>,
    lights: Vec<u32>,
    shape: [usize; 3],
}

#[derive(Clone)]
struct BatchSpace {
    chunks: Vec<Option<ChunkData>>,
    chunk_grid_width: usize,
    chunk_grid_depth: usize,
    chunk_grid_offset: [i32; 2],
    chunk_size: i32,
    chunk_shift: Option<u32>,
    chunk_mask: Option<i32>,
    modified_chunks: Vec<bool>,
    modified_count: usize,
}

impl BatchSpace {
    fn new(
        chunks: Vec<Option<ChunkData>>,
        chunk_grid_width: usize,
        chunk_grid_depth: usize,
        chunk_grid_offset: [i32; 2],
        chunk_size: i32,
    ) -> Self {
        let modified_chunks = vec![false; chunks.len()];
        let chunk_shift = if chunk_size > 0 && (chunk_size as u32).is_power_of_two() {
            Some(chunk_size.trailing_zeros())
        } else {
            None
        };
        let chunk_mask = chunk_shift.map(|_| chunk_size - 1);
        Self {
            chunks,
            chunk_grid_width,
            chunk_grid_depth,
            chunk_grid_offset,
            chunk_size,
            chunk_shift,
            chunk_mask,
            modified_chunks,
            modified_count: 0,
        }
    }

    #[inline]
    fn chunk_index_from_coords(&self, cx: i32, cz: i32) -> Option<usize> {
        let local_x = cx - self.chunk_grid_offset[0];
        let local_z = cz - self.chunk_grid_offset[1];

        if local_x < 0
            || local_z < 0
            || local_x >= self.chunk_grid_width as i32
            || local_z >= self.chunk_grid_depth as i32
        {
            return None;
        }

        Some(local_x as usize * self.chunk_grid_depth + local_z as usize)
    }

    #[inline]
    fn map_voxel_to_chunk(&self, vx: i32, vz: i32) -> (i32, i32) {
        if let Some(shift) = self.chunk_shift {
            (vx >> shift, vz >> shift)
        } else {
            (vx.div_euclid(self.chunk_size), vz.div_euclid(self.chunk_size))
        }
    }

    #[inline]
    fn voxel_index_in_chunk(&self, chunk: &ChunkData, vx: i32, vy: i32, vz: i32) -> Option<usize> {
        let (lx, lz) = if let Some(mask) = self.chunk_mask {
            ((vx & mask) as usize, (vz & mask) as usize)
        } else {
            (
                vx.rem_euclid(self.chunk_size) as usize,
                vz.rem_euclid(self.chunk_size) as usize,
            )
        };
        let ly = vy as usize;

        if ly >= chunk.shape[1] {
            return None;
        }

        let index = lx * chunk.shape[1] * chunk.shape[2] + ly * chunk.shape[2] + lz;
        if index < chunk.voxels.len() && index < chunk.lights.len() {
            Some(index)
        } else {
            None
        }
    }

    fn get_chunk_and_voxel_index(&self, vx: i32, vy: i32, vz: i32) -> Option<(usize, usize)> {
        let (cx, cz) = self.map_voxel_to_chunk(vx, vz);
        let chunk_index = self.chunk_index_from_coords(cx, cz)?;
        let chunk = self.chunks.get(chunk_index)?.as_ref()?;
        let voxel_index = self.voxel_index_in_chunk(chunk, vx, vy, vz)?;
        Some((chunk_index, voxel_index))
    }

    fn get_chunk_and_voxel_index_mut(
        &mut self,
        vx: i32,
        vy: i32,
        vz: i32,
    ) -> Option<(usize, usize)> {
        let (cx, cz) = self.map_voxel_to_chunk(vx, vz);
        let chunk_index = self.chunk_index_from_coords(cx, cz)?;
        let chunk = self.chunks.get(chunk_index)?.as_ref()?;
        let voxel_index = self.voxel_index_in_chunk(chunk, vx, vy, vz)?;
        Some((chunk_index, voxel_index))
    }

    fn take_modified_chunks(&self) -> Vec<ModifiedChunkData> {
        if self.modified_count == 0 {
            return Vec::new();
        }

        let mut modified = Vec::with_capacity(self.modified_count);

        for (index, is_modified) in self.modified_chunks.iter().enumerate() {
            if !is_modified {
                continue;
            }

            if let Some(Some(chunk)) = self.chunks.get(index) {
                let local_x = index / self.chunk_grid_depth;
                let local_z = index % self.chunk_grid_depth;
                modified.push(ModifiedChunkData {
                    coords: [
                        self.chunk_grid_offset[0] + local_x as i32,
                        self.chunk_grid_offset[1] + local_z as i32,
                    ],
                    lights: chunk.lights.clone(),
                });
            }
        }

        modified
    }
}

impl LightVoxelAccess for BatchSpace {
    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        self.get_chunk_and_voxel_index(vx, vy, vz)
            .and_then(|(chunk_index, voxel_index)| {
                self.chunks
                    .get(chunk_index)
                    .and_then(|chunk| chunk.as_ref())
                    .map(|chunk| chunk.voxels[voxel_index])
            })
            .unwrap_or(0)
    }

    fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation {
        let raw = self.get_raw_voxel(vx, vy, vz);
        let rotation = (raw >> 16) & 0xF;
        let y_rotation = (raw >> 20) & 0xF;
        BlockRotation::encode(rotation, y_rotation)
    }

    fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        (self.get_raw_voxel(vx, vy, vz) >> 24) & 0xF
    }

    fn get_raw_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        self.get_chunk_and_voxel_index(vx, vy, vz)
            .and_then(|(chunk_index, voxel_index)| {
                self.chunks
                    .get(chunk_index)
                    .and_then(|chunk| chunk.as_ref())
                    .map(|chunk| chunk.lights[voxel_index])
            })
            .unwrap_or(0)
    }

    fn set_raw_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        if let Some((chunk_index, voxel_index)) = self.get_chunk_and_voxel_index_mut(vx, vy, vz) {
            if let Some(Some(chunk)) = self.chunks.get_mut(chunk_index) {
                if chunk.lights[voxel_index] == level {
                    return true;
                }
                chunk.lights[voxel_index] = level;
                if !self.modified_chunks[chunk_index] {
                    self.modified_chunks[chunk_index] = true;
                    self.modified_count += 1;
                }
                return true;
            }
        }

        false
    }

    fn get_max_height(&self, _vx: i32, _vz: i32) -> u32 {
        self.chunks
            .iter()
            .flatten()
            .next()
            .map_or(0, |chunk| chunk.shape[1] as u32)
    }

    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        self.get_chunk_and_voxel_index(vx, vy, vz).is_some()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModifiedChunkData {
    coords: [i32; 2],
    lights: Vec<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchOutput {
    modified_chunks: Vec<ModifiedChunkData>,
}

fn parse_chunks(chunks_data: &Array) -> Vec<Option<ChunkData>> {
    let chunk_count = chunks_data.length() as usize;
    let mut chunks = Vec::with_capacity(chunk_count);
    let voxels_key = JsValue::from_str("voxels");
    let lights_key = JsValue::from_str("lights");
    let shape_key = JsValue::from_str("shape");

    for index in 0..chunk_count {
        let chunk_value = chunks_data.get(index as u32);
        if chunk_value.is_null() || chunk_value.is_undefined() {
            chunks.push(None);
            continue;
        }

        let chunk_obj = js_sys::Object::from(chunk_value);
        let voxels_value = Reflect::get(&chunk_obj, &voxels_key)
            .expect("chunksData item is missing voxels");
        let lights_value = Reflect::get(&chunk_obj, &lights_key)
            .expect("chunksData item is missing lights");
        let shape_value = Reflect::get(&chunk_obj, &shape_key)
            .expect("chunksData item is missing shape");
        let voxels = Uint32Array::from(voxels_value).to_vec();
        let lights = Uint32Array::from(lights_value).to_vec();
        let shape_array = Array::from(&shape_value);

        let shape = [
            shape_array.get(0).as_f64().expect("shape[0] must be number") as usize,
            shape_array.get(1).as_f64().expect("shape[1] must be number") as usize,
            shape_array.get(2).as_f64().expect("shape[2] must be number") as usize,
        ];

        chunks.push(Some(ChunkData {
            voxels,
            lights,
            shape,
        }));
    }

    chunks
}

#[wasm_bindgen]
pub fn init() {}

#[wasm_bindgen]
pub fn set_registry(registry: JsValue) {
    let mut parsed: LightRegistry =
        serde_wasm_bindgen::from_value(registry).expect("Unable to deserialize light registry");
    parsed.build_cache();
    CACHED_REGISTRY.with(|cached| {
        *cached.borrow_mut() = Some(parsed);
    });
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn process_light_batch_fast(
    chunks_data: &Array,
    chunk_grid_width: usize,
    chunk_grid_depth: usize,
    grid_offset_x: i32,
    grid_offset_z: i32,
    color: usize,
    removals: JsValue,
    floods: JsValue,
    bounds_min: &[i32],
    bounds_shape: &[u32],
    chunk_size: i32,
    max_height: i32,
    max_light_level: u32,
) -> JsValue {
    let chunks = parse_chunks(chunks_data);
    let mut space = BatchSpace::new(
        chunks,
        chunk_grid_width,
        chunk_grid_depth,
        [grid_offset_x, grid_offset_z],
        chunk_size,
    );

    let light_color = LightColor::from(color);
    let removal_nodes: Vec<[i32; 3]> =
        serde_wasm_bindgen::from_value(removals).expect("Unable to deserialize removal nodes");
    let flood_nodes: Vec<LightNode> =
        serde_wasm_bindgen::from_value(floods).expect("Unable to deserialize flood nodes");

    let bounds = if bounds_min.len() >= 3 && bounds_shape.len() >= 3 {
        Some(LightBounds {
            min: [bounds_min[0], bounds_min[1], bounds_min[2]],
            shape: [
                bounds_shape[0] as usize,
                bounds_shape[1] as usize,
                bounds_shape[2] as usize,
            ],
        })
    } else {
        None
    };

    let config = LightConfig {
        chunk_size,
        max_height,
        max_light_level,
        min_chunk: [grid_offset_x, grid_offset_z],
        max_chunk: [
            grid_offset_x + chunk_grid_width as i32 - 1,
            grid_offset_z + chunk_grid_depth as i32 - 1,
        ],
    };

    CACHED_REGISTRY.with(|cached| {
        let registry_ref = cached.borrow();
        let registry = registry_ref
            .as_ref()
            .expect("Registry not set. Call set_registry first.");

        if !removal_nodes.is_empty() {
            remove_lights(
                &mut space,
                removal_nodes.iter().copied(),
                &light_color,
                &config,
                registry,
            );
        }

        if !flood_nodes.is_empty() {
            match light_color {
                LightColor::Sunlight => {
                    for node in &flood_nodes {
                        let [vx, vy, vz] = node.voxel;
                        let raw = space.get_raw_light(vx, vy, vz);
                        space.set_raw_light(vx, vy, vz, LightUtils::insert_sunlight(raw, node.level));
                    }
                }
                LightColor::Red => {
                    for node in &flood_nodes {
                        let [vx, vy, vz] = node.voxel;
                        let raw = space.get_raw_light(vx, vy, vz);
                        space.set_raw_light(vx, vy, vz, LightUtils::insert_red_light(raw, node.level));
                    }
                }
                LightColor::Green => {
                    for node in &flood_nodes {
                        let [vx, vy, vz] = node.voxel;
                        let raw = space.get_raw_light(vx, vy, vz);
                        space.set_raw_light(vx, vy, vz, LightUtils::insert_green_light(raw, node.level));
                    }
                }
                LightColor::Blue => {
                    for node in &flood_nodes {
                        let [vx, vy, vz] = node.voxel;
                        let raw = space.get_raw_light(vx, vy, vz);
                        space.set_raw_light(vx, vy, vz, LightUtils::insert_blue_light(raw, node.level));
                    }
                }
            }

            flood_light(
                &mut space,
                VecDeque::from(flood_nodes),
                &light_color,
                &config,
                bounds.as_ref(),
                registry,
            );
        }
    });

    let output = BatchOutput {
        modified_chunks: space.take_modified_chunks(),
    };

    serde_wasm_bindgen::to_value(&output).expect("Unable to serialize lighting output")
}

#[cfg(test)]
mod tests {
    use super::{BatchSpace, ChunkData};
    use voxelize_lighter::LightVoxelAccess;

    #[test]
    fn map_voxel_to_chunk_fast_path_matches_div_euclid() {
        let pow2_space = BatchSpace::new(Vec::new(), 1, 1, [0, 0], 16);
        let non_pow2_space = BatchSpace::new(Vec::new(), 1, 1, [0, 0], 18);
        let samples = [
            (-33, -17),
            (-16, -1),
            (-15, -15),
            (-1, -33),
            (0, 0),
            (1, 15),
            (16, 16),
            (33, 47),
        ];

        for (vx, vz) in samples {
            assert_eq!(
                pow2_space.map_voxel_to_chunk(vx, vz),
                (vx.div_euclid(16), vz.div_euclid(16))
            );
            assert_eq!(
                non_pow2_space.map_voxel_to_chunk(vx, vz),
                (vx.div_euclid(18), vz.div_euclid(18))
            );
        }
    }

    #[test]
    fn voxel_index_fast_path_matches_rem_euclid() {
        let chunk = ChunkData {
            voxels: vec![0; 16 * 4 * 16],
            lights: vec![0; 16 * 4 * 16],
            shape: [16, 4, 16],
        };
        let space = BatchSpace::new(Vec::new(), 1, 1, [0, 0], 16);

        for (vx, vz) in [
            (-17_i32, -1_i32),
            (-16_i32, -16_i32),
            (-1_i32, -17_i32),
            (0_i32, 0_i32),
            (15_i32, 15_i32),
            (33_i32, 47_i32),
        ] {
            let ly = 2usize;
            let lx = vx.rem_euclid(16) as usize;
            let lz = vz.rem_euclid(16) as usize;
            let expected = lx * chunk.shape[1] * chunk.shape[2] + ly * chunk.shape[2] + lz;
            assert_eq!(
                space.voxel_index_in_chunk(&chunk, vx, ly as i32, vz),
                Some(expected)
            );
        }
    }

    #[test]
    fn set_raw_light_counts_unique_modified_chunks() {
        let chunk = ChunkData {
            voxels: vec![0; 16 * 4 * 16],
            lights: vec![0; 16 * 4 * 16],
            shape: [16, 4, 16],
        };
        let mut space = BatchSpace::new(vec![Some(chunk)], 1, 1, [0, 0], 16);

        assert_eq!(space.modified_count, 0);
        assert!(space.set_raw_light(0, 0, 0, 0));
        assert_eq!(space.modified_count, 0);
        assert!(space.set_raw_light(0, 0, 0, 1));
        assert_eq!(space.modified_count, 1);
        assert!(space.set_raw_light(0, 0, 1, 2));
        assert_eq!(space.modified_count, 1);
        assert_eq!(space.take_modified_chunks().len(), 1);
    }
}
