//! Connected frames, meshed end to end. Every texel a joined sheet shows is
//! held to the rule a one-texel frame follows: it samples the frame exactly
//! when a texel beside it, diagonals included, is not part of the sheet.
//! Each neighbourhood below is one a window or a pane wall is built from.

use hashbrown::{HashMap, HashSet};

use voxelize_core::{
    BlockConditionalPart, BlockDynamicPattern, BlockFace, BlockRotation, BlockRule, BlockRuleLogic,
    BlockSimpleRule, CornerData, LightColor, VoxelAccess, AABB, UV,
};

use super::*;

const T: i32 = 16;
const AIR: u32 = 0;
const STONE: u32 = 1;
const GLASS: u32 = 2;
const CLEAR: u32 = 3;
const PANE: u32 = 4;
const FENCE: u32 = 5;

/// The Glass Pane's cross-section: two texels thick, centred in its cell.
const PANE_INSET: f32 = 7.0 / 16.0;
const PANE_THICKNESS: f32 = 2.0 / 16.0;

const LO: [i32; 3] = [-3, -3, -3];
const HI: [i32; 3] = [6, 6, 6];

fn frame(key: u32) -> ConnectedFrame {
    ConnectedFrame {
        key,
        frame_texels: 1,
        corner_texels: 0,
        texels_per_block: T as u32,
        clear_interior: false,
        interior_one_in: 0,
    }
}

/// The same registry with every frame changed by `edit`.
fn registry_with(edit: impl Fn(&mut ConnectedFrame)) -> Registry {
    let mut blocks = registry().blocks_by_id.clone();
    for (_, block) in blocks.iter_mut() {
        if let Some(frame) = block.connected.as_mut() {
            edit(frame);
        }
    }
    let mut registry = Registry::new(blocks);
    registry.build_cache();
    registry
}

/// The same registry with every frame declaring a clear interior.
fn clear_registry() -> Registry {
    registry_with(|frame| frame.clear_interior = true)
}

/// Six faces of a box, laid out and textured the way the server's
/// `six_faces().auto_uv_offset(true)` builds them.
fn box_faces(prefix: &str, offset: [f32; 3], scale: [f32; 3]) -> Vec<BlockFace> {
    let [x0, y0, z0] = offset;
    let [x1, y1, z1] = [0, 1, 2].map(|a| offset[a] + scale[a]);
    let face = |side: &str, dir: [i32; 3], corners: [([f32; 3], [f32; 2]); 4]| BlockFace {
        name: format!("{prefix}{side}"),
        name_lower: format!("{prefix}{side}"),
        dir,
        corners: corners.map(|(pos, uv)| CornerData { pos, uv }),
        range: UV {
            start_u: 0.0,
            end_u: 1.0,
            start_v: 0.0,
            end_v: 1.0,
        },
        ..Default::default()
    };
    vec![
        face(
            "px",
            [1, 0, 0],
            [
                ([x1, y1, z1], [z0, y1]),
                ([x1, y0, z1], [z0, y0]),
                ([x1, y1, z0], [z1, y1]),
                ([x1, y0, z0], [z1, y0]),
            ],
        ),
        face(
            "py",
            [0, 1, 0],
            [
                ([x0, y1, z1], [x1, z1]),
                ([x1, y1, z1], [x0, z1]),
                ([x0, y1, z0], [x1, z0]),
                ([x1, y1, z0], [x0, z0]),
            ],
        ),
        face(
            "pz",
            [0, 0, 1],
            [
                ([x0, y0, z1], [x0, y0]),
                ([x1, y0, z1], [x1, y0]),
                ([x0, y1, z1], [x0, y1]),
                ([x1, y1, z1], [x1, y1]),
            ],
        ),
        face(
            "nx",
            [-1, 0, 0],
            [
                ([x0, y1, z0], [z0, y1]),
                ([x0, y0, z0], [z0, y0]),
                ([x0, y1, z1], [z1, y1]),
                ([x0, y0, z1], [z1, y0]),
            ],
        ),
        face(
            "ny",
            [0, -1, 0],
            [
                ([x1, y0, z1], [x1, z0]),
                ([x0, y0, z1], [x0, z0]),
                ([x1, y0, z0], [x1, z1]),
                ([x0, y0, z0], [x0, z1]),
            ],
        ),
        face(
            "nz",
            [0, 0, -1],
            [
                ([x1, y0, z0], [x0, y0]),
                ([x0, y0, z0], [x1, y0]),
                ([x1, y1, z0], [x0, y1]),
                ([x0, y1, z0], [x1, y1]),
            ],
        ),
    ]
}

fn unit_aabb() -> AABB {
    AABB {
        min_x: 0.0,
        min_y: 0.0,
        min_z: 0.0,
        max_x: 1.0,
        max_y: 1.0,
        max_z: 1.0,
    }
}

fn block(id: u32, name: &str) -> Block {
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
        is_animated: false,
        faces: box_faces("", [0.0; 3], [1.0; 3]),
        aabbs: vec![unit_aabb()],
        dynamic_patterns: None,
        connected: None,
    }
}

fn glass(id: u32, name: &str) -> Block {
    Block {
        is_see_through: true,
        is_transparent: [true; 6],
        connected: Some(frame(id)),
        ..block(id, name)
    }
}

