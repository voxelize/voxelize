//! Branches, laid out and meshed. Every face a branch voxel draws samples its
//! texture at one density on both axes, whatever its radius and joints; the
//! joints follow the thinner radius; and only what can be seen is drawn.

use voxelize_core::{BlockFace, BlockUtils, CornerData, AABB, UV};

use super::*;

const T: u32 = 16;
const KEY: u32 = 7;

fn shape(seat: BranchSeat) -> BranchShape {
    BranchShape {
        key: KEY,
        seat,
        kind: BranchKind::Voxel,
        texels_per_block: T,
        radius_mask: 0b0111,
        side_face: "bark".into(),
        end_face: "rings".into(),
    }
}

fn branch(radius: u32) -> BranchSide {
    BranchSide::Branch {
        radius,
        seat: BranchSeat::Centre,
    }
}

fn root(radius: u32) -> BranchSide {
    BranchSide::Branch {
        radius,
        seat: BranchSeat::Floor,
    }
}

fn socket(max_radius: u32) -> BranchSide {
    BranchSide::Socket { max_radius }
}

fn stage(radius: u32) -> u32 {
    shape(BranchSeat::Centre).with_radius(0, radius)
}

fn layout(radius: u32, sides: [BranchSide; 6]) -> BranchLayout {
    BranchLayout::new(&shape(BranchSeat::Centre), stage(radius), sides)
}

const APART: BranchSide = BranchSide::Apart;
const NOTHING: [BranchBeyond; 6] = [BranchBeyond::Other; 6];

/// Every combination of what can lie on a side, for a voxel of `radius`.
fn side_options() -> Vec<BranchSide> {
    vec![
        APART,
        branch(1),
        branch(3),
        branch(8),
        root(2),
        root(6),
        socket(1),
        socket(8),
    ]
}

/// (world span, uv span) along each of the quad's two edges.
fn spans(corners: &[CornerData; 4]) -> [(f32, f32); 2] {
    let edge = |a: &CornerData, b: &CornerData| {
        let world = (0..3)
            .map(|i| (a.pos[i] - b.pos[i]).powi(2))
            .sum::<f32>()
            .sqrt();
        let uv = (0..2)
            .map(|i| (a.uv[i] - b.uv[i]).powi(2))
            .sum::<f32>()
            .sqrt();
        (world, uv)
    };
    [
        edge(&corners[0], &corners[1]),
        edge(&corners[0], &corners[2]),
    ]
}

#[test]
fn radius_rides_the_masked_stage_bits_and_keeps_the_rest() {
    let shape = shape(BranchSeat::Centre);
    for radius in 1..=8 {
        let stage = shape.with_radius(0b1000, radius);
        assert_eq!(shape.radius(stage), radius);
        assert_eq!(stage & 0b1000, 0b1000, "the spare bit survives");
    }
    assert_eq!(shape.radius(0), 1, "stage 0 is the thinnest twig");
    assert_eq!(shape.with_radius(0, 20), 7, "radius clamps to half a block");
}

#[test]
fn joints_take_the_thinner_radius_and_sockets_take_what_fits() {
    let sides = [branch(3), branch(8), branch(6), socket(8), APART, root(2)];
    assert_eq!(layout(5, sides).joints, [3, 5, 5, 5, 0, 2]);
    let twig = BranchLayout::new(&shape(BranchSeat::Centre), stage(1), sides);
    assert_eq!(twig.joints, [1, 1, 1, 1, 0, 1]);
    let ahead = [socket(1), branch(5), APART, APART, APART, APART];
    assert_eq!(layout(1, ahead).joints[0], 1, "a leaf takes a twig's end");
    assert_eq!(layout(5, ahead).joints[0], 0, "and nothing thicker");
}

#[test]
fn every_face_keeps_one_texel_density_on_both_axes() {
    let options = side_options();
    let mut checked = 0;
    for seat in [BranchSeat::Centre, BranchSeat::Floor] {
        for radius in 1..=8 {
            // Each side cycles through the options at its own rate, so the
            // sweep covers every option on every side in a few hundred cases.
            for case in 0..options.len().pow(3) {
                let sides = std::array::from_fn(|side| {
                    options[(case / options.len().pow((side % 3) as u32) + side) % options.len()]
                });
                let layout = BranchLayout::new(&shape(seat), stage(radius), sides);
                for beyond in [NOTHING, [BranchBeyond::SeeThrough; 6]] {
                    for quad in layout.faces(&beyond) {
                        let corners = quad.corners(T as i32);
                        for (world, uv) in spans(&corners) {
                            assert!(
                                (world - uv).abs() < 1e-6,
                                "{seat:?} r{radius} {sides:?}: {quad:?} spans {world} of the \
                                 voxel but {uv} of its texture"
                            );
                        }
                        for corner in &corners {
                            assert!(
                                corner.uv.iter().all(|v| (-1e-6..=1.0 + 1e-6).contains(v)),
                                "{quad:?} samples outside its tile: {:?}",
                                corner.uv
                            );
                        }
                        checked += 1;
                    }
                }
            }
        }
    }
    assert!(checked > 10_000, "the sweep drew {checked} faces");
}

#[test]
fn a_twig_shows_a_two_texel_strip_of_bark_and_the_middle_of_the_rings() {
    // A one-radius twig rising from its parent below: free at the top.
    let layout = layout(1, [APART, APART, APART, branch(4), APART, APART]);
    let quads = layout.faces(&NOTHING);
    let tip: Vec<_> = quads
        .iter()
        .filter(|quad| quad.texture == BranchTexture::End)
        .collect();
    assert_eq!(tip.len(), 1, "one ring face, at the free end: {quads:?}");
    assert_eq!(tip[0].side, 2);
    let uvs: Vec<[f32; 2]> = tip[0].corners(16).iter().map(|c| c.uv).collect();
    for uv in uvs {
        for value in uv {
            assert!(
                (value - 7.0 / 16.0).abs() < 1e-6 || (value - 9.0 / 16.0).abs() < 1e-6,
                "the tip samples the rings' middle 2x2, got {value}"
            );
        }
    }
    for quad in quads.iter().filter(|q| q.texture == BranchTexture::Side) {
        let corners = quad.corners(16);
        let us: Vec<f32> = corners.iter().map(|c| c.uv[0]).collect();
        let lo = us.iter().cloned().fold(f32::MAX, f32::min);
        let hi = us.iter().cloned().fold(f32::MIN, f32::max);
        assert!(
            (hi - lo - 2.0 / 16.0).abs() < 1e-6,
            "a twig's bark is two texels across, got {}",
            (hi - lo) * 16.0
        );
    }
}

