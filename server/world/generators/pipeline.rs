use std::{collections::VecDeque, sync::Arc};

use crossbeam_channel::{unbounded, Receiver, Sender, TryRecvError};
use hashbrown::{HashMap, HashSet};
use rayon::prelude::{IndexedParallelIterator, IntoParallelIterator, ParallelIterator};

use crate::{
    world::shared_pools::{worldgen_pool, InflightJob, WORLDGEN_INFLIGHT},
    Chunk, ChunkStatus, Registry, Space, SpaceData, Terrain, Vec2, Vec3, VoxelAccess, VoxelUpdate,
    WorldConfig,
};

#[derive(Clone)]
pub struct Resources<'a> {
    pub registry: &'a Registry,
    pub config: &'a WorldConfig,
}

#[derive(Default)]
pub(crate) struct MetaStage {
    pub stages: Vec<Arc<dyn ChunkStage + Send + Sync>>,
}

impl MetaStage {
    pub fn add_stage(&mut self, stage: Arc<dyn ChunkStage + Send + Sync>) {
        self.stages.push(stage);
    }
}

impl ChunkStage for MetaStage {
    fn restore(&self, mut chunk: Chunk, resources: Resources) -> Chunk {
        for stage in &self.stages {
            chunk = stage.restore(chunk, resources.clone());
        }
        chunk
    }

    fn name(&self) -> String {
        self.stages
            .iter()
            .map(|stage| stage.name())
            .collect::<Vec<_>>()
            .join(" -> ")
    }

    fn process(&self, mut chunk: Chunk, resources: Resources, _: Option<Space>) -> Chunk {
        for (index, stage) in self.stages.iter().enumerate() {
            let started = std::time::Instant::now();
            chunk = stage.process(chunk, resources.clone(), None);
            super::gen_profiler::record(&stage.name(), started.elapsed());

            // Later stages read the height map, so refresh it between inner
            // stages. The final refresh is skipped: the pipeline recalculates
            // right after this meta stage returns.
            if index + 1 < self.stages.len() {
                let started = std::time::Instant::now();
                chunk.calculate_max_height(&resources.registry);
                super::gen_profiler::record("max-height (per stage)", started.elapsed());
            }
        }

        chunk
    }
}

/// A stage in the pipeline where a chunk gets populated.
pub trait ChunkStage {
    /// The name of the stage, e.g. "Soiling"
    fn name(&self) -> String;

    /// Optional idempotent migration of an existing save, before meshing.
    /// Defaults to preserving the save. Never rerun generation here: player
    /// construction and block state must survive. Runs on the loading worker;
    /// neighbor space and ECS resources are intentionally unavailable.
    fn restore(&self, chunk: Chunk, _: Resources) -> Chunk {
        chunk
    }

    /// The radius neighbor from the center chunk that are required before
    /// being processed in this chunk. Defaults to 0 blocks.
    fn neighbors(&self, _: &WorldConfig) -> usize {
        0
    }

    /// Whether if this stage needs a data-fetching structure called Space for
    /// each chunk process. In short, space provides additional information such as
    /// voxels/lights/height around the center chunk by cloning the neighboring data
    /// into the same Space, and providing data accessing utility functions. Defaults
    /// to `None`.
    fn needs_space(&self) -> Option<SpaceData> {
        None
    }

    /// The core of this chunk stage, in other words what is done on the chunk. Returns the chunk instance, and additional
    /// block changes to the world would be automatically added into `chunk.exceeded_changes`. For instance, if a tree is
    /// placed on the border of a chunk, the leaves would exceed the chunk border, thus appended to `exceeded_changes`.
    /// After each stage, the `exceeded_changes` list of block changes would be emptied and applied to the world.
    fn process(&self, chunk: Chunk, resources: Resources, space: Option<Space>) -> Chunk;
}

pub struct DebugStage {
    block: u32,
}

impl DebugStage {
    pub fn new(block: u32) -> Self {
        Self { block }
    }
}

impl ChunkStage for DebugStage {
    fn name(&self) -> String {
        "Debug".to_owned()
    }

