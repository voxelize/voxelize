use std::cell::RefCell;

use js_sys::{Array, Object, Reflect, Uint32Array};
use serde::Serialize;
use wasm_bindgen::{prelude::*, JsCast};
use voxelize_lighter::{
    flood_light_nodes, remove_lights, BlockRotation, LightBounds, LightColor, LightConfig,
    LightNode,
    LightRegistry, LightUtils, LightVoxelAccess,
};

thread_local! {
    static CACHED_REGISTRY: RefCell<Option<LightRegistry>> = const { RefCell::new(None) };
    static JS_KEYS: JsInteropKeys = JsInteropKeys::new();
    static EMPTY_BATCH_RESULT: JsValue = {
        let output = Object::new();
        let modified_chunks = Array::new_with_length(0);
        let modified_chunks_obj: Object = modified_chunks.clone().unchecked_into();
        Object::freeze(&modified_chunks_obj);
        Reflect::set(
            &output,
            &JsValue::from_str("modifiedChunks"),
            &modified_chunks,
        )
        .expect("Unable to set modified chunks");
        Object::freeze(&output);
        output.into()
    };
}

struct JsInteropKeys {
    voxels: JsValue,
    lights: JsValue,
    length: JsValue,
    modified_chunks: JsValue,
    coords: JsValue,
}

impl JsInteropKeys {
    fn new() -> Self {
        Self {
            voxels: JsValue::from_str("voxels"),
            lights: JsValue::from_str("lights"),
            length: JsValue::from_str("length"),
            modified_chunks: JsValue::from_str("modifiedChunks"),
            coords: JsValue::from_str("coords"),
        }
    }
}

#[derive(Clone)]
struct ChunkData {
    voxels: Vec<u32>,
    lights: Vec<u32>,
}

#[derive(Clone)]
struct BatchSpace {
    chunks: Vec<Option<ChunkData>>,
    chunk_grid_width: usize,
    chunk_grid_depth: usize,
    chunk_grid_offset: [i32; 2],
    chunk_size: i32,
    chunk_size_usize: usize,
    chunk_column_stride: usize,
    chunk_shift: Option<u32>,
    chunk_mask: Option<i32>,
    max_height: u32,
    modified_chunks: Vec<bool>,
    modified_indices: Vec<usize>,
}

#[inline]
fn unpack_voxel_rotation(raw: u32) -> (u32, u32) {
    ((raw >> 16) & 0xF, (raw >> 20) & 0xF)
}

impl BatchSpace {
    fn new(
        chunks: Vec<Option<ChunkData>>,
        chunk_grid_width: usize,
        chunk_grid_depth: usize,
        chunk_grid_offset: [i32; 2],
        chunk_size: i32,
        max_height: u32,
    ) -> Self {
        let modified_chunks = vec![false; chunks.len()];
        let chunk_size_usize = chunk_size.max(0) as usize;
        let chunk_height = max_height as usize;
        let chunk_column_stride = chunk_size_usize.saturating_mul(chunk_height);
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
            chunk_size_usize,
            chunk_column_stride,
            chunk_shift,
            chunk_mask,
            max_height,
            modified_chunks,
            modified_indices: Vec::new(),
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
        Self::voxel_index_from_components(
            chunk,
            vx,
            vy,
            vz,
            self.chunk_size,
            self.chunk_mask,
            self.chunk_size_usize,
            self.max_height as usize,
            self.chunk_column_stride,
        )
    }

    fn voxel_index_from_components(
        chunk: &ChunkData,
        vx: i32,
        vy: i32,
        vz: i32,
        chunk_size: i32,
        chunk_mask: Option<i32>,
        chunk_size_usize: usize,
        chunk_height: usize,
        chunk_column_stride: usize,
    ) -> Option<usize> {
        let (lx, lz) = if let Some(mask) = chunk_mask {
            ((vx & mask) as usize, (vz & mask) as usize)
        } else {
            (
                vx.rem_euclid(chunk_size) as usize,
                vz.rem_euclid(chunk_size) as usize,
            )
        };
        let ly = vy as usize;
        if ly >= chunk_height {
            return None;
        }

        let index = lx * chunk_column_stride + ly * chunk_size_usize + lz;
        debug_assert!(index < chunk.voxels.len() && index < chunk.lights.len());
        Some(index)
    }

