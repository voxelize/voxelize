use std::{fs, path::PathBuf};
use voxelize_mesher::{
    mesh_space, mesh_space_greedy, mesh_space_greedy_legacy, Block, BlockConditionalPart,
    BlockDynamicPattern, BlockFace, BlockRotation, BlockRule, BlockSimpleRule, BlockUtils,
    CornerData, GeometryProtocol, LightColor, LightUtils, Registry, VoxelAccess, AABB, UV,
};

#[derive(Clone)]
struct TestSpace {
    shape: [usize; 3],
    voxels: Vec<u32>,
    lights: Vec<u32>,
}

impl TestSpace {
    fn new(shape: [usize; 3]) -> Self {
        let size = shape[0] * shape[1] * shape[2];
        Self {
            shape,
            voxels: vec![0; size],
            lights: vec![0; size],
        }
    }

    fn index(&self, vx: i32, vy: i32, vz: i32) -> Option<usize> {
        if vx < 0 || vy < 0 || vz < 0 {
            return None;
        }

        let x = vx as usize;
        let y = vy as usize;
        let z = vz as usize;

        if x >= self.shape[0] || y >= self.shape[1] || z >= self.shape[2] {
            return None;
        }

        Some(x * self.shape[1] * self.shape[2] + y * self.shape[2] + z)
    }

    fn set_voxel(&mut self, vx: i32, vy: i32, vz: i32, voxel: u32) {
        if let Some(index) = self.index(vx, vy, vz) {
            self.voxels[index] = voxel;
        }
    }

    fn set_voxel_id(&mut self, vx: i32, vy: i32, vz: i32, id: u32) {
        let mut voxel = 0u32;
        voxel = BlockUtils::insert_id(voxel, id);
        self.set_voxel(vx, vy, vz, voxel);
    }

    fn set_voxel_stage(&mut self, vx: i32, vy: i32, vz: i32, id: u32, stage: u32) {
        let mut voxel = 0u32;
        voxel = BlockUtils::insert_id(voxel, id);
        voxel = BlockUtils::insert_stage(voxel, stage);
        self.set_voxel(vx, vy, vz, voxel);
    }

    fn set_voxel_rotation(&mut self, vx: i32, vy: i32, vz: i32, id: u32, rotation: BlockRotation) {
        let mut voxel = 0u32;
        voxel = BlockUtils::insert_id(voxel, id);
        voxel = BlockUtils::insert_rotation(voxel, &rotation);
        self.set_voxel(vx, vy, vz, voxel);
    }

    fn set_light(
        &mut self,
        vx: i32,
        vy: i32,
        vz: i32,
        sunlight: u32,
        red: u32,
        green: u32,
        blue: u32,
    ) {
        if let Some(index) = self.index(vx, vy, vz) {
            let mut light = 0u32;
            light = LightUtils::insert_sunlight(light, sunlight);
            light = LightUtils::insert_red_light(light, red);
            light = LightUtils::insert_green_light(light, green);
            light = LightUtils::insert_blue_light(light, blue);
            self.lights[index] = light;
        }
    }

    fn contains_local(&self, vx: i32, vy: i32, vz: i32) -> bool {
        self.index(vx, vy, vz).is_some()
    }
}

impl VoxelAccess for TestSpace {
    fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        self.index(vx, vy, vz)
            .map(|index| BlockUtils::extract_id(self.voxels[index]))
            .unwrap_or(0)
    }

    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        self.index(vx, vy, vz)
            .map(|index| self.voxels[index])
            .unwrap_or(0)
    }

    fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation {
        let voxel = self.get_raw_voxel(vx, vy, vz);
        BlockUtils::extract_rotation(voxel)
    }

    fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        let voxel = self.get_raw_voxel(vx, vy, vz);
        BlockUtils::extract_stage(voxel)
    }

    fn get_sunlight(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        self.index(vx, vy, vz)
            .map(|index| LightUtils::extract_sunlight(self.lights[index]))
            .unwrap_or(0)
    }

    fn get_torch_light(&self, vx: i32, vy: i32, vz: i32, color: LightColor) -> u32 {
        self.index(vx, vy, vz)
            .map(|index| {
                let light = self.lights[index];
                match color {
                    LightColor::Sunlight => LightUtils::extract_sunlight(light),
                    LightColor::Red => LightUtils::extract_red_light(light),
                    LightColor::Green => LightUtils::extract_green_light(light),
                    LightColor::Blue => LightUtils::extract_blue_light(light),
                }
            })
            .unwrap_or(0)
    }

    fn get_all_lights(&self, vx: i32, vy: i32, vz: i32) -> (u32, u32, u32, u32) {
        self.index(vx, vy, vz)
            .map(|index| LightUtils::extract_all(self.lights[index]))
            .unwrap_or((0, 0, 0, 0))
    }

    fn get_max_height(&self, _vx: i32, _vz: i32) -> u32 {
        self.shape[1] as u32
    }

    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        self.contains_local(vx, vy, vz)
    }
}