#[test]
fn a_straight_trunk_draws_four_sides_and_no_ends() {
    let layout = layout(6, [APART, APART, branch(6), branch(7), APART, APART]);
    assert_eq!(
        layout.parts.len(),
        1,
        "same-radius joints carry the core on"
    );
    let quads = layout.faces(&NOTHING);
    assert_eq!(quads.len(), 4, "{quads:?}");
    assert!(quads.iter().all(|q| q.texture == BranchTexture::Side));
}

#[test]
fn a_taper_leaves_a_ledge_and_the_thinner_voxel_meets_it() {
    // A seven above a six: the six reaches the boundary at seven's radius
    // on neither side, so its core ends in a ledge of bark below the arm.
    let lower = layout(7, [APART, APART, branch(6), APART, APART, APART]);
    let arm = lower
        .parts
        .iter()
        .find(|part| part.kind == BranchPartKind::Arm(2))
        .expect("an arm up to the thinner voxel");
    assert_eq!((arm.min, arm.max), ([2, 15, 2], [14, 16, 14]));
    let ledge = lower
        .faces(&NOTHING)
        .into_iter()
        .find(|quad| quad.side == 2 && quad.plane == 15)
        .expect("the core's top shows around the arm");
    assert_eq!(ledge.texture, BranchTexture::Side);
}

#[test]
fn joined_ends_stay_open_and_opaque_neighbours_hide_flush_faces() {
    let trunk = layout(8, [APART, APART, branch(8), socket(8), branch(3), APART]);
    let beyond = [
        BranchBeyond::Opaque,
        BranchBeyond::Other,
        BranchBeyond::Other,
        BranchBeyond::Opaque,
        BranchBeyond::Other,
        BranchBeyond::Other,
    ];
    let sides: Vec<usize> = trunk.faces(&beyond).iter().map(|q| q.side).collect();
    // +x hidden by stone, +y and -y open into the trunk and its soil, +z
    // drawn whole around the thinner limb, -x and -z drawn.
    assert_eq!(sides, vec![1, 4, 5]);
}

#[test]
fn a_twig_draws_its_end_inside_a_leaf_but_not_inside_soil() {
    let twig = layout(1, [socket(1), branch(2), APART, APART, APART, APART]);
    let mut beyond = NOTHING;
    beyond[0] = BranchBeyond::SeeThrough;
    let cap = |beyond: &[BranchBeyond; 6]| {
        twig.faces(beyond)
            .into_iter()
            .filter(|q| q.side == 0 && q.plane == 16)
            .count()
    };
    assert_eq!(cap(&beyond), 1, "the end shows through the leaf's holes");
    beyond[0] = BranchBeyond::Opaque;
    assert_eq!(cap(&beyond), 0, "soil hides it");
}

#[test]
fn a_twig_runs_into_the_leaf_ahead_and_not_into_the_leaves_beside_it() {
    // A tip among leaves: its parent below, a leaf above and on every side.
    let tip = layout(
        1,
        [
            socket(1),
            socket(1),
            socket(1),
            branch(2),
            socket(1),
            socket(1),
        ],
    );
    assert_eq!(
        tip.joints,
        [0, 0, 1, 1, 0, 0],
        "only the leaf ahead takes it"
    );
    assert_eq!(
        tip.parts.len(),
        1,
        "one straight core, no stubs into the leaves"
    );
    let mut beyond = [BranchBeyond::SeeThrough; 6];
    beyond[3] = BranchBeyond::Other;
    let quads = tip.faces(&beyond);
    assert_eq!(
        quads.len(),
        5,
        "four sides and its end inside the leaf ahead: {quads:?}"
    );
    // The ground under a trunk still takes it, whatever its roots set its
    // grain to.
    let base = layout(6, [root(6), root(6), branch(6), socket(8), APART, APART]);
    assert_eq!(base.joints[3], 6);
    assert!(
        base.parts.iter().any(|part| part.min[1] == 0),
        "the trunk reaches its soil: {:?}",
        base.parts
    );
}

#[test]
fn a_thick_limb_passes_a_leaf_by() {
    let limb = layout(4, [socket(1), APART, APART, APART, APART, APART]);
    assert_eq!(limb.joints[0], 0);
    assert_eq!(limb.parts.len(), 1);
}

#[test]
fn a_root_lies_half_sunk_along_the_floor() {
    let root_shape = shape(BranchSeat::Floor);
    let layout = BranchLayout::new(
        &root_shape,
        stage(4),
        [root(3), branch(8), APART, socket(8), APART, APART],
    );
    for part in &layout.parts {
        assert_eq!(part.min[1], 0, "every part rests on the floor: {part:?}");
        assert!(part.max[1] <= 4, "and rises no higher than its radius");
    }
    assert_eq!(layout.axis, 0, "its grain runs along the ground");
    let arm = layout
        .parts
        .iter()
        .find(|part| part.kind == BranchPartKind::Arm(0))
        .unwrap();
    assert_eq!((arm.min, arm.max), ([12, 0, 5], [16, 3, 11]));
    let bottom = layout
        .faces(&[BranchBeyond::Opaque; 6])
        .into_iter()
        .filter(|quad| quad.side == 3)
        .count();
    assert_eq!(bottom, 0, "nothing is drawn under the ground");
}

#[test]
fn a_trunk_flares_into_the_root_beside_it_along_the_floor() {
    let base = layout(5, [root(3), APART, branch(5), socket(8), APART, APART]);
    let flare = base
        .parts
        .iter()
        .find(|part| part.kind == BranchPartKind::Arm(0))
        .expect("an arm toward the root");
    assert_eq!((flare.min, flare.max), ([13, 0, 5], [16, 3, 11]));
}

