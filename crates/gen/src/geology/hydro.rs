//! Tile hydrology: channel extraction along receiver forests with
//! seam-continuous water levels, and the cross-tile lake verdicts that
//! decide which solved basins actually hold water.

use super::*;

impl GeoModel {
    /// Hydrology for one tile: channel polylines and lake verdicts.
    /// Computed lazily and separately from the tile solve because both
    /// read the *fused* surface and the neighbors' solutions — data a
    /// single tile cannot see while it is still being solved.
    pub fn hydro(&self, tile_x: i64, tile_z: i64) -> Arc<TileHydro> {
        if let Some(hit) = self
            .hydro
            .read()
            .expect("geo hydro cache")
            .get(&(tile_x, tile_z))
        {
            return Arc::clone(hit);
        }
        let tile = self.tile(tile_x, tile_z);
        // Verdicts first: channel extraction must know which lakes
        // survive, because a rejected basin still owes the world its
        // river — the drainage runs on where the lake declined to be.
        let lake_keep = self.lake_verdicts(&tile);
        let solved = Arc::new(TileHydro {
            channels: self.extract_channels(&tile, &lake_keep),
            lake_keep,
        });
        let mut cache = self.hydro.write().expect("geo hydro cache");
        if cache.len() >= TILE_CACHE_CAP {
            cache.clear();
        }
        cache.insert((tile_x, tile_z), Arc::clone(&solved));
        solved
    }

    /// Channel water levels come from the *fused* surface, not the
    /// tile's own filled surface. Neighboring tiles erode the same
    /// geography a few blocks apart (each window truncates the
    /// watershed differently), and fusion is what hides that
    /// disagreement in the terrain — a channel level lifted straight
    /// out of one tile's fill re-exposes it as a wall of water at the
    /// seam. The fused surface is the one hydrology authority every
    /// tile agrees on.
    ///
    /// Along each tile's receiver forest the level is clamped monotone
    /// (`level[recv] <= level[cell]`), lake cells carry their own lake
    /// surface instead of the fused floor (a river must enter a lake at
    /// the lake's level, and leave below it), and lake-interior cells
    /// emit no segments — the lake overlay owns that water. Levels snap
    /// to integers (pool-and-drop): fractional levels floor differently
    /// column to column and the fluid simulation oscillates on the
    /// mixed-height source blocks forever.
    ///
    /// Only *kept* lakes suppress segments and carry lake-surface
    /// levels. A basin rejected by `lake_verdicts` renders no lake, so
    /// its cells fall back to the fused floor and keep their channel
    /// segments: the river runs through the dry depression and incises
    /// the spill lip like a breached-lake outlet gorge, instead of
    /// drainage vanishing into an empty pan at the seam.
    fn extract_channels(&self, tile: &GeoTile, lake_keep: &[bool]) -> ChannelField {
        let spec = &self.spec;
        let cell = spec.cell as f64;
        let side = tile.side;
        let halo = spec.halo_cells as usize;
        let sea = spec.sea_level as f64;
        let count = side * side;

        let position = |index: usize| -> (f64, f64) {
            (
                tile.origin_x as f64 + ((index / side) as f64 + 0.5) * cell,
                tile.origin_z as f64 + ((index % side) as f64 + 0.5) * cell,
            )
        };

        // Node base levels: fused surface outside kept lakes, own lake
        // surface inside them.
        let kept = |index: usize| tile.lake[index] && lake_keep[index];
        let mut level = vec![0.0f64; count];
        for index in 0..count {
            let (x, z) = position(index);
            level[index] = if kept(index) {
                tile.filled[index] as f64
            } else {
                self.fused_height_raw(x, z)
            };
        }

        // Monotone clamp down the receiver forest, walked in drainage
        // order (highest fill first) so every upstream min arrives
        // before its receiver is read.
        let mut order: Vec<u32> = (0..count as u32).collect();
        order.sort_unstable_by(|a, b| {
            tile.filled[*b as usize]
                .partial_cmp(&tile.filled[*a as usize])
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.cmp(b))
        });
        for &index in &order {
            let index = index as usize;
            let recv = tile.receiver[index] as usize;
            if recv != index {
                level[recv] = level[recv].min(level[index]);
            }
        }

        let profile_at = |area: f64, x: f64, z: f64| -> ChannelProfile {
            let t = ((area - spec.channel_area) / (spec.channel_area_full - spec.channel_area))
                .clamp(0.0, 1.0)
                .sqrt();
            let mut depth = spec.river_depth.0 + (spec.river_depth.1 - spec.river_depth.0) * t;
            // Pool-and-riffle alternation along the reach: real rivers
            // are not one uniform trench, and the depth swing is what
            // makes pools read blue between bright riffles.
            if spec.riffle_amp > 0.0 {
                let swing = self.value_fbm(
                    mix64(self.meander_seed ^ 0x41ff_1e),
                    x,
                    z,
                    spec.riffle_scale,
                    2,
                );
                depth = (depth * (1.0 + spec.riffle_amp * swing)).max(spec.river_depth.0 * 0.5);
            }
            ChannelProfile {
                half_width: spec.river_width.0 + (spec.river_width.1 - spec.river_width.0) * t,
                depth,
            }
        };