fn cube_face(name: &str, dir: [i32; 3], corners: [[f32; 3]; 4]) -> BlockFace {
    BlockFace {
        name: name.to_string(),
        name_lower: name.to_string(),
        independent: false,
        isolated: false,
        texture_group: None,
        dir,
        corners: [
            CornerData {
                pos: corners[0],
                uv: [0.0, 1.0],
            },
            CornerData {
                pos: corners[1],
                uv: [0.0, 0.0],
            },
            CornerData {
                pos: corners[2],
                uv: [1.0, 1.0],
            },
            CornerData {
                pos: corners[3],
                uv: [1.0, 0.0],
            },
        ],
        range: UV {
            start_u: 0.0,
            end_u: 1.0,
            start_v: 0.0,
            end_v: 1.0,
        },
    }
}

fn six_faces() -> Vec<BlockFace> {
    vec![
        cube_face(
            "px",
            [1, 0, 0],
            [
                [1.0, 1.0, 1.0],
                [1.0, 0.0, 1.0],
                [1.0, 1.0, 0.0],
                [1.0, 0.0, 0.0],
            ],
        ),
        cube_face(
            "py",
            [0, 1, 0],
            [
                [0.0, 1.0, 1.0],
                [1.0, 1.0, 1.0],
                [0.0, 1.0, 0.0],
                [1.0, 1.0, 0.0],
            ],
        ),
        cube_face(
            "pz",
            [0, 0, 1],
            [
                [0.0, 0.0, 1.0],
                [1.0, 0.0, 1.0],
                [0.0, 1.0, 1.0],
                [1.0, 1.0, 1.0],
            ],
        ),
        cube_face(
            "nx",
            [-1, 0, 0],
            [
                [0.0, 1.0, 0.0],
                [0.0, 0.0, 0.0],
                [0.0, 1.0, 1.0],
                [0.0, 0.0, 1.0],
            ],
        ),
        cube_face(
            "ny",
            [0, -1, 0],
            [
                [1.0, 0.0, 1.0],
                [0.0, 0.0, 1.0],
                [1.0, 0.0, 0.0],
                [0.0, 0.0, 0.0],
            ],
        ),
        cube_face(
            "nz",
            [0, 0, -1],
            [
                [1.0, 0.0, 0.0],
                [0.0, 0.0, 0.0],
                [1.0, 1.0, 0.0],
                [0.0, 1.0, 0.0],
            ],
        ),
    ]
}

fn base_block(id: u32, name: &str) -> Block {
    Block {
        id,
        name: name.to_string(),
        name_lower: String::new(),
        cache_ready: false,
        rotatable: false,
        y_rotatable: false,
        is_empty: false,
        is_fluid: false,
        is_waterlogged: false,
        is_opaque: true,
        is_see_through: false,
        is_transparent: [false; 6],
        is_all_transparent: false,
        greedy_face_indices: [-1; 6],
        has_standard_six_faces: false,
        fluid_face_uvs: None,
        greedy_face_uv_quantized: [[0; 4]; 6],
        has_diagonal_faces: false,
        has_independent_or_isolated_faces: false,
        has_dynamic_patterns: false,
        uses_main_geometry_only: false,
        block_min_cached: [0.0, 0.0, 0.0],
        is_full_cube_cached: false,
        has_mixed_diagonal_and_cardinal: false,
        greedy_mesh_eligible_no_rotation: false,
        transparent_standalone: false,
        occludes_fluid: false,
        faces: six_faces(),
        aabbs: vec![AABB::create(0.0, 0.0, 0.0, 1.0, 1.0, 1.0)],
        dynamic_patterns: None,
    }
}

