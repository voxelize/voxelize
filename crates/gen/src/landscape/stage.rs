//! `LandscapeStage`: the landscape installed as one engine stage, and the
//! run writer.
//!
//! One stage avoids the pipeline's height-map rescans between fused inner
//! stages. Per chunk it reads the chunk's facts (from the facts cache, or
//! builds them), paints every column through the surfacers, stamps the
//! sea, places and stamps trees, and writes everything as runs:
//!
//! - `Arc::make_mut(&mut chunk.voxels)` once per chunk (the job owns the
//!   chunk, so this does not clone in the normal case), then runs written
//!   straight into the voxel array in the chunk's `[x, y, z]` layout
//!   (z contiguous); air is never written, because new chunks are zeroed;
//! - `chunk.top_filled_y = Some(max_y)`, the highest y written (or
//!   `Some(-1)` when nothing was), so the engine's height map scans from
//!   the right row (`calculate_max_height` stops at the watermark);
//! - never `set_raw_voxel`, which costs a bounds check and a set insert
//!   per voxel; new chunks already mark every sub-chunk level updated.
//!
//! Game stages after this one use the normal voxel API, which keeps the
//! watermark. The kit's `height_map_matches_rescan` checks the contract.

use std::sync::Arc;

use voxelize::{Chunk, ChunkStage, Pipeline, Resources, Space, Vec2};

use super::counters::{bump, Counter};
use super::facts::{ChunkFacts, ColumnFact};
use super::flora::MAX_CANOPY;
use super::math::MinMax;
use super::surface::{MaterialRuns, PaintColumn};
use super::Landscape;

/// The landscape as one chunk stage.
pub struct LandscapeStage {
    land: Arc<Landscape>,
}

impl LandscapeStage {
    /// A stage generating `land`.
    pub fn new(land: Arc<Landscape>) -> Self {
        Self { land }
    }
}

/// Add the landscape stage to `pipeline`.
pub fn install(pipeline: &mut Pipeline, land: Arc<Landscape>) {
    pipeline.add_stage(LandscapeStage::new(land));
}

impl ChunkStage for LandscapeStage {
    fn name(&self) -> String {
        "landscape".to_owned()
    }

    fn process(&self, mut chunk: Chunk, _: Resources, _: Option<Space>) -> Chunk {
        let Vec2(cx, cz) = chunk.coords;
        let facts = self.land.chunk_facts(Vec2(cx, cz));
        self.land.write_chunk(&mut chunk, &facts);
        chunk
    }
}

/// Writes into one chunk's voxel array, tracking the watermark.
struct Writer<'a> {
    data: &'a mut [u32],
    size: i32,
    height: i32,
    x0: i32,
    z0: i32,
    max_y: i32,
}

impl Writer<'_> {
    #[inline]
    fn index(&self, lx: i32, y: i32, lz: i32) -> usize {
        ((lx * self.height + y) * self.size + lz) as usize
    }

    /// Fill `[lo, hi]` in local column `(lx, lz)` with `block`.
    #[inline]
    fn run(&mut self, lx: i32, lz: i32, lo: i32, hi: i32, block: u32) {
        let lo = Ord::max(lo, 0);
        let hi = Ord::min(hi, self.height - 1);
        if lo > hi || block == 0 {
            return;
        }
        let mut i = self.index(lx, lo, lz);
        let step = self.size as usize;
        for _ in lo..=hi {
            self.data[i] = block;
            i += step;
        }
        bump(Counter::VoxelsWritten, (hi - lo + 1) as u64);
        self.max_y = Ord::max(self.max_y, hi);
    }

    /// Write one voxel at world `(x, y, z)` if it lies in the chunk; a soft
    /// write only fills air.
    #[inline]
    fn voxel(&mut self, x: i32, y: i32, z: i32, block: u32, soft: bool) {
        let (lx, lz) = (x - self.x0, z - self.z0);
        if lx < 0 || lz < 0 || lx >= self.size || lz >= self.size || y < 0 || y >= self.height {
            return;
        }
        let i = self.index(lx, y, lz);
        if soft && self.data[i] != 0 {
            return;
        }
        self.data[i] = block;
        bump(Counter::TreeVoxels, 1);
        self.max_y = Ord::max(self.max_y, y);
    }
}

impl Landscape {
    /// The facts of chunk `coords`, from the facts cache or built.
    pub fn chunk_facts(&self, coords: Vec2<i32>) -> Arc<ChunkFacts> {
        let key = (coords.0, coords.1);
        if let Some(f) = self.facts_cache.get(&key) {
            return f;
        }
        let s = self.chunk_size;
        let built = Arc::new(self.build_facts((coords.0 * s, coords.1 * s), s as usize, self.halo));
        self.facts_cache.insert(key, built)
    }

