//! The field IR: hash-consed register programs.
//!
//! A [`Program`] is a straight-line list of [`Op`]s in dependency order.
//! [`ProgramBuilder::push`] hash-conses: an op identical to one already in
//! the program (same opcode, same operands, same constant bits) returns
//! the existing value instead of a new one, so a subexpression shared by
//! two fields, or written twice in one tree, is computed once per column.
//! Sums and products are folded left to right in authored order (float
//! addition is not associative); only the two operands of a single binary
//! add or multiply are put in a canonical order, which IEEE arithmetic
//! makes exact.
//!
//! [`ProgramBuilder::finish`] removes ops no output reads (dead-node
//! elimination) and reuses registers whose values are dead (linear scan
//! over last uses), so a program's register file stays small.

use std::collections::HashMap;

/// A value slot during building; a register after [`ProgramBuilder::finish`].
pub type Reg = u32;

/// One instruction. Operands are values pushed earlier.
#[derive(Clone, Debug, PartialEq)]
#[allow(missing_docs)]
pub enum Op {
    Const(f64),
    /// Noise kernel `kernel`, sampled at the position plus
    /// `amp * (x, z)` when warped.
    Noise {
        kernel: u32,
        warp: Option<(Reg, Reg, f64)>,
    },
    /// Cellular kernel `kernel`.
    Cellular {
        kernel: u32,
    },
    /// A full-rate plane materialized by an earlier stage, at this column.
    Plane(u32),
    /// A strided field, interpolated at this position.
    Strided(u32),
    /// L2 slope (or Laplacian) of an earlier plane at this column.
    Stencil {
        plane: u32,
        curvature: bool,
    },
    Add(Reg, Reg),
    Sub(Reg, Reg),
    Mul(Reg, Reg),
    Div {
        num: Reg,
        den: Reg,
        eps: f64,
    },
    Neg(Reg),
    Abs(Reg),
    Sqrt(Reg),
    Min(Reg, Reg),
    Max(Reg, Reg),
    SMin {
        a: Reg,
        b: Reg,
        k: f64,
    },
    SMax {
        a: Reg,
        b: Reg,
        k: f64,
    },
    Clamp {
        x: Reg,
        lo: f64,
        hi: f64,
    },
    Affine {
        x: Reg,
        mul: f64,
        add: f64,
    },
    Smoothstep {
        x: Reg,
        e0: f64,
        e1: f64,
    },
    Smootherstep {
        x: Reg,
        e0: f64,
        e1: f64,
    },
    Lerp {
        a: Reg,
        b: Reg,
        t: Reg,
    },
    Bias {
        x: Reg,
        b: f64,
    },
    Gain {
        x: Reg,
        g: f64,
    },
    PowSmooth {
        x: Reg,
        e: f64,
    },
    Terrace {
        x: Reg,
        step: f64,
        softness: f64,
    },
    Select {
        cond: Reg,
        a: Reg,
        b: Reg,
        at: f64,
        blend: f64,
    },
    /// Spline table `spline`.
    Spline {
        x: Reg,
        spline: u32,
    },
    /// Router `router`, whose knot values are registers.
    Router {
        x: Reg,
        router: u32,
    },
    Pulse {
        x: Reg,
        period: f64,
        softness: f64,
    },
}

impl Op {
    /// The values this op reads (router knots are listed by the program).
    pub fn inputs(&self, routers: &[RouterTable]) -> Vec<Reg> {
        match *self {
            Op::Const(_)
            | Op::Cellular { .. }
            | Op::Plane(_)
            | Op::Strided(_)
            | Op::Stencil { .. } => Vec::new(),
            Op::Noise { warp, .. } => warp.map(|(x, z, _)| vec![x, z]).unwrap_or_default(),
            Op::Add(a, b) | Op::Sub(a, b) | Op::Mul(a, b) | Op::Min(a, b) | Op::Max(a, b) => {
                vec![a, b]
            }
            Op::Div { num, den, .. } => vec![num, den],
            Op::SMin { a, b, .. } | Op::SMax { a, b, .. } => vec![a, b],
            Op::Neg(x) | Op::Abs(x) | Op::Sqrt(x) => vec![x],
            Op::Clamp { x, .. }
            | Op::Affine { x, .. }
            | Op::Smoothstep { x, .. }
            | Op::Smootherstep { x, .. }
            | Op::Bias { x, .. }
            | Op::Gain { x, .. }
            | Op::PowSmooth { x, .. }
            | Op::Terrace { x, .. }
            | Op::Spline { x, .. }
            | Op::Pulse { x, .. } => vec![x],
            Op::Lerp { a, b, t } => vec![a, b, t],
            Op::Select { cond, a, b, .. } => vec![cond, a, b],
            Op::Router { x, router } => {
                let mut v = vec![x];
                v.extend(routers[router as usize].knots.iter().map(|&(_, r)| r));
                v
            }
        }
    }