fn build_registry_with_cache(cache_ready: bool) -> Registry {
    let mut air = base_block(0, "air");
    air.is_empty = true;
    air.is_opaque = false;
    air.is_see_through = true;
    air.is_transparent = [true; 6];
    air.faces = Vec::new();
    air.aabbs = Vec::new();

    let stone = base_block(1, "stone");

    let mut glass = base_block(2, "glass");
    glass.is_opaque = false;
    glass.is_see_through = true;
    glass.is_transparent = [true; 6];
    glass.transparent_standalone = false;

    let mut glass_standalone = base_block(3, "glass_standalone");
    glass_standalone.is_opaque = false;
    glass_standalone.is_see_through = true;
    glass_standalone.is_transparent = [true; 6];
    glass_standalone.transparent_standalone = true;

    let mut water = base_block(4, "water");
    water.is_opaque = false;
    water.is_fluid = true;
    water.is_see_through = true;
    water.is_transparent = [true; 6];
    water.transparent_standalone = true;

    let mut waterlogged = base_block(5, "waterlogged_solid");
    waterlogged.is_waterlogged = true;

    let mut fluid_occluder = base_block(6, "fluid_occluder");
    fluid_occluder.occludes_fluid = true;

    let mut dynamic_gate = base_block(7, "dynamic_gate");
    dynamic_gate.is_opaque = false;
    dynamic_gate.is_see_through = true;
    dynamic_gate.faces = Vec::new();
    dynamic_gate.dynamic_patterns = Some(vec![BlockDynamicPattern {
        parts: vec![BlockConditionalPart {
            rule: BlockRule::Simple(BlockSimpleRule {
                offset: [1, 0, 0],
                id: Some(1),
                rotation: None,
                stage: None,
            }),
            faces: vec![cube_face(
                "py",
                [0, 1, 0],
                [
                    [0.0, 1.0, 1.0],
                    [1.0, 1.0, 1.0],
                    [0.0, 1.0, 0.0],
                    [1.0, 1.0, 0.0],
                ],
            )],
            aabbs: Vec::new(),
            is_transparent: [false; 6],
            world_space: false,
        }],
    }]);

    let mut y_rotatable = base_block(8, "rotatable_panel");
    y_rotatable.is_opaque = false;
    y_rotatable.is_see_through = true;
    y_rotatable.y_rotatable = true;

    let mut mixed_transparency = base_block(9, "mixed_transparency");
    mixed_transparency.is_opaque = false;
    mixed_transparency.is_see_through = true;
    mixed_transparency.is_transparent = [true, false, true, false, true, false];

    let mut isolated_independent = base_block(10, "isolated_independent");
    for face in &mut isolated_independent.faces {
        if face.name == "py" {
            face.independent = true;
        }
        if face.name == "nz" {
            face.isolated = true;
        }
    }

    let mut dynamic_world = base_block(11, "dynamic_world");
    dynamic_world.is_opaque = false;
    dynamic_world.is_see_through = true;
    dynamic_world.faces = Vec::new();
    dynamic_world.dynamic_patterns = Some(vec![BlockDynamicPattern {
        parts: vec![BlockConditionalPart {
            rule: BlockRule::Simple(BlockSimpleRule {
                offset: [0, 1, 0],
                id: Some(1),
                rotation: None,
                stage: None,
            }),
            faces: vec![cube_face(
                "pz",
                [0, 0, 1],
                [
                    [0.0, 0.0, 1.0],
                    [1.0, 0.0, 1.0],
                    [0.0, 1.0, 1.0],
                    [1.0, 1.0, 1.0],
                ],
            )],
            aabbs: Vec::new(),
            is_transparent: [false; 6],
            world_space: true,
        }],
    }]);

    let mut registry = Registry::new(vec![
        (0, air),
        (1, stone),
        (2, glass),
        (3, glass_standalone),
        (4, water),
        (5, waterlogged),
        (6, fluid_occluder),
        (7, dynamic_gate),
        (8, y_rotatable),
        (9, mixed_transparency),
        (10, isolated_independent),
        (11, dynamic_world),
    ]);
    if cache_ready {
        registry.build_cache();
    }
    registry
}

fn build_registry() -> Registry {
    build_registry_with_cache(true)
}

fn build_registry_uncached() -> Registry {
    build_registry_with_cache(false)
}

struct CanonicalGeometry {
    voxel: u32,
    at: Option<[i32; 3]>,
    face_name: Option<String>,
    positions: Vec<f32>,
    indices: Vec<i32>,
    uvs: Vec<f32>,
    lights: Vec<i32>,
}

fn round_float(value: f32) -> f32 {
    (value * 100000.0).round() / 100000.0
}

fn floats_key(values: &[f32]) -> String {
    values
        .iter()
        .map(|value| format!("{:.5}", value))
        .collect::<Vec<String>>()
        .join(",")
}

fn ints_key(values: &[i32]) -> String {
    values
        .iter()
        .map(i32::to_string)
        .collect::<Vec<String>>()
        .join(",")
}

fn geometry_key(geometry: &CanonicalGeometry) -> String {
    format!(
        "voxel:{}|face:{:?}|at:{:?}|pos:{}|idx:{}|uv:{}|light:{}",
        geometry.voxel,
        geometry.face_name,
        geometry.at,
        floats_key(&geometry.positions),
        ints_key(&geometry.indices),
        floats_key(&geometry.uvs),
        ints_key(&geometry.lights),
    )
}