    /// A column's facts: from `facts` when it stores the column, else a
    /// point query (the same bits).
    pub(crate) fn column_near(&self, facts: &ChunkFacts, x: i32, z: i32) -> ColumnFact {
        match facts.column(x, z, &self.sea) {
            Some(c) => c,
            None => (*self.column_arc(x, z)).clone(),
        }
    }

    /// The trees whose trunks stand in `[min, max)`, in the canonical order
    /// every chunk stamps them in (empty without flora).
    pub fn trees_in(&self, min: (i32, i32), max: (i32, i32)) -> Vec<crate::flora::TreeInstance> {
        match &self.flora {
            Some(flora) => flora.trees_in(min, max, self.sea.level, &mut |x, z| {
                (*self.column_arc(x, z)).clone()
            }),
            None => Vec::new(),
        }
    }

    /// The materials of one column of `facts` after every surfacer.
    pub fn paint_column(&self, facts: &ChunkFacts, x: i32, z: i32) -> MaterialRuns {
        let i = facts.index(x, z).expect("a stored column");
        let water = facts.water_at(i, &self.sea);
        let kept: smallvec::SmallVec<[f32; 8]> = (0..facts.kept_count as usize)
            .map(|f| facts.kept_at(f, i))
            .collect();
        let col = PaintColumn {
            x,
            z,
            top: facts.top[i] as i32,
            ground: facts.ground[i],
            slope: facts.slope[i] as f64,
            aspect: [facts.aspect[i][0] as f64, facts.aspect[i][1] as f64],
            curvature: facts.curvature[i] as f64,
            temperature: facts.temperature[i] as f64,
            moisture: facts.moisture[i] as f64,
            biome: facts.biome[i].id,
            zone: facts.zone[i],
            water: &water,
            frame: &self.frame,
            kept: &kept,
        };
        let mut runs = MaterialRuns::new(col.top, self.fill);
        for s in &self.surfacers {
            s.paint(&col, &mut runs);
        }
        runs
    }

    /// Write chunk `chunk` from its `facts` (the run writer).
    pub fn write_chunk(&self, chunk: &mut Chunk, facts: &ChunkFacts) {
        let size = chunk.options.size as i32;
        let height = chunk.options.max_height as i32;
        assert_eq!(
            size, self.chunk_size,
            "chunk size differs from the landscape's"
        );
        assert_eq!(
            height, self.frame.height as i32,
            "chunk height differs from the frame's"
        );
        let (x0, z0) = (chunk.min.0, chunk.min.2);
        let voxels = Arc::make_mut(&mut chunk.voxels);
        let mut w = Writer {
            data: &mut voxels.data,
            size,
            height,
            x0,
            z0,
            max_y: -1,
        };
        for lx in 0..size {
            for lz in 0..size {
                let (x, z) = (x0 + lx, z0 + lz);
                let runs = self.paint_column(facts, x, z);
                w.run(lx, lz, 0, runs.top(), runs.fill());
                for &(lo, hi, b) in runs.overrides() {
                    w.run(lx, lz, lo, hi, b);
                }
                let i = facts.index(x, z).expect("a stored column");
                for layer in facts.water_at(i, &self.sea).layers {
                    // Sources: stage 0, which packs to the bare id.
                    w.run(lx, lz, layer.bottom, layer.level, layer.fluid);
                }
            }
        }
        if let Some(flora) = &self.flora {
            let lo = (x0 - MAX_CANOPY, z0 - MAX_CANOPY);
            let hi = (x0 + size + MAX_CANOPY, z0 + size + MAX_CANOPY);
            let trees = flora.trees_in(lo, hi, self.sea.level, &mut |x, z| {
                self.column_near(facts, x, z)
            });
            for t in &trees {
                flora.stamp(t, &mut |x, y, z, b, soft| w.voxel(x, y, z, b, soft));
            }
        }
        chunk.top_filled_y = Some(w.max_y);
        if self.has_tints {
            chunk.biome_tints = Some(self.corner_tints(facts, x0, z0, size));
        }
    }

    fn corner_tints(&self, facts: &ChunkFacts, x0: i32, z0: i32, size: i32) -> [u8; 12] {
        let mut out = [128u8; 12];
        let corners = [
            (x0, z0),
            (x0 + size, z0),
            (x0, z0 + size),
            (x0 + size, z0 + size),
        ];
        for (c, &(x, z)) in corners.iter().enumerate() {
            let i = facts.index(x, z).expect("corners lie in the halo");
            let b = facts.biome[i];
            let w = b.edge as f64 / 65535.0;
            let tint = |id: crate::climate::BiomeId| {
                self.climate.tints[id.0 as usize].unwrap_or([1.0, 1.0, 1.0])
            };
            let (p, s) = (tint(b.primary), tint(b.secondary));
            for k in 0..3 {
                let m = p[k] + (s[k] - p[k]) * w;
                out[c * 3 + k] = (m * 128.0 + 0.5).floor().fclamp(0.0, 255.0) as u8;
            }
        }
        out
    }
}
