//! Material roles and their bindings.
//!
//! Presets name materials by role (`rock.base`, `soil.top`, `fluid.water`),
//! never by block. A game binds each role to one of its own registry
//! blocks with a [`RoleBinding`]; fluid roles also carry the
//! [`FluidConfig`] the game baked into that fluid block, so stamping and
//! the settle test follow the same rules as the game's fluid simulation.
//! Compile resolves each declared role through the binding, then its
//! fallback chain, else refuses (or skips an optional role), and folds the
//! resolved table into the identity's `roles_digest`.
//!
//! [`standard_roles`] declares the 34 roles the built-in presets draw from;
//! [`RoleBinding::demo`] binds them to the demo block pack of
//! [`super::demo_blocks`].

use std::collections::BTreeMap;

use voxelize::FluidConfig;

use crate::landscape::spec::RoleDecl;

/// A game's role binding: role key to registry block name, and for fluid
/// roles the fluid's configuration.
#[derive(Clone, Default)]
pub struct RoleBinding {
    blocks: BTreeMap<String, String>,
    fluids: BTreeMap<String, FluidConfig>,
}

impl std::fmt::Debug for RoleBinding {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RoleBinding")
            .field("blocks", &self.blocks)
            .field("fluids", &self.fluids.keys().collect::<Vec<_>>())
            .finish()
    }
}

impl RoleBinding {
    /// An empty binding.
    pub fn new() -> Self {
        Self::default()
    }

    /// Bind `role` to the registry block named `block`.
    pub fn block(mut self, role: &str, block: &str) -> Self {
        self.blocks.insert(role.to_string(), block.to_string());
        self
    }

    /// Bind fluid `role` to the fluid block named `block`, simulated with
    /// `config`.
    pub fn fluid(mut self, role: &str, block: &str, config: FluidConfig) -> Self {
        self.blocks.insert(role.to_string(), block.to_string());
        self.fluids.insert(role.to_string(), config);
        self
    }

    /// The block bound to `role`, if any.
    pub fn block_of(&self, role: &str) -> Option<&str> {
        self.blocks.get(role).map(|s| s.as_str())
    }

    /// The fluid configuration bound to `role`, if any.
    pub fn fluid_config(&self, role: &str) -> Option<&FluidConfig> {
        self.fluids.get(role)
    }

    /// Every binding, sorted by role.
    pub fn iter(&self) -> impl Iterator<Item = (&str, &str)> {
        self.blocks.iter().map(|(r, b)| (r.as_str(), b.as_str()))
    }

    /// The demo binding: every standard role to a block of the demo pack.
    pub fn demo() -> Self {
        let mut b = Self::new();
        for (role, block) in DEMO_BLOCKS {
            b = b.block(role, block);
        }
        b.fluid("fluid.water", "Water", FluidConfig::new()).fluid(
            "fluid.lava",
            "Lava",
            FluidConfig::new().max_stage(3).tick_rate(30),
        )
    }
}

/// The demo pack's block for each non-fluid standard role.
pub const DEMO_BLOCKS: &[(&str, &str)] = &[
    ("rock.base", "Stone"),
    ("rock.hard", "Granite"),
    ("rock.soft", "Limestone"),
    ("rock.layer.0", "Sandstone"),
    ("rock.layer.1", "Clay"),
    ("rock.layer.2", "Mudstone"),
    ("rock.volcanic", "Basalt"),
    ("rock.volcanic.fine", "Scoria"),
    ("rock.tuff", "Tuff"),
    ("rock.glass", "Obsidian"),
    ("soil.top", "Grass Block"),
    ("soil.sub", "Dirt"),
    ("soil.dry", "Sand"),
    ("soil.wet", "Clay"),
    ("shore", "Sand"),
    ("gravel", "Gravel"),
    ("talus", "Gravel"),
    ("bed.river", "Gravel"),
    ("bed.lake", "Clay"),
    ("snow", "Snow"),
    ("ice", "Ice"),
    ("cover.moss", "Moss"),
    ("cave.cover", "Moss"),
    ("cave.strand", "Vines"),
    ("cave.glow", "Glow Stone"),
    ("cave.rubble", "Gravel"),
    ("cave.spike", "Dripstone"),
    ("flora.broadleaf.log", "Oak Log"),
    ("flora.broadleaf.leaf", "Oak Leaves"),
    ("flora.pale.log", "Birch Log"),
    ("build.masonry", "Cobblestone"),
    ("build.timber", "Oak Planks"),
];

