use std::collections::VecDeque;
use std::sync::Arc;

use voxelize::{
    Block, BlockConditionalPart, BlockDynamicPattern, BlockRule, BlockSimpleRule, Chunk,
    ChunkOptions, Chunks, LightColor, Lights, Registry, Vec3, VoxelAccess, WorldConfig,
};

fn create_test_registry() -> Registry {
    let mut registry = Registry::new();

    registry.register_block(&Block::new("stone").id(1).build());

    registry.register_block(
        &Block::new("torch")
            .id(2)
            .is_passable(true)
            .red_light_level(14)
            .build(),
    );

    registry
}

fn assert_registry_internal_consistency(registry: &Registry) {
    for (name, block) in &registry.blocks_by_name {
        assert_eq!(
            registry.get_id_by_name(name),
            block.id,
            "type-map lookup should match blocks_by_name id"
        );
        assert_eq!(
            registry.get_block_by_id(block.id).name.to_lowercase(),
            *name,
            "id map should resolve back to same lower-cased block name"
        );
    }

    for (id, block) in &registry.blocks_by_id {
        assert_eq!(
            registry.get_block_by_name(&block.name).id,
            *id,
            "name lookup should resolve back to same block id"
        );
    }

    for (id, face_index, independent) in &registry.textures {
        let faces = registry.get_faces_by_id(*id);
        assert!(
            *face_index < faces.len(),
            "texture face index should be in bounds for registered block"
        );
        assert_eq!(
            faces[*face_index].independent,
            *independent,
            "texture independent flag should match source face"
        );
    }
}

#[test]
fn test_can_enter_functions() {
    let source = [true, true, true, true, true, true];
    let target = [true, true, true, true, true, true];

    assert!(
        Lights::can_enter(&source, &target, 1, 0, 0),
        "Should enter in +X"
    );
    assert!(
        Lights::can_enter(&source, &target, -1, 0, 0),
        "Should enter in -X"
    );
    assert!(
        Lights::can_enter(&source, &target, 0, 1, 0),
        "Should enter in +Y"
    );
    assert!(
        Lights::can_enter(&source, &target, 0, -1, 0),
        "Should enter in -Y"
    );

    let opaque_target = [false, false, false, false, false, false];
    assert!(
        !Lights::can_enter(&source, &opaque_target, 1, 0, 0),
        "Should not enter opaque"
    );
}

#[test]
fn test_can_enter_into() {
    let transparent = [true, true, true, true, true, true];
    let opaque = [false, false, false, false, false, false];

    assert!(
        Lights::can_enter_into(&transparent, 1, 0, 0),
        "Should enter transparent from +X"
    );
    assert!(
        !Lights::can_enter_into(&opaque, 1, 0, 0),
        "Should not enter opaque from +X"
    );
}

#[test]
fn test_flood_light_respects_min_without_shape() {
    let registry = create_test_registry();
    let config = WorldConfig {
        chunk_size: 16,
        max_height: 16,
        max_light_level: 15,
        min_chunk: [0, 0],
        max_chunk: [0, 0],
        saving: false,
        ..Default::default()
    };

    let mut chunks = Chunks::new(&config);
    chunks.add(Chunk::new(
        "chunk-0-0",
        0,
        0,
        &ChunkOptions {
            size: 16,
            max_height: 16,
            sub_chunks: 1,
        },
    ));

    let source = Vec3(9, 8, 8);
    chunks.set_voxel(source.0, source.1, source.2, 2);
    chunks.set_red_light(source.0, source.1, source.2, 14);

    Lights::flood_light(
        &mut chunks,
        VecDeque::from(vec![voxelize::LightNode {
            voxel: [source.0, source.1, source.2],
            level: 14,
        }]),
        &LightColor::Red,
        &registry,
        &config,
        Some(&Vec3(9, 0, 0)),
        None,
    );

    assert_eq!(
        chunks.get_red_light(8, 8, 8),
        0,
        "red light should not propagate below min-x when shape is absent"
    );
    assert!(
        chunks.get_red_light(10, 8, 8) > 0,
        "red light should propagate toward +X from source"
    );
}