    fn remap(&self, map: &[Reg], routers: &mut [RouterTable]) -> Op {
        let m = |r: Reg| map[r as usize];
        match *self {
            Op::Const(v) => Op::Const(v),
            Op::Noise { kernel, warp } => Op::Noise {
                kernel,
                warp: warp.map(|(x, z, a)| (m(x), m(z), a)),
            },
            Op::Cellular { kernel } => Op::Cellular { kernel },
            Op::Plane(p) => Op::Plane(p),
            Op::Strided(s) => Op::Strided(s),
            Op::Stencil { plane, curvature } => Op::Stencil { plane, curvature },
            Op::Add(a, b) => Op::Add(m(a), m(b)),
            Op::Sub(a, b) => Op::Sub(m(a), m(b)),
            Op::Mul(a, b) => Op::Mul(m(a), m(b)),
            Op::Div { num, den, eps } => Op::Div {
                num: m(num),
                den: m(den),
                eps,
            },
            Op::Neg(x) => Op::Neg(m(x)),
            Op::Abs(x) => Op::Abs(m(x)),
            Op::Sqrt(x) => Op::Sqrt(m(x)),
            Op::Min(a, b) => Op::Min(m(a), m(b)),
            Op::Max(a, b) => Op::Max(m(a), m(b)),
            Op::SMin { a, b, k } => Op::SMin {
                a: m(a),
                b: m(b),
                k,
            },
            Op::SMax { a, b, k } => Op::SMax {
                a: m(a),
                b: m(b),
                k,
            },
            Op::Clamp { x, lo, hi } => Op::Clamp { x: m(x), lo, hi },
            Op::Affine { x, mul, add } => Op::Affine { x: m(x), mul, add },
            Op::Smoothstep { x, e0, e1 } => Op::Smoothstep { x: m(x), e0, e1 },
            Op::Smootherstep { x, e0, e1 } => Op::Smootherstep { x: m(x), e0, e1 },
            Op::Lerp { a, b, t } => Op::Lerp {
                a: m(a),
                b: m(b),
                t: m(t),
            },
            Op::Bias { x, b } => Op::Bias { x: m(x), b },
            Op::Gain { x, g } => Op::Gain { x: m(x), g },
            Op::PowSmooth { x, e } => Op::PowSmooth { x: m(x), e },
            Op::Terrace { x, step, softness } => Op::Terrace {
                x: m(x),
                step,
                softness,
            },
            Op::Select {
                cond,
                a,
                b,
                at,
                blend,
            } => Op::Select {
                cond: m(cond),
                a: m(a),
                b: m(b),
                at,
                blend,
            },
            Op::Spline { x, spline } => Op::Spline { x: m(x), spline },
            Op::Router { x, router } => {
                for knot in routers[router as usize].knots.iter_mut() {
                    knot.1 = m(knot.1);
                }
                Op::Router { x: m(x), router }
            }
            Op::Pulse {
                x,
                period,
                softness,
            } => Op::Pulse {
                x: m(x),
                period,
                softness,
            },
        }
    }

