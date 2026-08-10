//! Tile solving: the plate-graph prior, priority-flood fill, receiver
//! forests, and the implicit stream-power erosion iteration. Everything
//! here is deterministic per tile and independent of query order.

use super::*;

impl GeoModel {
    pub fn compile(
        spec: &GeologySpec,
        world_seed: u32,
        dimension: &str,
        extra_reach: f64,
    ) -> Result<Self, String> {
        if spec.cell < 2 || spec.cell > 16 {
            return Err(format!("geology.cell must be 2..=16, got {}", spec.cell));
        }
        if spec.tile < 256 || spec.tile % spec.cell != 0 {
            return Err(format!(
                "geology.tile must be >= 256 and divisible by cell, got {}",
                spec.tile
            ));
        }
        if spec.halo_cells < 16 {
            return Err(format!(
                "geology.halo_cells must be >= 16, got {}",
                spec.halo_cells
            ));
        }
        if !(0.0..=1.0).contains(&spec.continental_share) {
            return Err("geology.continental_share must be within 0..=1".to_string());
        }
        if spec.iterations == 0 || spec.fill_every == 0 {
            return Err("geology.iterations and fill_every must be > 0".to_string());
        }
        if spec.erode_k < 0.0 {
            return Err("geology.erode_k must be >= 0".to_string());
        }
        // The stream-power exponent evaluates through an exact sqrt chain
        // (bit-stable across platforms, unlike powf): quarter multiples only.
        let quarters = spec.erode_m * 4.0;
        if !(1.0..=8.0).contains(&quarters) || quarters.fract() != 0.0 {
            return Err(format!(
                "geology.erode_m must be a multiple of 0.25 in 0.25..=2.0, got {}",
                spec.erode_m
            ));
        }
        if spec.channel_area < 4.0 || spec.channel_area_full <= spec.channel_area {
            return Err("geology channel areas must satisfy 4 <= area < area_full".to_string());
        }
        if spec.river_width.0 <= 0.0 || spec.river_width.1 < spec.river_width.0 {
            return Err(format!("geology river_width span invalid: {:?}", spec.river_width));
        }
        let relief = &spec.relief;
        if relief.rib_amp < 0.0
            || relief.bench_amp < 0.0
            || (relief.rib_amp > 0.0 && relief.rib_scale < 2.0)
            || (relief.bench_amp > 0.0 && relief.bench_spacing < 2.0)
        {
            return Err("geology.relief: amplitudes must be >= 0 and scales >= 2".to_string());
        }
        if !(0.0..=0.45).contains(&relief.bench_tread) {
            return Err("geology.relief.bench_tread must be within 0..=0.45".to_string());
        }
        if relief.rib_stretch < 1.0 {
            return Err("geology.relief.rib_stretch must be >= 1".to_string());
        }
        if spec.meander_amp < 0.0 || (spec.meander_amp > 0.0 && spec.meander_scale < 8.0) {
            return Err("geology meander: amp must be >= 0 and scale >= 8".to_string());
        }
        if !(0.0..=0.5).contains(&spec.riffle_amp)
            || (spec.riffle_amp > 0.0 && spec.riffle_scale < 8.0)
        {
            return Err("geology riffle: amp must be 0..=0.5 and scale >= 8".to_string());
        }
        if spec.detail_floor < 0.0 || spec.detail_floor > 1.0 {
            return Err("geology.detail_floor must be within 0..=1".to_string());
        }
        let moisture = &spec.moisture;
        if moisture.reach <= 0.0 || moisture.flow_half <= 0.0 || moisture.dry_height <= 0.0 {
            return Err("geology.moisture: reach, flow_half, dry_height must be > 0".to_string());
        }
        let seed = stream_seed(world_seed, dimension, Subsystem::Fields, &spec.salt, 0);
        Ok(Self {
            spec: spec.clone(),
            plate_seed: mix64(seed ^ 0x706c_6174),
            swell_seed: mix64(seed ^ 0x7377_656c),
            detail_seed: mix64(seed ^ 0x6465_7461),
            relief_seed: mix64(seed ^ 0x7265_6c66),
            segment_seed: mix64(seed ^ 0x7365_676d),
            rib_seed: mix64(seed ^ 0x7269_6273),
            bench_seed: mix64(seed ^ 0x626e_6368),
            meander_seed: mix64(seed ^ 0x6d64_7273),
            extra_reach,
            tiles: RwLock::new(HashMap::new()),
            hydro: RwLock::new(HashMap::new()),
        })
    }