fn render_snapshot(geometries: &[CanonicalGeometry]) -> String {
    let mut lines = Vec::new();

    for geometry in geometries {
        lines.push(format!(
            "voxel={} face={:?} at={:?}",
            geometry.voxel, geometry.face_name, geometry.at
        ));
        lines.push(format!("positions=[{}]", floats_key(&geometry.positions)));
        lines.push(format!("indices=[{}]", ints_key(&geometry.indices)));
        lines.push(format!("uvs=[{}]", floats_key(&geometry.uvs)));
        lines.push(format!("lights=[{}]", ints_key(&geometry.lights)));
        lines.push(String::new());
    }

    lines.join("\n")
}

fn assert_snapshot(name: &str, content: &str) {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("tests");
    path.push("snapshots");
    path.push(format!("{name}.snap"));

    let should_update = std::env::var("VOXELIZE_UPDATE_SNAPSHOTS")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    if should_update || !path.exists() {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create snapshot directory");
        }
        fs::write(&path, content).expect("write snapshot");
    }

    let expected = fs::read_to_string(&path).expect("read snapshot");
    assert_eq!(
        expected, content,
        "snapshot mismatch for {}. Re-run with VOXELIZE_UPDATE_SNAPSHOTS=1 to update.",
        name
    );
}

fn canonicalize(geometries: Vec<GeometryProtocol>) -> String {
    let mut canonical: Vec<CanonicalGeometry> = geometries
        .into_iter()
        .map(|geometry| CanonicalGeometry {
            voxel: geometry.voxel,
            at: geometry.at,
            face_name: geometry.face_name,
            positions: geometry.positions.into_iter().map(round_float).collect(),
            indices: geometry.indices,
            uvs: geometry.uvs.into_iter().map(round_float).collect(),
            lights: geometry.lights,
        })
        .collect();

    canonical.sort_by(|left, right| geometry_key(left).cmp(&geometry_key(right)));

    render_snapshot(&canonical)
}

fn assert_geometry_integrity(geometries: &[GeometryProtocol]) {
    for geometry in geometries {
        assert_eq!(geometry.positions.len() % 3, 0);
        assert_eq!(geometry.indices.len() % 3, 0);
        assert_eq!(geometry.uvs.len() % 2, 0);
        assert_eq!(geometry.positions.len() / 3, geometry.uvs.len() / 2);
        assert_eq!(geometry.positions.len() / 3, geometry.lights.len());
    }
}

fn mesh_and_snapshot_with_mode(
    name: &str,
    space: &TestSpace,
    registry: &Registry,
    mesh_fn: fn(&[i32; 3], &[i32; 3], &TestSpace, &Registry) -> Vec<GeometryProtocol>,
) {
    let min = [0, 0, 0];
    let max = [
        space.shape[0] as i32,
        space.shape[1] as i32,
        space.shape[2] as i32,
    ];
    let geometries = mesh_fn(&min, &max, space, registry);
    assert_geometry_integrity(&geometries);
    assert_snapshot(name, &canonicalize(geometries));
}

fn assert_greedy_parity(space: &TestSpace, registry: &Registry) {
    let min = [0, 0, 0];
    let max = [
        space.shape[0] as i32,
        space.shape[1] as i32,
        space.shape[2] as i32,
    ];
    let legacy = mesh_space_greedy_legacy(&min, &max, space, registry);
    let optimized = mesh_space_greedy(&min, &max, space, registry);
    assert_eq!(
        canonicalize(legacy),
        canonicalize(optimized),
        "greedy optimized output diverged from legacy"
    );
}

fn assert_cached_uncached_parity(
    space: &TestSpace,
    cached_registry: &Registry,
    uncached_registry: &Registry,
) {
    let min = [0, 0, 0];
    let max = [
        space.shape[0] as i32,
        space.shape[1] as i32,
        space.shape[2] as i32,
    ];

    let greedy_cached = canonicalize(mesh_space_greedy::<TestSpace>(
        &min,
        &max,
        space,
        cached_registry,
    ));
    let greedy_uncached = canonicalize(mesh_space_greedy::<TestSpace>(
        &min,
        &max,
        space,
        uncached_registry,
    ));
    assert_eq!(greedy_cached, greedy_uncached);

    let legacy_cached = canonicalize(mesh_space_greedy_legacy::<TestSpace>(
        &min,
        &max,
        space,
        cached_registry,
    ));
    let legacy_uncached = canonicalize(mesh_space_greedy_legacy::<TestSpace>(
        &min,
        &max,
        space,
        uncached_registry,
    ));
    assert_eq!(legacy_cached, legacy_uncached);

    let non_greedy_cached =
        canonicalize(mesh_space::<TestSpace>(&min, &max, space, cached_registry));
    let non_greedy_uncached = canonicalize(mesh_space::<TestSpace>(
        &min,
        &max,
        space,
        uncached_registry,
    ));
    assert_eq!(non_greedy_cached, non_greedy_uncached);
}