fn is(offset: [i32; 3], id: u32) -> BlockRule {
    BlockRule::Simple(BlockSimpleRule {
        offset,
        id: Some(id),
        rotation: None,
        stage: None,
    })
}

fn not(rule: BlockRule) -> BlockRule {
    BlockRule::Combination {
        logic: BlockRuleLogic::Not,
        rules: vec![rule],
    }
}

fn all(rules: Vec<BlockRule>) -> BlockRule {
    BlockRule::Combination {
        logic: BlockRuleLogic::And,
        rules,
    }
}

/// The Glass Pane's own join rule: another pane, or anything but air and
/// full glass.
fn joins(offset: [i32; 3]) -> BlockRule {
    BlockRule::Combination {
        logic: BlockRuleLogic::Or,
        rules: vec![
            is(offset, PANE),
            all(vec![not(is(offset, AIR)), not(is(offset, GLASS))]),
        ],
    }
}

fn part(rule: BlockRule, faces: Vec<BlockFace>) -> BlockConditionalPart {
    BlockConditionalPart {
        rule,
        faces,
        is_transparent: [true; 6],
        ..Default::default()
    }
}

/// The Glass Pane: a flat slab through a straight run, otherwise a post
/// with an arm toward every neighbour it joins.
fn pane() -> Block {
    let (inset, thick, arm) = (PANE_INSET, PANE_THICKNESS, PANE_INSET);
    let straight_x = all(vec![
        joins([1, 0, 0]),
        joins([-1, 0, 0]),
        not(joins([0, 0, 1])),
        not(joins([0, 0, -1])),
    ]);
    let straight_z = all(vec![
        joins([0, 0, 1]),
        joins([0, 0, -1]),
        not(joins([1, 0, 0])),
        not(joins([-1, 0, 0])),
    ]);
    let patterns = vec![
        BlockDynamicPattern {
            parts: vec![part(
                straight_x,
                box_faces("flat-x-", [0.0, 0.0, inset], [1.0, 1.0, thick]),
            )],
        },
        BlockDynamicPattern {
            parts: vec![part(
                straight_z,
                box_faces("flat-z-", [inset, 0.0, 0.0], [thick, 1.0, 1.0]),
            )],
        },
        BlockDynamicPattern {
            parts: vec![
                part(
                    BlockRule::None,
                    box_faces("post-", [inset, 0.0, inset], [thick, 1.0, thick]),
                ),
                part(
                    joins([1, 0, 0]),
                    box_faces("arm-px-", [inset + thick, 0.0, inset], [arm, 1.0, thick]),
                ),
                part(
                    joins([-1, 0, 0]),
                    box_faces("arm-nx-", [0.0, 0.0, inset], [arm, 1.0, thick]),
                ),
                part(
                    joins([0, 0, 1]),
                    box_faces("arm-pz-", [inset, 0.0, inset + thick], [thick, 1.0, arm]),
                ),
                part(
                    joins([0, 0, -1]),
                    box_faces("arm-nz-", [inset, 0.0, 0.0], [thick, 1.0, arm]),
                ),
            ],
        },
    ];
    Block {
        is_see_through: true,
        is_transparent: [true; 6],
        transparent_standalone: true,
        dynamic_patterns: Some(patterns),
        connected: Some(frame(PANE)),
        ..block(PANE, "Glass Pane")
    }
}

fn registry() -> Registry {
    let mut registry = Registry::new(vec![
        (
            AIR,
            Block {
                is_empty: true,
                is_transparent: [true; 6],
                faces: vec![],
                aabbs: vec![],
                ..block(AIR, "Air")
            },
        ),
        (
            STONE,
            Block {
                is_opaque: true,
                ..block(STONE, "Stone")
            },
        ),
        (GLASS, glass(GLASS, "Glass")),
        (CLEAR, glass(CLEAR, "Clear Glass")),
        (PANE, pane()),
        (
            FENCE,
            Block {
                is_see_through: true,
                is_transparent: [true; 6],
                transparent_standalone: true,
                faces: box_faces("post-", [0.375, 0.0, 0.375], [0.25, 1.0, 0.25]),
                aabbs: vec![AABB {
                    min_x: 0.375,
                    min_y: 0.0,
                    min_z: 0.375,
                    max_x: 0.625,
                    max_y: 1.0,
                    max_z: 0.625,
                }],
                ..block(FENCE, "Fence")
            },
        ),
    ]);
    registry.build_cache();
    registry
}

#[derive(Default)]
struct Scene {
    voxels: HashMap<(i32, i32, i32), u32>,
}

impl Scene {
    fn of(cells: &[((i32, i32, i32), u32)]) -> Self {
        Self {
            voxels: cells.iter().copied().collect(),
        }
    }

    /// Fills the inclusive box `from..=to` with `id`.
    fn fill(mut self, from: (i32, i32, i32), to: (i32, i32, i32), id: u32) -> Self {
        for x in from.0..=to.0 {
            for y in from.1..=to.1 {
                for z in from.2..=to.2 {
                    self.voxels.insert((x, y, z), id);
                }
            }
        }
        self
    }
}

