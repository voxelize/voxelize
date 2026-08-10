//! Field graphs: authoring is a data DAG of named nodes; compilation
//! validates and flattens it into register programs evaluated by a plain
//! enum interpreter — expressive composition with no per-sample dynamic
//! dispatch and no closures to defeat serialization or salting.
//!
//! Nodes that re-sample their input over a moved domain (`Warp`, `Affine`)
//! or probe its local shape (`SlopeOf`, `CurvatureOf`) compile the input's
//! ancestor closure into a nested program sharing the parent's noise and
//! spline tables, so any expression — not just a bare noise leaf — can be
//! warped, rotated, stretched, or differentiated. This is what layered
//! multi-scale terrain stacks are built from: warped multifractal chains,
//! erosion masks damping detail, slope-driven talus, curvature-driven
//! valleys.

use serde::Serialize;
use smallvec::SmallVec;

use crate::noise::{smoothstep, Fractal, NoiseKind};
use crate::spec::GenError;
use crate::stream::{stream_seed, SaltPath, Subsystem};

pub type NodeId = usize;

/// Register indices are u16; graphs larger than this refuse at compile.
pub const MAX_FIELD_NODES: usize = 4096;

#[derive(Debug, Clone, Serialize)]
pub struct SplinePoints(pub Vec<(f64, f64)>);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum SplineEasing {
    /// Piecewise linear: exact, but slope breaks at every knot.
    Linear,
    /// Monotone cubic (Steffen): C1-smooth between knots with no
    /// overshoot, so shaped terrain has no visible slope creases.
    Smooth,
}

#[derive(Debug, Clone, Serialize)]
pub enum FieldNode {
    Const(f64),
    Noise {
        salt: SaltPath,
        frequency: f64,
        octaves: u8,
        persistence: f64,
        lacunarity: f64,
        kind: NoiseKind,
    },
    /// Re-samples `input`'s whole expression at
    /// `(x + dx * amplitude, z + dz * amplitude)`.
    Warp {
        input: NodeId,
        dx: NodeId,
        dz: NodeId,
        amplitude: f64,
    },
    /// Re-samples `input` at `(xx*x + xz*z + tx, zx*x + zz*z + tz)`:
    /// rotation, anisotropic stretch, and shear from plain coefficients —
    /// no runtime trigonometry, so bit-stability holds by construction.
    Affine {
        input: NodeId,
        xx: f64,
        xz: f64,
        zx: f64,
        zz: f64,
        tx: f64,
        tz: f64,
    },
    /// Gradient magnitude of `input` by central differences at `±step`
    /// blocks (4 re-evaluations). The erosion/talus primitive: mask fields
    /// by how steep they already are.
    SlopeOf {
        input: NodeId,
        step: f64,
    },
    /// Discrete Laplacian of `input` over `step` blocks (5 re-evaluations):
    /// positive in hollows and valley floors, negative on crests. The
    /// drainage/valley-influence primitive.
    CurvatureOf {
        input: NodeId,
        step: f64,
    },
    Spline {
        input: NodeId,
        points: SplinePoints,
        easing: SplineEasing,
    },
    Add(NodeId, NodeId),
    Sub(NodeId, NodeId),
    Mul(NodeId, NodeId),
    Min(NodeId, NodeId),
    Max(NodeId, NodeId),
    Lerp {
        a: NodeId,
        b: NodeId,
        t: NodeId,
    },
    Clamp {
        input: NodeId,
        min: f64,
        max: f64,
    },
    Gate {
        input: NodeId,
        low: f64,
        high: f64,
    },
    Invert(NodeId),
    Abs(NodeId),
    Scale {
        input: NodeId,
        factor: f64,
    },
    Offset {
        input: NodeId,
        amount: f64,
    },
    PowI {
        input: NodeId,
        exponent: i32,
    },
    /// Latitude ramp: |z| mapped over [0, half_world] to [equator, pole].
    Latitude {
        half_world_z: f64,
        equator: f64,
        pole: f64,
    },
    /// Radial distance to the world origin in blocks, scaled by 1/radius
    /// and clamped to [0, 1]; the spawn-calm mask primitive.
    RadialMask {
        calm_radius: f64,
        full_radius: f64,
    },
}

