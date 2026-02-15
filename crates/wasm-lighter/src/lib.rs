use std::{cell::RefCell, sync::Arc};

use js_sys::{Array, Object, Reflect, Uint32Array};
use serde::{de::DeserializeOwned, Serialize};
use wasm_bindgen::{prelude::*, JsCast};
use voxelize_lighter::{
    flood_light_nodes, remove_lights, BlockRotation, LightBounds, LightColor, LightConfig,
    LightNode,
    LightRegistry, LightUtils, LightVoxelAccess,
};

thread_local! {
    static CACHED_REGISTRY: RefCell<Option<Arc<LightRegistry>>> = const { RefCell::new(None) };
    static JS_KEYS: JsInteropKeys = JsInteropKeys::new();
    static EMPTY_BATCH_RESULT: JsValue = {
        let output = Object::new();
        let modified_chunks = Array::new_with_length(0);
        Reflect::set(
            &output,
            &JsValue::from_str("modifiedChunks"),
            &modified_chunks,
        )
        .expect("Unable to set modified chunks");
        let modified_chunks_obj: Object = modified_chunks.unchecked_into();
        Object::freeze(&modified_chunks_obj);
        Object::freeze(&output);
        output.into()
    };
}

struct JsInteropKeys {
    voxels: JsValue,
    lights: JsValue,
    modified_chunks: JsValue,
    coords: JsValue,
}

impl JsInteropKeys {
    fn new() -> Self {
        Self {
            voxels: JsValue::from_str("voxels"),
            lights: JsValue::from_str("lights"),
            modified_chunks: JsValue::from_str("modifiedChunks"),
            coords: JsValue::from_str("coords"),
        }
    }
}

const MAX_JS_TYPED_ARRAY_LENGTH: usize = i32::MAX as usize;
const MAX_LIGHT_BATCH_CHUNK_COUNT: usize = 0x0100_0000;

#[derive(Clone)]
struct ChunkData {
    voxels: Vec<u32>,
    lights: Vec<u32>,
}

#[derive(Clone)]
struct BatchSpace {
    chunks: Vec<Option<ChunkData>>,
    chunk_grid_depth: usize,
    chunk_grid_width_i32: i32,
    chunk_grid_depth_i32: i32,
    chunk_grid_offset: [i32; 2],
    chunk_size: i32,
    chunk_size_usize: usize,
    chunk_column_stride: usize,
    chunk_shift: Option<u32>,
    chunk_mask: Option<i32>,
    max_height_i32: i32,
    max_height_usize: usize,
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
        let chunk_grid_width_i32 = chunk_grid_width as i32;
        let chunk_grid_depth_i32 = chunk_grid_depth as i32;
        let chunk_size_usize = chunk_size as usize;
        let chunk_height = max_height as usize;
        let max_height_i32 = max_height as i32;
        let chunk_column_stride = chunk_size_usize * chunk_height;
        let chunk_shift = if chunk_size > 0 && (chunk_size as u32).is_power_of_two() {
            Some(chunk_size.trailing_zeros())
        } else {
            None
        };
        let chunk_mask = chunk_shift.map(|_| chunk_size - 1);
        Self {
            chunks,
            chunk_grid_depth,
            chunk_grid_width_i32,
            chunk_grid_depth_i32,
            chunk_grid_offset,
            chunk_size,
            chunk_size_usize,
            chunk_column_stride,
            chunk_shift,
            chunk_mask,
            max_height_i32,
            max_height_usize: chunk_height,
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
            || local_x >= self.chunk_grid_width_i32
            || local_z >= self.chunk_grid_depth_i32
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
    fn voxel_index_in_chunk(&self, vx: i32, vy: i32, vz: i32) -> Option<usize> {
        Self::voxel_index_from_components(
            vx,
            vy,
            vz,
            self.chunk_size,
            self.chunk_mask,
            self.chunk_size_usize,
            self.max_height_usize,
            self.chunk_column_stride,
        )
    }

    fn voxel_index_from_components(
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

        Some(lx * chunk_column_stride + ly * chunk_size_usize + lz)
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
            if let Some(chunk) = chunks[index].take() {
                let local_x = index / chunk_grid_depth;
                let local_z = index % chunk_grid_depth;
                modified.push(ModifiedChunkData {
                    coords: [offset_x + local_x as i32, offset_z + local_z as i32],
                    lights: chunk.lights,
                });
            }
        }

        modified
    }

}

