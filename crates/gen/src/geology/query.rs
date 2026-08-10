//! Column queries over the fused model: surfaces with relief and
//! micro-texture, slopes, aspect, moisture, lakes, and river channel
//! lookups. Every answer is a pure function of absolute position.

use super::*;

impl GeoModel {
    /// Tiles whose extent covers the point, with partition-of-unity
    /// weights. Each weight ramps to exactly zero at the tile's usable
    /// extent edge (extent minus the interpolation margin), so the fused
    /// field is continuous: a tile entering or leaving the covering set
    /// contributes nothing at the moment it does.
    fn covering_tiles(&self, x: f64, z: f64) -> SmallVec<[(i64, i64, Arc<GeoTile>, f64); 4]> {
        let spec = &self.spec;
        let stride = spec.tile as f64;
        let halo_blocks = (spec.halo_cells * spec.cell) as f64;
        let pad = 2.0 * spec.cell as f64;
        let band = (halo_blocks - pad).max(1.0);
        let mut out = SmallVec::new();
        let tile_x = (x / stride).floor() as i64;
        let tile_z = (z / stride).floor() as i64;
        for dtx in -1..=1i64 {
            for dtz in -1..=1i64 {
                let tx = tile_x + dtx;
                let tz = tile_z + dtz;
                let min_x = tx as f64 * stride - halo_blocks + pad;
                let max_x = (tx + 1) as f64 * stride + halo_blocks - pad;
                let min_z = tz as f64 * stride - halo_blocks + pad;
                let max_z = (tz + 1) as f64 * stride + halo_blocks - pad;
                if x < min_x || x >= max_x || z < min_z || z >= max_z {
                    continue;
                }
                let wx = ramp(x - min_x, band).min(ramp(max_x - x, band));
                let wz = ramp(z - min_z, band).min(ramp(max_z - z, band));
                let weight = wx * wz;
                if weight > 1e-9 {
                    out.push((tx, tz, self.tile(tx, tz), weight));
                }
            }
        }
        out
    }

    /// Partition-of-unity fusion of the covering tiles' solved heights:
    /// the seam-continuous surface, before ceiling compression and
    /// sub-cell detail. This is the single hydrology authority — lake
    /// and channel water levels must derive from it, never from one
    /// tile's own fill (see `extract_channels`).
    pub(super) fn fused_height_raw(&self, x: f64, z: f64) -> f64 {
        let cell = self.spec.cell as f64;
        let mut sum = 0.0;
        let mut norm = 0.0;
        for (_, _, tile, weight) in self.covering_tiles(x, z) {
            sum += tile.height_at(cell, x, z) * weight;
            norm += weight;
        }
        if norm > 1e-9 {
            sum / norm
        } else {
            self.prior(x, z).height
        }
    }

    /// Prefetches fused heights over `[min, max)` plus a probe halo: the
    /// per-chunk grid the stages read, so tile resolution and fusion run
    /// once per chunk instead of five times per column.
    pub fn grid(&self, min: (i32, i32), max: (i32, i32)) -> GeoGrid {
        let probe = GEO_PROBE;
        let min_x = min.0 - probe;
        let min_z = min.1 - probe;
        let span_x = (max.0 - min.0 + 2 * probe) as usize;
        let span_z = (max.1 - min.1 + 2 * probe) as usize;
        let mut heights = Vec::with_capacity(span_x * span_z);
        for ix in 0..span_x {
            for iz in 0..span_z {
                heights.push(self.surface_f(min_x + ix as i32, min_z + iz as i32));
            }
        }
        GeoGrid {
            min_x,
            min_z,
            span_z,
            probe,
            heights,
        }
    }

