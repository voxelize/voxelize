//! Owned mirrors of v1's named configs.
//!
//! v1's climate partitions and flora sets name their biomes, species, salts
//! and blocks with `&'static str`, and derive no `Deserialize`, so a spec
//! cannot hold them without leaking strings. `landscape` keeps owned
//! mirrors here, as plain data with the same meaning, and lowers them to
//! resolved, name-free forms in [`super::lower`]: the climate partition is
//! then evaluated by v1's own partition math through its name-free entry
//! point, and flora is placed by v1's cluster lattice and stamped by v1's
//! tree forms.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::spec::{Height, Size};

/// Where a climate axis comes from.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum AxisSourceM {
    /// The column's temperature after the lapse.
    Temperature,
    /// The column's moisture.
    Moisture,
    /// Final ground as a share of the relief above sea, `(top - sea) /
    /// (H - sea)`.
    HeightShare,
    /// A named field (`keep` is not required).
    Field(String),
}

/// One climate axis.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AxisM {
    /// Axis key, named by partition boxes.
    pub key: String,
    /// Its source.
    pub source: AxisSourceM,
}

/// The climate model.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClimateM {
    /// The field giving temperature before the lapse.
    pub temperature: String,
    /// The field giving moisture.
    pub moisture: String,
    /// Temperature drop across the whole relief above sea:
    /// `t = t_field - lapse * (ground - sea) / (H - sea)`, from final
    /// ground, so landforms that raise ground cool it.
    pub lapse: f64,
}

/// One box of a climate-matched partition.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClimateBoxM {
    /// The biome the box selects.
    pub biome: String,
    /// One `(low, high)` interval per partition axis.
    pub bounds: Vec<(f64, f64)>,
}

/// A region of a climate-matched partition.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClimateRegionM {
    /// Region key (for reports).
    pub key: String,
    /// Selection weight among regions.
    pub share: f64,
    /// Its boxes.
    pub boxes: Vec<ClimateBoxM>,
}

/// How biomes partition climate.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum PartitionM {
    /// One biome everywhere.
    Single(String),
    /// Nearest climate box, cross-faded over `transition` climate units.
    Climate {
        /// Axes the boxes use, in order.
        axes: Vec<String>,
        /// Regions (one region needs no salt draw).
        regions: Vec<ClimateRegionM>,
        /// Salt of the region-cell roll.
        region_salt: String,
        /// Region cell size.
        region_cell: Size,
        /// Cross-fade width in climate units.
        transition: f64,
    },
}

/// An overlay applied after shape, by final ground.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum OverlayM {
    /// Columns whose top lies within `[sea - below, sea + above]`.
    ShoreBand {
        /// The biome.
        biome: String,
        /// Blocks below sea.
        below: i32,
        /// Blocks above sea.
        above: i32,
    },
    /// Columns at least `min_depth` under sea.
    OpenWater {
        /// The biome.
        biome: String,
        /// Water depth.
        min_depth: i32,
    },
    /// Columns whose top reaches `above`.
    Peaks {
        /// The biome.
        biome: String,
        /// The height.
        above: Height,
    },
}

/// One biome: it owns paint tables, flora and tint, never shape.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BiomeM {
    /// What the biome is.
    pub doc: String,
    /// Grass and foliage tint as linear RGB multipliers, if any.
    pub tint: Option<[f64; 3]>,
}

/// The climate partition and the biomes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BiomeSpecM {
    /// Temperature, moisture and the lapse.
    pub climate: ClimateM,
    /// Axes the partition may name.
    pub axes: Vec<AxisM>,
    /// The partition.
    pub partition: PartitionM,
    /// Overlays, applied in order.
    pub overlays: Vec<OverlayM>,
    /// Biome keys (climate descriptors) and what they own.
    pub biomes: BTreeMap<String, BiomeM>,
}

/// A tree silhouette (v1's forms).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TreeFormM {
    /// Tiered blob canopy.
    Round,
    /// Slim trunk, small high crown.
    Slender,
    /// Stacked shrinking layers.
    Conic,
    /// Flat disc canopy on a leaning trunk.
    Umbrella,
    /// Wide low double canopy.
    Broad,
    /// Bare trunk with stubs.
    Snag,
}

