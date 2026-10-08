//! World-aligned trilinear lattices with exact cell bounds.
//!
//! A lattice holds a 3D field at nodes on multiples of its strides in world
//! voxel coordinates, and interpolates trilinearly between them. Node values
//! are pure functions of their world position and the interpolation weights
//! come from world coordinates, so two lattices built for neighbouring
//! chunks return the same bits at every shared voxel: there is no seam to
//! hide.
//!
//! Trilinear interpolation is a convex combination of a cell's eight
//! corners, so their minimum and maximum bound every value in the cell.
//! The interpolation here clamps each of its lerps to the hull of its two
//! inputs, which makes that bound hold in floating point too, bit for bit:
//! a cell whose corner bounds rule a test out can be skipped without
//! changing a single voxel. [`Interval`] carries such bounds through the
//! separable forms built on lattices: rounding is monotone, so evaluating
//! the same expression on interval ends, in the same order, bounds the
//! evaluated value exactly.

/// Node spacing of a lattice, in blocks: `stride` horizontally, `stride_y`
/// vertically.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct LatticeSpec {
    pub stride: i32,
    pub stride_y: i32,
}

impl LatticeSpec {
    pub const fn new(stride: i32, stride_y: i32) -> Self {
        assert!(
            stride > 0 && stride_y > 0,
            "lattice strides must be positive"
        );
        Self { stride, stride_y }
    }

    pub const fn cubic(stride: i32) -> Self {
        Self::new(stride, stride)
    }

    #[inline]
    fn strides(&self) -> [i32; 3] {
        [self.stride, self.stride_y, self.stride]
    }
}

/// An inclusive box of voxels.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct VoxelBox {
    pub min: [i32; 3],
    pub max: [i32; 3],
}

impl VoxelBox {
    pub const fn new(min: [i32; 3], max: [i32; 3]) -> Self {
        Self { min, max }
    }

    pub fn is_empty(&self) -> bool {
        (0..3).any(|a| self.max[a] < self.min[a])
    }

    pub fn contains(&self, x: i32, y: i32, z: i32) -> bool {
        let p = [x, y, z];
        (0..3).all(|a| p[a] >= self.min[a] && p[a] <= self.max[a])
    }

    pub fn volume(&self) -> usize {
        if self.is_empty() {
            return 0;
        }
        (0..3)
            .map(|a| (self.max[a] - self.min[a] + 1) as usize)
            .product()
    }

    pub fn intersect(&self, o: &Self) -> Self {
        Self {
            min: [0, 1, 2].map(|a| self.min[a].max(o.min[a])),
            max: [0, 1, 2].map(|a| self.max[a].min(o.max[a])),
        }
    }

    pub fn grow(&self, by: i32) -> Self {
        Self {
            min: self.min.map(|v| v - by),
            max: self.max.map(|v| v + by),
        }
    }
}

/// A closed interval `[lo, hi]` of field values.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Interval {
    pub lo: f64,
    pub hi: f64,
}

impl Interval {
    pub const fn new(lo: f64, hi: f64) -> Self {
        Self { lo, hi }
    }

    pub const fn point(v: f64) -> Self {
        Self { lo: v, hi: v }
    }

    /// The interval of `k·v`.
    #[inline]
    pub fn scale(self, k: f64) -> Self {
        if k >= 0.0 {
            Self {
                lo: self.lo * k,
                hi: self.hi * k,
            }
        } else {
            Self {
                lo: self.hi * k,
                hi: self.lo * k,
            }
        }
    }

    #[inline]
    pub fn hull(self, o: Self) -> Self {
        Self {
            lo: self.lo.min(o.lo),
            hi: self.hi.max(o.hi),
        }
    }

    /// Whether any value of the interval lies strictly inside `(a, b)`.
    #[inline]
    pub fn meets_open(&self, a: f64, b: f64) -> bool {
        self.hi > a && self.lo < b
    }
}

impl std::ops::Add for Interval {
    type Output = Self;

    /// The interval of a sum: ends added to ends.
    #[inline]
    fn add(self, o: Self) -> Self {
        Self {
            lo: self.lo + o.lo,
            hi: self.hi + o.hi,
        }
    }
}

/// Lerp clamped to the hull of its inputs, so interpolated values never
/// leave the corner bounds by a rounding.
#[inline]
fn lerp_hull(a: f64, b: f64, t: f64) -> f64 {
    let v = a + (b - a) * t;
    v.max(a.min(b)).min(a.max(b))
}

/// The eight corners of a lattice cell, indexed `dx·4 + dy·2 + dz`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CellCorners(pub [f64; 8]);

impl CellCorners {
    pub fn min(&self) -> f64 {
        self.0.iter().copied().fold(f64::INFINITY, f64::min)
    }

    pub fn max(&self) -> f64 {
        self.0.iter().copied().fold(f64::NEG_INFINITY, f64::max)
    }

    /// Bounds of every interpolated value in the cell.
    pub fn bounds(&self) -> Interval {
        Interval::new(self.min(), self.max())
    }

    /// The trilinear value at fractions `(fx, fy, fz)` ∈ [0, 1]³, always in
    /// [`CellCorners::bounds`].
    #[inline]
    pub fn lerp(&self, fx: f64, fy: f64, fz: f64) -> f64 {
        let c = &self.0;
        let x00 = lerp_hull(c[0], c[4], fx);
        let x01 = lerp_hull(c[1], c[5], fx);
        let x10 = lerp_hull(c[2], c[6], fx);
        let x11 = lerp_hull(c[3], c[7], fx);
        let y0 = lerp_hull(x00, x10, fy);
        let y1 = lerp_hull(x01, x11, fy);
        lerp_hull(y0, y1, fz)
    }
}