fn seeded_next(seed: &mut u32) -> u32 {
    *seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
    *seed
}

#[test]
fn snapshot_transparency_properties() {
    let registry = build_registry();
    let mut space = TestSpace::new([8, 6, 8]);

    space.set_voxel_id(2, 2, 2, 2);
    space.set_voxel_id(3, 2, 2, 2);

    space.set_voxel_id(2, 2, 4, 3);
    space.set_voxel_id(3, 2, 4, 3);

    space.set_voxel_id(5, 2, 2, 9);
    space.set_voxel_id(5, 1, 2, 1);
    space.set_voxel_id(5, 3, 2, 1);

    space.set_light(2, 2, 2, 15, 0, 0, 0);
    space.set_light(3, 2, 4, 12, 4, 0, 0);

    assert_greedy_parity(&space, &registry);
    mesh_and_snapshot_with_mode(
        "greedy_snapshot_transparency_properties",
        &space,
        &registry,
        mesh_space_greedy::<TestSpace>,
    );
    mesh_and_snapshot_with_mode(
        "non_greedy_snapshot_transparency_properties",
        &space,
        &registry,
        mesh_space::<TestSpace>,
    );
}

#[test]
fn snapshot_standalone_transparency_boundaries() {
    let registry = build_registry();
    let mut space = TestSpace::new([8, 6, 8]);

    space.set_voxel_id(0, 2, 0, 3);
    space.set_voxel_id(1, 2, 0, 3);
    space.set_voxel_id(0, 2, 1, 3);

    space.set_voxel_id(7, 2, 7, 2);
    space.set_voxel_id(6, 2, 7, 2);
    space.set_voxel_id(7, 2, 6, 2);

    space.set_voxel_id(4, 2, 4, 3);
    space.set_voxel_id(5, 2, 4, 2);
    space.set_voxel_id(4, 2, 5, 1);

    space.set_light(0, 2, 0, 15, 0, 0, 0);
    space.set_light(7, 2, 7, 11, 2, 4, 1);
    space.set_light(4, 2, 4, 13, 1, 3, 5);

    assert_greedy_parity(&space, &registry);
    mesh_and_snapshot_with_mode(
        "greedy_snapshot_standalone_transparency_boundaries",
        &space,
        &registry,
        mesh_space_greedy::<TestSpace>,
    );
    mesh_and_snapshot_with_mode(
        "non_greedy_snapshot_standalone_transparency_boundaries",
        &space,
        &registry,
        mesh_space::<TestSpace>,
    );
}

#[test]
fn snapshot_dynamic_patterns_and_rules() {
    let registry = build_registry();
    let mut space = TestSpace::new([8, 6, 8]);

    space.set_voxel_id(2, 2, 2, 7);
    space.set_voxel_id(4, 2, 2, 7);
    space.set_voxel_id(5, 2, 2, 1);
    space.set_voxel_id(4, 3, 2, 7);

    space.set_voxel_id(1, 1, 1, 1);
    space.set_voxel_id(1, 2, 1, 1);
    space.set_voxel_id(1, 3, 1, 1);

    assert_greedy_parity(&space, &registry);
    mesh_and_snapshot_with_mode(
        "greedy_snapshot_dynamic_patterns_and_rules",
        &space,
        &registry,
        mesh_space_greedy::<TestSpace>,
    );
    mesh_and_snapshot_with_mode(
        "non_greedy_snapshot_dynamic_patterns_and_rules",
        &space,
        &registry,
        mesh_space::<TestSpace>,
    );
}

#[test]
fn snapshot_fluid_waterlogged_and_occlusion_properties() {
    let registry = build_registry();
    let mut space = TestSpace::new([8, 6, 8]);

    space.set_voxel_stage(2, 1, 2, 4, 1);
    space.set_voxel_stage(3, 1, 2, 4, 3);
    space.set_voxel_stage(2, 1, 3, 4, 5);
    space.set_voxel_stage(2, 2, 2, 4, 0);

    space.set_voxel_id(1, 1, 2, 6);
    space.set_voxel_id(4, 1, 2, 5);
    space.set_voxel_id(3, 1, 3, 1);

    space.set_light(2, 1, 2, 15, 0, 0, 3);
    space.set_light(3, 1, 2, 13, 2, 1, 0);

    assert_greedy_parity(&space, &registry);
    mesh_and_snapshot_with_mode(
        "greedy_snapshot_fluid_waterlogged_and_occlusion_properties",
        &space,
        &registry,
        mesh_space_greedy::<TestSpace>,
    );
    mesh_and_snapshot_with_mode(
        "non_greedy_snapshot_fluid_waterlogged_and_occlusion_properties",
        &space,
        &registry,
        mesh_space::<TestSpace>,
    );
}