    fn take_modified_chunks(self) -> Vec<ModifiedChunkData> {
        if self.modified_indices.is_empty() {
            return Vec::new();
        }

        let chunk_grid_depth = self.chunk_grid_depth;
        let [offset_x, offset_z] = self.chunk_grid_offset;
        let mut chunks = self.chunks;
        let mut modified = Vec::with_capacity(self.modified_indices.len());
        for index in self.modified_indices {
            if let Some(chunk_slot) = chunks.get_mut(index) {
                if let Some(chunk) = chunk_slot.take() {
                    let local_x = index / chunk_grid_depth;
                    let local_z = index % chunk_grid_depth;
                    modified.push(ModifiedChunkData {
                        coords: [offset_x + local_x as i32, offset_z + local_z as i32],
                        lights: chunk.lights,
                    });
                }
            }
        }

        modified
    }

}

impl LightVoxelAccess for BatchSpace {
    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        let (cx, cz) = self.map_voxel_to_chunk(vx, vz);
        let Some(chunk_index) = self.chunk_index_from_coords(cx, cz) else {
            return 0;
        };
        let Some(Some(chunk)) = self.chunks.get(chunk_index) else {
            return 0;
        };
        let Some(voxel_index) = self.voxel_index_in_chunk(chunk, vx, vy, vz) else {
            return 0;
        };
        chunk.voxels[voxel_index]
    }

    fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation {
        let raw = self.get_raw_voxel(vx, vy, vz);
        let (rotation, y_rotation) = unpack_voxel_rotation(raw);
        BlockRotation::encode(rotation, y_rotation)
    }

    fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        (self.get_raw_voxel(vx, vy, vz) >> 24) & 0xF
    }

    fn get_raw_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        let (cx, cz) = self.map_voxel_to_chunk(vx, vz);
        let Some(chunk_index) = self.chunk_index_from_coords(cx, cz) else {
            return 0;
        };
        let Some(Some(chunk)) = self.chunks.get(chunk_index) else {
            return 0;
        };
        let Some(voxel_index) = self.voxel_index_in_chunk(chunk, vx, vy, vz) else {
            return 0;
        };
        chunk.lights[voxel_index]
    }

    fn set_raw_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        let (cx, cz) = self.map_voxel_to_chunk(vx, vz);
        let Some(chunk_index) = self.chunk_index_from_coords(cx, cz) else {
            return false;
        };
        let chunk_size = self.chunk_size;
        let chunk_mask = self.chunk_mask;
        let chunk_size_usize = self.chunk_size_usize;
        let chunk_height = self.max_height as usize;
        let chunk_column_stride = self.chunk_column_stride;

        if let Some(Some(chunk)) = self.chunks.get_mut(chunk_index) {
            let Some(voxel_index) = Self::voxel_index_from_components(
                chunk,
                vx,
                vy,
                vz,
                chunk_size,
                chunk_mask,
                chunk_size_usize,
                chunk_height,
                chunk_column_stride,
            )
            else {
                return false;
            };

            if chunk.lights[voxel_index] == level {
                return true;
            }
            chunk.lights[voxel_index] = level;
            if !self.modified_chunks[chunk_index] {
                self.modified_chunks[chunk_index] = true;
                self.modified_indices.push(chunk_index);
            }
            return true;
        }

        false
    }

    fn get_max_height(&self, _vx: i32, _vz: i32) -> u32 {
        self.max_height
    }

    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        let (cx, cz) = self.map_voxel_to_chunk(vx, vz);
        let Some(chunk_index) = self.chunk_index_from_coords(cx, cz) else {
            return false;
        };
        let Some(Some(chunk)) = self.chunks.get(chunk_index) else {
            return false;
        };
        self.voxel_index_in_chunk(chunk, vx, vy, vz).is_some()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModifiedChunkData {
    coords: [i32; 2],
    lights: Vec<u32>,
}