    /// Fused, sub-cell-detailed surface height in blocks. Composition:
    /// solved coarse form, then three slope-engaged terms — isotropic
    /// texture, spur-and-gully corrugation (directional-basis ridged
    /// noise aligned to the local gradient), and warped strata benches
    /// that break long smooth flanks into risers and treads. All three
    /// calm along high-flow drainage lines so valley floors stay
    /// river-ready, and every term is a pure function of (x, z).
    pub fn surface_f(&self, x: i32, z: i32) -> f64 {
        let fx = x as f64;
        let fz = z as f64;
        let tiles = self.covering_tiles(fx, fz);
        let cell = self.spec.cell as f64;
        let mut sum = 0.0;
        let mut norm = 0.0;
        for (_, _, tile, weight) in &tiles {
            sum += tile.height_at(cell, fx, fz) * weight;
            norm += weight;
        }
        let fused = if norm > 1e-9 { sum / norm } else { self.prior(fx, fz).height };
        let coarse = self.compress_height(fused);
        let relief = &self.spec.relief;

        let wants_detail = self.spec.detail_amp > 0.0;
        let wants_ribs = relief.rib_amp > 0.0;
        let wants_bench = relief.bench_amp > 0.0;
        if !wants_detail && !wants_ribs && !wants_bench {
            return coarse;
        }

        // One gradient probe serves every slope-engaged term.
        let probe = cell;
        let (mut hx, mut hz, mut n2) = (0.0, 0.0, 0.0);
        for (_, _, tile, weight) in &tiles {
            hx += (tile.height_at(cell, fx + probe, fz) - tile.height_at(cell, fx - probe, fz))
                * weight;
            hz += (tile.height_at(cell, fx, fz + probe) - tile.height_at(cell, fx, fz - probe))
                * weight;
            n2 += weight;
        }
        let (gx, gz, slope) = if n2 > 1e-9 {
            let dx = hx / (n2 * 2.0 * probe);
            let dz = hz / (n2 * 2.0 * probe);
            (dx, dz, (dx.abs() + dz.abs()))
        } else {
            (0.0, 0.0, 0.0)
        };

        // One owner-tile resolve serves the drainage calm and the
        // waterline scan below.
        let (owner_x, owner_z, owner, ofx, ofz) = self.owner_tile(x, z);

        // Drainage calm: relief backs off where water concentrates, on
        // a quadratic falloff — hillslopes with modest flow keep their
        // texture, real drainage lines go smooth for the river carve.
        let calm = if relief.calm_flow > 0.0 {
            let flow = owner.flow_at(cell, ofx, ofz);
            let ratio = flow / relief.calm_flow;
            1.0 / (1.0 + ratio * ratio)
        } else {
            1.0
        };

        let mut height = coarse;

        // Landform terms stay off the waterline: a rib pinching a
        // strait shut or a bench ponding a shelf rewrites the coast the
        // ocean census was authored on. The waterline is the sea or any
        // *kept* lake within a couple of cells — a tarn's shore is a
        // waterline too, but a seam-rejected dry pan is not (its
        // breached-basin channel wants the relief that keeps it a
        // river valley). Lake levels compress like the terrain they
        // gate, so high tarns compare in the same height space.
        let waterline = self
            .kept_lake_level_near(owner_x, owner_z, &owner, ofx, ofz, 2)
            .map(|lake| self.compress_height(lake).max(self.spec.sea_level as f64))
            .unwrap_or(self.spec.sea_level as f64);
        let shore = smooth_window(
            coarse - waterline,
            (0.5, relief.shore_calm_band.max(1.0)),
        );

        if wants_detail {
            let floor = self.spec.detail_floor.clamp(0.0, 1.0);
            let rough = (floor + slope * 3.0 * (1.0 - floor)).clamp(floor.max(0.05), 1.0);
            let fine = self.value_fbm(self.detail_seed, fx, fz, self.spec.detail_scale, 3)
                * self.spec.detail_amp;
            // The broad band is form-scale: shore-calmed like the
            // landform terms so it cannot redraw coastlines.
            let broad = if self.spec.detail_broad_amp > 0.0 {
                self.value_fbm(
                    mix64(self.detail_seed ^ 0xb40a_d),
                    fx,
                    fz,
                    self.spec.detail_broad_scale,
                    2,
                ) * self.spec.detail_broad_amp
                    * shore
            } else {
                0.0
            };
            height += (fine + broad) * rough * calm;
        }

        if wants_ribs {
            let engage = smooth_window(slope, relief.rib_slope) * calm * shore;
            if engage > 1e-3 {
                let rib = self.directional_ridged(fx, fz, gx, gz);
                height += rib * relief.rib_amp * engage;
            }
        }

        if wants_bench {
            let engage = smooth_window(slope, relief.bench_slope) * calm * shore;
            if engage > 1e-3 {
                let warp = self.value_fbm(self.bench_seed, fx, fz, relief.bench_warp_scale, 2)
                    * relief.bench_warp_amp;
                let banded = coarse + warp;
                let band = (banded / relief.bench_spacing).floor();
                let frac = banded / relief.bench_spacing - band;
                // Tread flattens, riser steepens: remap the in-band
                // fraction so most of the spacing lies flat and the
                // rest arrives as a near-vertical face.
                let tread = relief.bench_tread;
                let riser = ((frac - tread) / (1.0 - 2.0 * tread)).clamp(0.0, 1.0);
                let shaped = riser * riser * (3.0 - 2.0 * riser);
                let target = (band + shaped) * relief.bench_spacing - warp;
                let pull = (target - coarse).clamp(-relief.bench_amp, relief.bench_amp);
                height += pull * engage;
            }
        }

        height
    }