fn decl(doc: &str, fallback: Option<&str>, fluid: bool, optional: bool) -> RoleDecl {
    RoleDecl {
        doc: doc.to_string(),
        fallback: fallback.map(str::to_string),
        fluid,
        optional,
    }
}

/// The 34 standard roles, with their docs and fallbacks.
pub fn standard_roles() -> BTreeMap<String, RoleDecl> {
    let rows: Vec<(&str, RoleDecl)> = vec![
        (
            "rock.base",
            decl(
                "the common rock every column is filled with",
                None,
                false,
                false,
            ),
        ),
        (
            "rock.hard",
            decl("hard crystalline rock", Some("rock.base"), false, false),
        ),
        (
            "rock.soft",
            decl("soft sedimentary rock", Some("rock.base"), false, false),
        ),
        (
            "rock.layer.0",
            decl("the first soft stratum", Some("rock.soft"), false, false),
        ),
        (
            "rock.layer.1",
            decl("the second soft stratum", Some("rock.soft"), false, false),
        ),
        (
            "rock.layer.2",
            decl("the third soft stratum", Some("rock.soft"), false, false),
        ),
        (
            "rock.volcanic",
            decl("dark volcanic rock", Some("rock.hard"), false, false),
        ),
        (
            "rock.volcanic.fine",
            decl("fine volcanic rubble", Some("rock.volcanic"), false, false),
        ),
        (
            "rock.tuff",
            decl("ash rock", Some("rock.volcanic"), false, false),
        ),
        (
            "rock.glass",
            decl("volcanic glass", Some("rock.volcanic"), false, false),
        ),
        (
            "soil.top",
            decl("the living top of temperate soil", None, false, false),
        ),
        (
            "soil.sub",
            decl("subsoil under the top", None, false, false),
        ),
        (
            "soil.dry",
            decl("loose dry ground", Some("soil.sub"), false, false),
        ),
        (
            "soil.wet",
            decl("wet heavy ground", Some("soil.sub"), false, false),
        ),
        (
            "shore",
            decl(
                "beaches and shallow sea floors",
                Some("soil.sub"),
                false,
                false,
            ),
        ),
        (
            "gravel",
            decl("loose stones", Some("rock.base"), false, false),
        ),
        (
            "talus",
            decl("scree under steep faces", Some("gravel"), false, false),
        ),
        (
            "bed.river",
            decl("river beds", Some("gravel"), false, false),
        ),
        (
            "bed.lake",
            decl("lake and deep sea beds", Some("soil.sub"), false, false),
        ),
        ("snow", decl("snow cover", None, false, false)),
        (
            "ice",
            decl("sea ice and ice shelves", Some("snow"), false, false),
        ),
        ("fluid.water", decl("water", None, true, false)),
        ("fluid.lava", decl("lava", Some("rock.glass"), true, false)),
        (
            "cover.moss",
            decl("moss cover", Some("soil.top"), false, false),
        ),
        (
            "cave.cover",
            decl("moss in upper caves", Some("cover.moss"), false, false),
        ),
        (
            "cave.strand",
            decl("hanging strands in upper caves", None, false, true),
        ),
        (
            "cave.glow",
            decl("rare glowing accents in upper caves", None, false, true),
        ),
        (
            "cave.rubble",
            decl("rubble on cave floors", Some("gravel"), false, false),
        ),
        (
            "cave.spike",
            decl("ceiling and floor spikes", Some("rock.soft"), false, false),
        ),
        (
            "flora.broadleaf.log",
            decl("broadleaf trunks", None, false, false),
        ),
        (
            "flora.broadleaf.leaf",
            decl("broadleaf foliage", None, false, false),
        ),
        (
            "flora.pale.log",
            decl(
                "pale-barked trunks",
                Some("flora.broadleaf.log"),
                false,
                false,
            ),
        ),
        (
            "build.masonry",
            decl(
                "dressed stone for structures",
                Some("rock.base"),
                false,
                false,
            ),
        ),
        (
            "build.timber",
            decl(
                "sawn timber for structures",
                Some("flora.broadleaf.log"),
                false,
                false,
            ),
        ),
    ];
    rows.into_iter().map(|(k, v)| (k.to_string(), v)).collect()
}
