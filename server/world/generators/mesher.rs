use std::sync::Arc;

use crossbeam_channel::{unbounded, Receiver, Sender};
use hashbrown::{HashMap, HashSet};
use rayon::{iter::IntoParallelIterator, prelude::ParallelIterator, ThreadPool, ThreadPoolBuilder};

use crate::{
    Chunk, GeometryProtocol, MeshProtocol, MessageType, Registry, Space, Vec2, Vec3, VoxelAccess,
    WorldConfig,
};

use super::lights::Lights;

pub struct Mesher {
    pub(crate) queue: std::collections::VecDeque<Vec2<i32>>,
    pub(crate) map: HashSet<Vec2<i32>>,
    pub(crate) pending_remesh: HashSet<Vec2<i32>>,
    sender: Arc<Sender<(Chunk, MessageType)>>,
    receiver: Arc<Receiver<(Chunk, MessageType)>>,
    pool: ThreadPool,
}

impl Mesher {
    pub fn new() -> Self {
        let (sender, receiver) = unbounded();

        Self {
            queue: std::collections::VecDeque::new(),
            map: HashSet::new(),
            pending_remesh: HashSet::new(),
            sender: Arc::new(sender),
            receiver: Arc::new(receiver),
            pool: ThreadPoolBuilder::new()
                .thread_name(|index| format!("chunk-meshing-{index}"))
                .num_threads(
                    std::thread::available_parallelism()
                        .map(|p| p.get())
                        .unwrap_or(4),
                )
                .build()
                .unwrap(),
        }
    }

    pub fn add_chunk(&mut self, coords: &Vec2<i32>, prioritized: bool) {
        if self.map.contains(coords) {
            return;
        }

        self.remove_chunk(coords);

        if prioritized {
            self.queue.push_front(coords.to_owned());
        } else {
            self.queue.push_back(coords.to_owned());
        }
    }

    pub fn remove_chunk(&mut self, coords: &Vec2<i32>) {
        self.map.remove(coords);
        self.queue.retain(|c| c != coords);
    }

    pub fn has_chunk(&self, coords: &Vec2<i32>) -> bool {
        self.map.contains(coords)
    }

    pub fn get(&mut self) -> Option<Vec2<i32>> {
        self.queue.pop_front()
    }

    pub fn mark_for_remesh(&mut self, coords: &Vec2<i32>) {
        if self.map.contains(coords) {
            self.pending_remesh.insert(coords.to_owned());
        }
    }

    pub fn drain_pending_remesh(&mut self) -> Vec<Vec2<i32>> {
        self.pending_remesh.drain().collect()
    }

