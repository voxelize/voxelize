use hashbrown::HashMap;
use log::info;
use nanoid::nanoid;
use rayon::iter::{IntoParallelIterator, ParallelIterator};
use specs::{Entities, LazyUpdate, ReadExpect, ReadStorage, System, WriteExpect};

use crate::world::profiler::Profiler;
use crate::{
    BlockUtils, Chunk, ChunkInterests, ChunkOptions, ChunkRenewal, ChunkRequestsComp, ChunkStatus,
    ChunkUtils, Chunks, Clients, CurrentChunkComp, ETypeComp, EntityFlag, IDComp, JsonComp, Mesher,
    MessageType, MetadataComp, Pipeline, PositionComp, Registry, Resources, Stats, Vec2, Vec3,
    VoxelAccess, VoxelComp, WorldConfig,
};
use crate::{perf_toggle, run_on_tick_pool, tick_split, PerfToggle};

/// Saved-chunk loads split across the tick pool from this many per tick. One
/// load reads, parses and inflates a chunk file (milliseconds), so two
/// already pay for the handoff.
const SPLIT_MIN_LOADS: usize = 2;

#[derive(Default)]
pub struct ChunkGeneratingSystem;

impl<'a> System<'a> for ChunkGeneratingSystem {
    type SystemData = (
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, Registry>,
        ReadExpect<'a, Clients>,
        ReadExpect<'a, Stats>,
        WriteExpect<'a, Chunks>,
        WriteExpect<'a, ChunkInterests>,
        WriteExpect<'a, Pipeline>,
        WriteExpect<'a, Mesher>,
        WriteExpect<'a, Profiler>,
        ReadStorage<'a, ChunkRequestsComp>,
        Entities<'a>,
        ReadExpect<'a, LazyUpdate>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (
            config,
            registry,
            clients,
            stats,
            mut chunks,
            mut interests,
            mut pipeline,
            mut mesher,
            mut profiler,
            requests,
            entities,
            lazy,
        ) = data;

        let chunk_size = config.chunk_size;

        /* -------------------------------------------------------------------------- */
        /*                     RECALCULATE CHUNK INTEREST WEIGHTS                     */
        /* -------------------------------------------------------------------------- */

        interests.weights.clear();

        let mut weights = HashMap::with_capacity(interests.map.len());

        for (coords, ids) in &interests.map {
            let mut weight = 0.0;

            for id in ids {
                if let Some(client) = clients.get(id) {
                    if let Some(request) = requests.get(client.entity) {
                        let dist = ChunkUtils::distance_squared(&request.center, &coords);
                        let direction_to_chunk =
                            Vec2(coords.0 - request.center.0, coords.1 - request.center.1);
                        let mag = (direction_to_chunk.0.pow(2) as f32
                            + direction_to_chunk.1.pow(2) as f32)
                            .sqrt();
                        let normalized_direction_to_chunk = Vec2(
                            direction_to_chunk.0 as f32 / mag,
                            direction_to_chunk.1 as f32 / mag,
                        );
                        let dot_product = request.direction.0 * normalized_direction_to_chunk.0
                            + request.direction.1 * normalized_direction_to_chunk.1;
                        weight += dist * dot_product.max(0.0);
                    }
                }
            }

            weights.insert(coords.clone(), weight);
        }

        interests.weights = weights;

        /* -------------------------------------------------------------------------- */
        /*                          HANDLING PIPELINE RESULTS                         */
        /* -------------------------------------------------------------------------- */