    fn process(&self, mut chunk: Chunk, _: Resources, _: Option<Space>) -> Chunk {
        let Vec3(min_x, _, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;

        chunk.set_voxel(min_x, 0, min_z, self.block);
        chunk.set_voxel(min_x, 0, max_z - 1, self.block);
        chunk.set_voxel(max_x - 1, 0, min_z, self.block);
        chunk.set_voxel(max_x - 1, 0, max_z - 1, self.block);

        chunk
    }
}

/// A preset chunk stage to set a flat land.
#[derive(Default)]
pub struct FlatlandStage {
    top_height: u32,
    soiling: Vec<u32>,
}

impl FlatlandStage {
    pub fn new() -> Self {
        Self {
            top_height: 0,
            soiling: vec![],
        }
    }

    pub fn add_soiling(mut self, block: u32, height: usize) -> Self {
        for _ in 0..height {
            self.soiling.push(block);
        }

        self.top_height += height as u32;

        self
    }

    pub fn query_soiling(&self, y: u32) -> Option<u32> {
        self.soiling.get(y as usize).copied()
    }
}

impl ChunkStage for FlatlandStage {
    fn name(&self) -> String {
        "Flatland".to_owned()
    }

    fn process(&self, mut chunk: Chunk, _: Resources, _: Option<Space>) -> Chunk {
        let Vec3(min_x, _, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                for vy in 0..self.top_height {
                    if let Some(soiling) = self.query_soiling(vy) {
                        chunk.set_voxel(vx, vy as i32, vz, soiling);
                    }
                }
            }
        }

        chunk
    }
}

pub struct BaseTerrainStage {
    threshold: f64,
    base: u32,
    terrain: Terrain,
}

impl BaseTerrainStage {
    pub fn new(terrain: Terrain) -> Self {
        Self {
            threshold: 0.0,
            base: 0,
            terrain,
        }
    }

    pub fn set_base(&mut self, base: u32) {
        self.base = base;
    }

    pub fn set_threshold(&mut self, threshold: f64) {
        self.threshold = threshold;
    }
}

impl ChunkStage for BaseTerrainStage {
    fn name(&self) -> String {
        "Base Terrain".to_owned()
    }

    fn process(&self, mut chunk: Chunk, _: Resources, _: Option<Space>) -> Chunk {
        let Vec3(min_x, min_y, min_z) = chunk.min;
        let Vec3(max_x, max_y, max_z) = chunk.max;

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                for vy in min_y..max_y {
                    let (bias, offset) = self.terrain.get_bias_offset(vx, vy, vz);
                    let density = self.terrain.get_density_from_bias_offset(bias, offset, vy);

                    if density > self.threshold {
                        chunk.set_voxel(vx, vy, vz, self.base);
                    }
                }
            }
        }

        chunk
    }
}

/// A pipeline is strictly for holding the stages necessary to build the chunks.
pub struct Pipeline {
    /// A list of stages that chunks are in.
    pub stages: Vec<Arc<dyn ChunkStage + Send + Sync>>,

    /// A set of chunk coordinates in this pipeline to know which chunks are in this pipeline.
    pub(crate) chunks: HashSet<Vec2<i32>>,

    /// A queue of chunk coordinates that are waiting to be processed.
    pub(crate) queue: VecDeque<Vec2<i32>>,

    /// Coordinates something deliberately asked for — a client request, a
    /// preload, an explicit `add_chunk`. Demand is *sticky*: it survives
    /// re-queues, stage hops, and repeated requests, and is only cleared when
    /// the chunk reaches `Ready` (or leaves the world). Everything queued
    /// without demand is context — a neighbor pulled in for its voxel data
    /// (lighting borders, stage margins) — and parks short of the mesher,
    /// because a context chunk that meshes conscripts *its* neighborhood in
    /// turn, and that chain reaction once filled entire worlds from a single
    /// request.
    ///
    /// This used to be the inverse (a `context` set, consumed by the park
    /// decision). Consume-once semantics meant asking the question destroyed
    /// the answer: any race that read the flag at the wrong moment promoted
    /// or parked a chunk permanently, and a client whose first request lost
    /// that race could never revive the chunk by asking again.
    demanded: HashSet<Vec2<i32>>,

    /// A map of leftover changes from processing chunk stages.
    pub(crate) leftovers: HashMap<Vec2<i32>, Vec<VoxelUpdate>>,