#[test]
fn a_root_end_centres_the_rings_on_its_own_axis() {
    let layout = BranchLayout::new(
        &shape(BranchSeat::Floor),
        stage(2),
        [APART, root(3), APART, APART, APART, APART],
    );
    let tip = layout
        .faces(&NOTHING)
        .into_iter()
        .find(|quad| quad.texture == BranchTexture::End)
        .expect("the free end shows rings");
    let corners = tip.corners(16);
    // The end spans the floor up to two texels and two texels either side
    // of the middle: the half-disc of rings above their centre.
    let along_floor: Vec<f32> = corners.iter().map(|c| c.uv[0]).collect();
    assert!(along_floor
        .iter()
        .all(|u| (*u - 0.5).abs() < 1e-6 || (*u - 10.0 / 16.0).abs() < 1e-6));
}

#[test]
fn a_lone_voxel_shows_rings_on_both_ends() {
    let quads = layout(8, [APART; 6]).faces(&NOTHING);
    let ends: Vec<usize> = quads
        .iter()
        .filter(|q| q.texture == BranchTexture::End)
        .map(|q| q.side)
        .collect();
    assert_eq!(ends, vec![2, 3]);
}

#[test]
fn volume_is_the_drawn_wood_in_cubic_texels() {
    assert_eq!(layout(8, [APART; 6]).volume(), 16 * 16 * 16, "a full block");
    for r in 1..=8 {
        let run = layout(r, [APART, APART, branch(r), branch(r), APART, APART]);
        assert_eq!(
            run.volume(),
            (2 * r) * (2 * r) * 16,
            "a straight run at r{r}"
        );
    }
    let bend = layout(2, [branch(1), APART, APART, branch(2), APART, APART]);
    assert_eq!(
        bend.volume(),
        4 * 10 * 4 + 6 * 2 * 2,
        "core to the floor plus a twig arm"
    );
}

#[test]
fn collision_boxes_are_the_drawn_parts() {
    let layout = layout(2, [branch(1), APART, APART, branch(2), APART, APART]);
    let aabbs = layout.aabbs();
    assert_eq!(aabbs.len(), layout.parts.len());
    let core = &aabbs[0];
    assert_eq!(
        [core.min_x, core.min_y, core.max_x, core.max_y],
        [6.0 / 16.0, 0.0, 10.0 / 16.0, 10.0 / 16.0]
    );
}

fn wide(radius: u32, texels_per_block: u32) -> WideBranchSection {
    WideBranchSection {
        radius,
        texels_per_block,
    }
}

#[test]
fn a_wide_section_is_the_square_tube_at_texel_resolution() {
    for t in [8, 16, 32] {
        for radius in [1, 3, 8, 9, 12, 20, 24, 33, 40, 56, 64]
            .into_iter()
            .filter(|&r| r <= 4 * t)
        {
            let section = wide(radius, t);
            let reach = section.reach();
            let (c, r) = ((t / 2) as i64, radius as i64);
            let mut drawn = std::collections::HashSet::new();
            for da in -reach - 1..=reach + 1 {
                for db in -reach - 1..=reach + 1 {
                    let boxes = section.cell_boxes(da, db);
                    if da.abs() > reach || db.abs() > reach {
                        assert!(boxes.is_empty(), "t{t} R{radius} reaches past ({da}, {db})");
                    }
                    assert!(boxes.len() <= 1, "a square cell is one box");
                    for [a0, b0, a1, b1] in boxes {
                        assert!(a0 < a1 && b0 < b1 && a1 <= t && b1 <= t);
                        for i in a0..a1 {
                            for k in b0..b1 {
                                let x = da as i64 * t as i64 + i as i64;
                                let z = db as i64 * t as i64 + k as i64;
                                assert!(drawn.insert((x, z)), "t{t} R{radius}: ({x}, {z}) twice");
                            }
                        }
                    }
                }
            }
            // Every texel within the radius of the axis on both axes, and no other.
            let span = (reach as i64 + 2) * t as i64;
            for x in -span..span {
                for z in -span..span {
                    let inside = (c - r..c + r).contains(&x) && (c - r..c + r).contains(&z);
                    assert_eq!(
                        drawn.contains(&(x, z)),
                        inside,
                        "t{t} R{radius} texel ({x}, {z})"
                    );
                }
            }
            assert_eq!(section.area() as usize, drawn.len(), "t{t} R{radius}");
        }
    }
}

#[test]
fn wide_sections_keep_their_reach_and_square_corners() {
    let at = |radius| wide(radius, T);
    assert_eq!(at(8).reach(), 0, "half a block is one voxel");
    assert_eq!(at(24).reach(), 1, "three cells across");
    assert_eq!(at(64).reach(), 4, "R 64 is nine cells across, not eight");
    for (da, db) in [(0, 0), (1, 0), (1, 1), (-1, 1)] {
        assert_eq!(at(24).cell_area(da, db), 256, "R 24 is a full 3x3");
    }
    assert_eq!(
        at(64).cell_area(4, 0),
        8 * 16,
        "R 64's outer cells are half filled"
    );
    assert_eq!(at(64).cell_area(4, 4), 8 * 8);
    assert_eq!(
        at(9).cell_area(1, 0),
        16,
        "R 9 spills one texel into its sides"
    );
    assert_eq!(at(9).cell_area(1, 1), 1, "and one into its corners");
    for radius in [9, 12, 20, 24, 37, 40, 56, 64] {
        let section = at(radius);
        assert_eq!(section.area(), (2 * radius).pow(2), "R{radius}");
        let reach = section.reach();
        let sum: u32 = (-reach..=reach)
            .flat_map(|da| (-reach..=reach).map(move |db| (da, db)))
            .map(|(da, db)| section.cell_area(da, db))
            .sum();
        assert_eq!(
            sum,
            section.area(),
            "R{radius}: the cells add up to the tube"
        );
        for da in -reach..=reach {
            for db in -reach..=reach {
                let area = section.cell_area(da, db);
                for (a, b) in [(-da, db), (da, -db), (db, da)] {
                    assert_eq!(
                        section.cell_area(a, b),
                        area,
                        "R{radius} is square about its axis"
                    );
                }
            }
        }
    }
}

fn texture_face(name: &str, start_u: f32) -> BlockFace {
    BlockFace {
        name: name.into(),
        name_lower: name.into(),
        dir: [1, 0, 0],
        range: UV {
            start_u,
            end_u: start_u + 0.25,
            start_v: 0.0,
            end_v: 0.25,
        },
        ..Default::default()
    }
}

