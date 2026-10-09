use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use base64::{engine::general_purpose::STANDARD, Engine};
use byteorder::{ByteOrder, LittleEndian};
use libflate::zlib::Decoder;
use serde::Deserialize;
use serde_json::json;

use crate::{Chunk, ChunkOptions, ChunkUtils, Registry, Vec3, VoxelAccess, WorldConfig};

use super::format::{summarize, BlockClasses, ColumnTop};
use super::source::{
    FarMaterials, FarTile, FarTileSpec, SourceChunk, SourceDescription, ViewerSource,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChunkFile {
    voxels: String,
    height_map: String,
}

/// A saved world's chunk files (`<cx>|<cz>.json` in a world's chunk
/// directory, the format the server writes), read and never written: no
/// file is created, rewritten or removed, whatever it holds. A file that
/// does not decode is reported, not repaired.
pub struct SavedChunks {
    name: String,
    dir: PathBuf,
    registry: Registry,
    config: WorldConfig,
    classes: BlockClasses,
    bounds: Option<[i32; 4]>,
    files: usize,
    summaries: Mutex<HashMap<(i32, i32), Option<Arc<Vec<ColumnTop>>>>>,
}

fn decode_words(text: &str) -> Result<Vec<u32>, String> {
    if text.is_empty() {
        return Ok(vec![]);
    }
    let bytes = STANDARD.decode(text).map_err(|e| format!("base64: {e}"))?;
    let mut decoder = Decoder::new(&bytes[..]).map_err(|e| format!("zlib: {e}"))?;
    let mut raw = Vec::new();
    decoder
        .read_to_end(&mut raw)
        .map_err(|e| format!("zlib: {e}"))?;
    if raw.len() % 4 != 0 {
        return Err(format!(
            "{} bytes is not a whole number of words",
            raw.len()
        ));
    }
    let mut words = vec![0u32; raw.len() / 4];
    LittleEndian::read_u32_into(&raw, &mut words);
    Ok(words)
}

fn read_file(path: &Path) -> Result<ChunkFile, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
}

impl SavedChunks {
    /// Opens `dir` (a world's `chunks` directory). Chunk size and height
    /// come from the files themselves; `config` supplies the rest (light
    /// levels, sub-chunk count) and is overridden on those two. The
    /// registry's atlas is laid out the way a server lays it out when it
    /// starts (`Registry::generate`), so face ranges match a client's.
    pub fn open(
        name: &str,
        dir: &Path,
        registry: Registry,
        config: WorldConfig,
    ) -> Result<Self, String> {
        let mut registry = registry;
        registry.generate();
        let entries = std::fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        let mut coords = vec![];
        for entry in entries.flatten() {
            let file = entry.file_name().to_string_lossy().to_string();
            let Some(stem) = file.strip_suffix(".json") else {
                continue;
            };
            let mut parts = stem.split('|');
            let (Some(a), Some(b), None) = (parts.next(), parts.next(), parts.next()) else {
                continue;
            };
            if let (Ok(cx), Ok(cz)) = (a.parse::<i32>(), b.parse::<i32>()) {
                coords.push((cx, cz));
            }
        }
        if coords.is_empty() {
            return Err(format!("{} holds no chunk files", dir.display()));
        }
        coords.sort_unstable();
        let mut dims = None;
        let mut errors = vec![];
        for (cx, cz) in coords.iter().take(32) {
            let path = dir.join(format!("{}.json", ChunkUtils::get_chunk_name(*cx, *cz)));
            match read_file(&path).and_then(|f| {
                Ok((
                    decode_words(&f.voxels)?.len(),
                    decode_words(&f.height_map)?.len(),
                ))
            }) {
                Ok((voxels, columns)) if voxels > 0 && columns > 0 => {
                    let size = (columns as f64).sqrt().round() as usize;
                    if size * size == columns && voxels % columns == 0 {
                        dims = Some((size, voxels / columns));
                        break;
                    }
                    errors.push(format!(
                        "{}: {voxels} voxels over {columns} columns",
                        path.display()
                    ));
                }
                Ok(_) => errors.push(format!("{}: empty", path.display())),
                Err(e) => errors.push(e),
            }
        }
        let (size, height) = dims.ok_or_else(|| {
            format!(
                "no readable chunk file in {} to take the chunk size from: {}",
                dir.display(),
                errors.join("; ")
            )
        })?;
        let mut config = config;
        config.chunk_size = size;
        config.max_height = height;
        if config.sub_chunks == 0 || height % config.sub_chunks != 0 {
            config.sub_chunks = 1;
        }
        config.saving = false;
        config.client_only_meshing = false;
        let bounds = coords.iter().fold(
            [i32::MAX, i32::MAX, i32::MIN, i32::MIN],
            |[x0, z0, x1, z1], (cx, cz)| [x0.min(*cx), z0.min(*cz), x1.max(*cx), z1.max(*cz)],
        );
        let classes = BlockClasses::new(&registry);
        Ok(Self {
            name: name.to_owned(),
            dir: dir.to_owned(),
            registry,
            config,
            classes,
            bounds: Some(bounds),
            files: coords.len(),
            summaries: Mutex::new(HashMap::new()),
        })
    }

