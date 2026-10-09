use std::collections::{BTreeSet, HashMap};
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Instant;

use rayon::prelude::*;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{BlockUtils, Chunk, ChunkOptions, Chunks, Lights, Space, Vec2, Vec3, VoxelAccess};

use super::format::{
    combine, encode_chunk_mesh, encode_far_tile, hash_str, hash_words, summarize, BlockClasses,
    LevelGeometry,
};
use super::source::{FarTileSpec, ViewerSource};

/// Bumped when a request, response or file layout changes.
pub const PROTOCOL_VERSION: u32 = 1;

/// Every protocol line on stdout starts with this, so whatever else a
/// process prints there (a logger, a stage's `println!`) is never mistaken
/// for a reply.
pub const LINE_PREFIX: &str = "@vxv ";

fn default_resident() -> usize {
    1024
}

fn default_extras_reach() -> i32 {
    1
}

fn default_batch() -> usize {
    24
}

/// How the host starts a backend (the JSON file `@voxelize/viewer` writes).
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ViewerLaunch {
    /// Where `meta.json`, `blocks.json` and far tiles go.
    pub out: PathBuf,
    /// Root of the mesh cache; every backend may share one.
    pub mesh_dir: PathBuf,
    /// Mixed into every mesh key besides the registry and the world's
    /// dimensions: what else meshes depend on that the host can see
    /// changing (the mesher's sources). A mesh is otherwise a function of
    /// its 3x3 neighbourhood's voxels, so it is reused across builds and
    /// sources that agree on those.
    #[serde(default)]
    pub mesh_salt: String,
    /// Worker threads for generation and meshing; 0 lets rayon choose.
    #[serde(default)]
    pub threads: usize,
    /// Chunks held in memory (generated and finished); the oldest go first.
    #[serde(default = "default_resident")]
    pub resident_chunks: usize,
    /// Chunk rings cross-chunk writes are gathered from.
    #[serde(default = "default_extras_reach")]
    pub extras_reach: i32,
    /// Chunks meshed per batch, which bounds the light spaces held at once.
    #[serde(default = "default_batch")]
    pub mesh_batch: usize,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
enum Request {
    Chunks {
        id: u64,
        chunks: Vec<[i32; 2]>,
    },
    Query {
        id: u64,
        points: Vec<[i32; 2]>,
    },
    Far {
        id: u64,
        tiles: Vec<FarTileSpec>,
    },
    Annotations {
        id: u64,
        min: [i32; 2],
        max: [i32; 2],
    },
    Stats {
        id: u64,
    },
    Evict {
        id: u64,
    },
}

type Output = Arc<Mutex<Box<dyn Write + Send>>>;

fn reply(output: &Output, value: Value) {
    let mut out = output.lock().unwrap();
    let _ = writeln!(out, "{LINE_PREFIX}{value}");
    let _ = out.flush();
}

fn failed(id: u64, error: impl std::fmt::Display) -> Value {
    json!({ "id": id, "ok": false, "error": error.to_string() })
}

/// Recency-ordered map: the least recently touched entries leave first.
struct Lru<V> {
    map: HashMap<(i32, i32), (V, u64)>,
    clock: u64,
    cap: usize,
}

impl<V: Clone> Lru<V> {
    fn new(cap: usize) -> Self {
        Self {
            map: HashMap::new(),
            clock: 0,
            cap: cap.max(16),
        }
    }

    fn get(&mut self, key: &(i32, i32)) -> Option<V> {
        self.clock += 1;
        let clock = self.clock;
        self.map.get_mut(key).map(|entry| {
            entry.1 = clock;
            entry.0.clone()
        })
    }

    fn contains(&self, key: &(i32, i32)) -> bool {
        self.map.contains_key(key)
    }

    fn insert(&mut self, key: (i32, i32), value: V) {
        self.clock += 1;
        self.map.insert(key, (value, self.clock));
    }

    /// Drops the oldest entries past the cap, keeping `pinned`.
    fn trim(&mut self, pinned: &BTreeSet<(i32, i32)>) -> usize {
        if self.map.len() <= self.cap {
            return 0;
        }
        let mut order: Vec<((i32, i32), u64)> = self
            .map
            .iter()
            .filter(|(k, _)| !pinned.contains(k))
            .map(|(k, (_, t))| (*k, *t))
            .collect();
        order.sort_unstable_by_key(|(_, t)| *t);
        let excess = self.map.len() - self.cap;
        let mut dropped = 0;
        for (key, _) in order.into_iter().take(excess) {
            self.map.remove(&key);
            dropped += 1;
        }
        dropped
    }

    fn clear(&mut self) {
        self.map.clear();
    }

    fn len(&self) -> usize {
        self.map.len()
    }
}

struct Base {
    chunk: Option<Chunk>,
    extra: Vec<crate::VoxelUpdate>,
}

struct Final {
    chunk: Option<Chunk>,
    hash: u64,
}

#[derive(Default)]
struct Stats {
    generated: u64,
    generate_ms: u64,
    finished: u64,
    meshed: u64,
    mesh_ms: u64,
    mesh_cached: u64,
    evicted: u64,
    requests: u64,
}

/// The chunk side of a backend: what is resident, how it is finished and
/// meshed, and the mesh files it leaves behind.
struct ChunkWorker<S: ViewerSource> {
    source: Arc<S>,
    pool: Arc<rayon::ThreadPool>,
    launch: ViewerLaunch,
    mesher_registry: Arc<voxelize_mesher::Registry>,
    classes: Arc<BlockClasses>,
    namespace: u64,
    mesh_root: PathBuf,
    bases: Lru<Arc<Base>>,
    finals: Lru<Arc<Final>>,
    stats: Stats,
}

fn ring(c: (i32, i32), r: i32) -> impl Iterator<Item = (i32, i32)> {
    (-r..=r).flat_map(move |dx| (-r..=r).map(move |dz| (c.0 + dx, c.1 + dz)))
}

fn registry_fingerprint(source: &dyn ViewerSource) -> u64 {
    let registry = source.registry();
    let mut ids: Vec<&u32> = registry.blocks_by_id.keys().collect();
    ids.sort_unstable();
    combine(ids.into_iter().map(|id| {
        let block = &registry.blocks_by_id[id];
        hash_str(&serde_json::to_string(block).unwrap_or_default())
    }))
}

impl<S: ViewerSource + 'static> ChunkWorker<S> {
    fn new(source: Arc<S>, pool: Arc<rayon::ThreadPool>, launch: ViewerLaunch) -> Self {
        let mut mesher_registry = source.registry().to_mesher_registry();
        mesher_registry.build_cache();
        let config = source.config();
        let namespace = combine([
            PROTOCOL_VERSION as u64,
            registry_fingerprint(source.as_ref()),
            config.chunk_size as u64,
            config.max_height as u64,
            config.sub_chunks as u64,
            config.max_light_level as u64,
            launch.extras_reach as u64,
            hash_str(&launch.mesh_salt),
        ]);
        let mesh_root = launch.mesh_dir.join(format!("{namespace:016x}"));
        let classes = Arc::new(BlockClasses::new(source.registry()));
        Self {
            bases: Lru::new(launch.resident_chunks * 3 / 2),
            finals: Lru::new(launch.resident_chunks),
            source,
            pool,
            launch,
            mesher_registry: Arc::new(mesher_registry),
            classes,
            namespace,
            mesh_root,
            stats: Stats::default(),
        }
    }

    fn options(&self) -> ChunkOptions {
        let config = self.source.config();
        ChunkOptions {
            size: config.chunk_size,
            max_height: config.max_height,
            sub_chunks: config.sub_chunks,
        }
    }

    fn ensure_bases(&mut self, wanted: &BTreeSet<(i32, i32)>) -> Result<(), String> {
        let missing: Vec<(i32, i32)> = wanted
            .iter()
            .filter(|c| !self.bases.contains(c))
            .copied()
            .collect();
        if missing.is_empty() {
            return Ok(());
        }
        let started = Instant::now();
        let source = Arc::clone(&self.source);
        let made: Vec<((i32, i32), Result<Base, String>)> = self.pool.install(|| {
            missing
                .par_iter()
                .map(|&(cx, cz)| {
                    let base = source.chunk(cx, cz).map(|found| match found {
                        Some(entry) => Base {
                            chunk: Some(entry.chunk),
                            extra: entry.extra,
                        },
                        None => Base {
                            chunk: None,
                            extra: vec![],
                        },
                    });
                    ((cx, cz), base)
                })
                .collect()
        });
        for (coords, base) in made {
            let base = base.map_err(|e| format!("chunk {},{}: {e}", coords.0, coords.1))?;
            self.bases.insert(coords, Arc::new(base));
        }
        self.stats.generated += missing.len() as u64;
        self.stats.generate_ms += started.elapsed().as_millis() as u64;
        Ok(())
    }

    /// Finishes `wanted`: each chunk's own voxels plus the writes its
    /// neighbours aimed into it, landed in source order.
    fn ensure_finals(&mut self, wanted: &BTreeSet<(i32, i32)>) -> Result<(), String> {
        let missing: Vec<(i32, i32)> = wanted
            .iter()
            .filter(|c| !self.finals.contains(c))
            .copied()
            .collect();
        if missing.is_empty() {
            return Ok(());
        }
        let reach = self.launch.extras_reach.max(0);
        let needed: BTreeSet<(i32, i32)> = missing.iter().flat_map(|&c| ring(c, reach)).collect();
        self.ensure_bases(&needed)?;
        let bases: HashMap<(i32, i32), Arc<Base>> = needed
            .iter()
            .filter_map(|c| self.bases.get(c).map(|b| (*c, b)))
            .collect();
        let size = self.source.config().chunk_size as i32;
        let source = Arc::clone(&self.source);
        let finished: Vec<((i32, i32), Final)> = self.pool.install(|| {
            missing
                .par_iter()
                .map(|&c| {
                    let Some(own) = bases.get(&c).and_then(|b| b.chunk.as_ref()) else {
                        return (
                            c,
                            Final {
                                chunk: None,
                                hash: 0,
                            },
                        );
                    };
                    let mut chunk = own.clone();
                    let mut sources: Vec<(i32, i32)> = ring(c, reach).filter(|s| *s != c).collect();
                    sources.sort_unstable();
                    let mut touched = false;
                    for s in sources {
                        let Some(base) = bases.get(&s) else { continue };
                        for (Vec3(x, y, z), raw) in &base.extra {
                            if (x.div_euclid(size), z.div_euclid(size)) == c {
                                chunk.set_raw_voxel(*x, *y, *z, *raw);
                                touched = true;
                            }
                        }
                    }
                    if touched {
                        chunk.calculate_max_height(source.registry());
                    }
                    // Identical neighbourhoods share one mesh file (its
                    // geometry is chunk-local), so whatever else the file
                    // carries per chunk is part of the key.
                    let tints = chunk
                        .biome_tints
                        .map_or(0, |t| combine(t.iter().map(|b| *b as u64)));
                    let hash = combine([hash_words(&chunk.voxels.data), tints]);
                    (
                        c,
                        Final {
                            chunk: Some(chunk),
                            hash,
                        },
                    )
                })
                .collect()
        });
        self.stats.finished += finished.len() as u64;
        for (coords, fin) in finished {
            self.finals.insert(coords, Arc::new(fin));
        }
        Ok(())
    }

    fn mesh_key(&mut self, c: (i32, i32)) -> u64 {
        let mut parts = vec![self.namespace];
        for n in ring(c, 1) {
            parts.push(self.finals.get(&n).map_or(0, |f| f.hash));
        }
        combine(parts)
    }

    fn mesh_path(&self, key: u64) -> PathBuf {
        self.mesh_root
            .join(format!("{:02x}", key >> 56))
            .join(format!("{key:016x}.vxvm"))
    }

    fn chunks(&mut self, id: u64, wanted: &[[i32; 2]]) -> Value {
        let started = Instant::now();
        let wanted: Vec<(i32, i32)> = {
            let mut seen = BTreeSet::new();
            wanted
                .iter()
                .map(|[x, z]| (*x, *z))
                .filter(|c| seen.insert(*c))
                .collect()
        };
        let neighbourhood: BTreeSet<(i32, i32)> = wanted.iter().flat_map(|&c| ring(c, 1)).collect();
        if let Err(e) = self.ensure_finals(&neighbourhood) {
            return failed(id, e);
        }
        let mut rows = Vec::with_capacity(wanted.len());
        let mut to_mesh = vec![];
        for &c in &wanted {
            let key = self.mesh_key(c);
            let path = self.mesh_path(key);
            let present = self.finals.get(&c).is_some_and(|f| f.chunk.is_some());
            if !present {
                rows.push(json!({ "cx": c.0, "cz": c.1, "empty": true }));
            } else if path.exists() {
                self.stats.mesh_cached += 1;
                rows.push(json!({
                    "cx": c.0, "cz": c.1, "key": format!("{key:016x}"),
                    "file": path.display().to_string(), "cached": true,
                }));
            } else {
                to_mesh.push((c, key, path));
            }
        }
        for batch in to_mesh.chunks(self.launch.mesh_batch.max(1)) {
            match self.mesh_batch(batch) {
                Ok(mut done) => rows.append(&mut done),
                Err(e) => return failed(id, e),
            }
        }
        let pinned: BTreeSet<(i32, i32)> = neighbourhood;
        self.stats.evicted += self.finals.trim(&pinned) as u64;
        self.stats.evicted += self.bases.trim(&pinned) as u64;
        json!({
            "id": id, "ok": true, "chunks": rows,
            "ms": started.elapsed().as_millis() as u64,
        })
    }

    fn mesh_batch(&mut self, batch: &[((i32, i32), u64, PathBuf)]) -> Result<Vec<Value>, String> {
        let started = Instant::now();
        let config = self.source.config().clone();
        let options = self.options();
        let mut chunks = Chunks::new(&config);
        let mut tops: HashMap<(i32, i32), i32> = HashMap::new();
        let needed: BTreeSet<(i32, i32)> = batch.iter().flat_map(|(c, _, _)| ring(*c, 1)).collect();
        for n in &needed {
            let fin = self.finals.get(n);
            let chunk = match fin.as_ref().and_then(|f| f.chunk.as_ref()) {
                Some(chunk) => chunk.clone(),
                None => Chunk::new(&format!("viewer-empty-{}-{}", n.0, n.1), n.0, n.1, &options),
            };
            tops.insert(
                *n,
                chunk.top_filled_y.unwrap_or(config.max_height as i32 - 1),
            );
            chunks.map.insert(Vec2(n.0, n.1), chunk);
        }
        let jobs: Vec<(((i32, i32), u64, PathBuf), Chunk, Space, i32)> = batch
            .iter()
            .map(|entry| {
                let c = entry.0;
                let space = chunks
                    .make_space(&Vec2(c.0, c.1), config.max_light_level as usize)
                    .needs_height_maps()
                    .needs_voxels()
                    .strict()
                    .build();
                let top = ring(c, 1)
                    .map(|n| tops.get(&n).copied().unwrap_or(0))
                    .max()
                    .unwrap_or(0);
                (
                    entry.clone(),
                    chunks.map[&Vec2(c.0, c.1)].clone(),
                    space,
                    top,
                )
            })
            .collect();
        drop(chunks);
        let registry = self.source.registry().clone();
        let mesher_registry = Arc::clone(&self.mesher_registry);
        let classes = Arc::clone(&self.classes);
        let level_height = (config.max_height / config.sub_chunks.max(1)) as i32;
        let written: Vec<Result<Value, String>> = self.pool.install(|| {
            jobs.into_par_iter()
                .map(|((c, key, path), chunk, mut space, top)| {
                    let one = Instant::now();
                    Lights::light_fresh_chunk(&mut space, &registry, &config);
                    let Vec3(min_x, min_y, min_z) = chunk.min;
                    let Vec3(max_x, _, max_z) = chunk.max;
                    let mut levels = vec![];
                    for level in 0..config.sub_chunks.max(1) as i32 {
                        let lo = min_y + level * level_height;
                        if lo > top + 1 {
                            break;
                        }
                        let geometries = voxelize_mesher::mesh_space_greedy(
                            &[min_x, lo, min_z],
                            &[max_x, lo + level_height, max_z],
                            &space,
                            &mesher_registry,
                        );
                        if !geometries.is_empty() {
                            levels.push(LevelGeometry {
                                level: level as u32,
                                geometries,
                            });
                        }
                    }
                    let summary = summarize(&chunk, &classes);
                    let bytes = encode_chunk_mesh(&chunk, level_height as u32, &summary, &levels);
                    if let Some(dir) = path.parent() {
                        std::fs::create_dir_all(dir)
                            .map_err(|e| format!("{}: {e}", dir.display()))?;
                    }
                    let tmp = path.with_extension(format!("tmp{}", std::process::id()));
                    std::fs::write(&tmp, &bytes)
                        .and_then(|_| std::fs::rename(&tmp, &path))
                        .map_err(|e| format!("{}: {e}", path.display()))?;
                    Ok(json!({
                        "cx": c.0, "cz": c.1, "key": format!("{key:016x}"),
                        "file": path.display().to_string(), "cached": false,
                        "bytes": bytes.len(), "ms": one.elapsed().as_millis() as u64,
                    }))
                })
                .collect()
        });
        self.stats.meshed += batch.len() as u64;
        self.stats.mesh_ms += started.elapsed().as_millis() as u64;
        written.into_iter().collect()
    }

    fn query(&mut self, id: u64, points: &[[i32; 2]]) -> Value {
        let size = self.source.config().chunk_size as i32;
        let wanted: BTreeSet<(i32, i32)> = points
            .iter()
            .map(|[x, z]| (x.div_euclid(size), z.div_euclid(size)))
            .collect();
        if let Err(e) = self.ensure_finals(&wanted) {
            return failed(id, e);
        }
        let registry = self.source.registry();
        let name = |id: u32| {
            registry
                .blocks_by_id
                .get(&id)
                .map_or_else(|| format!("#{id}"), |b| b.name.clone())
        };
        let mut rows = vec![];
        for [x, z] in points {
            let c = (x.div_euclid(size), z.div_euclid(size));
            let fin = self.finals.get(&c);
            let mut row = json!({ "x": x, "z": z, "chunk": [c.0, c.1] });
            if let Some(chunk) = fin.as_ref().and_then(|f| f.chunk.as_ref()) {
                let mut found = (None, None, None);
                for y in (0..chunk.options.max_height as i32).rev() {
                    let raw = chunk.get_raw_voxel(*x, y, *z);
                    let block = BlockUtils::extract_id(raw);
                    if self.classes.is_empty(block) {
                        continue;
                    }
                    let entry = json!({ "y": y, "id": block, "name": name(block) });
                    if found.0.is_none() {
                        found.0 = Some(entry.clone());
                    }
                    if found.2.is_none() && self.classes.is_fluid(block) {
                        found.2 = Some(entry.clone());
                    }
                    if self.classes.is_ground(block) {
                        found.1 = Some(entry);
                        break;
                    }
                }
                row["top"] = found.0.unwrap_or(Value::Null);
                row["ground"] = found.1.unwrap_or(Value::Null);
                row["water"] = found.2.unwrap_or(Value::Null);
            }
            row["source"] = self.source.query(*x, *z);
            rows.push(row);
        }
        json!({ "id": id, "ok": true, "points": rows })
    }

    fn stats(&self, id: u64) -> Value {
        let s = &self.stats;
        json!({
            "id": id, "ok": true,
            "stats": {
                "requests": s.requests, "generated": s.generated, "generateMs": s.generate_ms,
                "finished": s.finished, "meshed": s.meshed, "meshMs": s.mesh_ms,
                "meshCached": s.mesh_cached, "evicted": s.evicted,
                "residentBases": self.bases.len(), "residentFinals": self.finals.len(),
                "meshNamespace": format!("{:016x}", self.namespace),
            }
        })
    }
}