#[test]
fn snapshot_rotation_independent_and_isolated_faces() {
    let registry = build_registry();
    let mut space = TestSpace::new([8, 6, 8]);

    space.set_voxel_rotation(2, 2, 2, 8, BlockRotation::PY(std::f32::consts::FRAC_PI_2));
    space.set_voxel_rotation(3, 2, 2, 8, BlockRotation::PY(std::f32::consts::PI));

    space.set_voxel_id(5, 2, 2, 10);
    space.set_voxel_id(5, 2, 3, 10);
    space.set_voxel_id(5, 3, 2, 1);

    assert_greedy_parity(&space, &registry);
    mesh_and_snapshot_with_mode(
        "greedy_snapshot_rotation_independent_and_isolated_faces",
        &space,
        &registry,
        mesh_space_greedy::<TestSpace>,
    );
    mesh_and_snapshot_with_mode(
        "non_greedy_snapshot_rotation_independent_and_isolated_faces",
        &space,
        &registry,
        mesh_space::<TestSpace>,
    );
}

#[test]
fn snapshot_dynamic_world_space_patterns() {
    let registry = build_registry();
    let mut space = TestSpace::new([8, 6, 8]);

    space.set_voxel_id(2, 1, 2, 11);
    space.set_voxel_id(2, 2, 2, 1);
    space.set_voxel_id(3, 1, 2, 11);
    space.set_voxel_id(4, 1, 2, 11);
    space.set_voxel_id(4, 2, 2, 1);
    space.set_voxel_id(4, 1, 3, 11);

    space.set_voxel_id(1, 1, 1, 1);
    space.set_voxel_id(5, 1, 4, 2);
    space.set_light(2, 3, 2, 14, 3, 2, 1);
    space.set_light(4, 3, 2, 10, 5, 1, 4);

    assert_greedy_parity(&space, &registry);
    mesh_and_snapshot_with_mode(
        "greedy_snapshot_dynamic_world_space_patterns",
        &space,
        &registry,
        mesh_space_greedy::<TestSpace>,
    );
    mesh_and_snapshot_with_mode(
        "non_greedy_snapshot_dynamic_world_space_patterns",
        &space,
        &registry,
        mesh_space::<TestSpace>,
    );
}

#[test]
fn snapshot_seeded_property_mix() {
    let registry = build_registry();
    let mut space = TestSpace::new([8, 6, 8]);
    let mut seed = 0xC0FFEEu32;

    for x in 0..8 {
        for z in 0..8 {
            for y in 0..4 {
                let value = seeded_next(&mut seed) % 11;
                if value == 0 {
                    continue;
                }
                if value == 4 {
                    let stage = seeded_next(&mut seed) % 6;
                    space.set_voxel_stage(x, y, z, value, stage);
                } else if value == 8 {
                    let rotation_value = seeded_next(&mut seed) % 4;
                    let rotation = match rotation_value {
                        0 => BlockRotation::PY(0.0),
                        1 => BlockRotation::PY(std::f32::consts::FRAC_PI_2),
                        2 => BlockRotation::PY(std::f32::consts::PI),
                        _ => BlockRotation::PY(std::f32::consts::PI * 1.5),
                    };
                    space.set_voxel_rotation(x, y, z, value, rotation);
                } else {
                    space.set_voxel_id(x, y, z, value);
                }
            }
        }
    }

    for x in 0..8 {
        for z in 0..8 {
            let light = (x + z) % 16;
            space.set_light(
                x,
                4,
                z,
                light as u32,
                (15 - light) as u32,
                0,
                (light / 2) as u32,
            );
        }
    }

    assert_greedy_parity(&space, &registry);
    mesh_and_snapshot_with_mode(
        "greedy_snapshot_seeded_property_mix",
        &space,
        &registry,
        mesh_space_greedy::<TestSpace>,
    );
    mesh_and_snapshot_with_mode(
        "non_greedy_snapshot_seeded_property_mix",
        &space,
        &registry,
        mesh_space::<TestSpace>,
    );
}