        // Meander displacement: cell-center drainage is a surveyed grid,
        // and a smooth angle field bends it into reaches. The offset is
        // a pure function of a node's absolute position, so neighboring
        // tiles displace the shared node identically; water levels ride
        // the node wherever it lands (they were derived from the fused
        // surface at the original cell, and the monotone clamp already
        // ran).
        let meander = |x: f64, z: f64, half_width: f64| -> (f64, f64) {
            if spec.meander_amp <= 0.0 {
                return (x, z);
            }
            // Direction from two independent smooth fields, normalized by
            // sqrt: trigonometry is not bit-stable across platforms.
            let dx = self.value_fbm(self.meander_seed, x, z, spec.meander_scale, 2);
            let dz = self.value_fbm(
                crate::stream::mix64(self.meander_seed ^ 0x5a),
                x,
                z,
                spec.meander_scale,
                2,
            );
            let norm = (dx * dx + dz * dz).sqrt();
            if norm < 1e-6 {
                return (x, z);
            }
            let amp = spec.meander_amp * half_width;
            (x + dx / norm * amp, z + dz / norm * amp)
        };

        let mut lines: Vec<(Vec<(f64, f64, f64)>, Vec<ChannelProfile>)> = Vec::new();
        for ix in halo..side - halo {
            for iz in halo..side - halo {
                let index = ix * side + iz;
                if (tile.flow[index] as f64) < spec.channel_area
                    || (tile.filled[index] as f64) <= sea
                    || level[index] <= sea
                {
                    continue;
                }
                let recv = tile.receiver[index] as usize;
                if recv == index || kept(index) || kept(recv) {
                    continue;
                }
                let (ax, az) = position(index);
                let (bx, bz) = position(recv);
                let profile_a = profile_at(tile.flow[index] as f64, ax, az);
                let profile_b = profile_at(tile.flow[recv] as f64, bx, bz);
                let (ax, az) = meander(ax, az, profile_a.half_width);
                let (bx, bz) = meander(bx, bz, profile_b.half_width);
                lines.push((
                    vec![
                        (ax, az, level[index].floor()),
                        (bx, bz, level[recv].floor()),
                    ],
                    vec![profile_a, profile_b],
                ));
            }
        }
        ChannelField::from_polylines(&lines, self.channel_margin())
    }

    /// Whole-basin dispute verdicts. A lake straddling a tile seam is
    /// contested when any covering neighbor solved the same ground
    /// without that lake (its window drained the pit through a
    /// truncated watershed) or with a materially different level. There
    /// is no authority to arbitrate — each window is honest about the
    /// geography it saw — and any water placed on one side of the seam
    /// spills forever against the other side's belief, so the entire
    /// basin stays dry on both sides: both tiles see the same
    /// disagreement and reach the same verdict.
    fn lake_verdicts(&self, tile: &GeoTile) -> Vec<bool> {
        let side = tile.side;
        let count = side * side;
        let cell = self.spec.cell as f64;
        let mut keep = vec![true; count];

        // Connected lake basins (4-neighborhood flood label).
        let mut basin = vec![u32::MAX; count];
        let mut basins: Vec<Vec<usize>> = Vec::new();
        for start in 0..count {
            if !tile.lake[start] || basin[start] != u32::MAX {
                continue;
            }
            let id = basins.len() as u32;
            let mut cells = Vec::new();
            let mut stack = vec![start];
            basin[start] = id;
            while let Some(index) = stack.pop() {
                cells.push(index);
                let ix = index / side;
                let iz = index % side;
                let mut push = |n: usize| {
                    if tile.lake[n] && basin[n] == u32::MAX {
                        basin[n] = id;
                        stack.push(n);
                    }
                };
                if ix > 0 {
                    push(index - side);
                }
                if ix + 1 < side {
                    push(index + side);
                }
                if iz > 0 {
                    push(index - 1);
                }
                if iz + 1 < side {
                    push(index + 1);
                }
            }
            basins.push(cells);
        }
        if basins.is_empty() {
            return keep;
        }

        // The neighboring solutions whose extents can overlap this tile.
        let stride = self.spec.tile as i64;
        let tile_x = (tile.origin_x as i64 + (self.spec.halo_cells * self.spec.cell) as i64)
            .div_euclid(stride);
        let tile_z = (tile.origin_z as i64 + (self.spec.halo_cells * self.spec.cell) as i64)
            .div_euclid(stride);
        let mut neighbors: Vec<Arc<GeoTile>> = Vec::new();
        for dtx in -1..=1i64 {
            for dtz in -1..=1i64 {
                if dtx == 0 && dtz == 0 {
                    continue;
                }
                neighbors.push(self.tile(tile_x + dtx, tile_z + dtz));
            }
        }

        for cells in &basins {
            let mut disputed = false;
            'scan: for &index in cells {
                let (x, z) = (
                    tile.origin_x as f64 + ((index / side) as f64 + 0.5) * cell,
                    tile.origin_z as f64 + ((index % side) as f64 + 0.5) * cell,
                );
                let own = tile.filled[index] as f64;
                for neighbor in &neighbors {
                    let Some(slot) = neighbor.slot_at(cell, x, z) else {
                        continue;
                    };
                    let agrees = neighbor.lake[slot]
                        && (neighbor.filled[slot] as f64 - own).abs() <= 1.0;
                    if !agrees {
                        disputed = true;
                        break 'scan;
                    }
                }
            }
            if disputed {
                for &index in cells {
                    keep[index] = false;
                }
            }
        }
        keep
    }

    // ------------------------------------------------------------------
    // Fused sampling
    // ------------------------------------------------------------------
}