    pub fn spec(&self) -> &GeologySpec {
        &self.spec
    }

    // ------------------------------------------------------------------
    // Plate graph (analytic, shared identically by every tile)
    // ------------------------------------------------------------------

    fn plate_site(&self, lattice_x: i64, lattice_z: i64) -> PlateSite {
        let id = mix64(self.plate_seed ^ mix64(cell_id(lattice_x, lattice_z)));
        let jx = hash_unit(id) - 0.5;
        let jz = hash_unit(mix64(id ^ 0x1)) - 0.5;
        let mx = hash_unit(mix64(id ^ 0x2)) - 0.5;
        let mz = hash_unit(mix64(id ^ 0x3)) - 0.5;
        let norm = (mx * mx + mz * mz).sqrt().max(1e-9);
        PlateSite {
            x: (lattice_x as f64 + 0.5 + jx * 2.0 * self.spec.plate_jitter) * self.spec.plate_cell,
            z: (lattice_z as f64 + 0.5 + jz * 2.0 * self.spec.plate_jitter) * self.spec.plate_cell,
            vx: mx / norm,
            vz: mz / norm,
            is_continental: hash_unit(mix64(id ^ 0x4)) < self.spec.continental_share,
        }
    }

    /// The two nearest plate sites: the owner and the neighbor across
    /// the closest boundary.
    fn nearest_plates(&self, x: f64, z: f64) -> (PlateSite, f64, PlateSite, f64) {
        let cell = self.spec.plate_cell;
        let cx = (x / cell).floor() as i64;
        let cz = (z / cell).floor() as i64;
        let mut best: Option<(PlateSite, f64)> = None;
        let mut second: Option<(PlateSite, f64)> = None;
        for dx in -2..=2 {
            for dz in -2..=2 {
                let site = self.plate_site(cx + dx, cz + dz);
                let d = ((site.x - x) * (site.x - x) + (site.z - z) * (site.z - z)).sqrt();
                if best.map(|(_, bd)| d < bd).unwrap_or(true) {
                    second = best;
                    best = Some((site, d));
                } else if second.map(|(_, sd)| d < sd).unwrap_or(true) {
                    second = Some((site, d));
                }
            }
        }
        let (a, da) = best.expect("plate neighborhood nonempty");
        let (b, db) = second.expect("plate neighborhood has a second site");
        (a, da, b, db)
    }