        for (mut chunk, extra_changes) in pipeline.results() {
            for (voxel, id) in extra_changes {
                let coords = ChunkUtils::map_voxel_to_chunk(voxel.0, voxel.1, voxel.2, chunk_size);

                if chunks.is_chunk_ready(&coords) {
                    chunks.update_voxel(&voxel, id);
                } else {
                    pipeline
                        .leftovers
                        .entry(coords)
                        .or_default()
                        .push((voxel, id));
                }
            }

            if let ChunkStatus::Generating(curr_stage) = chunk.status {
                let next_stage = curr_stage + 1;

                if next_stage >= pipeline.stages.len() {
                    chunk.status = ChunkStatus::Meshing;
                    // Light is flooded in the mesher, so a chunk something is
                    // waiting on (a request, preload, a lone generation call)
                    // must enter it to reach `Ready`. A chunk generated only
                    // as context for a neighbor parks here instead: meshing
                    // it would send it into the drain below, whose neighbor
                    // pull conscripts *its* ring in turn — the expansion that
                    // filled whole worlds from a single request. Parking is
                    // not dropping: demand is sticky and this decision is a
                    // pure read, so `ChunkRequestsSystem` revives a parked
                    // chunk whenever anything asks, however many times.
                    let is_parked = !pipeline.is_demanded(&chunk.coords)
                        && !interests.has_interests(&chunk.coords);
                    if !is_parked {
                        mesher.add_chunk(&chunk.coords, false);
                    }
                    pipeline.remove_chunk(&chunk.coords);
                } else {
                    chunk.status = ChunkStatus::Generating(next_stage);
                    pipeline.requeue_chunk(&chunk.coords, false);
                }

                if let Some(listeners) = chunks.listeners.remove(&chunk.coords) {
                    for n_coords in listeners {
                        if !chunks.map.contains_key(&n_coords)
                            || matches!(
                                chunks.raw(&n_coords).unwrap().status,
                                ChunkStatus::Generating(_)
                            )
                        {
                            pipeline.requeue_chunk(&n_coords, true);
                        } else if let Some(chunk) = chunks.raw(&n_coords) {
                            if matches!(chunk.status, ChunkStatus::Meshing) {
                                mesher.add_chunk(&n_coords, true);
                            }
                        }
                    }
                }

                chunks.renew(chunk, ChunkRenewal::Full);
            }
        }

        // Demand that arrived while these were mid-flight already promoted
        // them in `add_chunk`; the re-add itself expresses nothing new.
        for coords in pipeline.drain_pending_regenerate() {
            pipeline.requeue_chunk(&coords, true);
        }

        /* -------------------------------------------------------------------------- */
        /*                       PUSHING CHUNKS TO BE PROCESSED                       */
        /* -------------------------------------------------------------------------- */

        let mut processes = vec![];

        if !pipeline.queue.is_empty() {
            pipeline
                .queue
                .make_contiguous()
                .sort_by(|a, b| interests.compare(a, b));
        }

        let mut to_load = vec![];
        while !pipeline.queue.is_empty() && !pipeline.stages.is_empty() {
            let coords = pipeline.get().unwrap();
            let chunk = chunks.raw(&coords);

            if chunk.is_none() {
                let can_load = chunks.test_load(&coords);
                if can_load {
                    // Load first; only queue meshing after a successful renew below.
                    // Queuing mesher here left ghost entries when the save was corrupt.
                    pipeline.remove_chunk(&coords);
                    to_load.push(coords);
                    continue;
                }

                let new_chunk = Chunk::new(
                    &nanoid!(),
                    coords.0,
                    coords.1,
                    &ChunkOptions {
                        max_height: config.max_height,
                        sub_chunks: config.sub_chunks,
                        size: config.chunk_size,
                    },
                );

                chunks.freshly_created.insert(coords.to_owned());
                chunks.renew(new_chunk, ChunkRenewal::Full);
            }

            let chunk = chunks.raw(&coords).unwrap();

            if !matches!(chunk.status, ChunkStatus::Generating(_)) {
                pipeline.remove_chunk(&coords);
                continue;
            }

            let chunk = chunk.clone();
            let index = if let ChunkStatus::Generating(index) = chunk.status {
                index
            } else {
                unreachable!()
            };
            let stage = pipeline.stages[index].clone();
            let margin = stage.neighbors(&config);

            if margin > 0 {
                let r = (margin as f32 / chunk_size as f32).ceil() as i32;
                let mut ready = true;

                'outer: for x in -r..=r {
                    for z in -r..=r {
                        if (x == 0 && z == 0) || (x * x + z * z > r * r) {
                            continue;
                        }

                        let n_coords = Vec2(coords.0 + x, coords.1 + z);

                        if !chunks.is_within_world(&n_coords) || chunks.is_chunk_ready(&n_coords) {
                            continue;
                        }

                        match chunks.raw(&n_coords).map(|neighbor| &neighbor.status) {
                            // A chunk parked in `Meshing` has run every stage,
                            // and no further stage-finish will ever fire its
                            // listeners — treating it as pending would wait on
                            // it forever.
                            Some(ChunkStatus::Meshing) | Some(ChunkStatus::Ready) => continue,
                            Some(ChunkStatus::Generating(n_stage)) if *n_stage >= index => continue,
                            Some(ChunkStatus::Generating(_)) => {}
                            // The margin neighbor exists nowhere and nothing
                            // else will create it: queue it for its voxel data
                            // only. Each context ring needs one stage less
                            // than the ring that demanded it, so the chain
                            // dies out after the margin stages instead of
                            // sweeping the world.
                            None => pipeline.add_context_chunk(&n_coords),
                        }

                        chunks.add_listener(&n_coords, &coords);
                        ready = false;
                        break 'outer;
                    }
                }

                if !ready {
                    continue;
                }
            }

