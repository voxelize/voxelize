use super::fluid::WATERLOG_FLUID_INSET;
use super::*;
use hashbrown::HashMap;

use voxelize_core::{
    BlockFace, BlockRotation, CornerData, LightColor, LightUtils, VoxelAccess, AABB, UV,
};

struct SingleVoxelSpace {
    voxel_id: u32,
    is_waterlogged: bool,
}

impl SingleVoxelSpace {
    fn dry(voxel_id: u32) -> Self {
        Self {
            voxel_id,
            is_waterlogged: false,
        }
    }
}

impl VoxelAccess for SingleVoxelSpace {
    fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if vx == 0 && vy == 0 && vz == 0 {
            self.voxel_id
        } else {
            0
        }
    }

    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        self.get_voxel(vx, vy, vz)
    }

    fn get_voxel_rotation(&self, _vx: i32, _vy: i32, _vz: i32) -> BlockRotation {
        BlockRotation::PY(0.0)
    }

    fn get_voxel_stage(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
        0
    }

    fn get_voxel_waterlogged(&self, vx: i32, vy: i32, vz: i32) -> bool {
        self.is_waterlogged && (vx, vy, vz) == (0, 0, 0)
    }

    fn get_voxel_fluid_level(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
        0
    }

    fn get_sunlight(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
        0
    }

    fn get_torch_light(&self, _vx: i32, _vy: i32, _vz: i32, _color: LightColor) -> u32 {
        0
    }

    fn get_all_lights(&self, _vx: i32, _vy: i32, _vz: i32) -> (u32, u32, u32, u32) {
        (0, 0, 0, 0)
    }

    fn get_max_height(&self, _vx: i32, _vz: i32) -> u32 {
        1
    }

    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        vx == 0 && vy == 0 && vz == 0
    }
}

fn full_block_diagonal_block() -> Block {
    Block {
        id: 1,
        name: "full diagonal plant".to_string(),
        name_lower: "full diagonal plant".to_string(),
        rotatable: false,
        y_rotatable: false,
        is_empty: false,
        is_fluid: false,
        is_waterloggable: false,
        is_waterlogging_fluid: false,
        is_opaque: false,
        is_see_through: true,
        is_transparent: [true; 6],
        transparent_standalone: true,
        occludes_fluid: false,
        is_plant: true,
        stack_group: 0,
        faces: vec![BlockFace::new(
            "one".to_string(),
            false,
            false,
            [0, 0, 0],
            [
                CornerData {
                    pos: [0.0, 1.0, 0.0],
                    uv: [0.0, 1.0],
                },
                CornerData {
                    pos: [0.0, 0.0, 0.0],
                    uv: [0.0, 0.0],
                },
                CornerData {
                    pos: [1.0, 1.0, 1.0],
                    uv: [1.0, 1.0],
                },
                CornerData {
                    pos: [1.0, 0.0, 1.0],
                    uv: [1.0, 0.0],
                },
            ],
        )],
        aabbs: vec![AABB {
            min_x: 0.0,
            min_y: 0.0,
            min_z: 0.0,
            max_x: 1.0,
            max_y: 1.0,
            max_z: 1.0,
        }],
        dynamic_patterns: None,
    }
}

/// The six cardinal face slots a fluid block needs before the mesher will
/// build stage-aware fluid geometry for it. `create_fluid_faces` supplies its
/// own corners, so only the names have to be right.
fn six_faces() -> Vec<BlockFace> {
    [
        ("px", [1, 0, 0]),
        ("nx", [-1, 0, 0]),
        ("py", [0, 1, 0]),
        ("ny", [0, -1, 0]),
        ("pz", [0, 0, 1]),
        ("nz", [0, 0, -1]),
    ]
    .into_iter()
    .map(|(name, dir)| BlockFace {
        name: name.to_string(),
        name_lower: name.to_string(),
        dir,
        ..Default::default()
    })
    .collect()
}

fn stairs_aabbs() -> Vec<AABB> {
    vec![
        AABB {
            min_x: 0.0,
            min_y: 0.0,
            min_z: 0.0,
            max_x: 1.0,
            max_y: 0.5,
            max_z: 1.0,
        },
        AABB {
            min_x: 0.0,
            min_y: 0.5,
            min_z: 0.0,
            max_x: 1.0,
            max_y: 1.0,
            max_z: 0.5,
        },
    ]
}

#[test]
fn diagonal_faces_are_not_greedy_meshable() {
    let block = full_block_diagonal_block();

    assert!(
        !can_greedy_mesh_block(&block, &BlockRotation::PY(0.0)),
        "Greedy meshing only emits cardinal faces, so diagonal faces must use the fallback path"
    );
}

#[test]
fn neighbor_cache_clamps_offsets_outside_window() {
    let cache = NeighborCache {
        data: [[0u32; 2]; 27],
    };

    // Custom or rotation-derived face dirs can step past the cached
    // 3x3x3 window; these must clamp instead of trapping the worker
    // with an out-of-bounds panic.
    assert_eq!(cache.get_all_lights(0, 0, 2), (0, 0, 0, 0));
    assert_eq!(cache.get_all_lights(2, -2, 3), (0, 0, 0, 0));
    assert_eq!(cache.get_voxel(-2, 0, 2), 0);
    assert_eq!(
        NeighborCache::offset_to_index(2, 1, 1),
        NeighborCache::offset_to_index(1, 1, 1),
    );
    assert_eq!(
        NeighborCache::offset_to_index(-2, -1, -1),
        NeighborCache::offset_to_index(-1, -1, -1),
    );
}

#[test]
fn greedy_meshing_emits_full_block_diagonal_faces() {
    let mut registry = Registry::new(vec![(1, full_block_diagonal_block())]);
    registry.build_cache();
    let space = SingleVoxelSpace::dry(1);
    let min = [0, 0, 0];
    let max = [1, 1, 1];

    let geometries = mesh_space_greedy(&min, &max, &space, &registry);
    let indices = geometries
        .iter()
        .map(|geometry| geometry.indices.len())
        .sum::<usize>();

    assert!(
        indices > 0,
        "Greedy meshing should emit diagonal plant geometry through the fallback path"
    );
}

#[test]
fn waterlogged_voxel_meshes_the_fluid_it_holds() {
    const WATER_ID: u32 = 2;

    let water = Block {
        is_fluid: true,
        is_waterlogging_fluid: true,
        is_see_through: true,
        is_transparent: [true; 6],
        faces: six_faces(),
        ..plain_block(WATER_ID, "Water")
    };
    let plant = Block {
        is_waterloggable: true,
        is_see_through: true,
        is_transparent: [true; 6],
        ..full_block_diagonal_block()
    };

    let air = Block {
        is_empty: true,
        aabbs: vec![],
        ..plain_block(0, "Air")
    };

    let mut registry = Registry::new(vec![(0, air), (1, plant), (WATER_ID, water)]);
    registry.build_cache();

    let min = [0, 0, 0];
    let max = [1, 1, 1];

    let dry = mesh_space_greedy(&min, &max, &SingleVoxelSpace::dry(1), &registry);
    assert!(
        dry.iter().all(|geometry| geometry.voxel != WATER_ID),
        "a dry plant must not draw any water",
    );

    let submerged = mesh_space_greedy(
        &min,
        &max,
        &SingleVoxelSpace {
            voxel_id: 1,
            is_waterlogged: true,
        },
        &registry,
    );
    assert!(
        submerged
            .iter()
            .any(|geometry| geometry.voxel == WATER_ID && !geometry.indices.is_empty()),
        "a waterlogged plant must draw the water it holds, or the surrounding \
         water leaves a block-shaped hole where it culled against this voxel",
    );
    assert!(
        submerged
            .iter()
            .any(|geometry| geometry.voxel == 1 && !geometry.indices.is_empty()),
        "a waterlogged plant must still draw itself",
    );

    let water_positions: Vec<[f32; 3]> = submerged
        .iter()
        .filter(|geometry| geometry.voxel == WATER_ID)
        .flat_map(|geometry| {
            geometry
                .positions
                .chunks_exact(3)
                .map(|pos| [pos[0], pos[1], pos[2]])
        })
        .collect();
    assert!(
        water_positions
            .iter()
            .any(|pos| (pos[1] - WATERLOG_FLUID_INSET).abs() < 1e-3),
        "waterlogged fluid floor should be inset by {WATERLOG_FLUID_INSET}, got {water_positions:?}",
    );
    assert!(
        water_positions.iter().any(|pos| {
            (pos[0] - WATERLOG_FLUID_INSET).abs() < 1e-3
                || (pos[0] - (1.0 - WATERLOG_FLUID_INSET)).abs() < 1e-3
                || (pos[2] - WATERLOG_FLUID_INSET).abs() < 1e-3
                || (pos[2] - (1.0 - WATERLOG_FLUID_INSET)).abs() < 1e-3
        }),
        "waterlogged fluid sides should be inset by {WATERLOG_FLUID_INSET}, got {water_positions:?}",
    );
}