#[test]
fn test_to_lighter_registry_keeps_dynamic_light_pattern_rules() {
    let mut registry = Registry::new();

    registry.register_block(&Block::new("trigger").id(3).build());

    let dynamic_pattern = BlockDynamicPattern {
        parts: vec![BlockConditionalPart {
            rule: BlockRule::Simple(BlockSimpleRule {
                offset: Vec3(1, 0, 0),
                id: Some(3),
                rotation: None,
                stage: None,
            }),
            red_light_level: Some(12),
            ..BlockConditionalPart::default()
        }],
    };

    registry.register_block(
        &Block::new("dynamic-light")
            .id(4)
            .is_passable(true)
            .red_light_level(2)
            .dynamic_patterns(&[dynamic_pattern])
            .build(),
    );

    let lighter_registry = registry.to_lighter_registry();
    let light_block = lighter_registry.get_block_by_id(4);

    let config = WorldConfig {
        chunk_size: 16,
        max_height: 16,
        max_light_level: 15,
        min_chunk: [0, 0],
        max_chunk: [0, 0],
        saving: false,
        ..Default::default()
    };

    let mut chunks = Chunks::new(&config);
    chunks.add(Chunk::new(
        "chunk-0-0",
        0,
        0,
        &ChunkOptions {
            size: 16,
            max_height: 16,
            sub_chunks: 1,
        },
    ));

    chunks.set_voxel(4, 4, 4, 4);
    chunks.set_voxel(5, 4, 4, 3);
    assert_eq!(
        light_block.get_torch_light_level_at(&[4, 4, 4], &chunks, &LightColor::Red),
        12,
        "dynamic pattern light level should apply when rule matches"
    );

    chunks.set_voxel(5, 4, 4, 0);
    assert_eq!(
        light_block.get_torch_light_level_at(&[4, 4, 4], &chunks, &LightColor::Red),
        2,
        "static block light level should be used when dynamic rule does not match"
    );
}

#[test]
fn test_mesher_registry_cache_invalidates_on_registry_mutation() {
    let mut registry = create_test_registry();

    let before = registry.mesher_registry();
    assert!(!before.has_type(7));

    registry.register_block(&Block::new("cached-new-stone").id(7).build());

    let after = registry.mesher_registry();
    assert!(after.has_type(7));
    assert!(
        !Arc::ptr_eq(&before, &after),
        "mesher registry cache should refresh after block registration"
    );
}

#[test]
fn test_lighter_registry_cache_invalidates_on_registry_mutation() {
    let mut registry = create_test_registry();

    let before = registry.lighter_registry();
    assert!(!before.has_type(8));

    registry.register_block(
        &Block::new("cached-new-torch")
            .id(8)
            .is_passable(true)
            .red_light_level(9)
            .build(),
    );

    let after = registry.lighter_registry();
    assert!(after.has_type(8));
    assert_eq!(after.get_block_by_id(8).red_light_level, 9);
    assert!(
        !Arc::ptr_eq(&before, &after),
        "lighter registry cache should refresh after block registration"
    );
}

#[test]
fn test_registry_conversion_caches_reuse_without_mutation() {
    let registry = create_test_registry();

    let mesher_first = registry.mesher_registry();
    let mesher_second = registry.mesher_registry();
    assert!(
        Arc::ptr_eq(&mesher_first, &mesher_second),
        "mesher registry conversion should reuse cache without mutation"
    );

    let lighter_first = registry.lighter_registry();
    let lighter_second = registry.lighter_registry();
    assert!(
        Arc::ptr_eq(&lighter_first, &lighter_second),
        "lighter registry conversion should reuse cache without mutation"
    );
}

#[test]
fn test_registry_generate_invalidates_conversion_caches() {
    let mut registry = create_test_registry();

    let mesher_before = registry.mesher_registry();
    let lighter_before = registry.lighter_registry();

    registry.generate();

    let mesher_after = registry.mesher_registry();
    let lighter_after = registry.lighter_registry();

    assert!(
        !Arc::ptr_eq(&mesher_before, &mesher_after),
        "mesher registry cache should refresh after generate"
    );
    assert!(
        !Arc::ptr_eq(&lighter_before, &lighter_after),
        "lighter registry cache should refresh after generate"
    );
}

