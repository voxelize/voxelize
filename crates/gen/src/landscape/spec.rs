//! The landscape spec (format 2): what a world is, as data.
//!
//! [`LandscapeSpec`] is plain owned data: strings and `BTreeMap`s, never a
//! `&'static str`, so a spec can be authored in Rust (the presets), read
//! from JSON ([`read_spec`]), merge-patched ([`merge_patch`],
//! RFC 7396) and hot reloaded alike. Every struct, and every struct
//! variant of an enum, refuses unknown fields, and every optional field is
//! an explicit `Option`, so a typo (in a spec or in a merge patch) fails with
//! its path (`frame.sea: unknown variant ...`) instead of being ignored,
//! and an exported spec writes every field.
//!
//! Heights are [`Height`] values resolved against the world's
//! [`WorldFrame`]; horizontal sizes are [`Size`] values, where `Span`
//! follows the `scale` knob and `Blocks` never does (docs/landscape.md,
//! section 3.3).

use std::collections::BTreeMap;
use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::fields::FieldExpr;
use super::json::{self, JsonError};
use super::mirror::{BiomeSpecM, FloraSpecM};

/// The landscape spec format. v1's `GeneratorSpec` keeps format 1.
pub const LANDSCAPE_FORMAT: u32 = 2;

/// A spec, path-qualified validation or compile error.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpecError {
    /// Where in the spec, as a dotted path (`fields.ground.graph`); empty
    /// for the spec as a whole.
    pub path: String,
    /// What is wrong there.
    pub message: String,
}

impl SpecError {
    /// An error at `path`.
    pub fn new(path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            message: message.into(),
        }
    }
}

impl fmt::Display for SpecError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.path.is_empty() {
            write!(f, "{}", self.message)
        } else {
            write!(f, "{}: {}", self.path, self.message)
        }
    }
}

impl std::error::Error for SpecError {}

impl From<JsonError> for SpecError {
    fn from(e: JsonError) -> Self {
        Self {
            path: e.at,
            message: e.message,
        }
    }
}

impl From<SpecError> for crate::spec::GenError {
    fn from(e: SpecError) -> Self {
        crate::spec::GenError::Content {
            message: e.to_string(),
        }
    }
}

/// Collects path-qualified validation errors for typed params.
#[derive(Debug, Default)]
pub struct Validator {
    prefix: String,
    errors: Vec<SpecError>,
}

impl Validator {
    /// A validator whose paths start with `prefix` (`paint.0.params`).
    pub fn new(prefix: impl Into<String>) -> Self {
        Self {
            prefix: prefix.into(),
            errors: Vec::new(),
        }
    }

    fn at(&self, field: &str) -> String {
        match (self.prefix.is_empty(), field.is_empty()) {
            (true, _) => field.to_string(),
            (false, true) => self.prefix.clone(),
            (false, false) => format!("{}.{field}", self.prefix),
        }
    }

    /// Record an error at `field` unless `ok`.
    pub fn check(&mut self, field: &str, ok: bool, message: impl Into<String>) {
        if !ok {
            let path = self.at(field);
            self.errors.push(SpecError::new(path, message));
        }
    }

    /// `value` must be finite and within `range`.
    pub fn range(&mut self, field: &str, value: f64, range: std::ops::RangeInclusive<f64>) {
        let ok = value.is_finite() && range.contains(&value);
        self.check(
            field,
            ok,
            format!("{value} is outside {}..={}", range.start(), range.end()),
        );
    }

    /// `value` must lie in `0..=1`.
    pub fn unit(&mut self, field: &str, value: f64) {
        self.range(field, value, 0.0..=1.0);
    }

    /// `(lo, hi)` must be finite with `lo <= hi`.
    pub fn ordered(&mut self, field: &str, pair: (f64, f64)) {
        let ok = pair.0.is_finite() && pair.1.is_finite() && pair.0 <= pair.1;
        self.check(
            field,
            ok,
            format!("({}, {}) is not an ordered pair", pair.0, pair.1),
        );
    }

    /// `value` must be a `Size::Span` whose authored value lies in `range`.
    pub fn span(&mut self, field: &str, value: Size, range: std::ops::RangeInclusive<f64>) {
        match value {
            Size::Span(v) => self.range(field, v, range),
            Size::Blocks(_) => {
                self.check(field, false, "must be a Span (it follows the scale knob)")
            }
        }
    }