fn block(id: u32, name: &str) -> Block {
    Block {
        id,
        name: name.into(),
        name_lower: name.to_lowercase(),
        rotatable: false,
        y_rotatable: false,
        is_empty: false,
        is_fluid: false,
        is_waterloggable: false,
        is_waterlogging_fluid: false,
        is_opaque: false,
        is_see_through: false,
        is_transparent: [true; 6],
        transparent_standalone: false,
        standalone_face_depth: 0,
        occludes_fluid: false,
        is_plant: false,
        stack_group: 0,
        is_animated: false,
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
        connected: None,
        branch: None,
        branch_shell: false,
        branch_sockets: vec![],
    }
}

const AIR: u32 = 0;
const STONE: u32 = 1;
const LIMB: u32 = 2;
const LEAF: u32 = 3;
const SOIL: u32 = 4;
const TRUNK: u32 = 5;
const FIN: u32 = 6;
const SHELL: u32 = 7;
const INNER: u32 = 8;

fn kind_shape(kind: BranchKind, seat: BranchSeat) -> BranchShape {
    BranchShape {
        kind,
        radius_mask: if kind == BranchKind::Core { 0 } else { 0b0111 },
        ..shape(seat)
    }
}

/// The six axis faces of a unit cube, every one marked `regional_tint`.
fn regional_cube_faces() -> Vec<BlockFace> {
    VOXEL_NEIGHBORS
        .iter()
        .map(|&dir| BlockFace {
            name: format!("{dir:?}"),
            name_lower: format!("{dir:?}"),
            dir,
            regional_tint: true,
            range: UV {
                start_u: 0.0,
                end_u: 0.25,
                start_v: 0.0,
                end_v: 0.25,
            },
            ..Default::default()
        })
        .collect()
}

fn registry() -> Registry {
    let mut registry = Registry::new(vec![
        (
            AIR,
            Block {
                is_empty: true,
                aabbs: vec![],
                ..block(AIR, "Air")
            },
        ),
        (
            STONE,
            Block {
                is_opaque: true,
                is_transparent: [false; 6],
                ..block(STONE, "Stone")
            },
        ),
        (
            LIMB,
            Block {
                faces: vec![texture_face("bark", 0.0), texture_face("rings", 0.5)],
                branch: Some(shape(BranchSeat::Centre)),
                ..block(LIMB, "Limb")
            },
        ),
        (
            LEAF,
            Block {
                is_see_through: true,
                branch_shell: false,
                branch_sockets: vec![BranchSocket {
                    key: KEY,
                    max_radius: 1,
                }],
                ..block(LEAF, "Leaf")
            },
        ),
        (
            SOIL,
            Block {
                is_opaque: true,
                is_transparent: [false; 6],
                faces: regional_cube_faces(),
                branch_shell: false,
                branch_sockets: vec![BranchSocket {
                    key: KEY,
                    max_radius: 8,
                }],
                ..block(SOIL, "Soil")
            },
        ),
        (
            TRUNK,
            Block {
                faces: vec![texture_face("bark", 0.0), texture_face("rings", 0.5)],
                branch: Some(kind_shape(BranchKind::Core, BranchSeat::Centre)),
                ..block(TRUNK, "Trunk")
            },
        ),
        (
            FIN,
            Block {
                faces: vec![texture_face("bark", 0.0), texture_face("rings", 0.5)],
                branch: Some(kind_shape(BranchKind::Fin, BranchSeat::Floor)),
                ..block(FIN, "Fin")
            },
        ),
        (
            SHELL,
            Block {
                branch_shell: true,
                ..block(SHELL, "Shell")
            },
        ),
        (
            INNER,
            Block {
                branch_shell: true,
                is_opaque: true,
                is_transparent: [false; 6],
                ..block(INNER, "Inner")
            },
        ),
    ]);
    registry.build_cache();
    registry
}

/// One level of a wide section around `core`: the core holding `radius`
/// (cut or not) and a shell pointing at it in every other cell it reaches.
fn level(core: [i32; 3], radius: u32, cut: bool) -> Vec<([i32; 3], u32)> {
    let section = wide(radius, T);
    let reach = section.reach();
    let mut cells = Vec::new();
    for dx in -reach..=reach {
        for dz in -reach..=reach {
            let at = [core[0] + dx, core[1], core[2] + dz];
            if section.cell_area(dx, dz) == 0 {
                continue;
            }
            let word = if (dx, dz) == (0, 0) {
                WideBranchBits::with_cut(WideBranchBits::with_size(TRUNK, radius), cut)
            } else if section.cell_area(dx, dz) == T * T {
                WideBranchBits::with_shell_offset(INNER, -dx, -dz)
            } else {
                WideBranchBits::with_shell_offset(SHELL, -dx, -dz)
            };
            cells.push((at, word));
        }
    }
    cells
}

/// A space holding `words`, read the way layouts read it.
fn raw_space(words: &[([i32; 3], u32)]) -> impl Fn(i32, i32, i32) -> u32 {
    let map: std::collections::HashMap<[i32; 3], u32> = words.iter().copied().collect();
    move |x, y, z| map.get(&[x, y, z]).copied().unwrap_or(AIR)
}

/// The faces the branch voxel at `at` shows, against nothing but air.
fn quads_at(words: &[([i32; 3], u32)], at: [i32; 3]) -> Vec<BranchQuad> {
    let registry = registry();
    let raw = raw_space(words);
    let beyond = VOXEL_NEIGHBORS.map(|[dx, dy, dz]| {
        match registry.get_block_by_id(BlockUtils::extract_id(raw(
            at[0] + dx,
            at[1] + dy,
            at[2] + dz,
        ))) {
            Some(block) if block.is_opaque => BranchBeyond::Opaque,
            _ => BranchBeyond::Other,
        }
    });
    branch_layout_at(at, &raw, &registry).map_or_else(Vec::new, |(layout, _)| layout.faces(&beyond))
}