#[test]
fn test_register_air_active_fn_invalidates_conversion_caches() {
    let mut registry = create_test_registry();

    let mesher_before = registry.mesher_registry();
    let lighter_before = registry.lighter_registry();

    registry.register_air_active_fn(|_, _, _| 0, |_, _, _| vec![]);

    let mesher_after = registry.mesher_registry();
    let lighter_after = registry.lighter_registry();

    assert!(
        !Arc::ptr_eq(&mesher_before, &mesher_after),
        "mesher registry cache should refresh after air active registration"
    );
    assert!(
        !Arc::ptr_eq(&lighter_before, &lighter_after),
        "lighter registry cache should refresh after air active registration"
    );
}

#[test]
fn test_register_air_active_fn_preserves_air_registry_entry() {
    let mut registry = create_test_registry();

    registry.register_air_active_fn(|_, _, _| 0, |_, _, _| vec![]);

    assert!(registry.is_air(0));
    assert!(registry.get_block_by_id(0).is_active);
    assert!(registry.get_block_by_name("Air").is_active);
    assert_registry_internal_consistency(&registry);
}

#[test]
fn test_register_blocks_invalidates_conversion_caches() {
    let mut registry = create_test_registry();

    let mesher_before = registry.mesher_registry();
    let lighter_before = registry.lighter_registry();

    registry.register_blocks(&[
        Block::new("bulk-a").id(33).build(),
        Block::new("bulk-b").id(34).build(),
    ]);

    let mesher_after = registry.mesher_registry();
    let lighter_after = registry.lighter_registry();

    assert!(mesher_after.has_type(33));
    assert!(mesher_after.has_type(34));
    assert!(lighter_after.has_type(33));
    assert!(lighter_after.has_type(34));
    assert!(
        !Arc::ptr_eq(&mesher_before, &mesher_after),
        "mesher registry cache should refresh after bulk registration"
    );
    assert!(
        !Arc::ptr_eq(&lighter_before, &lighter_after),
        "lighter registry cache should refresh after bulk registration"
    );
}

#[test]
fn test_register_blocks_assigns_unique_auto_ids_and_refreshes_caches() {
    let mut registry = create_test_registry();

    let mesher_before = registry.mesher_registry();
    let lighter_before = registry.lighter_registry();

    registry.register_blocks(&[
        Block::new("bulk-auto-a").is_passable(true).build(),
        Block::new("bulk-auto-b").is_passable(true).build(),
    ]);

    let auto_a = registry.get_block_by_name("bulk-auto-a").id;
    let auto_b = registry.get_block_by_name("bulk-auto-b").id;

    assert_ne!(auto_a, 0);
    assert_ne!(auto_b, 0);
    assert_ne!(auto_a, auto_b, "auto-assigned IDs should be unique");

    let mesher_after = registry.mesher_registry();
    let lighter_after = registry.lighter_registry();

    assert!(mesher_after.has_type(auto_a));
    assert!(mesher_after.has_type(auto_b));
    assert!(lighter_after.has_type(auto_a));
    assert!(lighter_after.has_type(auto_b));
    assert!(
        !Arc::ptr_eq(&mesher_before, &mesher_after),
        "mesher cache should refresh after auto-id bulk registration"
    );
    assert!(
        !Arc::ptr_eq(&lighter_before, &lighter_after),
        "lighter cache should refresh after auto-id bulk registration"
    );
}

#[test]
fn test_register_blocks_auto_id_avoids_explicit_ids_in_same_batch() {
    let mut registry = create_test_registry();

    registry.register_blocks(&[
        Block::new("bulk-auto-before-explicit")
            .is_passable(true)
            .build(),
        Block::new("bulk-explicit").id(3).build(),
    ]);

    let auto_id = registry.get_block_by_name("bulk-auto-before-explicit").id;
    let explicit_id = registry.get_block_by_name("bulk-explicit").id;

    assert_eq!(explicit_id, 3);
    assert_ne!(auto_id, 0);
    assert_ne!(
        auto_id, explicit_id,
        "auto-id assignment should not consume explicit ids from same batch"
    );
}

