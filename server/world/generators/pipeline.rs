use std::{collections::VecDeque, sync::Arc};

use crossbeam_channel::{unbounded, Receiver, Sender};
use hashbrown::{HashMap, HashSet};
use log::warn;
use rayon::prelude::{IntoParallelIterator, ParallelIterator};

use crate::{
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
    fn name(&self) -> String {
        let stage_count = self.stages.len();
        if stage_count == 0 {
            return String::new();
        }
        let mut name = String::with_capacity(stage_count.saturating_mul(8));
        for stage_index in 0..stage_count {
            if stage_index > 0 {
                name.push_str(" -> ");
            }
            name.push_str(&self.stages[stage_index].name());
        }
        name
    }

    fn process(&self, mut chunk: Chunk, resources: Resources, _: Option<Space>) -> Chunk {
        for stage in &self.stages {
            chunk = stage.process(chunk, resources.clone(), None);
            chunk.calculate_max_height(&resources.registry);
        }

        chunk
    }
}

/// A stage in the pipeline where a chunk gets populated.
pub trait ChunkStage {
    /// The name of the stage, e.g. "Soiling"
    fn name(&self) -> String;

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
        self.soiling.extend(std::iter::repeat_n(block, height));

        let height_u32 = if height > u32::MAX as usize {
            u32::MAX
        } else {
            height as u32
        };
        self.top_height = self.top_height.saturating_add(height_u32);

        self
    }

    pub fn query_soiling(&self, y: u32) -> Option<u32> {
        self.soiling.get(y as usize).copied()
    }
}

#[inline]
fn clamped_flatland_top_height(top_height: u32, chunk_max_y: i32) -> u32 {
    if chunk_max_y <= 0 {
        return 0;
    }
    top_height.min(chunk_max_y as u32)
}

impl ChunkStage for FlatlandStage {
    fn name(&self) -> String {
        "Flatland".to_owned()
    }