    /// `(lo, hi)` must be two `Size::Span`s in `range` with `lo <= hi`.
    pub fn ordered_span(
        &mut self,
        field: &str,
        pair: (Size, Size),
        range: std::ops::RangeInclusive<f64>,
    ) {
        self.span(&format!("{field}.0"), pair.0, range.clone());
        self.span(&format!("{field}.1"), pair.1, range);
        self.ordered(field, (pair.0.raw(), pair.1.raw()));
    }

    /// A size's authored value (validation runs before the frame scales
    /// spans, so comparisons between spans use authored values).
    pub fn size(&self, value: Size) -> f64 {
        value.raw()
    }

    /// Validate `inner` with paths under `field`.
    pub fn nested(&mut self, field: &str, inner: &impl Validate) {
        let mut sub = Validator::new(self.at(field));
        inner.validate(&mut sub);
        self.errors.append(&mut sub.errors);
    }

    /// The first error, if any.
    pub fn finish(self) -> Result<(), SpecError> {
        match self.errors.into_iter().next() {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }

    /// Every error recorded.
    pub fn errors(&self) -> &[SpecError] {
        &self.errors
    }
}

/// Typed params that check their own ranges, with path-qualified errors.
pub trait Validate {
    /// Record every problem in `v`.
    fn validate(&self, v: &mut Validator);
}

/// The content version of a preset: an owned mirror of v1's `Version`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContentVersion {
    /// Breaking content changes.
    pub major: u16,
    /// Additive content changes.
    pub minor: u16,
    /// Fixes.
    pub patch: u16,
}

impl ContentVersion {
    /// A version.
    pub const fn new(major: u16, minor: u16, patch: u16) -> Self {
        Self {
            major,
            minor,
            patch,
        }
    }
}

impl From<ContentVersion> for crate::spec::Version {
    fn from(v: ContentVersion) -> Self {
        crate::spec::Version::new(v.major, v.minor, v.patch)
    }
}

impl From<crate::spec::Version> for ContentVersion {
    fn from(v: crate::spec::Version) -> Self {
        Self::new(v.major, v.minor, v.patch)
    }
}

/// A height, resolved against the world frame.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub enum Height {
    /// An absolute y.
    Abs(f64),
    /// Blocks above (or below, if negative) sea level.
    AboveSea(f64),
    /// A share of the relief above sea, `(H - sea)`, scaled by the
    /// vertical relief factor `v(s) = min(1, sqrt(s))` of the scale knob.
    ShareOfRelief(f64),
    /// A share of the world height `H`.
    ShareOfWorld(f64),
}

/// The tallest world frame: facts store tops and sea bottoms as `i16`
/// (with `i16::MAX` reserved), so heights stay well inside it.
pub const MAX_FRAME_HEIGHT: u32 = 16384;

impl Height {
    /// The authored number, whatever it is relative to.
    pub fn raw(self) -> f64 {
        match self {
            Height::Abs(v)
            | Height::AboveSea(v)
            | Height::ShareOfRelief(v)
            | Height::ShareOfWorld(v) => v,
        }
    }
}

/// A horizontal size: `Span` follows the `scale` knob, `Blocks` never
/// scales (wear, grain, strata periods, soft-clamp widths, fades).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub enum Size {
    /// Landform-scale blocks at scale 1, multiplied by the scale knob.
    Span(f64),
    /// Block-scale blocks, never scaled.
    Blocks(f64),
}

impl Size {
    /// The authored value, before scaling.
    pub fn raw(self) -> f64 {
        match self {
            Size::Span(v) | Size::Blocks(v) => v,
        }
    }
}

/// The soft ceiling every final ground passes through last.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CeilingSpec {
    /// Ground below the knee is untouched.
    pub knee: Height,
    /// Ground above the knee approaches, and never reaches, the cap.
    pub cap: Height,
}

/// The world frame as authored.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FrameSpec {
    /// World height `H`; must equal `WorldConfig::max_height`.
    pub height: u32,
    /// Sea level: the y of the highest sea water voxel.
    pub sea: Height,
    /// The soft ceiling over final ground.
    pub ceiling: CeilingSpec,
    /// The floor: final ground never sinks below it (a soft clamp).
    pub bedrock: Height,
    /// The scale knob, 0.5..=2.0 (section 3.3).
    pub scale: f64,
}

