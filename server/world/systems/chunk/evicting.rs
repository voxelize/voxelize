//! Letting go of chunks nobody is near. A client drops a chunk that falls out
//! of its range and tells the server, which forgets that client's interest;
//! before this sweep the chunk itself stayed resident for the life of the
//! world, and a straight flight grew the core by about a gigabyte a minute.
//!
//! A chunk is evicted once it has gone `chunk_eviction_idle_ms` with no client
//! interest within [`keep_radius`] chunks of it and nothing queued, running or
//! waiting that names it. What a revisit finds is what a restart would: the
//! save if there is one, the generator's output otherwise. An edit not yet on
//! disk is saved first, and the chunk waits until the background saver reports
//! those exact bytes landed; with saving off, an edited chunk stays.
//!
//! `max_resident_chunks` is the backstop: past it, idle chunks go oldest first
//! without waiting out the idle time.

use std::time::{Duration, Instant};

use hashbrown::{HashMap, HashSet};
use log::info;

use crate::{
    ChunkInterests, ChunkStatus, ChunkUtils, Chunks, Mesher, Pipeline, Vec2, Vec3, WorldConfig,
};

/// How often the sweep runs. Eviction is a memory concern, never a frame one.
const SWEEP_INTERVAL: Duration = Duration::from_secs(1);

/// How often a world that is evicting says so in the log.
const REPORT_INTERVAL: Duration = Duration::from_secs(30);

/// At most this many chunks are dropped in one sweep (about 256 MB), so a
/// world that crosses its cap, or wakes after a long flight, frees memory
/// over a few seconds instead of in one long tick.
const MAX_EVICTIONS_PER_SWEEP: usize = 512;

/// What the last sweep saw, and how many chunks have gone since the start.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ChunkEvictionStats {
    /// Chunks resident after the last sweep.
    pub resident: usize,
    /// Chunks evicted since the world started.
    pub evicted: u64,
    /// Unwanted chunks kept because work in flight still names them.
    pub busy: usize,
    /// Unwanted edited chunks kept until their save is confirmed on disk.
    pub awaiting_save: usize,
    /// Unwanted edited chunks kept for good because the world does not save.
    pub unsaved: usize,
}

/// The sweep's memory between ticks: since when each resident chunk has had
/// nobody near it.
#[derive(Default)]
pub struct ChunkEviction {
    unwanted_since: HashMap<Vec2<i32>, Instant>,
    last_sweep: Option<Instant>,
    last_report: Option<(Instant, u64)>,
    pub stats: ChunkEvictionStats,
}

/// How far from a chunk a client's interest still keeps it: twice the light
/// ring. A chunk a client sees needs its ring resident to relight and remesh,
/// and an edit in that ring relights a ring of its own.
pub fn keep_radius(config: &WorldConfig) -> i32 {
    let ring = (config.max_light_level as f32 / config.chunk_size as f32).ceil() as i32;
    (2 * ring).max(1)
}