#[test]
fn test_register_blocks_can_reuse_id_freed_earlier_in_batch() {
    let mut registry = create_test_registry();

    registry.register_blocks(&[
        Block::new("torch").id(41).build(),
        Block::new("reused-id-two").id(2).build(),
    ]);

    assert_eq!(registry.get_block_by_name("torch").id, 41);
    assert_eq!(registry.get_block_by_name("reused-id-two").id, 2);
    assert!(registry.has_type(2));
    assert!(registry.has_type(41));
}

#[test]
fn test_register_blocks_conflict_before_free_still_panics() {
    let mut registry = create_test_registry();
    let mesher_before = registry.mesher_registry();
    let lighter_before = registry.lighter_registry();

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        registry.register_blocks(&[
            Block::new("reused-id-two").id(2).build(),
            Block::new("torch").id(41).build(),
        ]);
    }));

    assert!(result.is_err());
    assert_eq!(
        registry.get_block_by_name("torch").id,
        2,
        "failed batch should leave existing registry mappings unchanged"
    );
    assert!(!registry.has_type(41));

    let mesher_after = registry.mesher_registry();
    let lighter_after = registry.lighter_registry();

    assert!(
        Arc::ptr_eq(&mesher_before, &mesher_after),
        "mesher cache should remain intact when earlier explicit conflict panics"
    );
    assert!(
        Arc::ptr_eq(&lighter_before, &lighter_after),
        "lighter cache should remain intact when earlier explicit conflict panics"
    );
}

#[test]
fn test_register_blocks_auto_id_can_reuse_processed_explicit_id() {
    let mut registry = create_test_registry();

    registry.register_blocks(&[
        Block::new("ephemeral").id(3).build(),
        Block::new("ephemeral").id(4).build(),
        Block::new("late-auto").is_passable(true).build(),
    ]);

    assert_eq!(registry.get_block_by_name("ephemeral").id, 4);
    assert_eq!(
        registry.get_block_by_name("late-auto").id,
        3,
        "auto-id allocation should reuse explicit ids that are no longer reserved and no longer occupied"
    );
}

#[test]
fn test_register_blocks_auto_id_reflects_ids_freed_by_earlier_updates() {
    let mut registry = create_test_registry();
    registry.register_block(&Block::new("solid-three").id(3).build());

    registry.register_blocks(&[
        Block::new("auto-one").is_passable(true).build(),
        Block::new("solid-three").id(5).build(),
        Block::new("auto-two").is_passable(true).build(),
    ]);

    assert_eq!(registry.get_block_by_name("auto-one").id, 4);
    assert_eq!(
        registry.get_block_by_name("auto-two").id,
        3,
        "later auto-id allocation should observe ids freed earlier in the same batch"
    );
}

#[test]
fn test_register_blocks_auto_id_reuses_lower_id_freed_after_auto_assignment() {
    let mut registry = create_test_registry();

    registry.register_blocks(&[
        Block::new("auto-a").is_passable(true).build(),
        Block::new("auto-b").is_passable(true).build(),
        Block::new("auto-b").id(6).build(),
        Block::new("auto-c").is_passable(true).build(),
    ]);

    assert_eq!(registry.get_block_by_name("auto-a").id, 3);
    assert_eq!(registry.get_block_by_name("auto-b").id, 6);
    assert_eq!(
        registry.get_block_by_name("auto-c").id,
        4,
        "auto-id assignment should track lower ids freed by prior same-name remaps"
    );
}

#[test]
fn test_register_blocks_same_name_overwrite_keeps_latest_id_only() {
    let mut registry = create_test_registry();

    registry.register_blocks(&[
        Block::new("torch").id(41).build(),
        Block::new("torch").id(42).build(),
    ]);

    assert_eq!(registry.get_block_by_name("torch").id, 42);
    assert!(registry.has_type(42));
    assert!(
        !registry.has_type(41),
        "earlier overwritten id should be removed from registry maps"
    );
    assert!(
        registry
            .textures
            .iter()
            .find(|(id, _, _)| *id == 41)
            .is_none(),
        "texture entries for overwritten id should be removed"
    );
}