impl VoxelAccess for Scene {
    fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        self.voxels.get(&(vx, vy, vz)).copied().unwrap_or(AIR)
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
        0
    }

    fn contains(&self, _vx: i32, _vy: i32, _vz: i32) -> bool {
        true
    }
}

fn mesh(scene: &Scene) -> Vec<GeometryProtocol> {
    mesh_space_greedy(&LO, &HI, scene, &registry())
}

/// (normal axis, facing, plane in world texels).
type Plane = (usize, i32, i32);
/// World texel on a plane's two axes -> every texture texel drawn there.
type Texels = HashMap<(i32, i32), Vec<(i32, i32)>>;

fn plane_axes(axis: usize) -> [usize; 2] {
    match axis {
        0 => [1, 2],
        1 => [0, 2],
        _ => [0, 1],
    }
}

/// The texture texel every world texel shows, per plane and facing, read
/// back from the quads of `id`'s geometry.
fn rendered(meshes: &[GeometryProtocol], id: u32) -> HashMap<Plane, Texels> {
    let mut planes: HashMap<Plane, Texels> = HashMap::new();
    for geometry in meshes.iter().filter(|g| g.voxel == id) {
        for quad in 0..geometry.positions.len() / 12 {
            let pos: Vec<[f32; 3]> = (0..4)
                .map(|k| {
                    let o = quad * 12 + k * 3;
                    [0, 1, 2].map(|a| geometry.positions[o + a] + LO[a] as f32)
                })
                .collect();
            let uv: Vec<[f32; 2]> = (0..4)
                .map(|k| {
                    [
                        geometry.uvs[quad * 8 + k * 2],
                        geometry.uvs[quad * 8 + k * 2 + 1],
                    ]
                })
                .collect();
            let axis = (0..3)
                .find(|&a| pos.iter().all(|p| (p[a] - pos[0][a]).abs() < 1e-4))
                .expect("a connected face stays axis-aligned");
            let depth = pos[0][axis] * T as f32;
            let plane = depth.round() as i32;
            // See-through faces sit a hair inside their voxel: behind the
            // plane they face away from.
            let facing = if depth < plane as f32 { 1 } else { -1 };
            let [a1, a2] = plane_axes(axis);
            let e1 = [pos[1][a1] - pos[0][a1], pos[1][a2] - pos[0][a2]];
            let e2 = [pos[2][a1] - pos[0][a1], pos[2][a2] - pos[0][a2]];
            let det = e1[0] * e2[1] - e1[1] * e2[0];
            let span = |a: usize| {
                let lo = pos.iter().map(|p| p[a]).fold(f32::MAX, f32::min);
                let hi = pos.iter().map(|p| p[a]).fold(f32::MIN, f32::max);
                (
                    (lo * T as f32).round() as i32,
                    (hi * T as f32).round() as i32,
                )
            };
            let ((x0, x1), (y0, y1)) = (span(a1), span(a2));
            for x in x0..x1 {
                for y in y0..y1 {
                    let c = [
                        (x as f32 + 0.5) / T as f32 - pos[0][a1],
                        (y as f32 + 0.5) / T as f32 - pos[0][a2],
                    ];
                    let s = (c[0] * e2[1] - c[1] * e2[0]) / det;
                    let t = (e1[0] * c[1] - e1[1] * c[0]) / det;
                    let texel = [0, 1].map(|k| {
                        let value =
                            uv[0][k] + s * (uv[1][k] - uv[0][k]) + t * (uv[2][k] - uv[0][k]);
                        (value * T as f32).floor() as i32
                    });
                    planes
                        .entry((axis, facing, plane))
                        .or_default()
                        .entry((x, y))
                        .or_default()
                        .push((texel[0], texel[1]));
                }
            }
        }
    }
    planes
}

fn is_frame(texel: (i32, i32)) -> bool {
    texel.0 == 0 || texel.0 == T - 1 || texel.1 == 0 || texel.1 == T - 1
}

/// Every plane drawn once per texel, frame exactly along its outline, and
/// no wall drawn from both sides: that would be the inside of the sheet.
fn assert_outlined(planes: &HashMap<Plane, Texels>) {
    for (&(axis, facing, plane), texels) in planes {
        let region: HashSet<(i32, i32)> = texels.keys().copied().collect();
        if let Some(back) = planes.get(&(axis, -facing, plane)) {
            let shared: Vec<_> = back.keys().filter(|t| region.contains(*t)).collect();
            assert!(
                shared.is_empty(),
                "plane {plane} on axis {axis} drawn from both sides at {shared:?}"
            );
        }
        for (&(x, y), samples) in texels {
            assert_eq!(
                samples.len(),
                1,
                "axis {axis} facing {facing} plane {plane}: texel {:?} drawn {} times",
                (x, y),
                samples.len()
            );
            let on_outline =
                (-1..=1).any(|dx| (-1..=1).any(|dy| !region.contains(&(x + dx, y + dy))));
            assert_eq!(
                is_frame(samples[0]),
                on_outline,
                "axis {axis} facing {facing} plane {plane}: texel {:?} samples {:?}",
                (x, y),
                samples[0]
            );
        }
    }
}

fn region(texels: &Texels) -> HashSet<(i32, i32)> {
    texels.keys().copied().collect()
}

fn rect(x: std::ops::Range<i32>, y: std::ops::Range<i32>) -> HashSet<(i32, i32)> {
    x.flat_map(|x| y.clone().map(move |y| (x, y))).collect()
}