#[test]
fn self_ao_stair_step_edge_vertex_gets_occlusion() {
    let aabbs = stairs_aabbs();
    let face_dir = [0, 1, 0];
    let face_bbox_min = [0.0, 0.5, 0.5];

    let step_edge = [0.0_f32, 0.5, 0.5];
    let (s011, s101, s110, s111) = compute_self_ao(step_edge, face_dir, face_bbox_min, &aabbs);

    assert!(
        s011 || s101 || s110 || s111,
        "step-edge vertex at {step_edge:?} must have at least one self-occluded direction, \
         got s011={s011} s101={s101} s110={s110} s111={s111}",
    );
}

#[test]
fn self_ao_stair_far_corner_no_occlusion() {
    let aabbs = stairs_aabbs();
    let face_dir = [0, 1, 0];
    let face_bbox_min = [0.0, 0.5, 0.5];

    let far_corner = [0.0_f32, 0.5, 1.0];
    let (s011, s101, s110, s111) = compute_self_ao(far_corner, face_dir, face_bbox_min, &aabbs);

    assert!(
        !s011 && !s101 && !s110 && !s111,
        "far corner at {far_corner:?} should have no self-occlusion, \
         got s011={s011} s101={s101} s110={s110} s111={s111}",
    );
}

#[test]
fn self_ao_stair_step_face_bottom_gets_occlusion() {
    let aabbs = stairs_aabbs();
    let face_dir = [0, 0, 1];
    let face_bbox_min = [0.0, 0.5, 0.5];

    let bottom_of_step = [0.5_f32, 0.5, 0.5];
    let (s011, s101, s110, s111) = compute_self_ao(bottom_of_step, face_dir, face_bbox_min, &aabbs);

    assert!(
        s011 || s101 || s110 || s111,
        "bottom of step face at {bottom_of_step:?} must have self-occlusion, \
         got s011={s011} s101={s101} s110={s110} s111={s111}",
    );
}

#[test]
fn should_apply_stair_self_ao_only_below_upper_tread_top() {
    assert!(!should_apply_stair_self_ao([0, 1, 0], [0.5, 1.0, 0.5]));
    assert!(should_apply_stair_self_ao([0, 1, 0], [0.5, 0.5, 0.5]));
}

#[test]
fn self_ao_stair_upper_tread_top_corners_have_no_self_occlusion() {
    let aabbs = stairs_aabbs();
    let face_dir = [0, 1, 0];
    let face_bbox_min = [0.0, 1.0, 0.0];

    for pos in [
        [0.0_f32, 1.0, 0.0],
        [1.0, 1.0, 0.0],
        [0.0, 1.0, 0.5],
        [1.0, 1.0, 0.5],
    ] {
        let (s011, s101, s110, s111) = compute_self_ao(pos, face_dir, face_bbox_min, &aabbs);
        assert!(
            !s011 && !s101 && !s110 && !s111,
            "upper tread top corner at {pos:?} should have no self-occlusion, \
             got s011={s011} s101={s101} s110={s110} s111={s111}",
        );
    }
}

#[test]
fn self_ao_stair_step_face_top_no_occlusion() {
    let aabbs = stairs_aabbs();
    let face_dir = [0, 0, 1];
    let face_bbox_min = [0.0, 0.5, 0.5];

    let top_of_step = [0.5_f32, 1.0, 0.5];
    let (s011, s101, s110, s111) = compute_self_ao(top_of_step, face_dir, face_bbox_min, &aabbs);

    assert!(
        !s011 && !s101 && !s110 && !s111,
        "top of step face at {top_of_step:?} should have no self-occlusion, \
         got s011={s011} s101={s101} s110={s110} s111={s111}",
    );
}

#[test]
fn self_ao_produces_correct_vertex_ao_values() {
    let aabbs = stairs_aabbs();
    let face_dir = [0, 1, 0];
    let face_bbox_min = [0.0, 0.5, 0.5];

    let step_edge = [0.5_f32, 0.5, 0.5];
    let (s011, _, s110, s111) = compute_self_ao(step_edge, face_dir, face_bbox_min, &aabbs);

    let b011 = !s011;
    let b110 = !s110;
    let b111 = !s111;
    let ao = vertex_ao(b110, b011, b111);

    assert!(
        ao < 3,
        "step-edge vertex should have ao < 3, got ao={ao}. \
         s011={s011} s110={s110} s111={s111}",
    );

    let far_corner = [0.5_f32, 0.5, 1.0];
    let (s011f, _, s110f, s111f) = compute_self_ao(far_corner, face_dir, face_bbox_min, &aabbs);

    let b011f = !s011f;
    let b110f = !s110f;
    let b111f = !s111f;
    let ao_far = vertex_ao(b110f, b011f, b111f);

    assert_eq!(ao_far, 3, "far corner should have ao=3, got ao={ao_far}");
}

#[test]
fn upward_stair_face_samples_light_from_opaque_block_above() {
    struct StairUnderStoneSpace {
        stair_id: u32,
        stone_id: u32,
    }

    impl VoxelAccess for StairUnderStoneSpace {
        fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
            match (vx, vy, vz) {
                (0, 0, 0) => self.stair_id,
                (0, 1, 0) => self.stone_id,
                _ => 0,
            }
        }

        fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
            self.get_voxel(vx, vy, vz)
        }

        fn get_voxel_rotation(&self, _vx: i32, _vy: i32, _vz: i32) -> BlockRotation {
            BlockRotation::PY(0.0)
        }

        fn get_voxel_stage(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
            0
        }

        fn get_voxel_waterlogged(&self, _vx: i32, _vy: i32, _vz: i32) -> bool {
            false
        }

        fn get_voxel_fluid_level(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
            0
        }

        fn get_sunlight(&self, vx: i32, vy: i32, vz: i32) -> u32 {
            self.get_all_lights(vx, vy, vz).0
        }

        fn get_torch_light(&self, vx: i32, vy: i32, vz: i32, color: LightColor) -> u32 {
            let (_, red, green, blue) = self.get_all_lights(vx, vy, vz);
            match color {
                LightColor::Red => red,
                LightColor::Green => green,
                LightColor::Blue => blue,
                LightColor::Sunlight => self.get_sunlight(vx, vy, vz),
            }
        }

        fn get_all_lights(&self, vx: i32, vy: i32, vz: i32) -> (u32, u32, u32, u32) {
            match (vx, vy, vz) {
                (0, 1, 0) => (15, 0, 0, 0),
                (0, 0, 0) => (0, 0, 0, 0),
                _ => (15, 0, 0, 0),
            }
        }

        fn get_max_height(&self, _vx: i32, _vz: i32) -> u32 {
            2
        }

        fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
            vy >= 0 && vy <= 1 && vx.abs() <= 1 && vz.abs() <= 1
        }
    }

    let stair_block = Block {
        id: 1,
        name: "Stairs".to_string(),
        name_lower: "stairs".to_string(),
        rotatable: true,
        y_rotatable: true,
        is_empty: false,
        is_fluid: false,
        is_waterloggable: false,
        is_waterlogging_fluid: false,
        is_opaque: false,
        is_see_through: false,
        is_transparent: [true; 6],
        transparent_standalone: false,
        occludes_fluid: false,
        is_plant: false,
        stack_group: 0,
        faces: vec![],
        aabbs: stairs_aabbs(),
        dynamic_patterns: None,
    };

    let stone_block = Block {
        id: 2,
        name: "Stone".to_string(),
        name_lower: "stone".to_string(),
        rotatable: false,
        y_rotatable: false,
        is_empty: false,
        is_fluid: false,
        is_waterloggable: false,
        is_waterlogging_fluid: false,
        is_opaque: true,
        is_see_through: false,
        is_transparent: [false; 6],
        transparent_standalone: false,
        occludes_fluid: false,
        is_plant: false,
        stack_group: 0,
        faces: vec![],
        aabbs: vec![AABB {
            min_x: 0.0,
            min_y: 0.0,
            min_z: 0.0,
            max_x: 1.0,
            max_y: 1.0,
            max_z: 1.0,
        }],
        dynamic_patterns: None,
    };

    let mut registry = Registry::new(vec![(1, stair_block), (2, stone_block)]);
    registry.build_cache();

    let space = StairUnderStoneSpace {
        stair_id: 1,
        stone_id: 2,
    };
    let neighbors = NeighborCache::populate(0, 0, 0, &space);
    let (_aos, lights) = compute_face_ao_and_light(
        [0, 1, 0],
        registry.get_block_by_id(1).unwrap(),
        &neighbors,
        &registry,
    );

    let mut max_sunlight = 0;
    for packed in lights {
        let (sun, _, _, _) = LightUtils::extract_all(packed as u32);
        max_sunlight = max_sunlight.max(sun);
    }

    assert!(
        max_sunlight > 0,
        "upward stair tread should bake non-zero sunlight from opaque block above, got max_sunlight={max_sunlight}",
    );
}

#[test]
fn should_skip_opaque_light_sample_only_for_inward_samples() {
    assert!(!should_skip_opaque_light_sample([0, 1, 0], 0, 1, 0, true));
    assert!(should_skip_opaque_light_sample([0, 1, 0], 0, 0, 0, true));
}

