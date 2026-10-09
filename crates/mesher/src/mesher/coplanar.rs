//! Joins the quads branch voxels draw edge to edge on one plane.
//!
//! A wide trunk redraws its round outline on every level, and a straight
//! trunk its four sides in every voxel. Two such quads that meet along a
//! whole edge, face the same way, wear the same texture tile and are lit
//! the same along the edge they share draw exactly what one quad spanning
//! both draws on the greedy path: the shader reads a greedy quad's texels
//! from its world position, which is where these faces sample them anyway
//! ([`uv_follows_world`]).

use hashbrown::HashMap;
use voxelize_core::{BlockFace, UV};

use super::*;

/// The texture coordinate the shader gives a greedy quad's point at `pos`
/// (in blocks of its voxel) on a face toward `dir`: its `greedyFaceUv`.
fn world_uv(dir: [i32; 3], [x, y, z]: [f32; 3]) -> Option<[f32; 2]> {
    Some(match dir {
        [1, 0, 0] => [1.0 - z, y],
        [-1, 0, 0] => [z, y],
        [0, 1, 0] => [1.0 - x, z],
        [0, -1, 0] => [x, 1.0 - z],
        [0, 0, 1] => [x, y],
        [0, 0, -1] => [1.0 - x, y],
        _ => return None,
    })
}

/// Whether every corner of `face` samples its texture where a greedy quad
/// would sample it at that point, so the face may be drawn as part of one.
pub(super) fn uv_follows_world(face: &BlockFace) -> bool {
    face.corners.iter().all(|corner| {
        world_uv(face.dir, corner.pos).is_some_and(|uv| {
            (uv[0] - corner.uv[0]).abs() < 1e-5 && (uv[1] - corner.uv[1]).abs() < 1e-5
        })
    })
}

/// One quad as `process_face` wrote it, its triangles counted from its own
/// first vertex.
struct HeldQuad {
    positions: [f32; 12],
    uvs: [f32; 8],
    lights: [i32; 4],
    triangles: [i32; 6],
}

/// What quads must share to be joined: the block whose geometry they go to,
/// the way they face, the plane they lie on and the atlas tile they wear.
#[derive(Clone, Copy, Hash, PartialEq, Eq, PartialOrd, Ord)]
struct PlaneKey {
    voxel: u32,
    dir: [i32; 3],
    plane: u32,
    tile: [u32; 4],
}

/// The quads held back from a mesh until every voxel has drawn its own.
#[derive(Default)]
pub(super) struct CoplanarQuads {
    planes: HashMap<PlaneKey, Vec<HeldQuad>>,
}

impl CoplanarQuads {
    /// Holds the quad of `voxel`'s face toward `dir` in `tile` that these
    /// buffers hold, and nothing else. Answers false, holding nothing, when
    /// they are not exactly one flat quad.
    pub(super) fn hold(
        &mut self,
        voxel: u32,
        dir: [i32; 3],
        tile: &UV,
        positions: &[f32],
        uvs: &[f32],
        lights: &[i32],
        indices: &[i32],
    ) -> bool {
        let (Ok(positions), Ok(uvs), Ok(lights), Ok(triangles)) = (
            <[f32; 12]>::try_from(positions),
            <[f32; 8]>::try_from(uvs),
            <[i32; 4]>::try_from(lights),
            <[i32; 6]>::try_from(indices),
        ) else {
            return false;
        };
        let Some(axis) = (0..3).find(|&a| dir[a] != 0) else {
            return false;
        };
        let plane = positions[axis];
        if (0..4).any(|v| positions[v * 3 + axis] != plane)
            || triangles.iter().any(|&i| !(0..4).contains(&i))
        {
            return false;
        }
        let key = PlaneKey {
            voxel,
            dir,
            plane: plane.to_bits(),
            tile: [tile.start_u, tile.end_u, tile.start_v, tile.end_v].map(f32::to_bits),
        };
        self.planes.entry(key).or_default().push(HeldQuad {
            positions,
            uvs,
            lights,
            triangles,
        });
        true
    }

    /// Writes every held quad, joined with its neighbours where they meet,
    /// into the geometry of its voxel's block. Plane by plane in one order,
    /// so the server's mesh and the client's remesh lay out the same buffers.
    pub(super) fn emit(self, registry: &Registry, map: &mut HashMap<String, GeometryProtocol>) {
        let mut planes: Vec<(PlaneKey, Vec<HeldQuad>)> = self.planes.into_iter().collect();
        planes.sort_by_key(|(key, _)| *key);
        for (key, quads) in planes {
            let Some(block) = registry.get_block_by_id(key.voxel) else {
                continue;
            };
            let geometry = map
                .entry(block.get_name_lower().to_string())
                .or_insert_with(|| GeometryProtocol {
                    voxel: key.voxel,
                    ..Default::default()
                });
            let axis = (0..3).find(|&a| key.dir[a] != 0).unwrap_or(0);
            let across = match axis {
                0 => [1, 2],
                1 => [0, 2],
                _ => [0, 1],
            };
            let mut rects = Vec::with_capacity(quads.len());
            for (index, quad) in quads.iter().enumerate() {
                match Rect::of(quad, across, index) {
                    Some(rect) => rects.push(rect),
                    None => push_quad(geometry, quad, None, across),
                }
            }
            join(&mut rects);
            for rect in &rects {
                let quad = &quads[rect.first];
                push_quad(geometry, quad, (rect.count > 1).then_some(rect), across);
            }
        }
    }
}