/// A frame resolved for one world: every height in blocks.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WorldFrame {
    /// World height `H`.
    pub height: u32,
    /// Sea level (the y of the highest sea voxel).
    pub sea: i32,
    /// `H - sea`, the relief above sea.
    pub relief: f64,
    /// Soft-ceiling knee.
    pub knee: f64,
    /// Soft-ceiling cap.
    pub cap: f64,
    /// The ground floor.
    pub bedrock: f64,
    /// The scale knob.
    pub scale: f64,
    /// The vertical relief factor `min(1, sqrt(scale))`.
    pub relief_scale: f64,
}

impl WorldFrame {
    /// Resolve `spec`, validating it.
    pub fn from_spec(spec: &FrameSpec) -> Result<Self, SpecError> {
        if !(0.5..=2.0).contains(&spec.scale) {
            return Err(SpecError::new(
                "frame.scale",
                format!("{} is outside 0.5..=2.0", spec.scale),
            ));
        }
        if spec.height < 64 || spec.height > MAX_FRAME_HEIGHT || spec.height % 16 != 0 {
            return Err(SpecError::new(
                "frame.height",
                format!(
                    "{} must be a multiple of 16 in 64..={MAX_FRAME_HEIGHT}",
                    spec.height
                ),
            ));
        }
        let h = spec.height as f64;
        let relief_scale = if spec.scale < 1.0 {
            spec.scale.sqrt()
        } else {
            1.0
        };
        // Sea first: the other heights may be relative to it.
        let mut frame = WorldFrame {
            height: spec.height,
            sea: 0,
            relief: 0.0,
            knee: 0.0,
            cap: 0.0,
            bedrock: 0.0,
            scale: spec.scale,
            relief_scale,
        };
        let sea = match spec.sea {
            Height::Abs(v) => v,
            Height::ShareOfWorld(s) => s * h,
            other => {
                return Err(SpecError::new(
                    "frame.sea",
                    format!("{other:?}: sea level must be Abs or ShareOfWorld"),
                ))
            }
        };
        if !(sea >= 1.0 && sea < h - 16.0) {
            return Err(SpecError::new(
                "frame.sea",
                format!("{sea} is outside the world"),
            ));
        }
        frame.sea = (sea + 0.5).floor() as i32;
        frame.relief = h - frame.sea as f64;
        frame.knee = frame.resolve(spec.ceiling.knee);
        frame.cap = frame.resolve(spec.ceiling.cap);
        frame.bedrock = frame.resolve(spec.bedrock);
        if !(frame.knee < frame.cap && frame.cap <= h - 1.0) {
            return Err(SpecError::new(
                "frame.ceiling",
                format!(
                    "knee {} must lie below cap {}, and the cap inside the world",
                    frame.knee, frame.cap
                ),
            ));
        }
        if !(frame.bedrock >= 0.0 && frame.bedrock < frame.sea as f64) {
            return Err(SpecError::new(
                "frame.bedrock",
                format!("{} must lie between 0 and the sea", frame.bedrock),
            ));
        }
        Ok(frame)
    }

    /// A height in blocks (an absolute y, as a real number).
    pub fn resolve(&self, h: Height) -> f64 {
        let world = self.height as f64;
        match h {
            Height::Abs(v) => v,
            Height::AboveSea(v) => self.sea as f64 + v,
            Height::ShareOfRelief(s) => self.sea as f64 + s * self.relief * self.relief_scale,
            Height::ShareOfWorld(s) => s * world,
        }
    }

    /// A height difference in blocks: `resolve(h) - sea` for heights given
    /// relative to sea, the absolute value for the others. Used where a
    /// `Height` names an amount (a depth, a rise) rather than a level.
    pub fn amount(&self, h: Height) -> f64 {
        match h {
            Height::AboveSea(v) => v,
            Height::ShareOfRelief(s) => s * self.relief * self.relief_scale,
            Height::Abs(v) => v,
            Height::ShareOfWorld(s) => s * self.height as f64,
        }
    }

    /// A horizontal size in blocks.
    pub fn span(&self, s: Size) -> f64 {
        match s {
            Size::Span(v) => v * self.scale,
            Size::Blocks(v) => v,
        }
    }
}

/// A declared material role. The game binds roles to its own blocks with
/// a `RoleBinding`; compile resolves each through the binding, then the
/// fallback chain, else refuses (or skips the role when `optional`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RoleDecl {
    /// What the role is for.
    pub doc: String,
    /// The role used when this one has no binding.
    pub fallback: Option<String>,
    /// Whether the role must bind to a fluid block.
    pub fluid: bool,
    /// Whether an unbound role (with no bound fallback) is skipped instead
    /// of refused: the dressing that uses it is left out.
    pub optional: bool,
}