#[test]
fn test_registry_consistency_after_complex_bulk_updates() {
    let mut registry = create_test_registry();

    registry.register_blocks(&[
        Block::new("torch").id(41).build(),
        Block::new("ephemeral").id(3).build(),
        Block::new("ephemeral").id(4).build(),
        Block::new("auto-a").is_passable(true).build(),
        Block::new("stone").id(5).build(),
        Block::new("auto-b").is_passable(true).build(),
    ]);

    assert_registry_internal_consistency(&registry);
}

#[test]
fn test_register_blocks_panics_on_duplicate_ids_in_batch() {
    let mut registry = create_test_registry();

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        registry.register_blocks(&[
            Block::new("dup-a").id(42).build(),
            Block::new("dup-b").id(42).build(),
        ]);
    }));

    assert!(
        result.is_err(),
        "register_blocks should panic when duplicate IDs appear in same batch"
    );
}

#[test]
fn test_register_blocks_duplicate_ids_panic_keeps_registry_and_caches_unchanged() {
    let mut registry = create_test_registry();
    let mesher_before = registry.mesher_registry();
    let lighter_before = registry.lighter_registry();

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        registry.register_blocks(&[
            Block::new("dup-a").id(41).build(),
            Block::new("dup-b").id(41).build(),
        ]);
    }));

    assert!(result.is_err());
    assert!(
        !registry.has_type(41),
        "failed duplicate-id bulk registration should not mutate registry"
    );

    let mesher_after = registry.mesher_registry();
    let lighter_after = registry.lighter_registry();

    assert!(
        Arc::ptr_eq(&mesher_before, &mesher_after),
        "mesher cache should remain intact when duplicate-id batch panics"
    );
    assert!(
        Arc::ptr_eq(&lighter_before, &lighter_after),
        "lighter cache should remain intact when duplicate-id batch panics"
    );
}

#[test]
fn test_register_blocks_panics_on_existing_id_conflict() {
    let mut registry = create_test_registry();

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        registry.register_blocks(&[
            Block::new("conflict-existing").id(2).build(),
            Block::new("other").id(43).build(),
        ]);
    }));

    assert!(
        result.is_err(),
        "register_blocks should panic when a new block conflicts with an existing id"
    );
}

#[test]
fn test_register_blocks_panic_keeps_registry_and_caches_unchanged() {
    let mut registry = create_test_registry();
    let mesher_before = registry.mesher_registry();
    let lighter_before = registry.lighter_registry();

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        registry.register_blocks(&[
            Block::new("would-be-added").id(41).build(),
            Block::new("conflict-existing").id(2).build(),
        ]);
    }));

    assert!(result.is_err());
    assert!(
        !registry.has_type(41),
        "failed bulk registration should not partially register earlier blocks"
    );

    let mesher_after = registry.mesher_registry();
    let lighter_after = registry.lighter_registry();

    assert!(
        Arc::ptr_eq(&mesher_before, &mesher_after),
        "mesher cache should remain intact when bulk registration panics"
    );
    assert!(
        Arc::ptr_eq(&lighter_before, &lighter_after),
        "lighter cache should remain intact when bulk registration panics"
    );
}

#[test]
fn test_register_block_panic_keeps_conversion_caches() {
    let mut registry = create_test_registry();
    let mesher_before = registry.mesher_registry();
    let lighter_before = registry.lighter_registry();

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        registry.register_block(&Block::new("single-conflict").id(2).build());
    }));

    assert!(result.is_err());

    let mesher_after = registry.mesher_registry();
    let lighter_after = registry.lighter_registry();

    assert!(
        Arc::ptr_eq(&mesher_before, &mesher_after),
        "mesher cache should remain intact when single registration panics"
    );
    assert!(
        Arc::ptr_eq(&lighter_before, &lighter_after),
        "lighter cache should remain intact when single registration panics"
    );
}

