use hashbrown::HashMap;

use voxelize_core::{
    BlockFace, CornerData, VoxelAccess, UV,
};

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

pub(super) fn calculate_fluid_corner_height<S: VoxelAccess>(
    vx: i32,
    vy: i32,
    vz: i32,
    corner_x: i32,
    corner_z: i32,
    corner_offsets: &[[i32; 2]; 3],
    fluid_id: u32,
    is_waterlogging: bool,
    space: &S,
    registry: &Registry,
) -> f32 {
    let upper_check_offsets: [[i32; 2]; 4] = [
        [corner_x - 1, corner_z - 1],
        [corner_x - 1, corner_z],
        [corner_x, corner_z - 1],
        [corner_x, corner_z],
    ];

    for [dx, dz] in upper_check_offsets {
        if voxel_holds_fluid(vx + dx, vy + 1, vz + dz, fluid_id, is_waterlogging, space) {
            return 1.0;
        }
    }

    let self_height = get_fluid_effective_height(space.get_voxel_fluid_level(vx, vy, vz));

    let mut total_height = self_height;
    let mut count = 1.0;
    let mut has_air_neighbor = false;
    let mut has_solid_neighbor = false;

    for [dx, dz] in corner_offsets {
        let nx = vx + dx;
        let nz = vz + dz;

        if has_fluid_above(nx, vy, nz, fluid_id, is_waterlogging, space) {
            total_height += 1.0;
            count += 1.0;
        } else if let Some(h) = get_fluid_height_at(nx, vy, nz, fluid_id, is_waterlogging, space) {
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
    let corner_nxnz: [[i32; 2]; 3] = [[-1, 0], [0, -1], [-1, -1]];
    let corner_pxnz: [[i32; 2]; 3] = [[1, 0], [0, -1], [1, -1]];
    let corner_nxpz: [[i32; 2]; 3] = [[-1, 0], [0, 1], [-1, 1]];
    let corner_pxpz: [[i32; 2]; 3] = [[1, 0], [0, 1], [1, 1]];

    let is_waterlogging = registry
        .get_block_by_id(fluid_id)
        .is_some_and(|block| block.is_waterlogging_fluid);

    let corner_height = |corner_x: i32, corner_z: i32, offsets: &[[i32; 2]; 3]| {
        calculate_fluid_corner_height(
            vx,
            vy,
            vz,
            corner_x,
            corner_z,
            offsets,
            fluid_id,
            is_waterlogging,
            space,
            registry,
        ) - FLUID_SURFACE_OFFSET
    };

    let h_nxnz = corner_height(0, 0, &corner_nxnz);
    let h_pxnz = corner_height(1, 0, &corner_pxnz);
    let h_nxpz = corner_height(0, 1, &corner_nxpz);
    let h_pxpz = corner_height(1, 1, &corner_pxpz);

    let mut uv_map: HashMap<String, UV> = HashMap::new();
    for face in original_faces {
        uv_map.insert(face.name.clone(), face.range.clone());
    }
    let get_range = |name: &str| uv_map.get(name).cloned().unwrap_or_default();

    vec![
        BlockFace {
            name: "py".to_string(),
            name_lower: "py".to_string(),
            dir: [0, 1, 0],
            independent: true,
            isolated: false,
            texture_group: None,
            range: get_range("py"),
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