fn parse_chunks(chunks_data: &Array, expected_chunk_len: usize) -> Vec<Option<ChunkData>> {
    JS_KEYS.with(|keys| {
        let chunk_count = chunks_data.length() as usize;
        let mut chunks = Vec::with_capacity(chunk_count);

        for index in 0..chunk_count {
            let chunk_value = chunks_data.get(index as u32);
            if chunk_value.is_null() || chunk_value.is_undefined() {
                chunks.push(None);
                continue;
            }

            let chunk_obj = js_sys::Object::from(chunk_value);
            let voxels_value = Reflect::get(&chunk_obj, &keys.voxels)
                .expect("chunksData item is missing voxels");
            let lights_value = Reflect::get(&chunk_obj, &keys.lights)
                .expect("chunksData item is missing lights");
            let voxels_array: Uint32Array = voxels_value
                .dyn_into()
                .expect("chunksData voxels must be Uint32Array");
            let lights_array: Uint32Array = lights_value
                .dyn_into()
                .expect("chunksData lights must be Uint32Array");
            let mut voxels = vec![0; voxels_array.length() as usize];
            let mut lights = vec![0; lights_array.length() as usize];
            voxels_array.copy_to(&mut voxels);
            lights_array.copy_to(&mut lights);
            if voxels.len() != expected_chunk_len || lights.len() != expected_chunk_len {
                chunks.push(None);
                continue;
            }

            chunks.push(Some(ChunkData {
                voxels,
                lights,
            }));
        }

        chunks
    })
}

fn empty_batch_result() -> JsValue {
    EMPTY_BATCH_RESULT.with(|result| result.clone())
}

#[inline]
fn light_color_from_index(color: usize) -> Option<LightColor> {
    match color {
        0 => Some(LightColor::Sunlight),
        1 => Some(LightColor::Red),
        2 => Some(LightColor::Green),
        3 => Some(LightColor::Blue),
        _ => None,
    }
}

#[inline]
fn has_invalid_batch_config(
    chunk_size: i32,
    max_height: i32,
    chunk_grid_width: usize,
    chunk_grid_depth: usize,
) -> bool {
    chunk_size <= 0 || max_height <= 0 || chunk_grid_width == 0 || chunk_grid_depth == 0
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
    if has_invalid_batch_config(chunk_size, max_height, chunk_grid_width, chunk_grid_depth) {
        return empty_batch_result();
    }

    let Some(light_color) = light_color_from_index(color) else {
        return empty_batch_result();
    };
    let (removal_nodes, flood_nodes): (Vec<[i32; 3]>, Vec<LightNode>) = JS_KEYS.with(|keys| {
        let removal_nodes = if Reflect::get(&removals, &keys.length)
            .ok()
            .and_then(|value| value.as_f64())
            .unwrap_or(0.0)
            == 0.0
        {
            Vec::new()
        } else {
            serde_wasm_bindgen::from_value(removals).expect("Unable to deserialize removal nodes")
        };
        let flood_nodes = if Reflect::get(&floods, &keys.length)
            .ok()
            .and_then(|value| value.as_f64())
            .unwrap_or(0.0)
            == 0.0
        {
            Vec::new()
        } else {
            serde_wasm_bindgen::from_value(floods).expect("Unable to deserialize flood nodes")
        };
        (removal_nodes, flood_nodes)
    });
    if removal_nodes.is_empty() && flood_nodes.is_empty() {
        return empty_batch_result();
    }

    let chunk_size_usize = chunk_size as usize;
    let chunk_height = max_height as usize;
    let expected_chunk_len = chunk_size_usize
        .saturating_mul(chunk_height)
        .saturating_mul(chunk_size_usize);
    let chunks = parse_chunks(chunks_data, expected_chunk_len);
    let mut space = BatchSpace::new(
        chunks,
        chunk_grid_width,
        chunk_grid_depth,
        [grid_offset_x, grid_offset_z],
        chunk_size,
        max_height.max(0) as u32,
    );

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

            flood_light_nodes(
                &mut space,
                flood_nodes,
                &light_color,
                &config,
                bounds.as_ref(),
                registry,
            );
        }
    });

    let modified_chunks = space.take_modified_chunks();
    if modified_chunks.is_empty() {
        return empty_batch_result();
    }
    JS_KEYS.with(|keys| {
        let output = Object::new();
        let modified_chunks_js = Array::new_with_length(modified_chunks.len() as u32);

        for (index, chunk) in modified_chunks.iter().enumerate() {
            let chunk_obj = Object::new();
            let coords = Array::new_with_length(2);
            coords.set(0, JsValue::from_f64(chunk.coords[0] as f64));
            coords.set(1, JsValue::from_f64(chunk.coords[1] as f64));
            Reflect::set(&chunk_obj, &keys.coords, &coords).expect("Unable to set chunk coords");

            let lights = Uint32Array::from(chunk.lights.as_slice());
            Reflect::set(&chunk_obj, &keys.lights, &lights).expect("Unable to set chunk lights");

            modified_chunks_js.set(index as u32, chunk_obj.into());
        }

        Reflect::set(&output, &keys.modified_chunks, &modified_chunks_js)
            .expect("Unable to set modified chunks");
        output.into()
    })
}

