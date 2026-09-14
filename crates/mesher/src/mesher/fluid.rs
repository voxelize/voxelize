use hashbrown::HashMap;

use voxelize_core::{BlockFace, CornerData, VoxelAccess, UV};

use super::*;

pub(super) const FLUID_BASE_HEIGHT: f32 = 0.875;

pub(super) const FLUID_STAGE_DROPOFF: f32 = 0.1;

pub(super) const FLUID_SURFACE_OFFSET: f32 = 0.005;

pub(super) const WATERLOG_FLUID_INSET: f32 = 0.01;

pub(super) fn get_fluid_effective_height(stage: u32) -> f32 {
    (FLUID_BASE_HEIGHT - (stage as f32 * FLUID_STAGE_DROPOFF)).max(0.1)
}

/// Whether this voxel holds `fluid_id` — either as its own block, or as a
/// waterlogged block carrying the fluid alongside itself. `is_waterlogging`
/// says whether `fluid_id` is the fluid waterlogging fills voxels with, so a
/// second fluid in the same registry never claims another's waterlogged
/// voxels.
#[inline]
pub(super) fn voxel_holds_fluid<S: VoxelAccess>(
    vx: i32,
    vy: i32,
    vz: i32,
    fluid_id: u32,
    is_waterlogging: bool,
    space: &S,
) -> bool {
    space.get_voxel(vx, vy, vz) == fluid_id
        || (is_waterlogging && space.get_voxel_waterlogged(vx, vy, vz))
}

pub(super) fn has_fluid_above<S: VoxelAccess>(
    vx: i32,
    vy: i32,
    vz: i32,
    fluid_id: u32,
    is_waterlogging: bool,
    space: &S,
) -> bool {
    voxel_holds_fluid(vx, vy + 1, vz, fluid_id, is_waterlogging, space)
}

/// Where this voxel sits in the column of its own fluid, as `(index from the
/// bottom, length of the run)` — the encoding the packed stack fields already
/// use for plants, so the shader can read how much fluid stands above a
/// fragment and shade it by its true depth instead of by a world-wide sea
/// level.
///
/// Two things differ from the plant walk in `faces.rs`, and both are the
/// point. Membership is "holds this fluid", so a waterlogged kelp voxel does
/// not cut an ocean column in half. And the window is anchored at the
/// surface, not the floor: a run longer than the field can hold has to drop
/// blocks from the bottom, because dropping them from the top would report a
/// fragment far below an ocean's surface as floating on top of a short
/// column and shade it as bright shallows.
pub(super) fn fluid_column_position<S: VoxelAccess>(
    vx: i32,
    vy: i32,
    vz: i32,
    fluid_id: u32,
    registry: &Registry,
    space: &S,
) -> (u32, u32) {
    let is_waterlogging = registry
        .get_block_by_id(fluid_id)
        .is_some_and(|block| block.is_waterlogging_fluid);
    let holds = |y: i32| voxel_holds_fluid(vx, y, vz, fluid_id, is_waterlogging, space);

    let mut above = 0u32;
    while above + 1 < STACK_MAX && holds(vy + above as i32 + 1) {
        above += 1;
    }

    let mut below = 0u32;
    while below + above + 1 < STACK_MAX && holds(vy - below as i32 - 1) {
        below += 1;
    }

    (below, below + above + 1)
}

pub(super) fn get_fluid_height_at<S: VoxelAccess>(
    vx: i32,
    vy: i32,
    vz: i32,
    fluid_id: u32,
    is_waterlogging: bool,
    space: &S,
) -> Option<f32> {
    if voxel_holds_fluid(vx, vy, vz, fluid_id, is_waterlogging, space) {
        Some(get_fluid_effective_height(
            space.get_voxel_fluid_level(vx, vy, vz),
        ))
    } else {
        None
    }
}

/// Whether the voxel at this horizontal offset walls a corner in: it holds
/// none of the fluid and is not air, so the surface can neither continue
/// through it nor be seen past it.
fn walls_corner<S: VoxelAccess>(
    vx: i32,
    vy: i32,
    vz: i32,
    [dx, dz]: [i32; 2],
    fluid_id: u32,
    is_waterlogging: bool,
    space: &S,
    registry: &Registry,
) -> bool {
    if voxel_holds_fluid(vx + dx, vy, vz + dz, fluid_id, is_waterlogging, space) {
        return false;
    }
    registry
        .get_block_by_id(space.get_voxel(vx + dx, vy, vz + dz))
        .is_some_and(|block| !block.is_empty)
}