    /// Uplift prior, boundary class, and solve-time uplift rate at one
    /// point: the authored macro-composition every tile agrees on.
    pub fn prior(&self, x: f64, z: f64) -> PriorSample {
        let spec = &self.spec;
        let sea = spec.sea_level as f64;
        // The plate graph is queried through a domain warp: boundaries
        // bend into arcs, margins roughen, and island chains curve.
        let wx = x + self.value_fbm(mix64(self.plate_seed ^ 0x77), x, z, spec.plate_warp_scale, 3)
            * spec.plate_warp_amp;
        let wz = z + self.value_fbm(mix64(self.plate_seed ^ 0x78), x, z, spec.plate_warp_scale, 3)
            * spec.plate_warp_amp;
        let (own, d_own, other, d_other) = self.nearest_plates(wx, wz);

        // Continentality: land core inside continental plates, ramping
        // to abyssal across mixed boundaries over the margin width.
        let margin = d_other - d_own;
        let same_kind = own.is_continental == other.is_continental;
        let land_t = if same_kind {
            if own.is_continental {
                1.0
            } else {
                0.0
            }
        } else {
            let t = (margin / spec.margin_width).clamp(0.0, 1.0);
            if own.is_continental {
                t
            } else {
                1.0 - t
            }
        };
        let smooth = land_t * land_t * (3.0 - 2.0 * land_t);
        let mut height = sea + (-spec.base_ocean) + (spec.base_land + spec.base_ocean) * smooth;

        // Craton swells and province plateaus: inherited interior relief.
        height += self.value_fbm(self.swell_seed, x, z, spec.swell_scale, spec.swell_octaves)
            * spec.swell_amp
            * smooth;
        if spec.plateau_amp > 0.0 {
            let province =
                self.value_fbm(mix64(self.swell_seed ^ 0x70), x, z, spec.plateau_scale, 2);
            height += (province * spec.plateau_amp).max(0.0) * smooth;
        }

        // Boundary ribbon. n points from the owner's site toward the
        // neighbor's; approach > 0 means the plates close on each other.
        let boundary_dist = (margin * 0.5).max(0.0);
        let nx = other.x - own.x;
        let nz = other.z - own.z;
        let n_norm = (nx * nx + nz * nz).sqrt().max(1e-9);
        let nxu = nx / n_norm;
        let nzu = nz / n_norm;
        let approach = (own.vx - other.vx) * nxu + (own.vz - other.vz) * nzu;

        // Along-boundary coordinate for segmentation, in warped space so
        // massifs follow the bent spine.
        let along = wx * (-nzu) + wz * nxu;

        let mut class = BoundaryClass::Interior;
        let mut uplift_rate = 0.0;
        if approach > spec.convergence_floor {
            let strength = ((approach - spec.convergence_floor) / spec.belt_strength_span)
                .clamp(0.0, 1.0);
            let (belt, offset, is_trench_side) = match (own.is_continental, other.is_continental)
            {
                (true, true) => (&spec.belt_collision, 0.0, false),
                (true, false) => (&spec.belt_arc, spec.arc_inland_offset, false),
                (false, true) => (&spec.belt_arc, 0.0, true),
                (false, false) => (&spec.belt_island_arc, spec.island_arc_offset, false),
            };
            if is_trench_side {
                let trench = ridge_profile(boundary_dist, spec.trench_width);
                if trench > 0.02 {
                    class = BoundaryClass::Trench;
                    height -= spec.trench_depth * trench * strength;
                }
            } else {
                // The ribbon spine sits `offset` blocks behind the
                // boundary: collision sutures carry their chains, arcs
                // rise inland of their trench on full crust. The crest
                // ribbon rides on a broader, lower orogenic root — the
                // foothill apron a bare ribbon lacks.
                let spine_dist = (boundary_dist - offset).abs();
                let crest = ridge_profile(spine_dist, belt.width);
                let root = ridge_profile(spine_dist, belt.width * belt.root_width_factor);
                if crest > 0.02 || root > 0.02 {
                    let seg = self.segment_gate(along, belt.segment_scale, belt.segment_depth);
                    class = match (own.is_continental, other.is_continental) {
                        (true, true) => BoundaryClass::Collision,
                        (false, false) => BoundaryClass::IslandArc,
                        _ => BoundaryClass::VolcanicArc,
                    };
                    let lift = crest * seg + root * belt.root_share;
                    height += belt.height * lift * strength;
                    uplift_rate = spec.uplift_rate * belt.uplift * crest * seg * strength;
                }
            }
        } else if approach < -spec.convergence_floor && same_kind && own.is_continental {
            let rift = ridge_profile(boundary_dist, spec.rift_width);
            if rift > 0.02 {
                class = BoundaryClass::Rift;
                let strength = ((-approach - spec.convergence_floor) / spec.belt_strength_span)
                    .clamp(0.0, 1.0);
                height -= spec.rift_depth * rift * strength;
            }
        } else if approach.abs() <= spec.convergence_floor
            && boundary_dist < spec.margin_width * 0.25
        {
            class = BoundaryClass::Transform;
        }

        PriorSample {
            height,
            class,
            uplift_rate,
        }
    }

    /// Segmentation gate along a belt spine: 1 at massifs, dipping
    /// toward passes.
    fn segment_gate(&self, along: f64, scale: f64, depth: f64) -> f64 {
        if scale <= 1.0 || depth <= 0.0 {
            return 1.0;
        }
        let coarse = self.value_noise_1d(self.segment_seed, along / scale);
        let fine = self.value_noise_1d(mix64(self.segment_seed ^ 0x9), along / (scale * 0.37));
        let wave = (coarse * 0.7 + fine * 0.3).clamp(0.0, 1.0);
        1.0 - depth * (1.0 - wave)
    }

    fn value_noise_1d(&self, seed: u64, t: f64) -> f64 {
        let i = t.floor() as i64;
        let f = t - t.floor();
        let a = hash_unit(mix64(seed ^ mix64(i as u64)));
        let b = hash_unit(mix64(seed ^ mix64((i + 1) as u64)));
        let s = f * f * (3.0 - 2.0 * f);
        a + (b - a) * s
    }

