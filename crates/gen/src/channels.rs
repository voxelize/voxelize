//! Channel fields: polyline networks answering per-column queries.
//!
//! Both river sources share this geometry: the walker network
//! (`rivers.rs`) and the geology drainage network (`geology.rs`) emit
//! polylines with per-vertex water levels and width/depth profiles; a
//! `ChannelField` buckets their segments so a chunk column can ask
//! "nearest channel within reach" in O(bucket).

use hashbrown::HashMap;

const BUCKET: i32 = 32;

#[derive(Debug, Clone, Copy)]
pub struct ChannelPoint {
    pub dist: f64,
    pub water_y: f64,
    pub half_width: f64,
    pub depth: f64,
}

/// Per-vertex channel profile along one polyline.
#[derive(Debug, Clone, Copy)]
pub struct ChannelProfile {
    pub half_width: f64,
    pub depth: f64,
}

#[derive(Debug, Clone, Copy)]
struct Segment {
    ax: f64,
    az: f64,
    ay: f64,
    bx: f64,
    bz: f64,
    by: f64,
    half_width_a: f64,
    half_width_b: f64,
    depth_a: f64,
    depth_b: f64,
}

#[derive(Default)]
pub struct ChannelField {
    segments: Vec<Segment>,
    buckets: HashMap<(i32, i32), Vec<u32>>,
}

impl ChannelField {
    /// Builds a field from polylines: each vertex is (x, z, water_y) with
    /// a matching profile entry.
    pub fn from_polylines(lines: &[(Vec<(f64, f64, f64)>, Vec<ChannelProfile>)], reach: f64) -> Self {
        let mut segments = Vec::new();
        for (line, profiles) in lines {
            debug_assert_eq!(line.len(), profiles.len());
            for index in 0..line.len().saturating_sub(1) {
                let a = line[index];
                let b = line[index + 1];
                let pa = profiles[index];
                let pb = profiles[index + 1];
                segments.push(Segment {
                    ax: a.0,
                    az: a.1,
                    ay: a.2,
                    bx: b.0,
                    bz: b.1,
                    by: b.2,
                    half_width_a: pa.half_width,
                    half_width_b: pb.half_width,
                    depth_a: pa.depth,
                    depth_b: pb.depth,
                });
            }
        }

        let mut buckets: HashMap<(i32, i32), Vec<u32>> = HashMap::new();
        let pad = reach.ceil() as i32;
        for (index, segment) in segments.iter().enumerate() {
            let min_bx = ((segment.ax.min(segment.bx)) as i32 - pad).div_euclid(BUCKET);
            let max_bx = ((segment.ax.max(segment.bx)) as i32 + pad).div_euclid(BUCKET);
            let min_bz = ((segment.az.min(segment.bz)) as i32 - pad).div_euclid(BUCKET);
            let max_bz = ((segment.az.max(segment.bz)) as i32 + pad).div_euclid(BUCKET);
            for bx in min_bx..=max_bx {
                for bz in min_bz..=max_bz {
                    buckets.entry((bx, bz)).or_default().push(index as u32);
                }
            }
        }

        Self { segments, buckets }
    }

    pub fn is_empty(&self) -> bool {
        self.segments.is_empty()
    }

    /// Segment endpoints with water levels, for debug JSON.
    pub fn segment_endpoints(
        &self,
    ) -> impl Iterator<Item = ((f64, f64, f64), (f64, f64, f64))> + '_ {
        self.segments
            .iter()
            .map(|s| ((s.ax, s.az, s.ay), (s.bx, s.bz, s.by)))
    }

    /// Nearest channel sample within `reach` of the query point.
    pub fn sample(&self, x: i32, z: i32, reach: f64) -> Option<ChannelPoint> {
        let bucket = (x.div_euclid(BUCKET), z.div_euclid(BUCKET));
        let indices = self.buckets.get(&bucket)?;
        let mut best: Option<ChannelPoint> = None;
        for &index in indices {
            let point = project(&self.segments[index as usize], x as f64, z as f64);
            if point.dist <= reach && best.map(|b| point.dist < b.dist).unwrap_or(true) {
                best = Some(point);
            }
        }
        best
    }
}

fn project(segment: &Segment, px: f64, pz: f64) -> ChannelPoint {
    let (vx, vz) = (segment.bx - segment.ax, segment.bz - segment.az);
    let length_sq = vx * vx + vz * vz;
    let t = if length_sq <= 1e-9 {
        0.0
    } else {
        (((px - segment.ax) * vx + (pz - segment.az) * vz) / length_sq).clamp(0.0, 1.0)
    };
    let (cx, cz) = (segment.ax + vx * t, segment.az + vz * t);
    let (dx, dz) = (px - cx, pz - cz);
    ChannelPoint {
        dist: (dx * dx + dz * dz).sqrt(),
        water_y: segment.ay + (segment.by - segment.ay) * t,
        half_width: segment.half_width_a + (segment.half_width_b - segment.half_width_a) * t,
        depth: segment.depth_a + (segment.depth_b - segment.depth_a) * t,
    }
}
