//! Regression test: two behavior drivers operating one brain in the same
//! tick must charge at most one jump impulse.
//!
//! In the town dispatcher, `WalkTowardsSystem` and `WanderingSystem` both call
//! `brain.operate()` on the same land animal in the same tick, before
//! `PhysicsSystem` integrates. Resting flags only update when physics runs, so
//! the second call still reads the pre-takeoff ground contact. `operate()`
//! used to clear `is_jumping` on that stale contact and start a second full
//! jump — 9.5 + 9.5 = 19 m/s, a ~5.5-block launch instead of a ~1.5-block hop,
//! whose landing dealt lethal fall damage to small fauna ("animals randomly
//! rocket into the sky and die"). The fix treats a grounded body with a queued
//! upward impulse as mid-takeoff, not landed, so the second driver joins the
//! jump in progress instead of restarting it.
//!
//! This replays that exact tick sequence with the real physics and a pig body
//! (hop_jump_impulse 9.5, the value every WanderBehaviorComp ships).

use voxelize::{
    BrainComp, Chunk, ChunkOptions, Chunks, Physics, Registry, RigidBody, Vec3, VoxelAccess,
    WorldConfig, AABB,
};

/// Server tick interval: `DEFAULT_INTERVAL = 16` ms.
const DT: f32 = 0.016;

const FLOOR_Y: i32 = 40;
const FEET_Y: f32 = (FLOOR_Y + 1) as f32;

/// Stone floor with a one-block step at x = 10 — the lip a wandering animal
/// hops up while pathing across it.
fn stone_yard() -> (Chunks, Registry, WorldConfig) {
    let config = WorldConfig::new()
        .saving(false)
        .min_chunk([0, 0])
        .max_chunk([0, 0])
        .build();

    let mut registry = Registry::new();
    registry.register_block(&voxelize::Block::new("Stone").id(5).build());

    let mut chunks = Chunks::new(&config);
    chunks.add(Chunk::new(
        "0",
        0,
        0,
        &ChunkOptions {
            size: config.chunk_size,
            max_height: config.max_height,
            sub_chunks: config.sub_chunks,
        },
    ));

    for vx in 0..16 {
        for vz in 0..16 {
            chunks.set_voxel(vx, FLOOR_Y, vz, 5);
        }
    }
    for vz in 0..16 {
        chunks.set_voxel(10, FLOOR_Y + 1, vz, 5);
    }

    (chunks, registry, config)
}

/// A pig-sized body resting on the floor, pressed up near the step face.
fn settled_pig(chunks: &Chunks, registry: &Registry, config: &WorldConfig) -> RigidBody {
    let aabb = AABB::new().scale_x(0.52).scale_y(0.83).scale_z(0.52).build();
    let mut body = RigidBody::new(&aabb).friction(3.0).build();
    body.air_drag = 0.6;
    body.set_position(9.6, FEET_Y + 0.83 / 2.0 + 0.01, 8.5);

    for _ in 0..10 {
        Physics::iterate_body(&mut body, DT, chunks, registry, config);
    }
    assert!(
        body.at_rest_y() < 0,
        "the pig must be resting on the floor before the tick under test"
    );
    body
}

fn pig_brain() -> BrainComp {
    // Exactly what setup_pig sets, plus the per-tick stamp WanderingSystem
    // applies: brain.options.jump_impulse = behavior.hop_jump_impulse (9.5).
    let mut brain = BrainComp::default();
    brain.options.max_speed = 2.5;
    brain.options.move_force = 7.0;
    brain.options.jump_impulse = 9.5;
    brain
}

/// Integrate to the top of the arc, returning apex height above the takeoff
/// floor in blocks.
fn rise_to_apex(
    body: &mut RigidBody,
    chunks: &Chunks,
    registry: &Registry,
    config: &WorldConfig,
) -> f32 {
    let mut apex = body.aabb.min_y;
    for _ in 0..600 {
        Physics::iterate_body(body, DT, chunks, registry, config);
        if body.aabb.min_y > apex {
            apex = body.aabb.min_y;
        }
        if body.velocity.1 <= 0.0 {
            break;
        }
    }
    apex - FEET_Y
}

#[test]
fn second_driver_same_tick_cannot_double_charge_jump() {
    let (chunks, registry, config) = stone_yard();
    let node_on_step = Vec3(10.5, FEET_Y + 1.0, 8.5);

    // --- Control: one driver operates, a lone hop. ---
    let mut body = settled_pig(&chunks, &registry, &config);
    let mut brain = pig_brain();
    brain.jump();
    brain.walk();
    brain.operate(&node_on_step, &mut body, DT);
    let single_pending = body.impulses[1];
    let single_apex = rise_to_apex(&mut body, &chunks, &registry, &config);

    // --- The dispatcher's actual tick for a wandering animal at a step. ---
    let mut body = settled_pig(&chunks, &registry, &config);
    let mut brain = pig_brain();

    // WalkTowardsSystem: `vpos.1 < nodes[i].1` (node is on the step) → jump.
    brain.jump();
    brain.walk();
    brain.operate(&node_on_step, &mut body, DT);
    let pending_after_walk_towards = body.impulses[1];

    // WanderingSystem, same tick: hop gate reads grounded + pressed lip →
    // jump again. Physics has not run yet, so ground contact is stale; the
    // queued impulse must mark the body mid-takeoff, not landed.
    brain.jump();
    brain.walk();
    brain.operate(&node_on_step, &mut body, DT);
    let pending_after_wandering = body.impulses[1];

    let double_apex = rise_to_apex(&mut body, &chunks, &registry, &config);

    println!("single driver: pending impulse {single_pending}, apex {single_apex:.2} blocks");
    println!(
        "two drivers:   pending impulse {pending_after_wandering} \
         (after walk-towards {pending_after_walk_towards}), apex {double_apex:.2} blocks"
    );

    assert_eq!(single_pending, 9.5, "one driver queues one hop impulse");
    assert_eq!(
        pending_after_wandering, 9.5,
        "the second operate() in the same tick must not queue a second jump impulse"
    );
    assert!(
        single_apex < 2.5,
        "a lone hop stays a hop, got {single_apex:.2} blocks"
    );
    assert!(
        (double_apex - single_apex).abs() < 0.1,
        "both drivers arming the same tick still yields one hop's arc: \
         {double_apex:.2} vs {single_apex:.2} blocks"
    );

    // --- Landing must still re-arm the jump (the gate keys off the pending
    // impulse, which physics consumes, so it can never wedge jumping shut). ---
    for _ in 0..600 {
        Physics::iterate_body(&mut body, DT, &chunks, &registry, &config);
        if body.at_rest_y() < 0 {
            break;
        }
    }
    assert!(body.at_rest_y() < 0, "the pig must land within the budget");
    assert_eq!(body.impulses[1], 0.0, "physics consumed the jump impulse");

    brain.jump();
    brain.walk();
    brain.operate(&node_on_step, &mut body, DT);
    assert_eq!(
        body.impulses[1], 9.5,
        "a landed body starts a fresh jump normally"
    );
}