/// A declared game zone key.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ZoneDecl {
    /// What the zone is.
    pub doc: String,
}

/// How a water kind behaves.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum WaterClass {
    /// Lakes, ponds, the sea.
    Still,
    /// Rivers, creeks.
    Flowing,
    /// Curtains.
    Falling,
    /// Water with no surface: aquifers.
    Enclosed,
}

/// A declared game water kind.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WaterKindDecl {
    /// What the kind is.
    pub doc: String,
    /// Its fluid role.
    pub fluid: String,
    /// How it behaves.
    pub class: WaterClass,
}

/// A declared game claim bit.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClaimKeyDecl {
    /// What the claim means.
    pub doc: String,
}

/// How often a named field is evaluated.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Resolution {
    /// Every column.
    Full,
    /// On a world-aligned lattice with this stride (4 or 16), interpolated
    /// with a C1 bicubic.
    Stride(u8),
}

/// Which band of scales a field lives in.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Domain {
    /// Relief before any detail: every wavelength at or above 128 blocks
    /// (planner probes read it at stride 16).
    Macro,
    /// Everything else.
    Detail,
}

/// A named shared field.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FieldDef {
    /// The expression.
    pub graph: FieldExpr,
    /// Its scale band.
    pub domain: Domain,
    /// How often it is evaluated (authored data, part of identity).
    pub resolution: Resolution,
    /// Declared output range, checked against the range analysis.
    pub range: Option<(f64, f64)>,
    /// Whether the field is stored in the chunk facts (others live in
    /// scratch and are dropped).
    pub keep: bool,
}

/// A landform, region solver or site set, keyed by id in `spec.nodes`.
/// Compile builds every enabled node from its kind's factory and types and
/// validates a disabled node's params without building it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodeSpec {
    /// Registry key of the kind.
    pub kind: String,
    /// Its salt, claimed world-wide.
    pub salt: String,
    /// The A/B flag.
    #[serde(default = "yes")]
    pub enabled: bool,
    /// Same-layer composition edges: this node applies after these.
    #[serde(default)]
    pub over: Vec<String>,
    /// ...and before these.
    #[serde(default)]
    pub under: Vec<String>,
    /// The kind's params, typed and validated by its factory.
    pub params: Value,
}

fn yes() -> bool {
    true
}

impl NodeSpec {
    /// A node of `kind` with `salt`, enabled, with no edges and null
    /// params (set them with [`NodeSpec::params`]).
    pub fn new(kind: &str, salt: &str) -> Self {
        Self {
            kind: kind.to_string(),
            salt: salt.to_string(),
            enabled: true,
            over: Vec::new(),
            under: Vec::new(),
            params: Value::Null,
        }
    }

    /// Compose after these same-layer nodes.
    pub fn over(mut self, ids: &[&str]) -> Self {
        self.over.extend(ids.iter().map(|s| s.to_string()));
        self
    }

    /// Compose before these same-layer nodes.
    pub fn under(mut self, ids: &[&str]) -> Self {
        self.under.extend(ids.iter().map(|s| s.to_string()));
        self
    }

    /// The kind's typed params.
    pub fn params<P: Serialize>(mut self, p: P) -> Result<Self, SpecError> {
        self.params = serde_json::to_value(p)
            .map_err(|e| SpecError::new("params", format!("params do not serialize: {e}")))?;
        Ok(self)
    }

    /// The A/B flag.
    pub fn enabled(mut self, on: bool) -> Self {
        self.enabled = on;
        self
    }
}

impl FieldDef {
    /// A Detail-domain field at full resolution, not kept.
    pub fn detail(graph: FieldExpr) -> Self {
        Self {
            graph,
            domain: Domain::Detail,
            resolution: Resolution::Full,
            range: None,
            keep: false,
        }
    }

    /// The same field evaluated on a lattice of `stride` (4 or 16).
    pub fn strided(mut self, stride: u8) -> Self {
        self.resolution = Resolution::Stride(stride);
        self
    }

    /// The same field in the Macro domain.
    pub fn macro_domain(mut self) -> Self {
        self.domain = Domain::Macro;
        self
    }

    /// The same field, kept in the facts.
    pub fn kept(mut self) -> Self {
        self.keep = true;
        self
    }
}