    pub(super) fn value_noise_2d(&self, seed: u64, x: f64, z: f64) -> f64 {
        let ixf = x.floor();
        let izf = z.floor();
        let fx = x - ixf;
        let fz = z - izf;
        let ix = ixf as i64;
        let iz = izf as i64;
        let corner = |dx: i64, dz: i64| hash_unit(mix64(seed ^ mix64(cell_id(ix + dx, iz + dz))));
        let sx = fx * fx * (3.0 - 2.0 * fx);
        let sz = fz * fz * (3.0 - 2.0 * fz);
        let top = corner(0, 0) + (corner(1, 0) - corner(0, 0)) * sx;
        let bottom = corner(0, 1) + (corner(1, 1) - corner(0, 1)) * sx;
        top + (bottom - top) * sz
    }

    /// Lattice value fbm in -1..1, used only for priors and sub-cell
    /// texture — never for the macro form.
    pub(super) fn value_fbm(&self, seed: u64, x: f64, z: f64, scale: f64, octaves: u8) -> f64 {
        let mut amp = 1.0;
        let mut freq = 1.0 / scale.max(1.0);
        let mut sum = 0.0;
        let mut norm = 0.0;
        for octave in 0..octaves {
            let s = mix64(seed ^ (octave as u64 + 1).wrapping_mul(0x9e37_79b9_7f4a_7c15));
            sum += amp * (self.value_noise_2d(s, x * freq, z * freq) * 2.0 - 1.0);
            norm += amp;
            amp *= 0.5;
            freq *= 2.0;
        }
        sum / norm.max(1e-9)
    }

    // ------------------------------------------------------------------
    // Tile solve
    // ------------------------------------------------------------------

    /// Solve (or fetch) the tile whose interior starts at
    /// `(tile_x * tile, tile_z * tile)`.
    pub fn tile(&self, tile_x: i64, tile_z: i64) -> Arc<GeoTile> {
        if let Some(hit) = self.tiles.read().expect("geo tile cache").get(&(tile_x, tile_z)) {
            return Arc::clone(hit);
        }
        let solved = Arc::new(self.solve(tile_x, tile_z));
        let mut cache = self.tiles.write().expect("geo tile cache");
        if cache.len() >= TILE_CACHE_CAP {
            cache.clear();
        }
        cache.insert((tile_x, tile_z), Arc::clone(&solved));
        solved
    }