impl LightVoxelAccess for BatchSpace {
    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if vy < 0 || vy >= self.max_height_i32 {
            return 0;
        }
        let (cx, cz) = self.map_voxel_to_chunk(vx, vz);
        let Some(chunk_index) = self.chunk_index_from_coords(cx, cz) else {
            return 0;
        };
        let Some(Some(chunk)) = self.chunks.get(chunk_index) else {
            return 0;
        };
        let Some(voxel_index) = self.voxel_index_in_chunk(vx, vy, vz) else {
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
        if vy < 0 || vy >= self.max_height_i32 {
            return 0;
        }
        let (cx, cz) = self.map_voxel_to_chunk(vx, vz);
        let Some(chunk_index) = self.chunk_index_from_coords(cx, cz) else {
            return 0;
        };
        let Some(Some(chunk)) = self.chunks.get(chunk_index) else {
            return 0;
        };
        let Some(voxel_index) = self.voxel_index_in_chunk(vx, vy, vz) else {
            return 0;
        };
        chunk.lights[voxel_index]
    }

    fn set_raw_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        if vy < 0 || vy >= self.max_height_i32 {
            return false;
        }
        let (cx, cz) = self.map_voxel_to_chunk(vx, vz);
        let Some(chunk_index) = self.chunk_index_from_coords(cx, cz) else {
            return false;
        };
        let chunk_size = self.chunk_size;
        let chunk_mask = self.chunk_mask;
        let chunk_size_usize = self.chunk_size_usize;
        let chunk_height = self.max_height_usize;
        let chunk_column_stride = self.chunk_column_stride;