fn front(planes: &HashMap<Plane, Texels>, plane: i32) -> &Texels {
    planes
        .get(&(2, 1, plane))
        .unwrap_or_else(|| panic!("nothing faces +z at plane {plane}"))
}

fn quads(meshes: &[GeometryProtocol], id: u32) -> usize {
    meshes
        .iter()
        .filter(|g| g.voxel == id)
        .map(|g| g.positions.len() / 12)
        .sum()
}

#[test]
fn a_glass_block_nothing_joins_keeps_one_quad_per_face_and_its_whole_texture() {
    let meshes = mesh(&Scene::of(&[((0, 0, 0), GLASS)]));
    assert_eq!(quads(&meshes, GLASS), 6);
    let planes = rendered(&meshes, GLASS);
    assert_outlined(&planes);
    let face = front(&planes, T);
    assert_eq!(region(face), rect(0..T, 0..T));
    for (&(x, y), samples) in face {
        assert_eq!(samples[0], (x, y), "an unjoined face samples itself");
    }
}

#[test]
fn joined_glass_draws_one_frame_around_the_whole_window() {
    for (name, cells, expected) in [
        ("2x1", vec![(0, 0), (1, 0)], rect(0..2 * T, 0..T)),
        ("1x2", vec![(0, 0), (0, 1)], rect(0..T, 0..2 * T)),
        (
            "2x2",
            vec![(0, 0), (1, 0), (0, 1), (1, 1)],
            rect(0..2 * T, 0..2 * T),
        ),
        (
            "3x3",
            (0..3).flat_map(|x| (0..3).map(move |y| (x, y))).collect(),
            rect(0..3 * T, 0..3 * T),
        ),
    ] {
        let scene = Scene::of(
            &cells
                .iter()
                .map(|&(x, y)| ((x, y, 0), GLASS))
                .collect::<Vec<_>>(),
        );
        let meshes = mesh(&scene);
        let planes = rendered(&meshes, GLASS);
        assert_outlined(&planes);
        assert_eq!(region(front(&planes, T)), expected, "{name}");
    }
}

#[test]
fn a_joined_frame_keeps_each_side_of_the_texture_on_its_side() {
    let scene = Scene::default().fill((0, 0, 0), (1, 1, 0), GLASS);
    let planes = rendered(&mesh(&scene), GLASS);
    let face = front(&planes, T);
    assert_eq!(face[&(0, 9)][0].0, 0, "left edge samples the left band");
    assert_eq!(
        face[&(2 * T - 1, 9)][0].0,
        T - 1,
        "right edge, the right band"
    );
    assert_eq!(face[&(9, 0)][0].1, 0, "bottom edge, the bottom band");
    assert_eq!(face[&(9, 2 * T - 1)][0].1, T - 1, "top edge, the top band");
    assert_eq!(face[&(0, 0)][0], (0, 0), "an outer corner keeps its corner");
    for seam in [T - 1, T] {
        assert!(!is_frame(face[&(seam, 9)][0]), "no frame down the middle");
        assert!(!is_frame(face[&(9, seam)][0]), "no frame across the middle");
    }
}

#[test]
fn l_t_and_cross_windows_frame_their_outline_and_inside_corners() {
    for (name, cells) in [
        ("L", vec![(0, 0), (1, 0), (0, 1)]),
        ("T", vec![(0, 1), (1, 1), (2, 1), (1, 0)]),
        ("+", vec![(1, 0), (0, 1), (1, 1), (2, 1), (1, 2)]),
    ] {
        let scene = Scene::of(
            &cells
                .iter()
                .map(|&(x, y)| ((x, y, 0), GLASS))
                .collect::<Vec<_>>(),
        );
        let planes = rendered(&mesh(&scene), GLASS);
        assert_outlined(&planes);
        let expected: HashSet<(i32, i32)> = cells
            .iter()
            .flat_map(|&(x, y)| rect(x * T..(x + 1) * T, y * T..(y + 1) * T))
            .collect();
        assert_eq!(region(front(&planes, T)), expected, "{name}");
    }
    // The L's inside corner shows the frame's corner texel, closing the
    // outline where the two frame lines meet.
    let scene = Scene::of(&[((0, 0, 0), GLASS), ((1, 0, 0), GLASS), ((0, 1, 0), GLASS)]);
    let planes = rendered(&mesh(&scene), GLASS);
    let corner = front(&planes, T)[&(T - 1, T - 1)][0];
    assert!(
        (corner.0 == 0 || corner.0 == T - 1) && (corner.1 == 0 || corner.1 == T - 1),
        "inside corner samples {corner:?}"
    );
}

#[test]
fn diagonal_glass_does_not_join() {
    let scene = Scene::of(&[((0, 0, 0), GLASS), ((1, 1, 0), GLASS)]);
    let planes = rendered(&mesh(&scene), GLASS);
    assert_outlined(&planes);
    let face = front(&planes, T);
    for (&(x, y), samples) in face {
        assert_eq!(samples[0], (x % T, y % T), "each keeps its whole frame");
    }
}