    fn process(&self, mut chunk: Chunk, _: Resources, _: Option<Space>) -> Chunk {
        let Vec3(min_x, _, min_z) = chunk.min;
        let Vec3(max_x, max_y, max_z) = chunk.max;
        let top_height = clamped_flatland_top_height(self.top_height, max_y);

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                for vy in 0..top_height {
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

    /// A map of leftover changes from processing chunk stages.
    pub(crate) leftovers: HashMap<Vec2<i32>, Vec<VoxelUpdate>>,

    /// Chunks that received requests while being processed - need regeneration after current processing completes.
    pub(crate) pending_regenerate: HashSet<Vec2<i32>>,

    /// Sender of processed chunks from other threads to main thread.
    sender: Arc<Sender<(Chunk, Vec<VoxelUpdate>)>>,

    /// Receiver to receive processed chunks from other threads to main thread.
    receiver: Arc<Receiver<(Chunk, Vec<VoxelUpdate>)>>,

}

impl Pipeline {
    #[inline]
    fn remove_queued_chunk(&mut self, coords: &Vec2<i32>) {
        if self.queue.is_empty() {
            return;
        }
        if self.queue.front().is_some_and(|front| front == coords) {
            self.queue.pop_front();
            return;
        }
        if self.queue.back().is_some_and(|back| back == coords) {
            self.queue.pop_back();
            return;
        }
        if let Some(index) = self.queue.iter().position(|c| c == coords) {
            self.queue.remove(index);
        }
    }

    /// Create a new chunk pipeline.
    pub fn new() -> Self {
        let (sender, receiver) = unbounded();

        Self {
            sender: Arc::new(sender),
            receiver: Arc::new(receiver),
            chunks: HashSet::new(),
            leftovers: HashMap::new(),
            pending_regenerate: HashSet::new(),
            queue: VecDeque::new(),
            stages: Vec::new(),
        }
    }

    pub fn mark_for_regenerate(&mut self, coords: &Vec2<i32>) {
        if self.chunks.contains(coords) {
            self.pending_regenerate.insert(*coords);
        }
    }

    pub fn drain_pending_regenerate(&mut self) -> Vec<Vec2<i32>> {
        let pending_len = self.pending_regenerate.len();
        if pending_len == 0 {
            return Vec::new();
        }
        if pending_len == 1 {
            let Some(coords) = self.pending_regenerate.iter().next().copied() else {
                return Vec::new();
            };
            self.pending_regenerate.clear();
            return vec![coords];
        }

        let mut drained = Vec::with_capacity(pending_len);
        drained.extend(self.pending_regenerate.drain());
        drained
    }

    /// Add a chunk coordinate to the pipeline to be processed.
    pub fn add_chunk(&mut self, coords: &Vec2<i32>, prioritized: bool) {
        if self.has_chunk(coords) {
            self.mark_for_regenerate(coords);
            return;
        }
        if self.queue.is_empty() {
            if prioritized {
                self.queue.push_front(*coords);
            } else {
                self.queue.push_back(*coords);
            }
            return;
        }
        if prioritized {
            if self.queue.front().is_some_and(|front| front == coords) {
                return;
            }
        } else if self.queue.back().is_some_and(|back| back == coords) {
            return;
        }

        self.remove_queued_chunk(coords);

        if prioritized {
            self.queue.push_front(*coords);
        } else {
            self.queue.push_back(*coords);
        }
    }

    /// Remove a chunk coordinate from the pipeline.
    pub fn remove_chunk(&mut self, coords: &Vec2<i32>) {
        self.chunks.remove(coords);
        self.remove_queued_chunk(coords);
    }

    /// Remove a chunk coordinate from tracking set only.
    #[inline]
    pub fn remove_chunk_tracking(&mut self, coords: &Vec2<i32>) {
        self.chunks.remove(coords);
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
        if processes.is_empty() {
            return;
        }
        let mut processes_with_stages: Vec<(Chunk, Option<Space>, Arc<dyn ChunkStage + Send + Sync>)> =
            Vec::with_capacity(processes.len());
        for (chunk, space) in processes {
            let index = if let ChunkStatus::Generating(index) = chunk.status {
                index
            } else {
                warn!(
                    "Skipping pipeline chunk {:?} without generating status",
                    chunk.coords
                );
                continue;
            };
            let Some(stage) = self.stages.get(index).cloned() else {
                warn!(
                    "Skipping pipeline chunk {:?} with missing stage index {}",
                    chunk.coords, index
                );
                continue;
            };
            self.chunks.insert(chunk.coords);
            processes_with_stages.push((chunk, space, stage));
        }
        if processes_with_stages.is_empty() {
            return;
        }

        let sender = Arc::clone(&self.sender);
        let registry = Arc::new(registry.to_owned());
        let config = Arc::new(config.to_owned());
        if processes_with_stages.len() == 1 {
            let Some((chunk, space, stage)) = processes_with_stages.pop() else {
                return;
            };
            rayon::spawn(move || {
                let mut chunk = stage.process(
                    chunk,
                    Resources {
                        registry: &registry,
                        config: &config,
                    },
                    space,
                );
                chunk.calculate_max_height(&registry);
                let changes = std::mem::take(&mut chunk.extra_changes);
                let _ = sender.send((chunk, changes));
            });
            return;
        }

        rayon::spawn(move || {
            processes_with_stages
                .into_par_iter()
                .for_each(|(chunk, space, stage)| {
                    let mut chunk = stage.process(
                        chunk,
                        Resources {
                            registry: &registry,
                            config: &config,
                        },
                        space,
                    );

                    // Calculate the max height after processing each chunk.
                    chunk.calculate_max_height(&registry);

                    let changes = std::mem::take(&mut chunk.extra_changes);

                    let _ = sender.send((chunk, changes));
                });
        });
    }

    /// Attempt to retrieve the results from `pipeline.process`
    pub fn results(&mut self) -> Vec<(Chunk, Vec<VoxelUpdate>)> {
        if self.chunks.is_empty() {
            while self.receiver.try_recv().is_ok() {}
            return Vec::new();
        }
        let first_result = match self.receiver.try_recv() {
            Ok(result) => result,
            Err(_) => return Vec::new(),
        };
        if self.chunks.remove(&first_result.0.coords) {
            let remaining_results = self.receiver.len();
            let mut results = Vec::with_capacity(
                (remaining_results + 1).min(self.chunks.len().saturating_add(1)),
            );
            results.push(first_result);
            while let Ok(result) = self.receiver.try_recv() {
                if self.chunks.remove(&result.0.coords) {
                    results.push(result);
                }
            }
            return results;
        }
        let mut results = Vec::with_capacity(self.receiver.len().min(self.chunks.len()));

        while let Ok(result) = self.receiver.try_recv() {
            if self.chunks.remove(&result.0.coords) {
                results.push(result);
            }
        }

        results
    }

    /// Merge consecutive chunk stages that don't require spaces together into meta stages.
    pub(crate) fn merge_stages(&mut self) {
        let stages = std::mem::take(&mut self.stages);
        let mut new_stages: Vec<Arc<dyn ChunkStage + Send + Sync>> =
            Vec::with_capacity(stages.len());

        let mut current_meta: Option<MetaStage> = None;

        for stage in stages.into_iter() {
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
mod tests {
    use hashbrown::HashSet;

    use crate::Vec2;

    use super::Pipeline;
    use super::{clamped_flatland_top_height, FlatlandStage};

    #[test]
    fn add_soiling_saturates_top_height_on_overflow() {
        let stage = FlatlandStage {
            top_height: u32::MAX - 1,
            soiling: Vec::new(),
        }
        .add_soiling(3, 4);

        assert_eq!(stage.top_height, u32::MAX);
        assert_eq!(stage.soiling.len(), 4);
    }

    #[test]
    fn add_soiling_appends_requested_soiling_values() {
        let stage = FlatlandStage::new().add_soiling(7, 3);
        assert_eq!(stage.top_height, 3);
        assert_eq!(stage.soiling, vec![7, 7, 7]);
    }

    #[test]
    fn clamped_flatland_top_height_limits_to_chunk_height() {
        assert_eq!(clamped_flatland_top_height(u32::MAX, 16), 16);
        assert_eq!(clamped_flatland_top_height(12, 8), 8);
    }

    #[test]
    fn clamped_flatland_top_height_handles_non_positive_chunk_ceiling() {
        assert_eq!(clamped_flatland_top_height(12, 0), 0);
        assert_eq!(clamped_flatland_top_height(12, -8), 0);
    }

    #[test]
    fn drain_pending_regenerate_single_entry_clears_set() {
        let mut pipeline = Pipeline::new();
        let coords = Vec2(9, -3);
        pipeline.pending_regenerate.insert(coords);

        assert_eq!(pipeline.drain_pending_regenerate(), vec![coords]);
        assert!(pipeline.pending_regenerate.is_empty());
    }

    #[test]
    fn drain_pending_regenerate_collects_multiple_entries() {
        let mut pipeline = Pipeline::new();
        let first = Vec2(1, 4);
        let second = Vec2(-2, 8);
        pipeline.pending_regenerate.insert(first);
        pipeline.pending_regenerate.insert(second);

        let drained: HashSet<_> = pipeline.drain_pending_regenerate().into_iter().collect();
        let expected: HashSet<_> = [first, second].into_iter().collect();
        assert_eq!(drained, expected);
        assert!(pipeline.pending_regenerate.is_empty());
    }
}