    /// Spur-and-gully corrugation: ridged value noise evaluated in four
    /// fixed anisotropic frames (0/45/90/135 degrees, stretched along
    /// their spine), blended by how well each frame's spine aligns with
    /// the local downslope direction. Fixed frames keep the field
    /// coherent where the gradient swings — sampling one frame that
    /// rotates with the gradient shears the noise into smears at every
    /// ridgeline. Output is in -1..1 with sharp gully minima.
    fn directional_ridged(&self, fx: f64, fz: f64, gx: f64, gz: f64) -> f64 {
        let relief = &self.spec.relief;
        let g_norm = (gx * gx + gz * gz).sqrt();
        if g_norm < 1e-9 {
            return 0.0;
        }
        let (dx, dz) = (gx / g_norm, gz / g_norm);
        const FRAC_1_SQRT_2: f64 = std::f64::consts::FRAC_1_SQRT_2;
        const FRAMES: [(f64, f64); 4] = [
            (1.0, 0.0),
            (FRAC_1_SQRT_2, FRAC_1_SQRT_2),
            (0.0, 1.0),
            (-FRAC_1_SQRT_2, FRAC_1_SQRT_2),
        ];
        let mut sum = 0.0;
        let mut norm = 0.0;
        for (index, (ex, ez)) in FRAMES.iter().enumerate() {
            let align = dx * ex + dz * ez;
            // cos(2*angle) from the dot product: same weight for a
            // spine and its reverse.
            let weight = (2.0 * align * align - 1.0).max(0.0);
            if weight < 1e-3 {
                continue;
            }
            let seed = mix64(self.rib_seed ^ (index as u64 + 1).wrapping_mul(0x9e37_79b9_7f4a_7c15));
            // Along-spine coordinate stretched: spurs elongate downhill.
            let along = (fx * ex + fz * ez) / (relief.rib_scale * relief.rib_stretch);
            let across = (-fx * ez + fz * ex) / relief.rib_scale;
            let mut value = 0.0;
            let mut amp = 1.0;
            let mut total = 0.0;
            for octave in 0..2u64 {
                let s = mix64(seed ^ (octave + 1).wrapping_mul(0x9e37_79b9_7f4a_7c15));
                let f = (1u64 << octave) as f64;
                value += amp * (self.value_noise_2d(s, along * f, across * f) * 2.0 - 1.0);
                total += amp;
                amp *= 0.5;
            }
            let signed = value / total;
            // Sharp gullies, broad spurs.
            let ridged = 2.0 * signed.abs() - 1.0;
            sum += ridged * weight;
            norm += weight;
        }
        if norm > 1e-9 {
            sum / norm
        } else {
            0.0
        }
    }

    /// Normalized downslope direction of the coarse form, or (0, 0) on
    /// flats: the aspect input for snow scour and substrate mosaics.
    pub fn aspect(&self, x: i32, z: i32) -> (f64, f64) {
        let fx = x as f64;
        let fz = z as f64;
        let cell = self.spec.cell as f64;
        let tiles = self.covering_tiles(fx, fz);
        let (mut hx, mut hz, mut norm) = (0.0, 0.0, 0.0);
        for (_, _, tile, weight) in &tiles {
            hx += (tile.height_at(cell, fx + cell, fz) - tile.height_at(cell, fx - cell, fz))
                * weight;
            hz += (tile.height_at(cell, fx, fz + cell) - tile.height_at(cell, fx, fz - cell))
                * weight;
            norm += weight;
        }
        if norm < 1e-9 {
            return (0.0, 0.0);
        }
        let g = ((hx / norm).powi(2) + (hz / norm).powi(2)).sqrt();
        if g < 1e-9 {
            (0.0, 0.0)
        } else {
            // Downslope points against the gradient.
            (-hx / (norm * g), -hz / (norm * g))
        }
    }