    pub fn process(
        &mut self,
        processes: Vec<(Chunk, Space)>,
        r#type: &MessageType,
        registry: &Registry,
        config: &WorldConfig,
    ) {
        let processes: Vec<(Chunk, Space)> = processes
            .into_iter()
            .filter(|(chunk, _)| {
                if self.map.contains(&chunk.coords) {
                    false
                } else {
                    self.map.insert(chunk.coords.to_owned());
                    true
                }
            })
            .collect();

        if processes.is_empty() {
            return;
        }

        let sender = Arc::clone(&self.sender);
        let r#type = r#type.clone();
        let is_load = r#type == MessageType::Load;
        let registry = Arc::new(registry.clone());
        let config = Arc::new(config.clone());

        self.pool.spawn(move || {
            if is_load {
                Self::process_load(processes, &sender, &registry, &config);
            } else {
                processes.into_par_iter().for_each(|(mut chunk, space)| {
                    Self::mesh_chunk(&mut chunk, &space, &registry, &config);
                    let _ = sender.send((chunk, r#type.clone()));
                });
            }
        });
    }

    /// Light and mesh a batch of freshly generated chunks.
    ///
    /// Every chunk's lighting depends only on its light-traversable neighborhood
    /// (light reaches at most `max_light_level` blocks). When that radius spans a
    /// single chunk ring (`extended == 1`, i.e. `max_light_level <= chunk_size`),
    /// adjacent chunks share most of that neighborhood, so the batch is grouped
    /// into spatial buckets and each bucket is lit once over its combined region
    /// instead of recomputing every chunk's 3x3 neighborhood independently. Other
    /// configurations fall back to the per-chunk path.
    fn process_load(
        processes: Vec<(Chunk, Space)>,
        sender: &Arc<Sender<(Chunk, MessageType)>>,
        registry: &Arc<Registry>,
        config: &Arc<WorldConfig>,
    ) {
        let extended =
            (config.max_light_level as f32 / config.chunk_size as f32).ceil() as i32;

        if extended != 1 {
            processes.into_par_iter().for_each(|(mut chunk, mut space)| {
                let coords = space.coords.to_owned();
                let min = space.min.to_owned();
                let shape = space.shape.to_owned();

                Lights::light_chunk(&mut space, &coords, &min, &shape, registry, config);

                chunk.lights = Arc::new(space.get_lights(coords.0, coords.1).unwrap().clone());
                Self::mesh_chunk(&mut chunk, &space, registry, config);

                let _ = sender.send((chunk, MessageType::Load));
            });

            return;
        }

        let bucket_size = Self::choose_bucket_size(processes.len());

        let mut buckets: HashMap<(i32, i32), Vec<(Chunk, Space)>> = HashMap::new();
        for (chunk, space) in processes {
            let key = (
                chunk.coords.0.div_euclid(bucket_size),
                chunk.coords.1.div_euclid(bucket_size),
            );
            buckets.entry(key).or_default().push((chunk, space));
        }

        let buckets: Vec<Vec<(Chunk, Space)>> = buckets.into_values().collect();

        buckets.into_par_iter().for_each(|members| {
            Self::light_bucket(members, sender, registry, config);
        });
    }

    /// Light one bucket of chunks over their combined neighborhood and emit each
    /// chunk's result. Only the bucket's own chunks are committed; the border
    /// ring of neighbor chunks is present purely to feed light across seams.
    fn light_bucket(
        members: Vec<(Chunk, Space)>,
        sender: &Arc<Sender<(Chunk, MessageType)>>,
        registry: &Arc<Registry>,
        config: &Arc<WorldConfig>,
    ) {
        let chunk_size = config.chunk_size as i32;
        let margin = config.max_light_level as i32;

        let committed: HashSet<Vec2<i32>> =
            members.iter().map(|(chunk, _)| chunk.coords.to_owned()).collect();

        let mut min_cx = i32::MAX;
        let mut min_cz = i32::MAX;
        let mut max_cx = i32::MIN;
        let mut max_cz = i32::MIN;
        for coords in &committed {
            min_cx = min_cx.min(coords.0);
            min_cz = min_cz.min(coords.1);
            max_cx = max_cx.max(coords.0);
            max_cz = max_cz.max(coords.1);
        }

        let flood_min = Vec3(min_cx * chunk_size - margin, 0, min_cz * chunk_size - margin);
        let flood_shape = Vec3(
            ((max_cx - min_cx + 1) * chunk_size + 2 * margin) as usize,
            config.max_height,
            ((max_cz - min_cz + 1) * chunk_size + 2 * margin) as usize,
        );

        let (chunks, spaces): (Vec<Chunk>, Vec<Space>) = members.into_iter().unzip();
        let mut space = Space::merge(spaces);

        Lights::light_region(
            &mut space,
            &committed,
            &flood_min,
            &flood_shape,
            registry,
            config,
        );

        for mut chunk in chunks {
            let coords = chunk.coords.to_owned();
            chunk.lights = Arc::new(space.get_lights(coords.0, coords.1).unwrap().clone());
            Self::mesh_chunk(&mut chunk, &space, registry, config);

            let _ = sender.send((chunk, MessageType::Load));
        }
    }

    /// Pick a square bucket edge (in chunks) so that the batch splits into about
    /// as many buckets as worker threads: large enough buckets to amortize the
    /// shared neighborhood, while still keeping every thread busy.
    fn choose_bucket_size(num_chunks: usize) -> i32 {
        let threads = std::thread::available_parallelism()
            .map(|p| p.get())
            .unwrap_or(4);

        let target = (num_chunks as f64 / threads as f64).sqrt().round() as i32;
        target.clamp(1, 8)
    }

    /// Build the greedy mesh for a chunk from `space`, honoring
    /// `client_only_meshing`.
    fn mesh_chunk(
        chunk: &mut Chunk,
        space: &Space,
        registry: &Registry,
        config: &WorldConfig,
    ) {
        if config.client_only_meshing {
            chunk.meshes = None;
            return;
        }

        let mut mesher_registry = registry.to_mesher_registry();
        mesher_registry.build_cache();

        let Vec3(min_x, min_y, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;
        let blocks_per_sub_chunk = (config.max_height / config.sub_chunks) as i32;

        for level in chunk.updated_levels.clone() {
            let level = level as i32;

            let min = Vec3(min_x, min_y + level * blocks_per_sub_chunk, min_z);
            let max = Vec3(max_x, min_y + (level + 1) * blocks_per_sub_chunk, max_z);

            let min_arr = [min.0, min.1, min.2];
            let max_arr = [max.0, max.1, max.2];

            let mesher_geometries =
                voxelize_mesher::mesh_space_greedy(&min_arr, &max_arr, space, &mesher_registry);

            let geometries: Vec<GeometryProtocol> = mesher_geometries
                .into_iter()
                .map(|g| GeometryProtocol {
                    voxel: g.voxel,
                    at: g.at.map(|[x, y, z]| vec![x, y, z]).unwrap_or_default(),
                    face_name: g.face_name,
                    positions: g.positions,
                    indices: g.indices,
                    uvs: g.uvs,
                    lights: g.lights,
                })
                .collect();

            chunk
                .meshes
                .get_or_insert_with(HashMap::new)
                .insert(level as u32, MeshProtocol { level, geometries });
        }
    }

    pub fn results(&mut self) -> Vec<(Chunk, MessageType)> {
        let mut results = Vec::new();

        while let Ok(result) = self.receiver.try_recv() {
            if !self.map.contains(&result.0.coords) {
                continue;
            }

            self.remove_chunk(&result.0.coords);
            results.push(result);
        }

        results
    }
}

impl Default for Mesher {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crossbeam_channel::unbounded;

    use crate::{
        Block, Chunk, ChunkOptions, Chunks, Lights, Ndarray, Registry, Vec2, Vec3, VoxelAccess,
        WorldConfig,
    };

    const STONE: u32 = 1;
    const GLASS: u32 = 2;
    const LEAVES: u32 = 3;
    const RED_TORCH: u32 = 4;
    const GREEN_TORCH: u32 = 5;
    const BLUE_TORCH: u32 = 6;

    fn test_config() -> WorldConfig {
        WorldConfig {
            chunk_size: 16,
            max_height: 48,
            sub_chunks: 4,
            max_light_level: 15,
            min_chunk: [0, 0],
            max_chunk: [4, 4],
            client_only_meshing: true,
            ..Default::default()
        }
    }

    fn test_registry() -> Registry {
        let mut registry = Registry::new();
        registry.register_block(&Block::new("stone").id(STONE).build());
        registry.register_block(
            &Block::new("glass")
                .id(GLASS)
                .is_transparent(true)
                .is_see_through(true)
                .build(),
        );
        registry.register_block(
            &Block::new("leaves")
                .id(LEAVES)
                .is_transparent(true)
                .is_see_through(true)
                .light_reduce(true)
                .build(),
        );
        registry.register_block(
            &Block::new("red_torch")
                .id(RED_TORCH)
                .is_passable(true)
                .red_light_level(14)
                .build(),
        );
        registry.register_block(
            &Block::new("green_torch")
                .id(GREEN_TORCH)
                .is_passable(true)
                .green_light_level(13)
                .build(),
        );
        registry.register_block(
            &Block::new("blue_torch")
                .id(BLUE_TORCH)
                .is_passable(true)
                .blue_light_level(12)
                .build(),
        );
        registry
    }

    /// Deterministic, varied terrain: rolling heights, all-air sky columns,
    /// transparent glass, light-reducing leaves, opaque overhangs that cast
    /// shadows, and sparse colored torches. Spread across a 6x6 chunk grid so
    /// the fixture covers seams, overhangs, varied heights and empty sky.
    fn build_test_world(config: &WorldConfig, registry: &Registry) -> Chunks {
        let mut chunks = Chunks::new(config);

        let options = ChunkOptions {
            size: config.chunk_size,
            max_height: config.max_height,
            sub_chunks: config.sub_chunks,
        };

        for cx in config.min_chunk[0]..=config.max_chunk[0] {
            for cz in config.min_chunk[1]..=config.max_chunk[1] {
                let mut chunk = Chunk::new("test", cx, cz, &options);

                let min_x = cx * config.chunk_size as i32;
                let min_z = cz * config.chunk_size as i32;

                for lx in 0..config.chunk_size as i32 {
                    for lz in 0..config.chunk_size as i32 {
                        let vx = min_x + lx;
                        let vz = min_z + lz;

                        let noise = (vx.wrapping_mul(7) + vz.wrapping_mul(13)).rem_euclid(11);
                        let height = 8 + noise;

                        // Some columns are empty sky to exercise the open-sky path.
                        if (vx.wrapping_mul(vz)).rem_euclid(23) == 0 {
                            continue;
                        }

                        for vy in 0..height {
                            chunk.set_voxel(vx, vy, vz, STONE);
                        }

                        // Surface variety: glass (passes sunlight) and leaves
                        // (reduces sunlight by one).
                        if (vx + 2 * vz).rem_euclid(6) == 0 {
                            chunk.set_voxel(vx, height, vz, GLASS);
                        } else if (vx.wrapping_mul(5) + vz.wrapping_mul(2)).rem_euclid(9) == 0 {
                            chunk.set_voxel(vx, height, vz, LEAVES);
                        }

                        // Opaque overhang roof with an air gap below, casting a shadow.
                        if (vx.wrapping_mul(3) + vz).rem_euclid(7) == 0 {
                            chunk.set_voxel(vx, height + 6, vz, STONE);
                        }

                        // Sparse colored torches sitting just above the surface.
                        match (vx.wrapping_mul(11) + vz.wrapping_mul(7)).rem_euclid(17) {
                            0 => {
                                chunk.set_voxel(vx, height + 1, vz, RED_TORCH);
                            }
                            1 => {
                                chunk.set_voxel(vx, height + 1, vz, GREEN_TORCH);
                            }
                            2 => {
                                chunk.set_voxel(vx, height + 1, vz, BLUE_TORCH);
                            }
                            _ => {}
                        }
                    }
                }

                chunk.calculate_max_height(registry);
                chunks.add(chunk);
            }
        }

        chunks
    }

    fn all_coords(config: &WorldConfig) -> Vec<Vec2<i32>> {
        let mut coords = vec![];
        for cx in config.min_chunk[0]..=config.max_chunk[0] {
            for cz in config.min_chunk[1]..=config.max_chunk[1] {
                coords.push(Vec2(cx, cz));
            }
        }
        coords
    }

    fn build_process(chunks: &Chunks, coords: &Vec2<i32>, config: &WorldConfig) -> (Chunk, Space) {
        let space = chunks
            .make_space(coords, config.max_light_level as usize)
            .needs_height_maps()
            .needs_voxels()
            .strict()
            .build();
        let chunk = chunks.raw(coords).unwrap().to_owned();
        (chunk, space)
    }

    /// Per-chunk reference: light each chunk independently in its own space,
    /// exactly as the historical mesher load path did.
    fn reference_lights(
        chunks: &Chunks,
        config: &WorldConfig,
        registry: &Registry,
    ) -> HashMap<Vec2<i32>, Ndarray<u32>> {
        let mut out = HashMap::new();

        for coords in all_coords(config) {
            let mut space = chunks
                .make_space(&coords, config.max_light_level as usize)
                .needs_height_maps()
                .needs_voxels()
                .strict()
                .build();

            let min = space.min.to_owned();
            let shape = space.shape.to_owned();

            Lights::light_chunk(&mut space, &coords, &min, &shape, registry, config);

            out.insert(
                coords.to_owned(),
                space.get_lights(coords.0, coords.1).unwrap().clone(),
            );
        }

        out
    }

    /// Batched path under test: run the real `process_load` (bucketing, region
    /// merge, single flood, extraction) and collect each chunk's lights.
    fn batched_lights(
        chunks: &Chunks,
        config: &WorldConfig,
        registry: &Registry,
    ) -> HashMap<Vec2<i32>, Ndarray<u32>> {
        let processes: Vec<(Chunk, Space)> = all_coords(config)
            .iter()
            .map(|coords| build_process(chunks, coords, config))
            .collect();

        let (sender, receiver) = unbounded();
        let sender = Arc::new(sender);
        let registry = Arc::new(registry.clone());
        let config = Arc::new(config.clone());

        Mesher::process_load(processes, &sender, &registry, &config);

        drop(sender);

        let mut out = HashMap::new();
        while let Ok((chunk, _)) = receiver.recv() {
            out.insert(chunk.coords.to_owned(), (*chunk.lights).clone());
        }

        out
    }

    fn fnv1a(values: &[u32]) -> u64 {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for &value in values {
            for byte in value.to_le_bytes() {
                hash ^= byte as u64;
                hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
            }
        }
        hash
    }

    fn hash_lights(config: &WorldConfig, lights: &HashMap<Vec2<i32>, Ndarray<u32>>) -> u64 {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for coords in all_coords(config) {
            hash ^= fnv1a(&lights[&coords].data);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        hash
    }

    #[test]
    fn batched_lighting_matches_per_chunk() {
        let config = test_config();
        let registry = test_registry();
        let chunks = build_test_world(&config, &registry);

        let reference = reference_lights(&chunks, &config, &registry);
        let batched = batched_lights(&chunks, &config, &registry);

        assert_eq!(reference.len(), batched.len());

        for coords in all_coords(&config) {
            assert_eq!(
                reference[&coords].data, batched[&coords].data,
                "lights differ for chunk {:?}",
                coords
            );
        }

        // The fixture must actually exercise lighting: a mix of fully-lit sky,
        // shadowed voxels, and colored torch light.
        let sample = &reference[&Vec2(2, 2)].data;
        let max_light = config.max_light_level;
        let mut has_full_sun = false;
        let mut has_shadow = false;
        let mut has_torch = false;
        for &raw in sample {
            let sun = (raw >> 12) & 0xf;
            let red = (raw >> 8) & 0xf;
            let green = (raw >> 4) & 0xf;
            let blue = raw & 0xf;
            if sun == max_light {
                has_full_sun = true;
            }
            if sun > 0 && sun < max_light {
                has_shadow = true;
            }
            if red > 0 || green > 0 || blue > 0 {
                has_torch = true;
            }
        }
        assert!(has_full_sun, "fixture has no open-sky sunlight");
        assert!(has_shadow, "fixture has no partial (shadowed) sunlight");
        assert!(has_torch, "fixture has no torch light");

        // Snapshot the exact light output so future changes that alter results
        // are caught. Both paths must hash to this golden value.
        const GOLDEN_LIGHT_HASH: u64 = 0x414f_2d86_7fda_d45e;
        let reference_hash = hash_lights(&config, &reference);
        let batched_hash = hash_lights(&config, &batched);

        assert_eq!(
            reference_hash, batched_hash,
            "batched and per-chunk hashes diverge"
        );

        if GOLDEN_LIGHT_HASH != 0 {
            assert_eq!(
                reference_hash, GOLDEN_LIGHT_HASH,
                "light output changed; golden hash mismatch"
            );
        } else {
            println!("GOLDEN_LIGHT_HASH = 0x{reference_hash:016x}");
        }
    }
}