    /// Stage writes aimed at a chunk whose Load pass is in flight. The pass
    /// lit a clone taken at dispatch, so a write landing now would be baked
    /// in raw, unlit and unsent (a leftover); these are replayed through
    /// the updating lane once that pass lands and the chunk is ready.
    pub(crate) deferred: HashMap<Vec2<i32>, Vec<VoxelUpdate>>,

    /// Chunks that received requests while being processed - need regeneration after current processing completes.
    pub(crate) pending_regenerate: HashSet<Vec2<i32>>,

    /// Chunks an unload released while one of their stages was running. The
    /// stage is left to land; the chunk then parks at the stage it reached
    /// unless something wants it again by then ([`Pipeline::parks_released`]).
    released: HashSet<Vec2<i32>>,

    /// Chunks parked partway through the pipeline because nobody wants them
    /// any more: an unload dropped their queued stages, or a released
    /// chunk's running stage landed. Their status still reads `Generating`,
    /// so a chunk that later waits on one as a neighbor puts it back on the
    /// queue ([`Pipeline::revive_dropped`]) instead of waiting on a stage
    /// nothing will run.
    dropped: HashSet<Vec2<i32>>,

    /// Sender of processed chunks from other threads to main thread.
    sender: Arc<Sender<(Chunk, Vec<VoxelUpdate>)>>,

    /// Receiver to receive processed chunks from other threads to main thread.
    receiver: Arc<Receiver<(Chunk, Vec<VoxelUpdate>)>>,
}

impl Pipeline {
    /// Create a new chunk pipeline.
    pub fn new() -> Self {
        let (sender, receiver) = unbounded();

        Self {
            sender: Arc::new(sender),
            receiver: Arc::new(receiver),
            chunks: HashSet::new(),
            leftovers: HashMap::new(),
            deferred: HashMap::new(),
            pending_regenerate: HashSet::new(),
            released: HashSet::new(),
            dropped: HashSet::new(),
            demanded: HashSet::new(),
            queue: VecDeque::new(),
            stages: Vec::new(),
        }
    }

    /// Forgets every chunk in flight. Pairs with wiping the chunk map: any
    /// coord still tracked here would be refused a fresh generation pass.
    pub fn clear(&mut self) {
        self.chunks.clear();
        self.queue.clear();
        self.leftovers.clear();
        self.deferred.clear();
        self.pending_regenerate.clear();
        self.released.clear();
        self.dropped.clear();
        self.demanded.clear();
    }

    pub fn mark_for_regenerate(&mut self, coords: &Vec2<i32>) {
        if self.chunks.contains(coords) {
            self.pending_regenerate.insert(coords.to_owned());
        }
    }

    pub fn drain_pending_regenerate(&mut self) -> Vec<Vec2<i32>> {
        self.pending_regenerate.drain().collect()
    }

    /// Add a chunk coordinate to the pipeline to be processed. A deliberate
    /// add is demand, and demand is sticky: repeating this call is always
    /// safe and never loses progress. A chunk already queued or mid-stage
    /// keeps its place (its demand is simply recorded); only a chunk the
    /// pipeline is not carrying at all is freshly queued.
    pub fn add_chunk(&mut self, coords: &Vec2<i32>, prioritized: bool) {
        self.demanded.insert(coords.to_owned());

        if self.has_chunk(coords) || self.queue.contains(coords) {
            return;
        }

        self.requeue_chunk(coords, prioritized);
    }

    /// Put a chunk already in flight back on the queue without touching its
    /// context standing. Internal re-queues (stage hops, listener wake-ups,
    /// corrupt-save regeneration) express no new demand, so routing them
    /// through `add_chunk` would silently promote context chunks and revive
    /// the chain reaction the context set exists to stop.
    pub(crate) fn requeue_chunk(&mut self, coords: &Vec2<i32>, prioritized: bool) {
        if self.has_chunk(coords) {
            self.mark_for_regenerate(coords);
            return;
        }

        self.dropped.remove(coords);

        // A generation queue this deep means something is conscripting chunks
        // far faster than any client could ask for them (an unbounded world's
        // mesh-prerequisite expansion once filled it with hundreds of
        // thousands of entries). Say so at the crossing instead of melting
        // quietly.
        if self.queue.len() == 100_000 {
            log::error!(
                "[pipeline] generation queue crossed 100k entries (adding {:?}); \
                 a system is requesting chunks far beyond any client interest",
                coords
            );
        }

        self.remove_chunk(coords);

        if prioritized {
            self.queue.push_front(coords.to_owned());
        } else {
            self.queue.push_back(coords.to_owned());
        }
    }

