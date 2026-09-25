//! Connected frames: blocks sharing a [`ConnectedFrame`] draw the frame in
//! their texture border only around the outline of the sheet they form.
//!
//! Faces are compared in world texel space, `texels_per_block` to a block. A
//! texel is part of the sheet when a live face of a same-key block covers it,
//! facing the same way in the same plane. Two such faces meeting in one plane
//! from opposite sides are inside the sheet — the wall two stacked panes
//! share, a pane's post behind its own arm — and neither is drawn there.
//!
//! Every visible texel then samples one texel of the face's own texture:
//! - within `frame_texels` of a texel outside the sheet, the frame band on
//!   that side, so the frame follows the sheet's outline wherever the
//!   geometry ends;
//! - at an inside corner of the outline, the frame's corner;
//! - anywhere else, itself, except that a joined border, where the texture
//!   draws its frame, reflects into the glass beside it — or, when the
//!   texture is clear inside its frame, is not drawn at all. A clear
//!   texture's inside (glints) is kept on one joined block in
//!   `interior_one_in`, picked by position.
//!
//! Texels that sample one translated window of the texture merge into one
//! quad, so density stays uniform, and a face nothing joins keeps its single
//! quad and its original texture.

use voxelize_core::{BlockFace, CornerData, VoxelAccess};

use super::*;

/// A texel-aligned position lands within this of a texel boundary.
const TEXEL_SNAP: f32 = 1e-3;

/// How far inside its texels a piece's UVs are pulled. A fragment on a
/// piece's edge must never read the texel beside it — the frame, next to a
/// joined border — once the client has quantized the UVs.
const UV_INSET_TEXELS: f32 = 1.0 / 16.0;

/// One axis-aligned face of a joined block, in world texel coordinates.
#[derive(Clone, Copy, Debug)]
struct SheetFace {
    axis: usize,
    facing: i32,
    plane: i32,
    min: [i32; 2],
    max: [i32; 2],
    /// False when an opaque neighbour covers it: no part of what is seen.
    live: bool,
}

/// The two axes a face perpendicular to `axis` spans, ascending.
fn plane_axes(axis: usize) -> [usize; 2] {
    match axis {
        0 => [1, 2],
        1 => [0, 2],
        _ => [0, 1],
    }
}

fn snap(value: f32, per_block: i32) -> Option<i32> {
    let texels = value * per_block as f32;
    let rounded = texels.round();
    ((texels - rounded).abs() < TEXEL_SNAP).then_some(rounded as i32)
}

fn normal(face: &BlockFace) -> Option<(usize, i32)> {
    match face.dir {
        [x, 0, 0] if x != 0 => Some((0, x.signum())),
        [0, y, 0] if y != 0 => Some((1, y.signum())),
        [0, 0, z] if z != 0 => Some((2, z.signum())),
        _ => None,
    }
}

/// `face` of the voxel at `voxel` in world texel space, or `None` when it is
/// not an axis-aligned rectangle on texel boundaries.
fn sheet_face(face: &BlockFace, voxel: [i32; 3], per_block: i32) -> Option<SheetFace> {
    let (axis, facing) = normal(face)?;
    let axes = plane_axes(axis);
    let mut plane = None;
    let mut points = [[0i32; 2]; 4];
    for (corner, point) in face.corners.iter().zip(points.iter_mut()) {
        let depth = snap(corner.pos[axis], per_block)? + voxel[axis] * per_block;
        if *plane.get_or_insert(depth) != depth {
            return None;
        }
        for (k, a) in axes.into_iter().enumerate() {
            point[k] = snap(corner.pos[a], per_block)? + voxel[a] * per_block;
        }
    }
    let min = [0, 1].map(|k| points.iter().map(|p| p[k]).min().unwrap_or(0));
    let max = [0, 1].map(|k| points.iter().map(|p| p[k]).max().unwrap_or(0));
    let on_corners = points
        .iter()
        .all(|p| (p[0] == min[0] || p[0] == max[0]) && (p[1] == min[1] || p[1] == max[1]));
    let distinct = (0..4).all(|i| (i + 1..4).all(|j| points[i] != points[j]));
    (min[0] < max[0] && min[1] < max[1] && on_corners && distinct).then_some(SheetFace {
        axis,
        facing,
        plane: plane?,
        min,
        max,
        live: true,
    })
}

