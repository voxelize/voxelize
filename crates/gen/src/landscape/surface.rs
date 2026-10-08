//! Surfacers: paint after shape.
//!
//! A [`Surfacer`] is one of the five plugin kinds (the other four arrive
//! with the planner in P2b). It runs once per column after composition,
//! reading the column's final facts through a [`PaintColumn`] and writing
//! [`MaterialRuns`]: the column is filled with the spec's `fill` role up to
//! its top, and surfacers override runs near the top, in `spec.paint`
//! order (a later surfacer wins where two overlap). Blocks enter only as
//! resolved roles.
//!
//! Built-in surfacers live in `library/` (`surface_rules`, `ecotones`,
//! `zones`); games register their own exactly as the built-ins do, through
//! [`super::registry::KindRegistry`].

use std::collections::BTreeMap;

use serde::{de::DeserializeOwned, Serialize};
use smallvec::SmallVec;

use crate::climate::BiomeId;
use crate::stream::{mix64, stream_seed_bytes, Subsystem};

use super::fields::eval::NoiseKernel;
use super::fields::SaltClaims;
use super::spec::{Size, SpecError, Validate, WorldFrame};
use super::water::WaterColumn;

/// A zone key: built-in keys registered by the kinds that write them, and
/// game keys declared in `spec.zones`. `ZoneKey::NONE` is "no zone".
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ZoneKey(pub u16);

impl ZoneKey {
    /// No zone.
    pub const NONE: Self = Self(0);
}

/// The built-in zone keys, in id order from 1.
pub const BUILTIN_ZONES: &[&str] = &[
    "cliff",
    "talus",
    "wash",
    "bench",
    "floor",
    "beach",
    "wall",
    "crest",
    "apron",
    "dune",
    "flat",
    "ash",
    "glass",
    "cave.upper",
    "cave.mid",
    "cave.deep",
];

/// The zone key table: built-ins from 1, then declared game keys in sorted
/// order.
#[derive(Clone, Debug, Default)]
pub struct ZoneTable {
    keys: Vec<String>,
}

impl ZoneTable {
    /// Built-ins plus `declared` (sorted keys).
    pub fn new<'a>(declared: impl Iterator<Item = &'a String>) -> Result<Self, SpecError> {
        let mut keys: Vec<String> = BUILTIN_ZONES.iter().map(|s| s.to_string()).collect();
        for k in declared {
            if keys.contains(k) {
                return Err(SpecError::new(
                    format!("zones.{k}"),
                    "a declared zone key repeats a built-in one",
                ));
            }
            keys.push(k.clone());
        }
        Ok(Self { keys })
    }

    /// The key named `key`.
    pub fn get(&self, key: &str) -> Option<ZoneKey> {
        self.keys
            .iter()
            .position(|k| k == key)
            .map(|i| ZoneKey(i as u16 + 1))
    }

    /// The name of `key`.
    pub fn name(&self, key: ZoneKey) -> Option<&str> {
        if key == ZoneKey::NONE {
            return None;
        }
        self.keys.get(key.0 as usize - 1).map(|s| s.as_str())
    }
}

/// A handle to a kept field, readable from a [`PaintColumn`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct KeptRef(pub u16);

/// One column's final facts, as a surfacer reads them.
#[derive(Clone, Copy, Debug)]
pub struct PaintColumn<'a> {
    /// World x.
    pub x: i32,
    /// World z.
    pub z: i32,
    /// The solid top of the heightfield.
    pub top: i32,
    /// Continuous final ground.
    pub ground: f64,
    /// L2 slope of final ground.
    pub slope: f64,
    /// Unit downhill vector, `[0, 0]` on flats.
    pub aspect: [f64; 2],
    /// Laplacian of final ground.
    pub curvature: f64,
    /// Temperature after the lapse.
    pub temperature: f64,
    /// Moisture.
    pub moisture: f64,
    /// The column's (dithered) biome.
    pub biome: BiomeId,
    /// The column's zone.
    pub zone: ZoneKey,
    /// Resolved water layers.
    pub water: &'a WaterColumn,
    /// The world frame.
    pub frame: &'a WorldFrame,
    /// This column's kept field values.
    pub kept: &'a [f32],
}