impl FieldNode {
    /// Nodes whose values this node reads from registers at evaluation
    /// time. Domain nodes (`Warp`, `Affine`, `SlopeOf`, `CurvatureOf`)
    /// carry their `input` as a self-contained nested program instead, so
    /// it is deliberately absent here — only true register reads pull
    /// ancestors into an extraction closure.
    fn register_inputs(&self) -> SmallVec<[NodeId; 3]> {
        match self {
            FieldNode::Const(_)
            | FieldNode::Noise { .. }
            | FieldNode::Latitude { .. }
            | FieldNode::RadialMask { .. }
            | FieldNode::Affine { .. }
            | FieldNode::SlopeOf { .. }
            | FieldNode::CurvatureOf { .. } => SmallVec::new(),
            FieldNode::Warp { dx, dz, .. } => SmallVec::from_slice(&[*dx, *dz]),
            FieldNode::Spline { input, .. }
            | FieldNode::Clamp { input, .. }
            | FieldNode::Gate { input, .. }
            | FieldNode::Invert(input)
            | FieldNode::Abs(input)
            | FieldNode::Scale { input, .. }
            | FieldNode::Offset { input, .. }
            | FieldNode::PowI { input, .. } => SmallVec::from_slice(&[*input]),
            FieldNode::Add(a, b)
            | FieldNode::Sub(a, b)
            | FieldNode::Mul(a, b)
            | FieldNode::Min(a, b)
            | FieldNode::Max(a, b) => SmallVec::from_slice(&[*a, *b]),
            FieldNode::Lerp { a, b, t } => SmallVec::from_slice(&[*a, *b, *t]),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct FieldGraph {
    pub nodes: Vec<FieldNode>,
}

impl FieldGraph {
    pub fn output(&self) -> NodeId {
        self.nodes.len().saturating_sub(1)
    }
}

/// Builder used by content crates; each method pushes a node and returns
/// its id, so graphs read as straight-line construction code.
#[derive(Debug, Default)]
pub struct FieldGraphBuilder {
    graph: FieldGraph,
}

impl FieldGraphBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, node: FieldNode) -> NodeId {
        self.graph.nodes.push(node);
        self.graph.nodes.len() - 1
    }

    pub fn constant(&mut self, value: f64) -> NodeId {
        self.push(FieldNode::Const(value))
    }

    fn noise(
        &mut self,
        salt: &'static str,
        frequency: f64,
        octaves: u8,
        persistence: f64,
        lacunarity: f64,
        kind: NoiseKind,
    ) -> NodeId {
        self.push(FieldNode::Noise {
            salt: SaltPath(salt),
            frequency,
            octaves,
            persistence,
            lacunarity,
            kind,
        })
    }

    pub fn fbm(
        &mut self,
        salt: &'static str,
        frequency: f64,
        octaves: u8,
        persistence: f64,
        lacunarity: f64,
    ) -> NodeId {
        self.noise(salt, frequency, octaves, persistence, lacunarity, NoiseKind::Fbm)
    }

    pub fn ridged(
        &mut self,
        salt: &'static str,
        frequency: f64,
        octaves: u8,
        persistence: f64,
        lacunarity: f64,
    ) -> NodeId {
        self.noise(salt, frequency, octaves, persistence, lacunarity, NoiseKind::Ridged)
    }

    pub fn billow(
        &mut self,
        salt: &'static str,
        frequency: f64,
        octaves: u8,
        persistence: f64,
        lacunarity: f64,
    ) -> NodeId {
        self.noise(salt, frequency, octaves, persistence, lacunarity, NoiseKind::Billow)
    }

    pub fn hybrid_multi(
        &mut self,
        salt: &'static str,
        frequency: f64,
        octaves: u8,
        persistence: f64,
        lacunarity: f64,
        offset: f64,
    ) -> NodeId {
        self.noise(
            salt,
            frequency,
            octaves,
            persistence,
            lacunarity,
            NoiseKind::HybridMulti { offset },
        )
    }

    pub fn ridged_multi(
        &mut self,
        salt: &'static str,
        frequency: f64,
        octaves: u8,
        persistence: f64,
        lacunarity: f64,
        offset: f64,
        gain: f64,
    ) -> NodeId {
        self.noise(
            salt,
            frequency,
            octaves,
            persistence,
            lacunarity,
            NoiseKind::RidgedMulti { offset, gain },
        )
    }

    pub fn warp(&mut self, input: NodeId, dx: NodeId, dz: NodeId, amplitude: f64) -> NodeId {
        self.push(FieldNode::Warp {
            input,
            dx,
            dz,
            amplitude,
        })
    }

    pub fn affine(
        &mut self,
        input: NodeId,
        xx: f64,
        xz: f64,
        zx: f64,
        zz: f64,
        tx: f64,
        tz: f64,
    ) -> NodeId {
        self.push(FieldNode::Affine {
            input,
            xx,
            xz,
            zx,
            zz,
            tx,
            tz,
        })
    }

    pub fn slope_of(&mut self, input: NodeId, step: f64) -> NodeId {
        self.push(FieldNode::SlopeOf { input, step })
    }

    pub fn curvature_of(&mut self, input: NodeId, step: f64) -> NodeId {
        self.push(FieldNode::CurvatureOf { input, step })
    }

    pub fn spline(&mut self, input: NodeId, points: &[(f64, f64)]) -> NodeId {
        self.push(FieldNode::Spline {
            input,
            points: SplinePoints(points.to_vec()),
            easing: SplineEasing::Linear,
        })
    }

    pub fn smooth_spline(&mut self, input: NodeId, points: &[(f64, f64)]) -> NodeId {
        self.push(FieldNode::Spline {
            input,
            points: SplinePoints(points.to_vec()),
            easing: SplineEasing::Smooth,
        })
    }

    pub fn add(&mut self, a: NodeId, b: NodeId) -> NodeId {
        self.push(FieldNode::Add(a, b))
    }

    pub fn sub(&mut self, a: NodeId, b: NodeId) -> NodeId {
        self.push(FieldNode::Sub(a, b))
    }

    pub fn mul(&mut self, a: NodeId, b: NodeId) -> NodeId {
        self.push(FieldNode::Mul(a, b))
    }

    pub fn min(&mut self, a: NodeId, b: NodeId) -> NodeId {
        self.push(FieldNode::Min(a, b))
    }

    pub fn max(&mut self, a: NodeId, b: NodeId) -> NodeId {
        self.push(FieldNode::Max(a, b))
    }

    pub fn lerp(&mut self, a: NodeId, b: NodeId, t: NodeId) -> NodeId {
        self.push(FieldNode::Lerp { a, b, t })
    }

    pub fn clamp(&mut self, input: NodeId, min: f64, max: f64) -> NodeId {
        self.push(FieldNode::Clamp { input, min, max })
    }

    pub fn gate(&mut self, input: NodeId, low: f64, high: f64) -> NodeId {
        self.push(FieldNode::Gate { input, low, high })
    }

    pub fn invert(&mut self, input: NodeId) -> NodeId {
        self.push(FieldNode::Invert(input))
    }

    pub fn abs(&mut self, input: NodeId) -> NodeId {
        self.push(FieldNode::Abs(input))
    }

    pub fn scale(&mut self, input: NodeId, factor: f64) -> NodeId {
        self.push(FieldNode::Scale { input, factor })
    }

    pub fn offset(&mut self, input: NodeId, amount: f64) -> NodeId {
        self.push(FieldNode::Offset { input, amount })
    }

    pub fn build(self) -> FieldGraph {
        self.graph
    }
}

#[derive(Clone)]
enum Op {
    Const(f64),
    Noise2(u32),
    Warp {
        nested: u32,
        dx: u16,
        dz: u16,
        amplitude: f64,
    },
    Affine {
        nested: u32,
        xx: f64,
        xz: f64,
        zx: f64,
        zz: f64,
        tx: f64,
        tz: f64,
    },
    Slope {
        nested: u32,
        step: f64,
    },
    Curvature {
        nested: u32,
        step: f64,
    },
    Spline {
        input: u16,
        spline: u32,
    },
    Add(u16, u16),
    Sub(u16, u16),
    Mul(u16, u16),
    Min(u16, u16),
    Max(u16, u16),
    Lerp {
        a: u16,
        b: u16,
        t: u16,
    },
    Clamp {
        input: u16,
        min: f64,
        max: f64,
    },
    Gate {
        input: u16,
        low: f64,
        high: f64,
    },
    Invert(u16),
    Abs(u16),
    Scale {
        input: u16,
        factor: f64,
    },
    Offset {
        input: u16,
        amount: f64,
    },
    PowI {
        input: u16,
        exponent: i32,
    },
    Latitude {
        half_world_z: f64,
        equator: f64,
        pole: f64,
    },
    RadialMask {
        calm_radius: f64,
        full_radius: f64,
    },
}

impl Op {
    fn remap_registers(&self, map: &[u16]) -> Op {
        let mut op = self.clone();
        match &mut op {
            Op::Warp { dx, dz, .. } => {
                *dx = map[*dx as usize];
                *dz = map[*dz as usize];
            }
            Op::Spline { input, .. }
            | Op::Clamp { input, .. }
            | Op::Gate { input, .. }
            | Op::Invert(input)
            | Op::Abs(input)
            | Op::Scale { input, .. }
            | Op::Offset { input, .. }
            | Op::PowI { input, .. } => *input = map[*input as usize],
            Op::Add(a, b) | Op::Sub(a, b) | Op::Mul(a, b) | Op::Min(a, b) | Op::Max(a, b) => {
                *a = map[*a as usize];
                *b = map[*b as usize];
            }
            Op::Lerp { a, b, t } => {
                *a = map[*a as usize];
                *b = map[*b as usize];
                *t = map[*t as usize];
            }
            Op::Const(_)
            | Op::Noise2(_)
            | Op::Affine { .. }
            | Op::Slope { .. }
            | Op::Curvature { .. }
            | Op::Latitude { .. }
            | Op::RadialMask { .. } => {}
        }
        op
    }
}

/// An op slice re-evaluable at arbitrary coordinates, extracted from a
/// domain-modifying node's input closure. Noise, spline, and nested tables
/// are shared with the parent program.
struct NestedProgram {
    ops: Vec<Op>,
    register_count: usize,
}

pub struct FieldProgram {
    ops: Vec<Op>,
    fractals: Vec<Fractal>,
    splines: Vec<CompiledSpline>,
    nested: Vec<NestedProgram>,
    register_count: usize,
}

struct CompiledSpline {
    points: Vec<(f64, f64)>,
    /// Steffen monotone tangents; present only for `Smooth` easing.
    tangents: Option<Vec<f64>>,
}

impl CompiledSpline {
    fn new(points: Vec<(f64, f64)>, easing: SplineEasing) -> Self {
        let tangents = match easing {
            SplineEasing::Linear => None,
            SplineEasing::Smooth => Some(Self::steffen_tangents(&points)),
        };
        Self { points, tangents }
    }

