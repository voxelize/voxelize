use js_sys::{Array, Float32Array, Int32Array, Int8Array, Object, Reflect, Uint16Array, Uint32Array, Uint8Array};
use std::cell::RefCell;
use wasm_bindgen::prelude::*;

pub use voxelize_mesher::*;

mod space;

use space::JsChunkSpace;

thread_local! {
    static CACHED_REGISTRY: RefCell<Option<Registry>> = const { RefCell::new(None) };
    static CHUNK_SCRATCH: RefCell<Vec<Option<ChunkData>>> = const { RefCell::new(Vec::new()) };
    /// Blocks whose geometry keeps float attributes (`set_float_blocks`),
    /// one flag per id.
    static FLOAT_BLOCKS: RefCell<Vec<bool>> = const { RefCell::new(Vec::new()) };
    static SPACE_SCRATCH: RefCell<JsChunkSpace> = RefCell::new(JsChunkSpace::default());
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn performance_now() -> f64;
}

#[wasm_bindgen]
pub fn init() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn set_registry(registry: JsValue) {
    let mut registry: Registry = serde_wasm_bindgen::from_value(registry)
        .expect("mesher registry did not match the wasm Registry shape");
    registry.build_cache();
    CACHED_REGISTRY.with(|r| {
        *r.borrow_mut() = Some(registry);
    });
}

/// The ids of the blocks `mesh_chunk_packed` leaves in float attributes: the
/// ones the client sorts on its main thread (`isMainThreadSortedBlock`).
/// Every other block's geometry is packed compact.
#[wasm_bindgen]
pub fn set_float_blocks(ids: &[u32]) {
    FLOAT_BLOCKS.with(|cell| {
        let mut flags = cell.borrow_mut();
        flags.clear();
        for &id in ids {
            let id = id as usize;
            if flags.len() <= id {
                flags.resize(id + 1, false);
            }
            flags[id] = true;
        }
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

/// One entry of the nine a mesh call is handed: its arrays, its shape, and
/// where it stands. `None` for a chunk that is not there.
struct ChunkArrays {
    voxels: Uint32Array,
    lights: Uint32Array,
    shape: [usize; 3],
    min: [i32; 3],
}

fn read_chunk_arrays(chunks_data: &Array, index: u32) -> Option<ChunkArrays> {
    let chunk_js = chunks_data.get(index);
    if chunk_js.is_null() || chunk_js.is_undefined() {
        return None;
    }

    let chunk_obj = Object::from(chunk_js);
    let voxels_val = Reflect::get(&chunk_obj, &"voxels".into()).unwrap();
    let lights_val = Reflect::get(&chunk_obj, &"lights".into()).unwrap();
    let shape_val = Reflect::get(&chunk_obj, &"shape".into()).unwrap();
    let min_val = Reflect::get(&chunk_obj, &"min".into()).unwrap();

    let shape_arr = Array::from(&shape_val);
    let min_arr = Array::from(&min_val);

    Some(ChunkArrays {
        voxels: as_uint32_array(voxels_val),
        lights: as_uint32_array(lights_val),
        shape: [
            shape_arr.get(0).as_f64().unwrap() as usize,
            shape_arr.get(1).as_f64().unwrap() as usize,
            shape_arr.get(2).as_f64().unwrap() as usize,
        ],
        min: [
            min_arr.get(0).as_f64().unwrap() as i32,
            min_arr.get(1).as_f64().unwrap() as i32,
            min_arr.get(2).as_f64().unwrap() as i32,
        ],
    })
}

/// Meshes a section and hands back the mesher's own arrays, number by
/// number: what the parity fixtures compare. A worker meshing for the screen
/// wants [`mesh_chunk_packed`], which copies a fraction of the input and
/// returns finished buffers.
#[wasm_bindgen]
pub fn mesh_chunk_fast(
    chunks_data: &Array,
    min: &[i32],
    max: &[i32],
    chunk_size: i32,
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
                let Some(arrays) = read_chunk_arrays(chunks_data, i as u32) else {
                    scratch[i] = None;
                    continue;
                };

                if scratch[i].is_none() {
                    scratch[i] = Some(ChunkData {
                        voxels: Vec::new(),
                        lights: Vec::new(),
                        shape: arrays.shape,
                        min: arrays.min,
                    });
                }

                let chunk = scratch[i].as_mut().unwrap();
                fill_chunk_data(chunk, &arrays.voxels, &arrays.lights, arrays.shape, arrays.min);
            }

            mesh_chunk_with_registry_chunks(
                &scratch[..chunk_count],
                [min[0], min[1], min[2]],
                [max[0], max[1], max[2]],
                MeshConfig {
                    chunk_size,
                },
                registry,
            )
        })
    });

    serde_wasm_bindgen::to_value(&output).unwrap()
}

fn set(object: &Object, key: &str, value: &JsValue) {
    Reflect::set(object, &JsValue::from_str(key), value).expect("a plain object takes any key");
}