    fn solve(&self, tile_x: i64, tile_z: i64) -> GeoTile {
        let spec = &self.spec;
        let cell = spec.cell as f64;
        let interior = (spec.tile / spec.cell) as i32;
        let halo = spec.halo_cells;
        let side = (interior + 2 * halo) as usize;
        let origin_x = (tile_x * spec.tile as i64 - (halo * spec.cell) as i64) as i32;
        let origin_z = (tile_z * spec.tile as i64 - (halo * spec.cell) as i64) as i32;
        let sea = spec.sea_level as f64;
        let count = side * side;

        // Init from the shared analytic prior plus tie-break relief.
        let mut height = vec![0.0f64; count];
        let mut uplift = vec![0.0f64; count];
        for ix in 0..side {
            for iz in 0..side {
                let x = origin_x as f64 + (ix as f64 + 0.5) * cell;
                let z = origin_z as f64 + (iz as f64 + 0.5) * cell;
                let prior = self.prior(x, z);
                let relief = self.value_fbm(self.relief_seed, x, z, cell * 6.0, 2);
                height[ix * side + iz] = prior.height + relief * spec.seed_relief;
                // Interiors keep a gentle uplift so dissection reaches a
                // rolling steady state instead of eroding to a plain.
                let land = ((prior.height - sea) / spec.base_land.max(1.0)).clamp(0.0, 1.0);
                uplift[ix * side + iz] =
                    prior.uplift_rate.max(spec.interior_uplift * land);
            }
        }

        let mut filled = vec![0.0f64; count];
        let mut receiver = vec![u32::MAX; count];
        let mut order: Vec<u32> = (0..count as u32).collect();
        let mut flow = vec![1.0f64; count];
        let mut lake = vec![false; count];

        let iterations = spec.iterations;
        for iteration in 0..iterations {
            // Receivers, drainage order, and flow accumulation only move
            // when the fill moves; between fills they are constants of
            // the receiver forest.
            if iteration % spec.fill_every == 0 {
                self.priority_flood(&height, &mut filled, &mut lake, side, sea);
                self.receivers(&filled, &mut receiver, side);
                order.sort_unstable_by(|a, b| {
                    filled[*b as usize]
                        .partial_cmp(&filled[*a as usize])
                        .unwrap_or(std::cmp::Ordering::Equal)
                        .then(a.cmp(b))
                });
                for f in flow.iter_mut() {
                    *f = 1.0;
                }
                for &index in &order {
                    let index = index as usize;
                    let recv = receiver[index] as usize;
                    if recv != index {
                        flow[recv] += flow[index];
                    }
                }
            }

            // Continued uplift, then implicit stream-power incision
            // (Braun–Willett): receivers are already final for this
            // fill, so walking cells from low to high solves
            //   h' = (h + f * h'_recv) / (1 + f),  f = K A^m dt / dx
            // exactly in one pass — unconditionally stable, so dt can be
            // geological and dissection reaches steady state in a
            // handful of iterations.
            for index in 0..count {
                height[index] += uplift[index] * spec.dt;
            }
            let k_dt = spec.erode_k * spec.dt;
            let quarters = (spec.erode_m * 4.0) as i32;
            for &index in order.iter().rev() {
                let index = index as usize;
                let recv = receiver[index] as usize;
                if recv == index || height[index] <= sea {
                    continue;
                }
                let dist = cell_distance(index, recv, side) * cell;
                let f = k_dt * quarter_power(flow[index], quarters) / dist;
                height[index] = (height[index] + f * height[recv]) / (1.0 + f);
            }

            // Hillslope diffusion (4-neighbor explicit step). Above the
            // snowline frost shattering rules, so creep drops to the
            // authored share and arêtes keep their serration.
            if spec.diffusion > 0.0 {
                let d_dt = spec.diffusion * spec.dt;
                let snapshot = height.clone();
                for ix in 1..side - 1 {
                    for iz in 1..side - 1 {
                        let index = ix * side + iz;
                        let lap = snapshot[index - side] + snapshot[index + side]
                            + snapshot[index - 1]
                            + snapshot[index + 1]
                            - 4.0 * snapshot[index];
                        let share = if snapshot[index] >= spec.snowline {
                            spec.high_diffusion_share
                        } else {
                            1.0
                        };
                        height[index] += d_dt * lap * share;
                    }
                }
            }

            // Talus relaxation: shed material down slopes beyond repose.
            if spec.talus > 0.0 {
                let limit = spec.talus;
                for ix in 1..side - 1 {
                    for iz in 1..side - 1 {
                        let index = ix * side + iz;
                        let mut lowest = index;
                        let mut lowest_h = height[index];
                        for (dx, dz, _) in NEIGHBORS8 {
                            let n = ((ix as i32 + dx) as usize) * side + (iz as i32 + dz) as usize;
                            if height[n] < lowest_h {
                                lowest_h = height[n];
                                lowest = n;
                            }
                        }
                        let drop = height[index] - lowest_h;
                        if lowest != index && drop > limit {
                            let shed = (drop - limit) * 0.5;
                            height[index] -= shed;
                            height[lowest] += shed;
                        }
                    }
                }
            }
        }

        // Glacial tail: widen hollows above the snowline into bowls while
        // leaving crests sharp (positive-curvature-weighted smoothing).
        for _ in 0..spec.glacial_iterations {
            let snapshot = height.clone();
            for ix in 1..side - 1 {
                for iz in 1..side - 1 {
                    let index = ix * side + iz;
                    if snapshot[index] < spec.snowline {
                        continue;
                    }
                    let mean = (snapshot[index - side]
                        + snapshot[index + side]
                        + snapshot[index - 1]
                        + snapshot[index + 1])
                        * 0.25;
                    if mean > snapshot[index] {
                        // A hollow: pull the floor up-and-outward toward
                        // the bowl profile.
                        height[index] += (mean - snapshot[index]) * spec.glacial_strength;
                    }
                }
            }
        }

        // Despike: a single-cell tower upsamples into a floating-looking
        // rock needle. A cell may stand at most `talus` above its
        // highest neighbor; ridge cells keep their crests because a
        // ridge always has two high neighbors along the divide.
        for _ in 0..2 {
            let snapshot = height.clone();
            for ix in 1..side - 1 {
                for iz in 1..side - 1 {
                    let index = ix * side + iz;
                    let mut highest = f64::MIN;
                    for (dx, dz, _) in NEIGHBORS8 {
                        let n = ((ix as i32 + dx) as usize) * side + (iz as i32 + dz) as usize;
                        highest = highest.max(snapshot[n]);
                    }
                    if snapshot[index] > highest + spec.talus {
                        height[index] = highest + spec.talus;
                    }
                }
            }
        }

        // Final hydrology fields for sampling and channel extraction.
        self.priority_flood(&height, &mut filled, &mut lake, side, sea);
        self.receivers(&filled, &mut receiver, side);
        order.sort_unstable_by(|a, b| {
            filled[*b as usize]
                .partial_cmp(&filled[*a as usize])
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.cmp(b))
        });
        for f in flow.iter_mut() {
            *f = 1.0;
        }
        for &index in &order {
            let index = index as usize;
            let recv = receiver[index] as usize;
            if recv != index {
                flow[recv] += flow[index];
            }
        }

