use super::*;
use hashbrown::HashMap;

use voxelize_core::{BlockFace, BlockRotation, CornerData, LightColor, LightUtils, VoxelAccess, AABB, UV};

struct SingleVoxelSpace {
    voxel_id: u32,
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
        is_waterlogged: false,
        is_opaque: false,
        is_see_through: true,
        is_transparent: [true; 6],
        transparent_standalone: true,
        occludes_fluid: false,
        is_plant: true,
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
    let space = SingleVoxelSpace { voxel_id: 1 };
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
    let (s011, s101, s110, s111) =
        compute_self_ao(bottom_of_step, face_dir, face_bbox_min, &aabbs);

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
    let (s011, s101, s110, s111) =
        compute_self_ao(top_of_step, face_dir, face_bbox_min, &aabbs);

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
        is_waterlogged: false,
        is_opaque: false,
        is_see_through: false,
        is_transparent: [true; 6],
        transparent_standalone: false,
        occludes_fluid: false,
        is_plant: false,
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
        is_waterlogged: false,
        is_opaque: true,
        is_see_through: false,
        is_transparent: [false; 6],
        transparent_standalone: false,
        occludes_fluid: false,
        is_plant: false,
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
        is_waterlogged: false,
        is_opaque: false,
        is_see_through: false,
        is_transparent: [false; 6],
        transparent_standalone: false,
        occludes_fluid: false,
        is_plant: false,
        faces: vec![],
        aabbs: full_cube_aabb(),
        dynamic_patterns: None,
    }
}

struct ColumnSpace {
    bottom_id: u32,
    top_id: u32,
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
    space: &ColumnSpace,
) -> Vec<i32> {
    let mut positions = vec![];
    let mut indices = vec![];
    let mut uvs = vec![];
    let mut lights = vec![];
    let neighbors = NeighborCache::populate(0, 0, 0, space);
    process_face(
        0,
        0,
        0,
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
    lights
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
        is_waterlogged: true,
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
    };
    let plant_lights = mesh_single_face(&seagrass, &cross_face, &registry, &planted);
    assert!(!plant_lights.is_empty());
    assert!(
        plant_lights
            .iter()
            .all(|packed| packed & WATER_EXPOSED_BIT != 0),
        "waterlogged plant quads should carry the water-exposed bit",
    );
}
