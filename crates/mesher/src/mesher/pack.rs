//! A meshed geometry in the layout a client uploads: sixteen-bit positions
//! and texture coordinates, byte normals, the per-quad light twist, the
//! narrowest index type that fits, and a bounding sphere.
//!
//! This is the client's own packing (`vertex-quantization.ts`,
//! `quad-light.ts` and the normals and bounding sphere `mesh-worker.ts` used
//! to compute after the mesher returned), done here so a worker gets finished
//! buffers out of the same call that meshed them instead of walking every
//! vertex again in script. It has to agree with those files to the bit: a
//! server mesh is still packed by them on the main thread, and a section
//! meshed there and remeshed here must not change by a rounding step. The
//! arithmetic below is therefore the script's, in doubles and in the same
//! order, down to how `Math.round` breaks ties.
//! `packages/core/src/core/world/workers/mesh-packing-parity.test.ts` holds
//! the two against each other.

use super::GeometryProtocol;

/// Blocks added to a position before it is scaled into sixteen bits
/// (`POSITION_BLOCK_BIAS` in `vertex-quantization.ts`).
pub const POSITION_BLOCK_BIAS: f64 = 32.0;

/// A twist spans -30..30, stored 0..60 (`QUAD_LIGHT_TWIST_BIAS`).
const QUAD_LIGHT_TWIST_BIAS: u8 = 30;
/// Added to a byte whose vertex is a diagonal corner (`QUAD_LIGHT_CORNER_FLAG`).
const QUAD_LIGHT_CORNER_FLAG: u8 = 64;
/// The light word's channel behind each twist byte: red, green, blue, sun.
const CHANNEL_SHIFTS: [u32; 4] = [8, 4, 0, 12];

pub enum PackedPositions {
    Quantized(Vec<u16>),
    Float(Vec<f32>),
}

pub enum PackedUvs {
    Quantized(Vec<u16>),
    Float(Vec<f32>),
}

pub enum PackedNormals {
    Quantized(Vec<i8>),
    Float(Vec<f32>),
}

pub enum PackedIndices {
    Short(Vec<u16>),
    Wide(Vec<u32>),
}

pub struct PackedGeometry {
    pub voxel: u32,
    pub at: Option<[i32; 3]>,
    pub face_name: Option<String>,
    pub positions: PackedPositions,
    pub uvs: PackedUvs,
    pub normals: PackedNormals,
    pub indices: PackedIndices,
    pub lights: Vec<i32>,
    pub light_twist: Vec<u8>,
    /// In the units `positions` are in.
    pub bs_center: [f64; 3],
    pub bs_radius: f64,
}

/// `Math.round`: the nearest integer, a tie going up.
#[inline(always)]
fn js_round(value: f64) -> f64 {
    let floor = value.floor();
    if value - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    }
}

/// `js_round` of a value that came from a float by steps that leave adding a
/// half exact: then the nearest integer, a tie going up, is the floor of the
/// sum. A float has 24 significant bits; biased by a small integer and scaled
/// by a power of two, or scaled by 65535, it still has far fewer than a
/// double's 53, so the half lands on a bit the sum can hold. The one double
/// this differs from `js_round` on (just under one half, where the sum rounds
/// up to one) has 53 significant bits and cannot come out of such a step.
#[inline(always)]
fn round_narrow(value: f64) -> f64 {
    (value + 0.5).floor()
}

/// The integer a typed array wraps into its element: zero for what is not a
/// number, the value modulo 2^64 otherwise (narrowed further by the caller).
#[inline(always)]
fn to_wrapped(value: f64) -> i64 {
    // In range for an `i32` is every value a mesh holds; the cast is exact
    // there and one instruction.
    if value.abs() < 2147483648.0 {
        value as i32 as i64
    } else if value.is_finite() {
        // `as i64` saturates past 2^63; the remainder is exact and in range.
        (value % 18446744073709551616.0) as i128 as i64
    } else {
        0
    }
}