            if let Some(data) = stage.needs_space() {
                let mut space = chunks.make_space(&chunk.coords, margin);

                if data.needs_voxels {
                    space = space.needs_voxels();
                }

                if data.needs_lights {
                    space = space.needs_lights();
                }

                if data.needs_height_maps {
                    space = space.needs_height_maps();
                }

                let space = space.build();
                processes.push((chunk, Some(space)));
            } else {
                processes.push((chunk, None));
            }
        }

        // Loads split across the tick pool when there are several, and run
        // inline otherwise. Never on the global pool, where the tick waited
        // behind worldgen.
        let restore_stages = pipeline.stages.clone();
        let load_one = |coords: Vec2<i32>| -> (Vec2<i32>, Option<Chunk>) {
            let loaded = chunks.try_load(&coords, &registry).map(|mut chunk| {
                for stage in &restore_stages {
                    chunk = stage.restore(
                        chunk,
                        Resources {
                            registry: &registry,
                            config: &config,
                        },
                    );
                }
                chunk
            });
            (coords, loaded)
        };
        let loaded_chunks: Vec<(Vec2<i32>, Option<Chunk>)> =
            if tick_split(to_load.len(), SPLIT_MIN_LOADS) {
                let loads = to_load.into_par_iter().map(&load_one);
                run_on_tick_pool(move || loads.collect())
            } else {
                to_load.into_iter().map(&load_one).collect()
            };

        for (coords, loaded_chunk) in loaded_chunks.into_iter() {
            if let Some(chunk) = loaded_chunk {
                chunks.renew(chunk, ChunkRenewal::Full);
                // A save loaded only as context serves its purpose by
                // existing (voxel data for a neighbor); meshing it would pull
                // its own ring off disk in turn, sweeping whole saved regions
                // into memory. Parked loads revive on demand exactly like
                // parked generations.
                let is_parked = !pipeline.is_demanded(&coords) && !interests.has_interests(&coords);
                if !is_parked {
                    mesher.add_chunk(&coords, false);
                }
            } else {
                // Corrupt/empty save was removed by try_load; regenerate via pipeline.
                pipeline.requeue_chunk(&coords, false);
            }
        }

        if !processes.is_empty() {
            pipeline.process(processes, &registry, &config);
        }

        /* -------------------------------------------------------------------------- */
        /*                          HANDLING MESHING RESULTS                          */
        /* -------------------------------------------------------------------------- */

        let mesher_results = mesher.results();

        for (mut chunk, r#type) in mesher_results {
            if r#type == MessageType::Load {
                if let Some(listeners) = chunks.listeners.remove(&chunk.coords) {
                    for n_coords in listeners {
                        if !chunks.map.contains_key(&n_coords)
                            || matches!(
                                chunks.raw(&n_coords).unwrap().status,
                                ChunkStatus::Generating(_)
                            )
                        {
                            pipeline.requeue_chunk(&n_coords, true);
                        } else if let Some(chunk) = chunks.raw(&n_coords) {
                            if matches!(chunk.status, ChunkStatus::Meshing) {
                                mesher.add_chunk(&n_coords, true);
                            }
                        }
                    }
                }
            }

            chunk.status = ChunkStatus::Ready;
            let coords = chunk.coords.to_owned();
            let is_updating = r#type == MessageType::Update;

            // The campaign delivered; a later regenerate pass starts clean
            // and parks again unless somebody asks again.
            pipeline.clear_demand(&coords);

            let is_freshly_generated =
                r#type == MessageType::Load && chunks.freshly_created.remove(&coords);

            if is_freshly_generated {
                // Duplicated onto the live chunk after the renew below —
                // this copy only matters when no live chunk exists and the
                // result is inserted whole.
                chunk.is_save_dirty = false;

                // A chunk still meshing cannot be read back, so the save has to
                // be queued here, where the chunk is genuinely done.
                if config.save_pristine_chunks {
                    chunks.add_chunk_to_save(&coords, false);
                }
            }

            chunks.add_chunk_to_send(&coords, &r#type, false);

            // An Update remesh was fed by lights the updating pass already
            // flooded into the live chunk, so only its meshes are newer. A
            // Load mesh computed the flood itself, so its lights are the
            // authoritative ones — but its voxels are a clone from dispatch
            // time, and edits landed since must survive it.
            chunks.renew(
                chunk,
                if is_updating {
                    ChunkRenewal::MeshOnly
                } else {
                    ChunkRenewal::MeshAndLights
                },
            );

            if is_freshly_generated {
                // The end of worldgen re-establishes the persisted form: the
                // pipeline's writes are seed-reproducible output, not edits,
                // so `save_pristine_chunks` alone decides whether this chunk
                // goes to disk. This lands on the live chunk (the renew above
                // keeps live voxels and bookkeeping), and any edit that raced
                // the mesh already queued its own save with the live voxels.
                if let Some(live) = chunks.map.get_mut(&coords) {
                    live.is_save_dirty = false;
                }
                seed_generated_entities(&mut chunks, &coords, &registry, &entities, &lazy);
            }
        }

        let pending_remesh_coords = mesher.drain_pending_remesh();
        if !pending_remesh_coords.is_empty() {
            // As in chunk-updating: under client-only meshing a remesh job
            // changes nothing but the send delay, so the chunk is sent now.
            let is_sending_directly =
                config.client_only_meshing && perf_toggle(PerfToggle::SkipNoopRemesh);
            let mut remesh_processes = Vec::new();
            for coords in pending_remesh_coords {
                if !chunks.is_chunk_ready(&coords) {
                    continue;
                }
                if mesher.has_chunk(&coords) {
                    mesher.mark_for_remesh(&coords);
                    continue;
                }
                if is_sending_directly {
                    if chunks.is_chunk_save_dirty(&coords) {
                        chunks.add_chunk_to_save(&coords, true);
                    }
                    chunks.add_chunk_to_send(&coords, &MessageType::Update, false);
                    continue;
                }
                let space = chunks
                    .make_space(&coords, config.max_light_level as usize)
                    .needs_height_maps()
                    .needs_voxels()
                    .needs_lights()
                    .build();
                let chunk = chunks.raw(&coords).unwrap().to_owned();
                if chunks.is_chunk_save_dirty(&coords) {
                    chunks.add_chunk_to_save(&coords, true);
                }
                remesh_processes.push((chunk, space));
            }
            if !remesh_processes.is_empty() {
                mesher.process(remesh_processes, &MessageType::Update, &registry, &config);
            }
        }

        /* -------------------------------------------------------------------------- */
        /*                         PUSHING CHUNKS TO BE MESHED                        */
        /* -------------------------------------------------------------------------- */

        if !mesher.queue.is_empty() {
            mesher
                .queue
                .make_contiguous()
                .sort_by(|a, b| interests.compare(a, b));
        }

        let mut ready_chunks = vec![];
        // Chunks whose light-traversal neighborhood is not created yet
        // cannot register a status listener (there is no chunk entry to
        // listen to), so they must go back on the queue — dropping them
        // here strands them in `Meshing` forever and the requesting
        // client never receives them. Collected outside the drain loop
        // so a retry cannot spin within one tick.
        let mut retry_chunks = vec![];

        while !mesher.queue.is_empty() {
            let coords = mesher.get().unwrap();
            let mut ready = true;

            for (i, n_coords) in chunks
                .light_traversed_chunks(&coords)
                .into_iter()
                .enumerate()
            {
                if !chunks.map.contains_key(&n_coords) {
                    // Lighting this chunk needs the neighbor to exist with
                    // voxel data, not to be lit or meshed itself — so it is
                    // queued as context, never as a first-class chunk. When
                    // it was queued as demand here, every meshed chunk
                    // conscripted a fresh ring, and one request generated the
                    // world to its bounds (out-of-world neighbors can never
                    // exist, so they are not queued at all).
                    if chunks.is_within_world(&n_coords) {
                        pipeline.add_context_chunk(&n_coords);
                    }
                    retry_chunks.push(coords.clone());
                    ready = false;
                    break;
                }

                if let Some(n_chunk) = chunks.raw(&n_coords) {
                    if matches!(n_chunk.status, ChunkStatus::Generating(_)) {
                        ready = false;
                        chunks.add_listener(&n_coords, &coords);
                        break;
                    }
                }

                if let Some(blocks) = pipeline.leftovers.get(&n_coords) {
                    for (j, (voxel, val)) in blocks.iter().enumerate() {
                        let Vec3(vx, vy, vz) = *voxel;
                        chunks.set_raw_voxel(vx, vy, vz, *val);

                        let height = chunks.get_max_height(vx, vz);
                        let id = BlockUtils::extract_id(*val);

                        if registry.is_air(id) {
                            if vy == height as i32 {
                                for y in (0..vy - 1).rev() {
                                    if y == 0 || registry.check_height(chunks.get_voxel(vx, y, vz))
                                    {
                                        chunks.set_max_height(vx, vz, y as u32);
                                        break;
                                    }
                                }
                            }
                        } else if height < vy as u32 {
                            chunks.set_max_height(vx, vz, vy as u32);
                        }
                    }
                }
            }

            if !ready {
                continue;
            }

            pipeline.leftovers.remove(&coords);

            let chunk = chunks.raw(&coords).unwrap().clone();
            ready_chunks.push((coords, chunk));
        }

        for coords in retry_chunks {
            mesher.add_chunk(&coords, false);
        }

        // Process the ready chunks in parallel
        if !ready_chunks.is_empty() {
            let len = ready_chunks.len();
            let processes = ready_chunks
                .into_iter()
                .map(|(coords, chunk)| {
                    let mut space = chunks
                        .make_space(&coords, config.max_light_level as usize)
                        .needs_height_maps()
                        .needs_voxels();

                    if chunk.meshes.is_some() {
                        space = space.needs_lights()
                    }

                    let space = space.strict().build();
                    (chunk, space)
                })
                .collect::<Vec<_>>();

            if !processes.is_empty() {
                mesher.process(processes, &MessageType::Load, &registry, &config);
            }
        }
    }
}

