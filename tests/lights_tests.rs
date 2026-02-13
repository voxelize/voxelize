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