    /// Queue a chunk purely as generation context for a neighbor: it will
    /// generate its voxel data and then park short of the mesher until
    /// something demands it. Coords already queued or in flight keep whatever
    /// standing they have, and existing demand is never downgraded.
    pub(crate) fn add_context_chunk(&mut self, coords: &Vec2<i32>) {
        if self.has_chunk(coords) || self.queue.contains(coords) {
            return;
        }

        self.dropped.remove(coords);
        self.queue.push_back(coords.to_owned());
    }

    /// Stop carrying a chunk nobody wants any more. Its demand is forgotten,
    /// and unless a neighbor is already waiting on it (`is_awaited`) its
    /// queued stages are dropped (remembered in `dropped`), or, with a stage
    /// running, it is marked `released` so that stage lands and the chunk
    /// parks there. Pulling a running stage out of the pipeline used to throw
    /// its result away and leave the chunk at the stage before, with every
    /// neighbor waiting on it waiting forever.
    pub(crate) fn release_unwanted(&mut self, coords: &Vec2<i32>, is_awaited: bool) {
        self.demanded.remove(coords);
        if is_awaited {
            return;
        }
        if self.has_chunk(coords) {
            self.released.insert(coords.to_owned());
            return;
        }
        let queued = self.queue.len();
        self.queue.retain(|c| c != coords);
        if self.queue.len() < queued {
            self.dropped.insert(coords.to_owned());
        }
    }

    /// A stage landed for `coords` and the chunk has another one to go.
    /// Returns whether it parks instead: an unload released it while the
    /// stage ran and nothing (`is_wanted`) asked for it since. A parked
    /// chunk is remembered as dropped, so waiting on it revives it.
    pub(crate) fn parks_released(&mut self, coords: &Vec2<i32>, is_wanted: bool) -> bool {
        if !self.released.remove(coords) || is_wanted {
            return false;
        }
        self.dropped.insert(coords.to_owned());
        true
    }

    /// A released chunk finished its last stage; parking at `Meshing` is the
    /// mesher's call, so only the mark goes.
    pub(crate) fn forget_released(&mut self, coords: &Vec2<i32>) {
        self.released.remove(coords);
    }

    /// Put a chunk whose queued stages an unload dropped back at the front of
    /// the queue, because a neighbor is about to wait on it. Returns whether
    /// it had been dropped.
    pub(crate) fn revive_dropped(&mut self, coords: &Vec2<i32>) -> bool {
        if !self.dropped.contains(coords) {
            return false;
        }
        self.requeue_chunk(coords, true);
        true
    }

    /// Whether anything has deliberately asked for these coords. Read-only:
    /// asking never changes the answer, so the park decision can be made any
    /// number of times by any system and always agree.
    pub(crate) fn is_demanded(&self, coords: &Vec2<i32>) -> bool {
        self.demanded.contains(coords)
    }

    /// Forget recorded demand once a generation campaign has delivered (the
    /// chunk reached `Ready`) or the chunk left the world. A later regenerate
    /// pass starts with a clean slate and parks again if nobody asks.
    pub(crate) fn clear_demand(&mut self, coords: &Vec2<i32>) {
        self.demanded.remove(coords);
    }

    /// Remove a chunk coordinate from the pipeline.
    pub fn remove_chunk(&mut self, coords: &Vec2<i32>) {
        self.chunks.remove(coords);
        self.queue.retain(|c| c != coords);
    }

    /// Check to see if a chunk coordinate is in the pipeline.
    pub fn has_chunk(&self, coords: &Vec2<i32>) -> bool {
        self.chunks.contains(coords)
    }

    /// Pop the first chunk coordinate in the queue.
    pub fn get(&mut self) -> Option<Vec2<i32>> {
        self.queue.pop_front()
    }