#[test]
fn self_ao_single_aabb_no_occlusion() {
    let aabbs = vec![AABB {
        min_x: 0.0,
        min_y: 0.0,
        min_z: 0.0,
        max_x: 1.0,
        max_y: 0.5,
        max_z: 1.0,
    }];

    let face_dir = [0, 1, 0];
    let face_bbox_min = [0.0, 0.5, 0.0];

    for pos in [
        [0.0_f32, 0.5, 0.0],
        [1.0, 0.5, 0.0],
        [0.0, 0.5, 1.0],
        [1.0, 0.5, 1.0],
    ] {
        let (s011, s101, s110, s111) = compute_self_ao(pos, face_dir, face_bbox_min, &aabbs);
        assert!(
            !s011 && !s101 && !s110 && !s111,
            "single-AABB slab vertex at {pos:?} should have no self-occlusion",
        );
    }
}

const WATER_EXPOSED_BIT: i32 = 1 << 21;

fn full_cube_aabb() -> Vec<AABB> {
    vec![AABB {
        min_x: 0.0,
        min_y: 0.0,
        min_z: 0.0,
        max_x: 1.0,
        max_y: 1.0,
        max_z: 1.0,
    }]
}

fn plain_block(id: u32, name: &str) -> Block {
    Block {
        id,
        name: name.to_string(),
        name_lower: name.to_lowercase(),
        rotatable: false,
        y_rotatable: false,
        is_empty: false,
        is_fluid: false,
        is_waterloggable: false,
        is_waterlogging_fluid: false,
        is_opaque: false,
        is_see_through: false,
        is_transparent: [false; 6],
        transparent_standalone: false,
        occludes_fluid: false,
        is_plant: false,
        stack_group: 0,
        faces: vec![],
        aabbs: full_cube_aabb(),
        dynamic_patterns: None,
    }
}

struct ColumnSpace {
    bottom_id: u32,
    top_id: u32,
    is_bottom_waterlogged: bool,
}

impl VoxelAccess for ColumnSpace {
    fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        match (vx, vy, vz) {
            (0, 0, 0) => self.bottom_id,
            (0, 1, 0) => self.top_id,
            _ => 0,
        }
    }

    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        self.get_voxel(vx, vy, vz)
    }

    fn get_voxel_rotation(&self, _vx: i32, _vy: i32, _vz: i32) -> BlockRotation {
        BlockRotation::PY(0.0)
    }

    fn get_voxel_stage(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
        0
    }

    fn get_voxel_waterlogged(&self, vx: i32, vy: i32, vz: i32) -> bool {
        self.is_bottom_waterlogged && (vx, vy, vz) == (0, 0, 0)
    }

    fn get_voxel_fluid_level(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
        0
    }

    fn get_sunlight(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
        15
    }

    fn get_torch_light(&self, _vx: i32, _vy: i32, _vz: i32, _color: LightColor) -> u32 {
        0
    }

    fn get_all_lights(&self, _vx: i32, _vy: i32, _vz: i32) -> (u32, u32, u32, u32) {
        (15, 0, 0, 0)
    }

    fn get_max_height(&self, _vx: i32, _vz: i32) -> u32 {
        2
    }

    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        vx.abs() <= 1 && (-1..=2).contains(&vy) && vz.abs() <= 1
    }
}

fn mesh_single_face(
    block: &Block,
    face: &BlockFace,
    registry: &Registry,
    space: &impl VoxelAccess,
) -> Vec<i32> {
    mesh_single_face_at_y(0, block, face, registry, space)
}

fn mesh_single_face_at_y(
    vy: i32,
    block: &Block,
    face: &BlockFace,
    registry: &Registry,
    space: &impl VoxelAccess,
) -> Vec<i32> {
    mesh_single_face_data_at_y(vy, block, face, registry, space).1
}

fn mesh_single_face_data_at_y(
    vy: i32,
    block: &Block,
    face: &BlockFace,
    registry: &Registry,
    space: &impl VoxelAccess,
) -> (Vec<f32>, Vec<i32>) {
    mesh_single_face_data_at([0, vy, 0], block, face, registry, space)
}

/// Positions come back in world coordinates (the mesh origin is the world
/// origin), so a corner shared by two voxels reads the same position from
/// either one's face.
fn mesh_single_face_data_at(
    [vx, vy, vz]: [i32; 3],
    block: &Block,
    face: &BlockFace,
    registry: &Registry,
    space: &impl VoxelAccess,
) -> (Vec<f32>, Vec<i32>) {
    let mut positions = vec![];
    let mut indices = vec![];
    let mut uvs = vec![];
    let mut lights = vec![];
    let neighbors = NeighborCache::populate(vx, vy, vz, space);
    process_face(
        vx,
        vy,
        vz,
        block.id,
        &BlockRotation::PY(0.0),
        face,
        block,
        &HashMap::new(),
        registry,
        space,
        &neighbors,
        false,
        block.is_fluid,
        &mut positions,
        &mut indices,
        &mut uvs,
        &mut lights,
        &[0, 0, 0],
        false,
    );
    (positions, lights)
}

#[test]
fn water_exposed_bit_marks_faces_touching_fluid_or_waterlogged_blocks() {
    let air = Block {
        is_empty: true,
        aabbs: vec![],
        ..plain_block(0, "Air")
    };
    let sand = Block {
        is_opaque: true,
        ..plain_block(1, "Sand")
    };
    let water = Block {
        is_fluid: true,
        is_see_through: true,
        is_transparent: [true; 6],
        ..plain_block(2, "Water")
    };
    let seagrass = Block {
        is_plant: true,
        is_waterloggable: true,
        is_see_through: true,
        is_transparent: [true; 6],
        aabbs: vec![],
        ..plain_block(3, "Seagrass")
    };

    let mut registry = Registry::new(vec![
        (0, air),
        (1, sand.clone()),
        (2, water),
        (3, seagrass.clone()),
    ]);
    registry.build_cache();

    let up_face = BlockFace {
        name: "py".to_string(),
        dir: [0, 1, 0],
        ..Default::default()
    };
    let cross_face = BlockFace {
        name: "one".to_string(),
        dir: [0, 0, 0],
        ..Default::default()
    };

    let submerged = ColumnSpace {
        bottom_id: 1,
        top_id: 2,
        is_bottom_waterlogged: false,
    };
    let submerged_lights = mesh_single_face(&sand, &up_face, &registry, &submerged);
    assert!(!submerged_lights.is_empty());
    assert!(
        submerged_lights
            .iter()
            .all(|packed| packed & WATER_EXPOSED_BIT != 0),
        "seabed face under water should carry the water-exposed bit",
    );

    let dry = ColumnSpace {
        bottom_id: 1,
        top_id: 0,
        is_bottom_waterlogged: false,
    };
    let dry_lights = mesh_single_face(&sand, &up_face, &registry, &dry);
    assert!(!dry_lights.is_empty());
    assert!(
        dry_lights
            .iter()
            .all(|packed| packed & WATER_EXPOSED_BIT == 0),
        "dry face under air should not carry the water-exposed bit",
    );

    let planted = ColumnSpace {
        bottom_id: 3,
        top_id: 2,
        is_bottom_waterlogged: true,
    };
    let plant_lights = mesh_single_face(&seagrass, &cross_face, &registry, &planted);
    assert!(!plant_lights.is_empty());
    assert!(
        plant_lights
            .iter()
            .all(|packed| packed & WATER_EXPOSED_BIT != 0),
        "waterlogged plant quads should carry the water-exposed bit",
    );

    let emerged = ColumnSpace {
        bottom_id: 3,
        top_id: 0,
        is_bottom_waterlogged: false,
    };
    let emerged_lights = mesh_single_face(&seagrass, &cross_face, &registry, &emerged);
    assert!(!emerged_lights.is_empty());
    assert!(
        emerged_lights
            .iter()
            .all(|packed| packed & WATER_EXPOSED_BIT == 0),
        "the same plant out of water should not carry the water-exposed bit",
    );
}