/// A held quad, or several joined, on the two axes across its plane.
struct Rect {
    lo: [f32; 2],
    hi: [f32; 2],
    /// The light word at each corner: `[low or high on the first axis]
    /// [low or high on the second]`.
    light: [[i32; 2]; 2],
    /// The held quad it grew from: its vertex order, texture coordinates
    /// and triangles are the joined quad's.
    first: usize,
    count: usize,
}

impl Rect {
    fn of(quad: &HeldQuad, across: [usize; 2], first: usize) -> Option<Self> {
        let corner = |v: usize| across.map(|a| quad.positions[v * 3 + a]);
        let mut lo = corner(0);
        let mut hi = lo;
        for v in 1..4 {
            for (k, value) in corner(v).into_iter().enumerate() {
                lo[k] = lo[k].min(value);
                hi[k] = hi[k].max(value);
            }
        }
        if lo[0] >= hi[0] || lo[1] >= hi[1] {
            return None;
        }
        let mut light = [[None; 2]; 2];
        for v in 0..4 {
            let [a, b] = corner(v);
            let side = |value: f32, k: usize| {
                if value == lo[k] {
                    Some(0)
                } else if value == hi[k] {
                    Some(1)
                } else {
                    None
                }
            };
            let (i, j) = (side(a, 0)?, side(b, 1)?);
            if light[i][j].replace(quad.lights[v]).is_some() {
                return None;
            }
        }
        Some(Self {
            lo,
            hi,
            light: light.map(|row| row.map(|value| value.unwrap_or_default())),
            first,
            count: 1,
        })
    }

    /// Whether it is lit the same at both ends along axis `k`.
    fn is_even_along(&self, k: usize) -> bool {
        if k == 0 {
            self.light[0] == self.light[1]
        } else {
            self.light[0][0] == self.light[0][1] && self.light[1][0] == self.light[1][1]
        }
    }
}

/// Joins rects until no two meet: alternately along each axis across the
/// plane, so a column of joined quads can then join the column beside it.
fn join(rects: &mut Vec<Rect>) {
    loop {
        let along_second = join_along(rects, 1);
        let along_first = join_along(rects, 0);
        if !along_second && !along_first {
            break;
        }
    }
}

/// Joins rects that meet end to end along axis `k` over the same extent on
/// the other axis, where both are lit evenly along `k` and alike. Joining
/// those changes no corner's light, so the quad draws what the two drew.
fn join_along(rects: &mut Vec<Rect>, k: usize) -> bool {
    let o = 1 - k;
    rects.sort_by(|a, b| {
        a.lo[o]
            .total_cmp(&b.lo[o])
            .then(a.hi[o].total_cmp(&b.hi[o]))
            .then(a.lo[k].total_cmp(&b.lo[k]))
    });
    let mut joined = false;
    let mut kept: Vec<Rect> = Vec::with_capacity(rects.len());
    for rect in rects.drain(..) {
        if let Some(last) = kept.last_mut() {
            let lit_alike = if k == 0 {
                last.light[0] == rect.light[0]
            } else {
                last.light[0][0] == rect.light[0][0] && last.light[1][0] == rect.light[1][0]
            };
            if last.lo[o] == rect.lo[o]
                && last.hi[o] == rect.hi[o]
                && last.hi[k] == rect.lo[k]
                && last.is_even_along(k)
                && rect.is_even_along(k)
                && lit_alike
            {
                last.hi[k] = rect.hi[k];
                last.count += rect.count;
                joined = true;
                continue;
            }
        }
        kept.push(rect);
    }
    *rects = kept;
    joined
}

/// Writes `quad`, or the joined quad `rect` grew from it, into `geometry`.
/// A joined quad keeps the vertex order, texture tile and triangles of the
/// quad it grew from, takes `rect`'s corners, and is drawn on the greedy
/// path, which samples its texels by world position.
fn push_quad(
    geometry: &mut GeometryProtocol,
    quad: &HeldQuad,
    rect: Option<&Rect>,
    across: [usize; 2],
) {
    let base = (geometry.positions.len() / 3) as i32;
    let own = rect.and_then(|_| Rect::of(quad, across, 0));
    for v in 0..4 {
        let mut position = [
            quad.positions[v * 3],
            quad.positions[v * 3 + 1],
            quad.positions[v * 3 + 2],
        ];
        let mut light = quad.lights[v];
        if let (Some(rect), Some(own)) = (rect, &own) {
            for (k, &axis) in across.iter().enumerate() {
                position[axis] = if position[axis] == own.lo[k] {
                    rect.lo[k]
                } else {
                    rect.hi[k]
                };
            }
            light |= GREEDY_BIT;
        }
        geometry.positions.extend_from_slice(&position);
        geometry.uvs.extend_from_slice(&quad.uvs[v * 2..v * 2 + 2]);
        geometry.lights.push(light);
    }
    geometry
        .indices
        .extend(quad.triangles.iter().map(|&index| base + index));
}