    /// Add a stage to the chunking pipeline.
    pub fn add_stage<T>(&mut self, stage: T)
    where
        T: 'static + ChunkStage + Send + Sync,
    {
        // Insert the stage to the last.
        self.stages.push(Arc::new(stage));
    }

    /// Process a list of chunk processes, generated from the ECS system `PipeliningSystem`.
    pub fn process(
        &mut self,
        processes: Vec<(Chunk, Option<Space>)>,
        registry: &Registry,
        config: &WorldConfig,
    ) {
        processes.iter().for_each(|(chunk, _)| {
            self.chunks.insert(chunk.coords.to_owned());
        });

        // Retrieve the chunk stages' Arc clones.
        let processes: Vec<(Chunk, Option<Space>, Arc<dyn ChunkStage + Send + Sync>)> = processes
            .into_iter()
            .map(|(chunk, space)| {
                let index = if let ChunkStatus::Generating(index) = chunk.status {
                    index
                } else {
                    panic!("Chunk in pipeline does not have a generating status.");
                };

                let stage = self.stages.get(index).unwrap().clone();
                (chunk, space, stage)
            })
            .collect();

        let sender = Arc::clone(&self.sender);
        // One copy per batch, shared by its stage jobs: each job used to
        // deep-clone the whole Registry and config for itself.
        let registry = Arc::new(registry.to_owned());
        let config = Arc::new(config.to_owned());

        // Stage jobs run on the worldgen pool, never on the global pool the
        // tick path once shared: a tick must not queue behind this backlog.
        let pool = worldgen_pool();
        let stage_pool = Arc::clone(&pool);
        InflightJob::queue(&WORLDGEN_INFLIGHT, processes.len());
        pool.spawn(move || {
            processes
                .into_par_iter()
                .enumerate()
                .for_each(|(_, (chunk, space, stage))| {
                    let sender = Arc::clone(&sender);
                    let registry = Arc::clone(&registry);
                    let config = Arc::clone(&config);

                    stage_pool.spawn_fifo(move || {
                        let _inflight = InflightJob::adopt(&WORLDGEN_INFLIGHT);
                        let mut changes = vec![];

                        let started = std::time::Instant::now();
                        let mut chunk = stage.process(
                            chunk,
                            Resources {
                                registry: &registry,
                                config: &config,
                            },
                            space,
                        );
                        super::gen_profiler::record("pipeline stage total", started.elapsed());

                        // Calculate the max height after processing each chunk.
                        let started = std::time::Instant::now();
                        chunk.calculate_max_height(&registry);
                        super::gen_profiler::record("max-height (final)", started.elapsed());

                        if !chunk.extra_changes.is_empty() {
                            changes.append(&mut chunk.extra_changes.drain(..).collect());
                        }

                        let _ = sender.send((chunk, changes));
                    });
                });
        });
    }

    /// Attempt to retrieve the results from `pipeline.process`
    pub fn results(&mut self) -> Vec<(Chunk, Vec<VoxelUpdate>)> {
        let mut results = Vec::new();

        while let Ok(result) = self.receiver.try_recv() {
            if self.chunks.contains(&result.0.coords) {
                self.remove_chunk(&result.0.coords);
                results.push(result);
            } else {
                // Only a world wipe forgets a chunk mid-stage. A result thrown
                // away for any other reason leaves the chunk at its previous
                // stage with nothing left to advance it.
                log::warn!(
                    "[pipeline] discarding a finished stage for {:?}: no longer tracked (expected only after a world wipe)",
                    result.0.coords
                );
            }
        }

        results
    }

    /// Merge consecutive chunk stages that don't require spaces together into meta stages.
    pub(crate) fn merge_stages(&mut self) {
        let mut new_stages: Vec<Arc<dyn ChunkStage + Send + Sync>> = vec![];

        let mut current_meta: Option<MetaStage> = None;

        for stage in self.stages.to_owned().into_iter() {
            if stage.needs_space().is_some() {
                if let Some(current_stage) = current_meta {
                    new_stages.push(Arc::new(current_stage));
                }
                current_meta = None;
                new_stages.push(stage);
                continue;
            }

            if let Some(mut meta) = current_meta {
                meta.add_stage(stage);
                current_meta = Some(meta);
            } else {
                let mut meta = MetaStage::default();
                meta.add_stage(stage);
                current_meta = Some(meta);
            }
        }

        if let Some(meta) = current_meta {
            new_stages.push(Arc::new(meta));
        }

        self.stages = new_stages;
    }
}