    /// Steffen (1990) monotone tangents: C1 interpolation with no
    /// overshoot, from divisions and min/abs only.
    fn steffen_tangents(points: &[(f64, f64)]) -> Vec<f64> {
        let n = points.len();
        let secant = |i: usize| {
            (points[i + 1].1 - points[i].1) / (points[i + 1].0 - points[i].0)
        };
        let mut tangents = vec![0.0; n];
        tangents[0] = secant(0);
        tangents[n - 1] = secant(n - 2);
        for i in 1..n - 1 {
            let d0 = secant(i - 1);
            let d1 = secant(i);
            if d0 * d1 <= 0.0 {
                tangents[i] = 0.0;
                continue;
            }
            let h0 = points[i].0 - points[i - 1].0;
            let h1 = points[i + 1].0 - points[i].0;
            let parabola = (d0 * h1 + d1 * h0) / (h0 + h1);
            let bound = 2.0 * d0.abs().min(d1.abs());
            let magnitude = parabola.abs().min(bound);
            tangents[i] = if d0 > 0.0 { magnitude } else { -magnitude };
        }
        tangents
    }

    fn sample(&self, t: f64) -> f64 {
        let points = &self.points;
        if t <= points[0].0 {
            return points[0].1;
        }
        if let Some(tangents) = &self.tangents {
            for (index, pair) in points.windows(2).enumerate() {
                let (t0, v0) = pair[0];
                let (t1, v1) = pair[1];
                if t <= t1 {
                    let h = t1 - t0;
                    let s = (t - t0) / h;
                    let s2 = s * s;
                    let s3 = s2 * s;
                    return v0 * (2.0 * s3 - 3.0 * s2 + 1.0)
                        + tangents[index] * h * (s3 - 2.0 * s2 + s)
                        + v1 * (-2.0 * s3 + 3.0 * s2)
                        + tangents[index + 1] * h * (s3 - s2);
                }
            }
        } else {
            for pair in points.windows(2) {
                let (t0, v0) = pair[0];
                let (t1, v1) = pair[1];
                if t <= t1 {
                    return v0 + (v1 - v0) * (t - t0) / (t1 - t0);
                }
            }
        }
        points[points.len() - 1].1
    }
}

impl FieldProgram {
    /// Validates and flattens a graph. `path` names the graph in errors;
    /// `used_salts` enforces world-unique noise salts across all graphs.
    pub fn compile(
        graph: &FieldGraph,
        path: &str,
        world_seed: u32,
        dimension: &str,
        used_salts: &mut hashbrown::HashSet<&'static str>,
    ) -> Result<Self, GenError> {
        if graph.nodes.is_empty() {
            return Err(GenError::EmptyGraph { path: path.to_string() });
        }
        if graph.nodes.len() > MAX_FIELD_NODES {
            return Err(GenError::GraphTooLarge {
                path: path.to_string(),
                got: graph.nodes.len(),
                max: MAX_FIELD_NODES,
            });
        }
        let mut ops: Vec<Op> = Vec::with_capacity(graph.nodes.len());
        let mut fractals = Vec::new();
        let mut splines = Vec::new();
        let mut nested: Vec<NestedProgram> = Vec::new();

        let check_ref = |target: NodeId, current: usize| -> Result<u16, GenError> {
            if target >= current {
                return Err(GenError::ForwardReference {
                    path: path.to_string(),
                    node: current,
                    target,
                });
            }
            Ok(target as u16)
        };

        let check_finite = |value: f64, index: usize, what: &'static str| -> Result<f64, GenError> {
            if !value.is_finite() {
                return Err(GenError::OutOfRange {
                    path: format!("{path}[{index}]"),
                    what,
                    got: value,
                });
            }
            Ok(value)
        };