    fn options(&self) -> ChunkOptions {
        ChunkOptions {
            size: self.config.chunk_size,
            max_height: self.config.max_height,
            sub_chunks: self.config.sub_chunks,
        }
    }

    /// The chunk as saved, or `None` when there is no file for it.
    pub fn load(&self, cx: i32, cz: i32) -> Result<Option<Chunk>, String> {
        let path = self
            .dir
            .join(format!("{}.json", ChunkUtils::get_chunk_name(cx, cz)));
        if !path.exists() {
            return Ok(None);
        }
        let file = read_file(&path)?;
        let words = decode_words(&file.voxels).map_err(|e| format!("{}: {e}", path.display()))?;
        let options = self.options();
        let mut chunk = Chunk::new(&format!("viewer-{cx}-{cz}"), cx, cz, &options);
        if words.len() != chunk.voxels.data.len() {
            return Err(format!(
                "{} holds {} voxels, a {}x{}x{} chunk has {}",
                path.display(),
                words.len(),
                options.size,
                options.max_height,
                options.size,
                chunk.voxels.data.len()
            ));
        }
        // Replayed through set_raw_voxel, as generation writes, so the
        // chunk's fill watermark and dirty levels are what meshing expects.
        let mut staged = Chunk::new("viewer-staged", cx, cz, &options);
        Arc::make_mut(&mut staged.voxels).data = words;
        let Vec3(min_x, _, min_z) = chunk.min;
        let (size, height) = (options.size as i32, options.max_height as i32);
        for x in min_x..min_x + size {
            for z in min_z..min_z + size {
                for y in 0..height {
                    let raw = staged.get_raw_voxel(x, y, z);
                    if raw != 0 {
                        chunk.set_raw_voxel(x, y, z, raw);
                    }
                }
            }
        }
        chunk.calculate_max_height(&self.registry);
        Ok(Some(chunk))
    }

    fn summary(&self, cx: i32, cz: i32) -> Option<Arc<Vec<ColumnTop>>> {
        if let Some(found) = self.summaries.lock().unwrap().get(&(cx, cz)) {
            return found.clone();
        }
        let summary = match self.load(cx, cz) {
            Ok(Some(chunk)) => Some(Arc::new(summarize(&chunk, &self.classes))),
            Ok(None) => None,
            Err(e) => {
                log::error!("[viewer] saved chunk {cx},{cz} unreadable, shown empty: {e}");
                None
            }
        };
        self.summaries
            .lock()
            .unwrap()
            .insert((cx, cz), summary.clone());
        summary
    }
}

impl ViewerSource for SavedChunks {
    fn registry(&self) -> &Registry {
        &self.registry
    }

    fn config(&self) -> &WorldConfig {
        &self.config
    }

    fn describe(&self) -> SourceDescription {
        SourceDescription {
            name: self.name.clone(),
            far: Some(FarMaterials::Blocks),
            layers: vec![],
            chunk_bounds: self.bounds,
            info: json!({
                "kind": "saved",
                "dir": self.dir.display().to_string(),
                "chunkFiles": self.files,
            }),
            warnings: vec![],
        }
    }

    fn chunk(&self, cx: i32, cz: i32) -> Result<Option<SourceChunk>, String> {
        match self.load(cx, cz) {
            Ok(found) => Ok(found.map(|chunk| SourceChunk {
                chunk,
                extra: vec![],
            })),
            // Shown as missing and said out loud; the file is left as it is.
            Err(e) => {
                log::error!("[viewer] saved chunk {cx},{cz} unreadable, shown empty: {e}");
                Ok(None)
            }
        }
    }

    fn far_tile(&self, spec: &FarTileSpec) -> Option<FarTile> {
        let size = self.config.chunk_size as i32;
        let samples = spec.samples();
        let mut tile = FarTile {
            heights: vec![0; samples],
            materials: vec![0; samples],
            water: vec![0; samples],
            layers: vec![],
        };
        for i in 0..samples {
            let (x, z) = spec.column(i);
            let (cx, cz) = (x.div_euclid(size), z.div_euclid(size));
            let Some(summary) = self.summary(cx, cz) else {
                continue;
            };
            let column = summary[(z.rem_euclid(size) * size + x.rem_euclid(size)) as usize];
            tile.heights[i] = column.top;
            tile.materials[i] = column.top_id;
            tile.water[i] = column.water;
        }
        Some(tile)
    }

    fn query(&self, x: i32, z: i32) -> serde_json::Value {
        let size = self.config.chunk_size as i32;
        let (cx, cz) = (x.div_euclid(size), z.div_euclid(size));
        let name = ChunkUtils::get_chunk_name(cx, cz);
        json!({
            "chunk": [cx, cz],
            "saved": self.dir.join(format!("{name}.json")).exists(),
        })
    }
}