impl ZoneDecl {
    /// A zone documented by `doc`.
    pub fn doc(doc: &str) -> Self {
        Self {
            doc: doc.to_string(),
        }
    }
}

impl ClaimKeyDecl {
    /// A claim key documented by `doc`.
    pub fn doc(doc: &str) -> Self {
        Self {
            doc: doc.to_string(),
        }
    }
}

/// One surfacer, applied in list order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaintNode {
    /// Registry key of the surfacer kind (`surface_rules`, `ecotones`,
    /// `zones`, or a game kind).
    pub kind: String,
    /// Its params, typed and validated by its factory.
    pub params: Value,
}

/// Water as data (so far: the implicit sea).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WaterSpec {
    /// Whether columns below sea level get the implicit sea layer.
    pub sea: bool,
    /// The sea's fluid role.
    pub sea_fluid: String,
}

/// A fixed spiral search for the spawn column.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpawnSearch {
    /// Where the spiral starts.
    pub origin: (i32, i32),
    /// How far it looks.
    pub max_radius: i32,
    /// Lattice step between candidates.
    pub stride: i32,
    /// Acceptable final ground, inclusive.
    pub ground: (Height, Height),
    /// Largest L2 slope at the candidate.
    pub max_slope: f64,
    /// Acceptable temperature window.
    pub temperature: (f64, f64),
    /// Acceptable moisture window.
    pub moisture: (f64, f64),
    /// Open sea within this many blocks, if set.
    pub coast_within: Option<i32>,
    /// Blocks spawn readers keep clear (read once landforms exist).
    pub clear_radius: i32,
}

/// Where players arrive.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum SpawnSpec {
    /// A fixed column.
    Fixed {
        /// x.
        x: i32,
        /// z.
        z: i32,
    },
    /// The first column of a fixed spiral that passes every test.
    Search(SpawnSearch),
}

/// Compile-time taste guards (section 3.3). `strict()` refuses a
/// violation; `warn()` reports it in the compile report.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TasteGuards {
    /// Shortest wavelength a Shape term may put on ground.
    pub min_ground_wavelength: f64,
    /// Largest amplitude of a Grain term (below 16 blocks of wavelength).
    pub max_fine_amplitude: f64,
    /// The "too smooth" floor on medium-scale energy (a run-time quality
    /// band; recorded here so it is part of identity).
    pub min_medium_amplitude: f64,
    /// Largest warp fold ratio `amp * 2 pi / wavelength`.
    pub warp_fold_limit: f64,
    /// Most gully octaves.
    pub max_gully_octaves: u8,
    /// Shortest gully wavelength.
    pub min_gully_wavelength: f64,
    /// Shortest strata period (Strata terms).
    pub min_strata_period: f64,
    /// Shortest bench period (Bench terms).
    pub min_bench_period: f64,
    /// Smallest lattice stride of a 3D band.
    pub min_band_stride: u8,
    /// Largest grain on a 3D band.
    pub max_band_grain: f64,
    /// Smallest fade at a band's floor, ceiling and edge.
    pub min_band_fade: f64,
    /// Largest dune lee slope.
    pub max_dune_lee_slope: f64,
    /// Whether landform heights must be Height shares.
    pub forbid_literal_heights: bool,
    /// Refuse (true) or report (false) a violation.
    pub strict: bool,
}

impl TasteGuards {
    /// The guards with the design's limits, refusing violations.
    pub fn strict() -> Self {
        Self {
            min_ground_wavelength: 16.0,
            max_fine_amplitude: 0.75,
            min_medium_amplitude: 0.02,
            warp_fold_limit: 0.8,
            max_gully_octaves: 3,
            min_gully_wavelength: 24.0,
            min_strata_period: 6.0,
            min_bench_period: 8.0,
            min_band_stride: 3,
            max_band_grain: 0.5,
            min_band_fade: 1.0,
            max_dune_lee_slope: 0.65,
            forbid_literal_heights: true,
            strict: true,
        }
    }

    /// The same limits, reporting violations instead of refusing them.
    pub fn warn() -> Self {
        Self {
            strict: false,
            ..Self::strict()
        }
    }
}

/// Deterministic plan step budgets (part of `spec_hash`; read once the
/// planner exists).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanBudgets {
    /// Probe calls per plan.
    pub probe_calls: u64,
    /// Trace steps per plan.
    pub trace_steps: u64,
    /// Flood cells per plan.
    pub flood_cells: u64,
}