    /// The hash-consing key: opcode, operands and constant bits.
    fn key(&self, routers: &[RouterTable], splines: &[SplineTable]) -> Vec<u64> {
        let b = |v: f64| v.to_bits();
        let r = |v: Reg| v as u64;
        match *self {
            Op::Const(v) => vec![0, b(v)],
            Op::Noise { kernel, warp } => match warp {
                None => vec![1, kernel as u64],
                Some((x, z, a)) => vec![2, kernel as u64, r(x), r(z), b(a)],
            },
            Op::Cellular { kernel } => vec![3, kernel as u64],
            Op::Plane(p) => vec![4, p as u64],
            Op::Strided(s) => vec![5, s as u64],
            Op::Stencil { plane, curvature } => vec![6, plane as u64, curvature as u64],
            Op::Add(a, c) => vec![7, r(a), r(c)],
            Op::Sub(a, c) => vec![8, r(a), r(c)],
            Op::Mul(a, c) => vec![9, r(a), r(c)],
            Op::Div { num, den, eps } => vec![10, r(num), r(den), b(eps)],
            Op::Neg(x) => vec![11, r(x)],
            Op::Abs(x) => vec![12, r(x)],
            Op::Sqrt(x) => vec![13, r(x)],
            Op::Min(a, c) => vec![14, r(a), r(c)],
            Op::Max(a, c) => vec![15, r(a), r(c)],
            Op::SMin { a, b: c, k } => vec![16, r(a), r(c), b(k)],
            Op::SMax { a, b: c, k } => vec![17, r(a), r(c), b(k)],
            Op::Clamp { x, lo, hi } => vec![18, r(x), b(lo), b(hi)],
            Op::Affine { x, mul, add } => vec![19, r(x), b(mul), b(add)],
            Op::Smoothstep { x, e0, e1 } => vec![20, r(x), b(e0), b(e1)],
            Op::Smootherstep { x, e0, e1 } => vec![21, r(x), b(e0), b(e1)],
            Op::Lerp { a, b: c, t } => vec![22, r(a), r(c), r(t)],
            Op::Bias { x, b: v } => vec![23, r(x), b(v)],
            Op::Gain { x, g } => vec![24, r(x), b(g)],
            Op::PowSmooth { x, e } => vec![25, r(x), b(e)],
            Op::Terrace { x, step, softness } => vec![26, r(x), b(step), b(softness)],
            Op::Select {
                cond,
                a,
                b: c,
                at,
                blend,
            } => vec![27, r(cond), r(a), r(c), b(at), b(blend)],
            Op::Spline { x, spline } => {
                let mut k = vec![28, r(x)];
                for &(kx, ky) in &splines[spline as usize].knots {
                    k.push(b(kx));
                    k.push(b(ky));
                }
                k
            }
            Op::Router { x, router } => {
                let mut k = vec![29, r(x)];
                for &(kx, kr) in &routers[router as usize].knots {
                    k.push(b(kx));
                    k.push(r(kr));
                }
                k
            }
            Op::Pulse {
                x,
                period,
                softness,
            } => vec![30, r(x), b(period), b(softness)],
        }
    }
}

/// A constant-knot monotone spline with its Fritsch-Carlson slopes.
#[derive(Clone, Debug, PartialEq)]
pub struct SplineTable {
    /// Knots `(x, y)`.
    pub knots: Vec<(f64, f64)>,
    /// One slope per knot.
    pub slopes: Vec<f64>,
}

/// A router: knot positions and the values holding their fields.
#[derive(Clone, Debug, PartialEq)]
pub struct RouterTable {
    /// Knots `(x, value)`.
    pub knots: Vec<(f64, Reg)>,
}

/// A finished program: ops over a register file, and the registers its
/// outputs end in.
#[derive(Clone, Debug, Default)]
pub struct Program {
    /// Instructions, each writing `dst[i]`.
    pub ops: Vec<Op>,
    /// The register each op writes.
    pub dst: Vec<Reg>,
    /// Registers the program needs.
    pub registers: usize,
    /// The register of each output, in request order.
    pub outputs: Vec<Reg>,
    /// Spline tables.
    pub splines: Vec<SplineTable>,
    /// Router tables (knot values are registers).
    pub routers: Vec<RouterTable>,
}

/// Builds one program with hash-consing.
#[derive(Default)]
pub struct ProgramBuilder {
    ops: Vec<Op>,
    seen: HashMap<Vec<u64>, Reg>,
    splines: Vec<SplineTable>,
    routers: Vec<RouterTable>,
    outputs: Vec<Reg>,
    /// When false, every push is a new op (the CSE-equivalence tests
    /// compare both).
    pub cse: bool,
}

impl ProgramBuilder {
    /// An empty builder with CSE on.
    pub fn new() -> Self {
        Self {
            cse: true,
            ..Self::default()
        }
    }