impl ChunkEviction {
    /// Run the sweep if a second has passed since the last one.
    pub fn sweep(
        &mut self,
        now: Instant,
        config: &WorldConfig,
        chunks: &mut Chunks,
        interests: &ChunkInterests,
        pipeline: &mut Pipeline,
        mesher: &mut Mesher,
    ) {
        if config.chunk_eviction_idle_ms == 0 && config.max_resident_chunks == 0 {
            return;
        }
        if self
            .last_sweep
            .is_some_and(|last| now.duration_since(last) < SWEEP_INTERVAL)
        {
            return;
        }
        self.last_sweep = Some(now);

        let keep = keep_radius(config);
        let ring = (config.max_light_level as f32 / config.chunk_size as f32).ceil() as i32;
        let preload = config
            .preload
            .then(|| config.preload_radius as i32 + ring);

        let mut unwanted = Vec::new();
        for coords in chunks.map.keys() {
            let is_preloaded =
                preload.is_some_and(|radius| coords.0.abs() <= radius && coords.1.abs() <= radius);
            if is_preloaded || interests.has_interests_within(coords, keep) {
                continue;
            }
            let since = *self.unwanted_since.entry(coords.to_owned()).or_insert(now);
            unwanted.push((coords.to_owned(), since));
        }
        let unwanted_set: HashSet<Vec2<i32>> = unwanted.iter().map(|(c, _)| c.clone()).collect();
        self.unwanted_since.retain(|coords, _| unwanted_set.contains(coords));

        // Oldest first, so the cap lets go of what has been idle longest.
        unwanted.sort_by_key(|(_, since)| *since);
        let idle = Duration::from_millis(config.chunk_eviction_idle_ms);
        let expired = if config.chunk_eviction_idle_ms == 0 {
            0
        } else {
            unwanted
                .iter()
                .take_while(|(_, since)| now.duration_since(*since) >= idle)
                .count()
        };
        let over_cap = if config.max_resident_chunks == 0 {
            0
        } else {
            chunks.map.len().saturating_sub(config.max_resident_chunks)
        };
        let due = expired.max(over_cap.min(unwanted.len()));

        self.stats.busy = 0;
        self.stats.awaiting_save = 0;
        self.stats.unsaved = 0;

        if due > 0 {
            let busy = busy_coords(config, chunks, pipeline, mesher);
            let mut evicted = 0usize;
            for (coords, _) in unwanted.into_iter().take(due) {
                if evicted >= MAX_EVICTIONS_PER_SWEEP {
                    break;
                }
                if busy.contains(&coords)
                    || pipeline.is_carrying(&coords)
                    || mesher.is_carrying(&coords)
                    || chunks.activation.is_tracking(&coords)
                {
                    self.stats.busy += 1;
                    continue;
                }
                let Some(status) = chunks.raw(&coords).map(|chunk| chunk.status.clone()) else {
                    continue;
                };
                // Only a ready chunk can hold an edit: writes to one that is
                // not ready wait parked (counted busy above). What a chunk
                // still generating holds is the generator's, and the
                // leftovers it took in are still parked for it.
                let is_ready = status == ChunkStatus::Ready;
                if is_ready && !chunks.is_persisted(&coords) {
                    if config.saving {
                        chunks.add_chunk_to_save(&coords, false);
                        self.stats.awaiting_save += 1;
                    } else {
                        self.stats.unsaved += 1;
                    }
                    continue;
                }

                let stages_run = match status {
                    ChunkStatus::Generating(stage) => stage,
                    ChunkStatus::Meshing | ChunkStatus::Ready => pipeline.stages.len(),
                };
                let is_regenerated = !chunks.test_load(&coords);
                chunks.evict(&coords);
                pipeline.forget_evicted(&coords, stages_run, is_regenerated);
                mesher.forget_evicted(&coords);
                self.unwanted_since.remove(&coords);
                evicted += 1;
            }
            self.stats.evicted += evicted as u64;
        }
        self.stats.resident = chunks.map.len();

        self.report(now);
    }

    fn report(&mut self, now: Instant) {
        let (since, evicted_then) = *self.last_report.get_or_insert((now, self.stats.evicted));
        if now.duration_since(since) < REPORT_INTERVAL {
            return;
        }
        self.last_report = Some((now, self.stats.evicted));
        let ChunkEvictionStats {
            resident,
            evicted,
            busy,
            awaiting_save,
            unsaved,
        } = self.stats;
        if evicted == evicted_then && awaiting_save == 0 && unsaved == 0 {
            return;
        }
        info!(
            "[chunk-eviction] {resident} resident, {} evicted in the last {}s ({evicted} since start); \
             idle but kept: {busy} busy, {awaiting_save} saving first, {unsaved} edited with saving off",
            evicted - evicted_then,
            REPORT_INTERVAL.as_secs(),
        );
    }
}

/// Every chunk that queued, running or waiting work names, plus the light
/// footprint of any voxel with a write or a wake pending: evicting one of
/// those would park the write, or drop it, until the chunk came back.
fn busy_coords(
    config: &WorldConfig,
    chunks: &Chunks,
    pipeline: &Pipeline,
    mesher: &Mesher,
) -> HashSet<Vec2<i32>> {
    let size = config.chunk_size;
    let to_chunk = |v: &Vec3<i32>| ChunkUtils::map_voxel_to_chunk(v.0, v.1, v.2, size);

    let mut footprints: HashSet<Vec2<i32>> = HashSet::new();
    footprints.extend(chunks.updates.iter().map(|(v, _)| to_chunk(v)));
    footprints.extend(chunks.active_updates.iter().map(|(v, _)| to_chunk(v)));
    footprints.extend(chunks.updates_staging.keys().map(to_chunk));
    footprints.extend(chunks.active_updates_staging.keys().map(to_chunk));
    footprints.extend(chunks.active_voxel_set.keys().map(to_chunk));
    footprints.extend(chunks.overdue_active_voxels.iter().map(to_chunk));
    footprints.extend(chunks.handed_wakes.iter().map(to_chunk));
    footprints.extend(chunks.ticker_consults.iter().map(to_chunk));
    footprints.extend(chunks.parked_updates.keys().cloned());

    let mut busy = HashSet::new();
    for coords in &footprints {
        busy.extend(chunks.light_traversed_chunks(coords));
    }
    busy.extend(pipeline.queue.iter().cloned());
    busy.extend(mesher.queue.iter().cloned());
    for (coords, listeners) in &chunks.listeners {
        busy.insert(coords.to_owned());
        busy.extend(listeners.iter().cloned());
    }
    busy.extend(chunks.to_send.iter().map(|(coords, _)| coords.to_owned()));
    busy.extend(chunks.to_save.iter().map(|pending| pending.coords.to_owned()));
    busy.extend(chunks.saves_in_flight.keys().cloned());
    busy
}
