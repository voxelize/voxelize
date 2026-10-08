//! Channel networks: polylines with a payload per vertex, answering
//! per-column "which channels pass within reach, and where on them".
//!
//! A canyon's course, a river's reaches or a creek's route is a polyline
//! whose vertices carry the landform's own data (arc position, width, water
//! level, side). Segments are bucketed by the reach they influence, so a
//! query costs one bucket. Distances use `sqrt`, never `hypot`, so results
//! are the same bits on every platform; queries visit segments in index
//! order, so every fold over them is deterministic.

use hashbrown::HashMap;

use super::geometry::{segment_distance, Aabb2};

/// Payloads that can be interpolated along a segment.
pub trait Lerp: Copy {
    fn lerp(a: Self, b: Self, t: f64) -> Self;
}

impl Lerp for f64 {
    #[inline]
    fn lerp(a: Self, b: Self, t: f64) -> Self {
        a + (b - a) * t
    }
}

impl Lerp for f32 {
    #[inline]
    fn lerp(a: Self, b: Self, t: f64) -> Self {
        (a as f64 + (b as f64 - a as f64) * t) as f32
    }
}

impl<const N: usize> Lerp for [f64; N] {
    #[inline]
    fn lerp(a: Self, b: Self, t: f64) -> Self {
        let mut out = a;
        for i in 0..N {
            out[i] = a[i] + (b[i] - a[i]) * t;
        }
        out
    }
}

/// A polyline vertex with its payload.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ChannelVertex<P> {
    pub x: f64,
    pub z: f64,
    pub payload: P,
}

impl<P> ChannelVertex<P> {
    pub fn new(x: f64, z: f64, payload: P) -> Self {
        Self { x, z, payload }
    }
}

/// Where a query point lies relative to one segment of a network.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ChannelHit<P> {
    /// Distance to the segment.
    pub dist: f64,
    /// Signed distance: positive on the side a direction turns toward when
    /// rotated from +x to +z (counter-clockwise, as `unit_dir` counts).
    pub side: f64,
    /// Parameter of the nearest point along the segment, in [0, 1].
    pub t: f64,
    /// Arc length of the nearest point from its line's first vertex.
    pub s: f64,
    pub line: u32,
    pub segment: u32,
    /// The segment's end payloads.
    pub a: P,
    pub b: P,
}

impl<P: Lerp> ChannelHit<P> {
    /// The payload interpolated at the nearest point.
    pub fn payload(&self) -> P {
        P::lerp(self.a, self.b, self.t)
    }
}

#[derive(Clone, Copy, Debug)]
struct Segment {
    a: u32,
    line: u32,
    arc0: f64,
    len: f64,
}

/// A network of polylines with per-vertex payloads.
#[derive(Clone, Debug)]
pub struct ChannelNet<P: Copy> {
    vertices: Vec<ChannelVertex<P>>,
    /// First vertex and vertex count of each line.
    lines: Vec<(u32, u32)>,
    segments: Vec<Segment>,
    buckets: HashMap<(i32, i32), Vec<u32>>,
    bucket: f64,
    reach: f64,
    bounds: Aabb2,
}

impl<P: Copy> ChannelNet<P> {
    /// Default bucket size, blocks.
    pub const BUCKET: f64 = 32.0;

    /// Builds a network answering queries within `reach` of any segment.
    pub fn new(lines: &[Vec<ChannelVertex<P>>], reach: f64) -> Self {
        Self::with_bucket(lines, reach, Self::BUCKET)
    }

