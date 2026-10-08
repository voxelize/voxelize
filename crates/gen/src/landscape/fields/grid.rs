//! Grid evaluation: every stage program over a window of columns, with
//! strided lattices underneath.
//!
//! A window of `w x d` columns is evaluated stage by stage. The last stage
//! covers the window grown by `expand` columns on every side; each earlier
//! stage covers one more ring, so a stencil (`SlopeOf`, `CurvatureOf`)
//! reading an earlier plane always finds its four neighbours. Strided
//! fields are evaluated first on world-aligned lattices: stride-16 lattices
//! come from the shared macro-tile cache (256-block tiles of 16 x 16
//! nodes, cost-only), stride-4 lattices are evaluated per window.
//!
//! Because every column runs the same program on the same position, and
//! every lattice node is a pure function of its position, a window of one
//! column (a point query) gives the same bits as a chunk grid.

use std::sync::Arc;

use crate::landscape::cache::ClockCache;
use crate::landscape::counters::{bump, Counter};

use super::compile::CompiledFields;
use super::eval::{run, Inputs, Kernels, LatticeRect};

/// Nodes per macro tile edge (a stride-16 tile spans 256 blocks).
pub const TILE_NODES: i64 = 16;

/// The macro-tile cache: `(strided field, tile x, tile z)` to node values.
pub type MacroTiles = ClockCache<(u32, i64, i64), Arc<Vec<f64>>>;

/// A rectangle of columns: `[x0, x0 + w) x [z0, z0 + d)`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Area {
    /// First column on x.
    pub x0: i32,
    /// First column on z.
    pub z0: i32,
    /// Columns along x.
    pub w: usize,
    /// Columns along z.
    pub d: usize,
}

impl Area {
    /// The area grown by `e` columns on every side.
    pub fn grow(self, e: i32) -> Area {
        Area {
            x0: self.x0 - e,
            z0: self.z0 - e,
            w: (self.w as i64 + 2 * e as i64) as usize,
            d: (self.d as i64 + 2 * e as i64) as usize,
        }
    }

    /// Index of column `(x, z)`, x fastest; panics outside.
    #[inline]
    pub fn index(&self, x: i32, z: i32) -> usize {
        let dx = (x - self.x0) as usize;
        let dz = (z - self.z0) as usize;
        assert!(dx < self.w && dz < self.d, "column outside its area");
        dz * self.w + dx
    }

    /// Columns in the area.
    pub fn len(&self) -> usize {
        self.w * self.d
    }

    /// Whether the area holds no column.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// The evaluated planes of one window.
#[derive(Debug)]
pub struct FieldGrid {
    planes: Vec<Vec<f64>>,
    areas: Vec<Area>,
    outputs: Vec<u32>,
}

impl FieldGrid {
    /// Requested output `o` at column `(x, z)`.
    #[inline]
    pub fn output(&self, o: usize, x: i32, z: i32) -> f64 {
        let p = self.outputs[o] as usize;
        self.planes[p][self.areas[p].index(x, z)]
    }

    /// The area output `o` covers.
    pub fn output_area(&self, o: usize) -> Area {
        self.areas[self.outputs[o] as usize]
    }
}

struct State<'a> {
    planes: &'a [Vec<f64>],
    areas: &'a [Area],
    lattices: &'a [Option<LatticeRect>],
    x: i32,
    z: i32,
}

impl Inputs for State<'_> {
    #[inline]
    fn plane(&self, p: u32) -> f64 {
        let p = p as usize;
        self.planes[p][self.areas[p].index(self.x, self.z)]
    }

    #[inline]
    fn strided(&self, s: u32, x: f64, z: f64) -> f64 {
        self.lattices[s as usize]
            .as_ref()
            .expect("strided lattice evaluated")
            .sample(x, z)
    }

    #[inline]
    fn stencil(&self, p: u32, curvature: bool) -> f64 {
        let p = p as usize;
        let (a, v) = (&self.areas[p], &self.planes[p]);
        let (x, z) = (self.x, self.z);
        let e = v[a.index(x + 1, z)];
        let w = v[a.index(x - 1, z)];
        let s = v[a.index(x, z + 1)];
        let n = v[a.index(x, z - 1)];
        if curvature {
            e + w + s + n - 4.0 * v[a.index(x, z)]
        } else {
            let gx = (e - w) * 0.5;
            let gz = (s - n) * 0.5;
            (gx * gx + gz * gz).sqrt()
        }
    }
}

/// Inputs for a lattice program: only strided reads exist there.
struct LatticeInputs<'a> {
    lattices: &'a [Option<LatticeRect>],
}