        // Extracts the ancestor closure of `root` as a nested program whose
        // ops are register-remapped clones sharing the parent's tables.
        let extract_nested = |root: NodeId, ops: &[Op], nested: &mut Vec<NestedProgram>| -> u32 {
            let mut is_needed = vec![false; root + 1];
            let mut stack = vec![root];
            while let Some(id) = stack.pop() {
                if is_needed[id] {
                    continue;
                }
                is_needed[id] = true;
                for input in graph.nodes[id].register_inputs() {
                    stack.push(input);
                }
            }
            let mut map = vec![u16::MAX; root + 1];
            let mut slice = Vec::new();
            for (id, needed) in is_needed.iter().enumerate() {
                if !needed {
                    continue;
                }
                map[id] = slice.len() as u16;
                slice.push(ops[id].remap_registers(&map));
            }
            nested.push(NestedProgram {
                register_count: slice.len(),
                ops: slice,
            });
            (nested.len() - 1) as u32
        };

        for (index, node) in graph.nodes.iter().enumerate() {
            let op = match node {
                FieldNode::Const(v) => Op::Const(check_finite(*v, index, "constant")?),
                FieldNode::Noise {
                    salt,
                    frequency,
                    octaves,
                    persistence,
                    lacunarity,
                    kind,
                } => {
                    crate::spec::claim_salt(salt, used_salts)?;
                    if *frequency <= 0.0 || !frequency.is_finite() {
                        return Err(GenError::OutOfRange {
                            path: format!("{path}[{index}].frequency"),
                            what: "noise frequency",
                            got: *frequency,
                        });
                    }
                    if *octaves == 0 || *octaves > 12 {
                        return Err(GenError::OutOfRange {
                            path: format!("{path}[{index}].octaves"),
                            what: "noise octaves (1..=12)",
                            got: *octaves as f64,
                        });
                    }
                    match kind {
                        NoiseKind::HybridMulti { offset } => {
                            if !(0.0..=2.0).contains(offset) {
                                return Err(GenError::OutOfRange {
                                    path: format!("{path}[{index}].offset"),
                                    what: "hybrid-multi offset (0..=2)",
                                    got: *offset,
                                });
                            }
                        }
                        NoiseKind::RidgedMulti { offset, gain } => {
                            if !(*offset > 0.0 && *offset <= 2.0) {
                                return Err(GenError::OutOfRange {
                                    path: format!("{path}[{index}].offset"),
                                    what: "ridged-multi offset (0..=2, exclusive low)",
                                    got: *offset,
                                });
                            }
                            if !(*gain > 0.0 && *gain <= 8.0) {
                                return Err(GenError::OutOfRange {
                                    path: format!("{path}[{index}].gain"),
                                    what: "ridged-multi gain (0..=8, exclusive low)",
                                    got: *gain,
                                });
                            }
                        }
                        _ => {}
                    }
                    fractals.push(Fractal::new(
                        stream_seed(world_seed, dimension, Subsystem::Fields, salt, 0),
                        *frequency,
                        *octaves,
                        *persistence,
                        *lacunarity,
                        *kind,
                    ));
                    Op::Noise2((fractals.len() - 1) as u32)
                }
                FieldNode::Warp {
                    input,
                    dx,
                    dz,
                    amplitude,
                } => {
                    check_ref(*input, index)?;
                    Op::Warp {
                        nested: extract_nested(*input, &ops, &mut nested),
                        dx: check_ref(*dx, index)?,
                        dz: check_ref(*dz, index)?,
                        amplitude: check_finite(*amplitude, index, "warp amplitude")?,
                    }
                }
                FieldNode::Affine {
                    input,
                    xx,
                    xz,
                    zx,
                    zz,
                    tx,
                    tz,
                } => {
                    check_ref(*input, index)?;
                    Op::Affine {
                        nested: extract_nested(*input, &ops, &mut nested),
                        xx: check_finite(*xx, index, "affine coefficient")?,
                        xz: check_finite(*xz, index, "affine coefficient")?,
                        zx: check_finite(*zx, index, "affine coefficient")?,
                        zz: check_finite(*zz, index, "affine coefficient")?,
                        tx: check_finite(*tx, index, "affine translation")?,
                        tz: check_finite(*tz, index, "affine translation")?,
                    }
                }
                FieldNode::SlopeOf { input, step } => {
                    check_ref(*input, index)?;
                    if !(*step > 0.0 && step.is_finite()) {
                        return Err(GenError::OutOfRange {
                            path: format!("{path}[{index}].step"),
                            what: "slope probe step (positive)",
                            got: *step,
                        });
                    }
                    Op::Slope {
                        nested: extract_nested(*input, &ops, &mut nested),
                        step: *step,
                    }
                }
                FieldNode::CurvatureOf { input, step } => {
                    check_ref(*input, index)?;
                    if !(*step > 0.0 && step.is_finite()) {
                        return Err(GenError::OutOfRange {
                            path: format!("{path}[{index}].step"),
                            what: "curvature probe step (positive)",
                            got: *step,
                        });
                    }
                    Op::Curvature {
                        nested: extract_nested(*input, &ops, &mut nested),
                        step: *step,
                    }
                }
                FieldNode::Spline {
                    input,
                    points,
                    easing,
                } => {
                    if points.0.len() < 2 {
                        return Err(GenError::InvalidSpline {
                            path: format!("{path}[{index}]"),
                            reason: "needs at least two points",
                        });
                    }
                    if !points.0.windows(2).all(|w| w[1].0 > w[0].0) {
                        return Err(GenError::InvalidSpline {
                            path: format!("{path}[{index}]"),
                            reason: "x values must be strictly increasing",
                        });
                    }
                    splines.push(CompiledSpline::new(points.0.clone(), *easing));
                    Op::Spline {
                        input: check_ref(*input, index)?,
                        spline: (splines.len() - 1) as u32,
                    }
                }
                FieldNode::Add(a, b) => Op::Add(check_ref(*a, index)?, check_ref(*b, index)?),
                FieldNode::Sub(a, b) => Op::Sub(check_ref(*a, index)?, check_ref(*b, index)?),
                FieldNode::Mul(a, b) => Op::Mul(check_ref(*a, index)?, check_ref(*b, index)?),
                FieldNode::Min(a, b) => Op::Min(check_ref(*a, index)?, check_ref(*b, index)?),
                FieldNode::Max(a, b) => Op::Max(check_ref(*a, index)?, check_ref(*b, index)?),
                FieldNode::Lerp { a, b, t } => Op::Lerp {
                    a: check_ref(*a, index)?,
                    b: check_ref(*b, index)?,
                    t: check_ref(*t, index)?,
                },
                FieldNode::Clamp { input, min, max } => {
                    // f64::clamp panics on reversed or NaN bounds; refuse
                    // at compile like every other malformed node.
                    if !(min.is_finite() && max.is_finite() && min <= max) {
                        return Err(GenError::OutOfRange {
                            path: format!("{path}[{index}].clamp"),
                            what: "clamp window (finite, min <= max)",
                            got: *max,
                        });
                    }
                    Op::Clamp {
                        input: check_ref(*input, index)?,
                        min: *min,
                        max: *max,
                    }
                }
                FieldNode::Gate { input, low, high } => {
                    if high <= low {
                        return Err(GenError::OutOfRange {
                            path: format!("{path}[{index}].gate"),
                            what: "gate window (high must exceed low)",
                            got: *high,
                        });
                    }
                    Op::Gate {
                        input: check_ref(*input, index)?,
                        low: *low,
                        high: *high,
                    }
                }
                FieldNode::Invert(input) => Op::Invert(check_ref(*input, index)?),
                FieldNode::Abs(input) => Op::Abs(check_ref(*input, index)?),
                FieldNode::Scale { input, factor } => Op::Scale {
                    input: check_ref(*input, index)?,
                    factor: *factor,
                },
                FieldNode::Offset { input, amount } => Op::Offset {
                    input: check_ref(*input, index)?,
                    amount: *amount,
                },
                FieldNode::PowI { input, exponent } => Op::PowI {
                    input: check_ref(*input, index)?,
                    exponent: *exponent,
                },
                FieldNode::Latitude {
                    half_world_z,
                    equator,
                    pole,
                } => {
                    if *half_world_z <= 0.0 {
                        return Err(GenError::OutOfRange {
                            path: format!("{path}[{index}].half_world_z"),
                            what: "latitude half world",
                            got: *half_world_z,
                        });
                    }
                    Op::Latitude {
                        half_world_z: *half_world_z,
                        equator: *equator,
                        pole: *pole,
                    }
                }
                FieldNode::RadialMask {
                    calm_radius,
                    full_radius,
                } => {
                    if full_radius <= calm_radius {
                        return Err(GenError::OutOfRange {
                            path: format!("{path}[{index}].radial_mask"),
                            what: "radial mask (full must exceed calm)",
                            got: *full_radius,
                        });
                    }
                    Op::RadialMask {
                        calm_radius: *calm_radius,
                        full_radius: *full_radius,
                    }
                }
            };
            ops.push(op);
        }