#[test]
fn test_register_block_assigns_auto_id_and_refreshes_caches() {
    let mut registry = create_test_registry();
    let mesher_before = registry.mesher_registry();
    let lighter_before = registry.lighter_registry();

    registry.register_block(&Block::new("single-auto").is_passable(true).build());

    let auto_id = registry.get_block_by_name("single-auto").id;
    assert_ne!(auto_id, 0);
    assert!(
        registry.has_type(auto_id),
        "auto-assigned block id should be registered"
    );

    let mesher_after = registry.mesher_registry();
    let lighter_after = registry.lighter_registry();

    assert!(mesher_after.has_type(auto_id));
    assert!(lighter_after.has_type(auto_id));
    assert!(
        !Arc::ptr_eq(&mesher_before, &mesher_after),
        "mesher cache should refresh after successful single registration"
    );
    assert!(
        !Arc::ptr_eq(&lighter_before, &lighter_after),
        "lighter cache should refresh after successful single registration"
    );
}

#[test]
fn test_register_block_replacing_existing_name_removes_old_id_mapping() {
    let mut registry = create_test_registry();

    registry.register_block(&Block::new("torch").id(41).build());

    assert_eq!(registry.get_block_by_name("torch").id, 41);
    assert_eq!(registry.get_id_by_name("torch"), 41);
    assert!(registry.has_type(41));
    assert!(
        !registry.has_type(2),
        "registering an existing name with a new id should remove the old id mapping"
    );
}

#[test]
fn test_register_block_replacing_name_clears_old_texture_entries() {
    let mut registry = create_test_registry();

    assert!(
        registry
            .textures
            .iter()
            .find(|(id, _, _)| *id == 2)
            .is_some(),
        "precondition: original torch texture entries should exist"
    );

    registry.register_block(&Block::new("torch").id(41).faces(&[]).build());

    assert!(
        registry
            .textures
            .iter()
            .find(|(id, _, _)| *id == 2)
            .is_none(),
        "texture entries for replaced id should be removed"
    );
    assert!(
        registry
            .textures
            .iter()
            .find(|(id, _, _)| *id == 41)
            .is_none(),
        "replacement block with no faces should not leave texture entries"
    );
}

#[test]
fn test_register_blocks_empty_keeps_conversion_caches() {
    let mut registry = create_test_registry();

    let mesher_before = registry.mesher_registry();
    let lighter_before = registry.lighter_registry();

    registry.register_blocks(&[]);

    let mesher_after = registry.mesher_registry();
    let lighter_after = registry.lighter_registry();

    assert!(
        Arc::ptr_eq(&mesher_before, &mesher_after),
        "mesher cache should be reused for empty bulk registration"
    );
    assert!(
        Arc::ptr_eq(&lighter_before, &lighter_after),
        "lighter cache should be reused for empty bulk registration"
    );
}

#[test]
fn test_registry_clone_keeps_conversion_caches_independent() {
    let registry = create_test_registry();
    let mesher_original = registry.mesher_registry();
    let lighter_original = registry.lighter_registry();

    let mut cloned = registry.clone();
    let mesher_clone = cloned.mesher_registry();
    let lighter_clone = cloned.lighter_registry();

    assert!(
        !Arc::ptr_eq(&mesher_original, &mesher_clone),
        "cloned registry should build an independent mesher conversion cache"
    );
    assert!(
        !Arc::ptr_eq(&lighter_original, &lighter_clone),
        "cloned registry should build an independent lighter conversion cache"
    );

    cloned.register_block(&Block::new("clone-only").id(29).build());
    assert!(
        cloned.mesher_registry().has_type(29),
        "newly registered block should exist in clone mesher cache"
    );
    assert!(
        cloned.lighter_registry().has_type(29),
        "newly registered block should exist in clone lighter cache"
    );
    assert!(
        !registry.mesher_registry().has_type(29),
        "original registry should not observe clone-only mutation"
    );
    assert!(
        !registry.lighter_registry().has_type(29),
        "original registry should not observe clone-only mutation"
    );
}