/// What storing a number in a `Uint16Array` keeps of it.
#[inline(always)]
fn to_u16(value: f64) -> u16 {
    to_wrapped(value) as u16
}

/// What storing a number in an `Int8Array` keeps of it.
#[inline(always)]
fn to_i8(value: f64) -> i8 {
    to_wrapped(value) as i8
}

/// A triangle's unit normal as the script computes it: the cross product of
/// two edges, in doubles, over its length.
///
/// Nearly every triangle a mesher emits lies on an axis plane, where the
/// cross product has one component and dividing it by its own magnitude is
/// exactly one: `sqrt(x * x)` is `|x|` in binary floating point, so the
/// square root and the three divisions are skipped without changing a bit.
/// The zero components keep the sign the cross product gave them, as a
/// division of a signed zero would.
#[inline(always)]
fn triangle_normal(a: [f64; 3], b: [f64; 3], c: [f64; 3]) -> [f64; 3] {
    let e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1];
    let ny = e1[2] * e2[0] - e1[0] * e2[2];
    let nz = e1[0] * e2[1] - e1[1] * e2[0];

    let unit = |value: f64| if value > 0.0 { 1.0 } else { -1.0 };
    let is_finite = nx.is_finite() && ny.is_finite() && nz.is_finite();
    if is_finite && ny == 0.0 && nz == 0.0 && nx != 0.0 {
        return [unit(nx), ny, nz];
    }
    if is_finite && nx == 0.0 && nz == 0.0 && ny != 0.0 {
        return [nx, unit(ny), nz];
    }
    if is_finite && nx == 0.0 && ny == 0.0 && nz != 0.0 {
        return [nx, ny, unit(nz)];
    }

    let len = (nx * nx + ny * ny + nz * nz).sqrt();
    if len > 0.0 {
        [nx / len, ny / len, nz / len]
    } else {
        [nx, ny, nz]
    }
}

/// One flat normal per triangle, handed to `write` with where its three
/// vertices start in `positions`; a vertex shared by several triangles keeps
/// the last one's.
#[inline(always)]
fn for_each_triangle_normal(
    positions: &[f32],
    indices: &[i32],
    mut write: impl FnMut([usize; 3], [f64; 3]),
) {
    let at = |index: usize| -> Option<[f64; 3]> {
        let p = positions.get(index..index + 3)?;
        Some([p[0] as f64, p[1] as f64, p[2] as f64])
    };
    for triangle in indices.chunks_exact(3) {
        let ia = triangle[0] as usize * 3;
        let ib = triangle[1] as usize * 3;
        let ic = triangle[2] as usize * 3;
        let (Some(a), Some(b), Some(c)) = (at(ia), at(ib), at(ic)) else {
            continue;
        };
        write([ia, ib, ic], triangle_normal(a, b, c));
    }
}

/// The centroid of the vertices and the farthest one's distance from it.
fn bounding_sphere(positions: &[f32]) -> ([f64; 3], f64) {
    let count = positions.len() / 3;
    if count == 0 {
        return ([0.0; 3], 0.0);
    }
    let mut center = [0.0f64; 3];
    for p in positions.chunks_exact(3) {
        center[0] += p[0] as f64;
        center[1] += p[1] as f64;
        center[2] += p[2] as f64;
    }
    let count = count as f64;
    center = [center[0] / count, center[1] / count, center[2] / count];
    let mut max_r2 = 0.0f64;
    for p in positions.chunks_exact(3) {
        let dx = p[0] as f64 - center[0];
        let dy = p[1] as f64 - center[1];
        let dz = p[2] as f64 - center[2];
        let r2 = dx * dx + dy * dy + dz * dz;
        if r2 > max_r2 {
            max_r2 = r2;
        }
    }
    (center, max_r2.sqrt())
}

