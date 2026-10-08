//! Floods over probed ground: the bounded lowest-frontier flood that finds
//! a lake's spill level, and the priority flood that fills a catchment tile
//! from its real outlets and routes its drainage.
//!
//! Both are exact over the heights they are given (flood solvers read exact
//! probes, never coarse ones, so water never hangs or spills), never
//! excavate, and are deterministic: every queue orders ties by a fixed key
//! (cell coordinates, or insertion sequence), and no output depends on hash
//! iteration order. Heights must not be NaN (a flood panics on one, on
//! every platform alike), and −0.0 queues as +0.0, so a zero's sign never
//! reorders a flood.

use std::cmp::{Ordering, Reverse};
use std::collections::BinaryHeap;

use hashbrown::HashSet;

use super::math::MinMax;

/// A height with a total order (`f64::total_cmp`), for priority queues.
/// Built only by [`Key::new`], which refuses NaN and folds −0.0 into +0.0,
/// so `total_cmp` orders exactly as `<` does.
#[derive(Clone, Copy, Debug)]
struct Key(f64);

impl Key {
    #[inline]
    fn new(h: f64) -> Self {
        assert!(!h.is_nan(), "flood: a height is NaN");
        // −0.0 + 0.0 is +0.0 under round-to-nearest; every other value is
        // unchanged.
        Key(h + 0.0)
    }
}

impl PartialEq for Key {
    fn eq(&self, o: &Self) -> bool {
        self.0.total_cmp(&o.0) == Ordering::Equal
    }
}

impl Eq for Key {}

impl PartialOrd for Key {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}

impl Ord for Key {
    fn cmp(&self, o: &Self) -> Ordering {
        self.0.total_cmp(&o.0)
    }
}

/// The four neighbours, in the fixed order every flood visits them.
const NEIGHBORS: [(i32, i32); 4] = [(-1, 0), (1, 0), (0, -1), (0, 1)];

/// Limits of a lake flood.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LakeLimits {
    /// Most cells probed (a deterministic budget).
    pub max_probes: u32,
    /// Farthest a cell may lie from the seed (Chebyshev distance, cells).
    pub max_radius: i32,
    /// Deepest the lake may be: spill level minus the seed's height.
    pub max_depth: f64,
}

/// A depression filled to its spill point.
#[derive(Clone, Debug, PartialEq)]
pub struct Lake {
    /// The spill height: the lowest saddle out of the depression.
    pub level: f64,
    /// Cells strictly below the level, sorted: the lake bed.
    pub cells: Vec<(i32, i32)>,
    /// The saddle cell the water spills over.
    pub spill: (i32, i32),
    /// The first cell past the saddle lower than the level.
    pub outlet: (i32, i32),
    /// Height of the seed (the depression's floor when seeded at a minimum).
    pub floor: f64,
    /// Cells probed.
    pub probes: u32,
}

impl Lake {
    /// Depth of the lake at its seed: level minus floor.
    pub fn depth(&self) -> f64 {
        self.level - self.floor
    }
}

/// Why a lake flood gave up.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum LakeReject {
    /// The probe budget ran out first.
    Budget {
        /// Cells probed when it ran out.
        probes: u32,
    },
    /// The flood reached past the radius limit.
    Radius,
    /// The depression is deeper than allowed.
    TooDeep {
        /// The spill level the flood had reached.
        level: f64,
    },
}

/// Fill the depression holding `seed` to its spill point: grow a region
/// from the seed by always taking the lowest frontier cell, raising the
/// level to each cell taken; the first frontier cell lower than the level
/// has been reached over a saddle, so the level is the spill height.
///
/// Seed it at a local minimum: a seed with a lower neighbour spills at once,
/// returning a lake with no cells. `height(x, z)` is called once per probed
/// cell.
pub fn lake_flood(
    mut height: impl FnMut(i32, i32) -> f64,
    seed: (i32, i32),
    limits: &LakeLimits,
) -> Result<Lake, LakeReject> {
    let floor = Key::new(height(seed.0, seed.1)).0;
    let mut probes = 1u32;
    let mut seen: HashSet<(i32, i32)> = HashSet::new();
    let mut region: Vec<((i32, i32), f64)> = vec![(seed, floor)];
    let mut heap: BinaryHeap<Reverse<(Key, i32, i32)>> = BinaryHeap::new();
    seen.insert(seed);
    let mut level = floor;
    let mut spill = seed;
    let mut frontier = |c: (i32, i32),
                        seen: &mut HashSet<(i32, i32)>,
                        heap: &mut BinaryHeap<Reverse<(Key, i32, i32)>>,
                        probes: &mut u32|
     -> Result<(), LakeReject> {
        for (dx, dz) in NEIGHBORS {
            let n = (c.0 + dx, c.1 + dz);
            if seen.insert(n) {
                if *probes >= limits.max_probes {
                    return Err(LakeReject::Budget { probes: *probes });
                }
                *probes += 1;
                heap.push(Reverse((Key::new(height(n.0, n.1)), n.0, n.1)));
            }
        }
        Ok(())
    };
    frontier(seed, &mut seen, &mut heap, &mut probes)?;
    while let Some(Reverse((Key(h), x, z))) = heap.pop() {
        if h < level {
            let mut cells: Vec<(i32, i32)> = region
                .iter()
                .filter(|(_, ch)| *ch < level)
                .map(|(c, _)| *c)
                .collect();
            cells.sort_unstable();
            return Ok(Lake {
                level,
                cells,
                spill,
                outlet: (x, z),
                floor,
                probes,
            });
        }
        if Ord::max((x - seed.0).abs(), (z - seed.1).abs()) > limits.max_radius {
            return Err(LakeReject::Radius);
        }
        if h > level {
            level = h;
            spill = (x, z);
            if level - floor > limits.max_depth {
                return Err(LakeReject::TooDeep { level });
            }
        }
        region.push(((x, z), h));
        frontier((x, z), &mut seen, &mut heap, &mut probes)?;
    }
    unreachable!("a lake flood's frontier never empties: it always has an unprobed neighbour")
}