#[test]
fn test_remove_lights_batch_through_server_wrapper() {
    let registry = create_test_registry();
    let config = WorldConfig {
        chunk_size: 16,
        max_height: 16,
        max_light_level: 15,
        min_chunk: [0, 0],
        max_chunk: [0, 0],
        saving: false,
        ..Default::default()
    };

    let mut chunks = Chunks::new(&config);
    chunks.add(Chunk::new(
        "chunk-0-0",
        0,
        0,
        &ChunkOptions {
            size: 16,
            max_height: 16,
            sub_chunks: 1,
        },
    ));

    let source_a = Vec3(6, 8, 8);
    let source_b = Vec3(10, 8, 8);
    chunks.set_voxel(source_a.0, source_a.1, source_a.2, 2);
    chunks.set_voxel(source_b.0, source_b.1, source_b.2, 2);
    chunks.set_red_light(source_a.0, source_a.1, source_a.2, 14);
    chunks.set_red_light(source_b.0, source_b.1, source_b.2, 14);

    Lights::flood_light(
        &mut chunks,
        VecDeque::from(vec![
            voxelize::LightNode {
                voxel: [source_a.0, source_a.1, source_a.2],
                level: 14,
            },
            voxelize::LightNode {
                voxel: [source_b.0, source_b.1, source_b.2],
                level: 14,
            },
        ]),
        &LightColor::Red,
        &registry,
        &config,
        None,
        None,
    );

    assert!(
        chunks.get_red_light(8, 8, 8) > 0,
        "middle voxel should receive flood light from sources before removal"
    );

    Lights::remove_lights(
        &mut chunks,
        &[source_a.clone(), source_b.clone()],
        &LightColor::Red,
        &config,
        &registry,
    );

    assert_eq!(chunks.get_red_light(source_a.0, source_a.1, source_a.2), 0);
    assert_eq!(chunks.get_red_light(source_b.0, source_b.1, source_b.2), 0);
    assert_eq!(chunks.get_red_light(8, 8, 8), 0);
}

#[test]
fn test_flood_light_respects_explicit_shape_bounds() {
    let registry = create_test_registry();
    let config = WorldConfig {
        chunk_size: 16,
        max_height: 16,
        max_light_level: 15,
        min_chunk: [0, 0],
        max_chunk: [0, 0],
        saving: false,
        ..Default::default()
    };

    let mut chunks = Chunks::new(&config);
    chunks.add(Chunk::new(
        "chunk-0-0",
        0,
        0,
        &ChunkOptions {
            size: 16,
            max_height: 16,
            sub_chunks: 1,
        },
    ));

    let source = Vec3(8, 8, 8);
    chunks.set_voxel(source.0, source.1, source.2, 2);
    chunks.set_red_light(source.0, source.1, source.2, 14);

    let min = Vec3(8, 0, 8);
    let shape = Vec3(2, 16, 2);

    Lights::flood_light(
        &mut chunks,
        VecDeque::from(vec![voxelize::LightNode {
            voxel: [source.0, source.1, source.2],
            level: 14,
        }]),
        &LightColor::Red,
        &registry,
        &config,
        Some(&min),
        Some(&shape),
    );

    assert!(
        chunks.get_red_light(9, 8, 8) > 0,
        "light should propagate inside explicit xz bounds"
    );
    assert!(
        chunks.get_red_light(8, 8, 9) > 0,
        "light should propagate inside explicit xz bounds"
    );
    assert_eq!(
        chunks.get_red_light(7, 8, 8),
        0,
        "light should not propagate outside min x bound"
    );
    assert_eq!(
        chunks.get_red_light(10, 8, 8),
        0,
        "light should not propagate outside max x bound"
    );
    assert_eq!(
        chunks.get_red_light(8, 8, 10),
        0,
        "light should not propagate outside max z bound"
    );
}

#[test]
fn test_flood_light_min_only_handles_large_world_bounds_without_overflow() {
    let registry = create_test_registry();
    let config = WorldConfig {
        chunk_size: 16,
        max_height: 16,
        max_light_level: 15,
        min_chunk: [0, 0],
        max_chunk: [i32::MAX, i32::MAX],
        saving: false,
        ..Default::default()
    };

    let mut chunks = Chunks::new(&config);
    chunks.add(Chunk::new(
        "chunk-0-0",
        0,
        0,
        &ChunkOptions {
            size: 16,
            max_height: 16,
            sub_chunks: 1,
        },
    ));

    let source = Vec3(9, 8, 8);
    chunks.set_voxel(source.0, source.1, source.2, 2);
    chunks.set_red_light(source.0, source.1, source.2, 14);

    Lights::flood_light(
        &mut chunks,
        VecDeque::from(vec![voxelize::LightNode {
            voxel: [source.0, source.1, source.2],
            level: 14,
        }]),
        &LightColor::Red,
        &registry,
        &config,
        Some(&Vec3(9, 0, 0)),
        None,
    );

    assert_eq!(
        chunks.get_red_light(8, 8, 8),
        0,
        "lower x should stay unlit even with huge world bounds"
    );
    assert!(
        chunks.get_red_light(10, 8, 8) > 0,
        "higher x should still receive light with huge world bounds"
    );
}

