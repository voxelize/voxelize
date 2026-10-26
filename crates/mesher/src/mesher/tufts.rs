use voxelize_core::{LightUtils, VoxelAccess, UV};

use super::*;

/// The face name of the geometry a chunk's tufts of one block are laid in,
/// apart from its cube. The client draws it with one double-sided cutout
/// material for every tufted block, which is why each quad is laid once, and
/// can hide it without a remesh.
pub const TUFTS_FACE_NAME: &str = "voxelize:tufts";

const NEIGHBORS: [[i32; 3]; 6] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
];

/// Whether the voxel at `pos` meets the open air on any of its six sides.
fn meets_air<S: VoxelAccess>(pos: [i32; 3], space: &S, registry: &Registry) -> bool {
    NEIGHBORS.iter().any(|[dx, dy, dz]| {
        registry
            .get_block_by_id(space.get_voxel(pos[0] + dx, pos[1] + dy, pos[2] + dz))
            .is_some_and(|b| b.is_empty)
    })
}

/// Six independent unit values picked from a voxel's position: the turn of
/// its set, its nudge along x, y and z, and the lean and heading of its tilt.
fn voxel_hash([vx, vy, vz]: [i32; 3]) -> [f32; 6] {
    let h = (vx as u32).wrapping_mul(73856093)
        ^ (vy as u32).wrapping_mul(19349663)
        ^ (vz as u32).wrapping_mul(83492791);
    let h = h.wrapping_mul(2654435761);
    let g = (h ^ (h >> 15)).wrapping_mul(2246822519);
    let k = (g ^ (g >> 13)).wrapping_mul(3266489917);
    let unit = |bits: u32| (bits & 0xFF) as f32 / 255.0;
    [
        unit(h >> 24),
        unit(h >> 16),
        unit(g >> 8),
        unit(g),
        unit(k >> 24),
        unit(k >> 8),
    ]
}

/// `p` turned by `angle` about the unit axis `axis` through the cell centre.
fn rotate_about(p: [f32; 3], axis: [f32; 3], angle: f32) -> [f32; 3] {
    let v = [p[0] - 0.5, p[1] - 0.5, p[2] - 0.5];
    let (sin, cos) = angle.sin_cos();
    let dot = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2];
    let cross = [
        axis[1] * v[2] - axis[2] * v[1],
        axis[2] * v[0] - axis[0] * v[2],
        axis[0] * v[1] - axis[1] * v[0],
    ];
    let mut out = [0.0; 3];
    for a in 0..3 {
        out[a] = v[a] * cos + cross[a] * sin + axis[a] * dot * (1.0 - cos) + 0.5;
    }
    out
}

/// Lays the tufts ([`Tufts`]) of the voxel at `pos`, if it meets the air, into
/// `geometry`: every quad once, turned, leant and nudged by the voxel's own
/// hash.
pub(super) fn emit_tufts<S: VoxelAccess>(
    pos: [i32; 3],
    block: &Block,
    space: &S,
    registry: &Registry,
    min: &[i32; 3],
    geometry: &mut GeometryProtocol,
) {
    let Some(tufts) = &block.tufts else {
        return;
    };
    if !meets_air(pos, space, registry) {
        return;
    }

    let [vx, vy, vz] = pos;
    let stage = space.get_voxel_stage(vx, vy, vz);
    let faces = tufts.faces_at(stage, block.stage_faces.as_ref().map(|s| s.mask));

    // Kept off the grid every block draws on, so a tuft never shares a plane
    // with another block's face and fights it for depth: the nudge lands on
    // odd sixty-fourths of a block, and the turn half a step past any of 256
    // even steps, never square to the axes. The set then leans by up to
    // `tilt` about a level axis, so its quads stand out of the cube on every
    // side, not only above and below.
    let [turn, nx, ny, nz, lean, heading] = voxel_hash(pos);
    let angle = (turn * 255.0 + 0.5) / 256.0 * std::f32::consts::TAU;
    let (sin, cos) = angle.sin_cos();
    let lean = (lean * 2.0 - 1.0) * tufts.tilt;
    let heading = heading * std::f32::consts::PI;
    let lean_axis = [heading.cos(), 0.0, heading.sin()];
    let off_grid = |n: f32| {
        let nudge = (n * 2.0 - 1.0) * tufts.jitter;
        (nudge * 32.0).round() / 32.0 + 1.0 / 64.0
    };
    let nudge = [off_grid(nx), off_grid(ny), off_grid(nz)];

    let (sunlight, red, green, blue) = space.get_all_lights(vx, vy, vz);
    let mut light = 0u32;
    light = LightUtils::insert_red_light(light, red);
    light = LightUtils::insert_green_light(light, green);
    light = LightUtils::insert_blue_light(light, blue);
    light = LightUtils::insert_sunlight(light, sunlight);

    for face in faces {
        let packed = light as i32 | ao_or_emissive_bits(3, face.emissive);
        let packed = if let Some(pigment) = face_pigment(stage, face.pigment_mask) {
            with_pigment(packed, pigment)
        } else if face.stage_tint_mask != 0 {
            with_stage_tint(packed, stage & face.stage_tint_mask)
        } else if face.regional_tint {
            with_stage_tint(packed, 0)
        } else {
            packed
        };

        let UV {
            start_u,
            end_u,
            start_v,
            end_v,
        } = face.range.clone();

        let mut corners = [[0.0f32; 5]; 4];
        for (out, corner) in corners.iter_mut().zip(face.corners.iter()) {
            let [x, y, z] = corner.pos;
            let (cx, cz) = (x - 0.5, z - 0.5);
            let turned = [cx * cos - cz * sin + 0.5, y, cx * sin + cz * cos + 0.5];
            let [x, y, z] = rotate_about(turned, lean_axis, lean);
            *out = [
                x + nudge[0] + (vx - min[0]) as f32,
                y + nudge[1] + (vy - min[1]) as f32,
                z + nudge[2] + (vz - min[2]) as f32,
                corner.uv[0] * (end_u - start_u) + start_u,
                corner.uv[1] * (end_v - start_v) + start_v,
            ];
        }
        // Corners run in the order every face uses (see `process_face`).
        let base = (geometry.positions.len() / 3) as i32;
        for [x, y, z, u, v] in corners {
            geometry.positions.extend_from_slice(&[x, y, z]);
            geometry.uvs.extend_from_slice(&[u, v]);
            geometry.lights.push(packed);
        }
        geometry
            .indices
            .extend([0, 1, 2, 2, 1, 3].iter().map(|i| base + i));
    }
}
