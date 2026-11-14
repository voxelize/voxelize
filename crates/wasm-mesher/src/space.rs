use js_sys::{Array, Object, Reflect, Uint32Array};
use wasm_bindgen::{JsCast, JsValue};

use voxelize_mesher::{BlockRotation, BlockUtils, LightColor, LightUtils, VoxelAccess, WINDOW_PAD};

/// One of the nine chunks a mesh call is handed: the script's arrays, and a
/// copy of the part of them the mesher's window covers.
#[derive(Default)]
struct Chunk {
    /// The script's voxel and light arrays; `None` for a chunk that is not
    /// there.
    arrays: Option<(Uint32Array, Uint32Array)>,
    voxels_len: usize,
    lights_len: usize,
    shape: [usize; 3],
    /// The copied box, in the chunk's own coordinates: x in `x0..x1`, y in
    /// `y0..y1`, every z. Empty when nothing of this chunk is in the window.
    x0: usize,
    x1: usize,
    y0: usize,
    y1: usize,
    voxels: Vec<u32>,
    lights: Vec<u32>,
}

impl Chunk {
    /// Where a cell of the copied box sits in the copy.
    #[inline(always)]
    fn copied(&self, lx: usize, ly: usize, lz: usize) -> Option<usize> {
        if lx >= self.x0 && lx < self.x1 && ly >= self.y0 && ly < self.y1 {
            Some(((lx - self.x0) * (self.y1 - self.y0) + (ly - self.y0)) * self.shape[2] + lz)
        } else {
            None
        }
    }

    /// Where a cell sits in the script's arrays (`VoxelSpace::get_index`).
    #[inline(always)]
    fn index(&self, lx: usize, ly: usize, lz: usize) -> usize {
        lx * self.shape[1] * self.shape[2] + ly * self.shape[2] + lz
    }
}

/// The nine chunks round a section, read the way the mesher's own
/// `VoxelSpace` reads them, without first copying all of them out of the
/// script's memory. A whole chunk is its full height in voxels and lights; a
/// mesh reads one section of it and a margin. So the part the mesher's window
/// covers is copied once, in a few hundred row-block copies, and a read past
/// it (a fluid column running on, a branch reaching out) asks the script's
/// array for the one cell.
#[derive(Default)]
pub struct JsChunkSpace {
    chunks: [Chunk; 9],
    chunk_size: i32,
    center: [i32; 2],
}

fn as_uint32_array(value: JsValue) -> Uint32Array {
    if value.is_instance_of::<Uint32Array>() {
        value.unchecked_into()
    } else {
        Uint32Array::from(value)
    }
}

/// Copies `source[start..start + out.len()]`, reading zeros past its end.
fn copy_block(source: &Uint32Array, len: usize, start: usize, out: &mut [u32]) {
    let end = start + out.len();
    if end <= len {
        source.subarray(start as u32, end as u32).copy_to(out);
        return;
    }
    let held = len.saturating_sub(start).min(out.len());
    if held > 0 {
        source
            .subarray(start as u32, (start + held) as u32)
            .copy_to(&mut out[..held]);
    }
    out[held..].fill(0);
}