/// A stack is defined by the group, not by the block id, so a run may span
/// several ids the way the two halves of a door do.
#[test]
fn a_vertical_run_is_grouped_by_stack_group_not_block_id() {
    const LOWER_ID: u32 = 1;
    const UPPER_ID: u32 = 3;
    const GROUP: u16 = 7;

    let lower = Block {
        stack_group: GROUP,
        ..full_block_diagonal_block()
    };
    let upper_same_group = Block {
        id: UPPER_ID,
        name: "upper".to_string(),
        name_lower: "upper".to_string(),
        stack_group: GROUP,
        ..full_block_diagonal_block()
    };
    let upper_other_group = Block {
        stack_group: GROUP + 1,
        ..upper_same_group.clone()
    };
    let air = Block {
        is_empty: true,
        aabbs: vec![],
        ..plain_block(0, "Air")
    };

    let face = lower.faces[0].clone();

    let run_length = |upper: Block, top_id: u32| {
        let mut registry = Registry::new(vec![
            (0, air.clone()),
            (LOWER_ID, lower.clone()),
            (UPPER_ID, upper.clone()),
        ]);
        registry.build_cache();
        let space = ColumnSpace {
            bottom_id: LOWER_ID,
            top_id,
            is_bottom_waterlogged: false,
        };
        let lights = mesh_single_face(&lower, &face, &registry, &space);
        let count = ((lights[0] >> STACK_COUNT_SHIFT) & STACK_FIELD_BITS) + 1;
        let indices = lights
            .iter()
            .map(|light| (light >> STACK_INDEX_SHIFT) & STACK_FIELD_BITS)
            .collect::<Vec<_>>();
        assert_eq!(
            indices,
            vec![1, 0, 1, 0],
            "upper face vertices advance through the run while root vertices stay at zero",
        );
        if top_id == UPPER_ID && upper.stack_group == GROUP {
            let (lower_positions, _) =
                mesh_single_face_data_at_y(0, &lower, &face, &registry, &space);
            let (upper_positions, upper_lights) =
                mesh_single_face_data_at_y(1, &upper, &upper.faces[0], &registry, &space);
            let upper_indices = upper_lights
                .iter()
                .map(|light| (light >> STACK_INDEX_SHIFT) & STACK_FIELD_BITS)
                .collect::<Vec<_>>();
            assert_eq!(
                upper_indices,
                vec![2, 1, 2, 1],
                "the upper half must continue from the lower seam to the plant tip",
            );
            assert_eq!(
                [
                    lower_positions[0],
                    lower_positions[2],
                    lower_positions[6],
                    lower_positions[8],
                ],
                [
                    upper_positions[3],
                    upper_positions[5],
                    upper_positions[9],
                    upper_positions[11],
                ],
                "stacked plant halves must share the same horizontal jitter at their seam",
            );
        }
        count
    };

    assert_eq!(
        run_length(upper_same_group.clone(), UPPER_ID),
        2,
        "a different id sharing the group continues the run",
    );
    assert_eq!(
        run_length(upper_other_group, UPPER_ID),
        1,
        "a different group ends the run",
    );
    assert_eq!(run_length(upper_same_group, 0), 1, "air ends the run",);
}

/// A vertical run of one fluid centred on the origin, with an optional
/// waterlogged voxel standing in for a plant rooted part-way up it.
struct FluidColumnSpace {
    fluid_id: u32,
    plant_id: u32,
    above: i32,
    below: i32,
    waterlogged_offset: Option<i32>,
}

impl FluidColumnSpace {
    fn holds_column(&self, vx: i32, vy: i32, vz: i32) -> bool {
        vx == 0 && vz == 0 && (-self.below..=self.above).contains(&vy)
    }
}

impl VoxelAccess for FluidColumnSpace {
    fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if !self.holds_column(vx, vy, vz) {
            return 0;
        }
        if self.waterlogged_offset == Some(vy) {
            self.plant_id
        } else {
            self.fluid_id
        }
    }

    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        self.get_voxel(vx, vy, vz)
    }

    fn get_voxel_rotation(&self, _vx: i32, _vy: i32, _vz: i32) -> BlockRotation {
        BlockRotation::PY(0.0)
    }

    fn get_voxel_stage(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
        0
    }

    fn get_voxel_waterlogged(&self, vx: i32, vy: i32, vz: i32) -> bool {
        self.holds_column(vx, vy, vz) && self.waterlogged_offset == Some(vy)
    }

    fn get_voxel_fluid_level(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
        0
    }

    fn get_sunlight(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
        15
    }

    fn get_torch_light(&self, _vx: i32, _vy: i32, _vz: i32, _color: LightColor) -> u32 {
        0
    }

    fn get_all_lights(&self, _vx: i32, _vy: i32, _vz: i32) -> (u32, u32, u32, u32) {
        (15, 0, 0, 0)
    }

    fn get_max_height(&self, _vx: i32, _vz: i32) -> u32 {
        (self.above.max(0) + 1) as u32
    }

    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        vx.abs() <= 1 && vz.abs() <= 1 && (-self.below - 1..=self.above + 1).contains(&vy)
    }
}

/// What the shader derives from the packed run: how many blocks of fluid
/// stand above the voxel at the origin. Read off a side face, which is the
/// one face that meshes at every depth — a submerged voxel's top face is
/// culled against the water above it.
/// Decodes the packed column the way the shader does: a waving fluid vertex
/// sits on the surface, so its count is its index plus one and the count
/// field carries the flow instead.
fn fluid_blocks_above(space: &FluidColumnSpace, water: &Block, registry: &Registry) -> i32 {
    let face = water.faces[0].clone();
    let lights = mesh_single_face(water, &face, registry, space);
    let index = (lights[0] >> STACK_INDEX_SHIFT) & STACK_FIELD_BITS;
    let count = if lights[0] & WAVE_BIT != 0 {
        index + 1
    } else {
        ((lights[0] >> STACK_COUNT_SHIFT) & STACK_FIELD_BITS) + 1
    };
    count - 1 - index
}

/// A fluid fragment is shaded by how much fluid stands above it, so its run
/// has to be measured from the surface down. Read from the floor the way a
/// plant's run is, a voxel a few blocks under an ocean would report nothing
/// above it once the window filled from below, and the shader would paint
/// deep water as bright shallows.
#[test]
fn a_fluid_run_is_measured_down_from_its_surface() {
    const WATER_ID: u32 = 2;
    const KELP_ID: u32 = 3;

    let air = Block {
        is_empty: true,
        aabbs: vec![],
        ..plain_block(0, "Air")
    };
    let water = Block {
        is_fluid: true,
        is_waterlogging_fluid: true,
        is_see_through: true,
        is_transparent: [true; 6],
        faces: vec![BlockFace::new(
            "px".to_string(),
            false,
            false,
            [1, 0, 0],
            [
                CornerData {
                    pos: [1.0, 1.0, 0.0],
                    uv: [0.0, 1.0],
                },
                CornerData {
                    pos: [1.0, 0.0, 0.0],
                    uv: [0.0, 0.0],
                },
                CornerData {
                    pos: [1.0, 1.0, 1.0],
                    uv: [1.0, 1.0],
                },
                CornerData {
                    pos: [1.0, 0.0, 1.0],
                    uv: [1.0, 0.0],
                },
            ],
        )],
        ..plain_block(WATER_ID, "Water")
    };
    let kelp = Block {
        is_plant: true,
        is_waterloggable: true,
        is_see_through: true,
        is_transparent: [true; 6],
        aabbs: vec![],
        ..plain_block(KELP_ID, "Kelp")
    };

    let mut registry = Registry::new(vec![(0, air), (WATER_ID, water.clone()), (KELP_ID, kelp)]);
    registry.build_cache();

    let column = |above: i32, below: i32, waterlogged_offset: Option<i32>| FluidColumnSpace {
        fluid_id: WATER_ID,
        plant_id: KELP_ID,
        above,
        below,
        waterlogged_offset,
    };

    assert_eq!(
        fluid_blocks_above(&column(0, 1, None), &water, &registry),
        0,
        "the top of a puddle has nothing above it",
    );
    assert_eq!(
        fluid_blocks_above(&column(1, 0, None), &water, &registry),
        1,
        "the floor of a two-deep puddle has one block above it",
    );
    assert_eq!(
        fluid_blocks_above(&column(3, 36, None), &water, &registry),
        3,
        "depth is measured from the surface, however much water is underneath",
    );
    assert_eq!(
        fluid_blocks_above(&column(40, 40, None), &water, &registry),
        STACK_MAX as i32 - 1,
        "a run past the field width saturates deep rather than reporting a surface",
    );
    assert_eq!(
        fluid_blocks_above(&column(2, 0, Some(1)), &water, &registry),
        2,
        "a waterlogged voxel is still water and does not cut the run in half",
    );
}

/// A block that opts out of stacking must not disturb any other field.
#[test]
fn an_ungrouped_block_writes_no_stack_bits() {
    let block = full_block_diagonal_block();
    assert_eq!(block.stack_group, 0);

    let air = Block {
        is_empty: true,
        aabbs: vec![],
        ..plain_block(0, "Air")
    };
    let mut registry = Registry::new(vec![(0, air), (1, block.clone())]);
    registry.build_cache();

    let space = ColumnSpace {
        bottom_id: 1,
        top_id: 1,
        is_bottom_waterlogged: false,
    };
    let lights = mesh_single_face(&block, &block.faces[0], &registry, &space);

    for light in lights {
        assert_eq!(
            light >> STACK_INDEX_SHIFT,
            0,
            "an ungrouped block left stack bits set",
        );
    }
}