/// Meshes one chunk holding `voxels` (raw voxel words at local positions).
fn mesh(voxels: &[([usize; 3], u32)]) -> Vec<GeometryProtocol> {
    const SIZE: usize = 8;
    let mut data = vec![0u32; SIZE * SIZE * SIZE];
    for &([x, y, z], raw) in voxels {
        data[x * SIZE * SIZE + y * SIZE + z] = raw;
    }
    let mut chunks: Vec<Option<ChunkData>> = (0..9).map(|_| None).collect();
    chunks[4] = Some(ChunkData {
        voxels: data,
        lights: vec![15 << 12; SIZE * SIZE * SIZE],
        shape: [SIZE, SIZE, SIZE],
        min: [0, 0, 0],
    });
    mesh_chunk_with_registry_chunks(
        &chunks,
        [0, 0, 0],
        [SIZE as i32; 3],
        MeshConfig {
            chunk_size: SIZE as i32,
        },
        &registry(),
    )
    .geometries
}

fn limb(radius: u32) -> u32 {
    LIMB | (stage(radius) << 24)
}

#[test]
fn the_mesher_draws_a_tapering_limb_with_its_faces_textures() {
    let geometries = mesh(&[
        ([2, 1, 2], limb(4)),
        ([2, 2, 2], limb(2)),
        ([2, 3, 2], limb(1)),
        ([2, 4, 2], LEAF),
    ]);
    let limb = geometries
        .iter()
        .find(|g| g.voxel == LIMB)
        .expect("the limb meshes");
    let quads = limb.positions.len() / 12;
    // Bottom voxel: four sides, a lone bottom end, a ledge; middle: four
    // sides, a ledge, four sides of its arm down; top: four sides, a ledge
    // where it meets the thicker one, and its end into the leaf.
    assert!(quads >= 12, "{quads} quads");
    for uv in limb.uvs.chunks(2) {
        let in_bark = (0.0..=0.25).contains(&uv[0]);
        let in_rings = (0.5..=0.75).contains(&uv[0]);
        assert!(
            in_bark || in_rings,
            "every vertex samples the bark or the rings tile, got {uv:?}"
        );
    }
}

#[test]
fn a_branch_is_never_greedy_merged_with_its_neighbour() {
    let geometries = mesh(&[([2, 1, 2], limb(8)), ([3, 1, 2], limb(8))]);
    let limb = geometries.iter().find(|g| g.voxel == LIMB).unwrap();
    // Two full-radius voxels side by side join through the shared face, so
    // ten faces show; a greedy merge would draw six.
    assert_eq!(limb.positions.len() / 12, 10);
}

#[test]
fn a_regional_face_takes_the_region_whatever_its_stage_holds() {
    // The soil's stage holds state of its own (a tree's growth budget):
    // every face it shows is tint-eligible on the neutral palette, so the
    // client colours it from the chunk's corner field alone.
    let geometries = mesh(&[([2, 1, 2], SOIL | (9 << 24)), ([2, 2, 2], limb(3))]);
    let soil = geometries
        .iter()
        .find(|g| g.voxel == SOIL)
        .expect("the soil meshes");
    assert!(!soil.lights.is_empty());
    for &light in &soil.lights {
        assert!(light & STAGE_TINT_BIT != 0, "tint-eligible: {light:#x}");
        assert_eq!(
            (light >> STACK_INDEX_SHIFT) & STACK_FIELD_BITS,
            0,
            "on the neutral palette, not the stage's 9"
        );
    }
    let limb = geometries.iter().find(|g| g.voxel == LIMB).unwrap();
    assert!(
        limb.lights.iter().all(|light| light & STAGE_TINT_BIT == 0),
        "the trunk standing in it keeps its bark untinted"
    );
}

#[test]
fn opaque_stone_hides_a_full_trunk_face() {
    let alone = mesh(&[([2, 1, 2], limb(8))]);
    let walled = mesh(&[([2, 1, 2], limb(8)), ([3, 1, 2], STONE)]);
    let quads = |g: &[GeometryProtocol]| {
        g.iter()
            .find(|g| g.voxel == LIMB)
            .map(|g| g.positions.len() / 12)
            .unwrap()
    };
    assert_eq!(quads(&alone), 6);
    assert_eq!(quads(&walled), 5);
}

#[test]
fn a_bole_level_between_its_neighbours_draws_only_its_bark() {
    // Three stacked levels: the middle one covers and is covered, and its
    // cells meet one another, so only its outer bark is left: the tube's
    // four sides.
    let words = [
        level([2, 1, 2], 24, false),
        level([2, 2, 2], 24, false),
        level([2, 3, 2], 24, false),
    ]
    .concat();
    let mut quads = Vec::new();
    for x in 1..=3 {
        for z in 1..=3 {
            quads.extend(quads_at(&words, [x, 2, z]));
        }
    }
    assert_eq!(
        quads.len(),
        12,
        "a full 3x3 level shows its four sides, three cells each, and nothing else"
    );
    assert!(quads.iter().all(|quad| quad.texture == BranchTexture::Side));
    assert!(
        quads.iter().all(|quad| quad.side / 2 != 1),
        "no top or bottom faces"
    );
    // Nothing is drawn on a boundary another cell of the level carries on
    // across: a face on a cell's boundary looks out of the tube there.
    let section = wide(24, T);
    for x in 1..=3 {
        for z in 1..=3 {
            for quad in quads_at(&words, [x, 2, z]) {
                if quad.plane != 0 && quad.plane != T as i32 {
                    continue;
                }
                let step = if quad.side % 2 == 0 { 1 } else { -1 };
                let (nx, nz) = if quad.side / 2 == 0 {
                    (x + step, z)
                } else {
                    (x, z + step)
                };
                assert!(
                    section.cell_area(nx - 2, nz - 2) < 256,
                    "({x}, {z}) draws a face toward the full cell ({nx}, {nz}): {quad:?}"
                );
            }
        }
    }
}

#[test]
fn a_narrower_level_leaves_a_ledge_of_bark_and_the_last_level_ends_in_rings() {
    let words = [level([2, 1, 2], 24, false), level([2, 2, 2], 12, false)].concat();
    let ledge = quads_at(&words, [1, 1, 1]);
    let top = ledge
        .iter()
        .find(|quad| quad.side == 2)
        .expect("the corner's top shows");
    assert_eq!(top.texture, BranchTexture::Side, "a ledge is bark");
    let under = quads_at(&words, [2, 2, 2]);
    assert!(
        under.iter().all(|quad| quad.side != 3),
        "the wider level below covers the narrower one's underside"
    );
    let end = under
        .iter()
        .find(|quad| quad.side == 2)
        .expect("the core's top shows");
    assert_eq!(
        end.texture,
        BranchTexture::End,
        "nothing carries the trunk on"
    );
}

