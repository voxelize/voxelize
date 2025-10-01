use voxelize::{
    Block, Chunk, ChunkOptions, Chunks, LightColor, Lights, Registry, Vec2, Vec3, VoxelAccess, WorldConfig,
};

fn create_test_registry() -> Registry {
    let mut registry = Registry::new();
    
    registry.register_block(&Block::new("stone")
        .id(1)
        .build());
    
    registry.register_block(&Block::new("torch")
        .id(2)
        .is_passable(true)
        .red_light_level(14)
        .build());
    
    registry
}

#[test]
fn test_can_enter_functions() {
    let source = [true, true, true, true, true, true];
    let target = [true, true, true, true, true, true];
    
    assert!(Lights::can_enter(&source, &target, 1, 0, 0), "Should enter in +X");
    assert!(Lights::can_enter(&source, &target, -1, 0, 0), "Should enter in -X");
    assert!(Lights::can_enter(&source, &target, 0, 1, 0), "Should enter in +Y");
    assert!(Lights::can_enter(&source, &target, 0, -1, 0), "Should enter in -Y");
    
    let opaque_target = [false, false, false, false, false, false];
    assert!(!Lights::can_enter(&source, &opaque_target, 1, 0, 0), "Should not enter opaque");
}

#[test]
fn test_can_enter_into() {
    let transparent = [true, true, true, true, true, true];
    let opaque = [false, false, false, false, false, false];
    
    assert!(Lights::can_enter_into(&transparent, 1, 0, 0), "Should enter transparent from +X");
    assert!(!Lights::can_enter_into(&opaque, 1, 0, 0), "Should not enter opaque from +X");
}