    pub fn with_bucket(lines: &[Vec<ChannelVertex<P>>], reach: f64, bucket: f64) -> Self {
        assert!(
            bucket > 0.0 && reach >= 0.0,
            "bucket must be positive and reach non-negative"
        );
        let mut vertices = Vec::new();
        let mut spans = Vec::new();
        let mut segments = Vec::new();
        let mut bounds = Aabb2::EMPTY;
        for (line_index, line) in lines.iter().enumerate() {
            let first = vertices.len() as u32;
            let mut arc = 0.0;
            for (i, v) in line.iter().enumerate() {
                bounds = bounds.union(Aabb2::around(v.x, v.z, 0.0));
                if i + 1 < line.len() {
                    let w = &line[i + 1];
                    let (dx, dz) = (w.x - v.x, w.z - v.z);
                    let len = (dx * dx + dz * dz).sqrt();
                    segments.push(Segment {
                        a: first + i as u32,
                        line: line_index as u32,
                        arc0: arc,
                        len,
                    });
                    arc += len;
                }
            }
            vertices.extend_from_slice(line);
            spans.push((first, line.len() as u32));
        }
        let mut buckets: HashMap<(i32, i32), Vec<u32>> = HashMap::new();
        for (index, seg) in segments.iter().enumerate() {
            let (p, q) = (vertices[seg.a as usize], vertices[seg.a as usize + 1]);
            let b0 = ((p.x.min(q.x) - reach) / bucket).floor() as i32;
            let b1 = ((p.x.max(q.x) + reach) / bucket).floor() as i32;
            let c0 = ((p.z.min(q.z) - reach) / bucket).floor() as i32;
            let c1 = ((p.z.max(q.z) + reach) / bucket).floor() as i32;
            for bx in b0..=b1 {
                for bz in c0..=c1 {
                    buckets.entry((bx, bz)).or_default().push(index as u32);
                }
            }
        }
        Self {
            vertices,
            lines: spans,
            segments,
            buckets,
            bucket,
            reach,
            bounds: bounds.grow(reach),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.segments.is_empty()
    }

    pub fn reach(&self) -> f64 {
        self.reach
    }

    /// Bounds of every point a query can hit (vertices grown by the reach).
    pub fn bounds(&self) -> Aabb2 {
        self.bounds
    }

    pub fn line_count(&self) -> usize {
        self.lines.len()
    }

    /// The vertices of line `index`.
    pub fn line(&self, index: usize) -> &[ChannelVertex<P>] {
        let (first, count) = self.lines[index];
        &self.vertices[first as usize..(first + count) as usize]
    }

    /// Arc length of line `index`.
    pub fn line_length(&self, index: usize) -> f64 {
        self.segments
            .iter()
            .filter(|s| s.line as usize == index)
            .map(|s| s.len)
            .sum()
    }

    fn hit(&self, index: u32, x: f64, z: f64) -> ChannelHit<P> {
        let seg = self.segments[index as usize];
        let (p, q) = (
            self.vertices[seg.a as usize],
            self.vertices[seg.a as usize + 1],
        );
        let (t, dist) = segment_distance((x, z), (p.x, p.z), (q.x, q.z));
        let cross = (q.x - p.x) * (z - p.z) - (q.z - p.z) * (x - p.x);
        ChannelHit {
            dist,
            side: if cross < 0.0 { -dist } else { dist },
            t,
            s: seg.arc0 + seg.len * t,
            line: seg.line,
            segment: index,
            a: p.payload,
            b: q.payload,
        }
    }

    /// Visit every segment within reach of `(x, z)`, in segment order.
    pub fn visit(&self, x: f64, z: f64, mut f: impl FnMut(&ChannelHit<P>)) {
        let key = (
            (x / self.bucket).floor() as i32,
            (z / self.bucket).floor() as i32,
        );
        let Some(indices) = self.buckets.get(&key) else {
            return;
        };
        for &index in indices {
            let hit = self.hit(index, x, z);
            if hit.dist <= self.reach {
                f(&hit);
            }
        }
    }

    /// The nearest segment within reach (ties to the lower segment index).
    pub fn nearest(&self, x: f64, z: f64) -> Option<ChannelHit<P>> {
        let mut best: Option<ChannelHit<P>> = None;
        self.visit(x, z, |hit| {
            if best.is_none_or(|b| hit.dist < b.dist) {
                best = Some(*hit);
            }
        });
        best
    }

    /// Signed turn at vertex `index` of line `line`, in [−1, 1]: the sine of
    /// the angle between the incoming and outgoing segments (positive for a
    /// left turn); 0 at the ends.
    pub fn turn(&self, line: usize, index: usize) -> f64 {
        let v = self.line(line);
        if index == 0 || index + 1 >= v.len() {
            return 0.0;
        }
        let (a, b, c) = (v[index - 1], v[index], v[index + 1]);
        let (ux, uz, wx, wz) = (b.x - a.x, b.z - a.z, c.x - b.x, c.z - b.z);
        let lens = ((ux * ux + uz * uz) * (wx * wx + wz * wz)).sqrt();
        if !(lens > 0.0) {
            return 0.0;
        }
        ((ux * wz - uz * wx) / lens).max(-1.0).min(1.0)
    }
}