#[test]
fn a_cut_core_draws_nothing_and_its_neighbours_show_the_cut() {
    let words = level([2, 1, 2], 24, true);
    assert!(
        quads_at(&words, [2, 1, 2]).is_empty(),
        "the cut core's slice is gone"
    );
    let raw = raw_space(&words);
    let (layout, dressed_by) =
        branch_layout_at([3, 1, 2], &raw, &registry()).expect("the shell still has its core");
    assert_eq!(dressed_by, TRUNK, "a shell wears its core's faces");
    assert!(
        layout
            .parts
            .iter()
            .all(|part| part.kind == BranchPartKind::Core),
        "the shell draws its slice and nothing else"
    );
    let toward_core = quads_at(&words, [3, 1, 2])
        .into_iter()
        .find(|quad| quad.side == 1)
        .expect("the face toward the cut shows");
    assert_eq!(
        toward_core.texture,
        BranchTexture::End,
        "cut wood shows its rings"
    );
}

#[test]
fn fins_meet_at_the_lower_height_and_stand_on_their_floor() {
    let fin =
        |radius: u32, height: u32| WideBranchBits::with_size(FIN | (stage(radius) << 24), height);
    let words = [([2, 1, 2], fin(3, 16)), ([1, 1, 2], fin(2, 6))];
    let raw = raw_space(&words);
    let (layout, _) = branch_layout_at([2, 1, 2], &raw, &registry()).expect("a fin");
    assert_eq!(layout.parts[0].min[1], 0, "a fin stands on its floor");
    assert_eq!(layout.parts[0].max[1], 16);
    let joint = layout
        .parts
        .iter()
        .find(|part| part.kind == BranchPartKind::Arm(1))
        .expect("an arm toward the lower fin");
    assert_eq!(
        [joint.min[1], joint.max[1]],
        [0, 6],
        "the joint takes the lower height"
    );
    assert_eq!(
        [joint.min[2], joint.max[2]],
        [6, 10],
        "and the thinner radius"
    );
}

#[test]
fn a_shell_whose_core_is_gone_lays_out_nothing() {
    let words = [([2, 1, 2], WideBranchBits::with_shell_offset(SHELL, 1, 0))];
    assert!(branch_layout_at([2, 1, 2], &raw_space(&words), &registry()).is_none());
}

#[test]
fn every_wide_face_keeps_one_texel_density_on_both_axes() {
    let mut checked = 0;
    for radius in [9, 12, 20, 24, 33, 40, 56, 64] {
        for above in [0, 9, radius / 2] {
            for cut in [false, true] {
                let mut words = level([4, 1, 4], radius, cut);
                if above > 0 {
                    words.extend(level([4, 2, 4], above.max(9), false));
                }
                let reach = wide(radius, T).reach();
                for x in 4 - reach..=4 + reach {
                    for z in 4 - reach..=4 + reach {
                        for quad in quads_at(&words, [x, 1, z]) {
                            let corners = quad.corners(T as i32);
                            for (world, uv) in spans(&corners) {
                                assert!(
                                    (world - uv).abs() < 1e-6,
                                    "R{radius} cell ({x}, {z}): {quad:?} spans {world} but {uv}"
                                );
                            }
                            for corner in &corners {
                                assert!(
                                    corner.uv.iter().all(|v| (-1e-6..=1.0 + 1e-6).contains(v)),
                                    "{quad:?} samples outside its tile: {:?}",
                                    corner.uv
                                );
                            }
                            checked += 1;
                        }
                    }
                }
            }
        }
    }
    assert!(checked > 1_000, "the sweep drew {checked} faces");
}

#[test]
fn an_arm_starts_where_the_slice_ends_and_never_overlaps_it() {
    let mut words = level([2, 1, 2], 20, false);
    words.push(([4, 1, 2], LIMB | (stage(3) << 24)));
    let raw = raw_space(&words);
    let (layout, _) = branch_layout_at([3, 1, 2], &raw, &registry()).expect("the +x shell");
    let arm = layout
        .parts
        .iter()
        .find(|part| part.kind == BranchPartKind::Arm(0))
        .expect("an arm out to the limb");
    let slice: Vec<_> = layout
        .parts
        .iter()
        .filter(|part| part.kind == BranchPartKind::Core)
        .collect();
    assert_eq!(arm.max[0], T as i32, "the arm reaches the limb");
    for part in &slice {
        let overlaps =
            (0..3).all(|axis| part.min[axis] < arm.max[axis] && arm.min[axis] < part.max[axis]);
        assert!(!overlaps, "{part:?} overlaps the arm {arm:?}");
    }
    assert!(
        slice.iter().any(|part| part.max[0] == arm.min[0]),
        "the arm starts on the slice's surface"
    );
    let parts: u32 = layout
        .parts
        .iter()
        .map(|p| {
            (0..3)
                .map(|a| (p.max[a] - p.min[a]) as u32)
                .product::<u32>()
        })
        .sum();
    assert_eq!(
        layout.volume(),
        parts,
        "the wood is the parts, counted once"
    );
}

/// Meshes one chunk holding `voxels`, lit by `light` (a light word per
/// local position).
fn mesh_lit(
    voxels: &[([usize; 3], u32)],
    light: impl Fn([usize; 3]) -> u32,
) -> Vec<GeometryProtocol> {
    const SIZE: usize = 8;
    let mut data = vec![0u32; SIZE * SIZE * SIZE];
    let mut lights = vec![0u32; SIZE * SIZE * SIZE];
    for x in 0..SIZE {
        for y in 0..SIZE {
            for z in 0..SIZE {
                lights[x * SIZE * SIZE + y * SIZE + z] = light([x, y, z]);
            }
        }
    }
    for &([x, y, z], raw) in voxels {
        data[x * SIZE * SIZE + y * SIZE + z] = raw;
    }
    let mut chunks: Vec<Option<ChunkData>> = (0..9).map(|_| None).collect();
    chunks[4] = Some(ChunkData {
        voxels: data,
        lights,
        shape: [SIZE, SIZE, SIZE],
        min: [0, 0, 0],
    });
    mesh_chunk_with_registry_chunks(
        &chunks,
        [0, 0, 0],
        [SIZE as i32; 3],
        MeshConfig {
            chunk_size: SIZE as i32,
        },
        &registry(),
    )
    .geometries
}