/// An emissive face packs `EMISSIVE_BIT` and its quantized strength index in
/// the AO bits, on the per-face path; a plain face of the same block does not.
#[test]
fn emissive_faces_pack_the_bit_and_strength_index() {
    let air = Block {
        is_empty: true,
        aabbs: vec![],
        ..plain_block(0, "Air")
    };
    let mut lantern = Block {
        is_opaque: true,
        faces: six_faces(),
        ..plain_block(1, "Lantern")
    };
    // Only the top face glows, at strength 1.75 -> index 1.
    lantern
        .faces
        .iter_mut()
        .find(|face| face.name == "py")
        .unwrap()
        .emissive = 1.75;

    let mut registry = Registry::new(vec![(0, air), (1, lantern.clone())]);
    registry.build_cache();

    let space = ColumnSpace {
        bottom_id: 1,
        top_id: 0,
        is_bottom_waterlogged: false,
    };

    let glowing_face = lantern.faces.iter().find(|f| f.name == "py").unwrap();
    let glowing = mesh_single_face(&lantern, glowing_face, &registry, &space);
    assert!(!glowing.is_empty());
    for packed in &glowing {
        assert_ne!(packed & EMISSIVE_BIT, 0, "emissive face lost its bit");
        assert_eq!(
            (packed >> AO_SHIFT) & AO_BITS,
            1,
            "strength 1.75 should quantize to level index 1",
        );
    }

    let plain_face = lantern.faces.iter().find(|f| f.name == "pz").unwrap();
    let plain = mesh_single_face(&lantern, plain_face, &registry, &space);
    assert!(!plain.is_empty());
    for packed in &plain {
        assert_eq!(packed & EMISSIVE_BIT, 0, "plain face gained the bit");
    }
}

/// The greedy path must carry the emissive bits onto merged quads, alongside
/// its own greedy flag.
#[test]
fn greedy_quads_carry_emissive_bits() {
    let air = Block {
        is_empty: true,
        aabbs: vec![],
        ..plain_block(0, "Air")
    };
    let glowstone = Block {
        is_opaque: true,
        faces: six_faces()
            .into_iter()
            .map(|mut face| {
                face.emissive = 2.5;
                face
            })
            .collect(),
        ..plain_block(1, "Glowstone")
    };

    let mut registry = Registry::new(vec![(0, air), (1, glowstone)]);
    registry.build_cache();

    let space = SingleVoxelSpace::dry(1);
    let geometries = mesh_space_greedy(&[0, 0, 0], &[1, 1, 1], &space, &registry);

    let mut packed_lights = 0;
    for geometry in &geometries {
        for packed in &geometry.lights {
            packed_lights += 1;
            assert_ne!(
                packed & EMISSIVE_BIT,
                0,
                "greedy quad lost the emissive bit"
            );
            assert_eq!(
                (packed >> AO_SHIFT) & AO_BITS,
                2,
                "strength 2.5 should quantize to level index 2",
            );
            assert_ne!(packed & GREEDY_BIT, 0, "quad lost the greedy flag");
        }
    }
    assert!(packed_lights > 0, "the glowstone meshed nothing");
}

/// A vertical fluid face is drawn as a tank window only when it presses
/// against a see-through solid. Against air it is the water's own surface
/// and must carry no pane flag, or a spreading flow's edge walls fade and
/// drop out head-on, leaving its top face floating unconnected. The pane
/// flag rides the greedy bit, which a fluid face never otherwise sets.
#[test]
fn a_fluid_wall_is_a_pane_only_against_a_see_through_solid() {
    const WATER_ID: u32 = 2;
    const GLASS_ID: u32 = 3;

    let air = Block {
        is_empty: true,
        aabbs: vec![],
        ..plain_block(0, "Air")
    };
    let water = Block {
        is_fluid: true,
        is_waterlogging_fluid: true,
        is_see_through: true,
        is_transparent: [true; 6],
        faces: six_faces(),
        ..plain_block(WATER_ID, "Water")
    };
    let glass = Block {
        is_see_through: true,
        is_transparent: [true; 6],
        transparent_standalone: true,
        faces: six_faces(),
        ..plain_block(GLASS_ID, "Glass")
    };

    let mut registry = Registry::new(vec![(0, air), (WATER_ID, water.clone()), (GLASS_ID, glass)]);
    registry.build_cache();

    // Water at the origin with glass on +x and air everywhere else.
    let space = SparseSpace::new(&[((0, 0, 0), (WATER_ID, 0)), ((1, 0, 0), (GLASS_ID, 0))]);
    let faces = create_fluid_faces(0, 0, 0, WATER_ID, &space, &water.faces, &registry);
    let lights_of = |name: &str| {
        let face = faces
            .iter()
            .find(|face| face.name == name)
            .unwrap_or_else(|| panic!("fluid meshing emits a {name} face"));
        mesh_single_face(&water, face, &registry, &space)
    };

    let against_glass = lights_of("px");
    assert!(
        !against_glass.is_empty() && against_glass.iter().all(|l| l & FLUID_PANE_BIT != 0),
        "the wall against glass is a pane: {against_glass:?}",
    );
    for name in ["nx", "pz", "nz"] {
        let against_air = lights_of(name);
        assert!(
            !against_air.is_empty() && against_air.iter().all(|l| l & FLUID_PANE_BIT == 0),
            "the {name} wall against air is the water's own surface, not a pane: {against_air:?}",
        );
    }
    assert!(
        lights_of("py").iter().all(|l| l & FLUID_PANE_BIT == 0),
        "only vertical faces can be panes",
    );
}

/// A slab is non-opaque, but it is not a window: it leaves the upper half of
/// the face it shares with the water open to air, so the water standing
/// above it draws as the water's own surface. Flagging it a pane had the
/// shader drop the face head-on, cutting a hole into a flow wherever it ran
/// beside a slab. The same reading applies to a see-through block that only
/// partly covers the shared plane; a see-through full cube stays a pane.
#[test]
fn a_fluid_wall_beside_a_partial_block_is_the_waters_own_surface() {
    const WATER_ID: u32 = 2;
    const SLAB_ID: u32 = 3;
    const GLASS_SLAB_ID: u32 = 4;
    const GLASS_ID: u32 = 5;

    let air = Block {
        is_empty: true,
        aabbs: vec![],
        ..plain_block(0, "Air")
    };
    let water = Block {
        is_fluid: true,
        is_waterlogging_fluid: true,
        is_see_through: true,
        is_transparent: [true; 6],
        faces: six_faces(),
        ..plain_block(WATER_ID, "Water")
    };
    let bottom_half = vec![AABB {
        min_x: 0.0,
        min_y: 0.0,
        min_z: 0.0,
        max_x: 1.0,
        max_y: 0.5,
        max_z: 1.0,
    }];
    // Slabs are registered transparent on every side but the one they rest
    // on, so they are non-opaque without being see-through.
    let slab = Block {
        is_transparent: [true, true, true, true, false, true],
        faces: six_faces(),
        aabbs: bottom_half.clone(),
        ..plain_block(SLAB_ID, "Stone Slab Bottom")
    };
    let glass_slab = Block {
        is_see_through: true,
        is_transparent: [true; 6],
        faces: six_faces(),
        aabbs: bottom_half,
        ..plain_block(GLASS_SLAB_ID, "Glass Slab Bottom")
    };
    let glass = Block {
        is_see_through: true,
        is_transparent: [true; 6],
        transparent_standalone: true,
        faces: six_faces(),
        ..plain_block(GLASS_ID, "Glass")
    };

    let mut registry = Registry::new(vec![
        (0, air),
        (WATER_ID, water.clone()),
        (SLAB_ID, slab),
        (GLASS_SLAB_ID, glass_slab),
        (GLASS_ID, glass),
    ]);
    registry.build_cache();

    // Spreading water (stage 2, so its surface stands above the slab tops)
    // with a slab on +x, a glass slab on -x, glass on +z and air on -z.
    let space = SparseSpace::new(&[
        ((0, 0, 0), (WATER_ID, 2)),
        ((1, 0, 0), (SLAB_ID, 0)),
        ((-1, 0, 0), (GLASS_SLAB_ID, 0)),
        ((0, 0, 1), (GLASS_ID, 0)),
    ]);
    let faces = create_fluid_faces(0, 0, 0, WATER_ID, &space, &water.faces, &registry);
    let lights_of = |name: &str| {
        let face = faces
            .iter()
            .find(|face| face.name == name)
            .unwrap_or_else(|| panic!("fluid meshing emits a {name} face"));
        mesh_single_face(&water, face, &registry, &space)
    };

    let beside_slab = lights_of("px");
    assert!(
        !beside_slab.is_empty(),
        "the wall beside a slab is emitted: the slab covers only its lower half",
    );
    assert!(
        beside_slab.iter().all(|l| l & FLUID_PANE_BIT == 0),
        "the wall beside a slab is the water's own surface, not a pane: {beside_slab:?}",
    );

    let beside_glass_slab = lights_of("nx");
    assert!(
        !beside_glass_slab.is_empty() && beside_glass_slab.iter().all(|l| l & FLUID_PANE_BIT == 0),
        "a see-through block covering half the shared face is not a window: {beside_glass_slab:?}",
    );

    let against_glass = lights_of("pz");
    assert!(
        !against_glass.is_empty() && against_glass.iter().all(|l| l & FLUID_PANE_BIT != 0),
        "a see-through full cube is still a pane: {against_glass:?}",
    );

    let against_air = lights_of("nz");
    assert!(
        !against_air.is_empty() && against_air.iter().all(|l| l & FLUID_PANE_BIT == 0),
        "the wall against air is unchanged: {against_air:?}",
    );
}