impl JsChunkSpace {
    /// Takes the nine chunks of a mesh call and copies in what a mesh of
    /// `min..max` reads. False when the middle chunk is missing: there is
    /// nothing to mesh.
    pub fn load(&mut self, chunks_data: &Array, chunk_size: i32, min: &[i32; 3], max: &[i32; 3]) -> bool {
        self.chunk_size = chunk_size;
        let mut center_min = None;

        for (i, chunk) in self.chunks.iter_mut().enumerate() {
            chunk.arrays = None;
            chunk.x0 = 0;
            chunk.x1 = 0;
            chunk.y0 = 0;
            chunk.y1 = 0;
            let chunk_js = chunks_data.get(i as u32);
            if chunk_js.is_null() || chunk_js.is_undefined() {
                continue;
            }
            let chunk_obj = Object::from(chunk_js);
            let voxels = as_uint32_array(Reflect::get(&chunk_obj, &"voxels".into()).unwrap());
            let lights = as_uint32_array(Reflect::get(&chunk_obj, &"lights".into()).unwrap());
            let shape = Array::from(&Reflect::get(&chunk_obj, &"shape".into()).unwrap());
            chunk.shape = [0, 1, 2].map(|axis| shape.get(axis).as_f64().unwrap() as usize);
            chunk.voxels_len = voxels.length() as usize;
            chunk.lights_len = lights.length() as usize;
            chunk.arrays = Some((voxels, lights));
            if i == 4 {
                let chunk_min = Array::from(&Reflect::get(&chunk_obj, &"min".into()).unwrap());
                center_min = Some([
                    chunk_min.get(0).as_f64().unwrap() as i32,
                    chunk_min.get(2).as_f64().unwrap() as i32,
                ]);
            }
        }

        let Some(center_min) = center_min else {
            return false;
        };
        self.center = [center_min[0] / chunk_size, center_min[1] / chunk_size];

        let low = min.map(|c| c - WINDOW_PAD);
        let high = max.map(|c| c + WINDOW_PAD);
        for (i, chunk) in self.chunks.iter_mut().enumerate() {
            let Some((voxels, lights)) = &chunk.arrays else {
                continue;
            };
            // A row of a chunk is `chunk_size` cells along z; the copy below
            // takes whole rows, so it needs the chunk laid out that way.
            if chunk.shape[0] != chunk_size as usize || chunk.shape[2] != chunk_size as usize {
                continue;
            }
            let (dx, dz) = (i as i32 % 3 - 1, i as i32 / 3 - 1);
            let chunk_x = (self.center[0] + dx) * chunk_size;
            let chunk_z = (self.center[1] + dz) * chunk_size;
            if low[2].max(chunk_z) >= high[2].min(chunk_z + chunk_size) {
                continue;
            }
            let x0 = (low[0].max(chunk_x) - chunk_x).max(0);
            let x1 = (high[0].min(chunk_x + chunk_size) - chunk_x).max(0);
            let y0 = low[1].max(0);
            let y1 = high[1].min(chunk.shape[1] as i32).max(0);
            if x0 >= x1 || y0 >= y1 {
                continue;
            }
            chunk.x0 = x0 as usize;
            chunk.x1 = x1 as usize;
            chunk.y0 = y0 as usize;
            chunk.y1 = y1 as usize;

            let block = (chunk.y1 - chunk.y0) * chunk.shape[2];
            let cells = (chunk.x1 - chunk.x0) * block;
            // Every cell is written below; no need to clear what was there.
            chunk.voxels.resize(cells, 0);
            chunk.lights.resize(cells, 0);
            for lx in chunk.x0..chunk.x1 {
                let from = chunk.index(lx, chunk.y0, 0);
                let to = (lx - chunk.x0) * block;
                copy_block(voxels, chunk.voxels_len, from, &mut chunk.voxels[to..to + block]);
                copy_block(lights, chunk.lights_len, from, &mut chunk.lights[to..to + block]);
            }
        }

        true
    }

    /// Lets go of the script's arrays once a call is done with them.
    pub fn release(&mut self) {
        for chunk in &mut self.chunks {
            chunk.arrays = None;
        }
    }

    /// The chunk holding a column and the column's place in it.
    #[inline(always)]
    fn locate(&self, vx: i32, vz: i32) -> Option<(&Chunk, usize, usize)> {
        let dx = vx.div_euclid(self.chunk_size) - self.center[0];
        let dz = vz.div_euclid(self.chunk_size) - self.center[1];
        if !(-1..=1).contains(&dx) || !(-1..=1).contains(&dz) {
            return None;
        }
        let chunk = &self.chunks[((dz + 1) * 3 + (dx + 1)) as usize];
        chunk.arrays.as_ref()?;
        Some((
            chunk,
            vx.rem_euclid(self.chunk_size) as usize,
            vz.rem_euclid(self.chunk_size) as usize,
        ))
    }