#[test]
fn different_glass_kinds_keep_their_frames_where_they_meet() {
    let scene = Scene::of(&[((0, 0, 0), GLASS), ((1, 0, 0), CLEAR), ((0, 1, 0), GLASS)]);
    let meshes = mesh(&scene);
    for id in [GLASS, CLEAR] {
        assert_outlined(&rendered(&meshes, id));
    }
    let glass = rendered(&meshes, GLASS);
    assert!(
        is_frame(front(&glass, T)[&(T - 1, 5)][0]),
        "glass keeps its seam"
    );
    let clear = rendered(&meshes, CLEAR);
    assert!(
        is_frame(front(&clear, T)[&(T, 5)][0]),
        "clear keeps its seam"
    );
}

#[test]
fn glass_in_a_stone_wall_frames_the_opening() {
    let scene =
        Scene::default()
            .fill((-1, -1, 0), (2, 2, 0), STONE)
            .fill((0, 0, 0), (1, 1, 0), GLASS);
    let planes = rendered(&mesh(&scene), GLASS);
    assert_outlined(&planes);
    assert_eq!(region(front(&planes, T)), rect(0..2 * T, 0..2 * T));
    assert!(
        !planes.keys().any(|&(axis, _, _)| axis != 2),
        "the faces against stone are culled"
    );
}

#[test]
fn a_face_whose_neighbour_is_covered_ends_the_sheet_at_the_crease() {
    // B's front is covered by C (same glass) in one case and by stone in the
    // other; either way A's front meets a wall, not more window.
    for cover in [GLASS, STONE] {
        let scene = Scene::of(&[((0, 0, 0), GLASS), ((1, 0, 0), GLASS), ((1, 0, 1), cover)]);
        let planes = rendered(&mesh(&scene), GLASS);
        assert_outlined(&planes);
        let face = front(&planes, T);
        assert_eq!(region(face), rect(0..T, 0..T));
        assert!(is_frame(face[&(T - 1, 5)][0]), "frame along the crease");
    }
}

#[test]
fn a_pane_wall_draws_one_frame_around_the_whole_sheet() {
    let (front_plane, back_plane) = (9, 7);
    for (name, width, height) in [("2x1", 2, 1), ("2x2", 2, 2), ("3x3", 3, 3)] {
        let scene = Scene::default().fill((0, 0, 0), (width - 1, height - 1, 0), PANE);
        let planes = rendered(&mesh(&scene), PANE);
        assert_outlined(&planes);
        // From the first post's outer edge to the last post's.
        let sheet = rect(7..(width - 1) * T + 9, 0..height * T);
        assert_eq!(region(front(&planes, front_plane)), sheet, "{name} front");
        assert_eq!(region(&planes[&(2, -1, back_plane)]), sheet, "{name} back");
        // Nothing is drawn between two panes: no end caps, no stacked caps.
        for x in 1..width {
            assert!(!planes.contains_key(&(0, 1, x * T)), "{name}: cap at x={x}");
            assert!(
                !planes.contains_key(&(0, -1, x * T)),
                "{name}: cap at x={x}"
            );
        }
        for y in 1..height {
            assert!(!planes.contains_key(&(1, 1, y * T)), "{name}: cap at y={y}");
            assert!(
                !planes.contains_key(&(1, -1, y * T)),
                "{name}: cap at y={y}"
            );
        }
    }
}

#[test]
fn a_lone_pane_is_a_post_drawn_in_frame_colour() {
    let planes = rendered(&mesh(&Scene::of(&[((0, 0, 0), PANE)])), PANE);
    assert_outlined(&planes);
    assert_eq!(region(front(&planes, 9)), rect(7..9, 0..T));
    for texels in planes.values() {
        assert!(
            texels.values().all(|s| is_frame(s[0])),
            "two texels wide: all frame"
        );
    }
}

#[test]
fn a_pane_l_frames_the_inside_corner() {
    let scene = Scene::of(&[((0, 0, 0), PANE), ((1, 0, 0), PANE), ((0, 1, 0), PANE)]);
    let planes = rendered(&mesh(&scene), PANE);
    assert_outlined(&planes);
    let mut sheet = rect(7..T + 9, 0..T);
    sheet.extend(rect(7..9, T..2 * T));
    assert_eq!(region(front(&planes, 9)), sheet);
}

#[test]
fn pane_walls_meeting_at_a_corner_frame_the_crease_and_hide_the_post_inside() {
    // Corner pane at the origin with walls running +x and +z.
    let scene = Scene::of(&[((0, 0, 0), PANE), ((1, 0, 0), PANE), ((0, 0, 1), PANE)]);
    let planes = rendered(&mesh(&scene), PANE);
    assert_outlined(&planes);
    // The x wall's outside face runs round the post; its inside face stops at
    // the crease where the z wall meets it.
    assert_eq!(region(&planes[&(2, -1, 7)]), rect(7..T + 9, 0..T));
    assert_eq!(region(front(&planes, 9)), rect(9..T + 9, 0..T));
    // The z wall mirrors it.
    assert_eq!(region(&planes[&(0, -1, 7)]), rect(0..T, 7..T + 9));
    assert_eq!(region(&planes[&(0, 1, 9)]), rect(0..T, 9..T + 9));
}