/// The flow field a surface vertex carries points downhill along the
/// rendered surface — away from the source of a spread — is still on a
/// resting pool, and is read at the shared corner so neighbouring faces
/// agree. A vertex with fluid above it keeps its column count instead.
#[test]
fn a_surface_vertex_carries_the_downhill_flow_of_its_corner() {
    const WATER_ID: u32 = 2;

    let air = Block {
        is_empty: true,
        aabbs: vec![],
        ..plain_block(0, "Air")
    };
    let water = Block {
        is_fluid: true,
        is_waterlogging_fluid: true,
        is_see_through: true,
        is_transparent: [true; 6],
        faces: six_faces(),
        ..plain_block(WATER_ID, "Water")
    };
    let mut registry = Registry::new(vec![(0, air), (WATER_ID, water.clone())]);
    registry.build_cache();

    // The surface vertices of the voxel at the origin, as (x, flow code).
    let surface_flows = |space: &SparseSpace| -> Vec<(f32, u32)> {
        let faces = create_fluid_faces(0, 0, 0, WATER_ID, space, &water.faces, &registry);
        let top = faces.iter().find(|f| f.name == "py").expect("a top face");
        let (positions, lights) = mesh_single_face_data_at_y(0, &water, top, &registry, space);
        lights
            .iter()
            .enumerate()
            .map(|(i, light)| {
                assert_ne!(light & WAVE_BIT, 0, "a top-face vertex waves");
                (
                    positions[i * 3],
                    ((light >> FLOW_SHIFT) & FLOW_FIELD_BITS) as u32,
                )
            })
            .collect()
    };

    // A spread along x from a source at the origin: stage rises both ways.
    let spread = SparseSpace::new(&[
        ((-2, 0, 0), (WATER_ID, 2)),
        ((-1, 0, 0), (WATER_ID, 1)),
        ((0, 0, 0), (WATER_ID, 0)),
        ((1, 0, 0), (WATER_ID, 1)),
        ((2, 0, 0), (WATER_ID, 2)),
    ]);
    for (x, code) in surface_flows(&spread) {
        let [dx, dz] = flow_direction(code).expect("a spread flows");
        assert!(
            dz.abs() < 0.25,
            "a spread along x has no cross-flow, got ({dx}, {dz}) at x={x}"
        );
        if x > 0.5 {
            assert!(dx > 0.95, "the +x corners run toward +x, got {dx}");
        } else {
            assert!(dx < -0.95, "the -x corners run toward -x, got {dx}");
        }
    }

    // Neighbouring faces read the same corner: the +x corners of the source
    // are the -x corners of the voxel beside it.
    let beside = SparseSpace::new(&[
        ((-3, 0, 0), (WATER_ID, 2)),
        ((-2, 0, 0), (WATER_ID, 1)),
        ((-1, 0, 0), (WATER_ID, 0)),
        ((0, 0, 0), (WATER_ID, 1)),
        ((1, 0, 0), (WATER_ID, 2)),
    ]);
    let source_px: Vec<u32> = surface_flows(&spread)
        .into_iter()
        .filter(|(x, _)| *x > 0.5)
        .map(|(_, code)| code)
        .collect();
    let neighbour_nx: Vec<u32> = surface_flows(&beside)
        .into_iter()
        .filter(|(x, _)| *x < 0.5)
        .map(|(_, code)| code)
        .collect();
    assert_eq!(
        source_px, neighbour_nx,
        "a shared corner packs one direction"
    );

    // The middle of a resting pool is still.
    let mut pool = vec![];
    for x in -1..=1 {
        for z in -1..=1 {
            pool.push(((x, 0, z), (WATER_ID, 0)));
        }
    }
    let pool = SparseSpace::new(&pool);
    for (x, code) in surface_flows(&pool) {
        assert_eq!(code, FLOW_STILL, "still water at x={x}");
    }

    // Under more fluid a vertex does not wave, and the field is its count.
    let submerged = SparseSpace::new(&[((0, 0, 0), (WATER_ID, 0)), ((0, 1, 0), (WATER_ID, 0))]);
    let faces = create_fluid_faces(0, 0, 0, WATER_ID, &submerged, &water.faces, &registry);
    let side = faces.iter().find(|f| f.name == "px").expect("a side face");
    let lights = mesh_single_face(&water, side, &registry, &submerged);
    assert!(!lights.is_empty());
    for light in lights {
        assert_eq!(light & WAVE_BIT, 0, "nothing waves under the surface");
        assert_eq!(
            ((light >> STACK_COUNT_SHIFT) & STACK_FIELD_BITS) + 1,
            2,
            "a two-block column reports its count"
        );
    }
}

/// The depth a surface vertex carries is the mean over the columns sharing
/// its corner, so the floor shading ramps across a step in the bed. A
/// per-voxel count drew the pit under a pool as a hard-edged rectangle on
/// the surface — the depth jumped at the face border while the floor it
/// shaded rippled underneath.
#[test]
fn a_surface_vertex_carries_the_mean_depth_of_its_corner() {
    const WATER_ID: u32 = 2;

    let air = Block {
        is_empty: true,
        aabbs: vec![],
        ..plain_block(0, "Air")
    };
    let water = Block {
        is_fluid: true,
        is_waterlogging_fluid: true,
        is_see_through: true,
        is_transparent: [true; 6],
        faces: six_faces(),
        ..plain_block(WATER_ID, "Water")
    };
    let mut registry = Registry::new(vec![(0, air), (WATER_ID, water.clone())]);
    registry.build_cache();

    // A 3x3 pool one block deep at y=1, with a 2x2 pit under its -x/-z
    // quadrant: the columns at x, z in {-1, 0} hold water at y=0 too.
    let mut voxels = vec![];
    for x in -1..=1 {
        for z in -1..=1 {
            voxels.push(((x, 1, z), (WATER_ID, 0)));
            if x <= 0 && z <= 0 {
                voxels.push(((x, 0, z), (WATER_ID, 0)));
            }
        }
    }
    let space = SparseSpace::new(&voxels);

    // The origin's top face at y=1: its four corners each touch a different
    // mix of pit (one block below) and shelf (nothing below) columns.
    let faces = create_fluid_faces(0, 1, 0, WATER_ID, &space, &water.faces, &registry);
    let top = faces.iter().find(|f| f.name == "py").expect("a top face");
    let (positions, lights) = mesh_single_face_data_at_y(1, &water, top, &registry, &space);
    assert_eq!(lights.len(), 4, "a top face has four vertices");

    let units = SURFACE_DEPTH_UNITS_PER_BLOCK;
    for (i, light) in lights.iter().enumerate() {
        assert_ne!(light & WAVE_BIT, 0, "a top-face vertex waves");
        let corner_x = positions[i * 3].round() as i32;
        let corner_z = positions[i * 3 + 2].round() as i32;
        // Columns around the corner point (cx, cz) are x in {cx-1, cx} and
        // z in {cz-1, cz}; a column is over the pit when x <= 0 and z <= 0.
        let mut pit_columns = 0;
        for x in [corner_x - 1, corner_x] {
            for z in [corner_z - 1, corner_z] {
                if x <= 0 && z <= 0 {
                    pit_columns += 1;
                }
            }
        }
        let expected_blocks = pit_columns as f32 / 4.0;
        let code = ((light >> STACK_INDEX_SHIFT) & STACK_FIELD_BITS) as f32;
        assert_eq!(
            code,
            (expected_blocks * units).round(),
            "corner ({corner_x}, {corner_z}) over {pit_columns} pit column(s) carries their mean depth",
        );
    }

    // The corner every one of the four pit columns shares reads a full
    // block; the corner three shelf columns share reads a quarter.
    let code_at = |cx: i32, cz: i32| -> Option<i32> {
        lights.iter().enumerate().find_map(|(i, light)| {
            (positions[i * 3].round() as i32 == cx && positions[i * 3 + 2].round() as i32 == cz)
                .then(|| (light >> STACK_INDEX_SHIFT) & STACK_FIELD_BITS)
        })
    };
    assert_eq!(code_at(0, 0), Some(units as i32));
    assert_eq!(code_at(1, 1), Some(1));

    // The same corner from the neighbouring face packs the same depth.
    let beside = create_fluid_faces(1, 1, 0, WATER_ID, &space, &water.faces, &registry);
    let beside_top = beside.iter().find(|f| f.name == "py").expect("a top face");
    let (beside_positions, beside_lights) =
        mesh_single_face_data_at([1, 1, 0], &water, beside_top, &registry, &space);
    let beside_code_at = |cx: i32, cz: i32| -> Option<i32> {
        beside_lights.iter().enumerate().find_map(|(i, light)| {
            (beside_positions[i * 3].round() as i32 == cx
                && beside_positions[i * 3 + 2].round() as i32 == cz)
                .then(|| (light >> STACK_INDEX_SHIFT) & STACK_FIELD_BITS)
        })
    };
    assert_eq!(
        beside_code_at(1, 0),
        code_at(1, 0),
        "a shared corner packs one depth"
    );
    assert_eq!(
        beside_code_at(1, 1),
        code_at(1, 1),
        "a shared corner packs one depth"
    );
}