impl PlanBudgets {
    /// The default budgets.
    pub fn standard() -> Self {
        Self {
            probe_calls: 1 << 16,
            trace_steps: 1 << 14,
            flood_cells: 1 << 16,
        }
    }
}

/// A landscape: everything that defines a world's terrain, as data.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LandscapeSpec {
    /// Must be [`LANDSCAPE_FORMAT`].
    pub format: u32,
    /// The preset key (`voxelize.plain`).
    pub preset: String,
    /// The preset's content version.
    pub content_version: ContentVersion,
    /// Height, sea, ceiling, floor and the scale knob.
    pub frame: FrameSpec,
    /// The role that fills solid ground before any paint.
    pub fill: String,
    /// Declared material roles.
    pub roles: BTreeMap<String, RoleDecl>,
    /// Declared game zone keys.
    pub zones: BTreeMap<String, ZoneDecl>,
    /// Declared game water kinds.
    pub water_kinds: BTreeMap<String, WaterKindDecl>,
    /// Declared game claim bits (16 at most).
    pub claim_keys: BTreeMap<String, ClaimKeyDecl>,
    /// Named shared fields; `ground` is the spine.
    pub fields: BTreeMap<String, FieldDef>,
    /// Landforms, region solvers and site sets, by id.
    pub nodes: BTreeMap<String, NodeSpec>,
    /// Surfacers, in order.
    pub paint: Vec<PaintNode>,
    /// The climate partition and the biomes.
    pub biomes: BiomeSpecM,
    /// Trees.
    pub flora: Option<FloraSpecM>,
    /// Water.
    pub water: WaterSpec,
    /// Where players arrive.
    pub spawn: SpawnSpec,
    /// Taste guards.
    pub taste: TasteGuards,
    /// Plan step budgets.
    pub budgets: PlanBudgets,
}

/// Read a spec strictly from JSON (correctly rounded numbers, duplicate
/// keys refused, path-qualified errors).
pub fn read_spec(text: &str) -> Result<LandscapeSpec, SpecError> {
    Ok(json::from_str(text)?)
}

/// Apply an RFC 7396 JSON merge patch to `target`: objects merge key by
/// key, `null` deletes a key, anything else replaces.
pub fn merge_patch(target: &mut Value, patch: &Value) {
    match patch {
        Value::Object(patch_map) => {
            if !target.is_object() {
                *target = Value::Object(serde_json::Map::new());
            }
            let map = target.as_object_mut().expect("an object");
            for (key, value) in patch_map {
                if value.is_null() {
                    map.remove(key);
                } else {
                    merge_patch(map.entry(key.clone()).or_insert(Value::Null), value);
                }
            }
        }
        other => *target = other.clone(),
    }
}

impl LandscapeSpec {
    /// This spec with an RFC 7396 merge patch applied, re-read strictly.
    pub fn patched(&self, patch: &Value) -> Result<LandscapeSpec, SpecError> {
        let mut value = serde_json::to_value(self)
            .map_err(|e| SpecError::new("", format!("spec does not serialize: {e}")))?;
        merge_patch(&mut value, patch);
        Ok(json::from_value(value)?)
    }

    /// Add or replace a named field.
    pub fn with_field(mut self, name: &str, def: FieldDef) -> Self {
        self.fields.insert(name.to_string(), def);
        self
    }

    /// Add or replace a zone key.
    pub fn with_zone(mut self, key: &str, decl: ZoneDecl) -> Self {
        self.zones.insert(key.to_string(), decl);
        self
    }

    /// Add or replace a node.
    pub fn with_node(mut self, id: &str, node: NodeSpec) -> Self {
        self.nodes.insert(id.to_string(), node);
        self
    }

    /// Add or replace a game claim key.
    pub fn with_claim_key(mut self, key: &str, decl: ClaimKeyDecl) -> Self {
        self.claim_keys.insert(key.to_string(), decl);
        self
    }

    /// The canonical JSON of this spec as written (raw params; the
    /// identity hash uses typed params, see `Landscape::identity`).
    pub fn to_canonical_json(&self) -> String {
        super::canon::to_canonical(self).expect("a spec serializes")
    }

    /// The canonical JSON laid out for reading (the JSON twins): the same
    /// value as [`LandscapeSpec::to_canonical_json`], on lines.
    pub fn to_pretty_json(&self) -> String {
        super::canon::write_pretty(&serde_json::to_value(self).expect("a spec serializes"))
    }
}
