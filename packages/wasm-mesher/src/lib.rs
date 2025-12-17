use std::cell::RefCell;
use wasm_bindgen::prelude::*;
use js_sys::{Array, Uint32Array};

pub use voxelize_mesher::*;

thread_local! {
    static CACHED_REGISTRY: RefCell<Option<Registry>> = const { RefCell::new(None) };
}

#[wasm_bindgen]
pub fn init() {}

#[wasm_bindgen]
pub fn set_registry(registry: JsValue) {
    let mut registry: Registry = serde_wasm_bindgen::from_value(registry).unwrap();
    registry.build_cache();
    CACHED_REGISTRY.with(|r| {
        *r.borrow_mut() = Some(registry);
    });
}

#[wasm_bindgen]
pub fn mesh_chunk(input: JsValue) -> JsValue {
    let input: MeshInputNoRegistry = serde_wasm_bindgen::from_value(input).unwrap();
    
    let output = CACHED_REGISTRY.with(|r| {
        let registry_ref = r.borrow();
        let registry = registry_ref.as_ref().expect("Registry not set. Call set_registry first.");
        mesh_chunk_with_registry(input, registry)
    });
    
    serde_wasm_bindgen::to_value(&output).unwrap()
}

#[wasm_bindgen]
pub fn mesh_chunk_fast(
    chunks_data: &Array,
    min: &[i32],
    max: &[i32],
    chunk_size: i32,
    greedy_meshing: bool,
) -> JsValue {
    let mut chunks: Vec<Option<ChunkData>> = Vec::with_capacity(chunks_data.length() as usize);
    
    for i in 0..chunks_data.length() {
        let chunk_js = chunks_data.get(i);
        if chunk_js.is_null() || chunk_js.is_undefined() {
            chunks.push(None);
            continue;
        }
        
        let chunk_obj = js_sys::Object::from(chunk_js);
        let voxels_val = js_sys::Reflect::get(&chunk_obj, &"voxels".into()).unwrap();
        let lights_val = js_sys::Reflect::get(&chunk_obj, &"lights".into()).unwrap();
        let shape_val = js_sys::Reflect::get(&chunk_obj, &"shape".into()).unwrap();
        let min_val = js_sys::Reflect::get(&chunk_obj, &"min".into()).unwrap();
        
        let voxels_arr = Uint32Array::from(voxels_val);
        let lights_arr = Uint32Array::from(lights_val);
        let shape_arr = Array::from(&shape_val);
        let min_arr = Array::from(&min_val);
        
        let voxels = voxels_arr.to_vec();
        let lights = lights_arr.to_vec();
        
        let shape = [
            shape_arr.get(0).as_f64().unwrap() as usize,
            shape_arr.get(1).as_f64().unwrap() as usize,
            shape_arr.get(2).as_f64().unwrap() as usize,
        ];
        let chunk_min = [
            min_arr.get(0).as_f64().unwrap() as i32,
            min_arr.get(1).as_f64().unwrap() as i32,
            min_arr.get(2).as_f64().unwrap() as i32,
        ];
        
        chunks.push(Some(ChunkData {
            voxels,
            lights,
            shape,
            min: chunk_min,
        }));
    }
    
    let input = MeshInputNoRegistry {
        chunks,
        min: [min[0], min[1], min[2]],
        max: [max[0], max[1], max[2]],
        config: MeshConfig {
            chunk_size,
            greedy_meshing,
        },
    };
    
    let output = CACHED_REGISTRY.with(|r| {
        let registry_ref = r.borrow();
        let registry = registry_ref.as_ref().expect("Registry not set. Call set_registry first.");
        mesh_chunk_with_registry(input, registry)
    });
    
    serde_wasm_bindgen::to_value(&output).unwrap()
}

#[wasm_bindgen]
pub fn mesh_chunk_full(input: JsValue) -> JsValue {
    let mut input: MeshInput = serde_wasm_bindgen::from_value(input).unwrap();
    input.registry.build_cache();
    let output = voxelize_mesher::mesh_chunk(input);
    serde_wasm_bindgen::to_value(&output).unwrap()
}
