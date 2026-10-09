use std::path::PathBuf;
use std::sync::Arc;

use serde_json::Value;

use crate::{Chunk, ChunkOptions, ChunkStage, Registry, Resources, Vec3, VoxelAccess, WorldConfig};

use super::capture::CapturedWorld;
use super::source::{SourceChunk, SourceDescription, ViewerSource};

const CACHE_MAGIC: &[u8; 4] = b"VXVG";

struct Cursor<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Cursor<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        let slice = self
            .bytes
            .get(self.at..self.at + n)
            .ok_or_else(|| format!("truncated at byte {}", self.at))?;
        self.at += n;
        Ok(slice)
    }

    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
}

/// A world's own stage list run chunk by chunk, offline: every stage in
/// order with the height map refreshed after each (as the pipeline's merged
/// stage does), the registry's waterlogging rules on the chunk, and the
/// cross-chunk writes handed back for the backend to land. Stages that ask
/// the pipeline for a neighbour `Space` get none here; `describe` says so.
pub struct PipelineSource {
    name: String,
    stages: Vec<Arc<dyn ChunkStage + Send + Sync>>,
    registry: Registry,
    config: WorldConfig,
    cache: Option<PathBuf>,
    info: Value,
    warnings: Vec<String>,
}

impl PipelineSource {
    pub fn new(captured: CapturedWorld) -> Self {
        let mut config = captured.config;
        // The viewer meshes on the backend even for a world whose clients
        // mesh for themselves.
        config.client_only_meshing = false;
        config.saving = false;
        let warnings = captured
            .stages
            .iter()
            .filter(|stage| stage.needs_space().is_some() || stage.neighbors(&config) > 0)
            .map(|stage| {
                format!(
                    "stage `{}` asks for neighbour chunks, which the viewer's per-chunk run does not hand it",
                    stage.name()
                )
            })
            .collect();
        Self {
            name: captured.name,
            stages: captured.stages,
            registry: captured.registry,
            config,
            cache: None,
            info: Value::Null,
            warnings,
        }
    }

    /// Keep generated chunks under `dir`. The caller names the directory
    /// after everything generation depends on (build, profile, seed): the
    /// cache trusts it.
    pub fn with_cache(mut self, dir: PathBuf) -> Self {
        self.cache = Some(dir);
        self
    }

    pub fn with_info(mut self, info: Value) -> Self {
        self.info = info;
        self
    }

    pub fn stage_names(&self) -> Vec<String> {
        self.stages.iter().map(|s| s.name()).collect()
    }

    fn options(&self) -> ChunkOptions {
        ChunkOptions {
            size: self.config.chunk_size,
            max_height: self.config.max_height,
            sub_chunks: self.config.sub_chunks,
        }
    }

    /// One chunk through every stage.
    pub fn generate(&self, cx: i32, cz: i32) -> SourceChunk {
        let mut chunk = Chunk::new(&format!("viewer-{cx}-{cz}"), cx, cz, &self.options());
        chunk.waterlogging_rules = self.registry.waterlogging_rules().map(Arc::new);
        for stage in &self.stages {
            chunk = stage.process(
                chunk,
                Resources {
                    registry: &self.registry,
                    config: &self.config,
                },
                None,
            );
            chunk.calculate_max_height(&self.registry);
        }
        let extra = std::mem::take(&mut chunk.extra_changes);
        SourceChunk { chunk, extra }
    }

    fn cache_path(&self, cx: i32, cz: i32) -> Option<PathBuf> {
        self.cache
            .as_ref()
            .map(|d| d.join(format!("{cx}_{cz}.bin")))
    }