        Ok(Self {
            register_count: ops.len(),
            ops,
            fractals,
            splines,
            nested,
        })
    }

    pub fn sample2(&self, x: i32, z: i32) -> f64 {
        self.eval(&self.ops, self.register_count, x as f64, z as f64)
    }

    fn eval(&self, ops: &[Op], register_count: usize, fx: f64, fz: f64) -> f64 {
        let mut regs = SmallVec::<[f64; 48]>::new();
        regs.resize(register_count, 0.0);
        for (index, op) in ops.iter().enumerate() {
            regs[index] = match op {
                Op::Const(v) => *v,
                Op::Noise2(f) => self.fractals[*f as usize].sample2(fx, fz),
                Op::Warp {
                    nested,
                    dx,
                    dz,
                    amplitude,
                } => {
                    let sub = &self.nested[*nested as usize];
                    self.eval(
                        &sub.ops,
                        sub.register_count,
                        fx + regs[*dx as usize] * amplitude,
                        fz + regs[*dz as usize] * amplitude,
                    )
                }
                Op::Affine {
                    nested,
                    xx,
                    xz,
                    zx,
                    zz,
                    tx,
                    tz,
                } => {
                    let sub = &self.nested[*nested as usize];
                    self.eval(
                        &sub.ops,
                        sub.register_count,
                        xx * fx + xz * fz + tx,
                        zx * fx + zz * fz + tz,
                    )
                }
                Op::Slope { nested, step } => {
                    let sub = &self.nested[*nested as usize];
                    let east = self.eval(&sub.ops, sub.register_count, fx + step, fz);
                    let west = self.eval(&sub.ops, sub.register_count, fx - step, fz);
                    let south = self.eval(&sub.ops, sub.register_count, fx, fz + step);
                    let north = self.eval(&sub.ops, sub.register_count, fx, fz - step);
                    let gx = (east - west) / (2.0 * step);
                    let gz = (south - north) / (2.0 * step);
                    (gx * gx + gz * gz).sqrt()
                }
                Op::Curvature { nested, step } => {
                    let sub = &self.nested[*nested as usize];
                    let center = self.eval(&sub.ops, sub.register_count, fx, fz);
                    let east = self.eval(&sub.ops, sub.register_count, fx + step, fz);
                    let west = self.eval(&sub.ops, sub.register_count, fx - step, fz);
                    let south = self.eval(&sub.ops, sub.register_count, fx, fz + step);
                    let north = self.eval(&sub.ops, sub.register_count, fx, fz - step);
                    (east + west + south + north - 4.0 * center) / (step * step)
                }
                Op::Spline { input, spline } => {
                    self.splines[*spline as usize].sample(regs[*input as usize])
                }
                Op::Add(a, b) => regs[*a as usize] + regs[*b as usize],
                Op::Sub(a, b) => regs[*a as usize] - regs[*b as usize],
                Op::Mul(a, b) => regs[*a as usize] * regs[*b as usize],
                Op::Min(a, b) => regs[*a as usize].min(regs[*b as usize]),
                Op::Max(a, b) => regs[*a as usize].max(regs[*b as usize]),
                Op::Lerp { a, b, t } => {
                    let t = regs[*t as usize];
                    regs[*a as usize] + (regs[*b as usize] - regs[*a as usize]) * t
                }
                Op::Clamp { input, min, max } => regs[*input as usize].clamp(*min, *max),
                Op::Gate { input, low, high } => smoothstep(*low, *high, regs[*input as usize]),
                Op::Invert(input) => 1.0 - regs[*input as usize],
                Op::Abs(input) => regs[*input as usize].abs(),
                Op::Scale { input, factor } => regs[*input as usize] * factor,
                Op::Offset { input, amount } => regs[*input as usize] + amount,
                Op::PowI { input, exponent } => regs[*input as usize].powi(*exponent),
                Op::Latitude {
                    half_world_z,
                    equator,
                    pole,
                } => {
                    let lat = (fz.abs() / half_world_z).min(1.0);
                    equator + (pole - equator) * lat
                }
                Op::RadialMask {
                    calm_radius,
                    full_radius,
                } => {
                    let dist = (fx * fx + fz * fz).sqrt();
                    smoothstep(*calm_radius, *full_radius, dist)
                }
            };
        }
        regs[register_count - 1]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn compile_one(graph: &FieldGraph) -> Result<FieldProgram, GenError> {
        let mut salts = hashbrown::HashSet::new();
        FieldProgram::compile(graph, "test", 7, "dim", &mut salts)
    }

    #[test]
    fn spline_over_noise_evaluates() {
        let mut b = FieldGraphBuilder::new();
        let n = b.fbm("t.base", 0.01, 4, 0.5, 2.0);
        b.spline(n, &[(-1.0, 10.0), (0.0, 50.0), (1.0, 90.0)]);
        let p = compile_one(&b.build()).unwrap();
        for i in 0..256 {
            let v = p.sample2(i * 7, i * -3);
            assert!((10.0..=90.0).contains(&v));
        }
    }

    #[test]
    fn smooth_spline_stays_inside_knots_and_hits_them() {
        let knots = [(-1.0, 10.0), (-0.2, 30.0), (0.3, 34.0), (1.0, 90.0)];
        let mut b = FieldGraphBuilder::new();
        let n = b.fbm("t.smooth", 0.01, 4, 0.5, 2.0);
        b.smooth_spline(n, &knots);
        let p = compile_one(&b.build()).unwrap();
        for i in 0..2048 {
            let v = p.sample2(i * 5 - 5000, i * -3 + 2500);
            assert!(
                (10.0..=90.0).contains(&v),
                "monotone easing must not overshoot: {v}"
            );
        }

        let spline = CompiledSpline::new(knots.to_vec(), SplineEasing::Smooth);
        for (t, expected) in knots {
            assert!(
                (spline.sample(t) - expected).abs() < 1e-12,
                "smooth spline must interpolate its knots"
            );
        }
        // Monotone data must yield monotone output.
        let mut previous = f64::MIN;
        for i in 0..=400 {
            let t = -1.0 + i as f64 * 0.005;
            let v = spline.sample(t);
            assert!(v >= previous - 1e-12, "monotonicity broke at {t}: {v}");
            previous = v;
        }
    }

    #[test]
    fn forward_reference_is_rejected() {
        let graph = FieldGraph {
            nodes: vec![FieldNode::Abs(1), FieldNode::Const(1.0)],
        };
        assert!(matches!(
            compile_one(&graph),
            Err(GenError::ForwardReference { .. })
        ));
    }

    #[test]
    fn duplicate_salt_is_rejected() {
        let mut b = FieldGraphBuilder::new();
        let a = b.fbm("dup.salt", 0.01, 2, 0.5, 2.0);
        let c = b.fbm("dup.salt", 0.02, 2, 0.5, 2.0);
        b.add(a, c);
        assert!(matches!(
            compile_one(&b.build()),
            Err(GenError::SaltCollision { .. })
        ));
    }

    #[test]
    fn non_monotonic_spline_is_rejected() {
        let mut b = FieldGraphBuilder::new();
        let n = b.fbm("t.mono", 0.01, 2, 0.5, 2.0);
        b.spline(n, &[(0.0, 1.0), (0.0, 2.0)]);
        assert!(matches!(
            compile_one(&b.build()),
            Err(GenError::InvalidSpline { .. })
        ));
    }

    #[test]
    fn oversized_graph_is_rejected() {
        let mut nodes = vec![FieldNode::Const(1.0)];
        for i in 1..=MAX_FIELD_NODES {
            nodes.push(FieldNode::Abs(i - 1));
        }
        assert!(matches!(
            compile_one(&FieldGraph { nodes }),
            Err(GenError::GraphTooLarge { .. })
        ));
    }

    #[test]
    fn warp_of_composed_expression_evaluates() {
        // The original slice rejected warping anything but a bare noise
        // leaf; composition through nested programs is the fix.
        let mut b = FieldGraphBuilder::new();
        let base = b.fbm("t.warpc.base", 0.008, 3, 0.5, 2.0);
        let ridge = b.ridged_multi("t.warpc.ridge", 0.02, 4, 0.5, 2.0, 1.0, 2.0);
        let mix = b.add(base, ridge);
        let shaped = b.smooth_spline(mix, &[(-2.0, 0.0), (0.0, 30.0), (2.0, 80.0)]);
        let wx = b.fbm("t.warpc.wx", 0.004, 2, 0.5, 2.0);
        let wz = b.fbm("t.warpc.wz", 0.004, 2, 0.5, 2.0);
        b.warp(shaped, wx, wz, 60.0);
        let p = compile_one(&b.build()).unwrap();
        let mut distinct = hashbrown::HashSet::new();
        for i in 0..512 {
            let v = p.sample2(i * 11 - 2000, i * -7 + 900);
            assert!(v.is_finite() && (0.0..=80.0).contains(&v));
            distinct.insert(v.to_bits());
        }
        assert!(distinct.len() > 256, "warped stack should vary");
    }

    #[test]
    fn warp_of_bare_noise_matches_manual_reevaluation() {
        let mut warped = FieldGraphBuilder::new();
        let n = warped.fbm("t.warpeq.n", 0.01, 3, 0.5, 2.0);
        let dx = warped.fbm("t.warpeq.dx", 0.005, 2, 0.5, 2.0);
        let dz = warped.fbm("t.warpeq.dz", 0.005, 2, 0.5, 2.0);
        warped.warp(n, dx, dz, 40.0);
        let warped = compile_one(&warped.build()).unwrap();

        let mut salts = hashbrown::HashSet::new();
        let one = |salt: &'static str, frequency: f64, octaves: u8| {
            let mut b = FieldGraphBuilder::new();
            b.fbm(salt, frequency, octaves, 0.5, 2.0);
            b.build()
        };
        let n_only =
            FieldProgram::compile(&one("t.warpeq.n", 0.01, 3), "test", 7, "dim", &mut salts)
                .unwrap();
        let dx_only =
            FieldProgram::compile(&one("t.warpeq.dx", 0.005, 2), "test", 7, "dim", &mut salts)
                .unwrap();
        let dz_only =
            FieldProgram::compile(&one("t.warpeq.dz", 0.005, 2), "test", 7, "dim", &mut salts)
                .unwrap();

        for i in 0..128 {
            let (x, z) = (i * 17 - 1000, i * -13 + 400);
            let expected = n_only.eval(
                &n_only.ops,
                n_only.register_count,
                x as f64 + dx_only.sample2(x, z) * 40.0,
                z as f64 + dz_only.sample2(x, z) * 40.0,
            );
            assert_eq!(
                warped.sample2(x, z).to_bits(),
                expected.to_bits(),
                "warp must equal manual re-evaluation at moved coordinates"
            );
        }
    }