#[test]
fn greedy_legacy_parity_across_randomized_seeds() {
    let registry = build_registry();

    for seed_base in 0..16u32 {
        let mut space = TestSpace::new([8, 6, 8]);
        let mut seed = 0x9E3779B9u32 ^ seed_base.wrapping_mul(2654435761);

        for x in 0..8 {
            for z in 0..8 {
                for y in 0..5 {
                    let value = seeded_next(&mut seed) % 11;
                    if value == 0 {
                        continue;
                    }
                    if value == 4 {
                        let stage = seeded_next(&mut seed) % 8;
                        space.set_voxel_stage(x, y, z, value, stage);
                    } else if value == 8 {
                        let rotation_value = seeded_next(&mut seed) % 4;
                        let rotation = match rotation_value {
                            0 => BlockRotation::PY(0.0),
                            1 => BlockRotation::PY(std::f32::consts::FRAC_PI_2),
                            2 => BlockRotation::PY(std::f32::consts::PI),
                            _ => BlockRotation::PY(std::f32::consts::PI * 1.5),
                        };
                        space.set_voxel_rotation(x, y, z, value, rotation);
                    } else {
                        space.set_voxel_id(x, y, z, value);
                    }
                }
            }
        }

        for x in 0..8 {
            for z in 0..8 {
                let wave = seeded_next(&mut seed) & 0xF;
                let sunlight = wave;
                let red = (wave + 3) & 0xF;
                let green = (wave + 7) & 0xF;
                let blue = (wave + 11) & 0xF;
                space.set_light(x, 5, z, sunlight, red, green, blue);
            }
        }

        assert_greedy_parity(&space, &registry);
    }
}

#[test]
fn greedy_legacy_parity_rotation_heavy_volume() {
    let registry = build_registry();
    let mut space = TestSpace::new([12, 10, 12]);

    for x in 0..12 {
        for z in 0..12 {
            space.set_voxel_id(x, 0, z, 1);
            for y in 1..7 {
                if (x + y + z) % 2 == 0 {
                    let rotation = match (x + y + z) % 4 {
                        0 => BlockRotation::PY(0.0),
                        1 => BlockRotation::PY(std::f32::consts::FRAC_PI_2),
                        2 => BlockRotation::PY(std::f32::consts::PI),
                        _ => BlockRotation::PY(std::f32::consts::PI * 1.5),
                    };
                    space.set_voxel_rotation(x, y, z, 8, rotation);
                } else {
                    space.set_voxel_id(x, y, z, 2);
                }
            }
            space.set_light(x, 8, z, 12, 3, 1, 4);
        }
    }

    assert_greedy_parity(&space, &registry);
}

#[test]
fn greedy_legacy_parity_transparency_fluid_boundary_volume() {
    let registry = build_registry();
    let mut space = TestSpace::new([12, 10, 12]);

    for x in 0..12 {
        for z in 0..12 {
            space.set_voxel_id(x, 0, z, 1);

            if (x + z) % 2 == 0 {
                space.set_voxel_id(x, 1, z, 3);
            } else {
                space.set_voxel_id(x, 1, z, 2);
            }

            if (x + z) % 3 == 0 {
                let stage = ((x * 5 + z * 7) % 8) as u32;
                space.set_voxel_stage(x, 2, z, 4, stage);
            }

            if (x + z) % 4 == 0 {
                space.set_voxel_id(x, 2, z, 6);
            }

            if (x + z) % 5 == 0 {
                space.set_voxel_id(x, 3, z, 11);
                if z < 11 {
                    space.set_voxel_id(x, 4, z, 1);
                }
            }

            if x > 0 && z > 0 && x < 11 && z < 11 && (x + z) % 6 == 0 {
                space.set_voxel_id(x, 3, z, 10);
            }

            let wave = ((x * 11 + z * 13) % 16) as u32;
            space.set_light(
                x,
                6,
                z,
                wave,
                (wave + 3) & 0xF,
                (wave + 7) & 0xF,
                (wave + 11) & 0xF,
            );
        }
    }

    assert_greedy_parity(&space, &registry);
}

#[test]
fn parity_matches_with_uncached_registry() {
    let registry_cached = build_registry();
    let registry_uncached = build_registry_uncached();
    let mut space = TestSpace::new([10, 8, 10]);

    for x in 0..10 {
        for z in 0..10 {
            space.set_voxel_id(x, 0, z, 1);
            if (x + z) % 2 == 0 {
                space.set_voxel_id(x, 1, z, 3);
            } else {
                space.set_voxel_id(x, 1, z, 2);
            }
            if (x + z) % 3 == 0 {
                space.set_voxel_stage(x, 2, z, 4, ((x * 3 + z * 5) % 8) as u32);
            }
            if (x + z) % 4 == 0 {
                space.set_voxel_rotation(
                    x,
                    3,
                    z,
                    8,
                    BlockRotation::PY(std::f32::consts::FRAC_PI_2),
                );
            }
            if (x + z) % 5 == 0 {
                space.set_voxel_id(x, 4, z, 11);
                space.set_voxel_id(x, 5, z, 1);
            }
            space.set_light(x, 6, z, 12, 3, 2, 1);
        }
    }

    assert_cached_uncached_parity(&space, &registry_cached, &registry_uncached);
}

