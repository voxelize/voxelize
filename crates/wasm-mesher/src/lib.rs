use std::cell::RefCell;
use wasm_bindgen::prelude::*;
use js_sys::{Array, Uint32Array};

pub use voxelize_mesher::*;

thread_local! {
    static CACHED_REGISTRY: RefCell<Option<Registry>> = const { RefCell::new(None) };
    static CHUNK_SCRATCH: RefCell<Vec<Option<ChunkData>>> = RefCell::new(Vec::new());
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

fn as_uint32_array(value: JsValue) -> Uint32Array {
    if value.is_instance_of::<Uint32Array>() {
        value.unchecked_into()
    } else {
        Uint32Array::from(value)
    }
}

fn copy_uint32_array(array: &Uint32Array, scratch: &mut Vec<u32>) {
    let len = array.length() as usize;
    if scratch.len() != len {
        scratch.resize(len, 0);
    }
    array.copy_to(scratch);
}

fn fill_chunk_data(
    chunk: &mut ChunkData,
    voxels_arr: &Uint32Array,
    lights_arr: &Uint32Array,
    shape: [usize; 3],
    min: [i32; 3],
) {
    copy_uint32_array(voxels_arr, &mut chunk.voxels);
    copy_uint32_array(lights_arr, &mut chunk.lights);
    chunk.shape = shape;
    chunk.min = min;
}

#[wasm_bindgen]
pub fn mesh_chunk_fast(
    chunks_data: &Array,
    min: &[i32],
    max: &[i32],
    chunk_size: i32,
    greedy_meshing: bool,
) -> JsValue {
    let chunk_count = chunks_data.length() as usize;

    let output = CACHED_REGISTRY.with(|registry_cell| {
        CHUNK_SCRATCH.with(|scratch_cell| {
            let registry_ref = registry_cell.borrow();
            let registry = registry_ref
                .as_ref()
                .expect("Registry not set. Call set_registry first.");

            let mut scratch = scratch_cell.borrow_mut();
            if scratch.len() < chunk_count {
                scratch.resize_with(chunk_count, || None);
            }

            for i in 0..chunk_count {
                let chunk_js = chunks_data.get(i as u32);
                if chunk_js.is_null() || chunk_js.is_undefined() {
                    scratch[i] = None;
                    continue;
                }

                let chunk_obj = js_sys::Object::from(chunk_js);
                let voxels_val = js_sys::Reflect::get(&chunk_obj, &"voxels".into()).unwrap();
                let lights_val = js_sys::Reflect::get(&chunk_obj, &"lights".into()).unwrap();
                let shape_val = js_sys::Reflect::get(&chunk_obj, &"shape".into()).unwrap();
                let min_val = js_sys::Reflect::get(&chunk_obj, &"min".into()).unwrap();

                let voxels_arr = as_uint32_array(voxels_val);
                let lights_arr = as_uint32_array(lights_val);
                let shape_arr = Array::from(&shape_val);
                let min_arr = Array::from(&min_val);

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

                if scratch[i].is_none() {
                    scratch[i] = Some(ChunkData {
                        voxels: Vec::new(),
                        lights: Vec::new(),
                        shape,
                        min: chunk_min,
                    });
                }

                let chunk = scratch[i].as_mut().unwrap();
                fill_chunk_data(chunk, &voxels_arr, &lights_arr, shape, chunk_min);
            }

            mesh_chunk_with_registry_chunks(
                &scratch[..chunk_count],
                [min[0], min[1], min[2]],
                [max[0], max[1], max[2]],
                MeshConfig {
                    chunk_size,
                    greedy_meshing,
                },
                registry,
            )
        })
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