/// A face flush with its voxel's boundary is covered there by an opaque
/// neighbour, the same cull the mesher applies to the face itself.
fn is_buried<S: VoxelAccess>(
    face: &SheetFace,
    voxel: [i32; 3],
    per_block: i32,
    space: &S,
    registry: &Registry,
) -> bool {
    let boundary = (voxel[face.axis] + i32::from(face.facing > 0)) * per_block;
    if face.plane != boundary {
        return false;
    }
    let mut beyond = voxel;
    beyond[face.axis] += face.facing;
    registry
        .get_block_by_id(space.get_voxel(beyond[0], beyond[1], beyond[2]))
        .is_some_and(|block| block.is_opaque)
}

/// Every face of the same-frame blocks in the 3x3x3 around `voxel`, whose
/// own faces are `own`: all a face within reach of one frame width can meet.
fn gather_sheet<S: VoxelAccess>(
    frame: &ConnectedFrame,
    voxel: [i32; 3],
    own: &[(BlockFace, bool)],
    space: &S,
    registry: &Registry,
) -> Vec<SheetFace> {
    let per_block = frame.texels_per_block as i32;
    let mut sheet = Vec::new();
    let add = |face: &BlockFace, at: [i32; 3], sheet: &mut Vec<SheetFace>| {
        if let Some(mut face) = sheet_face(face, at, per_block) {
            face.live = !is_buried(&face, at, per_block, space, registry);
            sheet.push(face);
        }
    };
    for (face, _) in own {
        add(face, voxel, &mut sheet);
    }
    for dx in -1..=1 {
        for dy in -1..=1 {
            for dz in -1..=1 {
                if (dx, dy, dz) == (0, 0, 0) {
                    continue;
                }
                let at = [voxel[0] + dx, voxel[1] + dy, voxel[2] + dz];
                let Some(block) = registry.get_block_by_id(space.get_voxel(at[0], at[1], at[2]))
                else {
                    continue;
                };
                if block.connected.as_ref() != Some(frame) {
                    continue;
                }
                if block.dynamic_patterns.is_some() {
                    let rotation = space.get_voxel_rotation(at[0], at[1], at[2]);
                    for (face, _) in get_dynamic_faces(block, at, space, &rotation) {
                        add(&face, at, &mut sheet);
                    }
                } else {
                    for face in &block.faces {
                        add(face, at, &mut sheet);
                    }
                }
            }
        }
    }
    sheet
}

/// How a face's corner parameters map onto positions and texture coordinates:
/// corner 1 is corner 0 plus `edge_s`, corner 2 plus `edge_t`.
struct FaceMap {
    origin: [f32; 3],
    edge_s: [f32; 3],
    edge_t: [f32; 3],
    uv_origin: [f32; 2],
    uv_s: [f32; 2],
    uv_t: [f32; 2],
    texels_s: i32,
    texels_t: i32,
}

/// The single axis `edge` runs along, if it runs along exactly one.
fn single_axis<const N: usize>(edge: [f32; N]) -> Option<usize> {
    let mut found = None;
    for (axis, value) in edge.iter().enumerate() {
        if value.abs() > TEXEL_SNAP {
            if found.is_some() {
                return None;
            }
            found = Some(axis);
        }
    }
    found
}

/// `face` as a rectangle whose texture runs across it at `per_block`, or
/// `None` for any face that is not: those are drawn as they are.
fn face_map(face: &BlockFace, axes: [usize; 2], per_block: i32) -> Option<FaceMap> {
    let [c0, c1, c2, c3] = &face.corners;
    let edge_s = [0, 1, 2].map(|a| c1.pos[a] - c0.pos[a]);
    let edge_t = [0, 1, 2].map(|a| c2.pos[a] - c0.pos[a]);
    let uv_s = [0, 1].map(|a| c1.uv[a] - c0.uv[a]);
    let uv_t = [0, 1].map(|a| c2.uv[a] - c0.uv[a]);
    let is_parallelogram = (0..3)
        .all(|a| (c3.pos[a] - c1.pos[a] - c2.pos[a] + c0.pos[a]).abs() < TEXEL_SNAP)
        && (0..2).all(|a| (c3.uv[a] - c1.uv[a] - c2.uv[a] + c0.uv[a]).abs() < TEXEL_SNAP);
    let (s_axis, t_axis) = (single_axis(edge_s)?, single_axis(edge_t)?);
    let (s_uv, t_uv) = (single_axis(uv_s)?, single_axis(uv_t)?);
    if !is_parallelogram
        || s_axis == t_axis
        || s_uv == t_uv
        || !axes.contains(&s_axis)
        || !axes.contains(&t_axis)
    {
        return None;
    }
    let texels_s = snap(edge_s[s_axis].abs(), per_block)?;
    let texels_t = snap(edge_t[t_axis].abs(), per_block)?;
    let is_uniform = snap(uv_s[s_uv].abs(), per_block)? == texels_s
        && snap(uv_t[t_uv].abs(), per_block)? == texels_t;
    is_uniform.then_some(FaceMap {
        origin: c0.pos,
        edge_s,
        edge_t,
        uv_origin: c0.uv,
        uv_s,
        uv_t,
        texels_s,
        texels_t,
    })
}