/// A dense 32x32 column of sea over a sloping stone bed, one voxel of
/// margin all round, for timing the mesher on the worst case the surface
/// walks meet: every top-level voxel is a water surface with four corners
/// to read, and every column is deep.
struct OceanSpace {
    size: i32,
    height: i32,
    sea_level: i32,
    voxels: Vec<u32>,
    stone_id: u32,
    water_id: u32,
}

impl OceanSpace {
    fn new(size: i32, height: i32, sea_level: i32, stone_id: u32, water_id: u32) -> Self {
        let span = size + 2;
        let mut voxels = vec![0u32; (span * height * span) as usize];
        for x in -1..=size {
            for z in -1..=size {
                // Bed falls from one block under the surface at the west edge
                // to eight blocks under it at the east, in whole steps.
                let bed = sea_level - 1 - ((x + 1) * 8 / (size + 2)).clamp(0, 7);
                for y in 0..height {
                    // `water_id == 0` drains the sea: the same bed under air.
                    let id = if y <= bed {
                        stone_id
                    } else if y <= sea_level {
                        water_id
                    } else {
                        0
                    };
                    let i = (((x + 1) * height + y) * span + (z + 1)) as usize;
                    voxels[i] = id;
                }
            }
        }
        Self {
            size,
            height,
            sea_level,
            voxels,
            stone_id,
            water_id,
        }
    }

    /// Raise the bed to one flat level everywhere, keeping the sea above it.
    fn with_flat_bed(mut self, bed: i32) -> Self {
        let span = self.size + 2;
        for x in -1..=self.size {
            for z in -1..=self.size {
                for y in 0..self.height {
                    let id = if y <= bed {
                        self.stone_id
                    } else if y <= self.sea_level {
                        self.water_id
                    } else {
                        0
                    };
                    self.voxels[(((x + 1) * self.height + y) * span + (z + 1)) as usize] = id;
                }
            }
        }
        self
    }
}

impl VoxelAccess for OceanSpace {
    fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if !self.contains(vx, vy, vz) {
            return 0;
        }
        let span = self.size + 2;
        self.voxels[(((vx + 1) * self.height + vy) * span + (vz + 1)) as usize]
    }

    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        self.get_voxel(vx, vy, vz)
    }

    fn get_voxel_rotation(&self, _vx: i32, _vy: i32, _vz: i32) -> BlockRotation {
        BlockRotation::PY(0.0)
    }

    fn get_voxel_stage(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
        0
    }

    fn get_voxel_waterlogged(&self, _vx: i32, _vy: i32, _vz: i32) -> bool {
        false
    }

    fn get_voxel_fluid_level(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
        0
    }

    fn get_sunlight(&self, _vx: i32, vy: i32, _vz: i32) -> u32 {
        if vy > self.sea_level {
            15
        } else {
            (15 - (self.sea_level - vy)).max(0) as u32
        }
    }

    fn get_torch_light(&self, _vx: i32, _vy: i32, _vz: i32, _color: LightColor) -> u32 {
        0
    }

    fn get_all_lights(&self, vx: i32, vy: i32, vz: i32) -> (u32, u32, u32, u32) {
        (self.get_sunlight(vx, vy, vz), 0, 0, 0)
    }

    fn get_max_height(&self, _vx: i32, _vz: i32) -> u32 {
        (self.sea_level + 1) as u32
    }

    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        vx >= -1 && vx <= self.size && vz >= -1 && vz <= self.size && vy >= 0 && vy < self.height
    }
}

fn ocean_registry(stone_id: u32, water_id: u32) -> (Registry, Block, Block) {
    let air = Block {
        is_empty: true,
        aabbs: vec![],
        ..plain_block(0, "Air")
    };
    let stone = Block {
        is_opaque: true,
        faces: six_faces(),
        ..plain_block(stone_id, "Stone")
    };
    let water = Block {
        is_fluid: true,
        is_waterlogging_fluid: true,
        is_see_through: true,
        is_transparent: [true; 6],
        faces: six_faces(),
        ..plain_block(water_id, "Water")
    };
    let mut registry = Registry::new(vec![
        (0, air),
        (stone_id, stone.clone()),
        (water_id, water.clone()),
    ]);
    registry.build_cache();
    (registry, stone, water)
}

/// Timing, not a test: how long a 32x32 sea chunk takes to mesh, and how
/// the two per-corner surface walks (flow, depth) split that. Run with
/// `cargo test -p voxelize-mesher --release -- --ignored --nocapture
/// bench_ocean`. Prints; asserts nothing, because a threshold would fail on
/// a loaded machine and pass on an idle one without telling anyone anything.
#[test]
#[ignore]
fn bench_ocean_chunk_meshing() {
    const STONE_ID: u32 = 1;
    const WATER_ID: u32 = 2;
    let (registry, _stone, water) = ocean_registry(STONE_ID, WATER_ID);
    let space = OceanSpace::new(32, 72, 63, STONE_ID, WATER_ID);
    let min = [0, 0, 0];
    let max = [32, 72, 32];

    let time_mesh = |label: &str, space: &OceanSpace| {
        let _ = mesh_space_greedy(&min, &max, space, &registry);
        let rounds = 20;
        let started = std::time::Instant::now();
        let mut faces = 0usize;
        for _ in 0..rounds {
            let geometries = mesh_space_greedy(&min, &max, space, &registry);
            faces += geometries
                .iter()
                .map(|g| g.indices.len() / 6)
                .sum::<usize>();
        }
        println!(
            "{label}: {:?} per mesh, {} faces",
            started.elapsed() / rounds,
            faces / rounds as usize
        );
    };
    time_mesh("ocean chunk 32x32, sea up to 8 deep", &space);
    time_mesh(
        "same bed drained (air over stone)",
        &OceanSpace::new(32, 72, 63, STONE_ID, 0),
    );
    time_mesh(
        "sea one block deep over a flat bed",
        &OceanSpace::new(32, 72, 63, STONE_ID, WATER_ID).with_flat_bed(62),
    );

    // The corner walks in isolation, over every surface corner in the chunk.
    let rounds = 20u32;
    let corners: Vec<(i32, i32)> = (0..=32)
        .flat_map(|x| (0..=32).map(move |z| (x, z)))
        .collect();
    let started = std::time::Instant::now();
    let mut acc = 0.0f32;
    for _ in 0..rounds {
        for &(cx, cz) in &corners {
            acc += surface_depth_at_corner(cx, 63, cz, WATER_ID, &registry, &space);
        }
    }
    let depth_per_corner = started.elapsed() / (rounds * corners.len() as u32);
    let started = std::time::Instant::now();
    let mut flows = 0usize;
    for _ in 0..rounds {
        for &(cx, cz) in &corners {
            flows += surface_flow_at_corner(
                cx,
                63,
                cz,
                WATER_ID,
                water.is_waterlogging_fluid,
                &space,
                &registry,
            )
            .is_some() as usize;
        }
    }
    let flow_per_corner = started.elapsed() / (rounds * corners.len() as u32);
    println!(
        "per surface corner: depth {:?}, flow {:?} (checksums {acc:.1} {flows})",
        depth_per_corner, flow_per_corner
    );
    println!(
        "per chunk of 1024 surface faces x 4 corners: depth {:?}, flow {:?}",
        depth_per_corner * 4096,
        flow_per_corner * 4096
    );
}

/// A sparse world: any voxel not listed is air.
struct SparseSpace {
    voxels: HashMap<(i32, i32, i32), (u32, u32)>,
}

impl SparseSpace {
    fn new(voxels: &[((i32, i32, i32), (u32, u32))]) -> Self {
        Self {
            voxels: voxels.iter().copied().collect(),
        }
    }
}

impl VoxelAccess for SparseSpace {
    fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        self.voxels.get(&(vx, vy, vz)).map_or(0, |(id, _)| *id)
    }

    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        self.get_voxel(vx, vy, vz)
    }

    fn get_voxel_rotation(&self, _vx: i32, _vy: i32, _vz: i32) -> BlockRotation {
        BlockRotation::PY(0.0)
    }

    fn get_voxel_stage(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
        0
    }

    fn get_voxel_waterlogged(&self, _vx: i32, _vy: i32, _vz: i32) -> bool {
        false
    }

    fn get_voxel_fluid_level(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        self.voxels
            .get(&(vx, vy, vz))
            .map_or(0, |(_, level)| *level)
    }

    fn get_sunlight(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
        15
    }

    fn get_torch_light(&self, _vx: i32, _vy: i32, _vz: i32, _color: LightColor) -> u32 {
        0
    }

    fn get_all_lights(&self, _vx: i32, _vy: i32, _vz: i32) -> (u32, u32, u32, u32) {
        (15, 0, 0, 0)
    }

    fn get_max_height(&self, _vx: i32, _vz: i32) -> u32 {
        4
    }

    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        vx.abs() <= 2 && vz.abs() <= 2 && (-1..=3).contains(&vy)
    }
}