    fn encode(entry: &SourceChunk) -> Vec<u8> {
        let words: Vec<u8> = entry
            .chunk
            .voxels
            .data
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .collect();
        let packed = lz4_flex::compress_prepend_size(&words);
        let mut out = Vec::with_capacity(packed.len() + 32 + entry.extra.len() * 16);
        out.extend_from_slice(CACHE_MAGIC);
        out.extend_from_slice(&(entry.chunk.voxels.data.len() as u32).to_le_bytes());
        out.extend_from_slice(&(packed.len() as u32).to_le_bytes());
        out.extend_from_slice(&packed);
        match entry.chunk.biome_tints {
            Some(tints) => {
                out.push(1);
                out.extend_from_slice(&tints);
            }
            None => {
                out.push(0);
                out.extend_from_slice(&[0; 12]);
            }
        }
        out.extend_from_slice(&(entry.extra.len() as u32).to_le_bytes());
        for (Vec3(x, y, z), raw) in &entry.extra {
            for v in [*x, *y, *z] {
                out.extend_from_slice(&v.to_le_bytes());
            }
            out.extend_from_slice(&raw.to_le_bytes());
        }
        out
    }

    fn decode(&self, bytes: &[u8], cx: i32, cz: i32) -> Result<SourceChunk, String> {
        let mut cursor = Cursor { bytes, at: 0 };
        if cursor.take(4)? != CACHE_MAGIC {
            return Err("bad magic".into());
        }
        let count = cursor.u32()? as usize;
        let packed_len = cursor.u32()? as usize;
        let words = lz4_flex::decompress_size_prepended(cursor.take(packed_len)?)
            .map_err(|e| format!("lz4: {e}"))?;
        if words.len() != count * 4 {
            return Err(format!("{} voxel bytes for {count} voxels", words.len()));
        }
        let has_tints = cursor.take(1)?[0] == 1;
        let tints: [u8; 12] = cursor.take(12)?.try_into().unwrap();
        let extra_count = cursor.u32()? as usize;
        let mut extra = Vec::with_capacity(extra_count);
        for _ in 0..extra_count {
            let x = cursor.u32()? as i32;
            let y = cursor.u32()? as i32;
            let z = cursor.u32()? as i32;
            extra.push((Vec3(x, y, z), cursor.u32()?));
        }
        let options = self.options();
        let mut chunk = Chunk::new(&format!("viewer-{cx}-{cz}"), cx, cz, &options);
        if chunk.voxels.data.len() != count {
            return Err(format!(
                "entry has {count} voxels, a chunk here has {}",
                chunk.voxels.data.len()
            ));
        }
        chunk.waterlogging_rules = self.registry.waterlogging_rules().map(Arc::new);
        let mut staged = Chunk::new("viewer-staged", cx, cz, &options);
        Arc::make_mut(&mut staged.voxels).data = words
            .chunks_exact(4)
            .map(|b| u32::from_le_bytes(b.try_into().unwrap()))
            .collect();
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
        chunk.biome_tints = has_tints.then_some(tints);
        chunk.calculate_max_height(&self.registry);
        Ok(SourceChunk { chunk, extra })
    }
}

impl ViewerSource for PipelineSource {
    fn registry(&self) -> &Registry {
        &self.registry
    }

    fn config(&self) -> &WorldConfig {
        &self.config
    }

    fn describe(&self) -> SourceDescription {
        SourceDescription {
            name: self.name.clone(),
            far: None,
            layers: vec![],
            chunk_bounds: None,
            info: self.info.clone(),
            warnings: self.warnings.clone(),
        }
    }

    fn chunk(&self, cx: i32, cz: i32) -> Result<Option<SourceChunk>, String> {
        let path = self.cache_path(cx, cz);
        if let Some(path) = &path {
            if let Ok(bytes) = std::fs::read(path) {
                match self.decode(&bytes, cx, cz) {
                    Ok(entry) => return Ok(Some(entry)),
                    Err(e) => log::warn!(
                        "[viewer] generation cache entry {} unreadable ({e}); regenerating",
                        path.display()
                    ),
                }
            }
        }
        let entry = self.generate(cx, cz);
        if let Some(path) = &path {
            let tmp = path.with_extension(format!("tmp{}", std::process::id()));
            let written = std::fs::write(&tmp, Self::encode(&entry))
                .and_then(|_| std::fs::rename(&tmp, path));
            if let Err(e) = written {
                log::warn!("[viewer] could not cache {}: {e}", path.display());
            }
        }
        Ok(Some(entry))
    }
}