#[test]
fn test_remove_light_wrapper_clears_sunlight_column() {
    let registry = create_test_registry();
    let config = WorldConfig {
        chunk_size: 16,
        max_height: 16,
        max_light_level: 15,
        min_chunk: [0, 0],
        max_chunk: [0, 0],
        saving: false,
        ..Default::default()
    };

    let mut chunks = Chunks::new(&config);
    chunks.add(Chunk::new(
        "chunk-0-0",
        0,
        0,
        &ChunkOptions {
            size: 16,
            max_height: 16,
            sub_chunks: 1,
        },
    ));

    let source = Vec3(8, 12, 8);
    chunks.set_sunlight(source.0, source.1, source.2, 15);

    Lights::flood_light(
        &mut chunks,
        VecDeque::from(vec![voxelize::LightNode {
            voxel: [source.0, source.1, source.2],
            level: 15,
        }]),
        &LightColor::Sunlight,
        &registry,
        &config,
        None,
        None,
    );

    assert_eq!(
        chunks.get_sunlight(8, 11, 8),
        15,
        "sunlight should continue downward at max through non-reducing air"
    );
    assert_eq!(
        chunks.get_sunlight(8, 10, 8),
        15,
        "sunlight should continue downward at max through non-reducing air"
    );

    Lights::remove_light(
        &mut chunks,
        &source,
        &LightColor::Sunlight,
        &config,
        &registry,
    );

    assert_eq!(chunks.get_sunlight(8, 12, 8), 0);
    assert_eq!(chunks.get_sunlight(8, 11, 8), 0);
    assert_eq!(chunks.get_sunlight(8, 10, 8), 0);
}

#[test]
fn test_remove_lights_wrapper_clears_multiple_sunlight_columns() {
    let registry = create_test_registry();
    let config = WorldConfig {
        chunk_size: 16,
        max_height: 16,
        max_light_level: 15,
        min_chunk: [0, 0],
        max_chunk: [0, 0],
        saving: false,
        ..Default::default()
    };

    let mut chunks = Chunks::new(&config);
    chunks.add(Chunk::new(
        "chunk-0-0",
        0,
        0,
        &ChunkOptions {
            size: 16,
            max_height: 16,
            sub_chunks: 1,
        },
    ));

    let source_a = Vec3(6, 12, 8);
    let source_b = Vec3(10, 12, 8);
    chunks.set_sunlight(source_a.0, source_a.1, source_a.2, 15);
    chunks.set_sunlight(source_b.0, source_b.1, source_b.2, 15);

    Lights::flood_light(
        &mut chunks,
        VecDeque::from(vec![
            voxelize::LightNode {
                voxel: [source_a.0, source_a.1, source_a.2],
                level: 15,
            },
            voxelize::LightNode {
                voxel: [source_b.0, source_b.1, source_b.2],
                level: 15,
            },
        ]),
        &LightColor::Sunlight,
        &registry,
        &config,
        None,
        None,
    );

    assert_eq!(chunks.get_sunlight(6, 11, 8), 15);
    assert_eq!(chunks.get_sunlight(10, 11, 8), 15);

    Lights::remove_lights(
        &mut chunks,
        &[source_a.clone(), source_b.clone()],
        &LightColor::Sunlight,
        &config,
        &registry,
    );

    assert_eq!(chunks.get_sunlight(source_a.0, source_a.1, source_a.2), 0);
    assert_eq!(chunks.get_sunlight(source_b.0, source_b.1, source_b.2), 0);
    assert_eq!(chunks.get_sunlight(6, 11, 8), 0);
    assert_eq!(chunks.get_sunlight(10, 11, 8), 0);
}