/// `computeQuadLightTwist` in `quad-light.ts`: four bytes a vertex, each
/// quad's twist per channel with the flag on its diagonal's two corners.
pub fn quad_light_twist(lights: &[i32], indices: &[i32]) -> Vec<u8> {
    let vertex_count = lights.len() as i64;
    let mut twist = vec![QUAD_LIGHT_TWIST_BIAS; lights.len() * 4];

    for quad in indices.chunks_exact(6) {
        let n = quad[0] as i64;
        if quad[1] as i64 != n + 1 || n < 0 || n + 3 >= vertex_count {
            continue;
        }
        let rest = [quad[2] as i64, quad[3] as i64, quad[4] as i64, quad[5] as i64];
        // Which corners end the diagonal the two triangles share; the twist
        // rides on `head`, the other end is `tail`.
        let (head, tail, sign) = if rest == [n + 3, n + 3, n + 2, n] {
            (n, n + 3, 1)
        } else if rest == [n + 2, n + 2, n + 1, n + 3] {
            (n + 2, n + 1, -1)
        } else {
            continue;
        };

        let n = n as usize;
        let [la, lb, lc, ld] = [lights[n], lights[n + 1], lights[n + 2], lights[n + 3]];
        for (channel, shift) in CHANNEL_SHIFTS.into_iter().enumerate() {
            let k = sign
                * (((la >> shift) & 0xF) + ((ld >> shift) & 0xF)
                    - ((lb >> shift) & 0xF)
                    - ((lc >> shift) & 0xF));
            let byte = (k + QUAD_LIGHT_TWIST_BIAS as i32) as u8;
            for vertex in n..n + 4 {
                twist[vertex * 4 + channel] = byte;
            }
        }
        twist[head as usize * 4] = twist[head as usize * 4].wrapping_add(QUAD_LIGHT_CORNER_FLAG);
        twist[tail as usize * 4 + 1] =
            twist[tail as usize * 4 + 1].wrapping_add(QUAD_LIGHT_CORNER_FLAG);
    }

    twist
}