/// Seed once after the final generation stage and initial mesh. A later
/// structure may have replaced a seeded voxel, and a saved (even empty)
/// inventory always wins over the deterministic generation recipe.
fn seed_generated_entities(
    chunks: &mut Chunks,
    coords: &Vec2<i32>,
    registry: &Registry,
    entities: &Entities<'_>,
    lazy: &LazyUpdate,
) {
    let seeds = chunks
        .raw_mut(coords)
        .map(|chunk| std::mem::take(&mut chunk.block_entity_seeds))
        .unwrap_or_default();
    let mut created = false;
    for (voxel, (block_id, json)) in seeds {
        let block = registry.get_block_by_id(block_id);
        if chunks.block_entities.contains_key(&voxel)
            || chunks.get_voxel(voxel.0, voxel.1, voxel.2) != block_id
            || !block.is_entity
        {
            continue;
        }
        if serde_json::from_str::<serde_json::Value>(&json).is_err() {
            log::error!("Invalid generated entity JSON at {:?}", voxel);
            continue;
        }
        let entity = entities.create();
        chunks.block_entities.insert(voxel.clone(), entity);
        lazy.insert(entity, IDComp::new(&nanoid!()));
        lazy.insert(entity, EntityFlag::default());
        lazy.insert(
            entity,
            ETypeComp::new(&format!("block::{}", block.name.to_lowercase()), true),
        );
        lazy.insert(entity, CurrentChunkComp::default());
        lazy.insert(entity, VoxelComp::new(voxel.0, voxel.1, voxel.2));
        // Populate metadata immediately as well as through the normal meta
        // system, so the first save/create packet already contains the loot.
        let mut metadata = MetadataComp::new();
        metadata.set("voxel", &VoxelComp::new(voxel.0, voxel.1, voxel.2));
        metadata.set("json", &JsonComp::new(&json));
        lazy.insert(entity, metadata);
        lazy.insert(entity, JsonComp::new(&json));
        created = true;
    }
    if created {
        // Keep the chest's surrounding generated chunk once its contents
        // become mutable, even when other pristine chunks regenerate.
        chunks.add_chunk_to_save(coords, true);
    }
}