    /// Moisture 0..1: channel/lake/sea proximity, drainage flow, and
    /// height above sea, folded by the spec's weights. The ecology
    /// field, understory densities, and ground-tone mosaics all read
    /// this one answer.
    pub fn moisture(&self, x: i32, z: i32) -> f64 {
        let spec = &self.spec.moisture;
        let sea = self.spec.sea_level as f64;
        let height = self.compress_height(self.fused_height_raw(x as f64, z as f64));
        if height <= sea {
            return 1.0;
        }
        let proximity = if self.lake_level(x, z).is_some() {
            1.0
        } else {
            match self.channel_within(x, z, spec.reach) {
                Some(point) => (1.0 - point.dist / spec.reach).clamp(0.0, 1.0),
                None => 0.0,
            }
        };
        let flow = self.flow(x, z);
        let flow_wet = flow / (flow + spec.flow_half);
        let dryness = ((height - sea) / spec.dry_height).clamp(0.0, 1.0);
        let total = spec.proximity_weight + spec.flow_weight + spec.elevation_weight;
        if total <= 1e-9 {
            return 0.0;
        }
        ((spec.proximity_weight * proximity
            + spec.flow_weight * flow_wet
            + spec.elevation_weight * (1.0 - dryness))
            / total)
            .clamp(0.0, 1.0)
    }

    pub fn surface(&self, x: i32, z: i32) -> i32 {
        self.surface_f(x, z).round() as i32
    }

    /// Blocks-per-block steepness by central differences on the fused
    /// surface (same probe the per-chunk grid uses).
    pub fn steepness(&self, x: i32, z: i32) -> f64 {
        let d = GEO_PROBE;
        let gx = (self.surface_f(x + d, z) - self.surface_f(x - d, z)).abs();
        let gz = (self.surface_f(x, z + d) - self.surface_f(x, z - d)).abs();
        (gx + gz) / (2.0 * d as f64)
    }

    /// Flow accumulation (cells) from the owning tile: the moisture and
    /// drainage diagnostic.
    pub fn flow(&self, x: i32, z: i32) -> f64 {
        let (_, _, tile, fx, fz) = self.owner_tile(x, z);
        tile.flow_at(self.spec.cell as f64, fx, fz)
    }

    /// Soft ceiling: extreme heights compress toward `ceiling_max` on a
    /// rational curve instead of clipping the world roof into mesas.
    /// Applied identically to terrain, lake levels, and channel water so
    /// nothing ends up hanging over compressed ground.
    fn compress_height(&self, h: f64) -> f64 {
        if h <= self.spec.ceiling_start {
            return h;
        }
        let span = (self.spec.ceiling_max - self.spec.ceiling_start).max(1.0);
        let u = (h - self.spec.ceiling_start) / span;
        self.spec.ceiling_start + span * (u / (1.0 + u))
    }

    /// Lake water level from the owning tile's final pit fill: mountain
    /// tarns, valley ponds, rift lakes. Basins contested by a
    /// neighboring tile's solution answer dry (see `lake_verdicts`), and
    /// only interior cells answer at all: the lake flags live on the
    /// 4-block solve lattice, so a rim cell half in the basin would
    /// water columns that stand above the true shoreline — on a crest
    /// tarn that is a waterfall pouring down the mountainside.
    pub fn lake_level(&self, x: i32, z: i32) -> Option<f64> {
        let cell = self.spec.cell as f64;
        let (tile_x, tile_z, tile, fx, fz) = self.owner_tile(x, z);
        let (slot, level) = tile.lake_level_at(cell, fx, fz)?;
        if !self.hydro(tile_x, tile_z).lake_keep[slot] {
            return None;
        }
        let side = tile.side as i32;
        let ix = (slot / tile.side) as i32;
        let iz = (slot % tile.side) as i32;
        for dx in -1..=1i32 {
            for dz in -1..=1i32 {
                let cx = ix + dx;
                let cz = iz + dz;
                if cx < 0 || cz < 0 || cx >= side || cz >= side {
                    return None;
                }
                if !tile.lake[(cx * side + cz) as usize] {
                    return None;
                }
            }
        }
        Some(self.compress_height(level))
    }