#[cfg(test)]
mod tests {
    use super::{BatchSpace, ChunkData};
    use voxelize_lighter::LightColor;
    use voxelize_lighter::LightVoxelAccess;

    #[test]
    fn map_voxel_to_chunk_fast_path_matches_div_euclid() {
        let pow2_space = BatchSpace::new(Vec::new(), 1, 1, [0, 0], 16, 0);
        let non_pow2_space = BatchSpace::new(Vec::new(), 1, 1, [0, 0], 18, 0);
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
        };
        let space = BatchSpace::new(Vec::new(), 1, 1, [0, 0], 16, 4);

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
            let expected = lx * 4 * 16 + ly * 16 + lz;
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
        };
        let mut space = BatchSpace::new(vec![Some(chunk)], 1, 1, [0, 0], 16, 4);

        assert_eq!(space.modified_indices.len(), 0);
        assert!(space.set_raw_light(0, 0, 0, 0));
        assert_eq!(space.modified_indices.len(), 0);
        assert!(space.set_raw_light(0, 0, 0, 1));
        assert_eq!(space.modified_indices.len(), 1);
        assert!(space.set_raw_light(0, 0, 1, 2));
        assert_eq!(space.modified_indices.len(), 1);
        assert_eq!(space.take_modified_chunks().len(), 1);
    }

    #[test]
    fn light_color_from_index_handles_invalid_values() {
        assert_eq!(super::light_color_from_index(0), Some(LightColor::Sunlight));
        assert_eq!(super::light_color_from_index(1), Some(LightColor::Red));
        assert_eq!(super::light_color_from_index(2), Some(LightColor::Green));
        assert_eq!(super::light_color_from_index(3), Some(LightColor::Blue));
        assert_eq!(super::light_color_from_index(4), None);
        assert_eq!(super::light_color_from_index(99), None);
    }

    #[test]
    fn invalid_batch_config_detects_bad_dimensions() {
        assert!(super::has_invalid_batch_config(0, 64, 1, 1));
        assert!(super::has_invalid_batch_config(16, 0, 1, 1));
        assert!(super::has_invalid_batch_config(16, 64, 0, 1));
        assert!(super::has_invalid_batch_config(16, 64, 1, 0));
        assert!(!super::has_invalid_batch_config(16, 64, 1, 1));
    }
}