/// A synthetic divide raised along a tile's border, so drainage leaves the
/// tile only through its real outlets: non-outlet cells within `width`
/// cells of the border are raised by `rise·(1 − d/width)`, `d` the distance
/// to the border in cells.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Divide {
    /// Height added at the border itself, blocks.
    pub rise: f64,
    /// How many cells in from the border the divide reaches.
    pub width: u32,
}

/// No receiver: an outlet, or a cell no outlet reaches.
pub const NO_RECEIVER: u32 = u32::MAX;

/// A drained grid: the depression-filled surface, each cell's downstream
/// receiver, and the order cells were reached in (outlets first, so every
/// cell comes after its receiver).
#[derive(Clone, Debug, PartialEq)]
pub struct Drainage {
    /// Grid width in cells (the `i` axis, fastest in every row-major array).
    pub width: usize,
    /// Grid height in cells (the `j` axis).
    pub height: usize,
    /// Heights after the divide.
    pub ground: Vec<f64>,
    /// The filled surface: the lowest surface at or above `ground` that
    /// drains every reached cell to an outlet.
    pub filled: Vec<f64>,
    /// Each cell's downstream neighbour, or [`NO_RECEIVER`].
    pub receiver: Vec<u32>,
    /// Cells in the order the flood reached them, outlets first.
    pub order: Vec<u32>,
    /// Whether an outlet drains the cell.
    pub reached: Vec<bool>,
}

impl Drainage {
    /// Index of cell `(i, j)` (`i` along the width).
    #[inline]
    pub fn index(&self, i: usize, j: usize) -> usize {
        j * self.width + i
    }

    /// Flow accumulation: each cell's own runoff plus everything upstream
    /// of it, summed in reverse reach order (deterministic).
    pub fn accumulate(&self, runoff: impl Fn(usize) -> f64) -> Vec<f64> {
        let mut acc: Vec<f64> = (0..self.filled.len()).map(&runoff).collect();
        for &cell in self.order.iter().rev() {
            let r = self.receiver[cell as usize];
            if r != NO_RECEIVER {
                acc[r as usize] += acc[cell as usize];
            }
        }
        acc
    }

    /// Depth of standing water at a cell if every depression filled.
    pub fn pond_depth(&self, cell: usize) -> f64 {
        self.filled[cell] - self.ground[cell]
    }
}

/// Priority flood from the outlets over a `width × height` grid of
/// `heights` (row-major, `i` fastest): cells are reached in order of their
/// filled height, ties first-come first-served, and each takes the
/// neighbour that reached it as its receiver. Cells no outlet reaches keep
/// their ground height, `reached = false` and no receiver.
pub fn priority_flood(
    width: usize,
    height: usize,
    heights: &[f64],
    outlet: impl Fn(usize, usize) -> bool,
    divide: Option<Divide>,
) -> Drainage {
    assert_eq!(heights.len(), width * height, "one height per cell");
    let n = width * height;
    let mut ground = heights.to_vec();
    let mut is_outlet = vec![false; n];
    for j in 0..height {
        for i in 0..width {
            let c = j * width + i;
            is_outlet[c] = outlet(i, j);
            if let (Some(d), false) = (divide, is_outlet[c]) {
                let edge = [i, j, width - 1 - i, height - 1 - j]
                    .into_iter()
                    .fold(usize::MAX, Ord::min) as f64;
                if d.width > 0 && edge < d.width as f64 {
                    ground[c] += d.rise * (1.0 - edge / d.width as f64);
                }
            }
        }
    }
    let mut filled = ground.clone();
    let mut receiver = vec![NO_RECEIVER; n];
    let mut reached = vec![false; n];
    let mut order = Vec::with_capacity(n);
    let mut heap: BinaryHeap<Reverse<(Key, u64, u32)>> = BinaryHeap::new();
    let mut seq = 0u64;
    for c in 0..n {
        if is_outlet[c] {
            reached[c] = true;
            heap.push(Reverse((Key::new(filled[c]), seq, c as u32)));
            seq += 1;
        }
    }
    while let Some(Reverse((Key(level), _, c))) = heap.pop() {
        let c = c as usize;
        order.push(c as u32);
        let (i, j) = ((c % width) as i64, (c / width) as i64);
        for (dx, dz) in NEIGHBORS {
            let (ni, nj) = (i + dx as i64, j + dz as i64);
            if ni < 0 || nj < 0 || ni >= width as i64 || nj >= height as i64 {
                continue;
            }
            let nc = nj as usize * width + ni as usize;
            if reached[nc] {
                continue;
            }
            reached[nc] = true;
            receiver[nc] = c as u32;
            filled[nc] = Key::new(ground[nc]).0.fmax(level);
            heap.push(Reverse((Key::new(filled[nc]), seq, nc as u32)));
            seq += 1;
        }
    }
    Drainage {
        width,
        height,
        ground,
        filled,
        receiver,
        order,
        reached,
    }
}