fn local(words: &[([i32; 3], u32)]) -> Vec<([usize; 3], u32)> {
    words
        .iter()
        .map(|&(at, raw)| (at.map(|v| v as usize), raw))
        .collect()
}

/// Each quad of the geometries of `voxel`: its four corners, and whether it
/// is drawn on the greedy path.
fn quads_of(geometries: &[GeometryProtocol], voxel: u32) -> Vec<([[f32; 3]; 4], bool)> {
    geometries
        .iter()
        .filter(|g| g.voxel == voxel)
        .flat_map(|g| {
            g.positions
                .chunks_exact(12)
                .zip(g.lights.chunks_exact(4))
                .map(|(p, lights)| {
                    (
                        std::array::from_fn(|v| [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]]),
                        lights.iter().all(|light| light & GREEDY_BIT != 0),
                    )
                })
        })
        .collect()
}

/// The axis a quad faces along, and its extent on the other two.
fn plane_of(corners: &[[f32; 3]; 4]) -> (usize, [f32; 2], [f32; 2]) {
    let axis = (0..3)
        .find(|&a| corners.iter().all(|c| c[a] == corners[0][a]))
        .expect("a flat quad");
    let across: Vec<usize> = (0..3).filter(|&a| a != axis).collect();
    let span = |a: usize| {
        corners.iter().fold((f32::MAX, f32::MIN), |(lo, hi), c| {
            (lo.min(c[a]), hi.max(c[a]))
        })
    };
    let (u, v) = (span(across[0]), span(across[1]));
    (axis, [u.0, v.0], [u.1, v.1])
}

const SUN: u32 = 15 << 12;

#[test]
fn a_straight_trunk_draws_each_side_as_one_quad_however_tall() {
    let column: Vec<_> = (1..=5).map(|y| ([2, y, 2], limb(4))).collect();
    let geometries = mesh_lit(&column, |_| SUN);
    let quads = quads_of(&geometries, LIMB);
    // Four sides, each one quad five blocks tall, and the two ends.
    assert_eq!(quads.len(), 6, "{quads:?}");
    let tall: Vec<_> = quads
        .iter()
        .filter(|(corners, _)| plane_of(corners).0 != 1)
        .collect();
    assert_eq!(tall.len(), 4);
    for (corners, greedy) in tall {
        let (axis, lo, hi) = plane_of(corners);
        // The column's ends sit its radius in from the outer voxels' faces.
        let tall_axis = if axis == 0 { 0 } else { 1 };
        assert_eq!(
            hi[tall_axis] - lo[tall_axis],
            4.5,
            "a side spans the whole column: {corners:?}"
        );
        assert!(greedy, "a joined quad is drawn on the greedy path");
    }
    let ends: Vec<_> = quads
        .iter()
        .filter(|(corners, _)| plane_of(corners).0 == 1)
        .collect();
    assert!(
        ends.iter().all(|(_, greedy)| !greedy),
        "a quad nothing joined keeps its own texture coordinates"
    );
}

#[test]
fn a_run_of_equal_levels_draws_its_outline_once() {
    let one = mesh_lit(&local(&level([3, 1, 3], 24, false)), |_| SUN);
    let four: Vec<_> = (1..=4).flat_map(|y| level([3, y, 3], 24, false)).collect();
    let four = mesh_lit(&local(&four), |_| SUN);
    for voxel in [SHELL, TRUNK] {
        assert_eq!(
            quads_of(&four, voxel).len(),
            quads_of(&one, voxel).len(),
            "block {voxel}: four equal levels draw no more quads than one"
        );
    }
}

/// The area the quads cover on each plane (axis, position in texels), in
/// square texels.
fn area_by_plane(quads: &[([[f32; 3]; 4], bool)]) -> std::collections::BTreeMap<(usize, i64), i64> {
    let mut areas = std::collections::BTreeMap::new();
    for (corners, _) in quads {
        let (axis, lo, hi) = plane_of(corners);
        let texels = |value: f32| (value * T as f32).round() as i64;
        *areas.entry((axis, texels(corners[0][axis]))).or_insert(0) +=
            (texels(hi[0]) - texels(lo[0])) * (texels(hi[1]) - texels(lo[1]));
    }
    areas
}

/// A tapering bole with a one-voxel trunk above, a limb and a fin.
fn mixed_bole() -> Vec<([i32; 3], u32)> {
    let fin = WideBranchBits::with_size(FIN | (stage(3) << 24), 12);
    [
        level([4, 1, 4], 40, false),
        level([4, 2, 4], 40, false),
        level([4, 3, 4], 32, false),
        vec![
            ([4, 4, 4], limb(8)),
            ([4, 5, 4], limb(6)),
            ([7, 2, 4], limb(3)),
            ([1, 1, 4], fin),
        ],
    ]
    .concat()
}

#[test]
fn joined_quads_cover_exactly_what_their_voxels_drew() {
    let words = mixed_bole();
    let geometries = mesh_lit(&local(&words), |_| SUN);
    for voxel in [SHELL, INNER, TRUNK, LIMB, FIN] {
        let quads = quads_of(&geometries, voxel);
        let mut drawn: std::collections::BTreeMap<(usize, i64), i64> = Default::default();
        for &(at, raw) in &words {
            if BlockUtils::extract_id(raw) != voxel {
                continue;
            }
            for quad in quads_at(&words, at) {
                let axis = quad.side / 2;
                let [u0, v0, u1, v1] = quad.rect;
                let plane = i64::from(at[axis]) * i64::from(T) + i64::from(quad.plane);
                *drawn.entry((axis, plane)).or_insert(0) += i64::from((u1 - u0) * (v1 - v0));
            }
        }
        assert!(!drawn.is_empty() || quads.is_empty(), "block {voxel} draws");
        assert_eq!(
            area_by_plane(&quads),
            drawn,
            "block {voxel}: the mesh covers each plane as its voxels' faces do"
        );
    }
}

#[test]
fn quads_lit_apart_along_their_seam_stay_apart() {
    let column: Vec<_> = (1..=5).map(|y| ([2, y, 2], limb(4))).collect();
    let shaded = mesh_lit(&column, |[_, y, _]| if y == 3 { 8 << 12 } else { SUN });
    let sides = quads_of(&shaded, LIMB)
        .into_iter()
        .filter(|(corners, _)| plane_of(corners).0 != 1)
        .count();
    // Each side: the two voxels below the shade, the shaded one, the two
    // above it.
    assert_eq!(sides, 12);
}