#[test]
fn pane_t_and_cross_junctions_frame_every_crease() {
    for (name, cells) in [
        ("T", vec![(0, 0), (1, 0), (-1, 0), (0, 1)]),
        ("+", vec![(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)]),
    ] {
        let scene = Scene::of(
            &cells
                .iter()
                .map(|&(x, z)| ((x, 0, z), PANE))
                .collect::<Vec<_>>(),
        );
        let planes = rendered(&mesh(&scene), PANE);
        assert_outlined(&planes);
        // The branch toward +z splits the x wall's front at the post.
        let mut split = rect(-T + 7..7, 0..T);
        split.extend(rect(9..T + 9, 0..T));
        assert_eq!(region(front(&planes, 9)), split, "{name}");
    }
}

#[test]
fn stacked_lone_panes_are_one_post_with_no_caps_between() {
    let scene = Scene::default().fill((0, 0, 0), (0, 2, 0), PANE);
    let planes = rendered(&mesh(&scene), PANE);
    assert_outlined(&planes);
    for y in 1..3 {
        assert!(!planes.contains_key(&(1, 1, y * T)) && !planes.contains_key(&(1, -1, y * T)));
    }
    assert_eq!(
        region(&planes[&(1, 1, 3 * T)]),
        rect(7..9, 7..9),
        "the top cap"
    );
}

#[test]
fn panes_in_a_stone_wall_frame_the_opening() {
    let scene =
        Scene::default()
            .fill((-1, -1, 0), (2, 2, 0), STONE)
            .fill((0, 0, 0), (1, 1, 0), PANE);
    let planes = rendered(&mesh(&scene), PANE);
    assert_outlined(&planes);
    assert_eq!(region(front(&planes, 9)), rect(0..2 * T, 0..2 * T));
    assert!(
        !planes.contains_key(&(0, -1, 0)) && !planes.contains_key(&(0, 1, 2 * T)),
        "end caps against stone are culled"
    );
}

#[test]
fn a_pane_against_a_fence_shows_its_end_cap_in_frame_colour() {
    let scene = Scene::of(&[((0, 0, 0), PANE), ((1, 0, 0), FENCE)]);
    let planes = rendered(&mesh(&scene), PANE);
    assert_outlined(&planes);
    assert_eq!(region(front(&planes, 9)), rect(7..T, 0..T));
    let cap = &planes[&(0, 1, T)];
    assert_eq!(region(cap), rect(0..T, 7..9));
}

#[test]
fn diagonal_panes_do_not_join_and_panes_do_not_join_glass() {
    let scene = Scene::of(&[((0, 0, 0), PANE), ((1, 0, 1), PANE), ((1, 0, 0), GLASS)]);
    let meshes = mesh(&scene);
    let planes = rendered(&meshes, PANE);
    assert_outlined(&planes);
    assert_outlined(&rendered(&meshes, GLASS));
    assert_eq!(region(front(&planes, 9)), rect(7..9, 0..T));
    assert_eq!(region(front(&planes, T + 9)), rect(T + 7..T + 9, 0..T));
}

#[test]
fn a_clear_interior_leaves_joined_borders_undrawn_and_every_frame_texel_in_place() {
    let scenes = [
        (
            "glass 3x3",
            Scene::default().fill((0, 0, 0), (2, 2, 0), GLASS),
            GLASS,
        ),
        (
            "glass L",
            Scene::of(&[((0, 0, 0), GLASS), ((1, 0, 0), GLASS), ((0, 1, 0), GLASS)]),
            GLASS,
        ),
        (
            "pane 3x3",
            Scene::default().fill((0, 0, 0), (2, 2, 0), PANE),
            PANE,
        ),
        (
            "pane corner",
            Scene::of(&[((0, 0, 0), PANE), ((1, 0, 0), PANE), ((0, 0, 1), PANE)]),
            PANE,
        ),
    ];
    for (name, scene, id) in scenes {
        let reflected = rendered(&mesh(&scene), id);
        let clear = rendered(&mesh_space_greedy(&LO, &HI, &scene, &clear_registry()), id);
        for (plane, texels) in &reflected {
            let drawn = clear.get(plane).cloned().unwrap_or_default();
            for (texel, samples) in texels {
                match drawn.get(texel) {
                    Some(kept) => assert_eq!(kept, samples, "{name} {plane:?} {texel:?}"),
                    None => assert!(
                        !is_frame(samples[0]),
                        "{name} {plane:?}: frame texel {texel:?} left undrawn"
                    ),
                }
            }
            assert!(
                drawn.keys().all(|t| texels.contains_key(t)),
                "{name} {plane:?}"
            );
        }
    }
    // The middle of a 3x3 window is joined on every side: one quad a face.
    let scene = Scene::default().fill((0, 0, 0), (2, 2, 0), GLASS);
    let registry = clear_registry();
    let middle = registry.get_block_by_id(GLASS).unwrap();
    let faces = connect_faces(
        middle.connected.as_ref().unwrap(),
        [1, 1, 0],
        middle.faces.iter().cloned().map(|f| (f, false)).collect(),
        &scene,
        &registry,
    );
    assert_eq!(faces.len(), 2, "front and back, one quad each");
}