#[test]
fn parity_matches_with_uncached_registry_across_randomized_seeds() {
    let registry_cached = build_registry();
    let registry_uncached = build_registry_uncached();

    for seed_base in 0..12u32 {
        let mut space = TestSpace::new([8, 6, 8]);
        let mut seed = 0xA5A5_A5A5u32 ^ seed_base.wrapping_mul(747796405);

        for x in 0..8 {
            for z in 0..8 {
                for y in 0..5 {
                    let value = seeded_next(&mut seed) % 12;
                    if value == 0 {
                        continue;
                    }
                    if value == 4 {
                        let stage = seeded_next(&mut seed) % 8;
                        space.set_voxel_stage(x, y, z, value, stage);
                    } else if value == 8 {
                        let rotation = match seeded_next(&mut seed) % 4 {
                            0 => BlockRotation::PY(0.0),
                            1 => BlockRotation::PY(std::f32::consts::FRAC_PI_2),
                            2 => BlockRotation::PY(std::f32::consts::PI),
                            _ => BlockRotation::PY(std::f32::consts::PI * 1.5),
                        };
                        space.set_voxel_rotation(x, y, z, value, rotation);
                    } else {
                        let id = if value == 11 { 10 } else { value };
                        space.set_voxel_id(x, y, z, id);
                    }
                }
            }
        }

        for x in 0..8 {
            for z in 0..8 {
                let wave = seeded_next(&mut seed) & 0xF;
                let sunlight = wave;
                let red = (wave + 2) & 0xF;
                let green = (wave + 6) & 0xF;
                let blue = (wave + 10) & 0xF;
                space.set_light(x, 5, z, sunlight, red, green, blue);
            }
        }

        assert_cached_uncached_parity(&space, &registry_cached, &registry_uncached);
        assert_greedy_parity(&space, &registry_uncached);
    }
}

#[test]
fn parity_matches_with_uncached_rotation_heavy_volume() {
    let registry_cached = build_registry();
    let registry_uncached = build_registry_uncached();
    let mut space = TestSpace::new([12, 10, 12]);

    for x in 0..12 {
        for z in 0..12 {
            space.set_voxel_id(x, 0, z, 1);
            for y in 1..7 {
                if (x + y + z) % 2 == 0 {
                    let rotation = match (x + y + z) % 4 {
                        0 => BlockRotation::PY(0.0),
                        1 => BlockRotation::PY(std::f32::consts::FRAC_PI_2),
                        2 => BlockRotation::PY(std::f32::consts::PI),
                        _ => BlockRotation::PY(std::f32::consts::PI * 1.5),
                    };
                    space.set_voxel_rotation(x, y, z, 8, rotation);
                } else {
                    space.set_voxel_id(x, y, z, 2);
                }
            }
            space.set_light(x, 8, z, 12, 3, 1, 4);
        }
    }

    assert_cached_uncached_parity(&space, &registry_cached, &registry_uncached);
    assert_greedy_parity(&space, &registry_uncached);
}

#[test]
fn parity_matches_with_uncached_transparency_fluid_boundary_volume() {
    let registry_cached = build_registry();
    let registry_uncached = build_registry_uncached();
    let mut space = TestSpace::new([12, 10, 12]);

    for x in 0..12 {
        for z in 0..12 {
            space.set_voxel_id(x, 0, z, 1);

            if (x + z) % 2 == 0 {
                space.set_voxel_id(x, 1, z, 3);
            } else {
                space.set_voxel_id(x, 1, z, 2);
            }

            if (x + z) % 3 == 0 {
                let stage = ((x * 5 + z * 7) % 8) as u32;
                space.set_voxel_stage(x, 2, z, 4, stage);
            }

            if (x + z) % 4 == 0 {
                space.set_voxel_id(x, 2, z, 6);
            }

            if (x + z) % 5 == 0 {
                space.set_voxel_id(x, 3, z, 11);
                if z < 11 {
                    space.set_voxel_id(x, 4, z, 1);
                }
            }

            if x > 0 && z > 0 && x < 11 && z < 11 && (x + z) % 6 == 0 {
                space.set_voxel_id(x, 3, z, 10);
            }

            let wave = ((x * 11 + z * 13) % 16) as u32;
            space.set_light(
                x,
                6,
                z,
                wave,
                (wave + 3) & 0xF,
                (wave + 7) & 0xF,
                (wave + 11) & 0xF,
            );
        }
    }

    assert_cached_uncached_parity(&space, &registry_cached, &registry_uncached);
    assert_greedy_parity(&space, &registry_uncached);
}
