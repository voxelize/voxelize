use specs::{ReadExpect, System, WriteExpect};

use crate::{BackgroundChunkSaver, Chunks, WorldConfig};

pub struct ChunkSavingSystem;

impl<'a> System<'a> for ChunkSavingSystem {
    type SystemData = (
        ReadExpect<'a, WorldConfig>,
        WriteExpect<'a, Chunks>,
        ReadExpect<'a, BackgroundChunkSaver>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (config, mut chunks, bg_saver) = data;

        if !config.saving {
            return;
        }

        for save in chunks.take_pending_saves(config.max_saves_per_tick, config.max_save_retries) {
            bg_saver.queue_save(save);
        }
    }
}

/// Chunk persistence driven through a real world: real pipeline, real mesher,
/// real lighting, real background saver, real files on disk.
#[cfg(test)]
mod chunk_persistence_tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant};

    use crate::{
        Block, BlockUtils, Chunk, ChunkStage, ChunkUtils, Registry, Resources, Space, Vec2, Vec3,
        VoxelAccess, World, WorldConfig,
    };

    const AIR_ID: u32 = 0;
    const GROUND_ID: u32 = 1;
    const GROUND_HEIGHT: i32 = 4;
    const ROOF_Y: i32 = 12;
    const WORLD_EDGE: i32 = 1;
    const MAX_PRELOAD_TICKS: usize = 4000;
    /// Long enough for the save queue to drain at `max_saves_per_tick` and for
    /// the background saver to pass its flush interval, so "no further file
    /// appeared" is a real observation rather than a race the test won.
    const SAVE_DRAIN_TICKS: usize = 60;
    /// Preload reporting complete does not mean lighting has settled: chunks
    /// keep relighting for a while afterwards. These bound the wait for light
    /// to stop moving, so the tests compare settled worlds rather than two
    /// arbitrary moments in a still-running relight.
    const MAX_SETTLE_TICKS: usize = 4000;
    const SETTLE_CONFIRM_TICKS: usize = 30;

    /// Flat ground under a roof covering half the world, so sunlight reaches
    /// some columns, is blocked over others, and fades horizontally in between.
    /// A chunk that came back from disk with the wrong light differs here;
    /// under flat open terrain every light value is the same and would not.
    struct ShadedFlatlandStage;

    impl ChunkStage for ShadedFlatlandStage {
        fn name(&self) -> String {
            "Shaded Flatland".to_owned()
        }

        fn process(&self, mut chunk: Chunk, _: Resources, _: Option<Space>) -> Chunk {
            let Vec3(min_x, _, min_z) = chunk.min;
            let Vec3(max_x, _, max_z) = chunk.max;

            for vx in min_x..max_x {
                for vz in min_z..max_z {
                    for vy in 0..GROUND_HEIGHT {
                        chunk.set_voxel(vx, vy, vz, GROUND_ID);
                    }

                    if vz >= 0 {
                        chunk.set_voxel(vx, ROOF_Y, vz, GROUND_ID);
                    }
                }
            }

            chunk
        }
    }

    fn fresh_save_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "voxelize-chunk-persistence-{}-{}-{:?}",
            label,
            std::process::id(),
            std::thread::current().id()
        ));
        fs::remove_dir_all(&dir).ok();
        dir
    }

    fn preloaded_world(dir: Option<&Path>, save_pristine_chunks: bool) -> World {
        let mut builder = WorldConfig::new()
            .min_chunk([-WORLD_EDGE, -WORLD_EDGE])
            .max_chunk([WORLD_EDGE, WORLD_EDGE])
            .chunk_size(16)
            .max_height(32)
            .sub_chunks(1)
            .preload(true)
            .preload_radius(WORLD_EDGE as usize)
            .save_pristine_chunks(save_pristine_chunks);

        if let Some(dir) = dir {
            builder = builder
                .saving(true)
                .save_dir(dir.to_str().expect("utf-8 temp path"));
        }

        let config = builder.build();

        let mut registry = Registry::new();
        registry.register_block(&Block::new("Ground").id(GROUND_ID).build());

        let mut world = World::new("persistence", &config);
        world.ecs_mut().insert(registry);
        world.pipeline_mut().add_stage(ShadedFlatlandStage);
        world.prepare();
        world.preload();

        for _ in 0..MAX_PRELOAD_TICKS {
            world.tick();

            if !world.preloading {
                settle_light(&mut world);
                return world;
            }
        }

        panic!("world never finished preloading");
    }

    fn settle_light(world: &mut World) {
        let mut previous = light_signature(world);
        let mut unchanged = 0;

        for _ in 0..MAX_SETTLE_TICKS {
            world.tick();
            let current = light_signature(world);

            unchanged = if current == previous {
                unchanged + 1
            } else {
                0
            };

            if unchanged >= SETTLE_CONFIRM_TICKS {
                return;
            }

            previous = current;
        }

        panic!("light never stopped changing");
    }

    fn light_signature(world: &World) -> Vec<u32> {
        let chunks = world.chunks();

        all_coords()
            .into_iter()
            .filter_map(|coords| chunks.raw(&coords))
            .flat_map(|chunk| chunk.lights.data.clone())
            .collect()
    }

    fn all_coords() -> Vec<Vec2<i32>> {
        let mut coords = Vec::new();

        for x in -WORLD_EDGE..=WORLD_EDGE {
            for z in -WORLD_EDGE..=WORLD_EDGE {
                coords.push(Vec2(x, z));
            }
        }

        coords
    }

    fn terrain_and_light(world: &World) -> Vec<(Vec2<i32>, Vec<u32>, Vec<u32>)> {
        let chunks = world.chunks();

        all_coords()
            .into_iter()
            .map(|coords| {
                let chunk = chunks
                    .raw(&coords)
                    .unwrap_or_else(|| panic!("chunk {coords:?} should exist after preload"));
                (coords, chunk.voxels.data.clone(), chunk.lights.data.clone())
            })
            .collect()
    }

    fn first_difference(left: &[u32], right: &[u32]) -> Option<(usize, u32, u32)> {
        if left.len() != right.len() {
            return Some((usize::MAX, left.len() as u32, right.len() as u32));
        }

        left.iter()
            .zip(right.iter())
            .enumerate()
            .find(|(_, (a, b))| a != b)
            .map(|(index, (a, b))| (index, *a, *b))
    }

    fn saved_chunk_count(dir: &Path) -> usize {
        let chunk_dir = dir.join("chunks");

        match fs::read_dir(&chunk_dir) {
            Ok(entries) => entries
                .filter_map(|entry| entry.ok())
                .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
                .count(),
            Err(_) => 0,
        }
    }

    fn saved_chunk_coords(dir: &Path) -> Vec<Vec2<i32>> {
        let chunk_dir = dir.join("chunks");

        let Ok(entries) = fs::read_dir(&chunk_dir) else {
            return Vec::new();
        };

        let mut coords: Vec<Vec2<i32>> = entries
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
            .filter_map(|path| {
                path.file_stem()
                    .map(|stem| ChunkUtils::parse_chunk_name(&stem.to_string_lossy()))
            })
            .collect();

        coords.sort_by_key(|coords| (coords.0, coords.1));
        coords
    }

    fn chunk_lights(world: &World, coords: &Vec2<i32>) -> Vec<u32> {
        world
            .chunks()
            .raw(coords)
            .unwrap_or_else(|| panic!("chunk {coords:?} should exist after preload"))
            .lights
            .data
            .clone()
    }

    fn apply_edits(world: &mut World, edits: &[(Vec3<i32>, u32)]) {
        {
            let mut chunks = world.chunks_mut();

            for (voxel, id) in edits {
                chunks.update_voxel(voxel, BlockUtils::insert_id(0, *id));
            }
        }

        settle_light(world);
    }

    fn settle_disk(world: &mut World) {
        for _ in 0..SAVE_DRAIN_TICKS {
            world.tick();
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    fn wait_for_saved_chunks(world: &mut World, dir: &Path, expected: usize) {
        let deadline = Instant::now() + Duration::from_secs(30);

        // The save queue drains at `max_saves_per_tick`, so the world has to
        // keep ticking for queued chunks to reach the background saver.
        while Instant::now() < deadline {
            if saved_chunk_count(dir) >= expected {
                return;
            }

            world.tick();
            std::thread::sleep(Duration::from_millis(5));
        }

        panic!(
            "expected {expected} saved chunks, found {}",
            saved_chunk_count(dir)
        );
    }

    #[test]
    fn a_generated_world_writes_nothing_to_disk_by_default() {
        let dir = fresh_save_dir("pristine");
        let world = preloaded_world(Some(&dir), false);

        assert!(
            world.chunks().to_save.is_empty(),
            "pristine chunks must not be queued at all, so no save can go missing"
        );

        std::thread::sleep(Duration::from_millis(300));

        assert_eq!(
            saved_chunk_count(&dir),
            0,
            "worldgen output is reproducible from the seed and stays off disk"
        );

        drop(world);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn opting_in_persists_generated_chunks_that_reload_with_the_same_terrain_and_light() {
        let dir = fresh_save_dir("opted-in");
        let expected = all_coords().len();

        let mut generated = preloaded_world(Some(&dir), true);
        wait_for_saved_chunks(&mut generated, &dir, expected);
        let before = terrain_and_light(&generated);
        drop(generated);

        let reloaded = preloaded_world(Some(&dir), true);
        let after = terrain_and_light(&reloaded);

        for ((coords, voxels_before, lights_before), (_, voxels_after, lights_after)) in
            before.iter().zip(after.iter())
        {
            assert_eq!(
                voxels_before, voxels_after,
                "chunk {coords:?} came back from disk with different terrain"
            );
            assert_eq!(
                lights_before, lights_after,
                "chunk {coords:?} came back from disk with different light"
            );
        }

        assert!(
            before
                .iter()
                .any(|(_, _, lights)| { lights.iter().any(|light| *light != lights[0]) }),
            "the fixture must produce varying light, or the light comparison proves nothing"
        );

        drop(reloaded);
        fs::remove_dir_all(&dir).ok();
    }

    /// Breaking the roof drops full sunlight down a column that was in shade,
    /// so the re-flood reaches well into the neighbouring chunks and borrows
    /// them mutably. None of their persisted data changes, so none of them may
    /// be written: a save that exists short-circuits worldgen for that chunk
    /// forever, which is how void spawns get manufactured.
    #[test]
    fn a_light_cascade_saves_only_the_chunk_whose_voxels_changed() {
        let dir = fresh_save_dir("light-cascade");
        let mut world = preloaded_world(Some(&dir), false);

        let flooded = Vec2(1, 0);
        let lights_before = chunk_lights(&world, &flooded);

        apply_edits(&mut world, &[(Vec3(8, ROOF_Y, 8), AIR_ID)]);

        assert_ne!(
            chunk_lights(&world, &flooded),
            lights_before,
            "the cascade must cross into {flooded:?}, or this test proves nothing"
        );

        wait_for_saved_chunks(&mut world, &dir, 1);
        settle_disk(&mut world);

        assert_eq!(
            saved_chunk_coords(&dir),
            vec![Vec2(0, 0)],
            "light is never persisted, so a chunk the cascade only lit has nothing to write"
        );

        drop(world);
        fs::remove_dir_all(&dir).ok();
    }

    /// Writing a voxel on a chunk's last column borrows the neighbour so its
    /// mesh can be redrawn, but the voxel itself lives in exactly one chunk.
    /// A fix that keyed off the borrow set, or off `voxel_affected_chunks`,
    /// would write the neighbour here.
    #[test]
    fn a_border_voxel_edit_saves_only_the_chunk_that_holds_the_voxel() {
        let dir = fresh_save_dir("border-voxel");
        let mut world = preloaded_world(Some(&dir), false);

        apply_edits(&mut world, &[(Vec3(15, 5, 8), GROUND_ID)]);
        wait_for_saved_chunks(&mut world, &dir, 1);
        settle_disk(&mut world);

        assert_eq!(
            saved_chunk_coords(&dir),
            vec![Vec2(0, 0)],
            "the neighbour was borrowed for remeshing, not changed"
        );

        drop(world);
        fs::remove_dir_all(&dir).ok();
    }

    /// The inverse, and the case an over-narrow fix loses: two voxels either
    /// side of the same border are two real writes, in two chunks, and both
    /// have to come back.
    #[test]
    fn an_edit_spanning_a_chunk_border_saves_both_chunks() {
        let dir = fresh_save_dir("border-span");
        let edits = [
            (Vec3(15, 5, 8), GROUND_ID),
            (Vec3(16, 5, 8), GROUND_ID),
            (Vec3(15, 6, 8), GROUND_ID),
            (Vec3(16, 6, 8), GROUND_ID),
        ];

        let mut world = preloaded_world(Some(&dir), false);
        apply_edits(&mut world, &edits);
        wait_for_saved_chunks(&mut world, &dir, 2);
        settle_disk(&mut world);

        assert_eq!(
            saved_chunk_coords(&dir),
            vec![Vec2(0, 0), Vec2(1, 0)],
            "both sides of the border hold real voxel changes"
        );

        drop(world);

        let reloaded = preloaded_world(Some(&dir), false);

        for (voxel, id) in &edits {
            assert_eq!(
                reloaded.chunks().get_voxel(voxel.0, voxel.1, voxel.2),
                *id,
                "edit at {voxel:?} did not come back from disk"
            );
        }

        drop(reloaded);
        fs::remove_dir_all(&dir).ok();
    }

    /// The whole point, end to end: a session of mixed edits writes a file for
    /// every chunk it changed, no file for any chunk it did not, and every one
    /// of those edits is still there after a restart.
    #[test]
    fn a_session_of_edits_writes_only_edited_chunks_and_survives_a_restart() {
        let dir = fresh_save_dir("edit-session");
        let edits = [
            (Vec3(8, ROOF_Y, 8), AIR_ID),
            (Vec3(15, 5, 8), GROUND_ID),
            (Vec3(16, 5, 8), GROUND_ID),
            (Vec3(-8, 5, -8), GROUND_ID),
            (Vec3(4, 2, 4), AIR_ID),
        ];
        let edited = vec![Vec2(-1, -1), Vec2(0, 0), Vec2(1, 0)];

        let mut world = preloaded_world(Some(&dir), false);
        apply_edits(&mut world, &edits);
        wait_for_saved_chunks(&mut world, &dir, edited.len());
        settle_disk(&mut world);

        assert_eq!(
            saved_chunk_coords(&dir),
            edited,
            "the other {} chunks of this world were lit, meshed and sent, but never changed",
            all_coords().len() - edited.len()
        );

        drop(world);

        let reloaded = preloaded_world(Some(&dir), false);

        for (voxel, id) in &edits {
            assert_eq!(
                reloaded.chunks().get_voxel(voxel.0, voxel.1, voxel.2),
                *id,
                "edit at {voxel:?} did not survive the restart"
            );
        }

        drop(reloaded);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn regeneration_from_the_same_seed_reproduces_the_same_terrain_and_light() {
        let first = preloaded_world(None, false);
        let first_snapshot = terrain_and_light(&first);
        drop(first);

        let second = preloaded_world(None, false);
        let second_snapshot = terrain_and_light(&second);
        drop(second);

        for ((coords, voxels_first, lights_first), (_, voxels_second, lights_second)) in
            first_snapshot.iter().zip(second_snapshot.iter())
        {
            assert_eq!(
                first_difference(voxels_first, voxels_second),
                None,
                "chunk {coords:?} generated different terrain on the second run"
            );
            assert_eq!(
                first_difference(lights_first, lights_second),
                None,
                "chunk {coords:?} generated different light on the second run"
            );
        }
    }
}