impl Inputs for LatticeInputs<'_> {
    fn plane(&self, _: u32) -> f64 {
        unreachable!("lattice programs read no plane")
    }
    fn strided(&self, s: u32, x: f64, z: f64) -> f64 {
        self.lattices[s as usize]
            .as_ref()
            .expect("dependency lattice evaluated")
            .sample(x, z)
    }
    fn stencil(&self, _: u32, _: bool) -> f64 {
        unreachable!("lattice programs read no stencil")
    }
}

impl CompiledFields {
    /// Expansion of stage `k`'s area beyond the window, for a last-stage
    /// expansion of `expand`.
    pub fn stage_expand(&self, k: usize, expand: i32) -> i32 {
        expand + (self.stages.len() - 1 - k) as i32
    }

    /// Evaluate every requested output over `window` grown by `expand`.
    pub fn evaluate(&self, window: Area, expand: i32, tiles: &MacroTiles) -> FieldGrid {
        let n_stages = self.stages.len();
        let widest = window.grow(self.stage_expand(0, expand));
        // Strided lattices covering the widest area (every stage reads its
        // strided fields at column centres inside it).
        let lo = (widest.x0 as f64 + 0.5, widest.z0 as f64 + 0.5);
        let hi = (
            (widest.x0 + widest.w as i32 - 1) as f64 + 0.5,
            (widest.z0 + widest.d as i32 - 1) as f64 + 0.5,
        );
        let mut lattices: Vec<Option<LatticeRect>> = vec![None; self.strided.len()];
        let mut need: Vec<Option<((f64, f64), (f64, f64))>> = vec![None; self.strided.len()];
        for stage in &self.stages {
            for op in &stage.program.ops {
                if let super::ir::Op::Strided(s) = op {
                    need[*s as usize] = Some((lo, hi));
                }
            }
        }
        self.fill_lattices(&mut lattices, need, tiles);

        let mut planes: Vec<Vec<f64>> = vec![Vec::new(); self.planes.len()];
        let mut areas: Vec<Area> = vec![window; self.planes.len()];
        for (p, info) in self.planes.iter().enumerate() {
            areas[p] = window.grow(self.stage_expand(info.stage, expand));
        }
        let kernels = Kernels {
            noise: &self.noise,
            cells: &self.cells,
        };
        for k in 0..n_stages {
            let stage = &self.stages[k];
            let area = window.grow(self.stage_expand(k, expand));
            let mut outs: Vec<Vec<f64>> =
                stage.planes.iter().map(|_| vec![0.0; area.len()]).collect();
            let mut regs = vec![0.0f64; stage.program.registers];
            for dz in 0..area.d {
                let z = area.z0 + dz as i32;
                for dx in 0..area.w {
                    let x = area.x0 + dx as i32;
                    let inputs = State {
                        planes: &planes,
                        areas: &areas,
                        lattices: &lattices,
                        x,
                        z,
                    };
                    run(
                        &stage.program,
                        &kernels,
                        &inputs,
                        x as f64 + 0.5,
                        z as f64 + 0.5,
                        &mut regs,
                    );
                    let i = dz * area.w + dx;
                    for (o, &r) in stage.program.outputs.iter().enumerate() {
                        outs[o][i] = regs[r as usize];
                    }
                }
            }
            bump(Counter::FieldColumns, area.len() as u64);
            for (o, &p) in stage.planes.iter().enumerate() {
                planes[p as usize] = std::mem::take(&mut outs[o]);
            }
        }
        FieldGrid {
            planes,
            areas,
            outputs: self.outputs.clone(),
        }
    }

    /// Fill `lattices[s]` for every strided field with a need, and its
    /// dependencies, covering the world range asked.
    fn fill_lattices(
        &self,
        lattices: &mut [Option<LatticeRect>],
        mut need: Vec<Option<((f64, f64), (f64, f64))>>,
        tiles: &MacroTiles,
    ) {
        // Consumers come after their dependencies in `strided`, so walk
        // backwards widening each dependency's need to cover the nodes of
        // its consumer.
        for s in (0..self.strided.len()).rev() {
            let Some((lo, hi)) = need[s] else { continue };
            let field = &self.strided[s];
            let (i0, i1) = LatticeRect::nodes_for(field.stride, lo.0, hi.0);
            let (j0, j1) = LatticeRect::nodes_for(field.stride, lo.1, hi.1);
            let st = field.stride as f64;
            let nlo = (i0 as f64 * st, j0 as f64 * st);
            let nhi = ((i1 - 1) as f64 * st, (j1 - 1) as f64 * st);
            for &t in &field.deps {
                let t = t as usize;
                need[t] = Some(match need[t] {
                    None => (nlo, nhi),
                    Some((a, b)) => (
                        (a.0.min_f(nlo.0), a.1.min_f(nlo.1)),
                        (b.0.max_f(nhi.0), b.1.max_f(nhi.1)),
                    ),
                });
            }
        }
        for s in 0..self.strided.len() {
            let Some((lo, hi)) = need[s] else { continue };
            let field = &self.strided[s];
            let (i0, i1) = LatticeRect::nodes_for(field.stride, lo.0, hi.0);
            let (j0, j1) = LatticeRect::nodes_for(field.stride, lo.1, hi.1);
            let rect = if field.stride == 16 {
                self.assemble_from_tiles(s, i0, i1, j0, j1, tiles)
            } else {
                let mut values = Vec::with_capacity(((i1 - i0) * (j1 - j0)) as usize);
                self.eval_nodes(s, i0, i1, j0, j1, lattices, &mut values);
                LatticeRect {
                    stride: field.stride,
                    i0,
                    j0,
                    ni: (i1 - i0) as usize,
                    nj: (j1 - j0) as usize,
                    values,
                }
            };
            lattices[s] = Some(rect);
        }
    }