#[cfg(test)]
mod release_tests {
    use super::*;

    #[test]
    fn an_unload_drops_queued_stages_and_waiting_on_the_chunk_revives_them() {
        let mut pipeline = Pipeline::new();
        let coords = Vec2(3, 4);
        pipeline.add_chunk(&coords, false);

        pipeline.release_unwanted(&coords, false);

        assert!(!pipeline.queue.contains(&coords));
        assert!(!pipeline.is_demanded(&coords));
        assert!(pipeline.revive_dropped(&coords));
        assert_eq!(pipeline.queue.front(), Some(&coords));
        assert!(
            !pipeline.revive_dropped(&coords),
            "a revived chunk is no longer dropped"
        );
    }

    #[test]
    fn an_unload_lets_a_running_stage_land_then_parks_the_chunk() {
        let mut pipeline = Pipeline::new();
        let coords = Vec2(1, 0);
        // What `process` records when the stage starts.
        pipeline.chunks.insert(coords.clone());

        pipeline.release_unwanted(&coords, false);

        assert!(pipeline.has_chunk(&coords), "the running stage still lands");
        assert!(pipeline.parks_released(&coords, false));
        assert!(pipeline.revive_dropped(&coords));
    }

    #[test]
    fn a_released_chunk_that_is_wanted_again_goes_on() {
        let mut pipeline = Pipeline::new();
        let coords = Vec2(1, 0);
        pipeline.chunks.insert(coords.clone());
        pipeline.release_unwanted(&coords, false);

        assert!(!pipeline.parks_released(&coords, true));
        assert!(!pipeline.revive_dropped(&coords));
    }

    #[test]
    fn a_chunk_a_neighbor_waits_on_keeps_its_stages() {
        let mut pipeline = Pipeline::new();
        let coords = Vec2(0, 1);
        pipeline.add_chunk(&coords, false);

        pipeline.release_unwanted(&coords, true);

        assert!(pipeline.queue.contains(&coords));
        assert!(!pipeline.revive_dropped(&coords));
    }
}

#[cfg(test)]
mod restore_tests {
    use super::*;
    use crate::{BlockUtils, ChunkOptions};

    struct SavedAppearance;
    impl ChunkStage for SavedAppearance {
        fn name(&self) -> String {
            "saved appearance".into()
        }
        fn process(&self, _: Chunk, _: Resources, _: Option<Space>) -> Chunk {
            panic!("loading a save must never run generation");
        }
        fn restore(&self, mut chunk: Chunk, _: Resources) -> Chunk {
            let raw = chunk.get_raw_voxel(0, 2, 0);
            chunk.set_raw_voxel(0, 2, 0, BlockUtils::insert_stage(raw, 8));
            chunk
        }
    }

    #[test]
    fn merged_stages_restore_only_opted_in_metadata() {
        let mut pipeline = Pipeline::new();
        // This would destroy the player's stone if process ran while loading.
        pipeline.add_stage(FlatlandStage::new().add_soiling(1, 12));
        pipeline.add_stage(SavedAppearance);
        pipeline.merge_stages();
        let registry = Registry::new();
        let config = WorldConfig::default();
        let mut chunk = Chunk::new(
            "saved",
            0,
            0,
            &ChunkOptions {
                size: 16,
                max_height: 32,
                sub_chunks: 2,
            },
        );
        chunk.set_voxel(0, 2, 0, 7);
        chunk.set_voxel(1, 2, 0, 11);
        for stage in &pipeline.stages {
            chunk = stage.restore(
                chunk,
                Resources {
                    registry: &registry,
                    config: &config,
                },
            );
        }
        assert_eq!(chunk.get_voxel(0, 2, 0), 7);
        assert_eq!(chunk.get_voxel_stage(0, 2, 0), 8);
        assert_eq!(chunk.get_raw_voxel(1, 2, 0), 11);
        assert_eq!(chunk.get_voxel(0, 3, 0), 0);
    }
}