/// Every texel of wood the voxels of `words` lay out, in world texels.
fn wood_texels(words: &[([i32; 3], u32)]) -> std::collections::HashSet<[i64; 3]> {
    let registry = registry();
    let raw = raw_space(words);
    let t = i64::from(T);
    let mut wood = std::collections::HashSet::new();
    for &(at, _) in words {
        let Some((layout, _)) = branch_layout_at(at, &raw, &registry) else {
            continue;
        };
        for part in &layout.parts {
            for x in part.min[0]..part.max[0] {
                for y in part.min[1]..part.max[1] {
                    for z in part.min[2]..part.max[2] {
                        wood.insert([
                            i64::from(at[0]) * t + i64::from(x),
                            i64::from(at[1]) * t + i64::from(y),
                            i64::from(at[2]) * t + i64::from(z),
                        ]);
                    }
                }
            }
        }
    }
    wood
}

#[test]
fn the_mesh_closes_the_wood_and_draws_nothing_outside_it() {
    let words = mixed_bole();
    let wood = wood_texels(&words);
    let geometries = mesh_lit(&local(&words), |_| SUN);
    let texels = |value: f32| (value * T as f32).round() as i64;
    // Every texel of face drawn: the axis it faces along, its plane, and its
    // two coordinates across, in world texels.
    let mut drawn = std::collections::HashSet::new();
    for voxel in [SHELL, INNER, TRUNK, LIMB, FIN] {
        for (corners, _) in quads_of(&geometries, voxel) {
            let (axis, lo, hi) = plane_of(&corners);
            let across: Vec<usize> = (0..3).filter(|&a| a != axis).collect();
            let plane = texels(corners[0][axis]);
            let mut shows = false;
            for u in texels(lo[0])..texels(hi[0]) {
                for v in texels(lo[1])..texels(hi[1]) {
                    let at = |along: i64| {
                        let mut cell = [0; 3];
                        cell[axis] = along;
                        cell[across[0]] = u;
                        cell[across[1]] = v;
                        cell
                    };
                    let (ahead, behind) =
                        (wood.contains(&at(plane)), wood.contains(&at(plane - 1)));
                    assert!(
                        ahead || behind,
                        "block {voxel}: a face floats in air at ({u}, {v}): {corners:?}"
                    );
                    shows |= ahead != behind;
                    assert!(
                        drawn.insert((axis, plane, u, v)),
                        "block {voxel}: two faces share the texel ({u}, {v}) of {corners:?}"
                    );
                }
            }
            assert!(
                shows,
                "block {voxel}: a quad lies wholly inside the wood: {corners:?}"
            );
        }
    }
    for texel in &wood {
        for axis in 0..3 {
            let across: Vec<usize> = (0..3).filter(|&a| a != axis).collect();
            for step in [-1, 1] {
                let mut next = *texel;
                next[axis] += step;
                if wood.contains(&next) {
                    continue;
                }
                let plane = if step > 0 {
                    texel[axis] + 1
                } else {
                    texel[axis]
                };
                assert!(
                    drawn.contains(&(axis, plane, texel[across[0]], texel[across[1]])),
                    "the wood at {texel:?} is open toward {step} on axis {axis}"
                );
            }
        }
    }
    assert!(wood.len() > 100_000, "{} texels of wood", wood.len());
}

/// A giant's bole, a square tube narrowing a texel a level, and its
/// one-voxel leader, meshed in one chunk under the sun:
/// quads per block and the median mesh time. `cargo test -p voxelize-mesher
/// bole_census -- --ignored --nocapture`.
#[test]
#[ignore]
fn bole_census() {
    // A foot of R 54 narrowing one texel a level to R 10.
    let radii: Vec<u32> = (10..=54).rev().collect();
    let mut words: Vec<([i32; 3], u32)> = Vec::new();
    for (y, &radius) in radii.iter().enumerate() {
        words.extend(level([12, 1 + y as i32, 12], radius, false));
    }
    for (i, radius) in [8, 8, 7, 7, 6, 5, 4, 3, 2].into_iter().enumerate() {
        words.push(([12, 1 + (radii.len() + i) as i32, 12], limb(radius)));
    }
    let shape = [24, 64, 24];
    let mut data = vec![0u32; shape[0] * shape[1] * shape[2]];
    for &([x, y, z], raw) in &words {
        data[x as usize * shape[1] * shape[2] + y as usize * shape[2] + z as usize] = raw;
    }
    let mut chunks: Vec<Option<ChunkData>> = (0..9).map(|_| None).collect();
    chunks[4] = Some(ChunkData {
        voxels: data,
        lights: vec![SUN; shape[0] * shape[1] * shape[2]],
        shape,
        min: [0, 0, 0],
    });
    let registry = registry();
    let mut times = Vec::new();
    let mut geometries = Vec::new();
    for _ in 0..9 {
        let started = std::time::Instant::now();
        geometries = mesh_chunk_with_registry_chunks(
            &chunks,
            [0, 0, 0],
            [24, 64, 24],
            MeshConfig { chunk_size: 24 },
            &registry,
        )
        .geometries;
        times.push(started.elapsed().as_secs_f64() * 1000.0);
    }
    times.sort_by(f64::total_cmp);
    let mut total = 0;
    for (voxel, name) in [
        (TRUNK, "core"),
        (SHELL, "shell"),
        (INNER, "inner"),
        (LIMB, "leader"),
    ] {
        let quads = quads_of(&geometries, voxel);
        let thin = quads
            .iter()
            .filter(|(corners, _)| {
                let (_, lo, hi) = plane_of(corners);
                (hi[0] - lo[0]).min(hi[1] - lo[1]) <= 1.0 / T as f32 + 1e-4
            })
            .count();
        let joined = quads.iter().filter(|(_, greedy)| *greedy).count();
        eprintln!(
            "{name}: {} quads ({thin} thin, {joined} joined)",
            quads.len()
        );
        total += quads.len();
    }
    eprintln!(
        "bole + leader: {total} quads, mesh {:.2} ms median",
        times[times.len() / 2]
    );
}