    fn eval_nodes(
        &self,
        s: usize,
        i0: i64,
        i1: i64,
        j0: i64,
        j1: i64,
        lattices: &[Option<LatticeRect>],
        out: &mut Vec<f64>,
    ) {
        let field = &self.strided[s];
        let kernels = Kernels {
            noise: &self.noise,
            cells: &self.cells,
        };
        let inputs = LatticeInputs { lattices };
        let mut regs = vec![0.0f64; field.program.registers];
        let st = field.stride as f64;
        let r = field.program.outputs[0] as usize;
        for j in j0..j1 {
            for i in i0..i1 {
                run(
                    &field.program,
                    &kernels,
                    &inputs,
                    i as f64 * st,
                    j as f64 * st,
                    &mut regs,
                );
                out.push(regs[r]);
            }
        }
        bump(Counter::LatticeNodes, ((i1 - i0) * (j1 - j0)) as u64);
    }

    fn tile(&self, s: usize, tx: i64, tz: i64, tiles: &MacroTiles) -> Arc<Vec<f64>> {
        let key = (s as u32, tx, tz);
        if let Some(t) = tiles.get(&key) {
            return t;
        }
        bump(Counter::MacroTileMisses, 1);
        let field = &self.strided[s];
        let (i0, j0) = (tx * TILE_NODES, tz * TILE_NODES);
        let (i1, j1) = (i0 + TILE_NODES, j0 + TILE_NODES);
        // Dependencies over this tile's nodes.
        let mut lattices: Vec<Option<LatticeRect>> = vec![None; self.strided.len()];
        let st = field.stride as f64;
        let range = (
            (i0 as f64 * st, j0 as f64 * st),
            ((i1 - 1) as f64 * st, (j1 - 1) as f64 * st),
        );
        let mut need = vec![None; self.strided.len()];
        for &t in &field.deps {
            need[t as usize] = Some(range);
        }
        self.fill_lattices(&mut lattices, need, tiles);
        let mut values = Vec::with_capacity((TILE_NODES * TILE_NODES) as usize);
        self.eval_nodes(s, i0, i1, j0, j1, &lattices, &mut values);
        tiles.insert(key, Arc::new(values))
    }

    fn assemble_from_tiles(
        &self,
        s: usize,
        i0: i64,
        i1: i64,
        j0: i64,
        j1: i64,
        tiles: &MacroTiles,
    ) -> LatticeRect {
        let (ni, nj) = ((i1 - i0) as usize, (j1 - j0) as usize);
        let mut values = vec![0.0f64; ni * nj];
        let t0 = (i0.div_euclid(TILE_NODES), j0.div_euclid(TILE_NODES));
        let t1 = (
            (i1 - 1).div_euclid(TILE_NODES),
            (j1 - 1).div_euclid(TILE_NODES),
        );
        for tz in t0.1..=t1.1 {
            for tx in t0.0..=t1.0 {
                let tile = self.tile(s, tx, tz, tiles);
                for lj in 0..TILE_NODES {
                    let j = tz * TILE_NODES + lj;
                    if j < j0 || j >= j1 {
                        continue;
                    }
                    for li in 0..TILE_NODES {
                        let i = tx * TILE_NODES + li;
                        if i < i0 || i >= i1 {
                            continue;
                        }
                        values[(j - j0) as usize * ni + (i - i0) as usize] =
                            tile[(lj * TILE_NODES + li) as usize];
                    }
                }
            }
        }
        LatticeRect {
            stride: self.strided[s].stride,
            i0,
            j0,
            ni,
            nj,
            values,
        }
    }
}

/// Exact float extrema by comparison (positions only; never output).
trait Ext {
    fn min_f(self, o: f64) -> f64;
    fn max_f(self, o: f64) -> f64;
}

impl Ext for f64 {
    fn min_f(self, o: f64) -> f64 {
        if o < self {
            o
        } else {
            self
        }
    }
    fn max_f(self, o: f64) -> f64 {
        if o > self {
            o
        } else {
            self
        }
    }
}