fn packed_to_js(packed: PackedGeometry) -> Object {
    let object = Object::new();
    set(&object, "voxel", &JsValue::from_f64(packed.voxel as f64));
    set(
        &object,
        "at",
        &match packed.at {
            Some(at) => {
                let array = Array::new();
                for c in at {
                    array.push(&JsValue::from_f64(c as f64));
                }
                array.into()
            }
            None => JsValue::UNDEFINED,
        },
    );
    set(
        &object,
        "faceName",
        &match &packed.face_name {
            Some(name) => JsValue::from_str(name),
            None => JsValue::UNDEFINED,
        },
    );
    set(
        &object,
        "positions",
        &match &packed.positions {
            PackedPositions::Quantized(values) => Uint16Array::from(&values[..]).into(),
            PackedPositions::Float(values) => Float32Array::from(&values[..]).into(),
        },
    );
    set(
        &object,
        "uvs",
        &match &packed.uvs {
            PackedUvs::Quantized(values) => Uint16Array::from(&values[..]).into(),
            PackedUvs::Float(values) => Float32Array::from(&values[..]).into(),
        },
    );
    set(
        &object,
        "normals",
        &match &packed.normals {
            PackedNormals::Quantized(values) => Int8Array::from(&values[..]).into(),
            PackedNormals::Float(values) => Float32Array::from(&values[..]).into(),
        },
    );
    set(
        &object,
        "indices",
        &match &packed.indices {
            PackedIndices::Short(values) => Uint16Array::from(&values[..]).into(),
            PackedIndices::Wide(values) => Uint32Array::from(&values[..]).into(),
        },
    );
    set(&object, "lights", &Int32Array::from(&packed.lights[..]).into());
    set(
        &object,
        "lightTwist",
        &Uint8Array::from(&packed.light_twist[..]).into(),
    );
    let center = Array::new();
    for c in packed.bs_center {
        center.push(&JsValue::from_f64(c));
    }
    set(&object, "bsCenter", &center.into());
    set(&object, "bsRadius", &JsValue::from_f64(packed.bs_radius));
    object
}

/// Meshes a section for the screen: `{ geometries, connectivity, timings }`
/// with every geometry already in the typed arrays the client uploads
/// (`pack_geometry`), each a buffer of its own for the worker to transfer.
///
/// `chunks_data` is the nine chunks round the meshed one, as
/// `mesh_chunk_fast` takes them. Only the part of each a mesh can read (the
/// section and a margin) is copied out of them, so a call costs the section
/// rather than nine whole columns. `position_units` is the world's
/// `positionUnitsPerBlock`.
#[wasm_bindgen]
pub fn mesh_chunk_packed(
    chunks_data: &Array,
    min: &[i32],
    max: &[i32],
    chunk_size: i32,
    position_units: f64,
) -> JsValue {
    let started = performance_now();
    let min = [min[0], min[1], min[2]];
    let max = [max[0], max[1], max[2]];
    let result = Object::new();
    let geometries_js = Array::new();
    let timings = Object::new();
    let mut connectivity = CONNECTIVITY_FULL;
    let mut read_ms = 0.0;
    let mut mesh_ms = 0.0;

    CACHED_REGISTRY.with(|registry_cell| {
        SPACE_SCRATCH.with(|space_cell| {
            let registry_ref = registry_cell.borrow();
            let registry = registry_ref
                .as_ref()
                .expect("Registry not set. Call set_registry first.");
            let mut space = space_cell.borrow_mut();

            let has_center = space.load(chunks_data, chunk_size, &min, &max);
            read_ms = performance_now() - started;
            if !has_center {
                space.release();
                return;
            }

            let (geometries, section_connectivity) = mesh_section(&min, &max, &*space, registry);
            space.release();
            connectivity = section_connectivity;
            mesh_ms = performance_now() - started - read_ms;

            FLOAT_BLOCKS.with(|float_cell| {
                let float_blocks = float_cell.borrow();
                for geometry in geometries {
                    if geometry.positions.is_empty() {
                        continue;
                    }
                    let is_float = float_blocks
                        .get(geometry.voxel as usize)
                        .copied()
                        .unwrap_or(false);
                    let packed = pack_geometry(geometry, position_units, !is_float);
                    geometries_js.push(&packed_to_js(packed).into());
                }
            });
        })
    });

    let total_ms = performance_now() - started;
    set(&timings, "readMs", &JsValue::from_f64(read_ms));
    set(&timings, "meshMs", &JsValue::from_f64(mesh_ms));
    set(
        &timings,
        "packMs",
        &JsValue::from_f64(total_ms - read_ms - mesh_ms),
    );
    set(&result, "geometries", &geometries_js.into());
    set(&result, "connectivity", &JsValue::from_f64(connectivity as f64));
    set(&result, "timings", &timings.into());
    result.into()
}

#[wasm_bindgen]
pub fn mesh_chunk_full(input: JsValue) -> JsValue {
    let mut input: MeshInput = serde_wasm_bindgen::from_value(input).unwrap();
    input.registry.build_cache();
    let output = voxelize_mesher::mesh_chunk(input);
    serde_wasm_bindgen::to_value(&output).unwrap()
}