    #[test]
    fn affine_rotates_the_sampling_domain() {
        let mut plain = FieldGraphBuilder::new();
        plain.fbm("t.affine.n", 0.01, 3, 0.5, 2.0);
        let plain = compile_one(&plain.build()).unwrap();

        let mut rotated = FieldGraphBuilder::new();
        let n = rotated.fbm("t.affine.n", 0.01, 3, 0.5, 2.0);
        // Unit rotation vectors (0.6, 0.8): no runtime trigonometry.
        rotated.affine(n, 0.6, 0.8, -0.8, 0.6, 0.0, 0.0);
        let mut salts = hashbrown::HashSet::new();
        let rotated =
            FieldProgram::compile(&rotated.build(), "test", 7, "dim", &mut salts).unwrap();

        for i in 0..128 {
            let (x, z) = (i * 9 - 500, i * -5 + 250);
            let expected = plain.eval(
                &plain.ops,
                plain.register_count,
                0.6 * x as f64 + 0.8 * z as f64,
                -0.8 * x as f64 + 0.6 * z as f64,
            );
            assert_eq!(rotated.sample2(x, z).to_bits(), expected.to_bits());
        }
    }

    #[test]
    fn slope_matches_manual_central_differences() {
        let mut with_slope = FieldGraphBuilder::new();
        let n = with_slope.fbm("t.slope.n", 0.01, 4, 0.5, 2.0);
        let shaped = with_slope.spline(n, &[(-1.0, 0.0), (1.0, 60.0)]);
        with_slope.slope_of(shaped, 2.0);
        let with_slope = compile_one(&with_slope.build()).unwrap();

        let mut base = FieldGraphBuilder::new();
        let n = base.fbm("t.slope.n", 0.01, 4, 0.5, 2.0);
        base.spline(n, &[(-1.0, 0.0), (1.0, 60.0)]);
        let mut salts = hashbrown::HashSet::new();
        let base = FieldProgram::compile(&base.build(), "test", 7, "dim", &mut salts).unwrap();

        for i in 0..128 {
            let (x, z) = (i * 13 - 800, i * 7 - 450);
            let at = |dx: f64, dz: f64| {
                base.eval(&base.ops, base.register_count, x as f64 + dx, z as f64 + dz)
            };
            let gx = (at(2.0, 0.0) - at(-2.0, 0.0)) / 4.0;
            let gz = (at(0.0, 2.0) - at(0.0, -2.0)) / 4.0;
            let expected = (gx * gx + gz * gz).sqrt();
            assert_eq!(with_slope.sample2(x, z).to_bits(), expected.to_bits());
        }
    }