/// The `+x +z` corner of the water surface at the origin, exactly as meshed:
/// a partial corner sits `FLUID_SURFACE_OFFSET` under its computed height, a
/// full corner on the voxel boundary unless a ceiling occupies it.
fn water_pxpz_corner_height(space: &SparseSpace, water: &Block, registry: &Registry) -> f32 {
    let faces = create_fluid_faces(0, 0, 0, water.id, space, &water.faces, registry);
    let top = faces
        .iter()
        .find(|face| face.name == "py")
        .expect("fluid meshing emits a top face");
    let corner = top
        .corners
        .iter()
        .find(|corner| corner.pos[0] == 1.0 && corner.pos[2] == 1.0)
        .expect("the top face has a +x +z corner");
    corner.pos[1]
}

/// A partial corner as meshed: its computed height less the surface offset.
fn resting(height: f32) -> f32 {
    height - fluid::FLUID_SURFACE_OFFSET
}

/// The diagonal voxel across a corner only shares a vertical edge with this
/// one; the surface reaches it through one of the two side voxels. With
/// both sides solid the diagonal is walled off, and its water must not be
/// read through the wall — that dragged a still pond's corner down toward a
/// lower-stage pool on the far side of two placed planks, and pulled it up
/// to a full block when a deeper pool stood there.
#[test]
fn a_fluid_corner_ignores_the_diagonal_walled_off_by_two_solid_sides() {
    const WATER_ID: u32 = 2;
    const PLANKS_ID: u32 = 3;

    let air = Block {
        is_empty: true,
        aabbs: vec![],
        ..plain_block(0, "Air")
    };
    let water = Block {
        is_fluid: true,
        is_waterlogging_fluid: true,
        is_see_through: true,
        is_transparent: [true; 6],
        faces: six_faces(),
        ..plain_block(WATER_ID, "Water")
    };
    let planks = Block {
        is_opaque: true,
        ..plain_block(PLANKS_ID, "Planks")
    };

    let mut registry = Registry::new(vec![
        (0, air),
        (WATER_ID, water.clone()),
        (PLANKS_ID, planks),
    ]);
    registry.build_cache();

    let source = fluid::get_fluid_effective_height(0);
    let shallow_stage = 3;
    let shallow = fluid::get_fluid_effective_height(shallow_stage);
    assert!(
        shallow < source,
        "the far pool has to sit lower for the pull to show"
    );

    let walled_off = SparseSpace::new(&[
        ((0, 0, 0), (WATER_ID, 0)),
        ((1, 0, 0), (PLANKS_ID, 0)),
        ((0, 0, 1), (PLANKS_ID, 0)),
        ((1, 0, 1), (WATER_ID, shallow_stage)),
    ]);
    assert!(
        (water_pxpz_corner_height(&walled_off, &water, &registry) - resting(source)).abs() < 1e-5,
        "two solid sides wall the diagonal off: the corner keeps this voxel's own height",
    );

    let deep_beyond = SparseSpace::new(&[
        ((0, 0, 0), (WATER_ID, 0)),
        ((1, 0, 0), (PLANKS_ID, 0)),
        ((0, 0, 1), (PLANKS_ID, 0)),
        ((1, 0, 1), (WATER_ID, 0)),
        ((1, 1, 1), (WATER_ID, 0)),
    ]);
    assert!(
        (water_pxpz_corner_height(&deep_beyond, &water, &registry) - resting(source)).abs() < 1e-5,
        "a deeper pool past two solid sides must not hoist the corner to a full block",
    );

    let one_side_open = SparseSpace::new(&[
        ((0, 0, 0), (WATER_ID, 0)),
        ((1, 0, 0), (PLANKS_ID, 0)),
        ((1, 0, 1), (WATER_ID, shallow_stage)),
    ]);
    assert!(
        (water_pxpz_corner_height(&one_side_open, &water, &registry)
            - resting((source + shallow) / 2.0))
        .abs()
            < 1e-5,
        "with a side open the diagonal is reachable and still averages in",
    );

    let spill_over_a_side = SparseSpace::new(&[
        ((0, 0, 0), (WATER_ID, 0)),
        ((1, 0, 0), (PLANKS_ID, 0)),
        ((1, 1, 0), (WATER_ID, 0)),
        ((0, 0, 1), (PLANKS_ID, 0)),
    ]);
    assert!(
        (water_pxpz_corner_height(&spill_over_a_side, &water, &registry) - 1.0).abs() < 1e-5,
        "water standing on a side neighbour still spills onto the corner",
    );
}

/// The wall of a block pouring onto a lower sheet starts on its voxel floor,
/// and the base of a block stacked on another sits there too. A full corner
/// is welded to that plane, so it must be meshed exactly on it: lowering it
/// by the surface offset opened a slit along every riser of a cascade and
/// every block seam of a falling column. Only a solid ceiling on that plane,
/// which a coplanar surface would z-fight, keeps the offset.
#[test]
fn a_full_corner_meets_the_wall_pouring_onto_it_unless_a_ceiling_takes_the_plane() {
    const WATER_ID: u32 = 2;
    const PLANKS_ID: u32 = 3;

    let air = Block {
        is_empty: true,
        aabbs: vec![],
        ..plain_block(0, "Air")
    };
    let water = Block {
        is_fluid: true,
        is_waterlogging_fluid: true,
        is_see_through: true,
        is_transparent: [true; 6],
        faces: six_faces(),
        ..plain_block(WATER_ID, "Water")
    };
    let planks = Block {
        is_opaque: true,
        ..plain_block(PLANKS_ID, "Planks")
    };

    let mut registry = Registry::new(vec![
        (0, air),
        (WATER_ID, water.clone()),
        (PLANKS_ID, planks),
    ]);
    registry.build_cache();

    // A step: the lower sheet at the origin, a riser at +x with water on it.
    let cascade_step = SparseSpace::new(&[
        ((0, 0, 0), (WATER_ID, 2)),
        ((1, 0, 0), (PLANKS_ID, 0)),
        ((1, 1, 0), (WATER_ID, 1)),
    ]);
    let lower_faces = create_fluid_faces(0, 0, 0, WATER_ID, &cascade_step, &water.faces, &registry);
    let lower_top = lower_faces
        .iter()
        .find(|face| face.name == "py")
        .expect("the lower sheet has a top face");
    let spill_corners: Vec<f32> = lower_top
        .corners
        .iter()
        .filter(|corner| corner.pos[0] == 1.0)
        .map(|corner| corner.pos[1])
        .collect();
    assert_eq!(
        spill_corners.len(),
        2,
        "the lower sheet has two corners against the riser"
    );
    for height in &spill_corners {
        assert!(
            (height - 1.0).abs() < 1e-6,
            "a spill corner under open air sits exactly on the voxel boundary, got {height}"
        );
    }

    let upper_faces = create_fluid_faces(1, 1, 0, WATER_ID, &cascade_step, &water.faces, &registry);
    let upper_wall = upper_faces
        .iter()
        .find(|face| face.name == "nx")
        .expect("the pouring block has a wall toward the lower sheet");
    // Local to (1, 1, 0): its floor is world y = 1, the lower sheet's boundary.
    assert_eq!(
        upper_wall
            .corners
            .iter()
            .filter(|corner| corner.pos[1] == 0.0)
            .count(),
        2,
        "the pouring wall's bottom edge sits on its voxel floor"
    );

    // The same corner under a ceiling keeps the offset off the ceiling plane.
    let under_a_ceiling = SparseSpace::new(&[
        ((0, 0, 0), (WATER_ID, 2)),
        ((0, 1, 0), (PLANKS_ID, 0)),
        ((1, 0, 0), (PLANKS_ID, 0)),
        ((1, 1, 0), (WATER_ID, 1)),
    ]);
    assert!(
        (water_pxpz_corner_height(&under_a_ceiling, &water, &registry) - resting(1.0)).abs() < 1e-6,
        "a full corner under a solid ceiling stays the surface offset below its plane",
    );

    // Fluid stacked on fluid: the lower block's walls reach the upper's base.
    let stacked = SparseSpace::new(&[((0, 0, 0), (WATER_ID, 0)), ((0, 1, 0), (WATER_ID, 0))]);
    let stacked_faces = create_fluid_faces(0, 0, 0, WATER_ID, &stacked, &water.faces, &registry);
    let stacked_wall = stacked_faces
        .iter()
        .find(|face| face.name == "px")
        .expect("the stacked block has side walls");
    for corner in stacked_wall
        .corners
        .iter()
        .filter(|corner| corner.pos[1] > 0.5)
    {
        assert!(
            (corner.pos[1] - 1.0).abs() < 1e-6,
            "a wall under stacked fluid reaches the voxel boundary, got {}",
            corner.pos[1]
        );
    }
}
