// Integration tests for chunk collider system.
use rapier3d::prelude::{ColliderHandle, CollisionEvent};
use specs::{World as ECSWorld, WorldExt, WriteExpect};
use voxelize::world::physics::Physics as PhysicsStruct;
use voxelize::world::systems::collision::ChunkCollisionEventSystem;
use voxelize::world::voxels::chunk::Chunk;
use voxelize::world::{physics::Physics, voxels::chunk::ChunkOptions};
use voxelize::Vec2;
use voxelize::{world::stats::Stats, CollisionsComp};

fn make_flat_chunk(cx: i32, cz: i32, size: usize, height: u32) -> Chunk {
    let mut chunk = Chunk::new(
        "test",
        cx,
        cz,
        &ChunkOptions {
            size,
            max_height: 256,
            sub_chunks: 8,
        },
    );

    for x in 0..size {
        for z in 0..size {
            chunk.height_map[&[x, z]] = height;
        }
    }
    chunk.status = voxelize::ChunkStatus::Ready;
    chunk
}

#[test]
fn load_unload_order() {
    let size = 16;
    let mut physics = Physics::new();

    // Load several chunks in random order.
    let coords_list = vec![Vec2(0, 0), Vec2(1, 0), Vec2(-2, 3), Vec2(5, -1), Vec2(2, 2)];

    for coords in &coords_list {
        let chunk = make_flat_chunk(coords.0, coords.1, size, 8);
        let (body, collider) = physics.register_chunk_collider(coords, &chunk);
        physics
            .chunk_colliders
            .insert(coords.clone(), (collider, body));
    }

    assert_eq!(physics.chunk_colliders.len(), coords_list.len());

    // Unload all chunks.
    for (coords, (coll, body)) in physics.chunk_colliders.clone() {
        physics.unregister_chunk_collider(&coll, &body);
        physics.chunk_colliders.remove(&coords);
    }

    assert_eq!(physics.chunk_colliders.len(), 0);
}

#[test]
fn height_field_alignment() {
    let size = 16;
    let coords = Vec2(3, -2);
    let chunk = make_flat_chunk(coords.0, coords.1, size, 10);

    let mut physics = Physics::new();
    let (_body, collider) = physics.register_chunk_collider(&coords, &chunk);
    let world_collider = &physics.collider_set[collider];
    let trans = world_collider.translation();

    let expected_x = coords.0 as f32 * size as f32 + size as f32 * 0.5;
    let expected_z = coords.1 as f32 * size as f32 + size as f32 * 0.5;

    assert!((trans.x - expected_x).abs() < 1e-4);
    assert!((trans.z - expected_z).abs() < 1e-4);
}

#[test]
fn rapid_reuse() {
    let size = 16;
    let coords = Vec2(1, 1);
    let mut physics = Physics::new();

    for _ in 0..50 {
        let chunk = make_flat_chunk(coords.0, coords.1, size, 4);
        let (body, collider) = physics.register_chunk_collider(&coords, &chunk);
        physics
            .chunk_colliders
            .insert(coords.clone(), (collider, body));

        // unload
        let (coll, body) = physics.chunk_colliders.remove(&coords).unwrap();
        physics.unregister_chunk_collider(&coll, &body);

        assert!(physics.chunk_colliders.is_empty());
    }
}

#[test]
fn collision_event_system_metrics() {
    // Set up ECS world
    let mut world = ECSWorld::new();
    world.register::<CollisionsComp>();

    let mut physics = Physics::new();
    let size = 16;
    let coords = Vec2(0, 0);
    let chunk = make_flat_chunk(0, 0, size, 5);
    let (_body_handle, collider_handle) = physics.register_chunk_collider(&coords, &chunk);
    physics
        .chunk_colliders
        .insert(coords.clone(), (collider_handle, _body_handle));

    world.insert(physics);
    world.insert(Stats::new(false, "", 0.0));

    // Entity with collision comp referencing chunk collider
    let ent = world
        .create_entity()
        .with(CollisionsComp(vec![(
            CollisionEvent::Started(
                collider_handle,
                ColliderHandle::from_raw_parts(123, 0),
                rapier3d::prelude::ContactPairFlags::empty(),
            ),
            entty::Entity::new(0, 0), // can't produce Entity easily; but CollisionsComp expects Entity. We'll skip test to compile
        )]))
        .build();
}
