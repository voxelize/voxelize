use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
use voxelize_mesher::{
    mesh_space, mesh_space_greedy, mesh_space_greedy_legacy, AABB, Block, BlockConditionalPart,
    BlockDynamicPattern, BlockFace, BlockRotation, BlockRule, BlockSimpleRule, BlockUtils,
    CornerData, GeometryProtocol, LightColor, LightUtils, Registry, UV, VoxelAccess,
};

#[derive(Clone)]
struct BenchSpace {
    shape: [usize; 3],
    voxels: Vec<u32>,
    lights: Vec<u32>,
}

impl BenchSpace {
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
}

impl VoxelAccess for BenchSpace {
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
        BlockUtils::extract_rotation(self.get_raw_voxel(vx, vy, vz))
    }

    fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        BlockUtils::extract_stage(self.get_raw_voxel(vx, vy, vz))
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
        self.index(vx, vy, vz).is_some()
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

fn build_registry() -> Registry {
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

    let mut water = base_block(3, "water");
    water.is_opaque = false;
    water.is_fluid = true;
    water.is_see_through = true;
    water.is_transparent = [true; 6];

    let mut dynamic_gate = base_block(4, "dynamic_gate");
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

    let mut y_rotatable = base_block(5, "rotatable_panel");
    y_rotatable.is_opaque = false;
    y_rotatable.is_see_through = true;
    y_rotatable.y_rotatable = true;

    let mut registry = Registry::new(vec![
        (0, air),
        (1, stone),
        (2, glass),
        (3, water),
        (4, dynamic_gate),
        (5, y_rotatable),
    ]);
    registry.build_cache();
    registry
}

fn geometry_fingerprint(geometries: &[GeometryProtocol]) -> Vec<String> {
    let mut fingerprints = geometries
        .iter()
        .map(|geometry| {
            let positions = geometry
                .positions
                .iter()
                .map(|value| format!("{:.5}", value))
                .collect::<Vec<String>>()
                .join(",");
            let uvs = geometry
                .uvs
                .iter()
                .map(|value| format!("{:.5}", value))
                .collect::<Vec<String>>()
                .join(",");
            let indices = geometry
                .indices
                .iter()
                .map(i32::to_string)
                .collect::<Vec<String>>()
                .join(",");
            let lights = geometry
                .lights
                .iter()
                .map(i32::to_string)
                .collect::<Vec<String>>()
                .join(",");
            format!(
                "voxel:{}|face:{:?}|at:{:?}|p:{}|i:{}|u:{}|l:{}",
                geometry.voxel, geometry.face_name, geometry.at, positions, indices, uvs, lights
            )
        })
        .collect::<Vec<String>>();
    fingerprints.sort();
    fingerprints
}

fn assert_parity(min: &[i32; 3], max: &[i32; 3], space: &BenchSpace, registry: &Registry) {
    let legacy = mesh_space_greedy_legacy(min, max, space, registry);
    let optimized = mesh_space_greedy(min, max, space, registry);
    assert_eq!(
        geometry_fingerprint(&legacy),
        geometry_fingerprint(&optimized),
        "greedy parity failed for benchmark fixture"
    );
}

fn terrain_scene() -> BenchSpace {
    let mut space = BenchSpace::new([16, 24, 16]);

    for x in 0..16 {
        for z in 0..16 {
            for y in 0..18 {
                let id = if y < 10 {
                    1
                } else if y < 14 {
                    2
                } else {
                    3
                };
                if id == 3 {
                    let stage = ((x + z + y) % 6) as u32;
                    space.set_voxel_stage(x, y, z, id, stage);
                } else {
                    space.set_voxel_id(x, y, z, id);
                }
            }
        }
    }

    space
}

fn dynamic_scene() -> BenchSpace {
    let mut space = BenchSpace::new([16, 20, 16]);

    for x in 1..15 {
        for z in 1..15 {
            space.set_voxel_id(x, 0, z, 1);
            if (x + z) % 3 == 0 {
                space.set_voxel_id(x, 1, z, 4);
                space.set_voxel_id(x + 1, 1, z, 1);
            }
            if (x + z) % 5 == 0 {
                space.set_voxel_rotation(x, 2, z, 5, BlockRotation::PY(std::f32::consts::PI / 2.0));
            }
        }
    }

    for x in 0..16 {
        for z in 0..16 {
            space.set_light(x, 3, z, 12, 4, 2, 1);
        }
    }

    space
}

fn greedy_mesher_benchmark(c: &mut Criterion) {
    let registry = build_registry();
    let scenes = vec![
        ("terrain_16x24x16", terrain_scene()),
        ("dynamic_16x20x16", dynamic_scene()),
    ];

    let mut group = c.benchmark_group("greedy_mesher");

    for (scene_name, space) in &scenes {
        let min = [0, 0, 0];
        let max = [space.shape[0] as i32, space.shape[1] as i32, space.shape[2] as i32];

        assert_parity(&min, &max, space, &registry);

        group.bench_with_input(
            BenchmarkId::new("legacy", scene_name),
            scene_name,
            |bench, _| {
                bench.iter(|| {
                    mesh_space_greedy_legacy(
                        black_box(&min),
                        black_box(&max),
                        black_box(space),
                        black_box(&registry),
                    )
                });
            },
        );

        group.bench_with_input(
            BenchmarkId::new("optimized", scene_name),
            scene_name,
            |bench, _| {
                bench.iter(|| {
                    mesh_space_greedy(
                        black_box(&min),
                        black_box(&max),
                        black_box(space),
                        black_box(&registry),
                    )
                });
            },
        );
    }

    group.finish();
}

fn non_greedy_mesher_benchmark(c: &mut Criterion) {
    let registry = build_registry();
    let scenes = vec![
        ("terrain_16x24x16", terrain_scene()),
        ("dynamic_16x20x16", dynamic_scene()),
    ];
    let mut group = c.benchmark_group("non_greedy_mesher");

    for (scene_name, space) in &scenes {
        let min = [0, 0, 0];
        let max = [space.shape[0] as i32, space.shape[1] as i32, space.shape[2] as i32];
        group.bench_with_input(
            BenchmarkId::new("mesh_space", scene_name),
            scene_name,
            |bench, _| {
                bench.iter(|| {
                    mesh_space(
                        black_box(&min),
                        black_box(&max),
                        black_box(space),
                        black_box(&registry),
                    )
                });
            },
        );
    }

    group.finish();
}

criterion_group!(benches, greedy_mesher_benchmark, non_greedy_mesher_benchmark);
criterion_main!(benches);