/// The height of one corner of a fluid voxel's surface. `corner_offsets` are
/// the three other voxels sharing that corner, ordered `[side, side,
/// diagonal]`.
///
/// The diagonal only meets this voxel along a vertical edge; the surface
/// reaches it by wrapping around the corner through one of the two sides.
/// When both sides are walled the diagonal is cut off, and it must drop out
/// of every check here — otherwise a pool two blocks over, seen through two
/// solid blocks, drags this corner down to its stage or hoists it up to a
/// surface standing above it.
pub(super) fn calculate_fluid_corner_height<S: VoxelAccess>(
    vx: i32,
    vy: i32,
    vz: i32,
    corner_offsets: &[[i32; 2]; 3],
    fluid_id: u32,
    is_waterlogging: bool,
    space: &S,
    registry: &Registry,
) -> f32 {
    let [side_a, side_b, _diagonal] = *corner_offsets;
    let walls = |offset: [i32; 2]| {
        walls_corner(
            vx,
            vy,
            vz,
            offset,
            fluid_id,
            is_waterlogging,
            space,
            registry,
        )
    };
    let diagonal_connected = !(walls(side_a) && walls(side_b));
    let neighbors = if diagonal_connected {
        &corner_offsets[..]
    } else {
        &corner_offsets[..2]
    };

    // Fluid standing on any voxel that shares this corner spills onto it, so
    // the corner is a full block high regardless of the stages below.
    if has_fluid_above(vx, vy, vz, fluid_id, is_waterlogging, space)
        || neighbors
            .iter()
            .any(|[dx, dz]| has_fluid_above(vx + dx, vy, vz + dz, fluid_id, is_waterlogging, space))
    {
        return 1.0;
    }

    let self_height = get_fluid_effective_height(space.get_voxel_fluid_level(vx, vy, vz));

    let mut total_height = self_height;
    let mut count = 1.0;
    let mut has_air_neighbor = false;
    let mut has_solid_neighbor = false;

    for [dx, dz] in neighbors {
        let nx = vx + dx;
        let nz = vz + dz;

        if let Some(h) = get_fluid_height_at(nx, vy, nz, fluid_id, is_waterlogging, space) {
            total_height += h;
            count += 1.0;
        } else {
            let neighbor_id = space.get_voxel(nx, vy, nz);
            if let Some(neighbor_block) = registry.get_block_by_id(neighbor_id) {
                if neighbor_block.is_empty {
                    has_air_neighbor = true;
                } else {
                    has_solid_neighbor = true;
                }
            }
        }
    }

    if count == 1.0 && has_air_neighbor && !has_solid_neighbor {
        return 0.1;
    }
    total_height / count
}

pub(super) fn has_standard_six_faces(faces: &[BlockFace]) -> bool {
    faces.iter().any(|f| {
        let name_lower = f.name.to_lowercase();
        name_lower == "py"
            || name_lower == "ny"
            || name_lower == "px"
            || name_lower == "nx"
            || name_lower == "pz"
            || name_lower == "nz"
    })
}