#[test]
fn a_clear_interior_keeps_its_glints_on_one_joined_block_in_n_scattered_by_position() {
    const ONE_IN: u32 = 5;
    let thinned_registry = registry_with(|frame| {
        frame.clear_interior = true;
        frame.interior_one_in = ONE_IN;
    });
    // The voxel a drawn world texel belongs to: a face on its voxel's far
    // boundary faces out of it, and a pane's faces lie inside it.
    let voxel_of = |(axis, facing, plane): Plane, (x, y): (i32, i32)| {
        let [a1, a2] = plane_axes(axis);
        let mut voxel = [0; 3];
        voxel[a1] = x.div_euclid(T);
        voxel[a2] = y.div_euclid(T);
        voxel[axis] = (plane - i32::from(facing > 0)).div_euclid(T);
        voxel
    };
    for (name, scene, id) in [
        (
            "glass 8x8",
            Scene::default().fill((-2, -2, 0), (5, 5, 0), GLASS),
            GLASS,
        ),
        (
            "glass 4x4x2",
            Scene::default().fill((0, 0, 0), (3, 3, 1), GLASS),
            GLASS,
        ),
        (
            "pane 6x4",
            Scene::default().fill((-1, 0, 0), (4, 3, 0), PANE),
            PANE,
        ),
    ] {
        let clear = rendered(&mesh_space_greedy(&LO, &HI, &scene, &clear_registry()), id);
        let thinned = rendered(&mesh_space_greedy(&LO, &HI, &scene, &thinned_registry), id);
        let (mut kept, mut dropped) = (HashSet::new(), HashSet::new());
        for (&plane, texels) in &clear {
            let drawn = thinned.get(&plane).cloned().unwrap_or_default();
            for (&texel, samples) in texels {
                let voxel = voxel_of(plane, texel);
                let keeps = is_frame(samples[0]) || keeps_interior(voxel, ONE_IN);
                assert_eq!(
                    drawn.get(&texel),
                    keeps.then_some(samples),
                    "{name} {plane:?} {texel:?} of {voxel:?}"
                );
                if !is_frame(samples[0]) {
                    if keeps {
                        kept.insert(voxel);
                    } else {
                        dropped.insert(voxel);
                    }
                }
            }
            assert!(
                drawn.keys().all(|t| texels.contains_key(t)),
                "{name} {plane:?}"
            );
        }
        assert!(
            !kept.is_empty() && !dropped.is_empty(),
            "{name}: some blocks keep their glints and some do not ({} / {})",
            kept.len(),
            dropped.len()
        );
    }

    // A block nothing joins keeps its whole texture however thin the rest.
    let lone = Scene::of(&[((0, 0, 0), GLASS)]);
    let meshes = mesh_space_greedy(&LO, &HI, &lone, &thinned_registry);
    assert_eq!(quads(&meshes, GLASS), 6);
    for (&(x, y), samples) in front(&rendered(&meshes, GLASS), T) {
        assert_eq!(samples[0], (x, y), "a lone block samples itself");
    }

    // Across a large wall about one block in ONE_IN keeps them, with no row
    // or column bare or crowded.
    let side = 60;
    let keeps = |x: i32, y: i32| keeps_interior([x, y, 7], ONE_IN);
    let total = (0..side)
        .flat_map(|x| (0..side).map(move |y| (x, y)))
        .filter(|&(x, y)| keeps(x, y))
        .count() as f32;
    let share = total / (side * side) as f32;
    assert!(
        (0.16..=0.24).contains(&share),
        "one block in {ONE_IN} keeps its glints, got {share}"
    );
    for line in 0..side {
        let row = (0..side).filter(|&x| keeps(x, line)).count();
        let column = (0..side).filter(|&y| keeps(line, y)).count();
        for count in [row, column] {
            assert!((3..=24).contains(&count), "line {line}: {count} of {side}");
        }
    }
    assert!(keeps_interior([3, -9, 12], 0) && keeps_interior([3, -9, 12], 1));
}

#[test]
fn every_piece_samples_inside_its_texels_so_no_edge_reads_the_frame_beside_it() {
    for (scene, id) in [
        (Scene::default().fill((0, 0, 0), (2, 2, 0), GLASS), GLASS),
        (Scene::default().fill((0, 0, 0), (2, 2, 0), PANE), PANE),
    ] {
        let meshes = mesh_space_greedy(&LO, &HI, &scene, &clear_registry());
        for geometry in meshes.iter().filter(|g| g.voxel == id) {
            for uv in &geometry.uvs {
                let texels = uv * T as f32;
                let from_edge = (texels - texels.round()).abs();
                assert!(
                    from_edge > 0.03,
                    "a piece's uv {uv} sits on a texel boundary"
                );
            }
        }
    }
}

#[test]
fn a_frame_carried_across_joins_skips_the_corner_shading_and_keeps_it_at_the_corners() {
    const RAMP: i32 = 4;
    let registry = registry_with(|frame| frame.corner_texels = RAMP as u32);
    let reach = 1 + RAMP;
    for (name, scene, run) in [
        ("3x1", Scene::default().fill((0, 0, 0), (2, 0, 0), GLASS), 0),
        ("1x3", Scene::default().fill((0, 0, 0), (0, 2, 0), GLASS), 1),
    ] {
        let planes = rendered(&mesh_space_greedy(&LO, &HI, &scene, &registry), GLASS);
        assert_outlined(&planes);
        let face = front(&planes, T);
        let length = 3 * T;
        for along in 0..length {
            // The frame line on one long side of the run, and the texture
            // axis that runs along it.
            let texel = if run == 0 { (along, T - 1) } else { (0, along) };
            let sampled = face[&texel][0];
            let position = if run == 0 { sampled.0 } else { sampled.1 };
            let from_corner = along.min(length - 1 - along);
            if from_corner >= reach {
                assert!(
                    (reach..T - reach).contains(&position),
                    "{name}: texel {texel:?} carries the frame with {sampled:?}"
                );
            } else {
                let natural = along % T;
                assert_eq!(position, natural, "{name}: the corner keeps its shading");
            }
        }
    }
}