        GeoTile {
            origin_x,
            origin_z,
            side,
            height: height.iter().map(|h| *h as f32).collect(),
            filled: filled.iter().map(|f| *f as f32).collect(),
            flow: flow.iter().map(|f| *f as f32).collect(),
            lake,
            receiver,
        }
    }

    /// Priority-flood pit fill: `filled` becomes the hydraulically
    /// corrected surface (every cell drains to an edge or the sea), and
    /// `lake` marks cells raised above their true height.
    fn priority_flood(
        &self,
        height: &[f64],
        filled: &mut [f64],
        lake: &mut [bool],
        side: usize,
        sea: f64,
    ) {
        const EPSILON: f64 = 1e-4;
        let count = side * side;
        let mut is_open = vec![false; count];
        let mut heap = BinaryHeap::new();
        for index in 0..count {
            filled[index] = height[index];
            let ix = index / side;
            let iz = index % side;
            let is_edge = ix == 0 || iz == 0 || ix == side - 1 || iz == side - 1;
            if is_edge || height[index] <= sea {
                is_open[index] = true;
                heap.push(FloodEntry {
                    level: height[index],
                    index,
                });
            }
        }
        while let Some(FloodEntry { level, index }) = heap.pop() {
            if filled[index] < level {
                continue;
            }
            let ix = (index / side) as i32;
            let iz = (index % side) as i32;
            for (dx, dz, _) in NEIGHBORS8 {
                let nx = ix + dx;
                let nz = iz + dz;
                if nx < 0 || nz < 0 || nx as usize >= side || nz as usize >= side {
                    continue;
                }
                let n = nx as usize * side + nz as usize;
                if is_open[n] {
                    continue;
                }
                is_open[n] = true;
                let required = level + EPSILON;
                if height[n] < required {
                    filled[n] = required;
                } else {
                    filled[n] = height[n];
                }
                heap.push(FloodEntry {
                    level: filled[n],
                    index: n,
                });
            }
        }
        for index in 0..count {
            lake[index] = filled[index] > height[index] + self.spec.lake_min_depth
                && filled[index] > sea;
        }
    }

    /// Steepest-descent receivers over the filled surface. Cells with no
    /// lower neighbor (edges, sea floor) drain to themselves.
    pub(super) fn receivers(&self, filled: &[f64], receiver: &mut [u32], side: usize) {
        for ix in 0..side {
            for iz in 0..side {
                let index = ix * side + iz;
                let mut best = index;
                let mut best_slope = 0.0f64;
                for (dx, dz, dist) in NEIGHBORS8 {
                    let nx = ix as i32 + dx;
                    let nz = iz as i32 + dz;
                    if nx < 0 || nz < 0 || nx as usize >= side || nz as usize >= side {
                        continue;
                    }
                    let n = nx as usize * side + nz as usize;
                    let slope = (filled[index] - filled[n]) / dist;
                    if slope > best_slope {
                        best_slope = slope;
                        best = n;
                    }
                }
                receiver[index] = best as u32;
            }
        }
    }

}

/// `x^(quarters/4)` for nonnegative `x` through exact IEEE sqrt and
/// integer powers — the bit-stable stand-in for `powf`, which is free to
/// differ between platforms' libm implementations.
fn quarter_power(x: f64, quarters: i32) -> f64 {
    x.max(0.0).sqrt().sqrt().powi(quarters)
}
