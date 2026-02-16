use std::cell::RefCell;

use js_sys::{Array, Reflect, Uint32Array};
use serde::{de::DeserializeOwned, Serialize};
use wasm_bindgen::prelude::*;

pub use voxelize_mesher::*;

thread_local! {
    static CACHED_REGISTRY: RefCell<Option<Registry>> = const { RefCell::new(None) };
    static JS_KEYS: JsInteropKeys = JsInteropKeys::new();
    static EMPTY_MESH_OUTPUT: JsValue = {
        serde_wasm_bindgen::to_value(&MeshOutput {
            geometries: Vec::new(),
        })
        .unwrap_or(JsValue::NULL)
    };
}

struct JsInteropKeys {
    voxels: JsValue,
    lights: JsValue,
    shape: JsValue,
    min: JsValue,
}

impl JsInteropKeys {
    fn new() -> Self {
        Self {
            voxels: JsValue::from_str("voxels"),
            lights: JsValue::from_str("lights"),
            shape: JsValue::from_str("shape"),
            min: JsValue::from_str("min"),
        }
    }
}

#[inline]
fn empty_mesh_output() -> JsValue {
    EMPTY_MESH_OUTPUT.with(|output| output.clone())
}

#[inline]
fn parse_js_value<T: DeserializeOwned>(value: JsValue) -> Option<T> {
    serde_wasm_bindgen::from_value(value).ok()
}

#[inline]
fn serialize_js_value<T: Serialize>(value: &T) -> JsValue {
    serde_wasm_bindgen::to_value(value).unwrap_or_else(|_| empty_mesh_output())
}

#[inline]
fn get_js_field(object: &JsValue, key: &JsValue) -> Option<JsValue> {
    Reflect::get(object, key).ok()
}

#[inline]
fn parse_usize_triplet(value: &JsValue) -> Option<[usize; 3]> {
    let array = Array::from(value);
    let x = array.get(0).as_f64()?;
    let y = array.get(1).as_f64()?;
    let z = array.get(2).as_f64()?;
    if !x.is_finite()
        || !y.is_finite()
        || !z.is_finite()
        || x < 0.0
        || y < 0.0
        || z < 0.0
        || x > usize::MAX as f64
        || y > usize::MAX as f64
        || z > usize::MAX as f64
    {
        return None;
    }
    Some([x as usize, y as usize, z as usize])
}

#[inline]
fn parse_i32_triplet(value: &JsValue) -> Option<[i32; 3]> {
    let array = Array::from(value);
    let x = array.get(0).as_f64()?;
    let y = array.get(1).as_f64()?;
    let z = array.get(2).as_f64()?;
    if !x.is_finite()
        || !y.is_finite()
        || !z.is_finite()
        || x < i32::MIN as f64
        || y < i32::MIN as f64
        || z < i32::MIN as f64
        || x > i32::MAX as f64
        || y > i32::MAX as f64
        || z > i32::MAX as f64
    {
        return None;
    }
    Some([x as i32, y as i32, z as i32])
}

#[inline]
fn parse_slice_triplet(value: &[i32]) -> Option<[i32; 3]> {
    if value.len() < 3 {
        return None;
    }
    Some([value[0], value[1], value[2]])
}

#[inline]
fn mesh_with_cached_registry(input: MeshInputNoRegistry) -> Option<MeshOutput> {
    CACHED_REGISTRY.with(|registry| {
        let registry_ref = registry.borrow();
        let registry = registry_ref.as_ref()?;
        Some(mesh_chunk_with_registry(input, registry))
    })
}

#[inline]
fn parse_chunk_data(chunk: JsValue, keys: &JsInteropKeys) -> Option<ChunkData> {
    if chunk.is_null() || chunk.is_undefined() {
        return None;
    }
    let voxels_val = get_js_field(&chunk, &keys.voxels)?;
    let lights_val = get_js_field(&chunk, &keys.lights)?;
    let shape_val = get_js_field(&chunk, &keys.shape)?;
    let min_val = get_js_field(&chunk, &keys.min)?;

    let shape = parse_usize_triplet(&shape_val)?;
    if shape[0] == 0 || shape[1] == 0 || shape[2] == 0 {
        return None;
    }
    let min = parse_i32_triplet(&min_val)?;

    let voxels = Uint32Array::from(voxels_val).to_vec();
    let lights = Uint32Array::from(lights_val).to_vec();
    Some(ChunkData {
        voxels,
        lights,
        shape,
        min,
    })
}

#[wasm_bindgen]
pub fn init() {}

#[wasm_bindgen]
pub fn set_registry(registry: JsValue) {
    let mut parsed_registry: Registry = match parse_js_value(registry) {
        Some(registry) => registry,
        None => {
            CACHED_REGISTRY.with(|cached| {
                *cached.borrow_mut() = None;
            });
            return;
        }
    };
    parsed_registry.build_cache();
    CACHED_REGISTRY.with(|r| {
        *r.borrow_mut() = Some(parsed_registry);
    });
}

#[wasm_bindgen]
pub fn mesh_chunk(input: JsValue) -> JsValue {
    let parsed_input: MeshInputNoRegistry = match parse_js_value(input) {
        Some(input) => input,
        None => return empty_mesh_output(),
    };
    if parsed_input.config.chunk_size <= 0 {
        return empty_mesh_output();
    }
    let Some(output) = mesh_with_cached_registry(parsed_input) else {
        return empty_mesh_output();
    };
    serialize_js_value(&output)
}

#[wasm_bindgen]
pub fn mesh_chunk_fast(
    chunks_data: &Array,
    min: &[i32],
    max: &[i32],
    chunk_size: i32,
    greedy_meshing: bool,
) -> JsValue {
    if chunk_size <= 0 {
        return empty_mesh_output();
    }
    let min_triplet = match parse_slice_triplet(min) {
        Some(min) => min,
        None => return empty_mesh_output(),
    };
    let max_triplet = match parse_slice_triplet(max) {
        Some(max) => max,
        None => return empty_mesh_output(),
    };

    let mut chunks: Vec<Option<ChunkData>> = Vec::with_capacity(chunks_data.length() as usize);
    JS_KEYS.with(|keys| {
        for i in 0..chunks_data.length() {
            chunks.push(parse_chunk_data(chunks_data.get(i), keys));
        }
    });

    let input = MeshInputNoRegistry {
        chunks,
        min: min_triplet,
        max: max_triplet,
        config: MeshConfig {
            chunk_size,
            greedy_meshing,
        },
    };

    let Some(output) = mesh_with_cached_registry(input) else {
        return empty_mesh_output();
    };
    serialize_js_value(&output)
}

#[wasm_bindgen]
pub fn mesh_chunk_full(input: JsValue) -> JsValue {
    let mut parsed_input: MeshInput = match parse_js_value(input) {
        Some(input) => input,
        None => return empty_mesh_output(),
    };
    if parsed_input.config.chunk_size <= 0 {
        return empty_mesh_output();
    }
    parsed_input.registry.build_cache();
    let output = voxelize_mesher::mesh_chunk(parsed_input);
    serialize_js_value(&output)
}