    /// Highest *kept* lake surface within `band` cells of the column,
    /// if any: the shoreline question the relief calm asks. Rejected
    /// (contested) basins are not waterlines — they render dry and
    /// carry breached-basin channels that want their valley relief.
    fn kept_lake_level_near(
        &self,
        tile_x: i64,
        tile_z: i64,
        tile: &GeoTile,
        x: f64,
        z: f64,
        band: i32,
    ) -> Option<f64> {
        let slot = tile.slot_at(self.spec.cell as f64, x, z)?;
        let side = tile.side as i32;
        let ix = (slot / tile.side) as i32;
        let iz = (slot % tile.side) as i32;
        let mut keep: Option<Arc<TileHydro>> = None;
        let mut best: Option<f64> = None;
        for dx in -band..=band {
            for dz in -band..=band {
                let cx = ix + dx;
                let cz = iz + dz;
                if cx < 0 || cz < 0 || cx >= side || cz >= side {
                    continue;
                }
                let index = (cx * side + cz) as usize;
                if !tile.lake[index] {
                    continue;
                }
                let verdicts =
                    keep.get_or_insert_with(|| self.hydro(tile_x, tile_z));
                if !verdicts.lake_keep[index] {
                    continue;
                }
                let level = tile.filled[index] as f64;
                if best.map(|b| level > b).unwrap_or(true) {
                    best = Some(level);
                }
            }
        }
        best
    }

    fn owner_tile(&self, x: i32, z: i32) -> (i64, i64, Arc<GeoTile>, f64, f64) {
        let stride = self.spec.tile as f64;
        let fx = x as f64;
        let fz = z as f64;
        let tile_x = (fx / stride).floor() as i64;
        let tile_z = (fz / stride).floor() as i64;
        (tile_x, tile_z, self.tile(tile_x, tile_z), fx, fz)
    }

    /// Nearest river channel within reach; queried across the owner and
    /// the up-to-three neighbors whose extents cover the point. Safe
    /// across tiles because every tile's channel levels derive from the
    /// shared fused surface (`extract_channels`), so overlapping
    /// answers agree to within the pool-and-drop quantum.
    pub fn river_sample(&self, x: i32, z: i32) -> Option<ChannelPoint> {
        self.channel_within(x, z, self.spec.river_width.1 + self.spec.river_bank)
    }

    /// Nearest channel within an arbitrary reach, bounded by the field's
    /// bucket registration (`channel_margin`) — the moisture and ecology
    /// queries ask farther than the river carve does.
    pub fn channel_within(&self, x: i32, z: i32, reach: f64) -> Option<ChannelPoint> {
        let reach = reach.min(self.channel_margin());
        let tiles = self.covering_tiles(x as f64, z as f64);
        let mut best: Option<ChannelPoint> = None;
        for (tile_x, tile_z, _, _) in tiles {
            let hydro = self.hydro(tile_x, tile_z);
            if let Some(point) = hydro.channels.sample(x, z, reach) {
                if best.map(|b| point.dist < b.dist).unwrap_or(true) {
                    best = Some(point);
                }
            }
        }
        best.map(|mut point| {
            point.water_y = self.compress_height(point.water_y);
            point
        })
    }

    /// The one margin channel fields register buckets for: every
    /// consumer's reach (river carve, moisture, riparian ecology) plus
    /// the worst meander displacement must fit inside it.
    pub(super) fn channel_margin(&self) -> f64 {
        let spec = &self.spec;
        let carve = spec.river_width.1 + spec.river_bank;
        let meander = spec.meander_amp * spec.river_width.1;
        carve.max(spec.moisture.reach) + meander
    }

    pub fn river_reach(&self) -> f64 {
        self.spec.river_width.1 + self.spec.river_bank
    }

    /// Classify one column against the nearest channel — same semantics
    /// as the walker rivers' classification, driven by this spec's bank.
    pub fn river_column(&self, point: &ChannelPoint) -> crate::rivers::RiverColumn {
        use crate::rivers::RiverColumn;
        let water_y = point.water_y.floor() as i32;
        if point.dist < point.half_width {
            let t = 1.0 - point.dist / point.half_width;
            let ease = t * t * (3.0 - 2.0 * t);
            let bed = point.water_y - 1.0 - point.depth * ease;
            RiverColumn::Channel {
                bed: bed.floor() as i32,
                water_y,
            }
        } else if point.dist < point.half_width + self.spec.river_bank {
            RiverColumn::Bank {
                raise_to: water_y + 1,
                water_y,
            }
        } else {
            RiverColumn::Outside
        }
    }

    /// Deterministic per-tile digest used by tests and diagnostics.
    pub fn tile_digest(&self, tile_x: i64, tile_z: i64) -> u64 {
        let tile = self.tile(tile_x, tile_z);
        let mut digest = 0xcbf2_9ce4_8422_2325u64;
        for h in &tile.height {
            digest = mix64(digest ^ h.to_bits() as u64);
        }
        digest
    }}