/// Writes `meta.json` and `blocks.json` (the registry exactly as a server's
/// INIT carries it) for `source`, then answers requests from `input` until
/// it closes. Chunk work runs in order on one worker; far tiles and
/// annotations run beside it on the pool.
pub fn serve_viewer<S: ViewerSource + 'static>(
    source: S,
    launch: ViewerLaunch,
    input: impl BufRead,
    output: Box<dyn Write + Send>,
) -> Result<(), String> {
    std::fs::create_dir_all(&launch.out).map_err(|e| format!("{}: {e}", launch.out.display()))?;
    std::fs::create_dir_all(launch.out.join("far"))
        .map_err(|e| format!("{}: {e}", launch.out.display()))?;
    let source = Arc::new(source);
    let pool = Arc::new(
        rayon::ThreadPoolBuilder::new()
            .num_threads(launch.threads)
            .build()
            .map_err(|e| e.to_string())?,
    );
    let output: Output = Arc::new(Mutex::new(output));
    let worker = ChunkWorker::new(Arc::clone(&source), Arc::clone(&pool), launch.clone());

    let config = source.config();
    let description = source.describe();
    let blocks_path = launch.out.join("blocks.json");
    std::fs::write(
        &blocks_path,
        serde_json::to_string(&source.registry().blocks_by_name).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("{}: {e}", blocks_path.display()))?;
    let meta = json!({
        "protocol": PROTOCOL_VERSION,
        "name": description.name,
        "chunkSize": config.chunk_size,
        "maxHeight": config.max_height,
        "subChunks": config.sub_chunks,
        "levelHeight": config.max_height / config.sub_chunks.max(1),
        "maxLightLevel": config.max_light_level,
        "seed": config.seed,
        "waterLevel": config.water_level,
        "far": description.far,
        "layers": description.layers,
        "chunkBounds": description.chunk_bounds,
        "info": description.info,
        "warnings": description.warnings,
        "meshNamespace": format!("{:016x}", worker.namespace),
        "extrasReach": launch.extras_reach,
        "blocks": blocks_path.display().to_string(),
    });
    let meta_path = launch.out.join("meta.json");
    std::fs::write(&meta_path, serde_json::to_vec_pretty(&meta).unwrap())
        .map_err(|e| format!("{}: {e}", meta_path.display()))?;

    let (jobs, inbox) = mpsc::channel::<Request>();
    let worker_output = Arc::clone(&output);
    let handle = std::thread::Builder::new()
        .name("viewer-chunks".into())
        .spawn(move || {
            let mut worker = worker;
            for request in inbox {
                worker.stats.requests += 1;
                let answer = match request {
                    Request::Chunks { id, chunks } => worker.chunks(id, &chunks),
                    Request::Query { id, points } => worker.query(id, &points),
                    Request::Stats { id } => worker.stats(id),
                    Request::Evict { id } => {
                        worker.bases.clear();
                        worker.finals.clear();
                        json!({ "id": id, "ok": true })
                    }
                    Request::Far { .. } | Request::Annotations { .. } => continue,
                };
                reply(&worker_output, answer);
            }
        })
        .map_err(|e| e.to_string())?;

    reply(
        &output,
        json!({ "event": "ready", "meta": meta_path.display().to_string() }),
    );

    let far_dir = launch.out.join("far");
    for line in input.lines() {
        let line = line.map_err(|e| e.to_string())?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let request: Request = match serde_json::from_str(line) {
            Ok(request) => request,
            Err(e) => {
                let id = serde_json::from_str::<Value>(line)
                    .ok()
                    .and_then(|v| v.get("id").and_then(Value::as_u64))
                    .unwrap_or(0);
                reply(&output, failed(id, format!("bad request: {e}")));
                continue;
            }
        };
        match request {
            Request::Far { id, tiles } => {
                let (source, output, far_dir) =
                    (Arc::clone(&source), Arc::clone(&output), far_dir.clone());
                pool.spawn(move || {
                    let rows: Vec<Value> = tiles
                        .iter()
                        .map(|spec| {
                            let path = far_dir.join(format!(
                                "{}_{}_{}_{}.vxvf",
                                spec.x0, spec.z0, spec.step, spec.size
                            ));
                            if !path.exists() {
                                let Some(tile) = source.far_tile(spec) else {
                                    return json!({ "spec": spec, "error": "this source has no far layer" });
                                };
                                let tmp = path.with_extension(format!("tmp{}", std::process::id()));
                                let bytes = encode_far_tile(spec, &tile);
                                if let Err(e) = std::fs::write(&tmp, &bytes)
                                    .and_then(|_| std::fs::rename(&tmp, &path))
                                {
                                    return json!({ "spec": spec, "error": format!("{}: {e}", path.display()) });
                                }
                            }
                            json!({ "spec": spec, "file": path.display().to_string() })
                        })
                        .collect();
                    reply(&output, json!({ "id": id, "ok": true, "tiles": rows }));
                });
            }
            Request::Annotations { id, min, max } => {
                let (source, output) = (Arc::clone(&source), Arc::clone(&output));
                pool.spawn(move || {
                    let rows = source.annotations(min, max);
                    reply(
                        &output,
                        json!({ "id": id, "ok": true, "annotations": rows }),
                    );
                });
            }
            other => {
                if jobs.send(other).is_err() {
                    return Err("the chunk worker stopped".into());
                }
            }
        }
    }
    drop(jobs);
    handle
        .join()
        .map_err(|_| "the chunk worker panicked".to_owned())?;
    Ok(())
}

/// Reads the launch file a host names and serves `source` over stdin and
/// stdout.
pub fn serve_viewer_stdio<S: ViewerSource + 'static>(
    source: S,
    launch: ViewerLaunch,
) -> Result<(), String> {
    let stdin = std::io::stdin();
    serve_viewer(source, launch, stdin.lock(), Box::new(std::io::stdout()))
}

/// Parses a launch file as `@voxelize/viewer` writes one: the backend's own
/// settings under `backend`, and whatever the host added beside them (which
/// world, which save) returned as is.
pub fn read_launch(path: &std::path::Path) -> Result<(ViewerLaunch, Value), String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut value: Value =
        serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
    let backend = value
        .as_object_mut()
        .and_then(|o| o.remove("backend"))
        .ok_or_else(|| format!("{}: no `backend` settings", path.display()))?;
    let launch =
        serde_json::from_value(backend).map_err(|e| format!("{}: backend: {e}", path.display()))?;
    Ok((launch, value))
}