/// One lattice cell overlapping a region: its world index and the voxels of
/// the region it interpolates.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LatticeCell {
    pub cell: [i32; 3],
    pub voxels: VoxelBox,
}

/// A 3D field on world-aligned nodes.
#[derive(Clone, Debug, PartialEq)]
pub struct Lattice {
    spec: LatticeSpec,
    /// World node index of the first stored node.
    node0: [i32; 3],
    dims: [usize; 3],
    values: Vec<f64>,
}

impl Lattice {
    /// Nodes at multiples of the strides, enough for every voxel of `region`
    /// grown by `margin` (a margin of 1 keeps central-difference gradients
    /// inside). `node` receives each node's world voxel coordinates.
    pub fn build(
        spec: LatticeSpec,
        region: VoxelBox,
        margin: i32,
        mut node: impl FnMut(i32, i32, i32) -> f64,
    ) -> Self {
        let s = spec.strides();
        let grown = region.grow(margin);
        let node0 = [0, 1, 2].map(|a| grown.min[a].div_euclid(s[a]));
        let node1 = [0, 1, 2].map(|a| grown.max[a].div_euclid(s[a]) + 1);
        let dims = [0, 1, 2].map(|a| (node1[a] - node0[a] + 1) as usize);
        let mut values = Vec::with_capacity(dims[0] * dims[1] * dims[2]);
        for ix in node0[0]..=node1[0] {
            for iy in node0[1]..=node1[1] {
                for iz in node0[2]..=node1[2] {
                    values.push(node(ix * s[0], iy * s[1], iz * s[2]));
                }
            }
        }
        Self {
            spec,
            node0,
            dims,
            values,
        }
    }

    pub fn spec(&self) -> LatticeSpec {
        self.spec
    }

    pub fn node_count(&self) -> usize {
        self.values.len()
    }

    /// The voxels this lattice can interpolate.
    pub fn coverage(&self) -> VoxelBox {
        let s = self.spec.strides();
        VoxelBox {
            min: [0, 1, 2].map(|a| self.node0[a] * s[a]),
            max: [0, 1, 2].map(|a| (self.node0[a] + self.dims[a] as i32 - 1) * s[a] - 1),
        }
    }

    #[inline]
    fn index(&self, n: [i32; 3]) -> usize {
        let l = [0, 1, 2].map(|a| (n[a] - self.node0[a]) as usize);
        debug_assert!(
            (0..3).all(|a| l[a] < self.dims[a]),
            "node {n:?} outside the lattice"
        );
        (l[0] * self.dims[1] + l[1]) * self.dims[2] + l[2]
    }

    /// The value at world node index `n`.
    pub fn node(&self, n: [i32; 3]) -> f64 {
        self.values[self.index(n)]
    }

    /// The world cell index holding voxel `(x, y, z)`.
    #[inline]
    pub fn cell_of(&self, x: i32, y: i32, z: i32) -> [i32; 3] {
        let s = self.spec.strides();
        [x.div_euclid(s[0]), y.div_euclid(s[1]), z.div_euclid(s[2])]
    }

    /// The corners of world cell `cell`.
    #[inline]
    pub fn corners(&self, cell: [i32; 3]) -> CellCorners {
        let b = self.index(cell);
        let (sy, sx) = (self.dims[2], self.dims[1] * self.dims[2]);
        let v = &self.values;
        CellCorners([
            v[b],
            v[b + 1],
            v[b + sy],
            v[b + sy + 1],
            v[b + sx],
            v[b + sx + 1],
            v[b + sx + sy],
            v[b + sx + sy + 1],
        ])
    }

    /// The field at voxel `(x, y, z)`.
    #[inline]
    pub fn sample(&self, x: i32, y: i32, z: i32) -> f64 {
        let s = self.spec.strides();
        let cell = self.cell_of(x, y, z);
        let p = [x, y, z];
        let f = [0, 1, 2].map(|a| (p[a] - cell[a] * s[a]) as f64 / s[a] as f64);
        self.corners(cell).lerp(f[0], f[1], f[2])
    }

    /// The field at a continuous world position.
    pub fn sample_f(&self, x: f64, y: f64, z: f64) -> f64 {
        let s = self.spec.strides();
        let p = [x, y, z];
        let q = [0, 1, 2].map(|a| p[a] / s[a] as f64);
        let cell = q.map(|v| v.floor() as i32);
        let f = [0, 1, 2].map(|a| q[a] - cell[a] as f64);
        self.corners(cell).lerp(f[0], f[1], f[2])
    }

    /// The cells overlapping `region`, in x, y, z order, each with the
    /// region's voxels it interpolates.
    pub fn cells(&self, region: VoxelBox) -> impl Iterator<Item = LatticeCell> + '_ {
        let s = self.spec.strides();
        let c0 = [0, 1, 2].map(|a| region.min[a].div_euclid(s[a]));
        let c1 = [0, 1, 2].map(|a| region.max[a].div_euclid(s[a]));
        (c0[0]..=c1[0]).flat_map(move |cx| {
            (c0[1]..=c1[1]).flat_map(move |cy| {
                (c0[2]..=c1[2]).map(move |cz| {
                    let cell = [cx, cy, cz];
                    let own = VoxelBox {
                        min: [0, 1, 2].map(|a| cell[a] * s[a]),
                        max: [0, 1, 2].map(|a| cell[a] * s[a] + s[a] - 1),
                    };
                    LatticeCell {
                        cell,
                        voxels: own.intersect(&region),
                    }
                })
            })
        })
    }
}