/// A world texel step along the plane axes: `edge` projected and signed.
fn plane_step(edge: [f32; 3], axes: [usize; 2], sign: f32) -> [i32; 2] {
    axes.map(|a| {
        if edge[a].abs() > TEXEL_SNAP {
            (edge[a].signum() * sign) as i32
        } else {
            0
        }
    })
}

/// The frame band texel sampled on one texture axis, if the texel is within
/// a frame width of the sheet's outline: `reach_low`/`reach_high` are the
/// distances to the nearest texel outside the sheet toward the texture's
/// low and high edge.
fn band(reach_low: Option<i32>, reach_high: Option<i32>, per_block: i32) -> Option<i32> {
    reach_low
        .map(|k| k - 1)
        .or_else(|| reach_high.map(|k| per_block - k))
}

/// `natural`, reflected into the texture past the `zone` texels at either
/// edge, so a joined border shows what lies beside it instead of the frame.
fn reflect(natural: i32, zone: i32, per_block: i32) -> i32 {
    if natural < zone {
        2 * zone - natural
    } else if natural > per_block - 1 - zone {
        2 * (per_block - 1 - zone) - natural
    } else {
        natural
    }
}

/// Whether the block at `voxel` keeps what its texture draws inside the frame
/// once joined: one block in `one_in`, scattered by world position so a large
/// sheet does not repeat one speck on every block. The same integer hash on
/// every target, so server and client meshes agree.
pub(super) fn keeps_interior(voxel: [i32; 3], one_in: u32) -> bool {
    if one_in <= 1 {
        return true;
    }
    let [x, y, z] = voxel.map(|v| v as u32);
    let mut h =
        x.wrapping_mul(0x8da6_b343) ^ y.wrapping_mul(0xd816_3841) ^ z.wrapping_mul(0xcb1a_b31f);
    h = (h ^ (h >> 15)).wrapping_mul(0x2c1b_3c6d);
    h = (h ^ (h >> 12)).wrapping_mul(0x297a_2d39);
    (h ^ (h >> 15)) % one_in == 0
}