pub(super) fn create_fluid_faces<S: VoxelAccess>(
    vx: i32,
    vy: i32,
    vz: i32,
    fluid_id: u32,
    space: &S,
    original_faces: &[BlockFace],
    registry: &Registry,
) -> Vec<BlockFace> {
    // Per corner: the two side neighbours, then the diagonal.
    let corner_nxnz: [[i32; 2]; 3] = [[-1, 0], [0, -1], [-1, -1]];
    let corner_pxnz: [[i32; 2]; 3] = [[1, 0], [0, -1], [1, -1]];
    let corner_nxpz: [[i32; 2]; 3] = [[-1, 0], [0, 1], [-1, 1]];
    let corner_pxpz: [[i32; 2]; 3] = [[1, 0], [0, 1], [1, 1]];

    let is_waterlogging = registry
        .get_block_by_id(fluid_id)
        .is_some_and(|block| block.is_waterlogging_fluid);

    let corner_height = |offsets: &[[i32; 2]; 3]| {
        calculate_fluid_corner_height(
            vx,
            vy,
            vz,
            offsets,
            fluid_id,
            is_waterlogging,
            space,
            registry,
        ) - FLUID_SURFACE_OFFSET
    };

    let h_nxnz = corner_height(&corner_nxnz);
    let h_pxnz = corner_height(&corner_pxnz);
    let h_nxpz = corner_height(&corner_nxpz);
    let h_pxpz = corner_height(&corner_pxpz);

    let mut uv_map: HashMap<String, (UV, f32)> = HashMap::new();
    for face in original_faces {
        uv_map.insert(face.name.clone(), (face.range.clone(), face.emissive));
    }
    let get_range = |name: &str| {
        uv_map
            .get(name)
            .map(|(range, _)| range.clone())
            .unwrap_or_default()
    };
    // Generated fluid faces replace the block's authored ones, so an emissive
    // fluid (lava) must carry its glow onto the replacements.
    let get_emissive = |name: &str| uv_map.get(name).map(|(_, e)| *e).unwrap_or(0.0);

    vec![
        BlockFace {
            name: "py".to_string(),
            name_lower: "py".to_string(),
            dir: [0, 1, 0],
            independent: true,
            isolated: false,
            texture_group: None,
            range: get_range("py"),
            emissive: get_emissive("py"),
            corners: [
                CornerData {
                    pos: [0.0, h_nxpz, 1.0],
                    uv: [1.0, 1.0],
                },
                CornerData {
                    pos: [1.0, h_pxpz, 1.0],
                    uv: [0.0, 1.0],
                },
                CornerData {
                    pos: [0.0, h_nxnz, 0.0],
                    uv: [1.0, 0.0],
                },
                CornerData {
                    pos: [1.0, h_pxnz, 0.0],
                    uv: [0.0, 0.0],
                },
            ],
        },
        BlockFace {
            name: "ny".to_string(),
            name_lower: "ny".to_string(),
            dir: [0, -1, 0],
            independent: false,
            isolated: false,
            texture_group: None,
            range: get_range("ny"),
            emissive: get_emissive("ny"),
            corners: [
                CornerData {
                    pos: [1.0, 0.0, 1.0],
                    uv: [1.0, 0.0],
                },
                CornerData {
                    pos: [0.0, 0.0, 1.0],
                    uv: [0.0, 0.0],
                },
                CornerData {
                    pos: [1.0, 0.0, 0.0],
                    uv: [1.0, 1.0],
                },
                CornerData {
                    pos: [0.0, 0.0, 0.0],
                    uv: [0.0, 1.0],
                },
            ],
        },
        BlockFace {
            name: "px".to_string(),
            name_lower: "px".to_string(),
            dir: [1, 0, 0],
            independent: true,
            isolated: false,
            texture_group: None,
            range: get_range("px"),
            emissive: get_emissive("px"),
            corners: [
                CornerData {
                    pos: [1.0, h_pxpz, 1.0],
                    uv: [0.0, h_pxpz],
                },
                CornerData {
                    pos: [1.0, 0.0, 1.0],
                    uv: [0.0, 0.0],
                },
                CornerData {
                    pos: [1.0, h_pxnz, 0.0],
                    uv: [1.0, h_pxnz],
                },
                CornerData {
                    pos: [1.0, 0.0, 0.0],
                    uv: [1.0, 0.0],
                },
            ],
        },
        BlockFace {
            name: "nx".to_string(),
            name_lower: "nx".to_string(),
            dir: [-1, 0, 0],
            independent: true,
            isolated: false,
            texture_group: None,
            range: get_range("nx"),
            emissive: get_emissive("nx"),
            corners: [
                CornerData {
                    pos: [0.0, h_nxnz, 0.0],
                    uv: [0.0, h_nxnz],
                },
                CornerData {
                    pos: [0.0, 0.0, 0.0],
                    uv: [0.0, 0.0],
                },
                CornerData {
                    pos: [0.0, h_nxpz, 1.0],
                    uv: [1.0, h_nxpz],
                },
                CornerData {
                    pos: [0.0, 0.0, 1.0],
                    uv: [1.0, 0.0],
                },
            ],
        },
        BlockFace {
            name: "pz".to_string(),
            name_lower: "pz".to_string(),
            dir: [0, 0, 1],
            independent: true,
            isolated: false,
            texture_group: None,
            range: get_range("pz"),
            emissive: get_emissive("pz"),
            corners: [
                CornerData {
                    pos: [0.0, 0.0, 1.0],
                    uv: [0.0, 0.0],
                },
                CornerData {
                    pos: [1.0, 0.0, 1.0],
                    uv: [1.0, 0.0],
                },
                CornerData {
                    pos: [0.0, h_nxpz, 1.0],
                    uv: [0.0, h_nxpz],
                },
                CornerData {
                    pos: [1.0, h_pxpz, 1.0],
                    uv: [1.0, h_pxpz],
                },
            ],
        },
        BlockFace {
            name: "nz".to_string(),
            name_lower: "nz".to_string(),
            dir: [0, 0, -1],
            independent: true,
            isolated: false,
            texture_group: None,
            range: get_range("nz"),
            emissive: get_emissive("nz"),
            corners: [
                CornerData {
                    pos: [1.0, 0.0, 0.0],
                    uv: [0.0, 0.0],
                },
                CornerData {
                    pos: [0.0, 0.0, 0.0],
                    uv: [1.0, 0.0],
                },
                CornerData {
                    pos: [1.0, h_pxnz, 0.0],
                    uv: [0.0, h_pxnz],
                },
                CornerData {
                    pos: [0.0, h_nxnz, 0.0],
                    uv: [1.0, h_nxnz],
                },
            ],
        },
    ]
}