        if let Some(Some(chunk)) = self.chunks.get_mut(chunk_index) {
            let Some(voxel_index) = Self::voxel_index_from_components(
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
        if vy < 0 || vy >= self.max_height_i32 {
            return false;
        }
        let (cx, cz) = self.map_voxel_to_chunk(vx, vz);
        let Some(chunk_index) = self.chunk_index_from_coords(cx, cz) else {
            return false;
        };
        let Some(Some(_)) = self.chunks.get(chunk_index) else {
            return false;
        };
        true
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModifiedChunkData {
    coords: [i32; 2],
    lights: Vec<u32>,
}

fn parse_chunks(
    chunks_data: &Array,
    expected_chunk_count: usize,
    expected_chunk_len: usize,
) -> (Vec<Option<ChunkData>>, bool) {
    JS_KEYS.with(|keys| {
        if expected_chunk_count == 0 {
            return (Vec::new(), false);
        }
        let expected_chunk_count_u32 = expected_chunk_count as u32;
        let expected_chunk_len_u32 = expected_chunk_len as u32;

        let mut chunks: Vec<Option<ChunkData>> = Vec::new();
        let mut has_any_chunk = false;

        for index_u32 in 0..expected_chunk_count_u32 {
            let parsed_chunk = 'parse: {
                let chunk_value = chunks_data.get(index_u32);
                if !chunk_value.is_object() {
                    break 'parse None;
                }
                let Ok(voxels_value) = Reflect::get(&chunk_value, &keys.voxels) else {
                    break 'parse None;
                };
                let Ok(lights_value) = Reflect::get(&chunk_value, &keys.lights) else {
                    break 'parse None;
                };
                let Ok(voxels_array) = voxels_value.dyn_into::<Uint32Array>() else {
                    break 'parse None;
                };
                let Ok(lights_array) = lights_value.dyn_into::<Uint32Array>() else {
                    break 'parse None;
                };
                if voxels_array.length() != expected_chunk_len_u32
                    || lights_array.length() != expected_chunk_len_u32
                {
                    break 'parse None;
                }

                let mut voxels = vec![0; expected_chunk_len];
                let mut lights = vec![0; expected_chunk_len];
                voxels_array.copy_to(&mut voxels);
                lights_array.copy_to(&mut lights);

                break 'parse Some(ChunkData {
                    voxels,
                    lights,
                });
            };

            if let Some(chunk_data) = parsed_chunk {
                if !has_any_chunk {
                    let index = index_u32 as usize;
                    chunks = Vec::with_capacity(expected_chunk_count);
                    if index > 0 {
                        chunks.resize(index, None);
                    }
                    has_any_chunk = true;
                }
                chunks.push(Some(chunk_data));
            } else if has_any_chunk {
                chunks.push(None);
            }
        }

        if !has_any_chunk {
            return (Vec::new(), false);
        }
        if chunks.len() < expected_chunk_count {
            chunks.resize(expected_chunk_count, None);
        }
        (chunks, true)
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
    max_light_level: u32,
    chunk_grid_width: usize,
    chunk_grid_depth: usize,
) -> bool {
    chunk_size <= 0
        || max_height <= 0
        || max_light_level > 15
        || chunk_grid_width == 0
        || chunk_grid_depth == 0
}

#[inline]
fn has_invalid_flood_bounds(bounds_min_len: usize, bounds_shape: &[u32]) -> bool {
    if bounds_min_len < 3 || bounds_shape.len() < 3 {
        return true;
    }

    bounds_shape[0] == 0 || bounds_shape[1] == 0 || bounds_shape[2] == 0
}

#[inline]
fn compute_max_chunk_coordinate(grid_offset: i32, grid_extent: usize) -> Option<i32> {
    if grid_extent == 0 || grid_extent > i32::MAX as usize {
        return None;
    }
    grid_offset.checked_add(grid_extent as i32 - 1)
}

#[inline]
fn compute_expected_chunk_sizes(
    chunk_size: i32,
    max_height: i32,
    chunk_grid_width: usize,
    chunk_grid_depth: usize,
) -> Option<(usize, usize)> {
    if chunk_size <= 0 || max_height <= 0 || chunk_grid_width == 0 || chunk_grid_depth == 0 {
        return None;
    }
    let chunk_size_usize = chunk_size as usize;
    let chunk_height = max_height as usize;
    let expected_chunk_len = chunk_size_usize
        .checked_mul(chunk_height)?
        .checked_mul(chunk_size_usize)?;
    if expected_chunk_len > MAX_JS_TYPED_ARRAY_LENGTH {
        return None;
    }
    let expected_chunk_count = chunk_grid_width.checked_mul(chunk_grid_depth)?;
    if expected_chunk_count > MAX_LIGHT_BATCH_CHUNK_COUNT {
        return None;
    }
    Some((expected_chunk_len, expected_chunk_count))
}

#[inline]
fn clamp_light_level(level: u32, max_light_level: u32) -> u32 {
    level.min(max_light_level)
}

#[inline]
fn parse_nodes_or_empty<T>(value: JsValue) -> Vec<T>
where
    T: DeserializeOwned,
{
    if !value.is_object() {
        return Vec::new();
    }

    if let Some(array) = value.dyn_ref::<Array>() {
        let length_u32 = array.length();
        let length = length_u32 as usize;
        if length == 0 {
            return Vec::new();
        }
        if length_u32 == 1 {
            let single_value = array.get(0);
            if !single_value.is_object() {
                return Vec::new();
            }
            if let Ok(node) = serde_wasm_bindgen::from_value(single_value) {
                return vec![node];
            }
            return Vec::new();
        }
        let first_value = array.get(0);

        if first_value.is_object() && array.get(length_u32 - 1).is_object() {
            if let Ok(nodes) = serde_wasm_bindgen::from_value(array.clone().into()) {
                return nodes;
            }
        }

        let mut nodes = Vec::with_capacity(length);
        for index in 0..length_u32 {
            let node_value = array.get(index);
            if !node_value.is_object() {
                continue;
            }
            if let Ok(node) = serde_wasm_bindgen::from_value(node_value) {
                nodes.push(node);
            }
        }
        return nodes;
    }

    Vec::new()
}

#[wasm_bindgen]
pub fn init() {}

#[wasm_bindgen]
pub fn set_registry(registry: JsValue) -> bool {
    let parsed_registry = serde_wasm_bindgen::from_value(registry)
        .ok()
        .map(|mut parsed: LightRegistry| {
            parsed.build_cache();
            Arc::new(parsed)
        });
    let is_initialized = parsed_registry.is_some();

    CACHED_REGISTRY.with(|cached| {
        *cached.borrow_mut() = parsed_registry;
    });

    is_initialized
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
    if has_invalid_batch_config(
        chunk_size,
        max_height,
        max_light_level,
        chunk_grid_width,
        chunk_grid_depth,
    ) {
        return empty_batch_result();
    }

    let Some(light_color) = light_color_from_index(color) else {
        return empty_batch_result();
    };
    let removal_nodes: Vec<[i32; 3]> = parse_nodes_or_empty(removals);
    let mut flood_nodes: Vec<LightNode> = parse_nodes_or_empty(floods);
    if removal_nodes.is_empty() && flood_nodes.is_empty() {
        return empty_batch_result();
    }
    let flood_nodes_len = flood_nodes.len();
    if flood_nodes_len > 0 {
        let mut write_index = 0usize;
        for read_index in 0..flood_nodes_len {
            let mut node = flood_nodes[read_index];
            node.level = clamp_light_level(node.level, max_light_level);
            if node.level == 0 {
                continue;
            }
            flood_nodes[write_index] = node;
            write_index += 1;
        }
        if write_index < flood_nodes_len {
            flood_nodes.truncate(write_index);
        }
    }
    if removal_nodes.is_empty() && flood_nodes.is_empty() {
        return empty_batch_result();
    }
    if !flood_nodes.is_empty() && has_invalid_flood_bounds(bounds_min.len(), bounds_shape) {
        return empty_batch_result();
    }
    let Some((expected_chunk_len, expected_chunk_count)) = compute_expected_chunk_sizes(
        chunk_size,
        max_height,
        chunk_grid_width,
        chunk_grid_depth,
    ) else {
        return empty_batch_result();
    };
    if chunks_data.length() < expected_chunk_count as u32 {
        return empty_batch_result();
    }
    let Some(max_chunk_x) = compute_max_chunk_coordinate(grid_offset_x, chunk_grid_width) else {
        return empty_batch_result();
    };
    let Some(max_chunk_z) = compute_max_chunk_coordinate(grid_offset_z, chunk_grid_depth) else {
        return empty_batch_result();
    };
    let Some(registry) = CACHED_REGISTRY.with(|cached| cached.borrow().clone()) else {
        return empty_batch_result();
    };
    let (chunks, has_any_chunk) = parse_chunks(chunks_data, expected_chunk_count, expected_chunk_len);
    if !has_any_chunk {
        return empty_batch_result();
    }
    let mut space = BatchSpace::new(
        chunks,
        chunk_grid_width,
        chunk_grid_depth,
        [grid_offset_x, grid_offset_z],
        chunk_size,
        max_height as u32,
    );

    let config = LightConfig {
        chunk_size,
        max_height,
        max_light_level,
        min_chunk: [grid_offset_x, grid_offset_z],
        max_chunk: [max_chunk_x, max_chunk_z],
    };
    let bounds = if flood_nodes.is_empty() {
        None
    } else {
        Some(LightBounds {
            min: [bounds_min[0], bounds_min[1], bounds_min[2]],
            shape: [
                bounds_shape[0] as usize,
                bounds_shape[1] as usize,
                bounds_shape[2] as usize,
            ],
        })
    };

    if !removal_nodes.is_empty() {
        remove_lights(
            &mut space,
            removal_nodes.into_iter(),
            &light_color,
            &config,
            registry.as_ref(),
        );
    }

    if !flood_nodes.is_empty() {
        let insert_light: fn(u32, u32) -> u32 = match light_color {
            LightColor::Sunlight => LightUtils::insert_sunlight,
            LightColor::Red => LightUtils::insert_red_light,
            LightColor::Green => LightUtils::insert_green_light,
            LightColor::Blue => LightUtils::insert_blue_light,
        };
        for node in &flood_nodes {
            let [vx, vy, vz] = node.voxel;
            let raw = space.get_raw_light(vx, vy, vz);
            let updated = insert_light(raw, node.level);
            if updated != raw {
                space.set_raw_light(vx, vy, vz, updated);
            }
        }

        flood_light_nodes(
            &mut space,
            flood_nodes,
            &light_color,
            &config,
            bounds.as_ref(),
            registry.as_ref(),
        );
    }

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
                space.voxel_index_in_chunk(vx, ly as i32, vz),
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
    fn batch_space_y_range_guards_reject_out_of_bounds_access() {
        let chunk = ChunkData {
            voxels: vec![0; 16 * 4 * 16],
            lights: vec![0; 16 * 4 * 16],
        };
        let mut space = BatchSpace::new(vec![Some(chunk)], 1, 1, [0, 0], 16, 4);

        assert!(!space.contains(0, -1, 0));
        assert!(!space.contains(0, 4, 0));
        assert_eq!(space.get_raw_voxel(0, -1, 0), 0);
        assert_eq!(space.get_raw_voxel(0, 4, 0), 0);
        assert_eq!(space.get_raw_light(0, -1, 0), 0);
        assert_eq!(space.get_raw_light(0, 4, 0), 0);
        assert!(!space.set_raw_light(0, -1, 0, 1));
        assert!(!space.set_raw_light(0, 4, 0, 1));
        assert_eq!(space.modified_indices.len(), 0);
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
        assert!(super::has_invalid_batch_config(0, 64, 15, 1, 1));
        assert!(super::has_invalid_batch_config(16, 0, 15, 1, 1));
        assert!(super::has_invalid_batch_config(16, 64, 16, 1, 1));
        assert!(super::has_invalid_batch_config(16, 64, 15, 0, 1));
        assert!(super::has_invalid_batch_config(16, 64, 15, 1, 0));
        assert!(!super::has_invalid_batch_config(16, 64, 15, 1, 1));
    }

    #[test]
    fn invalid_flood_bounds_detect_short_arrays_only_when_flooding() {
        assert!(super::has_invalid_flood_bounds(2, &[1, 1, 1]));
        assert!(super::has_invalid_flood_bounds(3, &[1, 1]));
        assert!(super::has_invalid_flood_bounds(3, &[0, 1, 1]));
        assert!(!super::has_invalid_flood_bounds(3, &[1, 1, 1]));
    }

    #[test]
    fn compute_max_chunk_coordinate_rejects_overflow() {
        assert_eq!(super::compute_max_chunk_coordinate(10, 1), Some(10));
        assert_eq!(super::compute_max_chunk_coordinate(-4, 3), Some(-2));
        assert_eq!(super::compute_max_chunk_coordinate(0, 0), None);
        assert_eq!(super::compute_max_chunk_coordinate(i32::MAX, 2), None);
        assert_eq!(
            super::compute_max_chunk_coordinate(0, i32::MAX as usize + 1),
            None
        );
        assert_eq!(super::compute_max_chunk_coordinate(0, usize::MAX), None);
    }

    #[test]
    fn compute_expected_chunk_sizes_detects_overflow_and_invalid_dimensions() {
        assert_eq!(
            super::compute_expected_chunk_sizes(16, 64, 3, 2),
            Some((16 * 64 * 16, 6))
        );
        assert_eq!(
            super::compute_expected_chunk_sizes(1, 1, 4_096, 4_096),
            Some((1, 4_096 * 4_096))
        );
        assert_eq!(super::compute_expected_chunk_sizes(0, 64, 1, 1), None);
        assert_eq!(super::compute_expected_chunk_sizes(16, -1, 1, 1), None);
        assert_eq!(super::compute_expected_chunk_sizes(16, 64, 0, 1), None);
        assert_eq!(super::compute_expected_chunk_sizes(16, 64, 1, 0), None);
        assert_eq!(super::compute_expected_chunk_sizes(1, 1, 4_097, 4_096), None);
        assert_eq!(super::compute_expected_chunk_sizes(65_536, 2, 1, 1), None);
        assert_eq!(super::compute_expected_chunk_sizes(46_341, 1, 1, 1), None);
        assert_eq!(super::compute_expected_chunk_sizes(i32::MAX, i32::MAX, 2, 2), None);
        assert_eq!(
            super::compute_expected_chunk_sizes(16, 64, 46_341, 46_341),
            None
        );
        assert_eq!(
            super::compute_expected_chunk_sizes(16, 64, u32::MAX as usize + 1, 1),
            None
        );
        assert_eq!(super::compute_expected_chunk_sizes(16, 64, usize::MAX, 2), None);
    }

    #[test]
    fn clamp_light_level_caps_values_to_max() {
        assert_eq!(super::clamp_light_level(12, 15), 12);
        assert_eq!(super::clamp_light_level(20, 15), 15);
    }
}