    #[test]
    fn curvature_separates_crests_from_hollows() {
        // On a shaped bump field, curvature must be strongly negative at
        // local maxima and strongly positive at local minima.
        let mut b = FieldGraphBuilder::new();
        let n = b.fbm("t.curv.n", 0.02, 3, 0.5, 2.0);
        let shaped = b.scale(n, 40.0);
        b.curvature_of(shaped, 4.0);
        let program = compile_one(&b.build()).unwrap();

        let mut field = FieldGraphBuilder::new();
        let n = field.fbm("t.curv.n", 0.02, 3, 0.5, 2.0);
        field.scale(n, 40.0);
        let mut salts = hashbrown::HashSet::new();
        let field = FieldProgram::compile(&field.build(), "test", 7, "dim", &mut salts).unwrap();

        let mut crest_curvatures = Vec::new();
        let mut hollow_curvatures = Vec::new();
        for x in (-400..400).step_by(4) {
            for z in (-400..400).step_by(4) {
                let center = field.sample2(x, z);
                let neighbors = [
                    field.sample2(x + 4, z),
                    field.sample2(x - 4, z),
                    field.sample2(x, z + 4),
                    field.sample2(x, z - 4),
                ];
                let curvature = program.sample2(x, z);
                if neighbors.iter().all(|&v| v < center) {
                    crest_curvatures.push(curvature);
                }
                if neighbors.iter().all(|&v| v > center) {
                    hollow_curvatures.push(curvature);
                }
            }
        }
        assert!(crest_curvatures.len() > 20 && hollow_curvatures.len() > 20);
        assert!(crest_curvatures.iter().all(|&c| c < 0.0));
        assert!(hollow_curvatures.iter().all(|&c| c > 0.0));
    }

    #[test]
    fn programs_are_deterministic() {
        let mut b = FieldGraphBuilder::new();
        let base = b.fbm("t.det", 0.004, 5, 0.5, 2.0);
        let wx = b.fbm("t.det.wx", 0.002, 2, 0.5, 2.0);
        let wz = b.fbm("t.det.wz", 0.002, 2, 0.5, 2.0);
        let warped = b.warp(base, wx, wz, 40.0);
        b.spline(warped, &[(-1.0, 20.0), (1.0, 120.0)]);
        let graph = b.build();
        let p1 = compile_one(&graph).unwrap();
        let p2 = compile_one(&graph).unwrap();
        for i in 0..512 {
            let (x, z) = (i * 13 - 3000, i * -7 + 1500);
            assert_eq!(p1.sample2(x, z).to_bits(), p2.sample2(x, z).to_bits());
        }
    }
}