impl From<TreeFormM> for crate::flora::TreeForm {
    fn from(f: TreeFormM) -> Self {
        use crate::flora::TreeForm;
        match f {
            TreeFormM::Round => TreeForm::Round,
            TreeFormM::Slender => TreeForm::Slender,
            TreeFormM::Conic => TreeForm::Conic,
            TreeFormM::Umbrella => TreeForm::Umbrella,
            TreeFormM::Broad => TreeForm::Broad,
            TreeFormM::Snag => TreeForm::Snag,
        }
    }
}

/// A species: a log and leaf role pair with a silhouette.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpeciesM {
    /// Trunk role.
    pub log: String,
    /// Leaf role.
    pub leaves: String,
    /// Silhouette.
    pub form: TreeFormM,
}

/// The grove gate of a set: clusters exist only where a patch field opens.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GroveGateM {
    /// Patch field wavelength.
    pub wavelength: Size,
    /// The window over the raw patch fractal (practical range about ±0.25)
    /// that admits a cluster centre.
    pub window: (f64, f64),
}

/// A flora set: stands on a jittered cluster lattice, each stand rolling a
/// dominant and a companion species, so trees come in coherent groves.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FloraSetM {
    /// Its salt, claimed world-wide.
    pub salt: String,
    /// Biome keys it plants in.
    pub biomes: Vec<String>,
    /// Cluster lattice pitch.
    pub cell: Size,
    /// Chance a cell holds a stand.
    pub chance: f64,
    /// The grove gate, if any.
    pub gate: Option<GroveGateM>,
    /// Trees per stand, inclusive (1..=8).
    pub points: (u8, u8),
    /// Stand radius in blocks.
    pub spread: f64,
    /// Species and weights; a stand rolls its dominant and companion here.
    pub species: Vec<(String, f64)>,
    /// Chance a member repeats the dominant instead of the companion.
    pub cohesion: f64,
    /// Size spread, 0..=0.5 (stand maturity times per-tree age).
    pub age_spread: f64,
    /// Steepest slope a trunk stands on.
    pub max_slope: f64,
    /// Acceptable top, inclusive, if limited.
    pub ground: Option<(Height, Height)>,
}

/// A community's canopy: stands on its own cluster lattice, only where
/// the community owns the ground.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CanopyM {
    /// Cluster lattice pitch.
    pub cell: Size,
    /// Chance a cell holds a stand.
    pub chance: f64,
    /// Trees per stand, inclusive (1..=8).
    pub points: (u8, u8),
    /// Stand radius in blocks.
    pub spread: f64,
    /// Species and weights (rolled per stand: dominant and companion).
    pub species: Vec<(String, f64)>,
    /// Chance a member repeats the dominant.
    pub cohesion: f64,
    /// Size spread, 0..=0.5.
    pub age_spread: f64,
    /// Steepest slope a trunk stands on.
    pub max_slope: f64,
}

/// A plant community: an environmental envelope that can own ground, and
/// what grows where it does.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommunityM {
    /// Biome keys whose ground it can own.
    pub biomes: Vec<String>,
    /// Acceptable top at the patch site, inclusive.
    pub ground: (Height, Height),
    /// Steepest slope at the site.
    pub max_slope: f64,
    /// Acceptable moisture at the site.
    pub moisture: (f64, f64),
    /// Selection weight among the communities eligible at a site.
    pub weight: f64,
    /// Its canopy (`None`: an open community, a meadow).
    pub canopy: Option<CanopyM>,
    /// Ecotone replacements: near the patch border canopy picks swap to
    /// these with probability rising toward the line.
    pub edge_species: Vec<(String, f64)>,
}

/// The community field: a jittered site lattice where each cell's site
/// elects one eligible community, so species arrive where their community
/// lives and patch borders read as ecotones.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EcologyM {
    /// Its salt, claimed world-wide.
    pub salt: String,
    /// Patch lattice pitch.
    pub cell: Size,
    /// Ecotone band as a share of the cell (0..=0.5).
    pub ecotone: f64,
    /// Communities by key, in key order.
    pub communities: BTreeMap<String, CommunityM>,
}

/// Trees: species, azonal sets and the community field.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FloraSpecM {
    /// Species by key.
    pub species: BTreeMap<String, SpeciesM>,
    /// Sets by key, placed in key order.
    pub sets: BTreeMap<String, FloraSetM>,
    /// The community field, if any (placed after the sets).
    pub ecology: Option<EcologyM>,
}