    /// Add `op`, or return the identical op already present.
    pub fn push(&mut self, op: Op) -> Reg {
        // Add and Mul commute exactly in IEEE arithmetic: order operands.
        let op = match op {
            Op::Add(a, b) if b < a => Op::Add(b, a),
            Op::Mul(a, b) if b < a => Op::Mul(b, a),
            other => other,
        };
        if self.cse {
            let key = op.key(&self.routers, &self.splines);
            if let Some(&r) = self.seen.get(&key) {
                return r;
            }
            let r = self.ops.len() as Reg;
            self.ops.push(op);
            self.seen.insert(key, r);
            r
        } else {
            let r = self.ops.len() as Reg;
            self.ops.push(op);
            r
        }
    }

    /// Register a spline table; returns its index.
    pub fn spline(&mut self, table: SplineTable) -> u32 {
        if self.cse {
            if let Some(i) = self.splines.iter().position(|s| *s == table) {
                return i as u32;
            }
        }
        self.splines.push(table);
        (self.splines.len() - 1) as u32
    }

    /// Register a router table; returns its index. Tables are never
    /// shared between ops (an identical router op is hash-consed whole, by
    /// its knots), because finishing renumbers a table's registers in
    /// place once per op that owns it.
    pub fn router(&mut self, table: RouterTable) -> u32 {
        self.routers.push(table);
        (self.routers.len() - 1) as u32
    }

    /// Mark `r` as the next output.
    pub fn output(&mut self, r: Reg) {
        self.outputs.push(r);
    }

    /// How many ops are live so far.
    pub fn len(&self) -> usize {
        self.ops.len()
    }

    /// Whether the builder holds no op.
    pub fn is_empty(&self) -> bool {
        self.ops.is_empty()
    }

    /// Dead-node elimination, then register reuse.
    pub fn finish(self) -> Program {
        let ProgramBuilder {
            ops,
            mut routers,
            splines,
            outputs,
            ..
        } = self;
        // Liveness: walk back from the outputs.
        let mut live = vec![false; ops.len()];
        for &o in &outputs {
            live[o as usize] = true;
        }
        for i in (0..ops.len()).rev() {
            if live[i] {
                for input in ops[i].inputs(&routers) {
                    live[input as usize] = true;
                }
            }
        }
        // Compact live ops (values renumbered densely).
        let mut dense = vec![u32::MAX; ops.len()];
        let mut kept: Vec<Op> = Vec::new();
        for (i, op) in ops.iter().enumerate() {
            if live[i] {
                dense[i] = kept.len() as u32;
                kept.push(op.remap(&dense, &mut routers));
            }
        }
        let outputs: Vec<Reg> = outputs.iter().map(|&o| dense[o as usize]).collect();
        // Last use of each value; outputs live to the end.
        let n = kept.len();
        let mut last_use = vec![0usize; n];
        for (i, op) in kept.iter().enumerate() {
            last_use[i] = i;
            for input in op.inputs(&routers) {
                last_use[input as usize] = i;
            }
        }
        for &o in &outputs {
            last_use[o as usize] = usize::MAX;
        }
        // Linear scan: a value's register frees after its last use. A
        // register is never reused by the op that last reads it, so an op
        // never overwrites its own input mid-instruction.
        let mut reg_of = vec![0 as Reg; n];
        let mut free: Vec<Reg> = Vec::new();
        let mut expiring: Vec<Vec<usize>> = vec![Vec::new(); n];
        for (v, &lu) in last_use.iter().enumerate() {
            if lu != usize::MAX && lu < n {
                expiring[lu].push(v);
            }
        }
        let mut registers = 0usize;
        for i in 0..n {
            let r = match free.pop() {
                Some(r) => r,
                None => {
                    registers += 1;
                    (registers - 1) as Reg
                }
            };
            reg_of[i] = r;
            // Values whose last read is op i free after it runs; a value
            // never read frees right away (it is dead but kept for its
            // side of a router or for analysis).
            for &v in &expiring[i] {
                free.push(reg_of[v]);
            }
        }
        let mut routers_final = routers;
        let ops_final: Vec<Op> = kept
            .iter()
            .map(|op| op.remap(&reg_of, &mut routers_final))
            .collect();
        Program {
            ops: ops_final,
            dst: reg_of.clone(),
            registers: Ord::max(registers, 1),
            outputs: outputs.iter().map(|&o| reg_of[o as usize]).collect(),
            splines,
            routers: routers_final,
        }
    }
}