#[cfg(test)]
mod generated_entity_tests {
    use super::*;
    use crate::{Block, ChunkStage, DataSavingSystem, EntitiesMetaSystem, Space, World};
    use specs::{RunNow, WorldExt};
    use std::{
        path::Path,
        time::{Duration, Instant},
    };

    const CHEST: u32 = 8;
    const LOOT: &str = r#"{"type":"chest","slots":[{"type":"block","id":1,"count":3}]}"#;
    const EMPTY: &str = r#"{"type":"chest","slots":[]}"#;
    struct ChestStage;
    impl ChunkStage for ChestStage {
        fn name(&self) -> String {
            "seeded test chest".into()
        }
        fn process(&self, mut c: Chunk, _: Resources, _: Option<Space>) -> Chunk {
            for x in c.min.0..c.max.0 {
                for z in c.min.2..c.max.2 {
                    c.set_voxel(x, 0, z, 1);
                }
            }
            if c.contains(3, 1, 3) {
                c.set_voxel(3, 1, 3, CHEST);
                c.block_entity_seeds
                    .insert(Vec3(3, 1, 3), (CHEST, LOOT.into()));
                // A later feature overwrote this seed; it must not create a
                // floating entity or resurrect its old block.
                c.block_entity_seeds
                    .insert(Vec3(4, 1, 3), (CHEST, LOOT.into()));
            }
            c
        }
    }
    fn wait(world: &mut World, label: &str, condition: impl Fn(&World) -> bool) {
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            world.tick();
            if condition(world) {
                return;
            }
            assert!(Instant::now() < deadline, "{label}");
            std::thread::sleep(Duration::from_millis(2));
        }
    }
    fn open(dir: &Path) -> World {
        let config = WorldConfig::new()
            .min_chunk([-1, -1])
            .max_chunk([1, 1])
            .max_height(32)
            .sub_chunks(1)
            .preload_radius(1)
            .saving(true)
            .save_dir(dir.to_str().unwrap())
            .save_interval(1)
            .save_pristine_chunks(false)
            .build();
        let mut registry = Registry::new();
        registry.register_block(&Block::new("Ground").id(1).build());
        registry.register_block(
            &Block::new("Chest")
                .id(CHEST)
                .is_entity(true)
                .default_entity_json(EMPTY)
                .build(),
        );
        let mut w = World::new("generated-entity-persistence", &config);
        w.ecs_mut().insert(registry);
        w.pipeline_mut().add_stage(ChestStage);
        w.prepare();
        w.preload();
        wait(&mut w, "chest chunk ready", |w| {
            w.chunks().is_chunk_ready(&Vec2(0, 0))
        });
        w
    }
    fn chest_json(w: &World) -> String {
        let entity = w.chunks().block_entities[&Vec3(3, 1, 3)];
        w.ecs()
            .read_storage::<JsonComp>()
            .get(entity)
            .unwrap()
            .0
            .clone()
    }
    #[test]
    fn stage_only_update_preserves_entity_identity_and_contents() {
        let dir = std::env::temp_dir().join(format!("block-state-{}-{:?}",std::process::id(),std::thread::current().id()));
        std::fs::remove_dir_all(&dir).ok();
        let mut w = open(&dir);
        let p = Vec3(3,1,3);
        let entity = w.chunks().block_entities[&p];
        let next = crate::BlockUtils::insert_stage(CHEST,1);
        w.chunks_mut().update_voxel(&p,next);
        wait(&mut w,"stage update committed",|w| w.chunks().get_raw_voxel(3,1,3)==next);
        assert_eq!(w.chunks().block_entities[&p],entity);
        assert_eq!(chest_json(&w),LOOT);
        w.chunks_mut().update_voxel(&p,1);
        wait(&mut w,"replacement removed entity",|w| w.chunks().get_voxel(3,1,3)==1);
        assert!(!w.chunks().block_entities.contains_key(&p));
        drop(w); std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn generated_chest_keeps_taken_loot_across_regeneration_and_restart() {
        let dir = std::env::temp_dir().join(format!(
            "generated-chest-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::remove_dir_all(&dir).ok();
        let mut w = open(&dir);
        assert_eq!(chest_json(&w), LOOT);
        assert!(!w.chunks().block_entities.contains_key(&Vec3(4, 1, 3)));
        assert!(w
            .chunks()
            .raw(&Vec2(0, 0))
            .unwrap()
            .block_entity_seeds
            .is_empty());
        let entity = w.chunks().block_entities[&Vec3(3, 1, 3)];
        let id = w
            .ecs()
            .read_storage::<IDComp>()
            .get(entity)
            .unwrap()
            .0
            .clone();
        w.ecs_mut()
            .write_storage::<JsonComp>()
            .insert(entity, JsonComp::new(EMPTY))
            .unwrap();
        // Replaying a new generation result while the existing inventory is
        // empty must preserve the empty entity, not refill it.
        w.chunks_mut()
            .raw_mut(&Vec2(0, 0))
            .unwrap()
            .block_entity_seeds
            .insert(Vec3(3, 1, 3), (CHEST, LOOT.into()));
        {
            let entities = w.ecs().entities();
            let lazy = w.ecs().read_resource::<LazyUpdate>();
            seed_generated_entities(
                &mut w.ecs().write_resource::<Chunks>(),
                &Vec2(0, 0),
                &w.ecs().read_resource::<Registry>(),
                &entities,
                &lazy,
            );
        }
        w.ecs_mut().maintain();
        assert_eq!(chest_json(&w), EMPTY);
        EntitiesMetaSystem.run_now(w.ecs());
        DataSavingSystem.run_now(w.ecs());
        let file = dir.join("entities").join(format!("block-chest-{id}.json"));
        wait(
            &mut w,
            "empty chest reaches durable native entity save",
            |_| {
                std::fs::read_to_string(&file)
                    .is_ok_and(|s| s.contains("slots") && !s.contains("count"))
            },
        );
        wait(&mut w, "chest terrain reaches native chunk save", |_| {
            dir.join("chunks/0|0.json").exists()
        });
        drop(w);
        let mut w = open(&dir);
        assert_eq!(chest_json(&w), EMPTY);
        assert_eq!(w.chunks().get_voxel(3, 1, 3), CHEST);
        w.chunks_mut().update_voxel(&Vec3(3, 1, 3), 0);
        wait(&mut w, "broken chest is removed", |w| {
            w.chunks().get_voxel(3, 1, 3) == 0
                && !w.chunks().block_entities.contains_key(&Vec3(3, 1, 3))
                && !file.exists()
        });
        wait(&mut w, "broken chest terrain is saved", |w| {
            w.chunks()
                .try_load(&Vec2(0, 0), &w.registry())
                .is_some_and(|c| c.get_voxel(3, 1, 3) == 0)
        });
        drop(w);
        let w = open(&dir);
        assert_eq!(w.chunks().get_voxel(3, 1, 3), 0);
        assert!(!w.chunks().block_entities.contains_key(&Vec3(3, 1, 3)));
        drop(w);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