/// The pieces `face` is drawn as, `None` when it is drawn whole as it is.
fn face_pieces(
    face: &BlockFace,
    voxel: [i32; 3],
    frame: &ConnectedFrame,
    sheet: &[SheetFace],
) -> Option<Vec<BlockFace>> {
    let per_block = frame.texels_per_block as i32;
    let width = frame.frame_texels as i32;
    let ramp = frame.corner_texels as i32;
    let own = sheet_face(face, voxel, per_block)?;
    let in_plane: Vec<&SheetFace> = sheet
        .iter()
        .filter(|s| s.axis == own.axis && s.plane == own.plane)
        .collect();
    let met_whole = in_plane.iter().any(|s| {
        s.facing != own.facing
            && s.min[0] <= own.min[0]
            && s.min[1] <= own.min[1]
            && s.max[0] >= own.max[0]
            && s.max[1] >= own.max[1]
    });
    if met_whole {
        return Some(vec![]);
    }
    let axes = plane_axes(own.axis);
    let map = face_map(face, axes, per_block)?;
    // Alone in its plane, a face that shows the whole texture already shows
    // its frame on every side.
    let is_alone = in_plane
        .iter()
        .all(|s| s.facing == own.facing && s.min == own.min && s.max == own.max);
    let shows_whole_texture = map.texels_s == per_block
        && map.texels_t == per_block
        && face.corners.iter().all(|c| {
            c.uv.iter()
                .all(|v| v.abs() < TEXEL_SNAP || (v - 1.0).abs() < TEXEL_SNAP)
        });
    if is_alone && shows_whole_texture {
        return None;
    }
    // A clear texture's inside (glass glints) stays on a face alone in its
    // plane, and on one joined block in `interior_one_in`.
    let keeps_inside = is_alone || keeps_interior(voxel, frame.interior_one_in);

    // The face and one frame width around it: every texel a test can reach.
    let lo = [own.min[0] - width, own.min[1] - width];
    let size = [
        own.max[0] - own.min[0] + 2 * width,
        own.max[1] - own.min[1] + 2 * width,
    ];
    let cell = |p: [i32; 2]| -> Option<usize> {
        let (x, y) = (p[0] - lo[0], p[1] - lo[1]);
        ((0..size[0]).contains(&x) && (0..size[1]).contains(&y))
            .then_some((y * size[0] + x) as usize)
    };
    let mut covered = vec![false; (size[0] * size[1]) as usize];
    let mut inside = vec![false; covered.len()];
    for s in &in_plane {
        let target = if s.facing != own.facing {
            &mut inside
        } else if s.live {
            &mut covered
        } else {
            continue;
        };
        for y in s.min[1].max(lo[1])..s.max[1].min(lo[1] + size[1]) {
            for x in s.min[0].max(lo[0])..s.max[0].min(lo[0] + size[0]) {
                target[((y - lo[1]) * size[0] + (x - lo[0])) as usize] = true;
            }
        }
    }
    let visible = |p: [i32; 2]| cell(p).is_some_and(|i| covered[i] && !inside[i]);

    let step_s = plane_step(map.edge_s, axes, 1.0);
    let step_t = plane_step(map.edge_t, axes, 1.0);
    let origin = axes.map(|a| snap(map.origin[a], per_block).unwrap_or(0) + voxel[a] * per_block);
    // World texel steps that move one texel along texture u and texture v.
    let s_along_u = map.uv_s[0].abs() > TEXEL_SNAP;
    let step_u = if s_along_u {
        plane_step(map.edge_s, axes, map.uv_s[0].signum())
    } else {
        plane_step(map.edge_t, axes, map.uv_t[0].signum())
    };
    let step_v = if s_along_u {
        plane_step(map.edge_t, axes, map.uv_t[1].signum())
    } else {
        plane_step(map.edge_s, axes, map.uv_s[1].signum())
    };
    let at = |p: [i32; 2], du: i32, dv: i32| {
        [
            p[0] + step_u[0] * du + step_v[0] * dv,
            p[1] + step_u[1] * du + step_v[1] * dv,
        ]
    };
    let reach =
        |p: [i32; 2], du: i32, dv: i32| (1..=width).find(|&k| !visible(at(p, du * k, dv * k)));

    let (ns, nt) = (map.texels_s, map.texels_t);
    let mut offsets: Vec<Option<[i32; 2]>> = vec![None; (ns * nt) as usize];
    for j in 0..nt {
        for i in 0..ns {
            let (cs, ct) = ((i as f32 + 0.5) / ns as f32, (j as f32 + 0.5) / nt as f32);
            let p = [0, 1].map(|k| {
                (origin[k] as f32
                    + (i as f32 + 0.5) * step_s[k] as f32
                    + (j as f32 + 0.5) * step_t[k] as f32)
                    .floor() as i32
            });
            if !visible(p) {
                continue;
            }
            let natural = [0, 1].map(|k| {
                ((map.uv_origin[k] + cs * map.uv_s[k] + ct * map.uv_t[k]) * per_block as f32)
                    .floor() as i32
            });
            let band_u = band(reach(p, -1, 0), reach(p, 1, 0), per_block);
            let band_v = band(reach(p, 0, -1), reach(p, 0, 1), per_block);
            // Along a frame band, an end the band carries on past shifts into
            // the middle of the band, past the corner's shading too; an end at
            // the outline keeps it. A shift, unlike a reflection, keeps each
            // end one quad.
            let along = |natural: i32, du: i32, dv: i32| {
                let zone = width + ramp;
                let carries = |dir: i32, texels: i32| {
                    (1..=texels).all(|k| visible(at(p, du * dir * k, dv * dir * k)))
                };
                if natural < zone && carries(-1, natural + 1) {
                    natural + zone
                } else if natural > per_block - 1 - zone && carries(1, per_block - natural) {
                    natural - zone
                } else {
                    reflect(natural, width, per_block)
                }
            };
            let mut u = band_u.unwrap_or_else(|| match band_v {
                Some(_) => along(natural[0], 1, 0),
                None => reflect(natural[0], width, per_block),
            });
            let mut v = band_v.unwrap_or_else(|| match band_u {
                Some(_) => along(natural[1], 0, 1),
                None => reflect(natural[1], width, per_block),
            });
            let mut is_frame = band_u.is_some() || band_v.is_some();
            if !is_frame {
                'corner: for (su, sv) in [(-1, -1), (1, -1), (-1, 1), (1, 1)] {
                    for a in 1..=width {
                        for b in 1..=width {
                            if !visible(at(p, su * a, sv * b)) {
                                u = if su < 0 { a - 1 } else { per_block - a };
                                v = if sv < 0 { b - 1 } else { per_block - b };
                                is_frame = true;
                                break 'corner;
                            }
                        }
                    }
                }
            }
            let on_joined_border = natural
                .iter()
                .any(|&n| n < width || n > per_block - 1 - width);
            if frame.clear_interior && !is_frame && (on_joined_border || !keeps_inside) {
                continue;
            }
            offsets[(j * ns + i) as usize] = Some([u - natural[0], v - natural[1]]);
        }
    }

    // Texels sampling one translated window of the texture share a quad.
    let mut taken = vec![false; offsets.len()];
    let mut rects = Vec::new();
    for j in 0..nt {
        for i in 0..ns {
            let first = (j * ns + i) as usize;
            let Some(offset) = offsets[first].filter(|_| !taken[first]) else {
                continue;
            };
            let joins = |x: i32, y: i32| {
                let n = (y * ns + x) as usize;
                !taken[n] && offsets[n] == Some(offset)
            };
            let mut w = 1;
            while i + w < ns && joins(i + w, j) {
                w += 1;
            }
            let mut h = 1;
            while j + h < nt && (i..i + w).all(|x| joins(x, j + h)) {
                h += 1;
            }
            for y in j..j + h {
                for x in i..i + w {
                    taken[(y * ns + x) as usize] = true;
                }
            }
            rects.push((i, j, w, h, offset));
        }
    }
    if let [(0, 0, w, h, [0, 0])] = rects[..] {
        if w == ns && h == nt {
            return None;
        }
    }

    let texel = 1.0 / per_block as f32;
    let pieces = rects
        .into_iter()
        .map(|(i, j, w, h, [du, dv])| {
            let corner = |cs: f32, ct: f32| CornerData {
                pos: [0, 1, 2].map(|a| map.origin[a] + cs * map.edge_s[a] + ct * map.edge_t[a]),
                uv: [
                    map.uv_origin[0] + cs * map.uv_s[0] + ct * map.uv_t[0] + du as f32 * texel,
                    map.uv_origin[1] + cs * map.uv_s[1] + ct * map.uv_t[1] + dv as f32 * texel,
                ],
            };
            let (s0, s1) = (i as f32 / ns as f32, (i + w) as f32 / ns as f32);
            let (t0, t1) = (j as f32 / nt as f32, (j + h) as f32 / nt as f32);
            let mut corners = [
                corner(s0, t0),
                corner(s1, t0),
                corner(s0, t1),
                corner(s1, t1),
            ];
            let inset = UV_INSET_TEXELS * texel;
            for axis in 0..2 {
                let lo = corners.iter().map(|c| c.uv[axis]).fold(f32::MAX, f32::min);
                let hi = corners.iter().map(|c| c.uv[axis]).fold(f32::MIN, f32::max);
                for c in corners.iter_mut() {
                    c.uv[axis] += if c.uv[axis] < (lo + hi) / 2.0 {
                        inset
                    } else {
                        -inset
                    };
                }
            }
            BlockFace {
                corners,
                ..face.clone()
            }
        })
        .collect();
    Some(pieces)
}

/// The faces the voxel at `voxel` draws once its frame joins the sheet around
/// it: faces inside the sheet dropped, the rest cut so their frame shows only
/// along its outline.
pub(super) fn connect_faces<S: VoxelAccess>(
    frame: &ConnectedFrame,
    voxel: [i32; 3],
    faces: Vec<(BlockFace, bool)>,
    space: &S,
    registry: &Registry,
) -> Vec<(BlockFace, bool)> {
    let sheet = gather_sheet(frame, voxel, &faces, space, registry);
    let mut connected = Vec::with_capacity(faces.len());
    for (face, world_space) in faces {
        match face_pieces(&face, voxel, frame, &sheet) {
            None => connected.push((face, world_space)),
            Some(pieces) => connected.extend(pieces.into_iter().map(|piece| (piece, world_space))),
        }
    }
    connected
}