impl PaintColumn<'_> {
    /// A kept field's value here.
    pub fn field(&self, f: KeptRef) -> f64 {
        self.kept[f.0 as usize] as f64
    }

    /// Whether the column's top lies under water.
    pub fn under_water(&self) -> bool {
        !self.water.is_dry()
    }

    /// Water depth over the top (0 when dry).
    pub fn water_depth(&self) -> i32 {
        self.water.top().map_or(0, |l| l.level - self.top)
    }

    /// A uniform hash in `[0, 1)` of this column and `y` under `seed`.
    pub fn hash(&self, seed: u64, y: i32) -> f64 {
        let h = mix64(
            seed ^ mix64(
                (self.x as i64 as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15)
                    ^ (self.z as i64 as u64).wrapping_mul(0xC2B2_AE3D_27D4_EB4F)
                    ^ (y as i64 as u64).wrapping_mul(0x1656_67B1_9E37_79F9),
            ),
        );
        (h >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// A column's materials: `fill` up to `top`, then overrides in order.
#[derive(Clone, Debug)]
pub struct MaterialRuns {
    top: i32,
    fill: u32,
    overrides: SmallVec<[(i32, i32, u32); 8]>,
}

impl MaterialRuns {
    /// A column filled with `fill` from 0 to `top`.
    pub fn new(top: i32, fill: u32) -> Self {
        Self {
            top,
            fill,
            overrides: SmallVec::new(),
        }
    }

    /// The solid top.
    pub fn top(&self) -> i32 {
        self.top
    }

    /// The fill block.
    pub fn fill(&self) -> u32 {
        self.fill
    }

    /// Set `[lo, hi]` (clamped to `[0, top]`) to `block`.
    pub fn set(&mut self, lo: i32, hi: i32, block: u32) {
        let lo = Ord::max(lo, 0);
        let hi = Ord::min(hi, self.top);
        if lo <= hi {
            self.overrides.push((lo, hi, block));
        }
    }

    /// Set depths `[d0, d1]` below the top (depth 0 is the top voxel).
    pub fn set_depth(&mut self, d0: i32, d1: i32, block: u32) {
        self.set(self.top - d1, self.top - d0, block);
    }

    /// The block at `y` so far.
    pub fn at(&self, y: i32) -> u32 {
        if y < 0 || y > self.top {
            return 0;
        }
        for &(lo, hi, b) in self.overrides.iter().rev() {
            if y >= lo && y <= hi {
                return b;
            }
        }
        self.fill
    }

    /// Overrides in the order applied.
    pub fn overrides(&self) -> &[(i32, i32, u32)] {
        &self.overrides
    }
}

/// A small 2D patch field a surfacer samples (normalized fbm, practical
/// range ±1).
#[derive(Clone, Debug)]
pub struct PatchNoise {
    kernel: NoiseKernel,
}

impl PatchNoise {
    /// The patch value at a column centre.
    pub fn at(&self, x: i32, z: i32) -> f64 {
        self.kernel.sample(x as f64 + 0.5, z as f64 + 0.5)
    }
}

/// What a surfacer may acquire while it is built. Every acquisition is
/// checked here, with the spec path of the surfacer, so a typo fails at
/// compile, never in a hot loop.
pub struct PaintCtx<'a> {
    pub(crate) path: String,
    pub(crate) frame: &'a WorldFrame,
    pub(crate) world_seed: u32,
    pub(crate) dimension: &'a str,
    pub(crate) roles: &'a BTreeMap<String, Option<u32>>,
    pub(crate) zones: &'a ZoneTable,
    pub(crate) kept: &'a [String],
    pub(crate) biomes: &'a [String],
    pub(crate) salts: &'a mut SaltClaims,
    pub(crate) roles_used: Vec<String>,
}

impl PaintCtx<'_> {
    /// The world frame.
    pub fn frame(&self) -> &WorldFrame {
        self.frame
    }

    /// The spec path of this surfacer (for errors).
    pub fn path(&self) -> &str {
        &self.path
    }

    /// A declared role's block, or `None` for an optional role left
    /// unbound (skip what uses it).
    pub fn role(&mut self, field: &str, role: &str) -> Result<Option<u32>, SpecError> {
        match self.roles.get(role) {
            Some(b) => {
                self.roles_used.push(role.to_string());
                Ok(*b)
            }
            None => Err(SpecError::new(
                format!("{}.{field}", self.path),
                format!("undeclared role {role:?}"),
            )),
        }
    }

    /// A role that must resolve to a block.
    pub fn required_role(&mut self, field: &str, role: &str) -> Result<u32, SpecError> {
        self.role(field, role)?.ok_or_else(|| {
            SpecError::new(
                format!("{}.{field}", self.path),
                format!("optional role {role:?} is unbound but required here"),
            )
        })
    }

    /// A built-in or declared zone key.
    pub fn zone(&self, field: &str, key: &str) -> Result<ZoneKey, SpecError> {
        self.zones.get(key).ok_or_else(|| {
            SpecError::new(
                format!("{}.{field}", self.path),
                format!("unknown zone key {key:?}"),
            )
        })
    }

    /// A kept field (declared with `keep: true`).
    pub fn field(&self, at: &str, name: &str) -> Result<KeptRef, SpecError> {
        self.kept
            .iter()
            .position(|k| k == name)
            .map(|i| KeptRef(i as u16))
            .ok_or_else(|| {
                SpecError::new(
                    format!("{}.{at}", self.path),
                    format!("field {name:?} is not declared with keep: true"),
                )
            })
    }

    /// A biome by key.
    pub fn biome(&self, at: &str, key: &str) -> Result<BiomeId, SpecError> {
        self.biomes
            .iter()
            .position(|k| k == key)
            .map(|i| BiomeId(i as u16))
            .ok_or_else(|| {
                SpecError::new(
                    format!("{}.{at}", self.path),
                    format!("unknown biome {key:?}"),
                )
            })
    }

    /// Every biome key, in id order.
    pub fn biome_keys(&self) -> &[String] {
        self.biomes
    }

    /// A patch field: normalized fbm, its salt claimed world-wide.
    pub fn patch(
        &mut self,
        at: &str,
        salt: &str,
        wavelength: Size,
        octaves: u8,
    ) -> Result<PatchNoise, SpecError> {
        let owner = format!("{}.{at}", self.path);
        let key = format!(
            "patch:{}:{octaves}",
            super::canon::to_canonical(&wavelength).unwrap()
        );
        self.salts.claim(salt, &owner, &key)?;
        if !(1..=8).contains(&octaves) || !(wavelength.raw() > 0.0) {
            return Err(SpecError::new(
                owner,
                "a patch needs 1..=8 octaves and a positive wavelength",
            ));
        }
        let seed = stream_seed_bytes(
            self.world_seed,
            self.dimension,
            Subsystem::Fields,
            salt.as_bytes(),
            0,
        );
        Ok(PatchNoise {
            kernel: NoiseKernel::new(
                seed,
                1.0 / self.frame.span(wavelength),
                octaves,
                0.5,
                2.0,
                1.0,
            ),
        })
    }

    /// A seed for this surfacer's hash rolls, from a claimed salt.
    pub fn hash_seed(&mut self, at: &str, salt: &str) -> Result<u64, SpecError> {
        let owner = format!("{}.{at}", self.path);
        self.salts.claim(salt, &owner, "hash")?;
        Ok(stream_seed_bytes(
            self.world_seed,
            self.dimension,
            Subsystem::Fields,
            salt.as_bytes(),
            0,
        ))
    }
}

/// A surfacer: paints every column after composition.
pub trait Surfacer: Sized + Send + Sync + 'static {
    /// Registry key.
    const KIND: &'static str;
    /// Bumped whenever the surfacer's output changes (part of identity).
    const VERSION: u32;
    /// Typed params: no struct-level default, `Option` for optional
    /// fields, unknown fields refused.
    type Params: DeserializeOwned + Serialize + Validate + Clone + Send + Sync;
    /// Acquire everything the surfacer reads.
    fn build(params: Self::Params, cx: &mut PaintCtx<'_>) -> Result<Self, SpecError>;
    /// Paint one column.
    fn paint(&self, col: &PaintColumn<'_>, runs: &mut MaterialRuns);
}

/// A surfacer behind a pointer.
pub trait DynSurfacer: Send + Sync {
    /// Paint one column.
    fn paint(&self, col: &PaintColumn<'_>, runs: &mut MaterialRuns);
}

impl<S: Surfacer> DynSurfacer for S {
    fn paint(&self, col: &PaintColumn<'_>, runs: &mut MaterialRuns) {
        Surfacer::paint(self, col, runs)
    }
}