    #[inline]
    fn raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        let Some((chunk, lx, lz)) = self.locate(vx, vz) else {
            return 0;
        };
        if vy < 0 || vy as usize >= chunk.shape[1] {
            return 0;
        }
        let ly = vy as usize;
        if let Some(at) = chunk.copied(lx, ly, lz) {
            return chunk.voxels[at];
        }
        let index = chunk.index(lx, ly, lz);
        match &chunk.arrays {
            Some((voxels, _)) if index < chunk.voxels_len => voxels.get_index(index as u32),
            _ => 0,
        }
    }

    #[inline]
    fn raw_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        let Some((chunk, lx, lz)) = self.locate(vx, vz) else {
            return 0;
        };
        if vy < 0 || vy as usize >= chunk.shape[1] {
            return 0;
        }
        let ly = vy as usize;
        if let Some(at) = chunk.copied(lx, ly, lz) {
            return chunk.lights[at];
        }
        let index = chunk.index(lx, ly, lz);
        // Lights can lag voxels for a chunk mid-transfer; missing entries
        // read as dark.
        match &chunk.arrays {
            Some((_, lights)) if index < chunk.voxels_len && index < chunk.lights_len => {
                lights.get_index(index as u32)
            }
            _ => 0,
        }
    }
}

impl VoxelAccess for JsChunkSpace {
    fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        self.raw_voxel(vx, vy, vz) & 0xFFFF
    }

    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        self.raw_voxel(vx, vy, vz)
    }

    fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation {
        BlockUtils::extract_rotation(self.raw_voxel(vx, vy, vz))
    }

    fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        BlockUtils::extract_stage(self.raw_voxel(vx, vy, vz))
    }

    fn get_voxel_waterlogged(&self, vx: i32, vy: i32, vz: i32) -> bool {
        BlockUtils::extract_waterlogged(self.raw_voxel(vx, vy, vz))
    }

    fn get_voxel_fluid_level(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        BlockUtils::extract_fluid_level(self.raw_voxel(vx, vy, vz))
    }

    fn get_sunlight(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_sunlight(self.raw_light(vx, vy, vz))
    }

    fn get_torch_light(&self, vx: i32, vy: i32, vz: i32, color: LightColor) -> u32 {
        let light = self.raw_light(vx, vy, vz);
        match color {
            LightColor::Red => LightUtils::extract_red_light(light),
            LightColor::Green => LightUtils::extract_green_light(light),
            LightColor::Blue => LightUtils::extract_blue_light(light),
            LightColor::Sunlight => LightUtils::extract_sunlight(light),
        }
    }

    fn get_all_lights(&self, vx: i32, vy: i32, vz: i32) -> (u32, u32, u32, u32) {
        LightUtils::extract_all(self.raw_light(vx, vy, vz))
    }

    fn get_max_height(&self, _vx: i32, _vz: i32) -> u32 {
        u32::MAX
    }

    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        self.locate(vx, vz).is_some() && vy >= 0
    }

    fn decodes_raw_voxels(&self) -> bool {
        true
    }

    /// A row inside the copied box is one copy per chunk it crosses.
    fn read_row(
        &self,
        vx: i32,
        vy: i32,
        vz: i32,
        voxels: &mut [u32],
        lights: &mut [u16],
        present: &mut [bool],
    ) {
        let len = voxels.len();
        let mut done = 0;
        while done < len {
            let z = vz + done as i32;
            let lz = z.rem_euclid(self.chunk_size) as usize;
            let run = (self.chunk_size as usize - lz).min(len - done);
            let located = self.locate(vx, z);
            present[done..done + run].fill(located.is_some() && vy >= 0);
            let copied = located.and_then(|(chunk, lx, lz)| {
                if vy < 0 {
                    return None;
                }
                chunk.copied(lx, vy as usize, lz).map(|at| (chunk, at))
            });
            match copied {
                Some((chunk, at)) => {
                    voxels[done..done + run].copy_from_slice(&chunk.voxels[at..at + run]);
                    for (out, light) in lights[done..done + run]
                        .iter_mut()
                        .zip(&chunk.lights[at..at + run])
                    {
                        *out = (*light & 0xFFFF) as u16;
                    }
                }
                None => {
                    for i in 0..run {
                        voxels[done + i] = self.raw_voxel(vx, vy, z + i as i32);
                        lights[done + i] = (self.raw_light(vx, vy, z + i as i32) & 0xFFFF) as u16;
                    }
                }
            }
            done += run;
        }
    }
}