/// Writes the texture texel every world texel of a few front faces samples,
/// for previewing the joined frame against the real art:
/// `CONNECTED_PREVIEW=<file.json> cargo test -p voxelize-mesher
/// connected_front_preview -- --ignored`
#[test]
#[ignore]
fn connected_front_preview() {
    let Some(path) = std::env::var_os("CONNECTED_PREVIEW") else {
        return;
    };
    let registry = registry_with(|frame| {
        frame.corner_texels = 4;
        frame.clear_interior = true;
    });
    // Glints kept on one joined block in five.
    let thinned = registry_with(|frame| {
        frame.corner_texels = 4;
        frame.clear_interior = true;
        frame.interior_one_in = 5;
    });
    let window = || Scene::default().fill((-2, -1, 0), (3, 2, 0), GLASS);
    let scenes = [
        ("glass 6x4, every glint", window(), GLASS, T, &registry),
        ("glass 6x4, one in 5", window(), GLASS, T, &thinned),
        (
            "glass 2x2",
            Scene::default().fill((0, 0, 0), (1, 1, 0), GLASS),
            GLASS,
            T,
            &registry,
        ),
        (
            "glass L",
            Scene::of(&[((0, 0, 0), GLASS), ((1, 0, 0), GLASS), ((0, 1, 0), GLASS)]),
            GLASS,
            T,
            &registry,
        ),
        (
            "pane 3x2",
            Scene::default().fill((0, 0, 0), (2, 1, 0), PANE),
            PANE,
            9,
            &registry,
        ),
        (
            "pane L",
            Scene::of(&[((0, 0, 0), PANE), ((1, 0, 0), PANE), ((0, 1, 0), PANE)]),
            PANE,
            9,
            &registry,
        ),
    ];
    let preview: Vec<String> = scenes
        .into_iter()
        .map(|(name, scene, id, plane, registry)| {
            let planes = rendered(&mesh_space_greedy(&LO, &HI, &scene, registry), id);
            let texels: Vec<String> = front(&planes, plane)
                .iter()
                .map(|(&(x, y), s)| format!("[{x},{y},{},{}]", s[0].0, s[0].1))
                .collect();
            format!("{{\"name\":\"{name}\",\"texels\":[{}]}}", texels.join(","))
        })
        .collect();
    std::fs::write(path, format!("[{}]", preview.join(","))).unwrap();
}

/// What joining costs a chunk mesher: a 16x16 wall of glass and of panes,
/// meshed with and without their frames joined. `cargo test -p
/// voxelize-mesher --release connected_meshing_cost -- --ignored --nocapture`
#[test]
#[ignore]
fn connected_meshing_cost() {
    const RUNS: u32 = 20;
    for (name, id) in [("glass", GLASS), ("pane", PANE)] {
        let scene = Scene::default().fill((0, 0, 0), (15, 15, 0), id);
        let unjoined = {
            let mut blocks: Vec<(u32, Block)> = registry().blocks_by_id.clone();
            for (_, block) in blocks.iter_mut() {
                block.connected = None;
            }
            let mut registry = Registry::new(blocks);
            registry.build_cache();
            registry
        };
        for (label, registry) in [
            ("joined", registry()),
            ("joined, clear interior", clear_registry()),
            (
                "joined, clear interior, corner shading",
                registry_with(|frame| {
                    frame.corner_texels = 4;
                    frame.clear_interior = true;
                }),
            ),
            (
                "joined, clear interior, corner shading, glints one in 5",
                registry_with(|frame| {
                    frame.corner_texels = 4;
                    frame.clear_interior = true;
                    frame.interior_one_in = 5;
                }),
            ),
            ("unjoined", unjoined),
        ] {
            let started = std::time::Instant::now();
            let mut meshes = vec![];
            for _ in 0..RUNS {
                meshes = mesh_space_greedy(&[0, 0, 0], &[16, 16, 1], &scene, &registry);
            }
            let per_run = started.elapsed() / RUNS;
            println!(
                "{name} 16x16 {label}: {:?} per mesh, {} quads",
                per_run,
                quads(&meshes, id)
            );
        }
    }
}

#[test]
fn a_pane_wall_top_edge_is_one_frame_coloured_cap() {
    let scene = Scene::default().fill((0, 0, 0), (2, 0, 0), PANE);
    let planes = rendered(&mesh(&scene), PANE);
    assert_outlined(&planes);
    let top = &planes[&(1, 1, T)];
    assert_eq!(region(top), rect(7..2 * T + 9, 7..9));
    assert!(top.values().all(|s| is_frame(s[0])));
}