/// Packs one geometry. `is_quantized` picks the compact layout; a geometry
/// the client sorts on its main thread (a fluid, glass) keeps floats, which
/// that sorter reads. `position_units` is the world's
/// `positionUnitsPerBlock`.
pub fn pack_geometry(
    geometry: GeometryProtocol,
    position_units: f64,
    is_quantized: bool,
) -> PackedGeometry {
    let GeometryProtocol {
        voxel,
        at,
        face_name,
        positions,
        indices,
        uvs,
        lights,
    } = geometry;

    let vertex_count = positions.len() / 3;
    let (center, radius) = bounding_sphere(&positions);
    let light_twist = quad_light_twist(&lights, &indices);

    // More than 65535 vertices wrap a sixteen-bit index and tear wedges
    // through the mesh; such a geometry indexes wide.
    let packed_indices = if vertex_count > 65535 {
        PackedIndices::Wide(indices.iter().map(|&index| index as u32).collect())
    } else {
        PackedIndices::Short(indices.iter().map(|&index| index as u16).collect())
    };

    if !is_quantized {
        let mut normals = vec![0.0f32; positions.len()];
        for_each_triangle_normal(&positions, &indices, |corners, normal| {
            let normal = normal.map(|component| component as f32);
            for base in corners {
                normals[base..base + 3].copy_from_slice(&normal);
            }
        });
        return PackedGeometry {
            voxel,
            at,
            face_name,
            positions: PackedPositions::Float(positions),
            uvs: PackedUvs::Float(uvs),
            normals: PackedNormals::Float(normals),
            indices: packed_indices,
            lights,
            light_twist,
            bs_center: center,
            bs_radius: radius,
        };
    }

    // The script stores a normal in a `Float32Array` and then rounds it to a
    // byte, so the double goes through a float on its way.
    let mut normals = vec![0i8; positions.len()];
    for_each_triangle_normal(&positions, &indices, |corners, normal| {
        let bytes = normal.map(|component| {
            if component == 1.0 {
                127
            } else if component == -1.0 {
                -127
            } else if component == 0.0 {
                0
            } else {
                to_i8(js_round(component as f32 as f64 * 127.0))
            }
        });
        for base in corners {
            normals[base..base + 3].copy_from_slice(&bytes);
        }
    });

    // A power-of-two scale (every world's is: `positionUnitsPerBlock`) keeps
    // a biased position's bits, so its rounding is the short form.
    let is_binary_scale = position_units.is_finite()
        && position_units > 0.0
        && position_units.to_bits() & ((1u64 << 52) - 1) == 0;

    PackedGeometry {
        voxel,
        at,
        face_name,
        positions: PackedPositions::Quantized(if is_binary_scale {
            positions
                .iter()
                .map(|&p| to_u16(round_narrow((p as f64 + POSITION_BLOCK_BIAS) * position_units)))
                .collect()
        } else {
            positions
                .iter()
                .map(|&p| to_u16(js_round((p as f64 + POSITION_BLOCK_BIAS) * position_units)))
                .collect()
        }),
        uvs: PackedUvs::Quantized(
            uvs.iter()
                .map(|&uv| {
                    let uv = uv as f64;
                    // `Math.min(Math.max(uv, 0), 1)` keeps a NaN a NaN.
                    let clamped = if uv.is_nan() { uv } else { uv.clamp(0.0, 1.0) };
                    to_u16(round_narrow(clamped * 65535.0))
                })
                .collect(),
        ),
        normals: PackedNormals::Quantized(normals),
        indices: packed_indices,
        lights,
        light_twist,
        bs_center: center.map(|c| (c + POSITION_BLOCK_BIAS) * position_units),
        bs_radius: radius * position_units,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounding_breaks_ties_upward_like_math_round() {
        assert_eq!(js_round(0.5), 1.0);
        assert_eq!(js_round(1.5), 2.0);
        assert_eq!(js_round(-0.5), 0.0);
        assert_eq!(js_round(-1.5), -1.0);
        assert_eq!(js_round(2.4999), 2.0);
        // The double just under one half does not round up, as it would by
        // adding a half first.
        assert_eq!(js_round(0.49999999999999994), 0.0);
    }

    #[test]
    fn the_short_rounding_agrees_on_everything_a_float_can_hand_it() {
        // Positions: every float near the values a mesh holds, biased and
        // scaled by each power of two a world can have.
        let mut seed = 0x9E37_79B9u32;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            seed
        };
        let interesting = [
            0.0f32, -0.0, 0.5, -0.5, 1.0e-4, -1.0e-4, 0.9999, 31.9999, -31.9999, -32.0, 1.0e-30,
            -1.0e-30, 63.5, 0.49999997, 0.50000006, f32::MIN_POSITIVE,
        ];
        for units in [1.0f64, 2.0, 64.0, 256.0, 512.0] {
            let check = |p: f32| {
                let value = (p as f64 + POSITION_BLOCK_BIAS) * units;
                // Compared as stored: what is not a number stores as zero.
                assert_eq!(
                    to_u16(round_narrow(value)),
                    to_u16(js_round(value)),
                    "position {p} x{units}"
                );
                if value.is_finite() {
                    assert_eq!(round_narrow(value), js_round(value), "position {p} x{units}");
                }
            };
            for p in interesting {
                check(p);
            }
            for _ in 0..200_000 {
                // Sixty-fourths of a block round to ties at every scale;
                // random bits cover the rest.
                check((next() % 8192) as f32 / 64.0 - 32.0);
                check(f32::from_bits(next()) % 96.0);
            }
        }
        for _ in 0..400_000 {
            let uv = (f32::from_bits(next()) % 2.0).abs().min(1.0);
            let value = uv as f64 * 65535.0;
            assert_eq!(round_narrow(value), js_round(value), "uv {uv}");
        }
        for k in 0..=65535u32 {
            // Texel edges and centres, where a half does come up.
            for value in [k as f64 + 0.5, (k as f32 / 65535.0) as f64 * 65535.0] {
                assert_eq!(round_narrow(value), js_round(value), "value {value}");
            }
        }
    }

    #[test]
    fn typed_array_stores_wrap_and_drop_what_is_not_a_number() {
        assert_eq!(to_u16(65536.0), 0);
        assert_eq!(to_u16(-1.0), 65535);
        assert_eq!(to_u16(f64::NAN), 0);
        assert_eq!(to_u16(f64::INFINITY), 0);
        assert_eq!(to_u16(4294967296.0 + 7.0), 7);
        assert_eq!(to_u16(-4294967296.0 - 7.0), 65529);
        assert_eq!(to_i8(-127.0), -127);
        assert_eq!(to_i8(128.0), -128);
    }

    #[test]
    fn an_axis_plane_normal_is_the_one_the_division_gives() {
        // The shortcut in `triangle_normal` against the plain formula, on
        // triangles in every axis plane and both windings, at coordinates
        // whose products do not fit a float.
        let general = |a: [f64; 3], b: [f64; 3], c: [f64; 3]| {
            let e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            let e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
            let n = [
                e1[1] * e2[2] - e1[2] * e2[1],
                e1[2] * e2[0] - e1[0] * e2[2],
                e1[0] * e2[1] - e1[1] * e2[0],
            ];
            let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
            if len > 0.0 {
                [n[0] / len, n[1] / len, n[2] / len]
            } else {
                n
            }
        };
        let steps = [0.0f32, 1.0, 0.9999, 31.0001, 7.3, -2.71, 1234.567];
        for axis in 0..3 {
            for &u in &steps {
                for &v in &steps {
                    for &w in &steps {
                        let place = |p: f32, q: f32| {
                            let mut point = [w as f64; 3];
                            point[(axis + 1) % 3] = p as f64;
                            point[(axis + 2) % 3] = q as f64;
                            point
                        };
                        let (a, b, c) = (place(0.0, 0.0), place(u, 0.0), place(0.0, v));
                        for (b, c) in [(b, c), (c, b)] {
                            let fast = triangle_normal(a, b, c);
                            let slow = general(a, b, c);
                            assert_eq!(
                                fast.map(f64::to_bits),
                                slow.map(f64::to_bits),
                                "axis {axis} u {u} v {v} w {w}"
                            );
                        }
                    }
                }
            }
        }
        // A tilted triangle takes the plain formula.
        let tilted = ([0.0, 0.0, 0.0], [1.0, 0.5, 0.0], [0.0, 0.25, 1.0]);
        assert_eq!(
            triangle_normal(tilted.0, tilted.1, tilted.2).map(f64::to_bits),
            general(tilted.0, tilted.1, tilted.2).map(f64::to_bits)
        );
    }

    #[test]
    fn a_quad_packs_to_the_compact_layout() {
        let quad = GeometryProtocol {
            voxel: 7,
            at: None,
            face_name: None,
            positions: vec![0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0],
            indices: vec![0, 1, 2, 2, 1, 3],
            uvs: vec![1.0, 1.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0],
            lights: vec![0xF000, 0xF000, 0xF000, 0xE000],
        };
        let packed = pack_geometry(quad, 256.0, true);
        let PackedPositions::Quantized(positions) = &packed.positions else {
            panic!("quantized positions");
        };
        assert_eq!(positions[0], 32 * 256);
        assert_eq!(positions[1], 33 * 256);
        let PackedNormals::Quantized(normals) = &packed.normals else {
            panic!("quantized normals");
        };
        assert_eq!(&normals[0..3], &[0, 127, 0]);
        let PackedUvs::Quantized(uvs) = &packed.uvs else {
            panic!("quantized uvs");
        };
        assert_eq!(&uvs[0..4], &[65535, 65535, 0, 65535]);
        assert!(matches!(packed.indices, PackedIndices::Short(_)));
        // Split along 1-2: the twist rides on vertex 2, its tail is vertex 1,
        // and the sun channel (the fourth byte) carries -(a + d - b - c) = 1.
        assert_eq!(packed.light_twist[2 * 4], 30 + 64);
        assert_eq!(packed.light_twist[4 + 1], 30 + 64);
        assert_eq!(packed.light_twist[3], 31);
    }
}
